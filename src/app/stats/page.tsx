import { createClient } from "@supabase/supabase-js";
import Link from "next/link";
import { Suspense } from "react";
import { StatsFilterBar } from "./StatsFilterBar";
import { LeagueStatsClient, type PlayerStat, type TeamStat } from "../leagues/[id]/LeagueStatsClient";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

async function getAllStats(leagueId?: string): Promise<{ players: PlayerStat[]; teams: TeamStat[] }> {
  let matchQuery = supabase
    .from("matches")
    .select("id,home_team,away_team,home_score,away_score")
    .not("home_score", "is", null);
  if (leagueId) matchQuery = matchQuery.eq("league_id", leagueId);

  const { data: matches } = await matchQuery.limit(10000);
  if (!matches || matches.length === 0) return { players: [], teams: [] };

  const matchIds = matches.map((m: any) => m.id);

  const [{ data: statsData }, { data: allTeams }] = await Promise.all([
    supabase
      .from("match_player_stats")
      .select("player_id,goals,assists,key_passes,passes,shots_on_target,tackles,key_tackles,interceptions,key_interceptions,possessions_lost,gk_saves,gk_catches,benched,players(id,name,handle)")
      .in("match_id", matchIds)
      .limit(20000),
    supabase.from("teams").select("id,name"),
  ]);

  const teamIdMap: Record<string, string> = Object.fromEntries(
    (allTeams ?? []).map((t: any) => [t.name, t.id])
  );

  const byPlayer: Record<string, PlayerStat> = {};
  for (const s of statsData ?? []) {
    if (s.benched) continue;
    if (!byPlayer[s.player_id]) {
      const p = Array.isArray(s.players) ? s.players[0] : s.players;
      byPlayer[s.player_id] = {
        playerId: s.player_id,
        name: p?.name || p?.handle || s.player_id.slice(0, 8),
        games: 0, goals: 0, assists: 0, key_passes: 0, passes: 0,
        shots_on_target: 0, tackles: 0, key_tackles: 0,
        interceptions: 0, key_interceptions: 0, possessions_lost: 0,
        gk_saves: 0, gk_catches: 0,
      };
    }
    const r = byPlayer[s.player_id];
    r.games++;
    r.goals += s.goals || 0;
    r.assists += s.assists || 0;
    r.key_passes += s.key_passes || 0;
    r.passes += s.passes || 0;
    r.shots_on_target += s.shots_on_target || 0;
    r.tackles += s.tackles || 0;
    r.key_tackles += s.key_tackles || 0;
    r.interceptions += s.interceptions || 0;
    r.key_interceptions += s.key_interceptions || 0;
    r.possessions_lost += s.possessions_lost || 0;
    r.gk_saves += s.gk_saves || 0;
    r.gk_catches += s.gk_catches || 0;
  }

  const teamMap: Record<string, TeamStat> = {};
  for (const m of matches) {
    for (const [side, opp] of [["home", "away"], ["away", "home"]] as const) {
      const name = (m as any)[`${side}_team`];
      const scored = (m as any)[`${side}_score`];
      const conceded = (m as any)[`${opp}_score`];
      if (!teamMap[name]) teamMap[name] = { name, teamId: teamIdMap[name] ?? null, games: 0, gf: 0, ga: 0, cs: 0 };
      teamMap[name].games++;
      teamMap[name].gf += scored;
      teamMap[name].ga += conceded;
      if (conceded === 0) teamMap[name].cs++;
    }
  }

  return {
    players: Object.values(byPlayer),
    teams: Object.values(teamMap).sort((a, b) => b.gf - a.gf),
  };
}

export const revalidate = 60;

export default async function StatsPage({
  searchParams,
}: {
  searchParams?: Promise<{ league?: string; tab?: string }>;
}) {
  const sp = await searchParams;
  const selectedLeague = sp?.league || "";

  const [{ data: leaguesRaw }, stats] = await Promise.all([
    supabase.from("leagues").select("id,name,ended").order("name"),
    getAllStats(selectedLeague || undefined),
  ]);

  const leagues = (leaguesRaw ?? []).sort((a: any, b: any) => {
    const aE = a.ended ? 1 : 0;
    const bE = b.ended ? 1 : 0;
    return aE - bE || a.name.localeCompare(b.name);
  });

  const selectedLeagueName = leagues.find((l: any) => l.id === selectedLeague)?.name;

  // Build a dummy teamIdMap from players — teams are already resolved in getAllStats
  const teamIdMap: Record<string, string> = Object.fromEntries(
    stats.teams.filter(t => t.teamId).map(t => [t.name, t.teamId!])
  );

  return (
    <main style={{ minHeight: "calc(100vh - 56px)" }}>
      {/* Header */}
      <section style={{ borderBottom: "1px solid var(--border-main)", padding: "32px 24px 24px", background: "var(--bg-nav)" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto" }}>
          <div style={{ fontSize: 11, letterSpacing: "0.25em", color: "var(--text-faint)", fontWeight: 700, textTransform: "uppercase", marginBottom: 14 }}>
            <Link href="/" style={{ color: "var(--text-faint)", textDecoration: "none" }}>Home</Link>
            <span style={{ margin: "0 8px" }}>/</span>
            Stats
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 14 }}>
            <h1 style={{ fontSize: 32, fontWeight: 900, letterSpacing: "-0.02em", color: "var(--text-main)", margin: 0 }}>
              Stats
            </h1>
            {selectedLeagueName && (
              <span style={{ fontSize: 14, color: "var(--text-faint)" }}>{selectedLeagueName}</span>
            )}
            {!selectedLeagueName && (
              <span style={{ fontSize: 14, color: "var(--text-faint)" }}>All Leagues</span>
            )}
          </div>
        </div>
      </section>

      {/* Filter bar + section nav */}
      <Suspense>
        <StatsFilterBar leagues={leagues} selectedLeague={selectedLeague} />
      </Suspense>

      {/* Stats content — pass activeTab to control which section is shown */}
      <LeagueStatsClient
        key={`${selectedLeague}-${sp?.tab || "attacking"}`}
        playerStats={stats.players}
        teamStats={stats.teams}
        teamIdMap={teamIdMap}
        defaultSection={(sp?.tab as any) || "attacking"}
        hideSectionNav
      />
    </main>
  );
}
