import { createClient } from "@supabase/supabase-js";
import Link from "next/link";
import { Suspense } from "react";
import { StatsFilterBar } from "./StatsFilterBar";
import { LeagueStatsClient, type PlayerStat, type TeamStat } from "../leagues/[id]/LeagueStatsClient";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

async function getAllStats(
  leagueIds?: string[],
  season?: string,
  dayRange?: { from?: number; to?: number }
): Promise<{ players: PlayerStat[]; teams: TeamStat[]; matchdays: number[] }> {
  // If season filter, first get league IDs for that season
  let seasonLeagueIds: string[] | null = null;
  if (season) {
    const { data: seasonLeagues } = await supabase
      .from("leagues")
      .select("id")
      .eq("season", season);
    seasonLeagueIds = (seasonLeagues ?? []).map((l: any) => l.id);
    if (seasonLeagueIds.length === 0) return { players: [], teams: [], matchdays: [] };
  }

  // Combine league IDs from filter + season
  let filterIds: string[] | null = null;
  if (leagueIds && leagueIds.length > 0 && seasonLeagueIds) {
    // Intersection: only leagues that match both filters
    const seasonSet = new Set(seasonLeagueIds);
    filterIds = leagueIds.filter(id => seasonSet.has(id));
    if (filterIds.length === 0) return { players: [], teams: [], matchdays: [] };
  } else if (leagueIds && leagueIds.length > 0) {
    filterIds = leagueIds;
  } else if (seasonLeagueIds) {
    filterIds = seasonLeagueIds;
  }

  // Paginate matches (Supabase hard cap is 1000 rows per request)
  const PAGE = 1000;
  const allMatches: any[] = [];
  for (let from = 0; ; from += PAGE) {
    let q = supabase
      .from("matches")
      .select("id,home_team,away_team,home_score,away_score,day")
      .not("home_score", "is", null)
      .range(from, from + PAGE - 1);
    if (filterIds) q = q.in("league_id", filterIds);
    const { data: page } = await q;
    if (!page || page.length === 0) break;
    allMatches.push(...page);
    if (page.length < PAGE) break;
  }

  // All distinct matchdays in scope (drives the From/To filter dropdowns)
  const matchdaySet = new Set<number>();
  for (const m of allMatches) {
    if (m.day != null) matchdaySet.add(m.day);
  }
  const matchdays = [...matchdaySet].sort((a, b) => a - b);

  // Apply matchday-range filter in memory (null-day knockout matches are excluded by a range)
  const matches = allMatches.filter(
    m =>
      (dayRange?.from == null || (m.day != null && m.day >= dayRange.from)) &&
      (dayRange?.to == null || (m.day != null && m.day <= dayRange.to))
  );

  if (matches.length === 0) return { players: [], teams: [], matchdays };

  const matchIds = matches.map((m: any) => m.id);

  // Paginate player stats across all match IDs in chunks to avoid URL length limits
  const statsData: any[] = [];
  const MATCH_CHUNK = 200;
  for (let i = 0; i < matchIds.length; i += MATCH_CHUNK) {
    const chunk = matchIds.slice(i, i + MATCH_CHUNK);
    for (let from = 0; ; from += PAGE) {
      const { data: page } = await supabase
        .from("match_player_stats")
        .select("player_id,position,goals,assists,key_passes,passes,shots_on_target,tackles,key_tackles,interceptions,key_interceptions,possessions_lost,gk_saves,gk_catches,benched,players(id,name,handle)")
        .in("match_id", chunk)
        .range(from, from + PAGE - 1);
      if (!page || page.length === 0) break;
      statsData.push(...page);
      if (page.length < PAGE) break;
    }
  }

  const { data: allTeams } = await supabase.from("teams").select("id,name");

  const teamIdMap: Record<string, string> = Object.fromEntries(
    (allTeams ?? []).map((t: any) => [t.name, t.id])
  );

  const positionCounts: Record<string, Record<string, number>> = {};
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
    if (s.position) {
      if (!positionCounts[s.player_id]) positionCounts[s.player_id] = {};
      const pos = s.position.toUpperCase();
      positionCounts[s.player_id][pos] = (positionCounts[s.player_id][pos] ?? 0) + 1;
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

  // Assign most common position to each player
  for (const [pid, counts] of Object.entries(positionCounts)) {
    if (byPlayer[pid]) {
      byPlayer[pid].position = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
    }
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
    matchdays,
  };
}

export const revalidate = 60;

export default async function StatsPage({
  searchParams,
}: {
  searchParams?: Promise<{ league?: string; tab?: string; season?: string; from?: string; to?: string }>;
}) {
  const sp = await searchParams;
  const leagueParam = sp?.league || "";
  const selectedLeagues = leagueParam ? leagueParam.split(",").filter(Boolean) : [];
  const selectedSeason = sp?.season || "";
  const dayFromRaw = sp?.from ? Number(sp.from) : undefined;
  const dayToRaw = sp?.to ? Number(sp.to) : undefined;
  const dayFrom = Number.isFinite(dayFromRaw) ? dayFromRaw : undefined;
  const dayTo = Number.isFinite(dayToRaw) ? dayToRaw : undefined;
  const dayRange = dayFrom != null || dayTo != null ? { from: dayFrom, to: dayTo } : undefined;

  const [{ data: leaguesRaw }, stats, { data: teamLeaguesRaw }, { data: directTeamsRaw }] = await Promise.all([
    supabase.from("leagues").select("id,name,ended,season").order("name"),
    getAllStats(selectedLeagues.length > 0 ? selectedLeagues : undefined, selectedSeason || undefined, dayRange),
    supabase.from("team_leagues").select("team_id, teams(name), leagues(id,ended)").limit(10000),
    supabase.from("teams").select("name, league_id, leagues:league_id(id,ended)").limit(10000),
  ]);

  // Build set of team names that are in at least one active (non-ended) league
  const activeTeamNames = new Set<string>();
  for (const tl of teamLeaguesRaw ?? []) {
    const team = (tl as any).teams;
    const league = (tl as any).leagues;
    if (team?.name && league && !league.ended) activeTeamNames.add(team.name);
  }
  for (const t of directTeamsRaw ?? []) {
    const league = (t as any).leagues;
    if (t.name && league && !league.ended) activeTeamNames.add(t.name);
  }

  const leagues = (leaguesRaw ?? []).sort((a: any, b: any) => {
    const aE = a.ended ? 1 : 0;
    const bE = b.ended ? 1 : 0;
    return aE - bE || a.name.localeCompare(b.name);
  });

  const selectedLeagueNames = selectedLeagues.map(id => leagues.find((l: any) => l.id === id)?.name).filter(Boolean);

  // Get unique seasons
  const seasons = [...new Set((leaguesRaw ?? []).map((l: any) => l.season).filter(Boolean))].sort();

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
            {selectedLeagueNames.length > 0 ? (
              <span style={{ fontSize: 14, color: "var(--text-faint)" }}>{selectedLeagueNames.join(", ")}</span>
            ) : (
              <span style={{ fontSize: 14, color: "var(--text-faint)" }}>All Leagues</span>
            )}
          </div>
        </div>
      </section>

      {/* Filter bar + section nav */}
      <Suspense>
        <StatsFilterBar
          leagues={leagues}
          selectedLeagues={selectedLeagues}
          seasons={seasons}
          selectedSeason={selectedSeason}
          matchdays={stats.matchdays}
          dayFrom={dayFrom}
          dayTo={dayTo}
        />
      </Suspense>

      {/* Stats content — pass activeTab to control which section is shown */}
      <LeagueStatsClient
        key={`${leagueParam}-${selectedSeason}-${sp?.tab || "attacking"}-${dayFrom ?? ""}-${dayTo ?? ""}`}
        playerStats={stats.players}
        teamStats={stats.teams}
        teamIdMap={teamIdMap}
        defaultSection={(sp?.tab as any) || "attacking"}
        hideSectionNav
        activeTeamNames={[...activeTeamNames]}
        showTeamFilters
        showPlayerFilters
      />
    </main>
  );
}
