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
    case "GK":  return { attacking: 0.00, defending: 0.15, passing: 0.05, consistency: 0.10, gk: 0.70 };
    case "DEF": return { attacking: 0.20, defending: 0.55, passing: 0.15, consistency: 0.10, gk: 0.00 };
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

function attackingScore(s: MatchStatRow): number {
  return (
    Math.min(40, (s.goals / 1.0) * 40) +
    Math.min(25, (s.assists / 0.8) * 25) +
    Math.min(20, (s.key_passes / 3.0) * 20) +
    Math.min(15, (s.shots_on_target / 2.5) * 15)
  );
}

function defendingScore(s: MatchStatRow): number {
  return (
    Math.min(50, ((s.tackles + s.key_tackles) / 6.0) * 50) +
    Math.min(35, ((s.interceptions + s.key_interceptions) / 4.5) * 35) +
    Math.min(15, Math.max(0, 1 - s.possessions_lost / 14.0) * 15)
  );
}

function passingScore(s: MatchStatRow): number {
  // 1 key pass ≈ 3 regular passes; soft cap above 85 (compressed 6:1)
  const raw = s.passes * 4.6 + s.key_passes * 15.0;
  return Math.min(100, raw <= 85 ? raw : 85 + (raw - 85) / 6);
}

function gkScore(s: MatchStatRow): number {
  return (
    Math.min(65, (s.gk_saves / 7.0) * 65) +
    Math.min(35, (s.gk_catches / 4.0) * 35)
  );
}

// ── Career sub-ratings from all matches ──────────────────────────────────────

export function calcSubRatings(
  stats: MatchStatRow[],
  results: MatchResult[]
): SubRatings {
  if (stats.length === 0) {
    return { attacking: 0, defending: 0, passing: 0, consistency: 0, gk: 0 };
  }

  const n = stats.length;

  // Per-match averages
  const avg = (fn: (s: MatchStatRow) => number) =>
    stats.reduce((sum, s) => sum + fn(s), 0) / n;

  const avgGoals = avg(s => s.goals);
  const avgAssists = avg(s => s.assists);
  const avgKP = avg(s => s.key_passes);
  const avgSOT = avg(s => s.shots_on_target);
  const avgPasses = avg(s => s.passes);
  const avgTackles = avg(s => s.tackles + s.key_tackles);
  const avgInt = avg(s => s.interceptions + s.key_interceptions);
  const avgPL = avg(s => s.possessions_lost);
  const avgSaves = avg(s => s.gk_saves);
  const avgCatches = avg(s => s.gk_catches);
  const avgGameScore = avg(s => s.score);

  const attacking = Math.min(100,
    Math.min(40, (avgGoals / 1.0) * 40) +
    Math.min(25, (avgAssists / 0.8) * 25) +
    Math.min(20, (avgKP / 3.0) * 20) +
    Math.min(15, (avgSOT / 2.5) * 15)
  );

  const defending = Math.min(100,
    Math.min(50, (avgTackles / 6.0) * 50) +
    Math.min(35, (avgInt / 4.5) * 35) +
    Math.min(15, Math.max(0, 1 - avgPL / 14.0) * 15)
  );

  const rawPassing = avgPasses * 4.6 + avgKP * 15.0;
  const passing = Math.min(100, rawPassing <= 85 ? rawPassing : 85 + (rawPassing - 85) / 6);

  const wins = results.filter(r => r === "W").length;
  const draws = results.filter(r => r === "D").length;
  const total = results.length;

  let consistency: number;
  if (avgGameScore > 0) {
    // Auto-detect scale: >100 → 0–700 game scale (/7), >10 → 0–100 (direct), else → 0–10 (×10)
    const normalized = avgGameScore > 100 ? avgGameScore / 7 : avgGameScore > 10 ? avgGameScore : avgGameScore * 10;
    consistency = Math.min(100, normalized);
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

// ── Overall rating ────────────────────────────────────────────────────────────

export function calcOverallRating(
  subRatings: SubRatings,
  dominantPosition: string | null | undefined,
  leagueTier: number = 2
): number {
  const role = getPositionRole(dominantPosition);
  const w = getPositionWeights(role);

  const base =
    subRatings.attacking * w.attacking +
    subRatings.defending * w.defending +
    subRatings.passing * w.passing +
    subRatings.consistency * w.consistency +
    subRatings.gk * w.gk;

  const tierBonus = leagueTier === 1 ? 5 : leagueTier === 3 ? -5 : 0;
  return Math.round(Math.min(100, Math.max(0, base + tierBonus)));
}

// ── Per-match rating (0–10) ───────────────────────────────────────────────────

export function calcMatchRating(
  stat: MatchStatRow,
  result: MatchResult,
  position: string | null | undefined
): number {
  const role = getPositionRole(position);
  const w = getPositionWeights(role);

  const consScore = stat.score > 0
    ? Math.min(100, stat.score > 100 ? stat.score / 7 : stat.score > 10 ? stat.score : stat.score * 10)
    : result === "W" ? 70 : result === "D" ? 40 : 15;

  const base =
    attackingScore(stat) * w.attacking +
    defendingScore(stat) * w.defending +
    passingScore(stat) * w.passing +
    consScore * w.consistency +
    gkScore(stat) * w.gk;

  const normalized = base / 10;
  const resultBonus = result === "W" ? 0.5 : result === "D" ? 0.2 : 0;

  return Math.min(10, Math.max(0, parseFloat((normalized + resultBonus).toFixed(1))));
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
  if (rating >= 8) return "#22c55e";
  if (rating >= 7) return "#84cc16";
  if (rating >= 6) return "#eab308";
  if (rating >= 5) return "#f97316";
  return "#ef4444";
}
