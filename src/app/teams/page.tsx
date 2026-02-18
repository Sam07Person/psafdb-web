import { createClient } from "@supabase/supabase-js";
import Link from "next/link";

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

type Team = {
    id: string;
    name: string;
    league_id: string | null;
    created_at: string;
    league?: { id: string; name: string; season: string | null } | null;
};

async function getTeams(): Promise<Team[]> {
    const { data, error } = await supabase
        .from("teams")
        .select(`
      id,
      name,
      league_id,
      created_at,
      league:leagues!teams_league_id_fkey(id, name, season)
    `)
        .order("name", { ascending: true });

    if (error) {
        console.error("Error fetching teams:", error);
        return [];
    }

    return (data || []).map((t: any) => ({
        ...t,
        league: Array.isArray(t.league) ? t.league[0] : t.league,
    }));
}

// Get match stats for each team
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

export const revalidate = 60;

export default async function TeamsPage() {
    const teams = await getTeams();

    // Get stats for all teams
    const teamsWithStats = await Promise.all(
        teams.map(async (team) => ({
            ...team,
            stats: await getTeamStats(team.name),
        }))
    );

    // Sort by points (W*3 + D*1), then goal difference
    teamsWithStats.sort((a, b) => {
        const pointsA = a.stats.won * 3 + a.stats.drawn;
        const pointsB = b.stats.won * 3 + b.stats.drawn;
        if (pointsB !== pointsA) return pointsB - pointsA;
        const gdA = a.stats.gf - a.stats.ga;
        const gdB = b.stats.gf - b.stats.ga;
        return gdB - gdA;
    });

    return (
        <main className="min-h-screen bg-gradient-to-b from-gray-900 to-gray-950 text-white">
            <div className="mx-auto max-w-5xl px-4 py-12">
                {/* Header */}
                <div className="mb-8">
                    <div className="flex items-center gap-4 text-sm">
                        <Link href="/" className="text-white/50 hover:text-white/80 transition">
                            ← Home
                        </Link>
                    </div>
                    <h1 className="mt-4 text-4xl font-bold">Teams</h1>
                    <p className="mt-2 text-white/60">
                        {teams.length} team{teams.length !== 1 ? "s" : ""} registered
                    </p>
                </div>

                {/* Teams Table */}
                {teams.length === 0 ? (
                    <div className="rounded-xl bg-white/5 border border-white/10 p-12 text-center">
                        <p className="text-white/40 text-lg">No teams found</p>
                    </div>
                ) : (
                    <div className="rounded-xl bg-white/5 border border-white/10 overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="w-full">
                                <thead>
                                    <tr className="border-b border-white/10 bg-white/5">
                                        <th className="px-4 py-3 text-left text-sm font-semibold text-white/70">#</th>
                                        <th className="px-4 py-3 text-left text-sm font-semibold text-white/70">Team</th>
                                        <th className="px-4 py-3 text-left text-sm font-semibold text-white/70">League</th>
                                        <th className="px-4 py-3 text-center text-sm font-semibold text-white/70">P</th>
                                        <th className="px-4 py-3 text-center text-sm font-semibold text-white/70">W</th>
                                        <th className="px-4 py-3 text-center text-sm font-semibold text-white/70">D</th>
                                        <th className="px-4 py-3 text-center text-sm font-semibold text-white/70">L</th>
                                        <th className="px-4 py-3 text-center text-sm font-semibold text-white/70">GF</th>
                                        <th className="px-4 py-3 text-center text-sm font-semibold text-white/70">GA</th>
                                        <th className="px-4 py-3 text-center text-sm font-semibold text-white/70">GD</th>
                                        <th className="px-4 py-3 text-center text-sm font-semibold text-white/70">Pts</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {teamsWithStats.map((team, index) => {
                                        const points = team.stats.won * 3 + team.stats.drawn;
                                        const gd = team.stats.gf - team.stats.ga;

                                        return (
                                            <tr
                                                key={team.id}
                                                className="border-b border-white/5 hover:bg-white/5 transition"
                                            >
                                                <td className="px-4 py-3 text-white/50 text-sm">
                                                    {index + 1}
                                                </td>
                                                <td className="px-4 py-3">
                                                    <Link
                                                        href={`/teams/${team.id}`}
                                                        className="font-medium text-white hover:text-emerald-400 transition"
                                                    >
                                                        {team.name}
                                                    </Link>
                                                </td>
                                                <td className="px-4 py-3">
                                                    {team.league ? (
                                                        <Link
                                                            href={`/leagues/${team.league.id}`}
                                                            className="text-sm text-white/60 hover:text-white/80 transition"
                                                        >
                                                            {team.league.name}
                                                            {team.league.season && (
                                                                <span className="text-white/40 ml-1">
                                                                    ({team.league.season})
                                                                </span>
                                                            )}
                                                        </Link>
                                                    ) : (
                                                        <span className="text-white/30 text-sm">—</span>
                                                    )}
                                                </td>
                                                <td className="px-4 py-3 text-center text-white/70">
                                                    {team.stats.played}
                                                </td>
                                                <td className="px-4 py-3 text-center text-emerald-400">
                                                    {team.stats.won}
                                                </td>
                                                <td className="px-4 py-3 text-center text-yellow-400">
                                                    {team.stats.drawn}
                                                </td>
                                                <td className="px-4 py-3 text-center text-red-400">
                                                    {team.stats.lost}
                                                </td>
                                                <td className="px-4 py-3 text-center text-white/70">
                                                    {team.stats.gf}
                                                </td>
                                                <td className="px-4 py-3 text-center text-white/70">
                                                    {team.stats.ga}
                                                </td>
                                                <td className="px-4 py-3 text-center">
                                                    <span
                                                        className={
                                                            gd > 0
                                                                ? "text-emerald-400"
                                                                : gd < 0
                                                                    ? "text-red-400"
                                                                    : "text-white/50"
                                                        }
                                                    >
                                                        {gd > 0 ? "+" : ""}
                                                        {gd}
                                                    </span>
                                                </td>
                                                <td className="px-4 py-3 text-center font-bold text-white">
                                                    {points}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

                {/* Legend */}
                <div className="mt-4 flex flex-wrap gap-4 text-xs text-white/40">
                    <span>P = Played</span>
                    <span>W = Won</span>
                    <span>D = Drawn</span>
                    <span>L = Lost</span>
                    <span>GF = Goals For</span>
                    <span>GA = Goals Against</span>
                    <span>GD = Goal Difference</span>
                    <span>Pts = Points</span>
                </div>
            </div>
        </main>
    );
}