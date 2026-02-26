"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  calcSubRatings,
  calcOverallRating,
  calcMatchRating,
  getRatingColor,
  getRatingLabel,
  getMatchRatingColor,
  getPositionRole,
  type MatchStatRow,
  type MatchResult,
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
        <span style={{ fontSize: 13, fontWeight: 600, color: "#c0c0d8", letterSpacing: "0.04em" }}>{label}</span>
        <span style={{ fontSize: 18, fontWeight: 900, color, minWidth: 36, textAlign: "right" }}>{Math.round(value)}</span>
      </div>
      <div style={{ height: 6, background: "#1a1a2e", borderRadius: 3, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${value}%`, background: color, borderRadius: 3, transition: "width 0.6s ease" }} />
      </div>
      {detail && <div style={{ fontSize: 11, color: "#4a4a6a", marginTop: 4 }}>{detail}</div>}
    </div>
  );
}

export default function PlayerRatingPage() {
  const params = useParams();
  const playerId = params.id as string;

  const [player, setPlayer] = useState<PlayerRow | null>(null);
  const [stats, setStats] = useState<StatRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
        setError("Player not found");
        setLoading(false);
        return;
      }
      setPlayer(playerData);

      // Try fetching with league tier
      const { data: statsData, error: statsErr } = await supabase
        .from("match_player_stats")
        .select(
          "match_id,team_side,position,score,goals,assists,shots,shots_on_target,key_passes,passes,tackles,key_tackles,interceptions,key_interceptions,possessions_lost,gk_saves,gk_catches,benched,is_starter,sub_number,stats_incomplete,matches(id,played_at,home_team,away_team,home_score,away_score,league_id,leagues(id,name,tier))"
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

        const normalized = (fallback ?? []).map((s: any) => ({
          ...s,
          benched: s.benched ?? (!s.is_starter && s.sub_number !== null && s.score === 0),
          stats_incomplete: s.stats_incomplete ?? false,
          matches: Array.isArray(s.matches) ? s.matches[0] ?? null : s.matches ?? null,
        }));
        setStats(normalized);
      } else {
        const normalized = (statsData ?? []).map((s: any) => ({
          ...s,
          benched: s.benched ?? (!s.is_starter && s.sub_number !== null && s.score === 0),
          stats_incomplete: s.stats_incomplete ?? false,
          matches: Array.isArray(s.matches) ? s.matches[0] ?? null : s.matches ?? null,
        }));
        setStats(normalized);
      }

      setLoading(false);
    })();
  }, [playerId]);

  if (!supabase) return <main style={{ padding: 40, color: "#888" }}>Supabase not configured.</main>;

  if (loading) {
    return (
      <main style={{ minHeight: "calc(100vh - 56px)", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ color: "#5a5a7a", fontSize: 14 }}>Loading rating...</div>
      </main>
    );
  }

  if (error || !player) {
    return (
      <main style={{ padding: 40 }}>
        <p style={{ color: "#e63946" }}>{error ?? "Player not found"}</p>
        <Link href="/players" style={{ color: "#5a5a7a", fontSize: 13 }}>← Back to players</Link>
      </main>
    );
  }

  const displayName = player.name || player.handle || `Player ${player.id.slice(0, 8)}`;

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
  const statRows: MatchStatRow[] = playedStats.map(s => ({
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

  // Dominant position
  const posCounts: Record<string, number> = {};
  for (const s of playedStats) {
    if (s.position) posCounts[s.position] = (posCounts[s.position] ?? 0) + 1;
  }
  const dominantPosition = Object.entries(posCounts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;
  const role = getPositionRole(dominantPosition);

  // Dominant league tier
  const tierCounts: Record<number, number> = {};
  for (const s of playedStats) {
    const tier = (s.matches as any)?.leagues?.tier ?? 2;
    tierCounts[tier] = (tierCounts[tier] ?? 0) + 1;
  }
  const dominantTier = Object.entries(tierCounts).sort((a, b) => b[1] - a[1])[0]?.[0];
  const leagueTier = dominantTier ? parseInt(dominantTier) : 2;

  const subRatings: SubRatings = calcSubRatings(statRows, results, dominantPosition);
  const overall = playedStats.length > 0 ? calcOverallRating(subRatings, dominantPosition, leagueTier) : 0;
  const ratingColor = getRatingColor(overall);
  const ratingLabel = getRatingLabel(overall);

  // Per-match ratings (sorted newest first)
  const sortedStats = [...playedStats].sort((a, b) => {
    const aDate = a.matches?.played_at ?? "";
    const bDate = b.matches?.played_at ?? "";
    return bDate.localeCompare(aDate);
  });

  const matchRatings = sortedStats.map((s, i) => {
    const result = (() => {
      const m = s.matches!;
      const isHome = s.team_side === "home";
      const myScore = isHome ? m.home_score : m.away_score;
      const oppScore = isHome ? m.away_score : m.home_score;
      return myScore > oppScore ? "W" as MatchResult : myScore < oppScore ? "L" as MatchResult : "D" as MatchResult;
    })();
    const statRow: MatchStatRow = statRows[playedStats.indexOf(s)] ?? statRows[0];
    return {
      matchId: s.matches!.id,
      date: s.matches!.played_at,
      homeTeam: s.matches!.home_team,
      awayTeam: s.matches!.away_team,
      homeScore: s.matches!.home_score,
      awayScore: s.matches!.away_score,
      mySide: s.team_side,
      position: s.position,
      result,
      rating: calcMatchRating(statRow, result, s.position),
      leagueName: (s.matches as any)?.leagues?.name ?? null,
    };
  }).slice(0, 20);

  // Per-match averages for stat display
  const n = statRows.length;
  const avg = (fn: (s: MatchStatRow) => number) =>
    n > 0 ? (statRows.reduce((sum, s) => sum + fn(s), 0) / n) : 0;

  const avgGoals     = avg(s => s.goals);
  const avgAssists   = avg(s => s.assists);
  const avgShots     = n > 0 ? playedStats.reduce((sum, s) => sum + (s.shots ?? 0), 0) / n : 0;
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
  const avgScore     = avg(s => s.score);

  // Helper: clamp a raw value to [0, 100]
  const sr = (val: number) => Math.min(100, Math.max(0, Math.round(val)));

  // Position-specific thresholds for attacking stats (2× position avg → 100, avg → 50)
  // Data: FWD goals≈1.55, MID goals≈0.90, DEF goals≈0.05 | FWD assists≈0.75, MID≈0.90, DEF≈0.175
  //       FWD shots≈3.5, MID≈2.65, DEF≈0.35 | FWD SoT≈2.5, MID≈1.7, DEF≈0.25
  const goalsThresh   = role === "FWD" ? 3.1  : role === "MID" ? 1.8  : 0.10;
  const assistsThresh = role === "FWD" ? 1.5  : role === "MID" ? 1.8  : 0.35;
  const shotsThresh   = role === "FWD" ? 7.0  : role === "MID" ? 5.3  : 0.70;
  const sotThresh     = role === "FWD" ? 5.0  : role === "MID" ? 3.4  : 0.50;

  // Individual stat ratings (0–100) — calibrated so position-average ≈ 50
  // Defensive/passing reference averages/player/match: tackles≈8.6, kTackles≈0.87, int≈4.3, kInt≈0.49, possLost≈15, passes≈12.6, kPasses≈1.2
  const rGoals    = sr(avgGoals / goalsThresh * 100);
  const rAssists  = sr(avgAssists / assistsThresh * 100);
  const rShots    = sr(avgShots / shotsThresh * 100);
  const rSOT      = sr(avgSOT / sotThresh * 100);
  const rPasses   = sr(avgPasses / 25 * 100);       // avg≈12.6 → 50; 25/match → 100
  const rKP       = sr(avgKP / 2.4 * 100);          // avg≈1.2 → 50; 2.4/match → 100
  const rTackles  = sr(avgTackles / 17 * 100);      // avg≈8.6 → 50; 17/match → 100
  const rKTackles = sr(avgKTackles / 1.75 * 100);   // avg≈0.87 → 50; 1.75/match → 100
  const rInt      = sr(avgInt / 8.5 * 100);         // avg≈4.3 → 50; 8.5/match → 100
  const rKInt     = sr(avgKInt * 100);              // avg≈0.49 → 49; 1.0/match → 100
  const rPL       = sr((1 - avgPL / 30) * 100);    // avg≈15 → 50 (inverted); 0 poss_lost → 100
  const rSaves    = sr(avgSaves / 7 * 100);         // 7/match → 100
  const rCatches  = sr(avgCatches / 4 * 100);      // 4/match → 100

  const tierLabel = leagueTier === 1 ? "Tier 1 – Elite (+5 pts)" : leagueTier === 3 ? "Tier 3 – Amateur (−5 pts)" : "Tier 2 – Standard";

  return (
    <main style={{ minHeight: "calc(100vh - 56px)", background: "#07070f" }}>
      {/* Header bar */}
      <section style={{ borderBottom: "1px solid #1a1a2e", padding: "32px 24px 24px", background: "#09091a" }}>
        <div style={{ maxWidth: 860, margin: "0 auto" }}>
          <div style={{ fontSize: 11, letterSpacing: "0.25em", color: "#3a3a5a", fontWeight: 700, textTransform: "uppercase", marginBottom: 14 }}>
            <Link href="/" style={{ color: "#3a3a5a", textDecoration: "none" }}>Home</Link>
            <span style={{ margin: "0 8px" }}>/</span>
            <Link href="/players" style={{ color: "#3a3a5a", textDecoration: "none" }}>Players</Link>
            <span style={{ margin: "0 8px" }}>/</span>
            <Link href={`/players/${playerId}`} style={{ color: "#3a3a5a", textDecoration: "none" }}>{displayName}</Link>
            <span style={{ margin: "0 8px" }}>/</span>
            Rating
          </div>

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 20 }}>
            <div>
              <h1 style={{ fontSize: 28, fontWeight: 900, color: "#f0f0fa", margin: 0, letterSpacing: "-0.02em" }}>{displayName}</h1>
              <div style={{ display: "flex", gap: 10, marginTop: 8, alignItems: "center", flexWrap: "wrap" }}>
                {dominantPosition && (
                  <span style={{ fontSize: 11, fontWeight: 700, color: "#9090b0", background: "#1a1a2e", padding: "3px 10px", letterSpacing: "0.12em", textTransform: "uppercase" }}>
                    {dominantPosition} · {role}
                  </span>
                )}
                <span style={{ fontSize: 11, color: "#4a4a6a", letterSpacing: "0.08em" }}>{tierLabel}</span>
              </div>
            </div>

            {/* Overall rating badge */}
            <div style={{ textAlign: "center", background: "#0d0d1a", border: `2px solid ${ratingColor}`, padding: "16px 28px", minWidth: 110 }}>
              <div style={{ fontSize: 52, fontWeight: 900, color: ratingColor, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>
                {playedStats.length > 0 ? overall : "—"}
              </div>
              <div style={{ fontSize: 10, color: "#5a5a7a", letterSpacing: "0.2em", fontWeight: 700, textTransform: "uppercase", marginTop: 4 }}>Overall</div>
              {playedStats.length > 0 && (
                <div style={{ fontSize: 12, color: ratingColor, fontWeight: 700, marginTop: 2 }}>{ratingLabel}</div>
              )}
            </div>
          </div>
        </div>
      </section>

      <div style={{ maxWidth: 860, margin: "0 auto", padding: "32px 24px" }}>
        {playedStats.length === 0 ? (
          <div style={{ background: "#0d0d1a", padding: "48px 24px", textAlign: "center", color: "#3a3a5a", fontSize: 14 }}>
            No complete match statistics available to calculate a rating.
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 24, alignItems: "start" }}>
            {/* Left: sub-ratings + match history */}
            <div>
              {/* Stat breakdown */}
              <div style={{ background: "#0d0d1a", padding: "24px", marginBottom: 24 }}>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.2em", color: "#5a5a7a", textTransform: "uppercase", marginBottom: 20 }}>Rating Breakdown</div>

                {role !== "GK" && (
                  <>
                    <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.18em", color: "#3a3a5a", textTransform: "uppercase", marginBottom: 10 }}>Attacking</div>
                    <SubRatingBar label="Goals"           value={rGoals}   detail={`${avgGoals.toFixed(2)}/match`} />
                    <SubRatingBar label="Assists"         value={rAssists} detail={`${avgAssists.toFixed(2)}/match`} />
                    <SubRatingBar label="Shots"           value={rShots}   detail={`${avgShots.toFixed(1)}/match`} />
                    <SubRatingBar label="Shots on Target" value={rSOT}     detail={`${avgSOT.toFixed(1)}/match`} />
                  </>
                )}

                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.18em", color: "#3a3a5a", textTransform: "uppercase", marginBottom: 10, marginTop: role !== "GK" ? 18 : 0 }}>Passing</div>
                <SubRatingBar label="Passes"     value={rPasses} detail={`${avgPasses.toFixed(0)}/match`} />
                <SubRatingBar label="Key Passes" value={rKP}     detail={`${avgKP.toFixed(1)}/match`} />

                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.18em", color: "#3a3a5a", textTransform: "uppercase", marginBottom: 10, marginTop: 18 }}>Defending</div>
                <SubRatingBar label="Tackles"          value={rTackles}  detail={`${avgTackles.toFixed(1)}/match`} />
                <SubRatingBar label="Key Tackles"      value={rKTackles} detail={`${avgKTackles.toFixed(1)}/match`} />
                <SubRatingBar label="Interceptions"    value={rInt}      detail={`${avgInt.toFixed(1)}/match`} />
                <SubRatingBar label="Key Interceptions"value={rKInt}     detail={`${avgKInt.toFixed(1)}/match`} />
                <SubRatingBar label="Lost Possession"  value={rPL}       detail={`${avgPL.toFixed(1)}/match (lower is better)`} />

                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.18em", color: "#3a3a5a", textTransform: "uppercase", marginBottom: 10, marginTop: 18 }}>Consistency</div>
                <SubRatingBar label="Game Score" value={subRatings.consistency} detail={avgScore > 0 ? `Avg game score: ${subRatings.consistency.toFixed(0)} / 100` : `Based on W/D/L record`} />

                {role === "GK" && (
                  <>
                    <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.18em", color: "#3a3a5a", textTransform: "uppercase", marginBottom: 10, marginTop: 18 }}>Goalkeeping</div>
                    <SubRatingBar label="Saves"   value={rSaves}   detail={`${avgSaves.toFixed(1)}/match`} />
                    <SubRatingBar label="Catches" value={rCatches} detail={`${avgCatches.toFixed(1)}/match`} />
                  </>
                )}
              </div>

              {/* Match rating history */}
              {matchRatings.length > 0 && (
                <div style={{ background: "#0d0d1a" }}>
                  <div style={{ padding: "16px 20px", borderBottom: "1px solid #1a1a2e", fontSize: 11, fontWeight: 700, letterSpacing: "0.2em", color: "#5a5a7a", textTransform: "uppercase" }}>
                    Match Ratings (last {matchRatings.length})
                  </div>
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                      <thead>
                        <tr style={{ background: "#09090f" }}>
                          {["Date", "Match", "Result", "Pos", "Rating"].map(h => (
                            <th key={h} style={{ padding: "8px 12px", textAlign: h === "Rating" ? "center" : "left", fontSize: 10, color: "#3a3a5a", fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", borderBottom: "1px solid #1a1a2e", whiteSpace: "nowrap" }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {matchRatings.map((mr, i) => {
                          const resultColor = mr.result === "W" ? "#4ade80" : mr.result === "D" ? "#f4c430" : "#e63946";
                          const rColor = getMatchRatingColor(mr.rating);
                          return (
                            <tr key={mr.matchId} style={{ borderBottom: "1px solid #0f0f1a" }}>
                              <td style={{ padding: "10px 12px", color: "#5a5a7a", whiteSpace: "nowrap" }}>{formatDate(mr.date)}</td>
                              <td style={{ padding: "10px 12px" }}>
                                <Link href={`/matches/${mr.matchId}`} style={{ color: "#c0c0d8", textDecoration: "none" }} className="nav-link">
                                  <span style={{ fontWeight: mr.mySide === "home" ? 700 : 400, color: mr.mySide === "home" ? "#e0e0f0" : "#7070a0" }}>{mr.homeTeam}</span>
                                  <span style={{ color: "#3a3a5a", margin: "0 6px" }}>{mr.homeScore}–{mr.awayScore}</span>
                                  <span style={{ fontWeight: mr.mySide === "away" ? 700 : 400, color: mr.mySide === "away" ? "#e0e0f0" : "#7070a0" }}>{mr.awayTeam}</span>
                                </Link>
                                {mr.leagueName && <div style={{ fontSize: 10, color: "#3a3a5a", marginTop: 2 }}>{mr.leagueName}</div>}
                              </td>
                              <td style={{ padding: "10px 12px", fontWeight: 700, color: resultColor }}>{mr.result}</td>
                              <td style={{ padding: "10px 12px", color: "#5a5a7a", fontSize: 11 }}>{mr.position ?? "—"}</td>
                              <td style={{ padding: "10px 12px", textAlign: "center" }}>
                                <span style={{ fontWeight: 900, fontSize: 15, color: rColor }}>{mr.rating.toFixed(1)}</span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>

            {/* Right: info sidebar */}
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {/* Quick stats */}
              <div style={{ background: "#0d0d1a", padding: "20px" }}>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.2em", color: "#5a5a7a", textTransform: "uppercase", marginBottom: 14 }}>Based On</div>
                {[
                  { label: "Matches rated", value: playedStats.length },
                  { label: "Wins", value: results.filter(r => r === "W").length },
                  { label: "Draws", value: results.filter(r => r === "D").length },
                  { label: "Losses", value: results.filter(r => r === "L").length },
                  { label: "Win rate", value: n > 0 ? `${Math.round(results.filter(r => r === "W").length / n * 100)}%` : "—" },
                ].map(({ label, value }) => (
                  <div key={label} style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", borderBottom: "1px solid #0f0f1a" }}>
                    <span style={{ fontSize: 12, color: "#4a4a6a" }}>{label}</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: "#c0c0d8" }}>{value}</span>
                  </div>
                ))}
              </div>

              {/* How it's calculated */}
              <div style={{ background: "#0d0d1a", padding: "20px" }}>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.2em", color: "#5a5a7a", textTransform: "uppercase", marginBottom: 12 }}>How It's Calculated</div>
                <p style={{ fontSize: 12, color: "#4a4a6a", lineHeight: 1.6, margin: 0 }}>
                  The overall rating is a <strong style={{ color: "#7070a0" }}>0–100 score</strong> calculated from per-match averages of goals, assists, passes, tackles, interceptions, and other stats.
                </p>
                <p style={{ fontSize: 12, color: "#4a4a6a", lineHeight: 1.6, margin: "10px 0 0" }}>
                  Weights are adjusted by position — forwards are rated more on attacking, defenders on defensive output, etc.
                </p>
                <p style={{ fontSize: 12, color: "#4a4a6a", lineHeight: 1.6, margin: "10px 0 0" }}>
                  League tier applies a <strong style={{ color: "#7070a0" }}>±5 point</strong> adjustment (Elite leagues award more, Amateur leagues slightly less).
                </p>
              </div>

              <Link href={`/players/${playerId}`} style={{ display: "block", textAlign: "center", background: "#1a1a2e", color: "#7070a0", padding: "12px", fontSize: 12, textDecoration: "none", fontWeight: 600, letterSpacing: "0.08em" }}>
                ← Back to Player Profile
              </Link>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
