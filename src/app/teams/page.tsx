import { createClient } from "@supabase/supabase-js";
import Link from "next/link";
import TeamsTable from "./TeamsTable";
import { calcMatchRating, calcOverallRating, DEFAULT_TIER_BONUSES, type MatchStatRow, type MatchResult } from "@/lib/ratings";

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

type Team = {
    id: string;
    name: string;
    league_id: string | null;
    created_at: string;
    league: { id: string; name: string; season: string | null } | null;
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
        league: Array.isArray(t.league) ? (t.league[0] ?? null) : (t.league ?? null),
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

// Batch-compute team ratings for all teams using 2 queries total.
// Team rating = average of current squad players' individual ratings (≥3 rated players required).
// Current squad = players whose most recent match was for this team.
async function computeAllTeamRatings(teamNames: string[]): Promise<Map<string, number | null>> {
    if (teamNames.length === 0) return new Map();

    const { data: tierSettingsData } = await supabase.from("tier_settings").select("tier,bonus");
    const tierBonuses: Record<number, number> = { ...DEFAULT_TIER_BONUSES };
    if (tierSettingsData) for (const row of tierSettingsData) tierBonuses[row.tier] = row.bonus;

    // Q1: all matches with league tier
    const { data: matchesRaw } = await supabase
        .from("matches")
        .select("id,home_team,away_team,played_at,home_score,away_score,leagues(tier)");

    if (!matchesRaw) return new Map(teamNames.map(n => [n, null]));

    const matchMap = new Map<string, any>();
    for (const m of matchesRaw as any[]) {
        matchMap.set(m.id, {
            ...m,
            leagues: Array.isArray(m.leagues) ? m.leagues[0] ?? null : m.leagues ?? null,
        });
    }

    // Q2: all player stats (no join — use matchMap for match info)
    const { data: statsRaw } = await supabase
        .from("match_player_stats")
        .select("player_id,match_id,team_side,goals,assists,key_passes,shots_on_target,passes,tackles,key_tackles,interceptions,key_interceptions,possessions_lost,gk_saves,gk_catches,score,position,benched,stats_incomplete");

    if (!statsRaw) return new Map(teamNames.map(n => [n, null]));

    const teamNameSet = new Set(teamNames);

    // Group stats per player, attaching match info
    const statsByPlayer = new Map<string, any[]>();
    for (const stat of statsRaw as any[]) {
        const matchInfo = matchMap.get(stat.match_id);
        if (!matchInfo) continue;
        const list = statsByPlayer.get(stat.player_id) ?? [];
        list.push({ ...stat, matchInfo });
        statsByPlayer.set(stat.player_id, list);
    }

    // Determine each player's current team (most recent match overall)
    const playerCurrentTeam = new Map<string, string>();
    for (const [playerId, stats] of statsByPlayer) {
        let latestDate = "";
        let latestTeam = "";
        for (const s of stats) {
            if (s.matchInfo.played_at > latestDate) {
                latestDate = s.matchInfo.played_at;
                latestTeam = s.team_side === "home" ? s.matchInfo.home_team : s.matchInfo.away_team;
            }
        }
        if (latestTeam && teamNameSet.has(latestTeam)) {
            playerCurrentTeam.set(playerId, latestTeam);
        }
    }

    // Compute individual rating per current-squad player, accumulate per team
    const teamRatingAccum = new Map<string, number[]>();

    for (const [playerId, currentTeam] of playerCurrentTeam) {
        const stats = statsByPlayer.get(playerId) ?? [];
        const played = stats.filter((s: any) => !s.benched && !s.stats_incomplete);

        if (played.length < 3) continue;

        // Dominant position
        const posCounts = new Map<string, number>();
        for (const s of played) {
            if (s.position) posCounts.set(s.position, (posCounts.get(s.position) ?? 0) + 1);
        }
        let dominantPos: string | null = null, maxPosCount = 0;
        for (const [pos, count] of posCounts) {
            if (count > maxPosCount) { maxPosCount = count; dominantPos = pos; }
        }

        // Dominant tier
        const tierCounts = new Map<number, number>();
        for (const s of played) {
            const tier = s.matchInfo.leagues?.tier ?? 2;
            tierCounts.set(tier, (tierCounts.get(tier) ?? 0) + 1);
        }
        let dominantTier = 2, maxTierCount = 0;
        for (const [tier, count] of tierCounts) {
            if (count > maxTierCount) { maxTierCount = count; dominantTier = tier; }
        }

        // Per-match ratings
        const matchRatingValues: number[] = [];
        for (const s of played) {
            const m = s.matchInfo;
            const isHome = s.team_side === "home";
            const my = isHome ? (m.home_score ?? 0) : (m.away_score ?? 0);
            const opp = isHome ? (m.away_score ?? 0) : (m.home_score ?? 0);
            const result: MatchResult = my > opp ? "W" : my < opp ? "L" : "D";
            const statRow: MatchStatRow = {
                goals: s.goals ?? 0, assists: s.assists ?? 0, key_passes: s.key_passes ?? 0,
                shots_on_target: s.shots_on_target ?? 0, passes: s.passes ?? 0,
                tackles: s.tackles ?? 0, key_tackles: s.key_tackles ?? 0,
                interceptions: s.interceptions ?? 0, key_interceptions: s.key_interceptions ?? 0,
                possessions_lost: s.possessions_lost ?? 0, gk_saves: s.gk_saves ?? 0,
                gk_catches: s.gk_catches ?? 0, goals_conceded: opp, score: s.score ?? 0, position: s.position,
            };
            matchRatingValues.push(calcMatchRating(statRow, result, s.position ?? dominantPos));
        }

        const playerRating = calcOverallRating(matchRatingValues, dominantTier, tierBonuses);
        const existing = teamRatingAccum.get(currentTeam) ?? [];
        existing.push(playerRating);
        teamRatingAccum.set(currentTeam, existing);
    }

    // Final team ratings — require ≥3 rated squad members
    const result = new Map<string, number | null>();
    for (const teamName of teamNames) {
        const ratings = teamRatingAccum.get(teamName) ?? [];
        result.set(
            teamName,
            ratings.length >= 3
                ? Math.round(ratings.reduce((a, b) => a + b, 0) / ratings.length)
                : null
        );
    }
    return result;
}

export const revalidate = 60;

export default async function TeamsPage() {
    const teams = await getTeams();

    const [teamsWithStats, teamRatings] = await Promise.all([
        Promise.all(
            teams.map(async (team) => ({
                ...team,
                stats: await getTeamStats(team.name),
            }))
        ),
        computeAllTeamRatings(teams.map(t => t.name)),
    ]);

    const teamsWithRatings = teamsWithStats.map(t => ({
        ...t,
        rating: teamRatings.get(t.name) ?? null,
    }));

    // Sort by points (W*3 + D*1), then goal difference
    teamsWithRatings.sort((a, b) => {
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

                {teams.length === 0 ? (
                    <div className="rounded-xl bg-white/5 border border-white/10 p-12 text-center">
                        <p className="text-white/40 text-lg">No teams found</p>
                    </div>
                ) : (
                    <TeamsTable teams={teamsWithRatings} />
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
                    <span>Rating = Avg of current squad player ratings (min. 3 rated players)</span>
                </div>
            </div>
        </main>
    );
}
