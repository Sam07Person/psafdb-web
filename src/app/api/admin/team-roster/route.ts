import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function json(status: number, body: unknown) {
  return NextResponse.json(body, { status });
}

function requireAuth(req: NextRequest) {
  const adminPassword = req.headers.get("x-admin-password");
  if (!process.env.ADMIN_IMPORT_PASSWORD) {
    return { ok: false as const, error: "Server configuration error" };
  }
  if (adminPassword !== process.env.ADMIN_IMPORT_PASSWORD) {
    return { ok: false as const, error: "Invalid admin password" };
  }

  const expected = process.env.ADMIN_IMPORT_TOKEN;
  if (!expected) return { ok: false as const, error: "Server configuration error" };

  const auth = req.headers.get("authorization") || "";
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (!token || token !== expected) return { ok: false as const, error: "Invalid token" };

  return { ok: true as const };
}

function normalizeTeamName(name: string): string {
  return name.toLowerCase().trim()
    .replace(/\s+fc$/i, "")
    .replace(/^fc\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

export async function GET(req: NextRequest) {
  const auth = requireAuth(req);
  if (!auth.ok) return json(401, { error: auth.error });

  if (!supabaseAdmin) return json(500, { error: "Server missing SUPABASE_SERVICE_ROLE_KEY" });

  const teamName = req.nextUrl.searchParams.get("team");
  if (!teamName || teamName.length < 2) return json(400, { error: "team is required" });

  const normalized = normalizeTeamName(teamName);

  // Get recent matches for this team, with home/away info so we know which side they played on
  const { data: recentMatches } = await supabaseAdmin
    .from("matches")
    .select("id, home_team, away_team")
    .or(`home_team.ilike.%${normalized}%,away_team.ilike.%${normalized}%`)
    .not("home_score", "is", null)
    .order("played_at", { ascending: false })
    .limit(10);

  if (!recentMatches?.length) return json(200, { players: [] });

  // For each match, determine which side the team played on
  const homeMatchIds: string[] = [];
  const awayMatchIds: string[] = [];

  for (const match of recentMatches) {
    const homeNorm = normalizeTeamName(match.home_team);
    const isHome = homeNorm === normalized || homeNorm.includes(normalized) || normalized.includes(homeNorm);
    if (isHome) {
      homeMatchIds.push(match.id);
    } else {
      awayMatchIds.push(match.id);
    }
  }

  // Fetch only stats for the team's side — this excludes opponent players
  const freq: Record<string, number> = {};

  if (homeMatchIds.length > 0) {
    const { data: homeStats } = await supabaseAdmin
      .from("match_player_stats")
      .select("player_id")
      .in("match_id", homeMatchIds)
      .eq("team_side", "home");
    for (const s of homeStats || []) {
      freq[s.player_id] = (freq[s.player_id] || 0) + 1;
    }
  }

  if (awayMatchIds.length > 0) {
    const { data: awayStats } = await supabaseAdmin
      .from("match_player_stats")
      .select("player_id")
      .in("match_id", awayMatchIds)
      .eq("team_side", "away");
    for (const s of awayStats || []) {
      freq[s.player_id] = (freq[s.player_id] || 0) + 1;
    }
  }

  if (!Object.keys(freq).length) return json(200, { players: [] });

  // Sort by frequency, take top 25
  const playerIds = Object.keys(freq).sort((a, b) => freq[b] - freq[a]).slice(0, 25);

  const { data: playersData } = await supabaseAdmin
    .from("players")
    .select("id, name, game_user_id")
    .in("id", playerIds);

  const sorted = (playersData || []).sort((a, b) => (freq[b.id] || 0) - (freq[a.id] || 0));

  return json(200, { players: sorted });
}
