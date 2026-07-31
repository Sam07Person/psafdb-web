/**
 * Compare the rating formula against your human judgements.
 *
 * The calibration page (/admin/rating-calibration) only ever WRITES to
 * rating_judgments — nothing read it back. This script closes that loop: it
 * recomputes the current formula for every judged performance and reports where
 * it systematically disagrees with you, per role and per sub-rating.
 *
 * It changes nothing. No writes, no suggested constants — just the diagnosis.
 *
 * Usage:
 *   npm run calibration:report
 *   npm run calibration:report -- --csv calibration/comparison.csv
 *   npm run calibration:report -- --worst 25
 *
 * Reading the output:
 *   bias  = mean(formula - you). Positive means the formula rates HIGHER than you.
 *           This is the number that matters — a consistent offset is a fixable
 *           constant. Near-zero bias with a large MAE means the formula is
 *           unbiased but noisy, which is a harder problem.
 *   MAE   = mean absolute error, i.e. typical disagreement size regardless of direction.
 *   r     = correlation. Low r means the formula is ranking performances differently
 *           to you, which no amount of shifting a constant will fix.
 *
 * Caveat on `final`: the calibration UI derives the overall from your judged
 * sub-ratings using the formula's own weights, so it is not an independent
 * verdict. Treat sub-rating rows as the real signal and `final` as a summary.
 */

import { createClient } from "@supabase/supabase-js";
import {
  calcMatchBreakdown,
  calcGkParts,
  getPositionRole,
  isRatingEligibleScore,
  type MatchStatRow,
  type MatchResult,
} from "../src/lib/ratings.ts";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  console.error("Run via: npm run calibration:report");
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } });

const argv = process.argv.slice(2);
function argValue(flag: string): string | null {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : null;
}
const csvPath = argValue("--csv");
const worstN = Number(argValue("--worst") ?? 15);

const PAGE = 1000;

// ── Load judgements ───────────────────────────────────────────────────────────

type Judgment = {
  match_id: string;
  player_id: string;
  role: string | null;
  position: string | null;
  attacking: number | null;
  defending: number | null;
  passing: number | null;
  consistency: number | null;
  gk: number | null;
  gk_gc: number | null;
  gk_saves: number | null;
  gk_catches: number | null;
  final: number | null;
  notes: string | null;
  skipped: boolean | null;
};

async function loadJudgments(): Promise<Judgment[]> {
  const out: Judgment[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await db
      .from("rating_judgments")
      .select("match_id,player_id,role,position,attacking,defending,passing,consistency,gk,gk_gc,gk_saves,gk_catches,final,notes,skipped")
      .range(from, from + PAGE - 1);
    if (error) {
      const missing =
        error.code === "42P01" ||
        error.code === "PGRST205" ||
        /relation .*rating_judgments.* does not exist|could not find the table/i.test(error.message);
      if (missing) {
        console.error("The rating_judgments table doesn't exist yet.");
        console.error("Run migrations/002_rating_judgments.sql in the Supabase SQL editor first.");
        process.exit(1);
      }
      console.error("Failed to load judgements:", error.message);
      process.exit(1);
    }
    if (!data || data.length === 0) break;
    out.push(...(data as Judgment[]));
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return out;
}

// ── Load the stat lines those judgements refer to ─────────────────────────────

const STAT_SELECT =
  "match_id,player_id,team_side,position,score,goals,assists,shots_on_target,key_passes,passes," +
  "tackles,key_tackles,interceptions,key_interceptions,possessions_lost,gk_saves,gk_catches," +
  "benched,stats_incomplete,players(handle,name)," +
  "matches(home_team,away_team,home_score,away_score,played_at)";

async function loadStats(matchIds: string[]): Promise<Map<string, any>> {
  const byKey = new Map<string, any>();
  const CHUNK = 100;
  for (let i = 0; i < matchIds.length; i += CHUNK) {
    const chunk = matchIds.slice(i, i + CHUNK);
    const { data, error } = await db
      .from("match_player_stats")
      .select(STAT_SELECT)
      .in("match_id", chunk);
    if (error) {
      console.error("Failed to load match_player_stats:", error.message);
      process.exit(1);
    }
    for (const s of (data ?? []) as any[]) byKey.set(`${s.match_id}:${s.player_id}`, s);
  }
  return byKey;
}

// ── Stats helpers ─────────────────────────────────────────────────────────────

type Pair = { formula: number; human: number };

function summarise(pairs: Pair[]) {
  const n = pairs.length;
  if (n === 0) return null;
  const diffs = pairs.map(p => p.formula - p.human);
  const bias = diffs.reduce((a, b) => a + b, 0) / n;
  const mae = diffs.reduce((a, b) => a + Math.abs(b), 0) / n;
  const rmse = Math.sqrt(diffs.reduce((a, b) => a + b * b, 0) / n);
  const sd = n > 1
    ? Math.sqrt(diffs.reduce((a, b) => a + (b - bias) ** 2, 0) / (n - 1))
    : 0;

  // Pearson correlation between the formula's view and yours.
  let r = NaN;
  if (n >= 3) {
    const mf = pairs.reduce((a, p) => a + p.formula, 0) / n;
    const mh = pairs.reduce((a, p) => a + p.human, 0) / n;
    let num = 0, df = 0, dh = 0;
    for (const p of pairs) {
      const a = p.formula - mf, b = p.human - mh;
      num += a * b; df += a * a; dh += b * b;
    }
    r = df > 0 && dh > 0 ? num / Math.sqrt(df * dh) : NaN;
  }
  return { n, bias, mae, rmse, sd, r };
}

function fmt(x: number, dp = 1): string {
  if (!Number.isFinite(x)) return "  —  ";
  const s = x.toFixed(dp);
  return x > 0 && dp > 0 ? `+${s}` : s;
}

function pad(s: string, w: number, right = false): string {
  return right ? s.padStart(w) : s.padEnd(w);
}

// ── Main ──────────────────────────────────────────────────────────────────────

const METRICS = ["final", "attacking", "defending", "passing", "consistency", "gk_gc", "gk_saves", "gk_catches"] as const;
type Metric = (typeof METRICS)[number];

type Row = {
  key: string;
  player: string;
  fixture: string;
  playedAt: string;
  position: string;
  role: string;
  result: MatchResult;
  values: Partial<Record<Metric, Pair>>;
};

async function main() {
  const allJudgments = await loadJudgments();
  const judged = allJudgments.filter(j => !j.skipped);
  const skipped = allJudgments.length - judged.length;

  if (judged.length === 0) {
    console.log("No judgements found in rating_judgments (skipped rows don't count).");
    console.log("Judge some performances at /admin/rating-calibration first.");
    return;
  }

  const matchIds = Array.from(new Set(judged.map(j => j.match_id)));
  const stats = await loadStats(matchIds);

  const rows: Row[] = [];
  const orphaned: string[] = [];

  for (const j of judged) {
    const key = `${j.match_id}:${j.player_id}`;
    const s = stats.get(key);
    if (!s) { orphaned.push(key); continue; }

    const m = Array.isArray(s.matches) ? s.matches[0] : s.matches;
    const p = Array.isArray(s.players) ? s.players[0] : s.players;
    if (!m || m.home_score == null || m.away_score == null) { orphaned.push(key); continue; }

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

    const b = calcMatchBreakdown(statRow, result, s.position);
    const gkParts = b.role === "GK" ? calcGkParts(statRow) : null;

    const formulaValue: Record<Metric, number | null> = {
      final: b.final,
      attacking: b.scores.attacking,
      defending: b.scores.defending,
      passing: b.scores.passing,
      consistency: b.scores.consistency,
      gk_gc: gkParts ? gkParts.gk_gc : null,
      gk_saves: gkParts ? gkParts.gk_saves : null,
      gk_catches: gkParts ? gkParts.gk_catches : null,
    };
    const humanValue: Record<Metric, number | null> = {
      final: j.final,
      attacking: j.attacking,
      defending: j.defending,
      passing: j.passing,
      consistency: j.consistency,
      gk_gc: j.gk_gc,
      gk_saves: j.gk_saves,
      gk_catches: j.gk_catches,
    };

    const values: Partial<Record<Metric, Pair>> = {};
    for (const metric of METRICS) {
      const f = formulaValue[metric];
      const h = humanValue[metric];
      if (typeof f === "number" && typeof h === "number") values[metric] = { formula: f, human: h };
    }

    rows.push({
      key,
      player: p?.name || p?.handle || "Unknown",
      fixture: `${m.home_team} ${m.home_score}-${m.away_score} ${m.away_team}`,
      playedAt: (m.played_at ?? "").slice(0, 10),
      position: s.position ?? "?",
      role: b.role,
      result,
      values,
    });
  }

  // ── Header ──
  const eligible = rows.filter(r => isRatingEligibleScore((stats.get(r.key)?.score) ?? 0)).length;
  console.log("");
  console.log("RATING CALIBRATION REPORT");
  console.log("=".repeat(78));
  console.log(`Judged performances : ${judged.length}${skipped ? `  (+${skipped} skipped, excluded)` : ""}`);
  console.log(`Matched to stats    : ${rows.length}${orphaned.length ? `  (${orphaned.length} orphaned, see below)` : ""}`);
  console.log(`Rating-eligible     : ${eligible}`);

  const byRole = new Map<string, Row[]>();
  for (const r of rows) {
    if (!byRole.has(r.role)) byRole.set(r.role, []);
    byRole.get(r.role)!.push(r);
  }
  const roleOrder = ["GK", "DEF", "MID", "FWD"].filter(r => byRole.has(r));
  console.log(`Per role            : ${roleOrder.map(r => `${r} ${byRole.get(r)!.length}`).join("   ")}`);
  console.log("");
  console.log("bias = formula minus you. Positive = the formula is too generous.");
  console.log("");

  // ── Per-role tables ──
  const W = [14, 5, 8, 7, 7, 7];
  const header =
    pad("metric", W[0]) + pad("n", W[1], true) + pad("bias", W[2], true) +
    pad("MAE", W[3], true) + pad("RMSE", W[4], true) + pad("r", W[5], true);

  for (const role of roleOrder) {
    const roleRows = byRole.get(role)!;
    console.log(`── ${role}  (n=${roleRows.length}) ${"─".repeat(Math.max(0, 60 - role.length))}`);
    console.log(header);
    for (const metric of METRICS) {
      const pairs = roleRows.map(r => r.values[metric]).filter((v): v is Pair => !!v);
      const st = summarise(pairs);
      if (!st) continue;
      console.log(
        pad(metric, W[0]) +
        pad(String(st.n), W[1], true) +
        pad(fmt(st.bias), W[2], true) +
        pad(st.mae.toFixed(1), W[3], true) +
        pad(st.rmse.toFixed(1), W[4], true) +
        pad(Number.isFinite(st.r) ? st.r.toFixed(2) : "—", W[5], true)
      );
    }
    console.log("");
  }

  // ── Overall ──
  console.log(`── ALL ROLES  (n=${rows.length}) ${"─".repeat(50)}`);
  console.log(header);
  for (const metric of METRICS) {
    const pairs = rows.map(r => r.values[metric]).filter((v): v is Pair => !!v);
    const st = summarise(pairs);
    if (!st) continue;
    console.log(
      pad(metric, W[0]) +
      pad(String(st.n), W[1], true) +
      pad(fmt(st.bias), W[2], true) +
      pad(st.mae.toFixed(1), W[3], true) +
      pad(st.rmse.toFixed(1), W[4], true) +
      pad(Number.isFinite(st.r) ? st.r.toFixed(2) : "—", W[5], true)
    );
  }
  console.log("");

  // ── Worst disagreements on the overall rating ──
  const withFinal = rows
    .filter(r => r.values.final)
    .sort((a, b) => Math.abs(b.values.final!.formula - b.values.final!.human) - Math.abs(a.values.final!.formula - a.values.final!.human))
    .slice(0, worstN);

  if (withFinal.length) {
    console.log(`── BIGGEST DISAGREEMENTS ON FINAL  (top ${withFinal.length}) ${"─".repeat(28)}`);
    console.log(
      pad("player", 18) + pad("pos", 5) + pad("res", 4) +
      pad("you", 6, true) + pad("formula", 9, true) + pad("diff", 7, true) + "  fixture"
    );
    for (const r of withFinal) {
      const v = r.values.final!;
      console.log(
        pad(r.player.slice(0, 17), 18) + pad(r.position, 5) + pad(r.result, 4) +
        pad(v.human.toFixed(0), 6, true) + pad(v.formula.toFixed(0), 9, true) +
        pad(fmt(v.formula - v.human, 0), 7, true) + "  " + r.fixture.slice(0, 44)
      );
    }
    console.log("");
  }

  // ── Sample-size warning ──
  const thin = roleOrder.filter(r => byRole.get(r)!.length < 25);
  if (thin.length) {
    console.log("NOTE: " + thin.map(r => `${r} (n=${byRole.get(r)!.length})`).join(", ") +
      " — too few to trust for anything beyond spotting a consistent bias.");
    console.log("      Aim for ~40 per role before changing thresholds, caps or divisors.");
    console.log("");
  }

  if (orphaned.length) {
    console.log(`NOTE: ${orphaned.length} judgement(s) have no matching stat line (deleted or re-imported match).`);
    console.log("");
  }

  // ── Optional CSV of the raw comparison ──
  if (csvPath) {
    const { writeFileSync } = await import("node:fs");
    const cols = ["player", "played_at", "fixture", "position", "role", "result"];
    const head = [...cols, ...METRICS.flatMap(m => [`${m}_you`, `${m}_formula`, `${m}_diff`])].join(",");
    const esc = (s: string) => `"${String(s).replace(/"/g, '""')}"`;
    const lines = rows.map(r => {
      const base = [r.player, r.playedAt, r.fixture, r.position, r.role, r.result].map(esc);
      const vals = METRICS.flatMap(m => {
        const v = r.values[m];
        return v ? [v.human.toFixed(2), v.formula.toFixed(2), (v.formula - v.human).toFixed(2)] : ["", "", ""];
      });
      return [...base, ...vals].join(",");
    });
    writeFileSync(csvPath, [head, ...lines].join("\n") + "\n");
    console.log(`Wrote per-performance comparison to ${csvPath}`);
    console.log("");
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
