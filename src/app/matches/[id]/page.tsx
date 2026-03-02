import { createClient } from "@supabase/supabase-js";
import Link from "next/link";
import { notFound } from "next/navigation";
import PlayerStatsTable from "./PlayerStatsTable";
import {
  calcMatchBreakdown,
  calcOverallRating,
  DEFAULT_TIER_BONUSES,
  type MatchStatRow,
  type MatchResult,
} from "@/lib/ratings";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

async function getMatch(id: string) {
  const { data, error } = await supabase
    .from("matches")
    .select("id,league_id,played_at,home_team,away_team,home_score,away_score,forfeited_by,stage,group_name,league:leagues(id,name,season)")
    .eq("id", id)
    .single();
  if (error || !data) return null;
  return data;
}

async function getTeamStats(matchId: string) {
  const { data } = await supabase
    .from("match_team_stats")
    .select("team_side,possession,passes,key_passes,assists,shots,shots_on_target,goals,tackles,key_tackles,interceptions,key_interceptions,possessions_lost,goal_kicks,corner_kicks,throw_ins,free_kicks,penalties,fouls,offsides,yellow_cards,red_cards")
    .eq("match_id", matchId);
  return data ?? [];
}

async function getPlayerStats(matchId: string) {
  const { data, error } = await supabase
    .from("match_player_stats")
    .select("player_id,team_side,position,score,passes,key_passes,assists,shots,shots_on_target,goals,tackles,key_tackles,interceptions,key_interceptions,possessions_lost,gk_saves,gk_catches,players(handle,name)")
    .eq("match_id", matchId);

  if (!error && data) return data as any[];

  // Fallback without join
  const { data: data2 } = await supabase
    .from("match_player_stats")
    .select("player_id,team_side,position,score,passes,key_passes,assists,shots,shots_on_target,goals,tackles,key_tackles,interceptions,key_interceptions,possessions_lost,gk_saves,gk_catches")
    .eq("match_id", matchId);

  if (!data2) return [];

  const ids = [...new Set(data2.map((r: any) => r.player_id))];
  if (ids.length) {
    const { data: players } = await supabase.from("players").select("id,handle,name").in("id", ids);
    const map = new Map((players ?? []).map((p: any) => [p.id, { handle: p.handle, name: p.name }]));
    return data2.map((r: any) => ({ ...r, players: map.get(r.player_id) ?? null }));
  }
  return data2;
}

async function getTeamIds(homeTeam: string, awayTeam: string): Promise<Map<string, string>> {
  const { data } = await supabase
    .from("teams")
    .select("id,name")
    .in("name", [homeTeam, awayTeam]);
  const map = new Map<string, string>();
  for (const t of data ?? []) map.set(t.name, t.id);
  return map;
}

async function getPlayerOverallRatings(playerIds: string[]): Promise<Record<string, number>> {
  if (!playerIds.length) return {};

  const { data: tierSettingsData } = await supabase.from("tier_settings").select("tier,bonus");
  const tierBonuses: Record<number, number> = { ...DEFAULT_TIER_BONUSES };
  if (tierSettingsData) for (const row of tierSettingsData) tierBonuses[row.tier] = row.bonus;

  const { data } = await supabase
    .from("match_player_stats")
    .select("player_id,team_side,position,score,goals,assists,shots_on_target,key_passes,passes,tackles,key_tackles,interceptions,key_interceptions,possessions_lost,gk_saves,gk_catches,benched,stats_incomplete,is_starter,sub_number,matches(home_score,away_score,leagues(tier))")
    .in("player_id", playerIds);
  if (!data) return {};

  const normalized = data.map((s: any) => ({
    ...s,
    benched: s.benched ?? (!s.is_starter && s.sub_number !== null && s.score === 0),
    stats_incomplete: s.stats_incomplete ?? false,
    matches: Array.isArray(s.matches) ? s.matches[0] ?? null : s.matches ?? null,
  }));

  const byPlayer = new Map<string, any[]>();
  for (const s of normalized) {
    if (!byPlayer.has(s.player_id)) byPlayer.set(s.player_id, []);
    byPlayer.get(s.player_id)!.push(s);
  }

  const result: Record<string, number> = {};
  for (const [pid, stats] of byPlayer) {
    const played = stats.filter((s: any) => !s.benched && !s.stats_incomplete && s.matches);
    if (played.length < 3) continue;
    const matchRatingsList: number[] = [];
    const tierCounts: Record<number, number> = {};
    for (const s of played) {
      const m = s.matches;
      const isHome = s.team_side === "home";
      const statRow: MatchStatRow = {
        goals: s.goals ?? 0, assists: s.assists ?? 0, key_passes: s.key_passes ?? 0,
        shots_on_target: s.shots_on_target ?? 0, passes: s.passes ?? 0,
        tackles: s.tackles ?? 0, key_tackles: s.key_tackles ?? 0,
        interceptions: s.interceptions ?? 0, key_interceptions: s.key_interceptions ?? 0,
        possessions_lost: s.possessions_lost ?? 0, gk_saves: s.gk_saves ?? 0,
        gk_catches: s.gk_catches ?? 0,
        goals_conceded: (isHome ? m.away_score : m.home_score) ?? 0,
        score: s.score ?? 0, position: s.position,
      };
      const my = isHome ? m.home_score : m.away_score;
      const opp = isHome ? m.away_score : m.home_score;
      const res: MatchResult = my > opp ? "W" : my < opp ? "L" : "D";
      matchRatingsList.push(calcMatchBreakdown(statRow, res, s.position).final);
      const tier = m.leagues?.tier ?? 2;
      tierCounts[tier] = (tierCounts[tier] ?? 0) + 1;
    }
    if (matchRatingsList.length < 3) continue;
    const domTier = +Object.entries(tierCounts).sort((a, b) => Number(b[1]) - Number(a[1]))[0][0];
    result[pid] = calcOverallRating(matchRatingsList, domTier, tierBonuses);
  }
  return result;
}

export const revalidate = 60;

const TEAM_STAT_ROWS: [string, string, boolean][] = [
  ["Possession", "possession", true],
  ["Passes", "passes", false],
  ["Key Passes", "key_passes", false],
  ["Shots", "shots", false],
  ["Shots on Target", "shots_on_target", false],
  ["Goals", "goals", false],
  ["Assists", "assists", false],
  ["Tackles", "tackles", false],
  ["Key Tackles", "key_tackles", false],
  ["Interceptions", "interceptions", false],
  ["Key Interceptions", "key_interceptions", false],
  ["Possessions Lost", "possessions_lost", false],
  ["Corners", "corner_kicks", false],
  ["Fouls", "fouls", false],
  ["Yellow Cards", "yellow_cards", false],
  ["Red Cards", "red_cards", false],
  ["Offsides", "offsides", false],
];

export default async function MatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const match = await getMatch(id);
  if (!match) notFound();

  const [teamStats, playerStats, teamIds] = await Promise.all([getTeamStats(id), getPlayerStats(id), getTeamIds(match.home_team, match.away_team)]);

  const homeStats = teamStats.find((s: any) => s.team_side === "home") ?? null;
  const awayStats = teamStats.find((s: any) => s.team_side === "away") ?? null;
  const played = match.home_score !== null && match.away_score !== null;

  // Per-match ratings (0–100) for each player in this game
  const matchRatings: Record<string, number> = {};
  if (played) {
    for (const s of playerStats) {
      const isHome = s.team_side === "home";
      const statRow: MatchStatRow = {
        goals: s.goals ?? 0, assists: s.assists ?? 0, key_passes: s.key_passes ?? 0,
        shots_on_target: s.shots_on_target ?? 0, passes: s.passes ?? 0,
        tackles: s.tackles ?? 0, key_tackles: s.key_tackles ?? 0,
        interceptions: s.interceptions ?? 0, key_interceptions: s.key_interceptions ?? 0,
        possessions_lost: s.possessions_lost ?? 0, gk_saves: s.gk_saves ?? 0,
        gk_catches: s.gk_catches ?? 0,
        goals_conceded: isHome ? match.away_score! : match.home_score!,
        score: s.score ?? 0, position: s.position,
      };
      const my = isHome ? match.home_score! : match.away_score!;
      const opp = isHome ? match.away_score! : match.home_score!;
      const res: MatchResult = my > opp ? "W" : my < opp ? "L" : "D";
      matchRatings[s.player_id] = calcMatchBreakdown(statRow, res, s.position).final;
    }
  }

  // Overall career ratings for all players in this game
  const playerIds = [...new Set(playerStats.map((s: any) => s.player_id as string))];
  const overallRatings = await getPlayerOverallRatings(playerIds);

  const enrichedPlayerStats = playerStats.map((s: any) => ({
    ...s,
    matchRating: matchRatings[s.player_id] ?? null,
    overallRating: overallRatings[s.player_id] ?? null,
  }));
  const league = (match as any).league ?? null;
  const homeWin = played && match.home_score! > match.away_score!;
  const awayWin = played && match.away_score! > match.home_score!;

  return (
    <main style={{ minHeight: "calc(100vh - 56px)" }}>
      {/* Header */}
      <section style={{ borderBottom: "1px solid var(--border-main)", padding: "40px 24px 32px", background: "var(--bg-nav)" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto" }}>
          {/* Breadcrumb */}
          <div style={{ fontSize: 11, letterSpacing: "0.25em", color: "var(--text-faint)", fontWeight: 700, textTransform: "uppercase", marginBottom: 20 }}>
            <Link href="/" style={{ color: "var(--text-faint)", textDecoration: "none" }}>Home</Link>
            <span style={{ margin: "0 8px" }}>/</span>
            <Link href="/matches" style={{ color: "var(--text-faint)", textDecoration: "none" }}>Matches</Link>
            <span style={{ margin: "0 8px" }}>/</span>
            {match.home_team} vs {match.away_team}
          </div>

          {league && (
            <div style={{ fontSize: 11, color: "#4ea8f7", letterSpacing: "0.15em", fontWeight: 700, textTransform: "uppercase", marginBottom: 16 }}>
              <Link href={`/leagues/${league.id}`} style={{ color: "#4ea8f7", textDecoration: "none" }}>
                {league.name}{league.season ? ` · Season ${league.season}` : ""}
              </Link>
            </div>
          )}

          {/* Score */}
          <div style={{ display: "flex", alignItems: "center", gap: 32 }}>
            <div style={{ flex: 1, textAlign: "right" }}>
              <div style={{ fontSize: "clamp(18px, 3vw, 30px)", fontWeight: 900, letterSpacing: "-0.02em", color: homeWin ? "var(--text-main)" : "var(--text-muted)" }}>
                {teamIds.get(match.home_team) ? (
                  <Link href={`/teams/${teamIds.get(match.home_team)}`} style={{ color: "inherit", textDecoration: "none" }} className="hover:underline">{match.home_team}</Link>
                ) : match.home_team}
              </div>
              {homeWin && <div style={{ fontSize: 10, color: "#4ade80", letterSpacing: "0.15em", fontWeight: 700, textTransform: "uppercase", marginTop: 4 }}>Winner</div>}
            </div>

            <div style={{ textAlign: "center", flexShrink: 0 }}>
              {played ? (
                <div style={{ fontSize: "clamp(40px, 7vw, 72px)", fontWeight: 900, letterSpacing: "-0.04em", color: "var(--text-main)", fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>
                  {match.home_score}<span style={{ color: "var(--border-main)", margin: "0 6px" }}>—</span>{match.away_score}
                </div>
              ) : (
                <div style={{ fontSize: 28, color: "var(--text-faint)", letterSpacing: "0.1em" }}>VS</div>
              )}
              <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 8, letterSpacing: "0.08em" }}>
                {new Date(match.played_at).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}
              </div>
              {(match as any).stage && (
                <div style={{ fontSize: 10, color: "var(--text-sub)", letterSpacing: "0.12em", textTransform: "uppercase", marginTop: 4 }}>{(match as any).stage}</div>
              )}
              {(match as any).forfeited_by && (
                <div style={{ marginTop: 8, fontSize: 10, color: "#e63946", background: "#e6394620", padding: "3px 10px", letterSpacing: "0.08em", display: "inline-block" }}>
                  FORFEIT · {(match as any).forfeited_by === "home" ? match.home_team : match.away_team} forfeited
                </div>
              )}
            </div>

            <div style={{ flex: 1 }}>
              <div style={{ fontSize: "clamp(18px, 3vw, 30px)", fontWeight: 900, letterSpacing: "-0.02em", color: awayWin ? "var(--text-main)" : "var(--text-muted)" }}>
                {teamIds.get(match.away_team) ? (
                  <Link href={`/teams/${teamIds.get(match.away_team)}`} style={{ color: "inherit", textDecoration: "none" }} className="hover:underline">{match.away_team}</Link>
                ) : match.away_team}
              </div>
              {awayWin && <div style={{ fontSize: 10, color: "#4ade80", letterSpacing: "0.15em", fontWeight: 700, textTransform: "uppercase", marginTop: 4 }}>Winner</div>}
            </div>
          </div>
        </div>
      </section>

      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "32px 24px 48px", display: "flex", flexDirection: "column", gap: 2 }}>

        {/* Team Stats */}
        {(homeStats || awayStats) && (
          <div>
            <div style={{ background: "var(--bg-card)", borderTop: "3px solid #4ea8f7", padding: "14px 20px", fontSize: 11, fontWeight: 700, letterSpacing: "0.2em", textTransform: "uppercase", color: "#4ea8f7" }}>
              Team Stats
            </div>
            <div style={{ background: "var(--bg-card)", overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ background: "var(--bg-row)" }}>
                    <th style={{ padding: "10px 24px", textAlign: "right", fontSize: 13, fontWeight: 800, color: "var(--text-body)", borderBottom: "1px solid var(--border-main)", width: "38%" }}>
                      {teamIds.get(match.home_team) ? <Link href={`/teams/${teamIds.get(match.home_team)}`} style={{ color: "inherit", textDecoration: "none" }} className="hover:underline">{match.home_team}</Link> : match.home_team}
                    </th>
                    <th style={{ padding: "10px 16px", textAlign: "center", fontSize: 10, color: "var(--text-faint)", fontWeight: 700, letterSpacing: "0.15em", textTransform: "uppercase", borderBottom: "1px solid var(--border-main)", width: "24%" }}>Stat</th>
                    <th style={{ padding: "10px 24px", textAlign: "left", fontSize: 13, fontWeight: 800, color: "var(--text-body)", borderBottom: "1px solid var(--border-main)", width: "38%" }}>
                      {teamIds.get(match.away_team) ? <Link href={`/teams/${teamIds.get(match.away_team)}`} style={{ color: "inherit", textDecoration: "none" }} className="hover:underline">{match.away_team}</Link> : match.away_team}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {TEAM_STAT_ROWS.map(([label, key, isPct]) => {
                    const hv = homeStats ? (homeStats as any)[key] ?? 0 : 0;
                    const av = awayStats ? (awayStats as any)[key] ?? 0 : 0;
                    const fmt = (v: any) => isPct ? `${Number(v).toFixed(1)}%` : String(v ?? 0);
                    const hWin = hv > av;
                    const aWin = av > hv;
                    return (
                      <tr key={key} style={{ borderBottom: "1px solid var(--border-row)" }}>
                        <td style={{ padding: "9px 24px", textAlign: "right", fontWeight: hWin ? 800 : 400, color: hWin ? "var(--text-body)" : "var(--text-muted)", fontSize: 15 }}>{fmt(hv)}</td>
                        <td style={{ padding: "9px 16px", textAlign: "center", fontSize: 10, color: "var(--text-faint)", letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 600 }}>{label}</td>
                        <td style={{ padding: "9px 24px", textAlign: "left", fontWeight: aWin ? 800 : 400, color: aWin ? "var(--text-body)" : "var(--text-muted)", fontSize: 15 }}>{fmt(av)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Player Stats — interactive client component */}
        <PlayerStatsTable
          playerStats={enrichedPlayerStats}
          homeTeam={match.home_team}
          awayTeam={match.away_team}
        />
      </div>
    </main>
  );
}
