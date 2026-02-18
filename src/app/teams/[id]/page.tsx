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

export const revalidate = 60;

export default async function TeamDetailPage({
    params,
}: {
    params: Promise<{ id: string }>;
}) {
    const { id } = await params;
    const team = await getTeam(id);

    if (!team) notFound();

    const [matches, stats] = await Promise.all([
        getTeamMatches(team.name),
        getTeamStats(team.name),
    ]);

    const points = stats.won * 3 + stats.drawn;
    const gd = stats.gf - stats.ga;
    const winRate = stats.played > 0 ? Math.round((stats.won / stats.played) * 100) : 0;

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
                        <Link href="/teams" className="text-white/50 hover:text-white/80 transition">
                            Teams
                        </Link>
                    </div>

                    <h1 className="mt-4 text-4xl font-bold">{team.name}</h1>

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
                                        {/* Result Badge */}
                                        <div
                                            className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold ${result === "W"
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

                                        {/* Match Info */}
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2">
                                                <span className="text-xs text-white/40">
                                                    {isHome ? "vs" : "@"}
                                                </span>
                                                <span className="font-medium truncate">{opponent}</span>
                                            </div>
                                            <div className="flex items-center gap-2 mt-0.5">
                                                {match.league && (
                                                    <span className="text-xs text-white/40">
                                                        {match.league.name}
                                                    </span>
                                                )}
                                                <span className="text-xs text-white/30">
                                                    {date.toLocaleDateString()}
                                                </span>
                                            </div>
                                        </div>

                                        {/* Score */}
                                        <div className="text-right">
                                            {isPlayed ? (
                                                <span className="font-mono font-bold">
                                                    {scored} - {conceded}
                                                </span>
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