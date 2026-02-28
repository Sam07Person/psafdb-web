"use client";

import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/lib/supabaseClient";
import Link from "next/link";
import {
  calcMatchBreakdown,
  getRatingColor,
  type MatchStatRow,
  type MatchResult,
} from "@/lib/ratings";

type SlotKey = "GK" | "LB" | "RB" | "CM" | "LW" | "RW";

const SLOT_POOLS: Record<SlotKey, string[]> = {
  GK: ["GK"],
  LB: ["LB", "LWB", "LCB"],
  RB: ["RB", "RWB", "RCB"],
  CM: ["CM", "LM", "RM", "CF", "ST", "CB"],
  LW: ["LW", "LF"],
  RW: ["RW", "RF"],
};

// Order for deduplication: specific positions first, broadest last
const SLOT_ORDER: SlotKey[] = ["GK", "LW", "RW", "LB", "RB", "CM"];
const DISPLAY_ORDER: SlotKey[] = ["GK", "LB", "RB", "CM", "LW", "RW"];

// Field positions: percentage from left/top, badge centered via transform
const SLOT_FIELD_POS: Record<SlotKey, { left: string; top: string }> = {
  LW: { left: "20%", top: "13%" },
  RW: { left: "80%", top: "13%" },
  CM: { left: "50%", top: "42%" },
  LB: { left: "20%", top: "65%" },
  RB: { left: "80%", top: "65%" },
  GK: { left: "50%", top: "85%" },
};

type RawStat = {
  player_id: string;
  position: string | null;
  score: number;
  goals: number;
  assists: number;
  shots_on_target: number;
  key_passes: number;
  passes: number;
  tackles: number;
  key_tackles: number;
  interceptions: number;
  key_interceptions: number;
  possessions_lost: number;
  gk_saves: number;
  gk_catches: number;
  team_side: "home" | "away";
  benched: boolean;
  stats_incomplete: boolean;
  players: { id: string; handle: string | null; name: string | null } | null;
  matches: {
    id: string;
    played_at: string;
    day: number | null;
    home_score: number;
    away_score: number;
    league_id: string | null;
    leagues: { id: string; name: string; tier?: number | null } | null;
  } | null;
};

type TOTWEntry = {
  playerId: string;
  playerName: string;
  position: string;
  rating: number;
  matchId: string;
};

function calcTOTW(stats: RawStat[]): Partial<Record<SlotKey, TOTWEntry>> {
  // Calculate rating for each valid player stat row
  const entries: Array<{ stat: RawStat; rating: number }> = stats
    .filter(s => !s.benched && !s.stats_incomplete && s.position && s.matches && s.players)
    .map(s => {
      const m = s.matches!;
      const isHome = s.team_side === "home";
      const goalsConceded = isHome ? m.away_score : m.home_score;
      const myScore = isHome ? m.home_score : m.away_score;
      const oppScore = isHome ? m.away_score : m.home_score;
      const result: MatchResult = myScore > oppScore ? "W" : myScore < oppScore ? "L" : "D";
      const statRow: MatchStatRow = {
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
        goals_conceded: goalsConceded,
        score: s.score ?? 0,
        position: s.position,
      };
      const bd = calcMatchBreakdown(statRow, result, s.position);
      return { stat: s, rating: bd.final };
    });

  // Sort by rating descending
  entries.sort((a, b) => b.rating - a.rating);

  const result: Partial<Record<SlotKey, TOTWEntry>> = {};
  const usedPlayerIds = new Set<string>();

  for (const slotKey of SLOT_ORDER) {
    const pool = SLOT_POOLS[slotKey];
    for (const { stat, rating } of entries) {
      const pos = stat.position?.toUpperCase().trim() ?? "";
      if (!pool.includes(pos)) continue;
      if (usedPlayerIds.has(stat.player_id)) continue;
      const p = stat.players!;
      result[slotKey] = {
        playerId: stat.player_id,
        playerName: p.name || p.handle || stat.player_id.slice(0, 8),
        position: stat.position ?? slotKey,
        rating,
        matchId: stat.matches!.id,
      };
      usedPlayerIds.add(stat.player_id);
      break;
    }
  }

  return result;
}

function PlayerBadge({ entry, slot }: { entry: TOTWEntry | undefined; slot: SlotKey }) {
  const color = entry ? getRatingColor(entry.rating) : "#2a2a4a";
  const pos = SLOT_FIELD_POS[slot];

  return (
    <div style={{
      position: "absolute",
      left: pos.left,
      top: pos.top,
      transform: "translate(-50%, -50%)",
      textAlign: "center",
      zIndex: 2,
      pointerEvents: entry ? "auto" : "none",
    }}>
      {entry ? (
        <Link href={`/players/${entry.playerId}`} style={{ textDecoration: "none" }}>
          <div style={{
            background: "rgba(7,7,15,0.88)",
            border: `2px solid ${color}`,
            padding: "5px 9px",
            minWidth: 74,
            maxWidth: 100,
            backdropFilter: "blur(4px)",
          }}>
            <div style={{ fontSize: 16, fontWeight: 900, color, lineHeight: 1 }}>{entry.rating}</div>
            <div style={{ fontSize: 10, fontWeight: 700, color: "#e0e0f0", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {entry.playerName}
            </div>
            <div style={{ fontSize: 9, color: "#7070a0", marginTop: 1, letterSpacing: "0.08em" }}>
              {entry.position.toUpperCase()}
            </div>
          </div>
        </Link>
      ) : (
        <div style={{
          background: "rgba(7,7,15,0.55)",
          border: "1px dashed #2a2a4a",
          padding: "5px 9px",
          minWidth: 74,
        }}>
          <div style={{ fontSize: 10, color: "#2a2a4a", letterSpacing: "0.1em" }}>{slot}</div>
          <div style={{ fontSize: 9, color: "#2a2a4a" }}>—</div>
        </div>
      )}
    </div>
  );
}

function FootballField({ totw }: { totw: Partial<Record<SlotKey, TOTWEntry>> }) {
  return (
    <div style={{
      position: "relative",
      width: "100%",
      maxWidth: 420,
      aspectRatio: "3 / 4",
      background: "linear-gradient(175deg, #1d6b2a 0%, #1a5e24 30%, #1e6d2c 60%, #1a5e24 100%)",
      border: "2px solid rgba(255,255,255,0.18)",
      overflow: "hidden",
      margin: "0 auto",
    }}>
      {/* Grass stripes */}
      {[0, 1, 2, 3, 4, 5, 6, 7].map(i => (
        <div key={i} style={{
          position: "absolute", left: 0, right: 0,
          top: `${i * 12.5}%`, height: "12.5%",
          background: i % 2 === 0 ? "rgba(0,0,0,0.06)" : "transparent",
        }} />
      ))}

      {/* Center line (top = halfway line) */}
      <div style={{
        position: "absolute", top: 0, left: 0, right: 0,
        borderTop: "1.5px dashed rgba(255,255,255,0.22)",
      }} />

      {/* Penalty area */}
      <div style={{
        position: "absolute", left: "15%", right: "15%",
        top: "72%", bottom: 0,
        border: "1.5px solid rgba(255,255,255,0.3)",
        borderBottom: "none",
      }} />

      {/* Goal area */}
      <div style={{
        position: "absolute", left: "33%", right: "33%",
        top: "84%", bottom: 0,
        border: "1px solid rgba(255,255,255,0.22)",
        borderBottom: "none",
      }} />

      {/* Goal (at bottom = goal line) */}
      <div style={{
        position: "absolute", left: "38%", right: "38%",
        bottom: 0, height: "2.5%",
        background: "rgba(255,255,255,0.12)",
        border: "1.5px solid rgba(255,255,255,0.45)",
        borderBottom: "none",
      }} />

      {/* Penalty spot */}
      <div style={{
        position: "absolute", left: "calc(50% - 3px)", top: "78%",
        width: 6, height: 6, borderRadius: "50%",
        background: "rgba(255,255,255,0.35)",
      }} />

      {/* Player badges */}
      {(["GK", "LB", "RB", "CM", "LW", "RW"] as SlotKey[]).map(slot => (
        <PlayerBadge key={slot} slot={slot} entry={totw[slot]} />
      ))}
    </div>
  );
}

export default function AwardsPage() {
  const [allStats, setAllStats] = useState<RawStat[]>([]);
  const [leagues, setLeagues] = useState<{ id: string; name: string }[]>([]);
  const [selectedLeagueId, setSelectedLeagueId] = useState<string | null>(null);
  const [selectedDayIdx, setSelectedDayIdx] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!supabase) return;
    (async () => {
      setLoading(true);
      const [{ data: leagueData }, { data: statsData }] = await Promise.all([
        supabase.from("leagues").select("id,name").order("name"),
        supabase.from("match_player_stats").select(
          "player_id,position,score,goals,assists,shots_on_target,key_passes,passes,tackles,key_tackles,interceptions,key_interceptions,possessions_lost,gk_saves,gk_catches,team_side,benched,stats_incomplete,is_starter,sub_number,players(id,handle,name),matches(id,played_at,day,home_score,away_score,league_id,leagues(id,name,tier))"
        ),
      ]);

      const normalized = (statsData ?? []).map((s: any) => ({
        ...s,
        benched: s.benched ?? (!s.is_starter && s.sub_number !== null && s.score === 0),
        stats_incomplete: s.stats_incomplete ?? false,
        players: Array.isArray(s.players) ? s.players[0] ?? null : s.players ?? null,
        matches: Array.isArray(s.matches) ? s.matches[0] ?? null : s.matches ?? null,
      })) as RawStat[];

      const leagueList = leagueData ?? [];
      setLeagues(leagueList);
      setAllStats(normalized);
      if (leagueList.length > 0) setSelectedLeagueId(leagueList[0].id);
      setSelectedDayIdx(0);
      setLoading(false);
    })();
  }, []);

  // Sorted unique matchday numbers for selected league (highest first = most recent)
  const matchdays = useMemo(() => {
    if (!selectedLeagueId) return [];
    const daySet = new Set<number>();
    for (const s of allStats) {
      if (s.matches?.league_id === selectedLeagueId && s.matches?.day != null) {
        daySet.add(s.matches.day);
      }
    }
    return Array.from(daySet).sort((a, b) => b - a);
  }, [allStats, selectedLeagueId]);

  const selectedDay = matchdays[selectedDayIdx] ?? null;

  // Representative date for the selected matchday (for display)
  const selectedDayDate = useMemo(() => {
    if (!selectedLeagueId || selectedDay == null) return null;
    const dates = allStats
      .filter(s => s.matches?.league_id === selectedLeagueId && s.matches?.day === selectedDay && s.matches?.played_at)
      .map(s => s.matches!.played_at.slice(0, 10));
    return dates.sort()[0] ?? null;
  }, [allStats, selectedLeagueId, selectedDay]);

  const totw = useMemo(() => {
    if (!selectedLeagueId || selectedDay == null) return {};
    const dayStats = allStats.filter(s =>
      s.matches?.league_id === selectedLeagueId &&
      s.matches?.day === selectedDay
    );
    return calcTOTW(dayStats);
  }, [allStats, selectedLeagueId, selectedDay]);

  if (!supabase) return <main style={{ padding: 40, color: "#888" }}>Supabase not configured.</main>;

  if (loading) {
    return (
      <main style={{ minHeight: "calc(100vh - 56px)", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ color: "#5a5a7a", fontSize: 14 }}>Loading awards...</div>
      </main>
    );
  }

  const formatDate = (d: string) =>
    new Date(d).toLocaleDateString(undefined, { weekday: "short", year: "numeric", month: "short", day: "numeric" });

  const filledSlots = SLOT_ORDER.filter(s => totw[s]).length;
  const totalMatchdays = matchdays.length;

  return (
    <main style={{ minHeight: "calc(100vh - 56px)", background: "#07070f" }}>
      {/* Header */}
      <section style={{ borderBottom: "1px solid #1a1a2e", padding: "28px 24px 20px", background: "#09091a" }}>
        <div style={{ maxWidth: 860, margin: "0 auto" }}>
          <div style={{ fontSize: 11, letterSpacing: "0.25em", color: "#3a3a5a", fontWeight: 700, textTransform: "uppercase", marginBottom: 10 }}>
            <Link href="/" style={{ color: "#3a3a5a", textDecoration: "none" }}>Home</Link>
            <span style={{ margin: "0 8px" }}>/</span>
            Awards
          </div>
          <h1 style={{ fontSize: 26, fontWeight: 900, color: "#f0f0fa", margin: 0, letterSpacing: "-0.02em" }}>Awards</h1>
          <p style={{ fontSize: 12, color: "#4a4a6a", margin: "6px 0 0" }}>Team of the Week — highest-rated players per matchday</p>
        </div>
      </section>

      <div style={{ maxWidth: 860, margin: "0 auto", padding: "28px 24px" }}>
        {/* League tabs */}
        {leagues.length > 0 && (
          <div className="hide-scrollbar" style={{ display: "flex", gap: 0, flexWrap: "nowrap", marginBottom: 28, borderBottom: "1px solid #1a1a2e", overflowX: "auto" }}>
            {leagues.map(l => (
              <button
                key={l.id}
                onClick={() => { setSelectedLeagueId(l.id); setSelectedDayIdx(0); }}
                style={{
                  padding: "8px 18px",
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                  background: "transparent",
                  border: "none",
                  borderTop: selectedLeagueId === l.id ? "2px solid #7070f0" : "2px solid transparent",
                  color: selectedLeagueId === l.id ? "#e0e0f0" : "#5a5a7a",
                  cursor: "pointer",
                  marginBottom: -1,
                  transition: "color 0.15s",
                  whiteSpace: "nowrap",
                  flexShrink: 0,
                }}
              >
                {l.name}
              </button>
            ))}
          </div>
        )}

        {matchdays.length === 0 ? (
          <div style={{ background: "#0d0d1a", padding: "48px 24px", textAlign: "center", color: "#3a3a5a", fontSize: 14 }}>
            No match data found for this league.
          </div>
        ) : (
          <>
            {/* Matchday navigation */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24, gap: 16 }}>
              <button
                onClick={() => setSelectedDayIdx(i => Math.min(i + 1, totalMatchdays - 1))}
                disabled={selectedDayIdx >= totalMatchdays - 1}
                style={{
                  background: "#0d0d1a", border: "1px solid #1a1a2e",
                  color: selectedDayIdx >= totalMatchdays - 1 ? "#2a2a4a" : "#9090b0",
                  padding: "7px 16px", fontSize: 12, cursor: selectedDayIdx >= totalMatchdays - 1 ? "default" : "pointer",
                  fontWeight: 600, letterSpacing: "0.06em",
                }}
              >
                ← Earlier
              </button>

              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.22em", color: "#5a5a7a", textTransform: "uppercase" }}>
                  Team of the Week
                </div>
                <div style={{ fontSize: 18, fontWeight: 900, color: "#c0c0d8", marginTop: 4, letterSpacing: "-0.01em" }}>
                  Matchday {selectedDay ?? "—"}
                </div>
                {selectedDayDate && (
                  <div style={{ fontSize: 11, color: "#4a4a6a", marginTop: 2 }}>
                    {formatDate(selectedDayDate)}
                  </div>
                )}
                <div style={{ fontSize: 10, color: "#3a3a5a", marginTop: 2 }}>
                  {filledSlots}/6 positions filled
                </div>
              </div>

              <button
                onClick={() => setSelectedDayIdx(i => Math.max(i - 1, 0))}
                disabled={selectedDayIdx <= 0}
                style={{
                  background: "#0d0d1a", border: "1px solid #1a1a2e",
                  color: selectedDayIdx <= 0 ? "#2a2a4a" : "#9090b0",
                  padding: "7px 16px", fontSize: 12, cursor: selectedDayIdx <= 0 ? "default" : "pointer",
                  fontWeight: 600, letterSpacing: "0.06em",
                }}
              >
                Later →
              </button>
            </div>

            {/* Field + roster */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 220px", gap: 24, alignItems: "start" }}>
              <FootballField totw={totw} />

              {/* Player list sidebar */}
              <div>
                <div style={{ background: "#0d0d1a", padding: "16px 20px" }}>
                  <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.2em", color: "#5a5a7a", textTransform: "uppercase", marginBottom: 14 }}>
                    Team of the Week
                  </div>
                  {DISPLAY_ORDER.map(slot => {
                    const entry = totw[slot];
                    const color = entry ? getRatingColor(entry.rating) : "#3a3a5a";
                    return (
                      <div key={slot} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 0", borderBottom: "1px solid #0f0f1a" }}>
                        <span style={{ fontSize: 10, fontWeight: 700, color: "#4a4a6a", width: 26, letterSpacing: "0.06em", flexShrink: 0 }}>
                          {slot}
                        </span>
                        {entry ? (
                          <>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <Link href={`/players/${entry.playerId}`} style={{ textDecoration: "none" }}>
                                <div style={{ fontSize: 12, fontWeight: 700, color: "#c0c0d8", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                  {entry.playerName}
                                </div>
                                <div style={{ fontSize: 10, color: "#4a4a6a", marginTop: 1 }}>
                                  {entry.position.toUpperCase()}
                                </div>
                              </Link>
                            </div>
                            <Link href={`/matches/${entry.matchId}`} style={{ textDecoration: "none", flexShrink: 0 }}>
                              <span style={{ fontSize: 15, fontWeight: 900, color }}>{entry.rating}</span>
                            </Link>
                          </>
                        ) : (
                          <span style={{ fontSize: 11, color: "#2a2a4a" }}>—</span>
                        )}
                      </div>
                    );
                  })}
                </div>

                <div style={{ background: "#0d0d1a", padding: "12px 20px", marginTop: 2, fontSize: 11, color: "#3a3a5a", lineHeight: 1.6 }}>
                  Rating links to the match. Player name links to profile.
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
