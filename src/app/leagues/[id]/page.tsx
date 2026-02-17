"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import Link from "next/link";
import { useParams } from "next/navigation";

type LeagueRow = {
  id: string;
  name: string;
  season: string | null;
  format: string | null; // 'league' | 'knockout' | 'group_knockout'
  created_at: string | null;
};

type MatchRow = {
  id: string;
  league_id: string;
  played_at: string;
  home_team: string;
  away_team: string;
  home_score: number;
  away_score: number;
  stage?: string | null; // 'group' | 'round_of_16' | 'quarter' | 'semi' | 'final' etc.
  group_name?: string | null; // 'A' | 'B' etc.
};

type TeamStanding = {
  team: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goals_for: number;
  goals_against: number;
  goal_difference: number;
  points: number;
  form: ("W" | "D" | "L")[]; // Last 5 results
};

function cx(...s: Array<string | false | null | undefined>) {
  return s.filter(Boolean).join(" ");
}

function formatDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "2-digit" });
}

function formatDateTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function formatLabel(format: string | null): string {
  switch (format) {
    case "knockout":
      return "Knockout";
    case "group_knockout":
      return "Group Stage + Knockout";
    case "league":
    default:
      return "League";
  }
}

function formatColor(format: string | null): string {
  switch (format) {
    case "knockout":
      return "border-red-400/30 bg-red-400/10 text-red-200";
    case "group_knockout":
      return "border-purple-400/30 bg-purple-400/10 text-purple-200";
    case "league":
    default:
      return "border-emerald-400/30 bg-emerald-400/10 text-emerald-200";
  }
}

function FormBadge({ result }: { result: "W" | "D" | "L" }) {
  const colors = {
    W: "bg-emerald-500 text-white",
    D: "bg-gray-500 text-white",
    L: "bg-red-500 text-white",
  };
  return (
    <span className={cx("inline-flex h-5 w-5 items-center justify-center rounded text-[10px] font-bold", colors[result])}>
      {result}
    </span>
  );
}

function calculateStandings(matches: MatchRow[], groupName?: string | null): TeamStanding[] {
  const teamStats = new Map<string, TeamStanding>();

  // Filter by group if specified
  const filteredMatches = groupName
    ? matches.filter((m) => m.group_name === groupName)
    : matches;

  // Initialize teams and calculate stats
  for (const match of filteredMatches) {
    // Initialize teams if not exists
    if (!teamStats.has(match.home_team)) {
      teamStats.set(match.home_team, {
        team: match.home_team,
        played: 0,
        won: 0,
        drawn: 0,
        lost: 0,
        goals_for: 0,
        goals_against: 0,
        goal_difference: 0,
        points: 0,
        form: [],
      });
    }
    if (!teamStats.has(match.away_team)) {
      teamStats.set(match.away_team, {
        team: match.away_team,
        played: 0,
        won: 0,
        drawn: 0,
        lost: 0,
        goals_for: 0,
        goals_against: 0,
        goal_difference: 0,
        points: 0,
        form: [],
      });
    }

    const home = teamStats.get(match.home_team)!;
    const away = teamStats.get(match.away_team)!;

    // Update stats
    home.played += 1;
    away.played += 1;
    home.goals_for += match.home_score;
    home.goals_against += match.away_score;
    away.goals_for += match.away_score;
    away.goals_against += match.home_score;

    if (match.home_score > match.away_score) {
      // Home win
      home.won += 1;
      home.points += 3;
      home.form.push("W");
      away.lost += 1;
      away.form.push("L");
    } else if (match.home_score < match.away_score) {
      // Away win
      away.won += 1;
      away.points += 3;
      away.form.push("W");
      home.lost += 1;
      home.form.push("L");
    } else {
      // Draw
      home.drawn += 1;
      home.points += 1;
      home.form.push("D");
      away.drawn += 1;
      away.points += 1;
      away.form.push("D");
    }
  }

  // Calculate goal difference and trim form to last 5
  for (const team of teamStats.values()) {
    team.goal_difference = team.goals_for - team.goals_against;
    team.form = team.form.slice(-5);
  }

  // Sort by points, then GD, then GF
  const standings = Array.from(teamStats.values()).sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.goal_difference !== a.goal_difference) return b.goal_difference - a.goal_difference;
    return b.goals_for - a.goals_for;
  });

  return standings;
}

function StandingsTable({ standings, title }: { standings: TeamStanding[]; title?: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
      {title && <div className="mb-4 text-lg font-semibold">{title}</div>}
      <div className="overflow-auto">
        <table className="w-full min-w-[700px] text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-white/60">
            <tr>
              <th className="py-2 pl-2 w-8">#</th>
              <th className="py-2">Team</th>
              <th className="py-2 text-center">P</th>
              <th className="py-2 text-center">W</th>
              <th className="py-2 text-center">D</th>
              <th className="py-2 text-center">L</th>
              <th className="py-2 text-center">GF</th>
              <th className="py-2 text-center">GA</th>
              <th className="py-2 text-center">GD</th>
              <th className="py-2 text-center">Pts</th>
              <th className="py-2 text-center">Form</th>
            </tr>
          </thead>
          <tbody>
            {standings.map((team, idx) => (
              <tr key={team.team} className="border-t border-white/10">
                <td className="py-3 pl-2 font-medium text-white/60">{idx + 1}</td>
                <td className="py-3 font-semibold">{team.team}</td>
                <td className="py-3 text-center">{team.played}</td>
                <td className="py-3 text-center text-emerald-400">{team.won}</td>
                <td className="py-3 text-center text-gray-400">{team.drawn}</td>
                <td className="py-3 text-center text-red-400">{team.lost}</td>
                <td className="py-3 text-center">{team.goals_for}</td>
                <td className="py-3 text-center">{team.goals_against}</td>
                <td className="py-3 text-center">
                  <span className={team.goal_difference > 0 ? "text-emerald-400" : team.goal_difference < 0 ? "text-red-400" : ""}>
                    {team.goal_difference > 0 ? "+" : ""}{team.goal_difference}
                  </span>
                </td>
                <td className="py-3 text-center font-bold">{team.points}</td>
                <td className="py-3">
                  <div className="flex justify-center gap-1">
                    {team.form.map((r, i) => (
                      <FormBadge key={i} result={r} />
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function KnockoutBracket({ matches }: { matches: MatchRow[] }) {
  // Group matches by stage
  const stages = new Map<string, MatchRow[]>();
  const stageOrder = ["round_of_16", "quarter", "semi", "third_place", "final"];
  const stageLabels: Record<string, string> = {
    round_of_16: "Round of 16",
    quarter: "Quarter Finals",
    semi: "Semi Finals",
    third_place: "3rd Place",
    final: "Final",
  };

  for (const match of matches) {
    const stage = match.stage || "knockout";
    if (!stages.has(stage)) stages.set(stage, []);
    stages.get(stage)!.push(match);
  }

  // Sort stages
  const sortedStages = Array.from(stages.entries()).sort((a, b) => {
    const aIdx = stageOrder.indexOf(a[0]);
    const bIdx = stageOrder.indexOf(b[0]);
    if (aIdx === -1 && bIdx === -1) return 0;
    if (aIdx === -1) return 1;
    if (bIdx === -1) return -1;
    return aIdx - bIdx;
  });

  return (
    <div className="space-y-6">
      {sortedStages.map(([stage, stageMatches]) => (
        <div key={stage} className="rounded-2xl border border-white/10 bg-black/20 p-4">
          <div className="mb-4 text-lg font-semibold">{stageLabels[stage] || stage}</div>
          <div className="grid gap-3 sm:grid-cols-2">
            {stageMatches
              .sort((a, b) => new Date(a.played_at).getTime() - new Date(b.played_at).getTime())
              .map((match) => {
                const homeWon = match.home_score > match.away_score;
                const awayWon = match.away_score > match.home_score;

                return (
                  <div key={match.id} className="rounded-xl border border-white/10 bg-white/5 p-3">
                    <div className="flex items-center justify-between">
                      <div className={cx("font-medium", homeWon && "text-emerald-400")}>
                        {match.home_team}
                      </div>
                      <div className="text-lg font-bold">{match.home_score}</div>
                    </div>
                    <div className="flex items-center justify-between mt-1">
                      <div className={cx("font-medium", awayWon && "text-emerald-400")}>
                        {match.away_team}
                      </div>
                      <div className="text-lg font-bold">{match.away_score}</div>
                    </div>
                    <div className="mt-2 text-xs text-white/50">{formatDateTime(match.played_at)}</div>
                  </div>
                );
              })}
          </div>
        </div>
      ))}
    </div>
  );
}

function MatchList({ matches, title }: { matches: MatchRow[]; title?: string }) {
  const [showAll, setShowAll] = useState(false);
  const sortedMatches = [...matches].sort((a, b) => 
    new Date(b.played_at).getTime() - new Date(a.played_at).getTime()
  );
  const displayMatches = showAll ? sortedMatches : sortedMatches.slice(0, 5);

  return (
    <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
      <div className="flex items-center justify-between mb-4">
        <div className="text-lg font-semibold">{title || "Matches"}</div>
        {matches.length > 5 && (
          <button
            onClick={() => setShowAll(!showAll)}
            className="text-sm text-white/60 hover:text-white"
          >
            {showAll ? "Show recent" : `View all ${matches.length}`}
          </button>
        )}
      </div>
      
      {matches.length === 0 ? (
        <div className="text-white/50">No matches yet.</div>
      ) : (
        <div className="space-y-2">
          {displayMatches.map((match) => (
            <div key={match.id} className="flex items-center justify-between rounded-xl bg-white/5 px-4 py-3">
              <div className="flex items-center gap-4">
                <div className="text-right w-28 truncate font-medium">{match.home_team}</div>
                <div className="flex items-center gap-2 text-lg font-bold">
                  <span className={match.home_score > match.away_score ? "text-emerald-400" : ""}>{match.home_score}</span>
                  <span className="text-white/30">-</span>
                  <span className={match.away_score > match.home_score ? "text-emerald-400" : ""}>{match.away_score}</span>
                </div>
                <div className="w-28 truncate font-medium">{match.away_team}</div>
              </div>
              <div className="text-sm text-white/50">{formatDateTime(match.played_at)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function LeagueDetailPage() {
  const params = useParams();
  const leagueId = params.id as string;

  const [league, setLeague] = useState<LeagueRow | null>(null);
  const [matches, setMatches] = useState<MatchRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<any>(null);

  const [activeTab, setActiveTab] = useState<"standings" | "matches">("standings");

  useEffect(() => {
    if (!supabase || !leagueId) return;

    (async () => {
      setLoading(true);

      // Fetch league info
      const { data: leagueData, error: leagueError } = await supabase
        .from("leagues")
        .select("id,name,season,format,created_at")
        .eq("id", leagueId)
        .single();

      if (leagueError) {
        setError(leagueError);
        setLoading(false);
        return;
      }

      setLeague(leagueData);

      // Fetch all matches for this league
      const { data: matchesData, error: matchesError } = await supabase
        .from("matches")
        .select("id,league_id,played_at,home_team,away_team,home_score,away_score,stage,group_name")
        .eq("league_id", leagueId)
        .order("played_at", { ascending: false });

      if (matchesError) {
        // Try without stage/group_name columns (they might not exist yet)
        const { data: matchesData2, error: matchesError2 } = await supabase
          .from("matches")
          .select("id,league_id,played_at,home_team,away_team,home_score,away_score")
          .eq("league_id", leagueId)
          .order("played_at", { ascending: false });

        if (matchesError2) {
          setError(matchesError2);
          setLoading(false);
          return;
        }

        setMatches((matchesData2 ?? []) as MatchRow[]);
      } else {
        setMatches((matchesData ?? []) as MatchRow[]);
      }

      setLoading(false);
    })();
  }, [leagueId]);

  // Calculate standings
  const standings = useMemo(() => calculateStandings(matches), [matches]);

  // Get unique groups for group_knockout format
  const groups = useMemo(() => {
    const groupSet = new Set<string>();
    for (const match of matches) {
      if (match.group_name) groupSet.add(match.group_name);
    }
    return Array.from(groupSet).sort();
  }, [matches]);

  // Separate group and knockout matches
  const groupMatches = useMemo(() => 
    matches.filter((m) => m.stage === "group" || m.group_name), [matches]);
  const knockoutMatches = useMemo(() => 
    matches.filter((m) => m.stage && m.stage !== "group" && !m.group_name), [matches]);

  if (!supabase) {
    return (
      <main className="mx-auto max-w-6xl px-6 py-10">
        <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
          <div className="text-xl font-semibold">League Details</div>
          <p className="mt-2 text-white/70">Missing environment variables.</p>
        </div>
      </main>
    );
  }

  if (loading) {
    return (
      <main className="mx-auto max-w-6xl px-6 py-10">
        <div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-white/70">
          Loading league...
        </div>
      </main>
    );
  }

  if (error || !league) {
    return (
      <main className="mx-auto max-w-6xl px-6 py-10">
        <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-6">
          <div className="text-lg font-semibold">Error</div>
          <pre className="mt-3 overflow-auto text-xs text-white/80">
            {error ? JSON.stringify(error, null, 2) : "League not found"}
          </pre>
        </div>
        <Link href="/leagues" className="mt-4 inline-block text-sm text-white/60 hover:text-white">
          ← Back to leagues
        </Link>
      </main>
    );
  }

  const format = league.format || "league";

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      {/* Back link */}
      <Link href="/leagues" className="inline-flex items-center gap-2 text-sm text-white/60 hover:text-white">
        ← Back to leagues
      </Link>

      {/* Header */}
      <div className="mt-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="text-3xl font-bold tracking-tight">{league.name}</div>
          {league.season && (
            <div className="mt-1 text-sm text-white/50">{league.season}</div>
          )}
        </div>

        <div className="flex items-center gap-3">
          <span className={cx("rounded-full border px-3 py-1 text-sm font-medium", formatColor(format))}>
            {formatLabel(format)}
          </span>
          <div className="text-sm text-white/50">
            {standings.length} teams • {matches.length} matches
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="mt-8 flex gap-2">
        <button
          onClick={() => setActiveTab("standings")}
          className={cx(
            "rounded-xl px-4 py-2 text-sm font-medium transition",
            activeTab === "standings"
              ? "bg-white/10 text-white"
              : "text-white/60 hover:bg-white/5 hover:text-white"
          )}
        >
          {format === "knockout" ? "Bracket" : "Standings"}
        </button>
        <button
          onClick={() => setActiveTab("matches")}
          className={cx(
            "rounded-xl px-4 py-2 text-sm font-medium transition",
            activeTab === "matches"
              ? "bg-white/10 text-white"
              : "text-white/60 hover:bg-white/5 hover:text-white"
          )}
        >
          Matches
        </button>
      </div>

      {/* Content */}
      <div className="mt-6">
        {activeTab === "standings" && (
          <>
            {format === "league" && (
              <StandingsTable standings={standings} title="League Table" />
            )}

            {format === "knockout" && (
              <KnockoutBracket matches={matches} />
            )}

            {format === "group_knockout" && (
              <div className="space-y-6">
                {/* Group standings */}
                {groups.length > 0 ? (
                  <div className="grid gap-6 lg:grid-cols-2">
                    {groups.map((group) => (
                      <StandingsTable
                        key={group}
                        standings={calculateStandings(matches, group)}
                        title={`Group ${group}`}
                      />
                    ))}
                  </div>
                ) : (
                  <StandingsTable standings={standings} title="Standings" />
                )}

                {/* Knockout bracket */}
                {knockoutMatches.length > 0 && (
                  <div className="mt-8">
                    <div className="mb-4 text-xl font-semibold">Knockout Stage</div>
                    <KnockoutBracket matches={knockoutMatches} />
                  </div>
                )}
              </div>
            )}

            {/* Fallback for unknown format */}
            {!["league", "knockout", "group_knockout"].includes(format) && (
              <StandingsTable standings={standings} title="Standings" />
            )}
          </>
        )}

        {activeTab === "matches" && (
          <MatchList matches={matches} title="All Matches" />
        )}
      </div>
    </main>
  );
}