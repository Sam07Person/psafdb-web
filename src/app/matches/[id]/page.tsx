import { createClient } from "@supabase/supabase-js";
import Link from "next/link";
import { notFound } from "next/navigation";
import PlayerStatsTable from "./PlayerStatsTable";

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

  const [teamStats, playerStats] = await Promise.all([getTeamStats(id), getPlayerStats(id)]);

  const homeStats = teamStats.find((s: any) => s.team_side === "home") ?? null;
  const awayStats = teamStats.find((s: any) => s.team_side === "away") ?? null;
  const played = match.home_score !== null && match.away_score !== null;
  const league = (match as any).league ?? null;
  const homeWin = played && match.home_score! > match.away_score!;
  const awayWin = played && match.away_score! > match.home_score!;

  return (
    <main style={{ minHeight: "calc(100vh - 56px)" }}>
      {/* Header */}
      <section style={{ borderBottom: "1px solid #1a1a2e", padding: "40px 24px 32px", background: "#09091a" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto" }}>
          {/* Breadcrumb */}
          <div style={{ fontSize: 11, letterSpacing: "0.25em", color: "#3a3a5a", fontWeight: 700, textTransform: "uppercase", marginBottom: 20 }}>
            <Link href="/" style={{ color: "#3a3a5a", textDecoration: "none" }}>Home</Link>
            <span style={{ margin: "0 8px" }}>/</span>
            <Link href="/matches" style={{ color: "#3a3a5a", textDecoration: "none" }}>Matches</Link>
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
              <div style={{ fontSize: "clamp(18px, 3vw, 30px)", fontWeight: 900, letterSpacing: "-0.02em", color: homeWin ? "#f0f0fa" : "#4a4a6a" }}>
                {match.home_team}
              </div>
              {homeWin && <div style={{ fontSize: 10, color: "#4ade80", letterSpacing: "0.15em", fontWeight: 700, textTransform: "uppercase", marginTop: 4 }}>Winner</div>}
            </div>

            <div style={{ textAlign: "center", flexShrink: 0 }}>
              {played ? (
                <div style={{ fontSize: "clamp(40px, 7vw, 72px)", fontWeight: 900, letterSpacing: "-0.04em", color: "#f0f0fa", fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>
                  {match.home_score}<span style={{ color: "#1a1a2e", margin: "0 6px" }}>—</span>{match.away_score}
                </div>
              ) : (
                <div style={{ fontSize: 28, color: "#3a3a5a", letterSpacing: "0.1em" }}>VS</div>
              )}
              <div style={{ fontSize: 11, color: "#3a3a5a", marginTop: 8, letterSpacing: "0.08em" }}>
                {new Date(match.played_at).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}
              </div>
              {(match as any).stage && (
                <div style={{ fontSize: 10, color: "#5a5a7a", letterSpacing: "0.12em", textTransform: "uppercase", marginTop: 4 }}>{(match as any).stage}</div>
              )}
              {(match as any).forfeited_by && (
                <div style={{ marginTop: 8, fontSize: 10, color: "#e63946", background: "#e6394620", padding: "3px 10px", letterSpacing: "0.08em", display: "inline-block" }}>
                  FORFEIT · {(match as any).forfeited_by === "home" ? match.home_team : match.away_team} forfeited
                </div>
              )}
            </div>

            <div style={{ flex: 1 }}>
              <div style={{ fontSize: "clamp(18px, 3vw, 30px)", fontWeight: 900, letterSpacing: "-0.02em", color: awayWin ? "#f0f0fa" : "#4a4a6a" }}>
                {match.away_team}
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
            <div style={{ background: "#0d0d1a", borderTop: "3px solid #4ea8f7", padding: "14px 20px", fontSize: 11, fontWeight: 700, letterSpacing: "0.2em", textTransform: "uppercase", color: "#4ea8f7" }}>
              Team Stats
            </div>
            <div style={{ background: "#0d0d1a", overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ background: "#09090f" }}>
                    <th style={{ padding: "10px 24px", textAlign: "right", fontSize: 13, fontWeight: 800, color: "#e0e0f0", borderBottom: "1px solid #1a1a2e", width: "38%" }}>{match.home_team}</th>
                    <th style={{ padding: "10px 16px", textAlign: "center", fontSize: 10, color: "#3a3a5a", fontWeight: 700, letterSpacing: "0.15em", textTransform: "uppercase", borderBottom: "1px solid #1a1a2e", width: "24%" }}>Stat</th>
                    <th style={{ padding: "10px 24px", textAlign: "left", fontSize: 13, fontWeight: 800, color: "#e0e0f0", borderBottom: "1px solid #1a1a2e", width: "38%" }}>{match.away_team}</th>
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
                      <tr key={key} style={{ borderBottom: "1px solid #0a0a14" }}>
                        <td style={{ padding: "9px 24px", textAlign: "right", fontWeight: hWin ? 800 : 400, color: hWin ? "#f0f0fa" : "#4a4a6a", fontSize: 15 }}>{fmt(hv)}</td>
                        <td style={{ padding: "9px 16px", textAlign: "center", fontSize: 10, color: "#3a3a5a", letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 600 }}>{label}</td>
                        <td style={{ padding: "9px 24px", textAlign: "left", fontWeight: aWin ? 800 : 400, color: aWin ? "#f0f0fa" : "#4a4a6a", fontSize: 15 }}>{fmt(av)}</td>
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
          playerStats={playerStats}
          homeTeam={match.home_team}
          awayTeam={match.away_team}
        />
      </div>
    </main>
  );
}
