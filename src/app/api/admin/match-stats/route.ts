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
    return { ok: false as const, error: "Invalid admin password or token" };
  }

  const expected = process.env.ADMIN_IMPORT_TOKEN;
  if (!expected) return { ok: false as const, error: "Server configuration error" };

  const auth = req.headers.get("authorization") || "";
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (!token || token !== expected) return { ok: false as const, error: "Invalid admin password or token" };

  return { ok: true as const };
}

export async function GET(req: NextRequest) {
  const auth = requireAuth(req);
  if (!auth.ok) return json(401, { error: auth.error });
  if (!supabaseAdmin) return json(500, { error: "Server missing SUPABASE_SERVICE_ROLE_KEY" });

  const match_id = req.nextUrl.searchParams.get("match_id");
  if (!match_id) return json(400, { error: "match_id is required" });

  // Fetch team stats
  const { data: teamStatsData, error: tsErr } = await supabaseAdmin
    .from("match_team_stats")
    .select("*")
    .eq("match_id", match_id);

  if (tsErr) return json(500, { error: tsErr.message });

  const home = (teamStatsData || []).find((r: any) => r.team_side === "home") || null;
  const away = (teamStatsData || []).find((r: any) => r.team_side === "away") || null;

  // Fetch player stats with player info
  const { data: psData, error: psErr } = await supabaseAdmin
    .from("match_player_stats")
    .select("*,players(id,name,handle,game_user_id)")
    .eq("match_id", match_id);

  let playerStats: any[] = [];

  if (psErr) {
    // Fallback: fetch without join, then fetch players separately
    const { data: psData2, error: psErr2 } = await supabaseAdmin
      .from("match_player_stats")
      .select("*")
      .eq("match_id", match_id);
    if (psErr2) return json(500, { error: psErr2.message });

    const ids = [...new Set((psData2 || []).map((r: any) => r.player_id))];
    const { data: playersData } = ids.length
      ? await supabaseAdmin.from("players").select("id,name,handle,game_user_id").in("id", ids)
      : { data: [] };
    const playerMap = new Map((playersData || []).map((p: any) => [p.id, p]));
    playerStats = (psData2 || []).map((r: any) => ({ ...r, player: playerMap.get(r.player_id) || null }));
  } else {
    playerStats = (psData || []).map((r: any) => {
      const { players, ...rest } = r;
      return { ...rest, player: players || null };
    });
  }

  return json(200, {
    team_stats: { home, away },
    player_stats: playerStats,
  });
}

export async function PUT(req: NextRequest) {
  const auth = requireAuth(req);
  if (!auth.ok) return json(401, { error: auth.error });
  if (!supabaseAdmin) return json(500, { error: "Server missing SUPABASE_SERVICE_ROLE_KEY" });

  const body = await req.json().catch(() => null);
  if (!body) return json(400, { error: "Invalid JSON body" });

  const { match_id, team_stats, player_stats } = body;
  if (!match_id) return json(400, { error: "match_id is required" });

  const results: any = {};

  // Update team stats via upsert (PK: match_id, team_side)
  if (team_stats) {
    const rows: any[] = [];
    if (team_stats.home) rows.push({ ...team_stats.home, match_id, team_side: "home" });
    if (team_stats.away) rows.push({ ...team_stats.away, match_id, team_side: "away" });
    if (rows.length > 0) {
      const { error } = await supabaseAdmin
        .from("match_team_stats")
        .upsert(rows, { onConflict: "match_id,team_side" });
      if (error) return json(500, { error: error.message });
      results.team_stats = rows.length;
    }
  }

  // Update player stats via upsert (PK: match_id, player_id)
  if (Array.isArray(player_stats) && player_stats.length > 0) {
    const rows = player_stats.map((p: any) => ({
      match_id,
      player_id: p.player_id,
      team_side: p.team_side,
      position: p.position || null,
      score: p.score ?? 0,
      passes: p.passes ?? 0,
      key_passes: p.key_passes ?? 0,
      assists: p.assists ?? 0,
      shots: p.shots ?? 0,
      shots_on_target: p.shots_on_target ?? 0,
      goals: p.goals ?? 0,
      tackles: p.tackles ?? 0,
      key_tackles: p.key_tackles ?? 0,
      interceptions: p.interceptions ?? 0,
      key_interceptions: p.key_interceptions ?? 0,
      possessions_lost: p.possessions_lost ?? 0,
      gk_saves: p.gk_saves ?? 0,
      gk_catches: p.gk_catches ?? 0,
      is_starter: p.is_starter ?? true,
      sub_number: p.sub_number ?? null,
      benched: p.benched ?? false,
      stats_incomplete: p.stats_incomplete ?? false,
    }));
    const { error } = await supabaseAdmin
      .from("match_player_stats")
      .upsert(rows, { onConflict: "match_id,player_id" });
    if (error) return json(500, { error: error.message });
    results.player_stats = rows.length;
  }

  return json(200, { ok: true, updated: results });
}
