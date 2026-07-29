import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  getPositionRole,
  isRatingEligibleScore,
  calcMatchBreakdown,
  type MatchStatRow,
  type MatchResult,
} from "@/lib/ratings";

function json(status: number, body: unknown) {
  return NextResponse.json(body, { status });
}

function requireAuth(req: NextRequest) {
  const adminPassword = req.headers.get("x-admin-password");
  if (!process.env.ADMIN_IMPORT_PASSWORD || !process.env.ADMIN_IMPORT_TOKEN) {
    return { ok: false as const, error: "Server configuration error" };
  }
  if (adminPassword !== process.env.ADMIN_IMPORT_PASSWORD) {
    return { ok: false as const, error: "Invalid admin password or token" };
  }
  const auth = req.headers.get("authorization") || "";
  const tok = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (!tok || tok !== process.env.ADMIN_IMPORT_TOKEN) {
    return { ok: false as const, error: "Invalid admin password or token" };
  }
  return { ok: true as const };
}

const SELECT =
  "match_id,player_id,team_side,position,score,goals,assists,shots,shots_on_target,key_passes,passes," +
  "tackles,key_tackles,interceptions,key_interceptions,possessions_lost,gk_saves,gk_catches," +
  "benched,stats_incomplete,players(handle,name)," +
  "matches(home_team,away_team,home_score,away_score,played_at,leagues(name))";

type Role = "GK" | "DEF" | "MID" | "FWD";

/**
 * GET — a queue of real performances to judge.
 *
 * Query params:
 *   role=GK|DEF|MID|FWD   restrict to one role (default: all)
 *   limit=n               how many to return (default 25)
 *   includeJudged=1       include ones already judged (default: unjudged only)
 *
 * Performances are spread across the full range of game scores rather than
 * returned in table order, so the queue isn't 25 consecutive average games.
 */
export async function GET(req: NextRequest) {
  const auth = requireAuth(req);
  if (!auth.ok) return json(401, { error: auth.error });
  if (!supabaseAdmin) return json(500, { error: "Server missing SUPABASE_SERVICE_ROLE_KEY" });

  const url = new URL(req.url);
  const roleFilter = (url.searchParams.get("role") || "").toUpperCase() as Role | "";
  const limit = Math.min(200, Math.max(1, parseInt(url.searchParams.get("limit") || "25")));
  const includeJudged = url.searchParams.get("includeJudged") === "1";

  // Existing judgments, so the queue can skip what's already done.
  const { data: judged, error: jErr } = await supabaseAdmin
    .from("rating_judgments")
    .select("match_id,player_id,role,position,attacking,defending,passing,consistency,gk,final,notes");
  if (jErr) return json(500, { error: jErr.message });

  const judgedMap = new Map<string, any>();
  for (const j of judged ?? []) judgedMap.set(`${j.match_id}:${j.player_id}`, j);

  // Pull all candidate stat lines (paginated past the 1000-row cap).
  const all: any[] = [];
  let from = 0;
  const PAGE = 1000;
  while (true) {
    const { data, error } = await supabaseAdmin
      .from("match_player_stats")
      .select(SELECT)
      .range(from, from + PAGE - 1);
    if (error) return json(500, { error: error.message });
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }

  const usable = all.filter((s: any) => {
    const m = Array.isArray(s.matches) ? s.matches[0] : s.matches;
    if (!s.position || s.benched || s.stats_incomplete) return false;
    if (!m || m.home_score == null || m.away_score == null) return false;
    if (!isRatingEligibleScore(s.score)) return false;
    if (roleFilter && getPositionRole(s.position) !== roleFilter) return false;
    if (!includeJudged && judgedMap.has(`${s.match_id}:${s.player_id}`)) return false;
    return true;
  });

  // Spread the queue evenly across the score range so the sample covers poor,
  // average and outstanding performances rather than clustering at the mean.
  usable.sort((a, b) => (a.score ?? 0) - (b.score ?? 0));
  const picked: any[] = [];
  if (usable.length <= limit) {
    picked.push(...usable);
  } else {
    const step = usable.length / limit;
    for (let i = 0; i < limit; i++) picked.push(usable[Math.floor(i * step)]);
  }

  const items = picked.map((s: any) => {
    const m = Array.isArray(s.matches) ? s.matches[0] : s.matches;
    const p = Array.isArray(s.players) ? s.players[0] : s.players;
    const league = Array.isArray(m.leagues) ? m.leagues[0] : m.leagues;
    const isHome = s.team_side === "home";
    const my = isHome ? m.home_score : m.away_score;
    const opp = isHome ? m.away_score : m.home_score;
    const result: MatchResult = my > opp ? "W" : my < opp ? "L" : "D";

    const statRow: MatchStatRow = {
      goals: s.goals ?? 0,
      assists: s.assists ?? 0,
      key_passes: s.key_passes ?? 0,
      shots_on_target: s.shots_on_target ?? 0,
      passes: s.passes ?? 0,
      tackles: s.tackles ?? 0,
      key_tackles: s.key_tackles ?? 0,
      interceptions: s.interceptions ?? 0,
      key_interceptions: s.key_interceptions ?? 0,
      possessions_lost: s.possessions_lost ?? 0,
      gk_saves: s.gk_saves ?? 0,
      gk_catches: s.gk_catches ?? 0,
      goals_conceded: opp,
      score: s.score ?? 0,
      position: s.position,
    };

    // The formula's own answer travels with the item but the UI keeps it hidden
    // by default — seeing it first would anchor the judgement it's meant to test.
    const breakdown = calcMatchBreakdown(statRow, result, s.position);

    return {
      matchId: s.match_id,
      playerId: s.player_id,
      player: p?.name || p?.handle || "Unknown",
      fixture: `${m.home_team} ${m.home_score}–${m.away_score} ${m.away_team}`,
      playedAt: (m.played_at ?? "").slice(0, 10),
      leagueName: league?.name ?? null,
      teamSide: s.team_side,
      position: s.position,
      role: getPositionRole(s.position),
      result,
      stats: {
        goals: statRow.goals,
        assists: statRow.assists,
        shots: s.shots ?? 0,
        shots_on_target: statRow.shots_on_target,
        key_passes: statRow.key_passes,
        passes: statRow.passes,
        tackles: statRow.tackles,
        key_tackles: statRow.key_tackles,
        interceptions: statRow.interceptions,
        key_interceptions: statRow.key_interceptions,
        possessions_lost: statRow.possessions_lost,
        gk_saves: statRow.gk_saves,
        gk_catches: statRow.gk_catches,
        goals_conceded: opp,
        game_score: statRow.score,
      },
      formula: {
        final: breakdown.final,
        scores: breakdown.scores,
        weights: breakdown.weights,
      },
      judgment: judgedMap.get(`${s.match_id}:${s.player_id}`) ?? null,
    };
  });

  // Progress counters so the UI can show how much is left per role.
  const counts: Record<string, { total: number; judged: number }> = {};
  for (const s of all) {
    const m = Array.isArray(s.matches) ? s.matches[0] : s.matches;
    if (!s.position || s.benched || s.stats_incomplete) continue;
    if (!m || m.home_score == null || m.away_score == null) continue;
    if (!isRatingEligibleScore(s.score)) continue;
    const r = getPositionRole(s.position);
    counts[r] ??= { total: 0, judged: 0 };
    counts[r].total++;
    if (judgedMap.has(`${s.match_id}:${s.player_id}`)) counts[r].judged++;
  }

  return json(200, { items, counts, totalJudged: judgedMap.size });
}

/** POST — save (or update) one judgment. */
export async function POST(req: NextRequest) {
  const auth = requireAuth(req);
  if (!auth.ok) return json(401, { error: auth.error });
  if (!supabaseAdmin) return json(500, { error: "Server missing SUPABASE_SERVICE_ROLE_KEY" });

  const body = await req.json().catch(() => null);
  if (!body?.matchId || !body?.playerId) {
    return json(400, { error: "matchId and playerId are required" });
  }

  const num = (v: any): number | null => {
    if (v === "" || v == null) return null;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0 || n > 100) return null;
    return Math.round(n);
  };

  const final = num(body.final);
  if (final === null) return json(400, { error: "final is required and must be 0-100" });

  const { error } = await supabaseAdmin.from("rating_judgments").upsert({
    match_id: body.matchId,
    player_id: body.playerId,
    role: body.role ?? getPositionRole(body.position),
    position: body.position ?? null,
    attacking: num(body.attacking),
    defending: num(body.defending),
    passing: num(body.passing),
    consistency: num(body.consistency),
    gk: num(body.gk),
    final,
    notes: body.notes || null,
    judged_at: new Date().toISOString(),
  });

  if (error) return json(500, { error: error.message });
  return json(200, { ok: true });
}

/** DELETE — remove a judgment (for when you change your mind). */
export async function DELETE(req: NextRequest) {
  const auth = requireAuth(req);
  if (!auth.ok) return json(401, { error: auth.error });
  if (!supabaseAdmin) return json(500, { error: "Server missing SUPABASE_SERVICE_ROLE_KEY" });

  const url = new URL(req.url);
  const matchId = url.searchParams.get("matchId");
  const playerId = url.searchParams.get("playerId");
  if (!matchId || !playerId) return json(400, { error: "matchId and playerId are required" });

  const { error } = await supabaseAdmin
    .from("rating_judgments")
    .delete()
    .eq("match_id", matchId)
    .eq("player_id", playerId);

  if (error) return json(500, { error: error.message });
  return json(200, { ok: true });
}
