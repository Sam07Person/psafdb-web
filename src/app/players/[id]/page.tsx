"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import Link from "next/link";
import { useParams } from "next/navigation";
import { calcMatchRating, calcOverallRating, getRatingColor, getRatingLabel, type MatchStatRow, type MatchResult } from "@/lib/ratings";

type PlayerRow = {
  id: string;
  handle: string | null;
  name: string | null;
  game_user_id: string | null;
  created_at: string | null;
};

type MatchInfo = {
  id: string;
  played_at: string;
  home_team: string;
  away_team: string;
  home_score: number;
  away_score: number;
  league_id?: string | null;
  leagues?: { tier?: number | null } | null;
};

type MatchPlayerStat = {
  match_id: string;
  player_id: string;
  team_side: "home" | "away";
  position: string | null;
  score: number;
  passes: number | null;
  key_passes: number | null;
  assists: number | null;
  shots: number | null;
  shots_on_target: number | null;
  goals: number | null;
  tackles: number | null;
  key_tackles: number | null;
  interceptions: number | null;
  key_interceptions: number | null;
  possessions_lost: number | null;
  gk_saves: number | null;
  gk_catches: number | null;
  is_starter: boolean;
  sub_number: number | null;
  benched: boolean;
  stats_incomplete: boolean;
  matches?: MatchInfo | null;
};

type TotalStats = {
  matches_played: number;
  matches_with_stats: number;
  matches_without_stats: number;
  benched: number;
  goals: number;
  assists: number;
  shots: number;
  shots_on_target: number;
  passes: number;
  key_passes: number;
  tackles: number;
  key_tackles: number;
  interceptions: number;
  key_interceptions: number;
  possessions_lost: number;
  gk_saves: number;
  gk_catches: number;
  total_score: number;
  avg_score: number;
  wins: number;
  losses: number;
  draws: number;
  starts: number;
  sub_appearances: number;
};

type LastClubInfo = {
  teamName: string;
  matchDate: string;
  matchId: string;
} | null;

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
  LM: "border-blue-400/30 bg-blue-400/10 text-blue-200",
  RM: "border-blue-400/30 bg-blue-400/10 text-blue-200",
  CDM: "border-blue-400/30 bg-blue-400/10 text-blue-200",
  CAM: "border-blue-400/30 bg-blue-400/10 text-blue-200",
  LW: "border-purple-400/30 bg-purple-400/10 text-purple-200",
  RW: "border-purple-400/30 bg-purple-400/10 text-purple-200",
  LF: "border-orange-400/30 bg-orange-400/10 text-orange-200",
  RF: "border-orange-400/30 bg-orange-400/10 text-orange-200",
  CF: "border-red-400/30 bg-red-400/10 text-red-200",
  ST: "border-red-400/30 bg-red-400/10 text-red-200",
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
  return d.toLocaleString(undefined, { year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function StatCard({ label, value, subtext, color, tooltip }: { label: string; value: string | number; subtext?: string; color?: string; tooltip?: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4" title={tooltip}>
      <div className="text-xs uppercase tracking-wide text-white/50">{label}</div>
      <div className={cx("mt-1 text-2xl font-bold", color)}>{value}</div>
      {subtext && <div className="mt-0.5 text-xs text-white/40">{subtext}</div>}
    </div>
  );
}

function PositionBadge({ position }: { position: string | null }) {
  if (!position) return <span className="text-white/40">—</span>;
  const colorClass = POSITION_COLORS[position] ?? "border-white/30 bg-white/10 text-white/80";
  return (
    <span className={cx("rounded-full border px-2 py-0.5 text-xs font-medium", colorClass)}>
      {position}
    </span>
  );
}

export default function PlayerDetailPage() {
  const params = useParams();
  const playerId = params.id as string;

  const [player, setPlayer] = useState<PlayerRow | null>(null);
  const [matchStats, setMatchStats] = useState<MatchPlayerStat[]>([]);
  const [lastClub, setLastClub] = useState<LastClubInfo>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<any>(null);

  const [showAllMatches, setShowAllMatches] = useState(false);
  const [showBenchedMatches, setShowBenchedMatches] = useState(false);

  useEffect(() => {
    if (!supabase || !playerId) return;

    (async () => {
      setLoading(true);

      const { data: playerData, error: playerError } = await supabase
        .from("players")
        .select("id,handle,name,game_user_id,created_at")
        .eq("id", playerId)
        .single();

      if (playerError) {
        setError(playerError);
        setLoading(false);
        return;
      }

      setPlayer(playerData);

      const { data: statsData, error: statsError } = await supabase
        .from("match_player_stats")
        .select(
          "match_id,player_id,team_side,position,score,passes,key_passes,assists,shots,shots_on_target,goals,tackles,key_tackles,interceptions,key_interceptions,possessions_lost,gk_saves,gk_catches,is_starter,sub_number,benched,stats_incomplete,matches(id,played_at,home_team,away_team,home_score,away_score,league_id,leagues(tier))"
        )
        .eq("player_id", playerId)
        .order("match_id", { ascending: false });

      if (statsError) {
        const { data: statsData2, error: statsError2 } = await supabase
          .from("match_player_stats")
          .select(
            "match_id,player_id,team_side,position,score,passes,key_passes,assists,shots,shots_on_target,goals,tackles,key_tackles,interceptions,key_interceptions,possessions_lost,gk_saves,gk_catches,is_starter,sub_number,benched,stats_incomplete"
          )
          .eq("player_id", playerId);

        if (statsError2) {
          setError(statsError2);
          setLoading(false);
          return;
        }

        const matchIds = Array.from(new Set((statsData2 ?? []).map((s) => s.match_id)));
        if (matchIds.length > 0) {
          const { data: matchesData } = await supabase
            .from("matches")
            .select("id,played_at,home_team,away_team,home_score,away_score,league_id,leagues(tier)")
            .in("id", matchIds);

          const matchMap = new Map<string, MatchInfo>();
          for (const m of matchesData ?? []) matchMap.set(m.id, m as MatchInfo);

          const combined = (statsData2 ?? []).map((s) => ({
            ...s,
            benched: s.benched ?? (!s.is_starter && s.sub_number !== null && s.score === 0),
            stats_incomplete: s.stats_incomplete ?? false,
            matches: matchMap.get(s.match_id) ?? null,
          }));

          combined.sort((a, b) => {
            const aDate = a.matches?.played_at ?? "";
            const bDate = b.matches?.played_at ?? "";
            return bDate.localeCompare(aDate);
          });

          setMatchStats(combined as MatchPlayerStat[]);

          const playedMatches = combined.filter(c => !c.benched);
          if (playedMatches.length > 0 && playedMatches[0].matches) {
            const lastMatch = playedMatches[0];
            const teamName = lastMatch.team_side === "home" 
              ? lastMatch.matches!.home_team 
              : lastMatch.matches!.away_team;
            setLastClub({
              teamName,
              matchDate: lastMatch.matches!.played_at,
              matchId: lastMatch.match_id,
            });
          }
        } else {
          setMatchStats([]);
        }
      } else {
        const normalized = (statsData ?? []).map((s: any) => ({
          ...s,
          benched: s.benched ?? (!s.is_starter && s.sub_number !== null && s.score === 0),
          stats_incomplete: s.stats_incomplete ?? false,
          matches: Array.isArray(s.matches) ? s.matches[0] ?? null : s.matches ?? null,
        }));

        normalized.sort((a: any, b: any) => {
          const aDate = a.matches?.played_at ?? "";
          const bDate = b.matches?.played_at ?? "";
          return bDate.localeCompare(aDate);
        });
        
        setMatchStats(normalized as MatchPlayerStat[]);

        const playedMatches = normalized.filter((n: any) => !n.benched);
        if (playedMatches.length > 0 && playedMatches[0].matches) {
          const lastMatch = playedMatches[0];
          const teamName = lastMatch.team_side === "home" 
            ? lastMatch.matches.home_team 
            : lastMatch.matches.away_team;
          setLastClub({
            teamName,
            matchDate: lastMatch.matches.played_at,
            matchId: lastMatch.match_id,
          });
        }
      }

      setLoading(false);
    })();
  }, [playerId]);

  const playedMatches = matchStats.filter(s => !s.benched);
  const benchedMatches = matchStats.filter(s => s.benched);
  const matchesWithStats = playedMatches.filter(s => !s.stats_incomplete);
  const matchesWithoutStats = playedMatches.filter(s => s.stats_incomplete);

  // Calculate total stats (only from played matches with complete stats for detailed stats)
  const totalStats: TotalStats = playedMatches.reduce(
    (acc, s) => {
      acc.matches_played += 1;
      
      if (s.stats_incomplete) {
        acc.matches_without_stats += 1;
      } else {
        acc.matches_with_stats += 1;
        // Only add detailed stats if they're available
        acc.goals += s.goals ?? 0;
        acc.assists += s.assists ?? 0;
        acc.shots += s.shots ?? 0;
        acc.shots_on_target += s.shots_on_target ?? 0;
        acc.passes += s.passes ?? 0;
        acc.key_passes += s.key_passes ?? 0;
        acc.tackles += s.tackles ?? 0;
        acc.key_tackles += s.key_tackles ?? 0;
        acc.interceptions += s.interceptions ?? 0;
        acc.key_interceptions += s.key_interceptions ?? 0;
        acc.possessions_lost += s.possessions_lost ?? 0;
        acc.gk_saves += s.gk_saves ?? 0;
        acc.gk_catches += s.gk_catches ?? 0;
      }
      
      // Score is always available
      acc.total_score += s.score ?? 0;

      if (s.is_starter) {
        acc.starts += 1;
      } else {
        acc.sub_appearances += 1;
      }

      if (s.matches) {
        const isHome = s.team_side === "home";
        const teamScore = isHome ? s.matches.home_score : s.matches.away_score;
        const oppScore = isHome ? s.matches.away_score : s.matches.home_score;
        if (teamScore > oppScore) acc.wins += 1;
        else if (teamScore < oppScore) acc.losses += 1;
        else acc.draws += 1;
      }

      return acc;
    },
    {
      matches_played: 0,
      matches_with_stats: 0,
      matches_without_stats: 0,
      benched: benchedMatches.length,
      goals: 0,
      assists: 0,
      shots: 0,
      shots_on_target: 0,
      passes: 0,
      key_passes: 0,
      tackles: 0,
      key_tackles: 0,
      interceptions: 0,
      key_interceptions: 0,
      possessions_lost: 0,
      gk_saves: 0,
      gk_catches: 0,
      total_score: 0,
      avg_score: 0,
      wins: 0,
      losses: 0,
      draws: 0,
      starts: 0,
      sub_appearances: 0,
    }
  );

  totalStats.avg_score = totalStats.matches_played > 0 ? totalStats.total_score / totalStats.matches_played : 0;

  const positionCounts = playedMatches.reduce((acc, s) => {
    if (s.position) {
      acc[s.position] = (acc[s.position] || 0) + 1;
    }
    return acc;
  }, {} as Record<string, number>);

  const mostPlayedPosition = Object.entries(positionCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;


  // Calculate overall rating — only use matches with complete stats AND match info (mirrors rating page logic)
  const ratingMatchSet = matchesWithStats.filter(s => s.matches);

  // Dominant league tier from same match set
  const tierCounts: Record<number, number> = {};
  for (const s of ratingMatchSet) {
    const tier = (s.matches as any)?.leagues?.tier ?? 2;
    tierCounts[tier] = (tierCounts[tier] ?? 0) + 1;
  }
  const dominantTierEntry = Object.entries(tierCounts).sort((a, b) => b[1] - a[1])[0];
  const dominantLeagueTier = dominantTierEntry ? parseInt(dominantTierEntry[0]) : 2;

  const ratingStatRows: MatchStatRow[] = ratingMatchSet.map(s => ({
    goals: s.goals ?? 0,
    assists: s.assists ?? 0,
    key_passes: s.key_passes ?? 0,
    shots_on_target: s.shots_on_target ?? 0,
    passes: s.passes ?? 0,
    tackles: s.tackles ?? 0,
    key_tackles: s.key_tackles ?? 0,
    interceptions: s.interceptions ?? 0,
    key_interceptions: s.key_interceptions ?? 0,
    possessions_lost: s.possessions_lost ?? 0,
    gk_saves: s.gk_saves ?? 0,
    gk_catches: s.gk_catches ?? 0,
    score: s.score ?? 0,
    position: s.position,
  }));
  const ratingResults: MatchResult[] = ratingMatchSet.map(s => {
    const isHome = s.team_side === "home";
    const my = isHome ? s.matches!.home_score : s.matches!.away_score;
    const opp = isHome ? s.matches!.away_score : s.matches!.home_score;
    return my > opp ? "W" : my < opp ? "L" : "D";
  });

  // Derive dominant position from the same match set used for rating (not from all played matches)
  const ratingPosCounts: Record<string, number> = {};
  for (const s of ratingMatchSet) {
    if (s.position) ratingPosCounts[s.position] = (ratingPosCounts[s.position] ?? 0) + 1;
  }
  const ratingPosition = Object.entries(ratingPosCounts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;

  const matchRatingValues = ratingStatRows.map((row, i) =>
    calcMatchRating(row, ratingResults[i], row.position)
  );
  const hasEnoughForRating = matchRatingValues.length >= 3;
  const overallRating = hasEnoughForRating ? calcOverallRating(matchRatingValues, dominantLeagueTier) : null;
  const ratingColor = overallRating !== null ? getRatingColor(overallRating) : "#3a3a5a";
  const ratingLabelText = overallRating !== null ? getRatingLabel(overallRating) : null;

  const teamsPlayedFor = Array.from(new Set(
    playedMatches.map(s => {
      if (!s.matches) return null;
      return s.team_side === "home" ? s.matches.home_team : s.matches.away_team;
    }).filter(Boolean)
  )) as string[];

  const recentMatches = playedMatches.slice(0, 5);
  const displayMatches = showAllMatches ? playedMatches : recentMatches;

  if (!supabase) {
    return (
      <main className="mx-auto max-w-6xl px-6 py-10">
        <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
          <div className="text-xl font-semibold">Player Details</div>
          <p className="mt-2 text-white/70">Missing environment variables.</p>
        </div>
      </main>
    );
  }

  if (loading) {
    return (
      <main className="mx-auto max-w-6xl px-6 py-10">
        <div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-white/70">
          Loading player...
        </div>
      </main>
    );
  }

  if (error || !player) {
    return (
      <main className="mx-auto max-w-6xl px-6 py-10">
        <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-6">
          <div className="text-lg font-semibold">Error</div>
          <pre className="mt-3 overflow-auto text-xs text-white/80">
            {error ? JSON.stringify(error, null, 2) : "Player not found"}
          </pre>
        </div>
        <Link href="/players" className="mt-4 inline-block text-sm text-white/60 hover:text-white">
          ← Back to players
        </Link>
      </main>
    );
  }

  const displayName = player.name || player.handle || `Player ${player.id.slice(0, 8)}`;

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm">
        <Link href="/" className="text-white/50 hover:text-white/80 transition">Home</Link>
        <span className="text-white/30">/</span>
        <Link href="/players" className="text-white/50 hover:text-white/80 transition">Players</Link>
      </div>

      {/* Header */}
      <div className="mt-6 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="text-3xl font-bold tracking-tight">{displayName}</div>
          {player.handle && player.name && (
            <div className="mt-1 text-sm text-white/50">@{player.handle}</div>
          )}
          {player.game_user_id && (
            <div className="mt-1 flex items-center gap-2">
              <span className="text-sm text-white/40">Player ID:</span>
              <code className="rounded bg-white/10 px-2 py-0.5 text-sm font-mono text-white/70">
                {player.game_user_id}
              </code>
            </div>
          )}
          {player.created_at && (
            <div className="mt-1 text-sm text-white/40">
              Registered {formatDate(player.created_at)}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2 items-start md:items-end">
          {mostPlayedPosition && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-white/50">Main position:</span>
              <PositionBadge position={mostPlayedPosition} />
            </div>
          )}
          {lastClub && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-white/50">Last club:</span>
              <span className="rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-sm font-medium text-emerald-200">
                {lastClub.teamName}
              </span>
            </div>
          )}
          {matchRatingValues.length > 0 && (
            <Link href={`/players/${playerId}/rating`} style={{ textDecoration: "none" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, background: "#0d0d1a", border: `1.5px solid ${ratingColor}`, padding: "8px 14px", cursor: "pointer" }}>
                <div>
                  <div style={{ fontSize: 28, fontWeight: 900, color: ratingColor, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>
                    {overallRating !== null ? overallRating : "N/A"}
                  </div>
                  <div style={{ fontSize: 9, color: "#5a5a7a", letterSpacing: "0.15em", fontWeight: 700, textTransform: "uppercase", marginTop: 2 }}>Rating</div>
                </div>
                <div style={{ fontSize: 11, color: ratingColor, fontWeight: 700, letterSpacing: "0.06em" }}>
                  {ratingLabelText ?? `${matchRatingValues.length}/3 matches`}
                  <div style={{ fontSize: 10, color: "#3a3a5a", fontWeight: 400, marginTop: 2 }}>Full breakdown →</div>
                </div>
              </div>
            </Link>
          )}
        </div>
      </div>

      {/* Club History */}
      {teamsPlayedFor.length > 0 && (
        <div className="mt-6">
          <div className="text-sm text-white/50 mb-2">Teams played for:</div>
          <div className="flex flex-wrap gap-2">
            {teamsPlayedFor.map((team) => (
              <span
                key={team}
                className={cx(
                  "rounded-lg border px-3 py-1 text-sm",
                  team === lastClub?.teamName
                    ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200"
                    : "border-white/10 bg-white/5 text-white/70"
                )}
              >
                {team}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Total Stats */}
      <div className="mt-8">
        <div className="flex items-center justify-between">
          <div className="text-lg font-semibold">Career Stats</div>
          {totalStats.matches_without_stats > 0 && (
            <div className="text-xs text-amber-400/80 flex items-center gap-1">
              <span>⚠️</span>
              <span>{totalStats.matches_without_stats} match{totalStats.matches_without_stats !== 1 ? 'es' : ''} with incomplete stats</span>
            </div>
          )}
        </div>
        
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-7">
          <StatCard 
            label="Appearances" 
            value={totalStats.matches_played} 
            subtext={`${totalStats.starts} starts, ${totalStats.sub_appearances} sub`}
          />
          <StatCard
            label="Record"
            value={`${totalStats.wins}W ${totalStats.draws}D ${totalStats.losses}L`}
            subtext={`${totalStats.matches_played > 0 ? ((totalStats.wins / totalStats.matches_played) * 100).toFixed(0) : 0}% win rate`}
          />
          <StatCard 
            label="Goals" 
            value={totalStats.goals} 
            color="text-emerald-400" 
            subtext={totalStats.matches_without_stats > 0 ? `from ${totalStats.matches_with_stats} matches` : undefined}
          />
          <StatCard 
            label="Assists" 
            value={totalStats.assists} 
            color="text-sky-400" 
            subtext={totalStats.matches_without_stats > 0 ? `from ${totalStats.matches_with_stats} matches` : undefined}
          />
          <StatCard
            label="Avg Score"
            value={totalStats.avg_score.toFixed(1)}
            color="text-amber-400"
            subtext="All matches"
          />
          <StatCard
            label="G+A"
            value={totalStats.goals + totalStats.assists}
            subtext={totalStats.matches_without_stats > 0 ? `from ${totalStats.matches_with_stats} matches` : "Goal contributions"}
            color="text-purple-400"
          />
          <StatCard
            label="Benched"
            value={totalStats.benched}
            subtext="Unused sub"
            color="text-gray-400"
          />
        </div>

        {/* Detailed stats - only if we have some matches with stats */}
        {totalStats.matches_with_stats > 0 && (
          <>
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
              <StatCard label="Shots" value={totalStats.shots} />
              <StatCard label="On Target" value={totalStats.shots_on_target} />
              <StatCard label="Passes" value={totalStats.passes} />
              <StatCard label="Key Passes" value={totalStats.key_passes} />
              <StatCard label="Tackles" value={totalStats.tackles} />
              <StatCard label="Key Tackles" value={totalStats.key_tackles} />
              <StatCard label="Interceptions" value={totalStats.interceptions} />
              <StatCard label="Poss. Lost" value={totalStats.possessions_lost} />
            </div>

            {totalStats.matches_without_stats > 0 && (
              <p className="mt-2 text-xs text-white/40">
                * Detailed stats from {totalStats.matches_with_stats} of {totalStats.matches_played} matches
              </p>
            )}
          </>
        )}

        {(totalStats.gk_saves > 0 || totalStats.gk_catches > 0) && (
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard label="GK Saves" value={totalStats.gk_saves} color="text-yellow-400" />
            <StatCard label="GK Catches" value={totalStats.gk_catches} color="text-yellow-400" />
          </div>
        )}
      </div>

      {/* Match History */}
      <div className="mt-10">
        <div className="flex items-center justify-between">
          <div className="text-lg font-semibold">
            {showAllMatches ? "All Appearances" : "Recent Appearances"}
          </div>
          <div className="flex items-center gap-4">
            {playedMatches.length > 5 && (
              <button
                onClick={() => setShowAllMatches(!showAllMatches)}
                className="text-sm text-white/60 hover:text-white"
              >
                {showAllMatches ? "Show recent only" : `View all ${playedMatches.length} appearances`}
              </button>
            )}
          </div>
        </div>

        {playedMatches.length === 0 ? (
          <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-6 text-white/70">
            No appearances yet.
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            {displayMatches.map((s) => {
              const match = s.matches;
              if (!match) return null;

              const isHome = s.team_side === "home";
              const teamName = isHome ? match.home_team : match.away_team;
              const oppName = isHome ? match.away_team : match.home_team;
              const teamScore = isHome ? match.home_score : match.away_score;
              const oppScore = isHome ? match.away_score : match.home_score;

              let resultClass = "bg-gray-500/20 text-gray-300";
              let resultText = "D";
              if (teamScore > oppScore) {
                resultClass = "bg-emerald-500/20 text-emerald-300";
                resultText = "W";
              } else if (teamScore < oppScore) {
                resultClass = "bg-red-500/20 text-red-300";
                resultText = "L";
              }

              return (
                <Link
                  key={s.match_id}
                  href={`/matches/${s.match_id}`}
                  className={cx(
                    "block rounded-2xl border border-white/10 bg-white/5 p-4 transition hover:border-white/20 hover:bg-white/[0.08]",
                    s.stats_incomplete && "border-amber-500/20"
                  )}
                  style={{ textDecoration: "none", color: "inherit" }}
                >
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div className="flex items-center gap-3">
                      <div className={cx("flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold", resultClass)}>
                        {resultText}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{teamName}</span>
                          <span className="text-white/40">vs</span>
                          <span className="font-medium">{oppName}</span>
                        </div>
                        <div className="text-sm text-white/50">
                          {teamScore} - {oppScore} • {formatDateTime(match.played_at)}
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <PositionBadge position={s.position} />
                      {s.is_starter ? (
                        <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2 py-0.5 text-xs text-emerald-200">
                          Started
                        </span>
                      ) : (
                        <span className="rounded-full border border-orange-400/30 bg-orange-400/10 px-2 py-0.5 text-xs text-orange-200">
                          Sub
                        </span>
                      )}
                      {s.stats_incomplete && (
                        <span className="rounded-full border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-xs text-amber-200">
                          Stats N/A
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-4 text-sm">
                    {s.stats_incomplete ? (
                      <span className="text-amber-400/70">Detailed stats not available</span>
                    ) : (
                      <>
                        {(s.goals ?? 0) > 0 && (
                          <span className="text-emerald-400">⚽ {s.goals} goal{s.goals !== 1 ? "s" : ""}</span>
                        )}
                        {(s.assists ?? 0) > 0 && (
                          <span className="text-sky-400">🅰️ {s.assists} assist{s.assists !== 1 ? "s" : ""}</span>
                        )}
                        <span className="text-white/50">{s.shots ?? 0} shots ({s.shots_on_target ?? 0} on target)</span>
                        <span className="text-white/50">{s.passes ?? 0} passes ({s.key_passes ?? 0} key)</span>
                        <span className="text-white/50">{s.tackles ?? 0} tackles</span>
                      </>
                    )}
                    <span className="text-amber-400">Score: {s.score}</span>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>

      {/* Benched Matches */}
      {benchedMatches.length > 0 && (
        <div className="mt-10">
          <div className="flex items-center justify-between">
            <div className="text-lg font-semibold text-gray-400">
              Benched ({benchedMatches.length})
            </div>
            <button
              onClick={() => setShowBenchedMatches(!showBenchedMatches)}
              className="text-sm text-white/60 hover:text-white"
            >
              {showBenchedMatches ? "Hide" : "Show"} benched matches
            </button>
          </div>
          
          <p className="mt-1 text-sm text-white/40">
            Matches where player was an unused substitute
          </p>

          {showBenchedMatches && (
            <div className="mt-4 space-y-2">
              {benchedMatches.map((s) => {
                const match = s.matches;
                if (!match) return null;

                const isHome = s.team_side === "home";
                const teamName = isHome ? match.home_team : match.away_team;
                const oppName = isHome ? match.away_team : match.home_team;
                const teamScore = isHome ? match.home_score : match.away_score;
                const oppScore = isHome ? match.away_score : match.home_score;

                let resultText = "D";
                if (teamScore > oppScore) resultText = "W";
                else if (teamScore < oppScore) resultText = "L";

                return (
                  <Link
                    key={s.match_id}
                    href={`/matches/${s.match_id}`}
                    className="block rounded-xl border border-white/5 bg-white/[0.02] p-3 opacity-60 transition hover:opacity-80"
                    style={{ textDecoration: "none", color: "inherit" }}
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-6 w-6 items-center justify-center rounded bg-gray-700/50 text-xs text-gray-400">
                        {resultText}
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2 text-sm">
                          <span className="text-white/70">{teamName}</span>
                          <span className="text-white/30">{teamScore} - {oppScore}</span>
                          <span className="text-white/70">{oppName}</span>
                        </div>
                        <div className="text-xs text-white/30">
                          {formatDate(match.played_at)} • Sub {s.sub_number}
                        </div>
                      </div>
                      <span className="rounded border border-gray-600/30 bg-gray-600/10 px-2 py-0.5 text-xs text-gray-400">
                        Benched
                      </span>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      )}
    </main>
  );
}