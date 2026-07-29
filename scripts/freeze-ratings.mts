/**
 * Freeze every existing player match rating.
 *
 * Ratings have always been recomputed from raw stats on each render, so any change
 * to the formula silently rewrote all history. This script snapshots the CURRENT
 * formula's output into match_player_stats.rating / rating_version, after which
 * those rows are permanently immune to formula changes.
 *
 * Run migrations/001_freeze_ratings.sql FIRST.
 *
 * Usage:
 *   npm run freeze:ratings:dry     # report only, writes nothing
 *   npm run freeze:ratings         # perform the freeze
 *
 * Safe to re-run: only rows where rating_version IS NULL are considered, every
 * write re-asserts that condition, and the DB trigger rejects any attempt to
 * alter an already-frozen rating.
 */

import { createClient } from "@supabase/supabase-js";
import {
  computeFreezeValues,
  RATING_FORMULA_VERSION,
  type MatchStatRow,
  type MatchResult,
} from "../src/lib/ratings.ts";

const DRY_RUN = process.argv.includes("--dry-run");
const PAGE = 1000;

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  console.error("Run via: npm run freeze:ratings");
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } });

const SELECT =
  "match_id,player_id,team_side,position,score,goals,assists,shots_on_target,key_passes,passes," +
  "tackles,key_tackles,interceptions,key_interceptions,possessions_lost,gk_saves,gk_catches," +
  "benched,stats_incomplete,rating,rating_version," +
  "matches(home_score,away_score)";

console.log(DRY_RUN ? "DRY RUN — nothing will be written\n" : "Freezing ratings…\n");
console.log(`Formula version: ${RATING_FORMULA_VERSION}\n`);

let offset = 0;
let scanned = 0, frozenCount = 0, rated = 0, excluded = 0, skipped = 0, written = 0;
const histogram = new Map<string, number>();

while (true) {
  const { data: rows, error } = await db
    .from("match_player_stats")
    .select(SELECT)
    .is("rating_version", null)
    .order("match_id", { ascending: true })
    .order("player_id", { ascending: true })
    .range(offset, offset + PAGE - 1);

  if (error) { console.error("Fetch failed:", error.message); process.exit(1); }
  if (!rows || rows.length === 0) break;

  let skippedThisPage = 0;

  for (const s of rows as any[]) {
    scanned++;
    const m = Array.isArray(s.matches) ? s.matches[0] : s.matches;

    // Rows that were never really played, or whose match has no result yet, are
    // left unfrozen so they can be rated once their data is complete.
    if (!m || m.home_score == null || m.away_score == null || s.benched || s.stats_incomplete) {
      skipped++;
      skippedThisPage++;
      continue;
    }

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

    const frozen = computeFreezeValues(statRow, result, s.position);
    frozenCount++;
    if (frozen.rating === null) {
      excluded++;
    } else {
      rated++;
      const lo = Math.floor(frozen.rating / 10) * 10;
      const bucket = `${lo}-${lo + 9}`;
      histogram.set(bucket, (histogram.get(bucket) ?? 0) + 1);
    }

    if (!DRY_RUN) {
      const { error: upErr } = await db
        .from("match_player_stats")
        .update({
          rating: frozen.rating,
          rating_version: frozen.rating_version,
          rating_breakdown: frozen.rating_breakdown,
        })
        .eq("match_id", s.match_id)
        .eq("player_id", s.player_id)
        .is("rating_version", null); // never touch an already-frozen row

      if (upErr) {
        console.error(`\nFailed on ${s.match_id}/${s.player_id}:`, upErr.message);
        process.exit(1);
      }
      written++;
    }
  }

  process.stdout.write(`\r  scanned ${scanned}…`);

  // Frozen rows drop out of the `rating_version is null` filter, so the window
  // does not need to advance past them — but skipped rows stay in it forever.
  // Advancing by exactly the skipped count is what stops this looping.
  offset += DRY_RUN ? rows.length : skippedThisPage;

  if (rows.length < PAGE) break;
}

console.log("\n");
console.log(`Scanned:  ${scanned}`);
console.log(`  skipped (benched / incomplete / no result yet): ${skipped}`);
console.log(`  frozen:  ${frozenCount}`);
console.log(`    with a rating: ${rated}`);
console.log(`    excluded, stored as NULL (e.g. game score of 0): ${excluded}`);
if (!DRY_RUN) console.log(`Rows written: ${written}`);

if (histogram.size > 0) {
  console.log("\nRating distribution:");
  const scale = Math.max(1, rated / 40);
  for (const b of [...histogram.keys()].sort((a, z) => parseInt(a) - parseInt(z))) {
    const n = histogram.get(b)!;
    console.log(`  ${b.padStart(6)}  ${"#".repeat(Math.ceil(n / scale))} ${n}`);
  }
}

console.log(
  DRY_RUN
    ? "\nDry run complete. Re-run without --dry-run to write."
    : "\nDone. These ratings are frozen — no formula change will alter them."
);
