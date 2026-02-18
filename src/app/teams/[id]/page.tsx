import { createClient } from "@supabase/supabase-js";
import Link from "next/link";
import { notFound } from "next/navigation";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

async function getTeam(id: string) {
  const { data, error } = await supabase
    .from("teams")
    .select(`
      id,
      name,
      league_id,
      created_at,
      league:leagues!teams_league_id_fkey(id, name, season)
    `)
    .eq("id", id)
    .single();

  if (error || !data) return null;

  return {
    ...data,
    league: Array.isArray(data.league) ? data.league[0] : data.league,
  };
}

async function getTeamMatches(teamName: string) {
  const { data } = await supabase
    .from("matches")
    .select(`
      id,
      home_team,
      away_team,
      home_score,
      away_score,
      played_at,
      league:leagues!matches_league_id_fkey(id, name)
    `)
    .or(`home_team.eq.${teamName},away_team.eq.${teamName}`)
    .order("played_at", { ascending: false })
    .limit(20);

  return (data || []).map((m: any) => ({
    ...m,
    league: Array.isArray(m.league) ? m.league[0] : m.league,
  }));
}

async function getTeamStats(teamName: string) {
  const { data: matches } = await supabase
    .from("matches")
    .select("home_team, away_team, home_score, away_score")
    .or(`home_team.eq.${teamName},away_team.eq.${teamName}`);

  if (!matches || matches.length === 0) {
    return { played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0 };
  }

  let won = 0, drawn = 0, lost = 0, gf = 0, ga = 0;

  for (const m of matches) {
    if (m.home_score === null || m.away_score === null) continue;

    const isHome = m.home_team === teamName;
    const scored = isHome ? m.home_score : m.away_score;
    const conceded = isHome ? m.away_score : m.home_score;

    gf += scored;
    ga += conceded;

    if (scored > conceded) won++;
    else if (scored < conceded) lost++;
    else drawn++;
  }

  return { played: won + drawn + lost, won, drawn, lost, gf, ga };
}

type PlayerWithStats = {
  id: string;
  name: string | null;
  handle: string | null;
  matches_for_team: number;
  goals: number;
  assists: number;
  last_position: string | null;
  last_match_date: string;
};

async function getTeamSquad(teamName: string): Promise<PlayerWithStats[]> {
  // Get all matches for this team
  const { data: matches } = await supabase
    .from("matches")
    .select("id, home_team, away_team, played_at")
    .or(`home_team.eq.${teamName},away_team.eq.${teamName}`)
    .order("played_at", { ascending: false });

  if (!matches || matches.length === 0) return [];

  const matchIds = matches.map(m => m.id);
  
  // Determine team_side for each match
  const matchTeamSide: Record<string, "home" | "away"> = {};
  for (const m of matches) {
    matchTeamSide[m.id] = m.home_team === teamName ? "home" : "away";
  }

  // Get all player stats for these matches where they played for this team
  const { data: playerStats } = await supabase
    .from("match_player_stats")
    .select("player_id, match_id, team_side, goals, assists, position")
    .in("match_id", matchIds);

  if (!playerStats) return [];

  // Filter to only stats where player was on our team
  const teamPlayerStats = playerStats.filter(ps => ps.team_side === matchTeamSide[ps.match_id]);

  // Aggregate by player
  const playerMap: Record<string, {
    matches: number;
    goals: number;
    assists: number;
    lastPosition: string | null;
    lastMatchId: string;
  }> = {};

  for (const ps of teamPlayerStats) {
    if (!playerMap[ps.player_id]) {
      playerMap[ps.player_id] = {
        matches: 0,
        goals: 0,
        assists: 0,
        lastPosition: null,
        lastMatchId: ps.match_id,
      };
    }
    playerMap[ps.player_id].matches++;
    playerMap[ps.player_id].goals += ps.goals || 0;
    playerMap[ps.player_id].assists += ps.assists || 0;
    
    // Track the most recent position
    const matchDate = matches.find(m => m.id === ps.match_id)?.played_at || "";
    const currentLastDate = matches.find(m => m.id === playerMap[ps.player_id].lastMatchId)?.played_at || "";
    if (matchDate >= currentLastDate) {
      playerMap[ps.player_id].lastPosition = ps.position;
      playerMap[ps.player_id].lastMatchId = ps.match_id;
    }
  }

  // Get player details
  const playerIds = Object.keys(playerMap);
  if (playerIds.length === 0) return [];

  const { data: players } = await supabase
    .from("players")
    .select("id, name, handle")
    .in("id", playerIds);

  if (!players) return [];

  // Now determine which players have this team as their LAST club
  // Get ALL match_player_stats for these players to check their most recent match
  const { data: allPlayerStats } = await supabase
    .from("match_player_stats")
    .select("player_id, match_id, team_side")
    .in("player_id", playerIds);

  // Get all unique match IDs
  const allMatchIds = [...new Set((allPlayerStats || []).map(ps => ps.match_id))];
  
  const { data: allMatches } = await supabase
    .from("matches")
    .select("id, home_team, away_team, played_at")
    .in("id", allMatchIds);

  // For each player, find their most recent match and check if it was for this team
  const playersWithLastClub: PlayerWithStats[] = [];

  for (const player of players) {
    const playerAllStats = (allPlayerStats || []).filter(ps => ps.player_id === player.id);
    
    // Find most recent match for this player
    let mostRecentMatch: { id: string; date: string; team: string } | null = null;
    
    for (const ps of playerAllStats) {
      const match = (allMatches || []).find(m => m.id === ps.match_id);
      if (match) {
        const playedFor = ps.team_side === "home" ? match.home_team : match.away_team;
        if (!mostRecentMatch || match.played_at > mostRecentMatch.date) {
          mostRecentMatch = { id: match.id, date: match.played_at, team: playedFor };
        }
      }
    }

    // Only include if their last club is this team
    if (mostRecentMatch && mostRecentMatch.team === teamName) {
      const stats = playerMap[player.id];
      playersWithLastClub.push({
        id: player.id,
        name: player.name,
        handle: player.handle,
        matches_for_team: stats.matches,
        goals: stats.goals,
        assists: stats.assists,
        last_position: stats.lastPosition,
        last_match_date: mostRecentMatch.date,
      });
    }
  }

  // Sort by matches played (descending)
  return playersWithLastClub.sort((a, b) => b.matches_for_team - a.matches_for_team);
}

// Get all players who have ever played for this team
async function getTeamAllTimePlayers(teamName: string): Promise<PlayerWithStats[]> {
  const { data: matches } = await supabase
    .from("matches")
    .select("id, home_team, away_team, played_at")
    .or(`home_team.eq.${teamName},away_team.eq.${teamName}`)
    .order("played_at", { ascending: false });

  if (!matches || matches.length === 0) return [];

  const matchIds = matches.map(m => m.id);
  
  const matchTeamSide: Record<string, "home" | "away"> = {};
  for (const m of matches) {
    matchTeamSide[m.id] = m.home_team === teamName ? "home" : "away";
  }

  const { data: playerStats } = await supabase
    .from("match_player_stats")
    .select("player_id, match_id, team_side, goals, assists, position")
    .in("match_id", matchIds);

  if (!playerStats) return [];

  const teamPlayerStats = playerStats.filter(ps => ps.team_side === matchTeamSide[ps.match_id]);

  const playerMap: Record<string, {
    matches: number;
    goals: number;
    assists: number;
    lastPosition: string | null;
    lastMatchDate: string;
  }> = {};

  for (const ps of teamPlayerStats) {
    const matchDate = matches.find(m => m.id === ps.match_id)?.played_at || "";
    
    if (!playerMap[ps.player_id]) {
      playerMap[ps.player_id] = {
        matches: 0,
        goals: 0,
        assists: 0,
        lastPosition: null,
        lastMatchDate: "",
      };
    }
    playerMap[ps.player_id].matches++;
    playerMap[ps.player_id].goals += ps.goals || 0;
    playerMap[ps.player_id].assists += ps.assists || 0;
    
    if (matchDate >= playerMap[ps.player_id].lastMatchDate) {
      playerMap[ps.player_id].lastPosition = ps.position;
      playerMap[ps.player_id].lastMatchDate = matchDate;
    }
  }

  const playerIds = Object.keys(playerMap);
  if (playerIds.length === 0) return [];

  const { data: players } = await supabase
    .from("players")
    .select("id, name, handle")
    .in("id", playerIds);

  if (!players) return [];

  return players.map(player => {
    const stats = playerMap[player.id];
    return {
      id: player.id,
      name: player.name,
      handle: player.handle,
      matches_for_team: stats.matches,
      goals: stats.goals,
      assists: stats.assists,
      last_position: stats.lastPosition,
      last_match_date: stats.lastMatchDate,
    };
  }).sort((a, b) => b.matches_for_team - a.matches_for_team);
}

const POSITION_COLORS: Record<string, string> = {
  GK: "border-yellow-400/30 bg-yellow-400/10 text-yellow-200",
  LB: "border-green-400/30 bg-green-400/10 text-green-200",
  RB: "border-green-400/30 bg-green-400/10 text-green-200",
  CB: "border-green-400/30 bg-green-400/10 text-green-200",
  LCB: "border-green-400/30 bg-green-400/10 text-green-200",
  RCB: "border-green-400/30 bg-green-400/10 text-green-200",
  LWB: "border-teal-400/30 bg-teal-400/10 text-teal-200",
  RWB: "border-teal-400/30 bg-teal-400/10 text-teal-200",
  CM: "border-blue-400/30 bg-blue-400/10 text-blue-200",
  CDM: "border-blue-400/30 bg-blue-400/10 text-blue-200",
  CAM: "border-blue-400/30 bg-blue-400/10 text-blue-200",
  LM: "border-blue-400/30 bg-blue-400/10 text-blue-200",
  RM: "border-blue-400/30 bg-blue-400/10 text-blue-200",
  LW: "border-purple-400/30 bg-purple-400/10 text-purple-200",
  RW: "border-purple-400/30 bg-purple-400/10 text-purple-200",
  LF: "border-orange-400/30 bg-orange-400/10 text-orange-200",
  RF: "border-orange-400/30 bg-orange-400/10 text-orange-200",
  CF: "border-red-400/30 bg-red-400/10 text-red-200",
  ST: "border-red-400/30 bg-red-400/10 text-red-200",
};

export const revalidate = 60;

export default async function TeamDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const team = await getTeam(id);

  if (!team) notFound();

  const [matches, stats, currentSquad, allTimePlayers] = await Promise.all([
    getTeamMatches(team.name),
    getTeamStats(team.name),
    getTeamSquad(team.name),
    getTeamAllTimePlayers(team.name),
  ]);

  const points = stats.won * 3 + stats.drawn;
  const gd = stats.gf - stats.ga;
  const winRate = stats.played > 0 ? Math.round((stats.won / stats.played) * 100) : 0;

  // Players who have played for this team but are now at another club
  const formerPlayers = allTimePlayers.filter(
    p => !currentSquad.find(cs => cs.id === p.id)
  );

  return (
    <main className="min-h-screen bg-gradient-to-b from-gray-900 to-gray-950 text-white">
      <div className="mx-auto max-w-5xl px-4 py-12">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-sm mb-6">
          <Link href="/" className="text-white/50 hover:text-white/80 transition">Home</Link>
          <span className="text-white/30">/</span>
          <Link href="/teams" className="text-white/50 hover:text-white/80 transition">Teams</Link>
        </div>

        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold">{team.name}</h1>

          {team.league && (
            <Link
              href={`/leagues/${team.league.id}`}
              className="mt-2 inline-block text-white/60 hover:text-white/80 transition"
            >
              {team.league.name}
              {team.league.season && ` (${team.league.season})`}
            </Link>
          )}
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4 mb-8">
          <div className="rounded-xl bg-white/5 border border-white/10 p-4 text-center">
            <p className="text-2xl font-bold">{stats.played}</p>
            <p className="text-xs text-white/50 mt-1">Played</p>
          </div>
          <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/30 p-4 text-center">
            <p className="text-2xl font-bold text-emerald-400">{stats.won}</p>
            <p className="text-xs text-white/50 mt-1">Won</p>
          </div>
          <div className="rounded-xl bg-yellow-500/10 border border-yellow-500/30 p-4 text-center">
            <p className="text-2xl font-bold text-yellow-400">{stats.drawn}</p>
            <p className="text-xs text-white/50 mt-1">Drawn</p>
          </div>
          <div className="rounded-xl bg-red-500/10 border border-red-500/30 p-4 text-center">
            <p className="text-2xl font-bold text-red-400">{stats.lost}</p>
            <p className="text-xs text-white/50 mt-1">Lost</p>
          </div>
          <div className="rounded-xl bg-white/5 border border-white/10 p-4 text-center">
            <p className="text-2xl font-bold">{stats.gf}:{stats.ga}</p>
            <p className="text-xs text-white/50 mt-1">Goals</p>
          </div>
          <div className="rounded-xl bg-white/5 border border-white/10 p-4 text-center">
            <p className={`text-2xl font-bold ${gd > 0 ? "text-emerald-400" : gd < 0 ? "text-red-400" : ""}`}>
              {gd > 0 ? "+" : ""}{gd}
            </p>
            <p className="text-xs text-white/50 mt-1">GD</p>
          </div>
          <div className="rounded-xl bg-blue-500/10 border border-blue-500/30 p-4 text-center">
            <p className="text-2xl font-bold text-blue-400">{points}</p>
            <p className="text-xs text-white/50 mt-1">Points</p>
          </div>
        </div>

        {/* Win Rate Bar */}
        <div className="mb-8 rounded-xl bg-white/5 border border-white/10 p-4">
          <div className="flex justify-between items-center mb-2">
            <span className="text-sm text-white/60">Win Rate</span>
            <span className="text-sm font-medium">{winRate}%</span>
          </div>
          <div className="h-2 bg-white/10 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-emerald-500 to-emerald-400 rounded-full transition-all"
              style={{ width: `${winRate}%` }}
            />
          </div>
        </div>

        <div className="grid lg:grid-cols-2 gap-6 mb-8">
          {/* Current Squad */}
          <div className="rounded-xl bg-white/5 border border-white/10 overflow-hidden">
            <div className="px-4 py-3 border-b border-white/10 bg-white/5">
              <h2 className="font-semibold">Current Squad ({currentSquad.length})</h2>
              <p className="text-xs text-white/50">Players whose last match was for this team</p>
            </div>
            
            {currentSquad.length === 0 ? (
              <div className="p-6 text-center text-white/40">No current players</div>
            ) : (
              <div className="divide-y divide-white/5">
                {currentSquad.map((player) => (
                  <Link
                    key={player.id}
                    href={`/players/${player.id}`}
                    className="flex items-center justify-between p-3 hover:bg-white/5 transition"
                  >
                    <div className="flex items-center gap-3">
                      {player.last_position && (
                        <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${POSITION_COLORS[player.last_position] || "border-white/30 bg-white/10 text-white/80"}`}>
                          {player.last_position}
                        </span>
                      )}
                      <span className="font-medium">{player.name || player.handle}</span>
                    </div>
                    <div className="flex items-center gap-3 text-sm">
                      <span className="text-white/50">{player.matches_for_team} apps</span>
                      {player.goals > 0 && <span className="text-emerald-400">{player.goals}G</span>}
                      {player.assists > 0 && <span className="text-sky-400">{player.assists}A</span>}
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>

          {/* Former Players */}
          <div className="rounded-xl bg-white/5 border border-white/10 overflow-hidden">
            <div className="px-4 py-3 border-b border-white/10 bg-white/5">
              <h2 className="font-semibold">Former Players ({formerPlayers.length})</h2>
              <p className="text-xs text-white/50">Players who have moved to other teams</p>
            </div>
            
            {formerPlayers.length === 0 ? (
              <div className="p-6 text-center text-white/40">No former players</div>
            ) : (
              <div className="divide-y divide-white/5 max-h-80 overflow-y-auto">
                {formerPlayers.map((player) => (
                  <Link
                    key={player.id}
                    href={`/players/${player.id}`}
                    className="flex items-center justify-between p-3 hover:bg-white/5 transition"
                  >
                    <div className="flex items-center gap-3">
                      {player.last_position && (
                        <span className={`rounded-full border px-2 py-0.5 text-xs font-medium opacity-60 ${POSITION_COLORS[player.last_position] || "border-white/30 bg-white/10 text-white/80"}`}>
                          {player.last_position}
                        </span>
                      )}
                      <span className="text-white/70">{player.name || player.handle}</span>
                    </div>
                    <div className="flex items-center gap-3 text-sm">
                      <span className="text-white/40">{player.matches_for_team} apps</span>
                      {player.goals > 0 && <span className="text-emerald-400/70">{player.goals}G</span>}
                      {player.assists > 0 && <span className="text-sky-400/70">{player.assists}A</span>}
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Recent Matches */}
        <div className="rounded-xl bg-white/5 border border-white/10 overflow-hidden">
          <div className="px-4 py-3 border-b border-white/10 bg-white/5">
            <h2 className="font-semibold">Recent Matches</h2>
          </div>

          {matches.length === 0 ? (
            <div className="p-8 text-center text-white/40">
              No matches found
            </div>
          ) : (
            <div className="divide-y divide-white/5">
              {matches.map((match) => {
                const isHome = match.home_team === team.name;
                const scored = isHome ? match.home_score : match.away_score;
                const conceded = isHome ? match.away_score : match.home_score;
                const opponent = isHome ? match.away_team : match.home_team;
                const isPlayed = match.home_score !== null && match.away_score !== null;

                let result: "W" | "D" | "L" | null = null;
                if (isPlayed) {
                  if (scored > conceded) result = "W";
                  else if (scored < conceded) result = "L";
                  else result = "D";
                }

                const date = new Date(match.played_at);

                return (
                  <Link
                    key={match.id}
                    href={`/matches/${match.id}`}
                    className="flex items-center gap-4 p-4 hover:bg-white/5 transition"
                  >
                    <div
                      className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold ${
                        result === "W"
                          ? "bg-emerald-500/20 text-emerald-400"
                          : result === "L"
                          ? "bg-red-500/20 text-red-400"
                          : result === "D"
                          ? "bg-yellow-500/20 text-yellow-400"
                          : "bg-white/10 text-white/40"
                      }`}
                    >
                      {result || "—"}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-white/40">{isHome ? "vs" : "@"}</span>
                        <span className="font-medium truncate">{opponent}</span>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        {match.league && (
                          <span className="text-xs text-white/40">{match.league.name}</span>
                        )}
                        <span className="text-xs text-white/30">{date.toLocaleDateString()}</span>
                      </div>
                    </div>

                    <div className="text-right">
                      {isPlayed ? (
                        <span className="font-mono font-bold">{scored} - {conceded}</span>
                      ) : (
                        <span className="text-white/40 text-sm">Upcoming</span>
                      )}
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}