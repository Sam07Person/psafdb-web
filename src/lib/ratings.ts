// ── Rating System ────────────────────────────────────────────────────────────
// Calculates 0–100 overall player ratings from match stats, results, and league tier.

export type PositionRole = "GK" | "DEF" | "MID" | "FWD";

export const POSITION_ROLE: Record<string, PositionRole> = {
  GK: "GK",
  LB: "DEF", RB: "DEF", CB: "DEF", LCB: "DEF", RCB: "DEF", LWB: "DEF", RWB: "DEF",
  CM: "MID", LM: "MID", RM: "MID",
  LW: "FWD", RW: "FWD", LF: "FWD", RF: "FWD", CF: "FWD", ST: "FWD",
};

export function getPositionRole(position: string | null | undefined): PositionRole {
  if (!position) return "MID";
  return POSITION_ROLE[position.toUpperCase().trim()] ?? "MID";
}

type PositionWeights = {
  attacking: number;
  defending: number;
  passing: number;
  consistency: number;
  gk: number;
};

export function getPositionWeights(role: PositionRole): PositionWeights {
  switch (role) {
    case "GK":  return { attacking: 0.00, defending: 0.05, passing: 0.05, consistency: 0.11, gk: 0.79 };
    case "DEF": return { attacking: 0.11,  defending: 0.64,  passing: 0.15, consistency: 0.10, gk: 0.00 };
    case "MID": return { attacking: 0.35, defending: 0.30, passing: 0.25, consistency: 0.10, gk: 0.00 };
    case "FWD": return { attacking: 0.65, defending: 0.10, passing: 0.15, consistency: 0.10, gk: 0.00 };
  }
}

export type MatchStatRow = {
  goals: number;
  assists: number;
  key_passes: number;
  shots_on_target: number;
  passes: number;
  tackles: number;
  key_tackles: number;
  interceptions: number;
  key_interceptions: number;
  possessions_lost: number;
  gk_saves: number;
  gk_catches: number;
  goals_conceded?: number; // goals let in — used by GK scoring and DEF adjustment
  score: number; // game-generated 0–10 match score
  position: string | null;
};

export type MatchResult = "W" | "D" | "L";

// ── Rating eligibility ────────────────────────────────────────────────────────
// A match only counts toward a player's rating if it has a genuine recorded
// game score. Scores are on the game's 0–700 scale.
//   score === 0  → player did not really participate / no score recorded → EXCLUDE
//   1 ≤ score ≤ 60 → junk/partial data → EXCLUDE
//   score > 60   → valid → INCLUDE
export const MIN_RATING_SCORE = 60;

export function isRatingEligibleScore(score: number | null | undefined): boolean {
  return (score ?? 0) > MIN_RATING_SCORE;
}

export type SubRatings = {
  attacking: number;
  defending: number;
  passing: number;
  consistency: number;
  gk: number;
};

// ── Sub-rating calculators (single match, raw stats) ─────────────────────────

function attackingScore(s: MatchStatRow, role: PositionRole): number {
  // Position-specific thresholds (≈1.6× position avg → 100%)
  // Calibrated from real data — FWD: goals≈1.4, assists≈0.6, SoT≈2.53
  //                              MID: goals≈0.90, assists≈0.90, SoT≈1.70
  //                              DEF: goals≈0.05, assists≈0.175, SoT≈0.25
  const gThresh   = role === "FWD" ? 2.24 : role === "MID" ? 1.5  : 0.08;
  const aThresh   = role === "FWD" ? 0.96 : role === "MID" ? 1.5  : 0.30;
  const sotThresh = role === "FWD" ? 4.0  : role === "MID" ? 2.7  : 0.40;
  const aMax      = role === "MID" ? 55 : 25;
  const kpMax     = role === "MID" ? 15 : 20;

  // FWD: include conversion rate (goals / SoT). 50% conversion → max pts.
  // Weights adjusted to keep total at 100: goals 44, assists 16, kp 10, SoT 10, conv 20.
  // 3 goals + 5 SoT + 0 assists → ~74 attacking (goals are the primary metric for attackers).
  if (role === "FWD") {
    const convRate = s.shots_on_target > 0 ? s.goals / s.shots_on_target : 0;
    return (
      Math.min(44, (s.goals / gThresh) * 44) +
      Math.min(16, (s.assists / aThresh) * 16) +
      Math.min(10, (s.key_passes / 3.0) * 10) +
      Math.min(10, (s.shots_on_target / sotThresh) * 10) +
      Math.min(20, (convRate / 0.5) * 20)
    );
  }

  return (
    Math.min(40, (s.goals / gThresh) * 40) +
    Math.min(aMax, (s.assists / aThresh) * aMax) +
    Math.min(kpMax, (s.key_passes / 3.0) * kpMax) +
    Math.min(15, (s.shots_on_target / sotThresh) * 15)
  );
}

function defendingScore(s: MatchStatRow, role: PositionRole): number {
  // Key tackles get a separate bonus so they count even when the combined bucket is capped.
  // Calibrated: avg key_tackles≈0.87 → ~2 bonus pts; 4 key_tackles → capped at +4.
  const plDiv = role === "MID" ? 40.0 : 28.0;
  const intMax = 28;
  const intDiv = role === "FWD" ? 4.2 : 2.3;
  const base =
    Math.min(50, ((s.tackles + s.key_tackles) / 6.0) * 50) +
    Math.min(intMax, ((s.interceptions + s.key_interceptions) / intDiv) * intMax) +
    Math.min(15, Math.max(0, 1 - s.possessions_lost / plDiv) * 15) +
    Math.min(10, (s.key_tackles / 1.75) * 10);
  // Small GC adjustment for DEF: avg GC≈4.3 → neutral; clean sheet → +8; high GC → -5
  if (role === "DEF" && s.goals_conceded != null) {
    const gcAdj = Math.max(-5, Math.min(8, (1 - s.goals_conceded / 4.3) * 8));
    return Math.max(0, base + gcAdj);
  }
  return base;
}

function passingScore(s: MatchStatRow, role: PositionRole): number {
  // Position-aware caps: cap at → 100 pts, position avg → ~60–65
  // Calibrated: FWD passes≈11.0/kp≈1.4 | MID≈16.7/kp≈1.2 | DEF≈11.75/kp≈0.5 | GK≈11.5/kp≈0.24
  const pCap  = role === "MID" ? 27.0 : role === "GK" ? 23.0 : role === "DEF" ? 23.5 : 22.1;
  const kpCap = role === "MID" ? 1.56 : role === "GK" ? 0.48 : role === "DEF" ? 1.0  : 2.84;
  // FWD/DEF/GK: passing volume is primary; key passes are a bonus not a penalty
  const pW = role === "MID" ? 72 : 80;
  const kW = role === "MID" ? 28 : role === "FWD" ? 20 : 20;
  return Math.min(pW, (s.passes / pCap) * pW) + Math.min(kW, (s.key_passes / kpCap) * kW);
}

// Calibrated: avg goals_conceded≈4.6, avg saves≈4.2, avg catches≈2.0 → average GK scores ~60
// Effective weights (% of final rating): GC≈30%, saves≈30%, catches≈19%, consistency≈11%
// At averages: 0.5*45.5 + (4.2/8.0)*43.5 + 0.5*29.0 = 22.75 + 22.84 + 14.5 = 60
// Sub-components are uncapped — exceptional saves can push gkScore above 100.
// Final match rating is capped at 100 in calcMatchBreakdown.
function gkScore(s: MatchStatRow): number {
  const gc = s.goals_conceded ?? 0;
  // Save efficiency: reward saves > gc (×50), penalise saves < gc (×30).
  // Positive cap +12 reached at ~79%. Negative cap -12 reached at ~15%.
  const totalFaced = s.gk_saves + gc;
  const saveEfficiency = totalFaced > 0
    ? (() => { const d = (s.gk_saves / totalFaced) - 0.55; return Math.min(12, Math.max(-12, d * (d >= 0 ? 50 : 30))); })()
    : 0;
  return (
    Math.max(0, (1 - gc / 9.2) * 45.50) +
    (s.gk_saves / 8.00) * 43.50 +
    Math.min(43.50, (s.gk_catches / 4.00) * 29.00) +
    saveEfficiency
  );
}

// ── Game-score normalizer (position-aware) ────────────────────────────────────
// Calibrated from real data: FWD avg≈449, MID avg≈390, DEF avg≈340, GK avg≈500
// Divisors chosen so position-average score maps to ~50.
function normalizeGameScore(rawScore: number, role: PositionRole): number {
  if (rawScore <= 0) return 0;
  // Scores are on the game's 0–700 scale — use position-specific divisor
  const divisor = role === "FWD" ? 9.0 : role === "MID" ? 7.8 : role === "GK" ? 10.0 : 6.8;
  return rawScore / divisor;
}

// ── Career sub-ratings from all matches ──────────────────────────────────────

export function calcSubRatings(
  stats: MatchStatRow[],
  results: MatchResult[],
  dominantPosition?: string | null
): SubRatings {
  // Only matches with a valid recorded game score (> 60) count toward the rating.
  // A score of 0 means the player didn't really play — it must never be rated.
  const filtered = stats.reduce<{ s: MatchStatRow; r: MatchResult }[]>((acc, s, i) => {
    if (isRatingEligibleScore(s.score)) acc.push({ s, r: results[i] });
    return acc;
  }, []);
  const effectiveStats = filtered.map(x => x.s);
  const effectiveResults = filtered.map(x => x.r);

  if (effectiveStats.length === 0) {
    return { attacking: 0, defending: 0, passing: 0, consistency: 0, gk: 0 };
  }

  const n = effectiveStats.length;
  const role = getPositionRole(dominantPosition);

  // Per-match averages
  const avg = (fn: (s: MatchStatRow) => number) =>
    effectiveStats.reduce((sum, s) => sum + fn(s), 0) / n;

  const avgGoals = avg(s => s.goals);
  const avgAssists = avg(s => s.assists);
  const avgKP = avg(s => s.key_passes);
  const avgSOT = avg(s => s.shots_on_target);
  const avgPasses = avg(s => s.passes);
  const avgTackles = avg(s => s.tackles + s.key_tackles);
  const avgKeyTackles = avg(s => s.key_tackles);
  const avgInt = avg(s => s.interceptions + s.key_interceptions);
  const avgPL = avg(s => s.possessions_lost);
  const avgSaves = avg(s => s.gk_saves);
  const avgCatches = avg(s => s.gk_catches);
  const scoredStats = effectiveStats.filter(s => isRatingEligibleScore(s.score));
  const avgGameScore = scoredStats.length > 0
    ? scoredStats.reduce((sum, s) => sum + s.score, 0) / scoredStats.length
    : 0;
  const avgGC = avg(s => s.goals_conceded ?? 0);

  // Position-specific attacking thresholds (same as attackingScore)
  const gThresh   = role === "FWD" ? 2.24 : role === "MID" ? 1.5  : 0.08;
  const aThresh   = role === "FWD" ? 0.96 : role === "MID" ? 1.5  : 0.30;
  const sotThresh = role === "FWD" ? 4.0  : role === "MID" ? 2.7  : 0.40;
  const aMax      = role === "MID" ? 55 : 25;
  const kpMax     = role === "MID" ? 15 : 20;

  // FWD: fold conversion rate into attacking sub-rating
  const attacking = Math.min(100, role === "FWD" ? (() => {
    const convRate = avgSOT > 0 ? avgGoals / avgSOT : 0;
    return (
      Math.min(44, (avgGoals / gThresh) * 44) +
      Math.min(16, (avgAssists / aThresh) * 16) +
      Math.min(10, (avgKP / 3.0) * 10) +
      Math.min(10, (avgSOT / sotThresh) * 10) +
      Math.min(20, (convRate / 0.5) * 20)
    );
  })() :
    Math.min(40, (avgGoals / gThresh) * 40) +
    Math.min(aMax, (avgAssists / aThresh) * aMax) +
    Math.min(kpMax, (avgKP / 3.0) * kpMax) +
    Math.min(15, (avgSOT / sotThresh) * 15)
  );

  const gcAdj = role === "DEF" ? Math.max(-5, Math.min(8, (1 - avgGC / 4.3) * 8)) : 0;
  const plDiv = role === "MID" ? 40.0 : 28.0;
  const intMax = 28;
  const intDiv = role === "FWD" ? 4.2 : 2.3;
  const defending = Math.min(100, Math.max(0,
    Math.min(50, (avgTackles / 6.0) * 50) +
    Math.min(intMax, (avgInt / intDiv) * intMax) +
    Math.min(15, Math.max(0, 1 - avgPL / plDiv) * 15) +
    Math.min(10, (avgKeyTackles / 1.75) * 10) +
    gcAdj
  ));

  const pCap  = role === "MID" ? 27.0 : role === "GK" ? 23.0 : role === "DEF" ? 23.5 : 22.1;
  const kpCap = role === "MID" ? 1.56 : role === "GK" ? 0.48 : role === "DEF" ? 1.0  : 2.84;
  const pW = role === "MID" ? 72 : 80;
  const kW = role === "MID" ? 28 : role === "FWD" ? 20 : 20;
  const passing = Math.min(pW, (avgPasses / pCap) * pW) + Math.min(kW, (avgKP / kpCap) * kW);

  const wins = effectiveResults.filter(r => r === "W").length;
  const draws = effectiveResults.filter(r => r === "D").length;
  const total = effectiveResults.length;

  let consistency: number;
  if (avgGameScore > 0) {
    consistency = normalizeGameScore(avgGameScore, role);
  } else {
    const winRate = total > 0 ? wins / total : 0;
    const drawRate = total > 0 ? draws / total : 0;
    consistency = Math.min(100, winRate * 70 + drawRate * 20 + 10);
  }

  const gk = Math.min(100,
    Math.min(65, (avgSaves / 7.0) * 65) +
    Math.min(35, (avgCatches / 4.0) * 35)
  );

  return { attacking, defending, passing, consistency, gk };
}

// ── Per-match breakdown + rating (0–100) ─────────────────────────────────────

export type MatchBreakdown = {
  role: PositionRole;
  weights: { attacking: number; defending: number; passing: number; consistency: number; gk: number };
  scores: { attacking: number; defending: number; passing: number; consistency: number; gk: number };
  base: number;
  resultBonus: number;
  final: number;
};

export function calcMatchBreakdown(
  stat: MatchStatRow,
  result: MatchResult,
  position: string | null | undefined
): MatchBreakdown {
  // Only override to GK for players with no known position (e.g. subs) who have GK stats.
  // Outfield players with incidental GK stats (e.g. 1 catch) keep their outfield role.
  const baseRole = getPositionRole(position);
  const role = baseRole === "MID" && !position && (stat.gk_saves > 0 || stat.gk_catches > 0)
    ? "GK" as PositionRole
    : baseRole;
  const w = getPositionWeights(role);

  const consScore = isRatingEligibleScore(stat.score)
    ? normalizeGameScore(stat.score, role)
    : result === "W" ? 70 : result === "D" ? 40 : 15;

  const scores = {
    attacking: attackingScore(stat, role),
    defending: defendingScore(stat, role),
    passing: passingScore(stat, role),
    consistency: consScore,
    gk: gkScore(stat),
  };

  const base =
    scores.attacking * w.attacking +
    scores.defending * w.defending +
    scores.passing * w.passing +
    scores.consistency * w.consistency +
    scores.gk * w.gk;

  const resultBonus = result === "W" ? 5 : result === "D" ? 2 : 0;

  return {
    role,
    weights: w,
    scores,
    base,
    resultBonus,
    final: Math.round(Math.min(100, Math.max(0, base + resultBonus))),
  };
}

export function calcMatchRating(
  stat: MatchStatRow,
  result: MatchResult,
  position: string | null | undefined
): number {
  return calcMatchBreakdown(stat, result, position).final;
}

// ── Frozen ratings ────────────────────────────────────────────────────────────
// Bump this whenever the formula changes. Rows already carrying a rating_version
// keep the rating they were given and are NEVER recomputed, so a formula change
// can only ever affect matches that have not been rated yet.
export const RATING_FORMULA_VERSION = 1;

/** The persisted rating columns on a match_player_stats row. */
export type FrozenRatingFields = {
  rating?: number | null;
  rating_version?: number | null;
  rating_breakdown?: MatchBreakdown | null;
};

/**
 * Single source of truth for "what is this player's rating for this match".
 *
 * A row that has been frozen (rating_version set) returns its stored rating
 * verbatim — including a stored NULL, which means the match was deliberately
 * excluded and must stay excluded. Only never-rated rows fall through to the
 * live formula.
 *
 * Every rating call site in the app must go through this, otherwise a page can
 * quietly disagree with the frozen history.
 */
export function resolveMatchRating(
  row: FrozenRatingFields,
  stat: MatchStatRow,
  result: MatchResult,
  position: string | null | undefined
): { rating: number | null; breakdown: MatchBreakdown | null; frozen: boolean } {
  if (row.rating_version != null) {
    return {
      rating: row.rating ?? null,
      breakdown: row.rating_breakdown ?? null,
      frozen: true,
    };
  }
  if (!isRatingEligibleScore(stat.score)) {
    return { rating: null, breakdown: null, frozen: false };
  }
  const breakdown = calcMatchBreakdown(stat, result, position);
  return { rating: breakdown.final, breakdown, frozen: false };
}

/**
 * What a freeze should write for a row. Returns rating: null for matches that
 * must not be rated, so the exclusion is recorded permanently rather than being
 * re-evaluated by whatever the formula happens to say later.
 */
export function computeFreezeValues(
  stat: MatchStatRow,
  result: MatchResult,
  position: string | null | undefined
): { rating: number | null; rating_version: number; rating_breakdown: MatchBreakdown | null } {
  if (!isRatingEligibleScore(stat.score)) {
    return { rating: null, rating_version: RATING_FORMULA_VERSION, rating_breakdown: null };
  }
  const breakdown = calcMatchBreakdown(stat, result, position);
  return {
    rating: breakdown.final,
    rating_version: RATING_FORMULA_VERSION,
    rating_breakdown: breakdown,
  };
}

// ── Overall rating: average of per-match ratings + tier adjustment ────────────

// Default tier bonuses — overridden at runtime by values from tier_settings table.
export const DEFAULT_TIER_BONUSES: Record<number, number> = { 1: 5, 2: 0, 3: -5 };

export function calcOverallRating(
  matchRatings: number[],
  leagueTier: number = 2,
  tierBonuses: Record<number, number> = DEFAULT_TIER_BONUSES
): number {
  if (matchRatings.length === 0) return 0;
  const avg = matchRatings.reduce((sum, r) => sum + r, 0) / matchRatings.length;
  const tierBonus = tierBonuses[leagueTier] ?? 0;
  return Math.round(Math.min(100, Math.max(0, avg + tierBonus)));
}

// ── Display helpers ───────────────────────────────────────────────────────────

export function getRatingColor(rating: number): string {
  if (rating >= 80) return "#22c55e"; // green
  if (rating >= 70) return "#84cc16"; // lime
  if (rating >= 60) return "#eab308"; // yellow
  if (rating >= 50) return "#f97316"; // orange
  return "#ef4444";                   // red
}

export function getRatingLabel(rating: number): string {
  if (rating >= 80) return "Elite";
  if (rating >= 70) return "Great";
  if (rating >= 60) return "Good";
  if (rating >= 50) return "Average";
  return "Poor";
}

export function getMatchRatingColor(rating: number): string {
  return getRatingColor(rating);
}
