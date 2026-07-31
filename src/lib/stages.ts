// Shared knockout-stage helpers.
//
// Stage strings in the DB are entered by hand / extracted from screenshots, so the
// same round shows up as "quarter-finals", "Quarter-Finals", "quarter finals",
// "Quarterfinal" and even bare "semi". Everything that needs to reason about stages
// should go through these helpers so the variants collapse consistently.

// Canonical knockout stage order (later rounds first).
// "final" MUST be last — it's a substring of "semi-final", "quarter-final" etc.
// Each entry: [keyword, rank] where rank 0 = final (rightmost), higher = earlier round (leftmost).
export const KNOCKOUT_STAGE_RANKS: [string, number][] = [
  ["third place", 1],
  ["semifinal",   2],
  ["semi-final",  2],
  ["quarterfinal",3],
  ["quarter-final",3],
  ["round of 32", 5],
  ["round of 16", 4],
  ["knockout",    6],
  ["final",       0], // must be last — substring of "semi-final" etc.
];

// Normalise a stage name so minor variants ("Quarter-Final" / "Quarter-Finals" /
// "Quarterfinal" / bare "quarter") all collapse to the same canonical key used for
// bucketing. Matching is done on a punctuation-stripped form so "semi-finals",
// "semi finals", "Semi Final" and "semi" all land in one bucket.
export function normaliseStage(stage: string): string {
  const s = (stage || "").toLowerCase().trim();
  const flat = s.replace(/[^a-z0-9]+/g, " ").trim(); // "semi-finals" -> "semi finals"
  const compact = flat.replace(/\s+/g, "");          // "semi-finals" -> "semifinals"
  if (flat.includes("third") || compact.includes("3rdplace")) return "Third Place";
  if (compact.startsWith("semi")) return "Semi-Finals";
  if (compact.startsWith("quarter") || /^qf\b/.test(flat)) return "Quarter-Finals";
  const ro = flat.match(/\b(?:round of|last|ro)\s*(\d+)\b/);
  if (ro) return `Round of ${ro[1]}`;
  if (compact.includes("semifinal")) return "Semi-Finals";
  if (compact.includes("quarterfinal")) return "Quarter-Finals";
  if (compact.includes("final")) return "Final";
  if (compact.includes("knockout") || compact.includes("playoff")) return "Knockout";
  // Unknown stage — return original (trimmed)
  return (stage || "").trim();
}

// Canonical stage names that normaliseStage can produce for real knockout rounds.
const CANONICAL_KNOCKOUT_STAGES = new Set([
  "Third Place", "Semi-Finals", "Quarter-Finals", "Final", "Knockout",
]);

// True when a stage value explicitly names a knockout round. Used to stop the
// "both teams share a group" heuristic from mis-classifying a knockout tie between
// two teams that came out of the same group as a group-stage match.
export function isKnockoutStageName(stage: string | null | undefined): boolean {
  const raw = (stage || "").trim();
  if (!raw) return false;
  if (/^group\b/i.test(raw)) return false;
  const n = normaliseStage(raw);
  return CANONICAL_KNOCKOUT_STAGES.has(n) || /^Round of \d+$/.test(n);
}

// Rank a stage for left→right bracket ordering. 0 = final (rightmost), higher = earlier round.
export function knockoutStageRank(stage: string): number {
  const s = normaliseStage(stage).toLowerCase().trim();
  const ro = s.match(/^round of (\d+)$/);
  // Round of N: bigger N = earlier round = higher rank. RO16 -> 4, RO32 -> 5, RO64 -> 6...
  if (ro) return 4 + Math.round(Math.log2(Number(ro[1]) / 16));
  for (const [key, rank] of KNOCKOUT_STAGE_RANKS) {
    if (s.includes(key)) return rank;
  }
  return 999;
}
