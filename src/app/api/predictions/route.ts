import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// GET — fetch all predictions for given match IDs (or all upcoming)
export async function GET(req: NextRequest) {
  const matchIds = req.nextUrl.searchParams.get("match_ids");
  const userId = req.nextUrl.searchParams.get("user_id");

  let query = supabase.from("predictions").select("match_id,prediction,user_id");

  if (matchIds) {
    const ids = matchIds.split(",");
    query = query.in("match_id", ids);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Aggregate vote counts per match
  const counts: Record<string, { home: number; draw: number; away: number }> = {};
  const userVotes: Record<string, string> = {};

  for (const row of data ?? []) {
    if (!counts[row.match_id]) counts[row.match_id] = { home: 0, draw: 0, away: 0 };
    if (row.prediction === "home") counts[row.match_id].home++;
    else if (row.prediction === "draw") counts[row.match_id].draw++;
    else if (row.prediction === "away") counts[row.match_id].away++;

    if (userId && row.user_id === userId) {
      userVotes[row.match_id] = row.prediction;
    }
  }

  return NextResponse.json({ counts, userVotes });
}

// POST — submit or update a prediction
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { match_id, user_id, prediction } = body;

  if (!match_id || !user_id || !prediction) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  if (!["home", "draw", "away"].includes(prediction)) {
    return NextResponse.json({ error: "Invalid prediction" }, { status: 400 });
  }

  // Check that the match exists and hasn't been played yet
  const { data: match } = await supabase
    .from("matches")
    .select("id,played_at,home_score,away_score")
    .eq("id", match_id)
    .single();

  if (!match) {
    return NextResponse.json({ error: "Match not found" }, { status: 404 });
  }

  // Block voting if match date has passed
  if (match.played_at && new Date(match.played_at) <= new Date()) {
    return NextResponse.json({ error: "Voting closed — match date has passed" }, { status: 403 });
  }

  // Upsert — one vote per user per match
  const { error } = await supabase
    .from("predictions")
    .upsert(
      { match_id, user_id, prediction },
      { onConflict: "match_id,user_id" }
    );

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
