"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useLanguage } from "@/components/LanguageProvider";
import { calcMatchBreakdown, calcOverallRating, getRatingColor, getRatingLabel, isRatingEligibleScore, resolveMatchRating, DEFAULT_TIER_BONUSES, type MatchStatRow, type MatchResult } from "@/lib/ratings";

type PlayerRow = {
  id: string;
  handle: string | null;
  name: string | null;
  game_user_id: string | null;
  discord_id: string | null;
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
  day?: number | null;
  leagues?: { name?: string; tier?: number | null } | null;
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
  rating?: number | null;
  rating_version?: number | null;
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

// ── TOTW helpers ────────────────────────────────────────────────────────────
type SlotKey = "GK" | "LB" | "RB" | "CM" | "LW" | "RW";

const SLOT_POOLS: Record<SlotKey, string[]> = {
  GK: ["GK"],
  LB: ["LB", "LWB", "LCB"],
  RB: ["RB", "RWB", "RCB"],
  CM: ["CM", "LM", "RM", "CF", "ST", "CB"],
  LW: ["LW", "LF"],
  RW: ["RW", "RF"],
};

const SLOT_ORDER: SlotKey[] = ["GK", "LW", "RW", "LB", "RB", "CM"];

type TOTWRawStat = {
  player_id: string;
  team_side: "home" | "away";
  position: string | null;
  score: number;
  goals: number; assists: number; shots_on_target: number;
  key_passes: number; passes: number;
  tackles: number; key_tackles: number;
  interceptions: number; key_interceptions: number;
  possessions_lost: number; gk_saves: number; gk_catches: number;
  benched: boolean; stats_incomplete: boolean;
  players: { id: string; handle: string | null; name: string | null } | null;
  matches: { id: string; home_score: number; away_score: number } | null;
};

type TOTWAppearance = {
  leagueName: string;
  day: number;
  slot: SlotKey;
  rating: number;
  matchId: string;
};

function calcLocalTOTW(stats: TOTWRawStat[]): Partial<Record<SlotKey, { playerId: string; rating: number; matchId: string }>> {
  const entries = stats
    .filter(s => !s.benched && !s.stats_incomplete && s.position && s.matches && s.players
      && isRatingEligibleScore(s.score))
    .map(s => {
      const m = s.matches!;
      const isHome = s.team_side === "home";
      const goalsConceded = isHome ? m.away_score : m.home_score;
      const myScore = isHome ? m.home_score : m.away_score;
      const oppScore = isHome ? m.away_score : m.home_score;
      const result: MatchResult = myScore > oppScore ? "W" : myScore < oppScore ? "L" : "D";
      const statRow: MatchStatRow = {
        goals: s.goals ?? 0, assists: s.assists ?? 0, key_passes: s.key_passes ?? 0,
        shots_on_target: s.shots_on_target ?? 0, passes: s.passes ?? 0,
        tackles: s.tackles ?? 0, key_tackles: s.key_tackles ?? 0,
        interceptions: s.interceptions ?? 0, key_interceptions: s.key_interceptions ?? 0,
        possessions_lost: s.possessions_lost ?? 0, gk_saves: s.gk_saves ?? 0,
        gk_catches: s.gk_catches ?? 0, goals_conceded: goalsConceded,
        score: s.score ?? 0, position: s.position,
      };
      return { stat: s, rating: calcMatchBreakdown(statRow, result, s.position).final };
    });

  entries.sort((a, b) => b.rating - a.rating);

  const result: Partial<Record<SlotKey, { playerId: string; rating: number; matchId: string }>> = {};
  const used = new Set<string>();

  for (const slotKey of SLOT_ORDER) {
    const pool = SLOT_POOLS[slotKey];
    for (const { stat, rating } of entries) {
      const pos = stat.position?.toUpperCase().trim() ?? "";
      if (!pool.includes(pos)) continue;
      if (used.has(stat.player_id)) continue;
      result[slotKey] = { playerId: stat.player_id, rating, matchId: stat.matches!.id };
      used.add(stat.player_id);
      break;
    }
  }
  return result;
}
// ────────────────────────────────────────────────────────────────────────────

export default function PlayerDetailPage() {
  const params = useParams();
  const playerId = params.id as string;
  const { t } = useLanguage();

  const [player, setPlayer] = useState<PlayerRow | null>(null);
  const [matchStats, setMatchStats] = useState<MatchPlayerStat[]>([]);
  const [lastClub, setLastClub] = useState<LastClubInfo>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<any>(null);

  const [teamIdMap, setTeamIdMap] = useState<Record<string, string>>({});
  const [showAllMatches, setShowAllMatches] = useState(false);
  const [showBenchedMatches, setShowBenchedMatches] = useState(false);
  const [totwAppearances, setTotwAppearances] = useState<TOTWAppearance[]>([]);
  const [totwLoading, setTotwLoading] = useState(false);
  const [showAwards, setShowAwards] = useState(true);
  const [tierBonuses, setTierBonuses] = useState<Record<number, number>>(DEFAULT_TIER_BONUSES);

  useEffect(() => {
    fetch("/api/admin/settings")
      .then(r => r.json())
      .then(d => {
        if (Array.isArray(d.tierSettings)) {
          const map: Record<number, number> = {};
          for (const row of d.tierSettings) map[row.tier] = row.bonus;
          setTierBonuses(map);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!supabase || !playerId) return;

    (async () => {
      setLoading(true);

      const { data: playerData, error: playerError } = await supabase
        .from("players")
        .select("id,handle,name,game_user_id,discord_id,created_at")
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
          "match_id,player_id,team_side,position,score,passes,key_passes,assists,shots,shots_on_target,goals,tackles,key_tackles,interceptions,key_interceptions,possessions_lost,gk_saves,gk_catches,is_starter,sub_number,benched,stats_incomplete,rating,rating_version,matches(id,played_at,home_team,away_team,home_score,away_score,league_id,day,leagues(id,name,tier,use_tier_bonus))"
        )
        .eq("player_id", playerId)
        .order("match_id", { ascending: false });

      if (statsError) {
        const { data: statsData2, error: statsError2 } = await supabase
          .from("match_player_stats")
          .select(
            "match_id,player_id,team_side,position,score,passes,key_passes,assists,shots,shots_on_target,goals,tackles,key_tackles,interceptions,key_interceptions,possessions_lost,gk_saves,gk_catches,is_starter,sub_number,benched,stats_incomplete,rating,rating_version"
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
            .select("id,played_at,home_team,away_team,home_score,away_score,league_id,leagues(tier,use_tier_bonus)")
            .in("id", matchIds);

          const matchMap = new Map<string, MatchInfo>();
          for (const m of matchesData ?? []) matchMap.set(m.id, m as MatchInfo);

          const combined = (statsData2 ?? []).map((s) => ({
            ...s,
            benched: s.benched ?? false,
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
        const normalized = (statsData ?? []).map((s: any) => {
          const rawMatch = Array.isArray(s.matches) ? s.matches[0] ?? null : s.matches ?? null;
          const normalizedMatch = rawMatch ? {
            ...rawMatch,
            leagues: Array.isArray(rawMatch.leagues) ? rawMatch.leagues[0] ?? null : rawMatch.leagues ?? null,
          } : null;
          return {
            ...s,
            benched: s.benched ?? (!s.is_starter && s.sub_number !== null && s.score === 0),
            stats_incomplete: s.stats_incomplete ?? false,
            matches: normalizedMatch,
          };
        });

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

  // Compute TOTW appearances once matchStats are loaded
  useEffect(() => {
    if (!supabase || matchStats.length === 0) return;

    const combos = new Map<string, { leagueId: string; day: number; leagueName: string }>();
    for (const s of matchStats) {
      if (s.benched || s.stats_incomplete || !s.matches?.league_id || s.matches.day == null) continue;
      const key = `${s.matches.league_id}|${s.matches.day}`;
      if (!combos.has(key)) {
        combos.set(key, {
          leagueId: s.matches.league_id,
          day: s.matches.day,
          leagueName: (s.matches as any).leagues?.name ?? "Unknown League",
        });
      }
    }
    if (combos.size === 0) return;

    setTotwLoading(true);
    (async () => {
      const appearances: TOTWAppearance[] = [];
      for (const { leagueId, day, leagueName } of combos.values()) {
        const { data: dayMatches } = await supabase!
          .from("matches")
          .select("id")
          .eq("league_id", leagueId)
          .eq("day", day);
        if (!dayMatches?.length) continue;
        const matchIds = dayMatches.map((m: any) => m.id);

        const { data: dayStats } = await supabase!
          .from("match_player_stats")
          .select("player_id,team_side,position,score,goals,assists,shots_on_target,key_passes,passes,tackles,key_tackles,interceptions,key_interceptions,possessions_lost,gk_saves,gk_catches,benched,stats_incomplete,rating,rating_version,players(id,handle,name),matches(id,home_score,away_score)")
          .in("match_id", matchIds);
        if (!dayStats?.length) continue;

        const totw = calcLocalTOTW(dayStats as any);
        for (const [slot, entry] of Object.entries(totw) as [SlotKey, { playerId: string; rating: number; matchId: string }][]) {
          if (entry?.playerId === playerId) {
            appearances.push({ leagueName, day, slot, rating: entry.rating, matchId: entry.matchId });
          }
        }
      }
      appearances.sort((a, b) => b.day - a.day);
      setTotwAppearances(appearances);
      setTotwLoading(false);
    })();
  }, [matchStats, playerId]);

  // Fetch team IDs for all teams this player has played for so we can link to team pages
  useEffect(() => {
    if (!supabase || matchStats.length === 0) return;
    const names = Array.from(new Set(
      matchStats.map(s => s.matches ? (s.team_side === "home" ? s.matches.home_team : s.matches.away_team) : null).filter(Boolean) as string[]
    ));
    if (names.length === 0) return;
    supabase.from("teams").select("id,name").in("name", names).then(({ data }) => {
      const map: Record<string, string> = {};
      for (const t of data ?? []) map[t.name] = t.id;
      setTeamIdMap(map);
    });
  }, [matchStats]);

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


  // Calculate overall rating — only matches with complete stats, match info, and a
  // valid recorded game score. A score of 0 never counts toward the rating.
  // Frozen rows are kept here regardless of score; their stored rating is authoritative
  // and a frozen NULL is dropped when the ratings are resolved below.
  const ratingMatchSet = matchesWithStats.filter(s => s.matches
    && ((s as any).rating_version != null || isRatingEligibleScore(s.score)));

  // Dominant league tier from same match set (skip leagues with use_tier_bonus disabled)
  const tierCounts: Record<number, number> = {};
  for (const s of ratingMatchSet) {
    if ((s.matches as any)?.leagues?.use_tier_bonus === false) continue;
    const tier = (s.matches as any)?.leagues?.tier ?? 2;
    tierCounts[tier] = (tierCounts[tier] ?? 0) + 1;
  }
  const dominantTierEntry = Object.entries(tierCounts).sort((a, b) => b[1] - a[1])[0];
  const dominantLeagueTier = dominantTierEntry ? parseInt(dominantTierEntry[0]) : 2;

  const ratingStatRows: MatchStatRow[] = ratingMatchSet.map(s => {
    const isHome = s.team_side === "home";
    const goalsConceded = isHome ? s.matches!.away_score : s.matches!.home_score;
    return {
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
      goals_conceded: goalsConceded ?? 0,
      score: s.score ?? 0,
      position: s.position,
    };
  });
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

  // Frozen ratings win over the live formula; NULL means permanently excluded.
  const matchRatingValues = ratingStatRows
    .map((row, i) => resolveMatchRating(ratingMatchSet[i], row, ratingResults[i], row.position ?? ratingPosition).rating)
    .filter((r): r is number => r !== null);
  const hasEnoughForRating = matchRatingValues.length >= 3;
  const overallRating = hasEnoughForRating ? calcOverallRating(matchRatingValues, dominantLeagueTier, tierBonuses) : null;
  const ratingColor = overallRating !== null ? getRatingColor(overallRating) : "var(--text-faint)";
  const ratingLabelText = overallRating !== null ? getRatingLabel(overallRating) : null;

  const teamsPlayedFor = Array.from(new Set(
    playedMatches.map(s => {
      if (!s.matches) return null;
      return s.team_side === "home" ? s.matches.home_team : s.matches.away_team;
    }).filter(Boolean)
  )) as string[];

  const recentFormRatings = matchRatingValues.slice(0, 5);

  const recentMatches = playedMatches.slice(0, 5);
  const displayMatches = showAllMatches ? playedMatches : recentMatches;

  if (!supabase) {
    return (
      <main className="mx-auto max-w-6xl px-6 py-10">
        <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
          <div className="text-xl font-semibold">{t("player.loading")}</div>
          <p className="mt-2 text-white/70">{t("player.missingEnv")}</p>
        </div>
      </main>
    );
  }

  if (loading) {
    return (
      <main className="mx-auto max-w-6xl px-6 py-10">
        <div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-white/70">
          {t("player.loadingPlayer")}
        </div>
      </main>
    );
  }

  if (error || !player) {
    return (
      <main className="mx-auto max-w-6xl px-6 py-10">
        <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-6">
          <div className="text-lg font-semibold">{t("common.error")}</div>
          <pre className="mt-3 overflow-auto text-xs text-white/80">
            {error ? JSON.stringify(error, null, 2) : t("player.notFound")}
          </pre>
        </div>
        <Link href="/players" className="mt-4 inline-block text-sm text-white/60 hover:text-white">
          ← {t("player.backToPlayers")}
        </Link>
      </main>
    );
  }

  const displayName = player.name || player.handle || `Player ${player.id.slice(0, 8)}`;

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm">
        <Link href="/" className="text-white/50 hover:text-white/80 transition">{t("nav.home")}</Link>
        <span className="text-white/30">/</span>
        <Link href="/players" className="text-white/50 hover:text-white/80 transition">{t("nav.players")}</Link>
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
              <span className="text-sm text-white/40">{t("player.playerId")}:</span>
              <code className="rounded bg-white/10 px-2 py-0.5 text-sm font-mono text-white/70">
                {player.game_user_id}
              </code>
            </div>
          )}
          <div className="mt-1 flex items-center gap-2">
            <span className="text-sm text-white/40">{t("player.discord")}:</span>
            {player.discord_id ? (
              <code className="rounded bg-indigo-500/20 px-2 py-0.5 text-sm font-mono text-indigo-300">
                {player.discord_id}
              </code>
            ) : (
              <span className="text-sm italic text-white/30">{t("player.unknown")}</span>
            )}
          </div>
          {player.created_at && (
            <div className="mt-1 text-sm text-white/40">
              {t("player.registered")} {formatDate(player.created_at)}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2 items-start md:items-end">
          {mostPlayedPosition && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-white/50">{t("player.mainPosition")}:</span>
              <PositionBadge position={mostPlayedPosition} />
            </div>
          )}
          {lastClub && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-white/50">{t("player.lastClub")}:</span>
              {teamIdMap[lastClub.teamName] ? (
                <Link href={`/teams/${teamIdMap[lastClub.teamName]}`} style={{ textDecoration: "none" }}>
                  <span className="rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-sm font-medium text-emerald-200 hover:bg-emerald-400/20 transition-colors cursor-pointer">
                    {lastClub.teamName}
                  </span>
                </Link>
              ) : (
                <span className="rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-sm font-medium text-emerald-200">
                  {lastClub.teamName}
                </span>
              )}
            </div>
          )}
          {matchRatingValues.length > 0 && (
            <Link href={`/players/${playerId}/rating`} style={{ textDecoration: "none" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, background: "var(--bg-card)", border: `1.5px solid ${ratingColor}`, padding: "8px 14px", cursor: "pointer" }}>
                <div>
                  <div style={{ fontSize: 28, fontWeight: 900, color: ratingColor, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>
                    {overallRating !== null ? overallRating : "N/A"}
                  </div>
                  <div style={{ fontSize: 9, color: "var(--text-muted)", letterSpacing: "0.15em", fontWeight: 700, textTransform: "uppercase", marginTop: 2 }}>{t("player.rating")}</div>
                </div>
                <div style={{ fontSize: 11, color: ratingColor, fontWeight: 700, letterSpacing: "0.06em" }}>
                  {ratingLabelText ?? t("player.matchesForRating", { n: matchRatingValues.length })}
                  <div style={{ fontSize: 10, color: "var(--text-faint)", fontWeight: 400, marginTop: 2 }}>{t("player.fullBreakdown")} →</div>
                </div>
              </div>
            </Link>
          )}
        </div>
      </div>

      {/* Club History */}
      {teamsPlayedFor.length > 0 && (
        <div className="mt-6">
          <div className="text-sm text-white/50 mb-2">{t("player.teamsPlayedFor")}:</div>
          <div className="flex flex-wrap gap-2">
            {teamsPlayedFor.map((team) => {
              const teamId = teamIdMap[team];
              const badge = (
                <span
                  className={cx(
                    "rounded-lg border px-3 py-1 text-sm transition-colors",
                    team === lastClub?.teamName
                      ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200"
                      : "border-white/10 bg-white/5 text-white/70",
                    teamId && "hover:bg-white/10 cursor-pointer"
                  )}
                >
                  {team}
                </span>
              );
              return teamId ? (
                <Link key={team} href={`/teams/${teamId}`} style={{ textDecoration: "none" }}>
                  {badge}
                </Link>
              ) : (
                <span key={team}>{badge}</span>
              );
            })}
          </div>
        </div>
      )}

      {/* Recent Form Strip */}
      {recentFormRatings.length > 0 && (
        <div className="mt-6">
          <div className="text-sm text-white/50 mb-2">{t("player.recentForm")} <span className="text-white/30 text-xs">{t("player.lastRatedMatches", { n: recentFormRatings.length })}</span></div>
          <div className="flex items-center gap-2">
            {recentFormRatings.map((r, i) => {
              const c = getRatingColor(r);
              return (
                <div
                  key={i}
                  title={t("player.matchRatingTitle", { r })}
                  style={{ background: c + "22", border: `1.5px solid ${c}55`, color: c }}
                  className="flex h-9 w-12 items-center justify-center rounded-lg text-sm font-bold"
                >
                  {r}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Position Pie Chart */}
      {Object.keys(positionCounts).length > 0 && (() => {
        const entries = Object.entries(positionCounts).sort((a, b) => b[1] - a[1]);
        const total = entries.reduce((s, [, n]) => s + n, 0);

        // Hex colours per position (matching POSITION_COLORS theme)
        const PIE_COLORS: Record<string, string> = {
          GK: "#facc15",
          LB: "#4ade80", RB: "#4ade80", CB: "#4ade80", LCB: "#4ade80", RCB: "#4ade80",
          LWB: "#2dd4bf", RWB: "#2dd4bf",
          CM: "#60a5fa", LM: "#60a5fa", RM: "#60a5fa", CDM: "#60a5fa", CAM: "#60a5fa",
          LW: "#c084fc", RW: "#c084fc",
          LF: "#fb923c", RF: "#fb923c",
          CF: "#f87171", ST: "#f87171",
        };
        const sliceColor = (pos: string) => PIE_COLORS[pos] ?? "#94a3b8";

        const R = 70, cx = 90, cy = 80;
        let angle = -Math.PI / 2;
        const slices = entries.map(([pos, count]) => {
          const sweep = (count / total) * 2 * Math.PI;
          const x1 = cx + R * Math.cos(angle);
          const y1 = cy + R * Math.sin(angle);
          angle += sweep;
          const x2 = cx + R * Math.cos(angle);
          const y2 = cy + R * Math.sin(angle);
          const large = sweep > Math.PI ? 1 : 0;
          return { pos, count, sweep, x1, y1, x2, y2, large, midAngle: angle - sweep / 2 };
        });

        return (
          <div className="mt-6">
            <div className="text-sm text-white/50 mb-3">{t("player.positionBreakdown")}</div>
            <div className="rounded-xl border border-white/10 bg-white/5 p-4 flex flex-wrap items-center gap-6">
              <svg viewBox="0 0 180 160" style={{ width: 180, height: 160, flexShrink: 0 }}>
                {slices.map(({ pos, sweep, x1, y1, x2, y2, large }) =>
                  sweep >= 2 * Math.PI - 0.001 ? (
                    <circle key={pos} cx={cx} cy={cy} r={R} fill={sliceColor(pos)} opacity="0.85" />
                  ) : (
                    <path key={pos} d={`M${cx},${cy} L${x1},${y1} A${R},${R} 0 ${large},1 ${x2},${y2} Z`}
                      fill={sliceColor(pos)} opacity="0.85" stroke="rgba(0,0,0,0.3)" strokeWidth="1" />
                  )
                )}
              </svg>
              <div className="flex flex-col gap-1.5">
                {entries.map(([pos, count]) => (
                  <div key={pos} className="flex items-center gap-2">
                    <span style={{ width: 10, height: 10, borderRadius: 2, background: sliceColor(pos), flexShrink: 0, display: "inline-block" }} />
                    <span className="text-xs text-white/70 font-medium w-8">{pos}</span>
                    <span className="text-xs text-white/40">{t("player.matchCount", { n: count })}</span>
                    <span className="text-xs text-white/50 ml-1">({Math.round(count / total * 100)}%)</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Total Stats */}
      <div className="mt-8">
        <div className="flex items-center justify-between">
          <div className="text-lg font-semibold">{t("player.careerStats")}</div>
          {totalStats.matches_without_stats > 0 && (
            <div className="text-xs text-amber-400/80 flex items-center gap-1">
              <span>⚠️</span>
              <span>{t("player.incompleteStatsNote", { n: totalStats.matches_without_stats })}</span>
            </div>
          )}
        </div>
        
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-7">
          <StatCard 
            label={t("player.appearances")} 
            value={totalStats.matches_played} 
            subtext={t("player.startsSub", { starts: totalStats.starts, sub: totalStats.sub_appearances })}
          />
          <StatCard
            label={t("player.record")}
            value={`${totalStats.wins}W ${totalStats.draws}D ${totalStats.losses}L`}
            subtext={t("player.winRate", { n: totalStats.matches_played > 0 ? ((totalStats.wins / totalStats.matches_played) * 100).toFixed(0) : 0 })}
          />
          <StatCard 
            label={t("player.goals")} 
            value={totalStats.goals} 
            color="text-emerald-400" 
            subtext={totalStats.matches_without_stats > 0 ? t("player.fromMatches", { n: totalStats.matches_with_stats }) : undefined}
          />
          <StatCard 
            label={t("player.assists")} 
            value={totalStats.assists} 
            color="text-sky-400" 
            subtext={totalStats.matches_without_stats > 0 ? t("player.fromMatches", { n: totalStats.matches_with_stats }) : undefined}
          />
          <StatCard
            label={t("player.avgScore")}
            value={totalStats.avg_score.toFixed(1)}
            color="text-amber-400"
            subtext={t("player.allMatches")}
          />
          <StatCard
            label={t("player.ga")}
            value={totalStats.goals + totalStats.assists}
            subtext={totalStats.matches_without_stats > 0 ? t("player.fromMatches", { n: totalStats.matches_with_stats }) : t("player.goalContributions")}
            color="text-purple-400"
          />
          <StatCard
            label={t("player.benched")}
            value={totalStats.benched}
            subtext={t("player.unusedSub")}
            color="text-gray-400"
          />
        </div>

        {/* Detailed stats - only if we have some matches with stats */}
        {totalStats.matches_with_stats > 0 && (
          <>
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
              <StatCard label={t("player.shots")} value={totalStats.shots} />
              <StatCard label={t("player.onTarget")} value={totalStats.shots_on_target} />
              <StatCard label={t("player.passes")} value={totalStats.passes} />
              <StatCard label={t("player.keyPasses")} value={totalStats.key_passes} />
              <StatCard label={t("player.tackles")} value={totalStats.tackles} />
              <StatCard label={t("player.keyTackles")} value={totalStats.key_tackles} />
              <StatCard label={t("player.interceptions")} value={totalStats.interceptions} />
              <StatCard label={t("player.possLost")} value={totalStats.possessions_lost} />
            </div>

            {totalStats.matches_without_stats > 0 && (
              <p className="mt-2 text-xs text-white/40">
                * {t("player.detailedFrom", { with: totalStats.matches_with_stats, played: totalStats.matches_played })}
              </p>
            )}
          </>
        )}

        {(totalStats.gk_saves > 0 || totalStats.gk_catches > 0) && (
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard label={t("player.gkSaves")} value={totalStats.gk_saves} color="text-yellow-400" />
            <StatCard label={t("player.gkCatches")} value={totalStats.gk_catches} color="text-yellow-400" />
          </div>
        )}
      </div>

      {/* Awards */}
      <div className="mt-10">
        <div className="flex items-center justify-between">
          <div className="text-lg font-semibold">
            {t("player.awards")}
            {totwAppearances.length > 0 && (
              <span className="ml-2 text-sm font-normal text-white/40">
                ({t("player.totwCount", { n: totwAppearances.length })})
              </span>
            )}
          </div>
          <button
            onClick={() => setShowAwards(v => !v)}
            className="text-sm text-white/60 hover:text-white"
          >
            {showAwards ? t("player.hide") : t("player.show")}
          </button>
        </div>
        {showAwards && (
          totwLoading ? (
            <div className="mt-3 text-sm text-white/40">{t("player.loadingAwards")}</div>
          ) : totwAppearances.length === 0 ? (
            <div className="mt-3 rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-white/50">
              {t("player.noTotw")}
            </div>
          ) : (
            <div className="mt-3 space-y-2">
              {totwAppearances.map((a, i) => (
                <Link
                  key={i}
                  href={`/matches/${a.matchId}`}
                  style={{ textDecoration: "none", color: "inherit", display: "block" }}
                >
                  <div className="flex items-center gap-4 rounded-xl border border-white/10 bg-white/5 p-4 transition hover:border-white/20 hover:bg-white/[0.08]">
                    <div style={{ fontSize: 22, color: "#f4a261", flexShrink: 0 }}>★</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-body)" }}>
                        {t("player.totwMatchday", { day: a.day })}
                      </div>
                      <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
                        {a.leagueName} • {a.slot}
                      </div>
                    </div>
                    <div style={{ fontSize: 22, fontWeight: 900, color: getRatingColor(a.rating), fontVariantNumeric: "tabular-nums" }}>
                      {a.rating}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )
        )}
      </div>

      {/* Match History */}
      <div className="mt-10">
        <div className="flex items-center justify-between">
          <div className="text-lg font-semibold">
            {showAllMatches ? t("player.allAppearances") : t("player.recentAppearances")}
          </div>
          <div className="flex items-center gap-4">
            {playedMatches.length > 5 && (
              <button
                onClick={() => setShowAllMatches(!showAllMatches)}
                className="text-sm text-white/60 hover:text-white"
              >
                {showAllMatches ? t("player.showRecentOnly") : t("player.viewAll", { n: playedMatches.length })}
              </button>
            )}
          </div>
        </div>

        {playedMatches.length === 0 ? (
          <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-6 text-white/70">
            {t("player.noAppearances")}
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
                          {t("player.started")}
                        </span>
                      ) : (
                        <span className="rounded-full border border-orange-400/30 bg-orange-400/10 px-2 py-0.5 text-xs text-orange-200">
                          {t("player.sub")}
                        </span>
                      )}
                      {s.stats_incomplete && (
                        <span className="rounded-full border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-xs text-amber-200">
                          {t("player.statsNA")}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-4 text-sm">
                    {s.stats_incomplete ? (
                      <span className="text-amber-400/70">{t("player.statsNotAvailable")}</span>
                    ) : (
                      <>
                        {(s.goals ?? 0) > 0 && (
                          <span className="text-emerald-400">⚽ {t("player.goalWord", { n: s.goals ?? 0 })}</span>
                        )}
                        {(s.assists ?? 0) > 0 && (
                          <span className="text-sky-400">🅰️ {t("player.assistWord", { n: s.assists ?? 0 })}</span>
                        )}
                        <span className="text-white/50">{t("player.shotsLine", { shots: s.shots ?? 0, ont: s.shots_on_target ?? 0 })}</span>
                        <span className="text-white/50">{t("player.passesLine", { passes: s.passes ?? 0, key: s.key_passes ?? 0 })}</span>
                        <span className="text-white/50">{t("player.tacklesLine", { n: s.tackles ?? 0 })}</span>
                      </>
                    )}
                    <span className="text-amber-400">{t("player.scoreWord")}: {s.score}</span>
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
              {t("player.benchedCount", { n: benchedMatches.length })}
            </div>
            <button
              onClick={() => setShowBenchedMatches(!showBenchedMatches)}
              className="text-sm text-white/60 hover:text-white"
            >
              {showBenchedMatches ? t("player.hide") : t("player.show")} {t("player.benchedMatches")}
            </button>
          </div>
          
          <p className="mt-1 text-sm text-white/40">
            {t("player.unusedSubstitute")}
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
                          {formatDate(match.played_at)} • {t("player.subWord")} {s.sub_number}
                        </div>
                      </div>
                      <span className="rounded border border-gray-600/30 bg-gray-600/10 px-2 py-0.5 text-xs text-gray-400">
                        {t("player.benchedWord")}
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