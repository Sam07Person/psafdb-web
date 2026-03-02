import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) return NextResponse.json({ players: [], teams: [], leagues: [], matches: [] });

  const pattern = `%${q}%`;

  const [players, teams, leagues, matchesHome, matchesAway] = await Promise.all([
    supabase
      .from("players")
      .select("id,name,handle")
      .or(`name.ilike.${pattern},handle.ilike.${pattern}`)
      .limit(5),
    supabase
      .from("teams")
      .select("id,name")
      .ilike("name", pattern)
      .limit(5),
    supabase
      .from("leagues")
      .select("id,name,season")
      .ilike("name", pattern)
      .limit(5),
    supabase
      .from("matches")
      .select("id,home_team,away_team,home_score,away_score,played_at")
      .ilike("home_team", pattern)
      .not("home_score", "is", null)
      .order("played_at", { ascending: false })
      .limit(4),
    supabase
      .from("matches")
      .select("id,home_team,away_team,home_score,away_score,played_at")
      .ilike("away_team", pattern)
      .not("home_score", "is", null)
      .order("played_at", { ascending: false })
      .limit(4),
  ]);

  // Deduplicate matches by id, cap at 5
  const matchMap = new Map<string, any>();
  for (const m of [...(matchesHome.data ?? []), ...(matchesAway.data ?? [])]) {
    if (!matchMap.has(m.id)) matchMap.set(m.id, m);
  }
  const matches = Array.from(matchMap.values())
    .sort((a, b) => new Date(b.played_at).getTime() - new Date(a.played_at).getTime())
    .slice(0, 5);

  return NextResponse.json({
    players: players.data ?? [],
    teams:   teams.data   ?? [],
    leagues: leagues.data ?? [],
    matches,
  });
}
