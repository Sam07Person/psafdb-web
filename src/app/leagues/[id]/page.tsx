// /src/app/leagues/[id]/page.tsx
import { createClient } from "@supabase/supabase-js";
import Link from "next/link";
import { notFound } from "next/navigation";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

async function getLeague(id: string) {
  const { data, error } = await supabase
    .from("leagues")
    .select("id, name, season, format, created_at")
    .eq("id", id)
    .single();

  if (error || !data) return null;
  return data;
}

async function getLeagueTeams(leagueId: string) {
  const { data, error } = await supabase
    .from("teams")
    .select("id, name")
    .eq("league_id", leagueId)
    .order("name", { ascending: true });

  if (error) {
    console.error("Error fetching league teams:", error);
    return [];
  }

  return data || [];
}

async function getLeagueMatches(leagueId: string) {
  const { data, error } = await supabase
    .from("matches")
    .select("id, home_team, away_team, home_score, away_score, played_at, stage, group_name")
    .eq("league_id", leagueId)
    .order("played_at", { ascending: false });

  if (error) {
    console.error("Error fetching league matches:", error);
    return [];
  }

  return data || [];
}

// Calculate standings from matches
function calculateStandings(teams: any[], matches: any[]) {
  const standings: Record<string, {
    team: string;
    played: number;
    won: number;
    drawn: number;
    lost: number;
    gf: number;
    ga: number;
    points: number;
  }> = {};

  // Initialize all teams
  for (const team of teams) {
    standings[team.name] = {
      team: team.name,
      played: 0,
      won: 0,
      drawn: 0,
      lost: 0,
      gf: 0,
      ga: 0,
      points: 0,
    };
  }

  // Also add teams from matches that might not be in teams table
  for (const match of matches) {
    if (!standings[match.home_team]) {
      standings[match.home_team] = {
        team: match.home_team,
        played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, points: 0,
      };
    }
    if (!standings[match.away_team]) {
      standings[match.away_team] = {
        team: match.away_team,
        played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, points: 0,
      };
    }
  }

  // Calculate from matches
  for (const match of matches) {
    if (match.home_score === null || match.away_score === null) continue;

    const home = standings[match.home_team];
    const away = standings[match.away_team];

    if (home) {
      home.played++;
      home.gf += match.home_score;
      home.ga += match.away_score;
      if (match.home_score > match.away_score) {
        home.won++;
        home.points += 3;
      } else if (match.home_score < match.away_score) {
        home.lost++;
      } else {
        home.drawn++;
        home.points += 1;
      }
    }

    if (away) {
      away.played++;
      away.gf += match.away_score;
      away.ga += match.home_score;
      if (match.away_score > match.home_score) {
        away.won++;
        away.points += 3;
      } else if (match.away_score < match.home_score) {
        away.lost++;
      } else {
        away.drawn++;
        away.points += 1;
      }
    }
  }

  return Object.values(standings).sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    const gdA = a.gf - a.ga;
    const gdB = b.gf - b.ga;
    if (gdB !== gdA) return gdB - gdA;
    return b.gf - a.gf;
  });
}

export const revalidate = 60;

export default async function LeagueDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const league = await getLeague(id);

  if (!league) notFound();

  const [teams, matches] = await Promise.all([
    getLeagueTeams(id),
    getLeagueMatches(id),
  ]);

  const standings = calculateStandings(teams, matches);
  const recentMatches = matches.slice(0, 10);
  const upcomingMatches = matches.filter(m => m.home_score === null).reverse().slice(0, 5);

  return (
    <main className="min-h-screen bg-gradient-to-b from-gray-900 to-gray-950 text-white">
      <div className="mx-auto max-w-5xl px-4 py-12">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-4 text-sm">
            <Link href="/" className="text-white/50 hover:text-white/80 transition">
              Home
            </Link>
            <span className="text-white/30">/</span>
            <Link href="/leagues" className="text-white/50 hover:text-white/80 transition">
              Leagues
            </Link>
          </div>
          <h1 className="mt-4 text-4xl font-bold">{league.name}</h1>
          <div className="mt-2 flex items-center gap-3">
            {league.season && (
              <span className="text-white/60">Season {league.season}</span>
            )}
            {league.format && (
              <span className="px-2 py-0.5 rounded bg-white/10 text-white/60 text-sm capitalize">
                {league.format.replace("_", " ")}
              </span>
            )}
          </div>
        </div>

        <div className="grid lg:grid-cols-3 gap-6">
          {/* Standings */}
          <div className="lg:col-span-2">
            <div className="rounded-xl bg-white/5 border border-white/10 overflow-hidden">
              <div className="px-4 py-3 border-b border-white/10 bg-white/5">
                <h2 className="font-semibold">Standings</h2>
              </div>

              {standings.length === 0 ? (
                <div className="p-8 text-center text-white/40">
                  No teams in this league yet
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-white/10 text-white/50">
                        <th className="px-3 py-2 text-left">#</th>
                        <th className="px-3 py-2 text-left">Team</th>
                        <th className="px-3 py-2 text-center">P</th>
                        <th className="px-3 py-2 text-center">W</th>
                        <th className="px-3 py-2 text-center">D</th>
                        <th className="px-3 py-2 text-center">L</th>
                        <th className="px-3 py-2 text-center">GD</th>
                        <th className="px-3 py-2 text-center">Pts</th>
                      </tr>
                    </thead>
                    <tbody>
                      {standings.map((row, index) => {
                        const gd = row.gf - row.ga;
                        return (
                          <tr key={row.team} className="border-b border-white/5 hover:bg-white/5">
                            <td className="px-3 py-2 text-white/50">{index + 1}</td>
                            <td className="px-3 py-2 font-medium">{row.team}</td>
                            <td className="px-3 py-2 text-center text-white/70">{row.played}</td>
                            <td className="px-3 py-2 text-center text-emerald-400">{row.won}</td>
                            <td className="px-3 py-2 text-center text-yellow-400">{row.drawn}</td>
                            <td className="px-3 py-2 text-center text-red-400">{row.lost}</td>
                            <td className={`px-3 py-2 text-center ${gd > 0 ? "text-emerald-400" : gd < 0 ? "text-red-400" : "text-white/50"}`}>
                              {gd > 0 ? "+" : ""}{gd}
                            </td>
                            <td className="px-3 py-2 text-center font-bold">{row.points}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* League Stats */}
            <div className="rounded-xl bg-white/5 border border-white/10 p-4">
              <h3 className="font-semibold mb-3">League Info</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-white/50">Teams</span>
                  <span>{standings.length}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-white/50">Matches Played</span>
                  <span>{matches.filter(m => m.home_score !== null).length}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-white/50">Total Goals</span>
                  <span>
                    {matches.reduce((sum, m) => sum + (m.home_score || 0) + (m.away_score || 0), 0)}
                  </span>
                </div>
              </div>
            </div>

            {/* Upcoming Matches */}
            {upcomingMatches.length > 0 && (
              <div className="rounded-xl bg-white/5 border border-white/10 overflow-hidden">
                <div className="px-4 py-3 border-b border-white/10 bg-white/5">
                  <h3 className="font-semibold text-sm">Upcoming</h3>
                </div>
                <div className="divide-y divide-white/5">
                  {upcomingMatches.map((match) => (
                    <Link
                      key={match.id}
                      href={`/matches/${match.id}`}
                      className="block p-3 hover:bg-white/5 transition"
                    >
                      <div className="text-sm">
                        <span className="font-medium">{match.home_team}</span>
                        <span className="text-white/40 mx-2">vs</span>
                        <span className="font-medium">{match.away_team}</span>
                      </div>
                      <div className="text-xs text-white/40 mt-1">
                        {new Date(match.played_at).toLocaleDateString()}
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Recent Results */}
        <div className="mt-6 rounded-xl bg-white/5 border border-white/10 overflow-hidden">
          <div className="px-4 py-3 border-b border-white/10 bg-white/5">
            <h2 className="font-semibold">Recent Results</h2>
          </div>

          {recentMatches.filter(m => m.home_score !== null).length === 0 ? (
            <div className="p-8 text-center text-white/40">
              No matches played yet
            </div>
          ) : (
            <div className="divide-y divide-white/5">
              {recentMatches.filter(m => m.home_score !== null).map((match) => {
                const date = new Date(match.played_at);
                return (
                  <Link
                    key={match.id}
                    href={`/matches/${match.id}`}
                    className="flex items-center justify-between p-4 hover:bg-white/5 transition"
                  >
                    <div className="flex-1">
                      <span className="font-medium">{match.home_team}</span>
                    </div>
                    <div className="px-4 text-center">
                      <span className="font-mono font-bold text-lg">
                        {match.home_score} - {match.away_score}
                      </span>
                    </div>
                    <div className="flex-1 text-right">
                      <span className="font-medium">{match.away_team}</span>
                    </div>
                    <div className="ml-4 text-xs text-white/40 w-20 text-right">
                      {date.toLocaleDateString()}
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