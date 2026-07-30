import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  getPositionRole,
  isRatingEligibleScore,
  calcMatchBreakdown,
  calcGkParts,
  GK_PART_WEIGHTS,
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
  "benched,stats_incomplete,is_starter,sub_number,players(handle,name)," +
  "matches(home_team,away_team,home_score,away_score,played_at,leagues(name))";

type Role = "GK" | "DEF" | "MID" | "FWD";

/**
 * Minimum game score for a performance to be WORTH JUDGING.
 *
 * Deliberately separate from MIN_RATING_SCORE in lib/ratings.ts, which decides
 * whether a match counts toward a player's rating at all. Raising this floor only
 * changes which performances get queued for calibration — it can never change a
 * rating, frozen or otherwise. Do not merge the two.
 */
const DEFAULT_CALIBRATION_MIN_SCORE = 70;

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
  const excludeSubs = url.searchParams.get("excludeSubs") !== "0"; // on by default
  const minScoreParam = parseInt(url.searchParams.get("minScore") || "");
  const minScore = Number.isFinite(minScoreParam) && minScoreParam >= 0
    ? minScoreParam
    : DEFAULT_CALIBRATION_MIN_SCORE;

  // Existing judgments, so the queue can skip what's already done.
  const { data: judged, error: jErr } = await supabaseAdmin
    .from("rating_judgments")
    .select("match_id,player_id,role,position,attacking,defending,passing,consistency,gk,gk_gc,gk_saves,gk_catches,gk_efficiency,final,notes,skipped,skip_reason");

  if (jErr) {
    // By far the most common cause of an empty page: the migration hasn't been run.
    // Say so explicitly rather than surfacing a raw Postgres error.
    const missingTable =
      jErr.code === "42P01" ||
      jErr.code === "PGRST205" ||
      /relation .*rating_judgments.* does not exist|could not find the table/i.test(jErr.message);
    if (missingTable) {
      return json(503, {
        error: "The rating_judgments table doesn't exist yet.",
        hint: "Run migrations/002_rating_judgments.sql in the Supabase SQL editor, then reload this page.",
        setupRequired: true,
      });
    }
    return json(500, { error: jErr.message });
  }

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

  // Track why rows get dropped, so an empty queue can explain itself instead of
  // just rendering nothing.
  const rejected = {
    noPosition: 0, benched: 0, incomplete: 0, noResult: 0,
    badScore: 0, lowScore: 0, substitute: 0, wrongRole: 0, alreadyJudged: 0, skipped: 0,
  };

  const usable = all.filter((s: any) => {
    const m = Array.isArray(s.matches) ? s.matches[0] : s.matches;
    const key = `${s.match_id}:${s.player_id}`;
    const prior = judgedMap.get(key);

    if (!s.position) { rejected.noPosition++; return false; }
    if (s.benched) { rejected.benched++; return false; }
    if (s.stats_incomplete) { rejected.incomplete++; return false; }
    if (!m || m.home_score == null || m.away_score == null) { rejected.noResult++; return false; }
    if (!isRatingEligibleScore(s.score)) { rejected.badScore++; return false; }
    // Calibration-only floor: too weak a performance to be worth a verdict.
    if ((s.score ?? 0) <= minScore) { rejected.lowScore++; return false; }
    // Subs rarely play enough minutes for their stat line to mean anything.
    if (excludeSubs && (s.is_starter === false || s.sub_number != null)) { rejected.substitute++; return false; }
    if (roleFilter && getPositionRole(s.position) !== roleFilter) { rejected.wrongRole++; return false; }
    // A skipped performance never comes back, even when revisiting judged ones.
    if (prior?.skipped) { rejected.skipped++; return false; }
    if (!includeJudged && prior) { rejected.alreadyJudged++; return false; }
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
        // Weights and the result bonus are the scoring *scheme*, not the answer —
        // the UI needs them to derive an overall from the judged sub-ratings, so
        // unlike `final`/`scores` they are shown up front.
        weights: breakdown.weights,
        resultBonus: breakdown.resultBonus,
        role: breakdown.role,
        // Keepers judge the four components of goalkeeping rather than one lump
        // number, so the split travels with the item.
        gk: breakdown.role === "GK" ? (() => {
          const p = calcGkParts(statRow);
          return {
            weights: GK_PART_WEIGHTS,
            scores: { gk_gc: p.gk_gc, gk_saves: p.gk_saves, gk_catches: p.gk_catches },
            savePercent: p.savePercent,
            efficiencyBonus: p.efficiencyBonus,
          };
        })() : null,
      },
      judgment: judgedMap.get(`${s.match_id}:${s.player_id}`) ?? null,
    };
  });

  // Progress counters. "total" is the queueable pool under the CURRENT filters,
  // so the percentages line up with what you'll actually be asked to judge.
  const counts: Record<string, { total: number; judged: number; skipped: number }> = {};
  for (const s of all) {
    const m = Array.isArray(s.matches) ? s.matches[0] : s.matches;
    if (!s.position || s.benched || s.stats_incomplete) continue;
    if (!m || m.home_score == null || m.away_score == null) continue;
    if (!isRatingEligibleScore(s.score)) continue;
    if ((s.score ?? 0) <= minScore) continue;
    if (excludeSubs && (s.is_starter === false || s.sub_number != null)) continue;
    const r = getPositionRole(s.position);
    counts[r] ??= { total: 0, judged: 0, skipped: 0 };
    counts[r].total++;
    const prior = judgedMap.get(`${s.match_id}:${s.player_id}`);
    if (prior?.skipped) counts[r].skipped++;
    else if (prior) counts[r].judged++;
  }

  const totalJudged = (judged ?? []).filter((j: any) => !j.skipped).length;
  const totalSkipped = (judged ?? []).filter((j: any) => j.skipped).length;

  return json(200, {
    items,
    counts,
    totalJudged,
    totalSkipped,
    settings: { minScore, excludeSubs },
    diagnostics: { totalRows: all.length, eligible: usable.length, rejected },
  });
}

/** POST — save a judgment, or record a skip. */
export async function POST(req: NextRequest) {
  const auth = requireAuth(req);
  if (!auth.ok) return json(401, { error: auth.error });
  if (!supabaseAdmin) return json(500, { error: "Server missing SUPABASE_SERVICE_ROLE_KEY" });

  const body = await req.json().catch(() => null);
  if (!body?.matchId || !body?.playerId) {
    return json(400, { error: "matchId and playerId are required" });
  }

  const num = (v: any, max = 100): number | null => {
    if (v === "" || v == null) return null;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0 || n > max) return null;
    return Math.round(n);
  };

  const base = {
    match_id: body.matchId,
    player_id: body.playerId,
    role: body.role ?? getPositionRole(body.position),
    position: body.position ?? null,
    judged_at: new Date().toISOString(),
  };

  // A skip records "deliberately not judged" — no ratings, and it never returns
  // to the queue. Kept distinct from an unjudged row, which is simply not there.
  if (body.skipped) {
    const { error } = await supabaseAdmin.from("rating_judgments").upsert({
      ...base,
      attacking: null, defending: null, passing: null, consistency: null, gk: null,
      gk_gc: null, gk_saves: null, gk_catches: null, gk_efficiency: null,
      final: null,
      notes: null,
      skipped: true,
      skip_reason: body.skipReason || null,
    });
    if (error) return json(500, { error: error.message });
    return json(200, { ok: true, skipped: true });
  }

  const final = num(body.final);
  if (final === null) return json(400, { error: "final is required and must be 0-100" });

  const { error } = await supabaseAdmin.from("rating_judgments").upsert({
    ...base,
    attacking: num(body.attacking),
    defending: num(body.defending),
    passing: num(body.passing),
    consistency: num(body.consistency),
    gk: num(body.gk),
    gk_gc: num(body.gk_gc, 150),
    gk_saves: num(body.gk_saves, 150),
    gk_catches: num(body.gk_catches, 150),
    gk_efficiency: num(body.gk_efficiency),
    final,
    notes: body.notes || null,
    skipped: false,
    skip_reason: null,
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
