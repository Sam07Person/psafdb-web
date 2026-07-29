"use client";

import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useLanguage } from "@/components/LanguageProvider";
import Link from "next/link";
import {
  calcMatchBreakdown,
  isRatingEligibleScore,
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
  const color = entry ? getRatingColor(entry.rating) : "var(--text-faint)";
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
            <div style={{ fontSize: 10, fontWeight: 700, color: "#e8e8f0", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {entry.playerName}
            </div>
            <div style={{ fontSize: 9, color: "#9090b0", marginTop: 1, letterSpacing: "0.08em" }}>
              {entry.position.toUpperCase()}
            </div>
          </div>
        </Link>
      ) : (
        <div style={{
          background: "rgba(7,7,15,0.55)",
          border: "1px dashed var(--text-faint)",
          padding: "5px 9px",
          minWidth: 74,
        }}>
          <div style={{ fontSize: 10, color: "var(--text-faint)", letterSpacing: "0.1em" }}>{slot}</div>
          <div style={{ fontSize: 9, color: "var(--text-faint)" }}>—</div>
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
  const { t } = useLanguage();
  const [leagues, setLeagues] = useState<{ id: string; name: string; ended: boolean | null }[]>([]);
  const [matchdays, setMatchdays] = useState<number[]>([]);
  const [matchdayDates, setMatchdayDates] = useState<Record<number, string>>({});
  const [selectedLeagueId, setSelectedLeagueId] = useState<string | null>(null);
  const [selectedDayIdx, setSelectedDayIdx] = useState(0);
  const [loading, setLoading] = useState(true);
  const [dayStats, setDayStats] = useState<RawStat[]>([]);

  // 1. Fetch leagues on mount
  useEffect(() => {
    if (!supabase) return;
    supabase.from("leagues").select("id,name,ended").order("name").then(({ data }) => {
      const list = (data ?? []).sort((a: any, b: any) => {
        const aEnded = a.ended ? 1 : 0;
        const bEnded = b.ended ? 1 : 0;
        return aEnded - bEnded;
      });
      setLeagues(list);
      if (list.length > 0) setSelectedLeagueId(list[0].id);
      setLoading(false);
    });
  }, []);

  // 2. Fetch matchdays when league changes
  useEffect(() => {
    if (!supabase || !selectedLeagueId) return;
    setMatchdays([]);
    setMatchdayDates({});
    setSelectedDayIdx(0);
    setDayStats([]);
    supabase
      .from("matches")
      .select("day,played_at")
      .eq("league_id", selectedLeagueId)
      .not("day", "is", null)
      .then(({ data }) => {
        const seen = new Set<number>();
        const dates: Record<number, string> = {};
        for (const m of (data ?? []).sort((a: any, b: any) => b.day - a.day)) {
          if (m.day != null && !seen.has(m.day)) {
            seen.add(m.day);
            if (m.played_at) dates[m.day] = m.played_at.slice(0, 10);
          }
        }
        setMatchdays(Array.from(seen));
        setMatchdayDates(dates);
      });
  }, [selectedLeagueId]);

  const selectedDay = matchdays[selectedDayIdx] ?? null;

  // 3. Fetch stats for the selected league+day on demand (avoids global row-limit truncation)
  useEffect(() => {
    if (!supabase || !selectedLeagueId || selectedDay == null) { setDayStats([]); return; }
    (async () => {
      const { data: matchRows } = await supabase
        .from("matches")
        .select("id")
        .eq("league_id", selectedLeagueId)
        .eq("day", selectedDay);
      const matchIds = (matchRows ?? []).map((m: any) => m.id);
      if (!matchIds.length) { setDayStats([]); return; }
      const { data: statsData } = await supabase
        .from("match_player_stats")
        .select("player_id,position,score,goals,assists,shots_on_target,key_passes,passes,tackles,key_tackles,interceptions,key_interceptions,possessions_lost,gk_saves,gk_catches,team_side,benched,stats_incomplete,rating,rating_version,players(id,handle,name),matches(id,played_at,day,home_score,away_score,league_id)")
        .in("match_id", matchIds);
      const normalized = (statsData ?? []).map((s: any) => ({
        ...s,
        benched: s.benched ?? false,
        stats_incomplete: s.stats_incomplete ?? false,
        players: Array.isArray(s.players) ? s.players[0] ?? null : s.players ?? null,
        matches: Array.isArray(s.matches) ? s.matches[0] ?? null : s.matches ?? null,
      })) as RawStat[];
      setDayStats(normalized);
    })();
  }, [selectedLeagueId, selectedDay]);

  const selectedDayDate = selectedDay != null ? (matchdayDates[selectedDay] ?? null) : null;

  const totw = useMemo(() => calcTOTW(dayStats), [dayStats]);

  if (!supabase) return <main style={{ padding: 40, color: "#888" }}>{t("awards.notConfigured")}</main>;

  if (loading) {
    return (
      <main style={{ minHeight: "calc(100vh - 56px)", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ color: "var(--text-muted)", fontSize: 14 }}>{t("common.loading")}</div>
      </main>
    );
  }

  const formatDate = (d: string) =>
    new Date(d).toLocaleDateString(undefined, { weekday: "short", year: "numeric", month: "short", day: "numeric" });

  const filledSlots = SLOT_ORDER.filter(s => totw[s]).length;
  const totalMatchdays = matchdays.length;

  return (
    <main style={{ minHeight: "calc(100vh - 56px)", background: "var(--bg-base)" }}>
      {/* Header */}
      <section style={{ borderBottom: "1px solid var(--border-main)", padding: "28px 24px 20px", background: "var(--bg-nav)" }}>
        <div style={{ maxWidth: 860, margin: "0 auto" }}>
          <div style={{ fontSize: 11, letterSpacing: "0.25em", color: "var(--text-faint)", fontWeight: 700, textTransform: "uppercase", marginBottom: 10 }}>
            <Link href="/" style={{ color: "var(--text-faint)", textDecoration: "none" }}>{t("breadcrumb.home")}</Link>
            <span style={{ margin: "0 8px" }}>/</span>
            {t("awards.title")}
          </div>
          <h1 style={{ fontSize: 26, fontWeight: 900, color: "var(--text-main)", margin: 0, letterSpacing: "-0.02em" }}>{t("awards.title")}</h1>
          <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "6px 0 0" }}>{t("awards.pageSubtitle")}</p>
        </div>
      </section>

      <div style={{ maxWidth: 860, margin: "0 auto", padding: "28px 24px" }}>
        {/* League tabs */}
        {leagues.length > 0 && (
          <div className="hide-scrollbar" style={{ display: "flex", gap: 0, flexWrap: "nowrap", marginBottom: 28, borderBottom: "1px solid var(--border-main)", overflowX: "auto" }}>
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
                  color: selectedLeagueId === l.id ? "var(--text-body)" : l.ended ? "var(--text-faint)" : "var(--text-muted)",
                  cursor: "pointer",
                  marginBottom: -1,
                  transition: "color 0.15s",
                  whiteSpace: "nowrap",
                  flexShrink: 0,
                  opacity: l.ended ? 0.6 : 1,
                }}
              >
                {l.name}
              </button>
            ))}
          </div>
        )}

        {matchdays.length === 0 ? (
          <div style={{ background: "var(--bg-card)", padding: "48px 24px", textAlign: "center", color: "var(--text-faint)", fontSize: 14 }}>
            {t("awards.noData")}
          </div>
        ) : (
          <>
            {/* Matchday navigation */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24, gap: 16 }}>
              <button
                onClick={() => setSelectedDayIdx(i => Math.min(i + 1, totalMatchdays - 1))}
                disabled={selectedDayIdx >= totalMatchdays - 1}
                style={{
                  background: "var(--bg-card)", border: "1px solid var(--border-main)",
                  color: selectedDayIdx >= totalMatchdays - 1 ? "var(--text-faint)" : "var(--text-sub)",
                  padding: "7px 16px", fontSize: 12, cursor: selectedDayIdx >= totalMatchdays - 1 ? "default" : "pointer",
                  fontWeight: 600, letterSpacing: "0.06em",
                }}
              >
                {t("awards.earlier")}
              </button>

              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.22em", color: "var(--text-muted)", textTransform: "uppercase" }}>
                  {t("awards.subtitle")}
                </div>
                <div style={{ fontSize: 18, fontWeight: 900, color: "var(--text-body)", marginTop: 4, letterSpacing: "-0.01em" }}>
                  Matchday {selectedDay ?? "—"}
                </div>
                {selectedDayDate && (
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
                    {formatDate(selectedDayDate)}
                  </div>
                )}
                <div style={{ fontSize: 10, color: "var(--text-faint)", marginTop: 2 }}>
                  {t("awards.positionsFilled", { n: filledSlots })}
                </div>
              </div>

              <button
                onClick={() => setSelectedDayIdx(i => Math.max(i - 1, 0))}
                disabled={selectedDayIdx <= 0}
                style={{
                  background: "var(--bg-card)", border: "1px solid var(--border-main)",
                  color: selectedDayIdx <= 0 ? "var(--text-faint)" : "var(--text-sub)",
                  padding: "7px 16px", fontSize: 12, cursor: selectedDayIdx <= 0 ? "default" : "pointer",
                  fontWeight: 600, letterSpacing: "0.06em",
                }}
              >
                {t("awards.later")}
              </button>
            </div>

            {/* Field + roster */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 220px", gap: 24, alignItems: "start" }}>
              <FootballField totw={totw} />

              {/* Player list sidebar */}
              <div>
                <div style={{ background: "var(--bg-card)", padding: "16px 20px" }}>
                  <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.2em", color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 14 }}>
                    {t("awards.subtitle")}
                  </div>
                  {DISPLAY_ORDER.map(slot => {
                    const entry = totw[slot];
                    const color = entry ? getRatingColor(entry.rating) : "var(--text-faint)";
                    return (
                      <div key={slot} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 0", borderBottom: "1px solid var(--border-row)" }}>
                        <span style={{ fontSize: 10, fontWeight: 700, color: "var(--text-muted)", width: 26, letterSpacing: "0.06em", flexShrink: 0 }}>
                          {slot}
                        </span>
                        {entry ? (
                          <>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <Link href={`/players/${entry.playerId}`} style={{ textDecoration: "none" }}>
                                <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-sub)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                  {entry.playerName}
                                </div>
                                <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 1 }}>
                                  {entry.position.toUpperCase()}
                                </div>
                              </Link>
                            </div>
                            <Link href={`/matches/${entry.matchId}`} style={{ textDecoration: "none", flexShrink: 0 }}>
                              <span style={{ fontSize: 15, fontWeight: 900, color }}>{entry.rating}</span>
                            </Link>
                          </>
                        ) : (
                          <span style={{ fontSize: 11, color: "var(--text-faint)" }}>—</span>
                        )}
                      </div>
                    );
                  })}
                </div>

                <div style={{ background: "var(--bg-card)", padding: "12px 20px", marginTop: 2, fontSize: 11, color: "var(--text-faint)", lineHeight: 1.6 }}>
                  {t("awards.legend")}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
