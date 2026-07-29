/**
 * Proves the freeze actually holds.
 *
 * The whole point of the frozen columns is that changing the formula must not move
 * a rating that has already been given. This test simulates a formula change by
 * feeding wildly different stat inputs through the resolver and asserting that
 * frozen rows do not budge, while unrated rows do.
 *
 * Run: npm run test:freeze
 */

import {
  resolveMatchRating,
  computeFreezeValues,
  calcMatchRating,
  RATING_FORMULA_VERSION,
  type MatchStatRow,
  type MatchResult,
} from "../src/lib/ratings.ts";

let passed = 0;
let failed = 0;

function check(name: string, cond: boolean, detail = "") {
  if (cond) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.log(`  FAIL  ${name}${detail ? `\n          ${detail}` : ""}`); }
}

function stat(over: Partial<MatchStatRow> = {}): MatchStatRow {
  return {
    goals: 1, assists: 1, key_passes: 2, shots_on_target: 3, passes: 20,
    tackles: 3, key_tackles: 1, interceptions: 2, key_interceptions: 1,
    possessions_lost: 8, gk_saves: 0, gk_catches: 0, goals_conceded: 2,
    score: 420, position: "CM",
    ...over,
  };
}

console.log("\nRating freeze\n");

// ── A frozen rating is returned verbatim, whatever the stats now say ──────────
{
  const frozenRow = { rating: 73, rating_version: 1, rating_breakdown: null };
  const wildlyDifferent = stat({ goals: 9, assists: 9, passes: 200, score: 690 });
  const { rating, frozen } = resolveMatchRating(frozenRow, wildlyDifferent, "W", "CM");

  check("frozen rating ignores the current formula", rating === 73, `got ${rating}, expected 73`);
  check("frozen rating is flagged as frozen", frozen === true);

  const live = calcMatchRating(wildlyDifferent, "W", "CM");
  check("…and the live formula genuinely disagrees", live !== 73, `live=${live}`);
}

// ── A frozen NULL means permanently excluded, not "recompute me" ──────────────
{
  const frozenExcluded = { rating: null, rating_version: 1, rating_breakdown: null };
  // Give it a perfectly valid score: the old exclusion must still win.
  const { rating, frozen } = resolveMatchRating(frozenExcluded, stat({ score: 500 }), "W", "CM");
  check("frozen NULL stays excluded even with a valid score", rating === null, `got ${rating}`);
  check("frozen NULL is flagged as frozen", frozen === true);
}

// ── Unrated rows still follow the current formula ────────────────────────────
{
  const unrated = { rating: null, rating_version: null, rating_breakdown: null };
  const s = stat();
  const { rating, frozen } = resolveMatchRating(unrated, s, "W", "CM");
  check("unrated row uses the live formula", rating === calcMatchRating(s, "W", "CM"));
  check("unrated row is not flagged frozen", frozen === false);
}

// ── A score of 0 is never rated ──────────────────────────────────────────────
{
  const unrated = { rating: null, rating_version: null, rating_breakdown: null };
  const { rating } = resolveMatchRating(unrated, stat({ score: 0 }), "W", "CM");
  check("score of 0 yields no rating", rating === null, `got ${rating}`);

  const freeze = computeFreezeValues(stat({ score: 0 }), "W", "CM");
  check("freezing a score-0 row records the exclusion permanently",
    freeze.rating === null && freeze.rating_version === RATING_FORMULA_VERSION);
}

// ── Junk scores (1..60) are excluded too ─────────────────────────────────────
{
  const unrated = { rating: null, rating_version: null, rating_breakdown: null };
  const at60 = resolveMatchRating(unrated, stat({ score: 60 }), "W", "CM").rating;
  const at61 = resolveMatchRating(unrated, stat({ score: 61 }), "W", "CM").rating;
  check("score of 60 is excluded", at60 === null, `got ${at60}`);
  check("score of 61 is rated", at61 !== null);
}

// ── The freeze round-trips: what we store is what we later read back ─────────
{
  const s = stat({ goals: 3, score: 512 });
  const freeze = computeFreezeValues(s, "W", "FWD");
  const readBack = resolveMatchRating(
    { rating: freeze.rating, rating_version: freeze.rating_version, rating_breakdown: freeze.rating_breakdown },
    s, "W", "FWD"
  );
  check("freeze round-trips exactly", readBack.rating === freeze.rating);
  check("stored breakdown agrees with the stored rating",
    readBack.breakdown?.final === freeze.rating,
    `breakdown.final=${readBack.breakdown?.final} rating=${freeze.rating}`);
}

// ── Simulated formula change across a whole squad ────────────────────────────
{
  const squad = Array.from({ length: 40 }, (_, i) =>
    stat({ goals: i % 4, assists: i % 3, passes: 10 + i, score: 300 + i * 8, position: ["GK", "CB", "CM", "ST"][i % 4] })
  );

  // Freeze everyone under today's formula.
  const frozenRows = squad.map(s => {
    const f = computeFreezeValues(s, "W", s.position);
    return { rating: f.rating, rating_version: f.rating_version, rating_breakdown: f.rating_breakdown };
  });
  const before = frozenRows.map(r => r.rating);

  // Now pretend the formula changed by resolving against mutated stats — a proxy
  // for new thresholds/weights producing different numbers.
  const after = squad.map((s, i) =>
    resolveMatchRating(frozenRows[i], { ...s, goals: s.goals + 5, passes: s.passes * 3 }, "W", s.position).rating
  );

  check("no frozen rating moved after a formula change",
    JSON.stringify(before) === JSON.stringify(after),
    `${before.filter((b, i) => b !== after[i]).length} of ${before.length} changed`);
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
