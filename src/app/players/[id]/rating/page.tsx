"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useLanguage } from "@/components/LanguageProvider";
import {
  calcSubRatings,
  calcOverallRating,
  calcMatchBreakdown,
  isRatingEligibleScore,
  DEFAULT_TIER_BONUSES,
  getRatingColor,
  getRatingLabel,
  getMatchRatingColor,
  getPositionRole,
  type MatchStatRow,
  type MatchResult,
  type MatchBreakdown,
  type SubRatings,
} from "@/lib/ratings";

type PlayerRow = {
  id: string;
  handle: string | null;
  name: string | null;
  game_user_id: string | null;
};

type MatchInfo = {
  id: string;
  played_at: string;
  home_team: string;
  away_team: string;
  home_score: number;
  away_score: number;
  league_id: string | null;
  leagues?: { id: string; name: string; tier?: number | null } | null;
};

type StatRow = {
  match_id: string;
  team_side: "home" | "away";
  position: string | null;
  score: number;
  goals: number;
  assists: number;
  shots: number;
  key_passes: number;
  shots_on_target: number;
  passes: number;
  tackles: number;
  key_tackles: number;
  interceptions: number;
  key_interceptions: number;
  possessions_lost: number;
  gk_saves: number;
  gk_catches: number;
  benched: boolean;
  is_starter: boolean | null;
  sub_number: number | null;
  stats_incomplete: boolean;
  matches?: MatchInfo | null;
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "2-digit" });
}

function SubRatingBar({ label, value, detail }: { label: string; value: number; detail?: string }) {
  const color = getRatingColor(value);
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-sub)", letterSpacing: "0.04em" }}>{label}</span>
        <span style={{ fontSize: 18, fontWeight: 900, color, minWidth: 36, textAlign: "right" }}>{Math.round(value)}</span>
      </div>
      <div style={{ height: 6, background: "var(--border-main)", borderRadius: 3, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${value}%`, background: color, borderRadius: 3, transition: "width 0.6s ease" }} />
      </div>
      {detail && <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>{detail}</div>}
    </div>
  );
}

export default function PlayerRatingPage() {
  const params = useParams();
  const playerId = params.id as string;
  const { t } = useLanguage();

  const [player, setPlayer] = useState<PlayerRow | null>(null);
  const [stats, setStats] = useState<StatRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedMatchId, setExpandedMatchId] = useState<string | null>(null);
  const [hoveredDot, setHoveredDot] = useState<{ i: number; x: number; y: number; d: { rating: number; date: string; homeTeam: string; awayTeam: string; homeScore: number; awayScore: number } } | null>(null);
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

      const { data: playerData, error: playerErr } = await supabase
        .from("players")
        .select("id,handle,name,game_user_id")
        .eq("id", playerId)
        .single();

      if (playerErr || !playerData) {
        setError(t("rating.playerNotFound"));
        setLoading(false);
        return;
      }
      setPlayer(playerData);

      // Try fetching with league tier
      const { data: statsData, error: statsErr } = await supabase
        .from("match_player_stats")
        .select(
          "match_id,team_side,position,score,goals,assists,shots,shots_on_target,key_passes,passes,tackles,key_tackles,interceptions,key_interceptions,possessions_lost,gk_saves,gk_catches,benched,is_starter,sub_number,stats_incomplete,matches(id,played_at,home_team,away_team,home_score,away_score,league_id,leagues(id,name,tier,use_tier_bonus))"
        )
        .eq("player_id", playerId);

      if (statsErr) {
        // Fallback without league tier
        const { data: fallback } = await supabase
          .from("match_player_stats")
          .select(
            "match_id,team_side,position,score,goals,assists,shots,shots_on_target,key_passes,passes,tackles,key_tackles,interceptions,key_interceptions,possessions_lost,gk_saves,gk_catches,benched,is_starter,sub_number,stats_incomplete,matches(id,played_at,home_team,away_team,home_score,away_score,league_id)"
          )
          .eq("player_id", playerId);

        const normalized = (fallback ?? []).map((s: any) => {
          const rawMatch = Array.isArray(s.matches) ? s.matches[0] ?? null : s.matches ?? null;
          const normalizedMatch = rawMatch ? {
            ...rawMatch,
            leagues: Array.isArray(rawMatch.leagues) ? rawMatch.leagues[0] ?? null : rawMatch.leagues ?? null,
          } : null;
          return { ...s, benched: s.benched ?? false, stats_incomplete: s.stats_incomplete ?? false, matches: normalizedMatch };
        });
        setStats(normalized);
      } else {
        const normalized = (statsData ?? []).map((s: any) => {
          const rawMatch = Array.isArray(s.matches) ? s.matches[0] ?? null : s.matches ?? null;
          const normalizedMatch = rawMatch ? {
            ...rawMatch,
            leagues: Array.isArray(rawMatch.leagues) ? rawMatch.leagues[0] ?? null : rawMatch.leagues ?? null,
          } : null;
          return { ...s, benched: s.benched ?? false, stats_incomplete: s.stats_incomplete ?? false, matches: normalizedMatch };
        });
        setStats(normalized);
      }

      setLoading(false);
    })();
  }, [playerId]);

  if (!supabase) return <main style={{ padding: 40, color: "var(--text-sub)" }}>{t("rating.supabaseNotConfigured")}</main>;

  if (loading) {
    return (
      <main style={{ minHeight: "calc(100vh - 56px)", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ color: "var(--text-muted)", fontSize: 14 }}>{t("rating.loadingRating")}</div>
      </main>
    );
  }

  if (error || !player) {
    return (
      <main style={{ padding: 40 }}>
        <p style={{ color: "#e63946" }}>{error ?? t("rating.playerNotFound")}</p>
        <Link href="/players" style={{ color: "var(--text-muted)", fontSize: 13 }}>← {t("rating.backToPlayers")}</Link>
      </main>
    );
  }

  const displayName = player.name || player.handle || t("rating.playerN", { id: player.id.slice(0, 8) });

  // Only use played (non-benched) matches with complete stats for rating
  const playedStats = stats.filter(s => !s.benched && !s.stats_incomplete && s.matches);

  // Determine match results
  const results: MatchResult[] = playedStats.map(s => {
    const m = s.matches!;
    const isHome = s.team_side === "home";
    const myScore = isHome ? m.home_score : m.away_score;
    const oppScore = isHome ? m.away_score : m.home_score;
    return myScore > oppScore ? "W" : myScore < oppScore ? "L" : "D";
  });

  // Build MatchStatRow array for rating calculations
  const statRows: MatchStatRow[] = playedStats.map(s => {
    const m = s.matches!;
    const isHome = s.team_side === "home";
    const goalsConceded = isHome ? m.away_score : m.home_score;
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

  // Pair every played match with its own stat row and result up front, so nothing
  // downstream ever has to look a stat row up by id (and risk falling back to
  // the wrong match's stats).
  const playedEntries = playedStats.map((s, i) => ({
    s,
    sr: statRows[i],
    r: results[i],
    counts: isRatingEligibleScore(s.score),
  }));

  // Only matches with a valid recorded score (> 60) count. A score of 0 means the
  // player didn't really play, so it is excluded from the rating entirely.
  const ratingEligible = playedEntries.filter(x => x.counts);
  const ratingPlayedStats = ratingEligible.map(x => x.s);
  const ratingStatRows = ratingEligible.map(x => x.sr);
  const ratingResults = ratingEligible.map(x => x.r);

  // Dominant position
  const posCounts: Record<string, number> = {};
  for (const s of playedStats) {
    if (s.position) posCounts[s.position] = (posCounts[s.position] ?? 0) + 1;
  }
  const dominantPosition = Object.entries(posCounts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;
  const role = getPositionRole(dominantPosition);

  // Dominant league tier (skip leagues with use_tier_bonus disabled)
  const tierCounts: Record<number, number> = {};
  for (const s of ratingPlayedStats) {
    if ((s.matches as any)?.leagues?.use_tier_bonus === false) continue;
    const tier = (s.matches as any)?.leagues?.tier ?? 2;
    tierCounts[tier] = (tierCounts[tier] ?? 0) + 1;
  }
  const dominantTier = Object.entries(tierCounts).sort((a, b) => b[1] - a[1])[0]?.[0];
  const leagueTier = dominantTier ? parseInt(dominantTier) : 2;

  const subRatings: SubRatings = calcSubRatings(ratingStatRows, ratingResults, dominantPosition);

  // Compute per-match ratings for eligible matches only (used for overall average)
  const allMatchRatingValues = ratingEligible.map(({ s, sr, r }) =>
    calcMatchBreakdown(sr, r, s.position ?? dominantPosition).final
  );

  const hasEnoughForRating = ratingPlayedStats.length >= 3;
  const overall = hasEnoughForRating ? calcOverallRating(allMatchRatingValues, leagueTier, tierBonuses) : null;
  const ratingColor = overall !== null ? getRatingColor(overall) : "var(--text-faint)";
  const ratingLabel = overall !== null ? getRatingLabel(overall) : null;

  // Cumulative overall rating after each eligible match, oldest → newest
  const cumulativeRatingHistory = ratingPlayedStats
    .map((s, i) => ({
      date: s.matches?.played_at ?? "",
      matchId: s.match_id,
      homeTeam: s.matches!.home_team,
      awayTeam: s.matches!.away_team,
      homeScore: s.matches!.home_score,
      awayScore: s.matches!.away_score,
      matchRatingValue: allMatchRatingValues[i],
    }))
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((item, i, arr) => ({
      ...item,
      overall: calcOverallRating(arr.slice(0, i + 1).map(x => x.matchRatingValue), leagueTier, tierBonuses),
    }));

  // Per-match display sorted newest first, max 20.
  // Each entry keeps its OWN stat row — matches that don't count toward the rating
  // are shown unrated rather than borrowing another match's stats.
  const matchRatings = [...playedEntries]
    .sort((a, b) => (b.s.matches?.played_at ?? "").localeCompare(a.s.matches?.played_at ?? ""))
    .map(({ s, sr, r, counts }) => {
      const breakdown = counts ? calcMatchBreakdown(sr, r, s.position ?? dominantPosition) : null;
      return {
        matchId: s.matches!.id,
        date: s.matches!.played_at,
        homeTeam: s.matches!.home_team,
        awayTeam: s.matches!.away_team,
        homeScore: s.matches!.home_score,
        awayScore: s.matches!.away_score,
        mySide: s.team_side,
        position: s.position,
        result: r,
        counts,
        rating: breakdown?.final ?? null,
        leagueName: (s.matches as any)?.leagues?.name ?? null,
        statRow: sr,
        breakdown,
      };
    })
    .slice(0, 20);

  // Per-match averages for stat display
  const n = ratingStatRows.length;
  const avg = (fn: (s: MatchStatRow) => number) =>
    n > 0 ? (ratingStatRows.reduce((sum, s) => sum + fn(s), 0) / n) : 0;

  const avgGoals     = avg(s => s.goals);
  const avgAssists   = avg(s => s.assists);
  const avgShots     = n > 0 ? ratingPlayedStats.reduce((sum, s) => sum + (s.shots ?? 0), 0) / n : 0;
  const avgSOT       = avg(s => s.shots_on_target);
  const avgPasses    = avg(s => s.passes);
  const avgKP        = avg(s => s.key_passes);
  const avgTackles   = avg(s => s.tackles);
  const avgKTackles  = avg(s => s.key_tackles);
  const avgInt       = avg(s => s.interceptions);
  const avgKInt      = avg(s => s.key_interceptions);
  const avgPL        = avg(s => s.possessions_lost);
  const avgSaves     = avg(s => s.gk_saves);
  const avgCatches   = avg(s => s.gk_catches);
  const avgGC        = avg(s => s.goals_conceded ?? 0);
  const scoredRows   = ratingPlayedStats.filter(s => isRatingEligibleScore(s.score));
  const avgScore     = scoredRows.length > 0 ? scoredRows.reduce((sum, s) => sum + s.score, 0) / scoredRows.length : 0;

  // Helper: clamp a raw value to [0, 100]
  const sr = (val: number) => Math.min(100, Math.max(0, Math.round(val)));

  // Display bars mirror the exact thresholds used in ratings.ts — 100% = formula cap point.
  // Goals/Assists/SoT: attackingScore thresholds (≈1.6× position avg → 100%)
  // Passes/Key Passes: passingScore position-aware caps (2× avg → 100%; DEF/GK use 80/20 weight split)
  // Tackles: combined (t+kt)/6.0 — same as formula bucket; 100% at 6.0
  // Key Tackles: bonus kt/1.75 — shown separately; 100% at 1.75
  // Interceptions: combined (i+ki)/4.5 — same as formula bucket; 100% at 4.5
  // Poss Lost: inverted 1−pl/14; 100% at 0 lost, 0% at 14+
  // GK: saves/8.40, catches/4.00, GC inverted at 8.6
  // Shots: display-only (not in formula) — scaled relative to SoT threshold
  const gT  = role === "FWD" ? 2.24 : role === "MID" ? 1.5  : 0.08;
  const aT  = role === "FWD" ? 0.96 : role === "MID" ? 1.5  : 0.30;
  const sT  = role === "FWD" ? 4.0  : role === "MID" ? 2.7  : 0.40;
  const shT = role === "FWD" ? 6.0  : role === "MID" ? 4.0  : 0.60;

  const rGoals    = sr(avgGoals / gT * 100);
  const rAssists  = sr(avgAssists / aT * 100);
  const rShots    = sr(avgShots / shT * 100);
  const rSOT      = sr(avgSOT / sT * 100);
  const pCap  = role === "MID" ? 33.4 : role === "GK" ? 23.0 : role === "DEF" ? 23.5 : 22.1;
  const kpCap = role === "MID" ? 2.4  : role === "GK" ? 0.48 : role === "DEF" ? 1.0  : 2.84;
  const rPasses   = sr(avgPasses / pCap * 100);
  const rKP       = sr(avgKP / kpCap * 100);
  const rTackles  = sr((avgTackles + avgKTackles) / 6.0 * 100);
  const rKTackles = sr(avgKTackles / 1.75 * 100);
  const rInt      = sr((avgInt + avgKInt) / 4.5 * 100);
  const rPL       = sr(Math.max(0, 1 - avgPL / 28.0) * 100);
  const rSaves    = sr(avgSaves / 8.00 * 100);
  const rCatches  = sr(avgCatches / 4.00 * 100);
  const rGC       = sr(Math.max(0, 1 - avgGC / 9.2) * 100);

  const tierLabel = leagueTier === 1 ? t("rating.tier1") : leagueTier === 3 ? t("rating.tier3") : t("rating.tier2");

  return (
    <main style={{ minHeight: "calc(100vh - 56px)" }}>
      {/* Header bar */}
      <section style={{ borderBottom: "1px solid var(--border-main)", padding: "32px 24px 24px", background: "var(--bg-nav)" }}>
        <div style={{ maxWidth: 860, margin: "0 auto" }}>
          <div style={{ fontSize: 11, letterSpacing: "0.25em", color: "var(--text-faint)", fontWeight: 700, textTransform: "uppercase", marginBottom: 14 }}>
            <Link href="/" style={{ color: "var(--text-faint)", textDecoration: "none" }}>{t("nav.home")}</Link>
            <span style={{ margin: "0 8px" }}>/</span>
            <Link href="/players" style={{ color: "var(--text-faint)", textDecoration: "none" }}>{t("nav.players")}</Link>
            <span style={{ margin: "0 8px" }}>/</span>
            <Link href={`/players/${playerId}`} style={{ color: "var(--text-faint)", textDecoration: "none" }}>{displayName}</Link>
            <span style={{ margin: "0 8px" }}>/</span>
            {t("rating.rating")}
          </div>

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 20 }}>
            <div>
              <h1 style={{ fontSize: 28, fontWeight: 900, color: "var(--text-main)", margin: 0, letterSpacing: "-0.02em" }}>{displayName}</h1>
              <div style={{ display: "flex", gap: 10, marginTop: 8, alignItems: "center", flexWrap: "wrap" }}>
                {dominantPosition && (
                  <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-sub)", background: "var(--border-main)", padding: "3px 10px", letterSpacing: "0.12em", textTransform: "uppercase" }}>
                    {dominantPosition} · {role}
                  </span>
                )}
                <span style={{ fontSize: 11, color: "var(--text-muted)", letterSpacing: "0.08em" }}>{tierLabel}</span>
              </div>
            </div>

            {/* Overall rating badge */}
            <div style={{ textAlign: "center", background: "var(--bg-card)", border: `2px solid ${ratingColor}`, padding: "16px 28px", minWidth: 110 }}>
              <div style={{ fontSize: 52, fontWeight: 900, color: ratingColor, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>
                {overall !== null ? overall : playedStats.length > 0 ? "N/A" : "—"}
              </div>
              <div style={{ fontSize: 10, color: "var(--text-muted)", letterSpacing: "0.2em", fontWeight: 700, textTransform: "uppercase", marginTop: 4 }}>{t("rating.overall")}</div>
              {overall !== null && (
                <div style={{ fontSize: 12, color: ratingColor, fontWeight: 700, marginTop: 2 }}>{ratingLabel}</div>
              )}
              {!hasEnoughForRating && playedStats.length > 0 && (
                <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 4 }}>{t("rating.matchesOutOf3", { n: playedStats.length })}</div>
              )}
            </div>
          </div>
        </div>
      </section>

      <div style={{ maxWidth: 860, margin: "0 auto", padding: "32px 24px" }}>
        {playedStats.length === 0 ? (
          <div style={{ background: "var(--bg-card)", padding: "48px 24px", textAlign: "center", color: "var(--text-faint)", fontSize: 14 }}>
            {t("rating.noStatsForRating")}
          </div>
        ) : !hasEnoughForRating ? (
          <div style={{ background: "var(--bg-card)", padding: "48px 24px", textAlign: "center", color: "var(--text-faint)", fontSize: 14 }}>
            <div style={{ fontSize: 16, color: "var(--text-muted)", marginBottom: 8 }}>{t("rating.ratingNotAvailable")}</div>
            <div>{t("rating.minMatchesRequired")}</div>
            <div style={{ marginTop: 8 }}>{t("rating.matchesRecorded", { n: playedStats.length })}</div>
          </div>
        ) : (
          <>
          {cumulativeRatingHistory.length >= 2 && (() => {
            const chartData = cumulativeRatingHistory; // already oldest → newest
            const W = 820, H = 150;
            const padL = 36, padR = 16, padT = 14, padB = 8;
            const chartW = W - padL - padR;
            const chartH = H - padT - padB;

            const minR = Math.max(0, Math.min(...chartData.map(d => d.overall)) - 8);
            const maxR = Math.min(100, Math.max(...chartData.map(d => d.overall)) + 8);
            const yRange = maxR - minR || 10;

            const xOf = (i: number) => padL + (chartData.length === 1 ? chartW / 2 : (i / (chartData.length - 1)) * chartW);
            const yOf = (r: number) => padT + chartH - ((r - minR) / yRange) * chartH;

            const linePoints = chartData.map((d, i) => `${xOf(i)},${yOf(d.overall)}`).join(" ");
            const areaPoints = `${xOf(0)},${padT + chartH} ${linePoints} ${xOf(chartData.length - 1)},${padT + chartH}`;

            const gridVals = [40, 50, 60, 70, 80, 90, 100].filter(v => v > minR && v <= maxR + 2);

            return (
              <div style={{ background: "var(--bg-card)", padding: "20px 24px", marginBottom: 24 }}>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.2em", color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 14 }}>
                  {t("rating.ratingHistory")}
                </div>
                <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }}>
                  {/* Grid lines */}
                  {gridVals.map(v => (
                    <g key={v}>
                      <line x1={padL} y1={yOf(v)} x2={W - padR} y2={yOf(v)} stroke="var(--border-row)" strokeWidth="1" strokeDasharray="3 4" />
                      <text x={padL - 5} y={yOf(v)} textAnchor="end" dominantBaseline="middle" fill="var(--text-faint)" fontSize="9">{v}</text>
                    </g>
                  ))}


                  {/* Area fill */}
                  <polygon points={areaPoints} fill={ratingColor} opacity="0.07" />

                  {/* Line */}
                  <polyline points={linePoints} fill="none" stroke={ratingColor} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />

                  {/* Dots */}
                  {chartData.map((d, i) => {
                    const c = getRatingColor(d.overall);
                    const cx = xOf(i);
                    const cy = yOf(d.overall);
                    return (
                      <g key={d.matchId} style={{ cursor: "pointer" }}
                        onMouseEnter={() => setHoveredDot({ i, x: cx, y: cy, d: { rating: d.overall, date: d.date, homeTeam: d.homeTeam, awayTeam: d.awayTeam, homeScore: d.homeScore, awayScore: d.awayScore } })}
                        onMouseLeave={() => setHoveredDot(null)}
                      >
                        <circle cx={cx} cy={cy} r="8" fill="transparent" />
                        <circle cx={cx} cy={cy} r={hoveredDot?.i === i ? 7 : 5} fill={c} stroke="var(--bg-card)" strokeWidth="2" />
                      </g>
                    );
                  })}

                  {/* Hover tooltip */}
                  {hoveredDot && (() => {
                    const { x, y, d: hd } = hoveredDot;
                    const label1 = `${hd.homeTeam} ${hd.homeScore}–${hd.awayScore} ${hd.awayTeam}`;
                    const label2 = formatDate(hd.date);
                    const ratingStr = String(hd.rating);
                    const tipW = 170, tipH = 52, tipR = 4;
                    const tipX = Math.max(padL, Math.min(x - tipW / 2, W - padR - tipW));
                    const tipY = y - tipH - 12 < padT ? y + 14 : y - tipH - 12;
                    return (
                      <g pointerEvents="none">
                        <rect x={tipX} y={tipY} width={tipW} height={tipH} rx={tipR} ry={tipR}
                          fill="#1a1a2e" stroke={getRatingColor(hd.rating)} strokeWidth="1.5" opacity="0.96" />
                        <text x={tipX + tipW / 2} y={tipY + 16} textAnchor="middle" fill={getRatingColor(hd.rating)} fontSize="15" fontWeight="700">{ratingStr}</text>
                        <text x={tipX + tipW / 2} y={tipY + 31} textAnchor="middle" fill="#ccc" fontSize="8.5">{label1}</text>
                        <text x={tipX + tipW / 2} y={tipY + 44} textAnchor="middle" fill="#888" fontSize="8">{label2}</text>
                      </g>
                    );
                  })()}
                </svg>
                <div style={{ fontSize: 10, color: "var(--text-faint)", marginTop: 6, textAlign: "right" }}>
                  {t("rating.chartCaption", { n: chartData.length })}
                </div>
              </div>
            );
          })()}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 24, alignItems: "start" }}>
            {/* Left: sub-ratings + match history */}
            <div>
              {/* Stat breakdown */}
              <div style={{ background: "var(--bg-card)", padding: "24px", marginBottom: 24 }}>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.2em", color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 20 }}>{t("rating.ratingBreakdown")}</div>

                {role !== "GK" && (
                  <>
                    <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.18em", color: "var(--text-faint)", textTransform: "uppercase", marginBottom: 10 }}>{t("rating.attacking")}</div>
                    <SubRatingBar label={t("rating.goals")}           value={rGoals}   detail={t("rating.perMatch", { n: avgGoals.toFixed(2) })} />
                    <SubRatingBar label={t("rating.assists")}         value={rAssists} detail={t("rating.perMatch", { n: avgAssists.toFixed(2) })} />
                    <SubRatingBar label={t("rating.shots")}           value={rShots}   detail={t("rating.perMatch", { n: avgShots.toFixed(1) })} />
                    <SubRatingBar label={t("rating.shotsOnTarget")} value={rSOT}     detail={t("rating.perMatch", { n: avgSOT.toFixed(1) })} />
                  </>
                )}

                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.18em", color: "var(--text-faint)", textTransform: "uppercase", marginBottom: 10, marginTop: role !== "GK" ? 18 : 0 }}>{t("rating.passing")}</div>
                <SubRatingBar label={t("rating.passes")}     value={rPasses} detail={t("rating.perMatch", { n: avgPasses.toFixed(0) })} />
                <SubRatingBar label={t("rating.keyPasses")} value={rKP}     detail={t("rating.perMatch", { n: avgKP.toFixed(1) })} />

                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.18em", color: "var(--text-faint)", textTransform: "uppercase", marginBottom: 10, marginTop: 18 }}>{t("rating.defending")}</div>
                <SubRatingBar label={t("rating.tackles")}         value={rTackles}  detail={t("rating.tacklesDetail", { a: avgTackles.toFixed(1), b: avgKTackles.toFixed(1), c: (avgTackles + avgKTackles).toFixed(1) })} />
                <SubRatingBar label={t("rating.keyTackles")}     value={rKTackles} detail={t("rating.perMatchBonus", { n: avgKTackles.toFixed(1) })} />
                <SubRatingBar label={t("rating.interceptions")}   value={rInt}      detail={t("rating.tacklesDetail", { a: avgInt.toFixed(1), b: avgKInt.toFixed(1), c: (avgInt + avgKInt).toFixed(1) })} />
                <SubRatingBar label={t("rating.lostPossession")} value={rPL}       detail={t("rating.perMatchLowerBetter", { n: avgPL.toFixed(1) })} />

                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.18em", color: "var(--text-faint)", textTransform: "uppercase", marginBottom: 10, marginTop: 18 }}>{t("rating.consistency")}</div>
                <SubRatingBar label={t("rating.gameScore")} value={subRatings.consistency} detail={avgScore > 0 ? t("rating.avgGameScore", { n: subRatings.consistency.toFixed(0) }) : t("rating.basedOnRecord")} />

                {role === "GK" && (
                  <>
                    <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.18em", color: "var(--text-faint)", textTransform: "uppercase", marginBottom: 10, marginTop: 18 }}>{t("rating.goalkeeping")}</div>
                    <SubRatingBar label={t("rating.goalsConceded")} value={rGC}      detail={t("rating.perMatchLowerBetter", { n: avgGC.toFixed(1) })} />
                    <SubRatingBar label={t("rating.saves")}          value={rSaves}   detail={t("rating.perMatch", { n: avgSaves.toFixed(1) })} />
                    <SubRatingBar label={t("rating.catches")}        value={rCatches} detail={t("rating.perMatch", { n: avgCatches.toFixed(1) })} />
                  </>
                )}
              </div>

              {/* Match rating history */}
              {matchRatings.length > 0 && (
                <div style={{ background: "var(--bg-card)" }}>
                  <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border-main)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.2em", color: "var(--text-muted)", textTransform: "uppercase" }}>{t("rating.matchRatingsLast", { n: matchRatings.length })}</span>
                    <span style={{ fontSize: 10, color: "var(--text-faint)" }}>{t("rating.clickToExpand")}</span>
                  </div>
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                      <thead>
                        <tr style={{ background: "var(--bg-row)" }}>
                          {[t("rating.date"), t("rating.match"), t("rating.result"), t("rating.pos"), t("rating.ratingCol")].map(h => (
                            <th key={h} style={{ padding: "8px 12px", textAlign: h === "Rating" ? "center" : "left", fontSize: 10, color: "var(--text-faint)", fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", borderBottom: "1px solid var(--border-main)", whiteSpace: "nowrap" }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      {matchRatings.map((mr) => {
                        const resultColor = mr.result === "W" ? "#4ade80" : mr.result === "D" ? "#f4c430" : "#e63946";
                        const rColor = mr.rating !== null ? getMatchRatingColor(mr.rating) : "var(--text-faint)";
                        const bd = mr.breakdown;
                        const sr = mr.statRow;
                        // Matches that don't count toward the rating have no breakdown to expand
                        const isExpanded = bd !== null && expandedMatchId === mr.matchId;
                        const cats: { key: keyof MatchBreakdown["weights"]; label: string }[] = [
                          { key: "attacking", label: t("rating.attacking") },
                          { key: "defending", label: t("rating.defending") },
                          { key: "passing", label: t("rating.passing") },
                          { key: "consistency", label: t("rating.consistency") },
                          { key: "gk", label: t("rating.gkPerf") },
                        ];
                        return (
                          <tbody key={mr.matchId}>
                            <tr
                              onClick={() => { if (bd) setExpandedMatchId(isExpanded ? null : mr.matchId); }}
                              style={{ borderBottom: isExpanded ? "none" : "1px solid var(--border-row)", cursor: bd ? "pointer" : "default", opacity: bd ? 1 : 0.55 }}
                            >
                              <td style={{ padding: "10px 12px", color: "var(--text-muted)", whiteSpace: "nowrap" }}>{formatDate(mr.date)}</td>
                              <td style={{ padding: "10px 12px" }}>
                                <Link href={`/matches/${mr.matchId}`} style={{ color: "var(--text-sub)", textDecoration: "none" }} className="nav-link" onClick={e => e.stopPropagation()}>
                                  <span style={{ fontWeight: mr.mySide === "home" ? 700 : 400, color: mr.mySide === "home" ? "var(--text-body)" : "var(--text-sub)" }}>{mr.homeTeam}</span>
                                  <span style={{ color: "var(--text-faint)", margin: "0 6px" }}>{mr.homeScore}–{mr.awayScore}</span>
                                  <span style={{ fontWeight: mr.mySide === "away" ? 700 : 400, color: mr.mySide === "away" ? "var(--text-body)" : "var(--text-sub)" }}>{mr.awayTeam}</span>
                                </Link>
                                {mr.leagueName && <div style={{ fontSize: 10, color: "var(--text-faint)", marginTop: 2 }}>{mr.leagueName}</div>}
                              </td>
                              <td style={{ padding: "10px 12px", fontWeight: 700, color: resultColor }}>{mr.result}</td>
                              <td style={{ padding: "10px 12px", color: "var(--text-muted)", fontSize: 11 }}>{mr.position ?? "—"}</td>
                              <td style={{ padding: "10px 12px", textAlign: "center" }}>
                                {mr.rating !== null ? (
                                  <>
                                    <span style={{ fontWeight: 900, fontSize: 15, color: rColor }}>{mr.rating}</span>
                                    <span style={{ fontSize: 9, color: "var(--text-faint)", marginLeft: 5 }}>{isExpanded ? "▲" : "▼"}</span>
                                  </>
                                ) : (
                                  <span
                                    title={t("rating.notCounted")}
                                    style={{ fontWeight: 700, fontSize: 13, color: "var(--text-faint)" }}
                                  >
                                    —
                                  </span>
                                )}
                              </td>
                            </tr>
                            {isExpanded && bd && (
                              <tr style={{ borderBottom: "1px solid var(--border-row)", background: "var(--bg-row)" }}>
                                <td colSpan={5} style={{ padding: "4px 16px 16px" }}>
                                  {/* Stats used */}
                                  <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 16px", padding: "10px 0 12px", borderBottom: "1px solid var(--border-row)", fontSize: 11 }}>
                                    {[
                                      { label: t("rating.goals"), v: sr.goals },
                                      { label: t("rating.assists"), v: sr.assists },
                                      { label: t("rating.sot"), v: sr.shots_on_target },
                                      { label: t("rating.keyPasses"), v: sr.key_passes },
                                      { label: t("rating.passes"), v: sr.passes },
                                      { label: t("rating.tackles"), v: sr.tackles },
                                      { label: t("rating.keyTackles"), v: sr.key_tackles },
                                      { label: t("rating.interceptions"), v: sr.interceptions },
                                      { label: t("rating.keyInt"), v: sr.key_interceptions },
                                      { label: t("rating.possLost"), v: sr.possessions_lost },
                                      ...(getPositionRole(mr.position) === "GK" ? [{ label: t("rating.goalsConceded"), v: sr.goals_conceded ?? 0 }] : []),
                                      ...(sr.gk_saves > 0 ? [{ label: t("rating.gkSavesLabel"), v: sr.gk_saves }] : []),
                                      ...(sr.gk_catches > 0 ? [{ label: t("rating.gkCatchesLabel"), v: sr.gk_catches }] : []),
                                      ...(sr.score > 60 ? [{ label: t("rating.gameScore"), v: sr.score }] : []),
                                    ].map(({ label, v }) => (
                                      <span key={label} style={{ color: "var(--text-muted)" }}>
                                        {label}: <strong style={{ color: "var(--text-sub)", fontWeight: 600 }}>{v}</strong>
                                      </span>
                                    ))}
                                  </div>

                                  {/* Sub-rating contributions */}
                                  <div style={{ padding: "10px 0 4px" }}>
                                    {cats.filter(c => bd.weights[c.key] > 0).flatMap(c => {
                                      if (c.key === "gk" && getPositionRole(mr.position) === "GK") {
                                        const gc = sr.goals_conceded ?? 0;
                                        const totalFaced = sr.gk_saves + gc;
                                        const saveRatio = totalFaced > 0 ? sr.gk_saves / totalFaced : null;
                                        const efficiencyBonus = totalFaced > 0
                                          ? (() => { const d = (saveRatio ?? 0.55) - 0.55; return Math.min(12, Math.max(-12, d * (d >= 0 ? 50 : 30))); })()
                                          : 0;
                                        // Effective weights: GC 30%, saves 30%, catches 19%
                                        return [
                                          { key: "gk-gc",      label: t("rating.goalsConceded"), score: Math.max(0, (1 - gc / 9.2) * 100),              weight: 0.30, effBonus: null as number | null },
                                          { key: "gk-saves",   label: t("rating.saves"),          score: (sr.gk_saves / 8.00) * 100,                     weight: 0.30, effBonus: null },
                                          { key: "gk-catches", label: t("rating.catches"),        score: Math.min(150, (sr.gk_catches / 4.00) * 100),    weight: 0.19, effBonus: null },
                                          { key: "gk-eff",     label: t("rating.saveEfficiency"), score: saveRatio !== null ? Math.round(saveRatio * 100) : 0, weight: 0, effBonus: efficiencyBonus },
                                        ];
                                      }
                                      return [{ key: c.key, label: c.label, score: bd.scores[c.key], weight: bd.weights[c.key], effBonus: null as number | null }];
                                    }).map(({ key, label, score, weight, effBonus }) => (
                                      <div key={key} style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 0" }}>
                                        <span style={{ fontSize: 12, color: "var(--text-sub)", width: 130 }}>{label}</span>
                                        {effBonus !== null ? (
                                          <>
                                            <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text-faint)", width: 32, textAlign: "right" }}>{score}%</span>
                                            <span style={{ fontSize: 11, color: effBonus >= 0 ? "#4ade80" : "#e63946", fontWeight: 700, marginLeft: 4 }}>
                                              {effBonus >= 0 ? "+" : ""}{effBonus.toFixed(1)} {t("rating.pts")}
                                            </span>
                                          </>
                                        ) : (
                                          <>
                                            <span style={{ fontSize: 13, fontWeight: 700, color: getRatingColor(score), width: 32, textAlign: "right" }}>{Math.round(score)}</span>
                                            <span style={{ fontSize: 10, color: "var(--text-faint)", width: 34, textAlign: "right" }}>×{Math.round(weight * 100)}%</span>
                                            <span style={{ fontSize: 11, color: "var(--text-muted)" }}>= {(score * weight).toFixed(1)}</span>
                                          </>
                                        )}
                                      </div>
                                    ))}
                                  </div>

                                  {/* Formula summary */}
                                  <div style={{ marginTop: 6, paddingTop: 8, borderTop: "1px solid var(--border-row)", display: "flex", gap: 10, alignItems: "center", fontSize: 12, color: "var(--text-muted)", flexWrap: "wrap" }}>
                                    <span>{t("rating.base")}: <strong style={{ color: "var(--text-sub)" }}>{bd.base.toFixed(1)}</strong></span>
                                    {bd.resultBonus > 0 && (
                                      <span>+ {mr.result === "W" ? t("rating.winBonus") : t("rating.drawBonus")}: <strong style={{ color: "var(--text-sub)" }}>+{bd.resultBonus}</strong></span>
                                    )}
                                    <span>= <strong style={{ color: rColor, fontSize: 15 }}>{bd.final}</strong></span>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </tbody>
                        );
                      })}
                    </table>
                  </div>
                </div>
              )}
            </div>

            {/* Right: info sidebar */}
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {/* Quick stats */}
              <div style={{ background: "var(--bg-card)", padding: "20px" }}>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.2em", color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 14 }}>{t("rating.basedOn")}</div>
                {[
                  { label: t("rating.matchesRated"), value: playedStats.length },
                  { label: t("rating.wins"), value: results.filter(r => r === "W").length },
                  { label: t("rating.draws"), value: results.filter(r => r === "D").length },
                  { label: t("rating.losses"), value: results.filter(r => r === "L").length },
                  { label: t("rating.winRate"), value: n > 0 ? t("rating.percent", { n: Math.round(results.filter(r => r === "W").length / n * 100) }) : "—" },
                ].map(({ label, value }) => (
                  <div key={label} style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", borderBottom: "1px solid var(--border-row)" }}>
                    <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{label}</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text-sub)" }}>{value}</span>
                  </div>
                ))}
              </div>

              {/* How it's calculated */}
              <div style={{ background: "var(--bg-card)", padding: "20px" }}>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.2em", color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 12 }}>{t("rating.howCalculated")}</div>
                <p style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.6, margin: 0 }}>
                  {t("rating.calcP1a")}<strong style={{ color: "var(--text-sub)" }}>0–100</strong>{t("rating.calcP1b")}
                </p>
                <p style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.6, margin: "10px 0 0" }}>
                  {t("rating.calcP2a")}<strong style={{ color: "var(--text-sub)" }}>{t("rating.averageMatchRatings")}</strong>{t("rating.calcP2b")}
                </p>
                <p style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.6, margin: "10px 0 0" }}>
                  {t("rating.calcP3a")}<strong style={{ color: "var(--text-sub)" }}>±5 {t("rating.point")}</strong>{t("rating.calcP3b")}
                </p>
              </div>

              <Link href={`/players/${playerId}`} style={{ display: "block", textAlign: "center", background: "var(--border-main)", color: "var(--text-sub)", padding: "12px", fontSize: 12, textDecoration: "none", fontWeight: 600, letterSpacing: "0.08em" }}>
                ← {t("rating.backToProfile")}
              </Link>
            </div>
          </div>
          </>
        )}
      </div>
    </main>
  );
}
