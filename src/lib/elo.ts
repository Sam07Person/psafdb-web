export const DEFAULT_ELO = 1000;
const K_BASE = 32;

function goalDiffMultiplier(gd: number): number {
  if (gd <= 1) return 1.0;
  if (gd === 2) return 1.5;
  return 1.75 + (gd - 3) * 0.05;
}

function tierMultiplier(tier: number | null): number {
  if (tier === 1) return 1.2;
  if (tier === 3) return 0.8;
  return 1.0;
}

export function expectedScore(rA: number, rB: number): number {
  return 1 / (1 + Math.pow(10, (rB - rA) / 400));
}

export function eloColor(elo: number): string {
  if (elo >= 1150) return "#22c55e";
  if (elo >= 1075) return "#84cc16";
  if (elo >= 1000) return "#eab308";
  if (elo >= 925) return "#f97316";
  return "#ef4444";
}

export type EloMap = Record<string, number>;

/**
 * Replay all matches (optionally up to beforeDate) and return the current ELO
 * for every team that has played at least one match.
 */
export async function computeCurrentElos(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  options?: { beforeDate?: string }
): Promise<EloMap> {
  const { data: leagues } = await supabase.from("leagues").select("id,tier");
  const tierMap = new Map<string, number | null>(
    (leagues ?? []).map((l: any) => [l.id, l.tier])
  );

  // Build set of team names that have ELO disabled
  const { data: noEloTeams } = await supabase
    .from("teams")
    .select("name")
    .eq("no_elo", true);
  const noEloNames = new Set<string>(
    (noEloTeams ?? []).map((t: any) => t.name as string)
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query: any = supabase
    .from("matches")
    .select("home_team,away_team,home_score,away_score,league_id")
    .not("home_score", "is", null)
    .not("away_score", "is", null)
    .order("played_at", { ascending: true });

  if (options?.beforeDate) {
    query = query.lt("played_at", options.beforeDate);
  }

  const { data: matches } = await query;
  const elos = new Map<string, number>();

  function getElo(t: string) {
    return elos.get(t) ?? DEFAULT_ELO;
  }

  for (const m of matches ?? []) {
    if (noEloNames.has(m.home_team) || noEloNames.has(m.away_team)) continue;
    const hElo = getElo(m.home_team);
    const aElo = getElo(m.away_team);
    const hExp = expectedScore(hElo, aElo);
    const hs = m.home_score as number;
    const as_ = m.away_score as number;
    const gd = Math.abs(hs - as_);
    let hActual: number, aActual: number;
    if (hs > as_) { hActual = 1; aActual = 0; }
    else if (hs < as_) { hActual = 0; aActual = 1; }
    else { hActual = 0.5; aActual = 0.5; }
    const tier = tierMap.get(m.league_id) ?? null;
    const aExp = 1 - hExp;
    const K = K_BASE * tierMultiplier(tier) * (hActual === 0.5 ? 1.0 : goalDiffMultiplier(gd));
    elos.set(m.home_team, hElo + K * (hActual - hExp));
    elos.set(m.away_team, aElo + K * (aActual - aExp));
  }

  const result: EloMap = {};
  for (const [k, v] of elos) result[k] = Math.round(v);
  return result;
}
