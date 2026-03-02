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
    case "GK":  return { attacking: 0.00, defending: 0.10, passing: 0.05, consistency: 0.10, gk: 0.75 };
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
  const aMax      = role === "MID" ? 42 : 25;
  const kpMax     = role === "MID" ? 15 : 20;
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
  const base =
    Math.min(50, ((s.tackles + s.key_tackles) / 6.0) * 50) +
    Math.min(28, ((s.interceptions + s.key_interceptions) / 4.5) * 28) +
    Math.min(15, Math.max(0, 1 - s.possessions_lost / 28.0) * 15) +
    Math.min(10, (s.key_tackles / 1.75) * 10);
  // Small GC adjustment for DEF: avg GC≈4.3 → neutral; clean sheet → +8; high GC → -5
  if (role === "DEF" && s.goals_conceded != null) {
    const gcAdj = Math.max(-5, Math.min(8, (1 - s.goals_conceded / 4.3) * 8));
    return Math.max(0, base + gcAdj);
  }
  return base;
}

function passingScore(s: MatchStatRow, role: PositionRole): number {
  // Position-aware caps: 2× real-world avg → 100, position avg → ~50
  // Calibrated: FWD passes≈11.0/kp≈1.4 | MID≈16.7/kp≈1.2 | DEF≈11.75/kp≈0.5 | GK≈11.5/kp≈0.24
  const pCap  = role === "MID" ? 32.0 : role === "GK" ? 23.0 : role === "DEF" ? 23.5 : 22.1;
  const kpCap = role === "MID" ? 1.56 : role === "GK" ? 0.48 : role === "DEF" ? 1.0  : 2.84;
  // DEF/GK: passing is mostly about volume, not creativity — reduce key passes weight
  const pW = role === "FWD" ? 65 : 80;
  const kW = role === "FWD" ? 35 : role === "MID" ? 28 : 20;
  return Math.min(pW, (s.passes / pCap) * pW) + Math.min(kW, (s.key_passes / kpCap) * kW);
}

// Calibrated: avg goals_conceded≈4.3, avg saves≈4.2, avg catches≈2.0 → average GK scores ~60
// Effective weights: GC 34%, saves 29%, catches 12% (sum = 75% = gk position weight)
// Internal pts scaled ×1.2 so avg → 60: GC=54.40, saves=46.40, catches=19.20 (soft targets, no hard cap)
// At averages: (1 - 4.3/8.6)*54.4 + (4.2/8.4)*46.4 + (2.0/4.0)*19.2 = 27.2 + 23.2 + 9.6 = 60
// Sub-components are uncapped — exceptional stats can push gkScore above 100.
// Final match rating is capped at 100 in calcMatchBreakdown.
function gkScore(s: MatchStatRow): number {
  const gc = s.goals_conceded ?? 0;
  return (
    Math.max(0, (1 - gc / 8.6) * 54.40) +
    (s.gk_saves / 8.40) * 46.40 +
    (s.gk_catches / 4.00) * 19.20
  );
}

// ── Game-score normalizer (position-aware) ────────────────────────────────────
// Calibrated from real data: FWD avg≈449, MID avg≈410, DEF avg≈340, GK avg≈550
// Divisors chosen so position-average score maps to ~50.
function normalizeGameScore(rawScore: number, role: PositionRole): number {
  if (rawScore <= 0) return 0;
  if (rawScore > 100) {
    // Scores are on the game's 0–700 scale — use position-specific divisor
    const divisor = role === "FWD" ? 9.0 : role === "MID" ? 8.2 : role === "GK" ? 11.0 : 6.8;
    return rawScore / divisor;
  }
  // Legacy: 0–100 (direct) or 0–10 (×10)
  return rawScore > 10 ? rawScore : rawScore * 10;
}

// ── Career sub-ratings from all matches ──────────────────────────────────────

export function calcSubRatings(
  stats: MatchStatRow[],
  results: MatchResult[],
  dominantPosition?: string | null
): SubRatings {
  if (stats.length === 0) {
    return { attacking: 0, defending: 0, passing: 0, consistency: 0, gk: 0 };
  }

  const n = stats.length;
  const role = getPositionRole(dominantPosition);

  // Per-match averages
  const avg = (fn: (s: MatchStatRow) => number) =>
    stats.reduce((sum, s) => sum + fn(s), 0) / n;

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
  const avgGameScore = avg(s => s.score);
  const avgGC = avg(s => s.goals_conceded ?? 0);

  // Position-specific attacking thresholds (same as attackingScore)
  const gThresh   = role === "FWD" ? 2.24 : role === "MID" ? 1.5  : 0.08;
  const aThresh   = role === "FWD" ? 0.96 : role === "MID" ? 1.5  : 0.30;
  const sotThresh = role === "FWD" ? 4.0  : role === "MID" ? 2.7  : 0.40;
  const aMax      = role === "MID" ? 42 : 25;
  const kpMax     = role === "MID" ? 15 : 20;

  const attacking = Math.min(100,
    Math.min(40, (avgGoals / gThresh) * 40) +
    Math.min(aMax, (avgAssists / aThresh) * aMax) +
    Math.min(kpMax, (avgKP / 3.0) * kpMax) +
    Math.min(15, (avgSOT / sotThresh) * 15)
  );

  const gcAdj = role === "DEF" ? Math.max(-5, Math.min(8, (1 - avgGC / 4.3) * 8)) : 0;
  const defending = Math.min(100, Math.max(0,
    Math.min(50, (avgTackles / 6.0) * 50) +
    Math.min(28, (avgInt / 4.5) * 28) +
    Math.min(15, Math.max(0, 1 - avgPL / 28.0) * 15) +
    Math.min(10, (avgKeyTackles / 1.75) * 10) +
    gcAdj
  ));

  const pCap  = role === "MID" ? 32.0 : role === "GK" ? 23.0 : role === "DEF" ? 23.5 : 22.1;
  const kpCap = role === "MID" ? 1.56 : role === "GK" ? 0.48 : role === "DEF" ? 1.0  : 2.84;
  const pW = role === "FWD" ? 65 : 80;
  const kW = role === "FWD" ? 35 : role === "MID" ? 28 : 20;
  const passing = Math.min(pW, (avgPasses / pCap) * pW) + Math.min(kW, (avgKP / kpCap) * kW);

  const wins = results.filter(r => r === "W").length;
  const draws = results.filter(r => r === "D").length;
  const total = results.length;

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
  const role = getPositionRole(position);
  const w = getPositionWeights(role);

  const consScore = stat.score > 0
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
