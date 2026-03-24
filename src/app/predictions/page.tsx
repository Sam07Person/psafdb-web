"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { supabase } from "@/lib/supabaseClient";
import Link from "next/link";
import { expectedScore, eloColor, DEFAULT_ELO } from "@/lib/elo";

// ── Types ────────────────────────────────────────────────────────────────────

type MatchRow = {
  id: string;
  league_id: string | null;
  played_at: string;
  home_team: string;
  away_team: string;
  home_score: number | null;
  away_score: number | null;
  day: number | null;
  league?: { name: string; season: string | null } | null;
};

type VoteCounts = Record<string, { home: number; draw: number; away: number }>;
type UserVotes = Record<string, string>;

// ── Helpers ──────────────────────────────────────────────────────────────────

function getUserId(): string {
  if (typeof window === "undefined") return "";
  let id = localStorage.getItem("psafdb_user_id");
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem("psafdb_user_id", id);
  }
  return id;
}

function formatDate(d: string) {
  const dt = new Date(d);
  return dt.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}

function isPast(d: string) {
  return new Date(d) <= new Date();
}

// ── Component ────────────────────────────────────────────────────────────────

export default function PredictionsPage() {
  const [matches, setMatches] = useState<MatchRow[]>([]);
  const [eloMap, setEloMap] = useState<Record<string, number>>({});
  const [voteCounts, setVoteCounts] = useState<VoteCounts>({});
  const [userVotes, setUserVotes] = useState<UserVotes>({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [tab, setTab] = useState<"upcoming" | "past">("upcoming");

  // Load matches and ELO
  useEffect(() => {
    if (!supabase) return;
    (async () => {
      const [{ data }, eloRes] = await Promise.all([
        supabase
          .from("matches")
          .select("id,league_id,played_at,home_team,away_team,home_score,away_score,day,league:leagues(name,season)")
          .order("played_at", { ascending: true }),
        fetch("/api/elo").then(r => r.json()).catch(() => ({})),
      ]);

      const all = ((data ?? []) as unknown as MatchRow[]);
      setMatches(all);
      setEloMap(eloRes ?? {});

      // Fetch predictions
      const userId = getUserId();
      const ids = all.map(m => m.id);
      if (ids.length > 0) {
        const res = await fetch(`/api/predictions?match_ids=${ids.join(",")}&user_id=${encodeURIComponent(userId)}`);
        const json = await res.json();
        setVoteCounts(json.counts ?? {});
        setUserVotes(json.userVotes ?? {});
      }
      setLoading(false);
    })();
  }, []);

  const submitVote = useCallback(async (matchId: string, prediction: string) => {
    const userId = getUserId();
    setSubmitting(matchId);
    try {
      const res = await fetch("/api/predictions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ match_id: matchId, user_id: userId, prediction }),
      });
      const json = await res.json();
      if (!res.ok) {
        alert(json.error ?? "Failed to submit");
        return;
      }
      // Update local state
      setUserVotes(prev => ({ ...prev, [matchId]: prediction }));
      setVoteCounts(prev => {
        const old = prev[matchId] ?? { home: 0, draw: 0, away: 0 };
        const oldVote = userVotes[matchId];
        const updated = { ...old };
        // Remove old vote if switching
        if (oldVote && oldVote !== prediction) {
          updated[oldVote as "home" | "draw" | "away"] = Math.max(0, updated[oldVote as "home" | "draw" | "away"] - 1);
        }
        // Don't double-count if same vote
        if (oldVote !== prediction) {
          updated[prediction as "home" | "draw" | "away"]++;
        }
        return { ...prev, [matchId]: updated };
      });
    } finally {
      setSubmitting(null);
    }
  }, [userVotes]);

  // Split into upcoming & past
  const upcoming = useMemo(() =>
    matches.filter(m => !isPast(m.played_at)),
    [matches]
  );
  const past = useMemo(() =>
    matches.filter(m => isPast(m.played_at)).reverse(),
    [matches]
  );

  // Group by date
  const grouped = useMemo(() => {
    const list = tab === "upcoming" ? upcoming : past;
    const groups = new Map<string, MatchRow[]>();
    for (const m of list) {
      const key = m.played_at.slice(0, 10);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(m);
    }
    return groups;
  }, [tab, upcoming, past]);

  return (
    <main style={{ minHeight: "calc(100vh - 56px)" }}>
      {/* Header */}
      <section style={{ borderBottom: "1px solid var(--border-main)", padding: "32px 24px 24px", background: "var(--bg-nav)" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto" }}>
          <div style={{ fontSize: 11, letterSpacing: "0.25em", color: "var(--text-faint)", fontWeight: 700, textTransform: "uppercase", marginBottom: 14 }}>
            <Link href="/" style={{ color: "var(--text-faint)", textDecoration: "none" }}>Home</Link>
            <span style={{ margin: "0 8px" }}>/</span>
            Predictions
          </div>
          <h1 style={{ fontSize: 32, fontWeight: 900, letterSpacing: "-0.02em", color: "var(--text-main)", margin: 0 }}>
            Predictions
          </h1>
          <p style={{ color: "var(--text-faint)", fontSize: 13, marginTop: 6 }}>
            Vote on who you think will win each upcoming fixture. Voting closes when the match date passes.
          </p>
        </div>
      </section>

      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "0 24px 48px" }}>
        {/* Tabs */}
        <div style={{ display: "flex", gap: 2, marginTop: 24, marginBottom: 24 }}>
          {(["upcoming", "past"] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                padding: "8px 20px",
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                background: tab === t ? "var(--bg-card)" : "transparent",
                color: tab === t ? "var(--text-main)" : "var(--text-faint)",
                border: tab === t ? "1px solid var(--border-main)" : "1px solid transparent",
                cursor: "pointer",
                transition: "all 0.15s",
              }}
            >
              {t === "upcoming" ? `Upcoming (${upcoming.length})` : `Past (${past.length})`}
            </button>
          ))}
        </div>

        {loading ? (
          <div style={{ color: "var(--text-faint)", fontSize: 13, padding: "40px 0" }}>Loading...</div>
        ) : grouped.size === 0 ? (
          <div style={{ color: "var(--text-faint)", fontSize: 13, padding: "40px 0" }}>
            {tab === "upcoming" ? "No upcoming fixtures." : "No past fixtures with predictions."}
          </div>
        ) : (
          Array.from(grouped.entries()).map(([dateKey, dayMatches]) => (
            <div key={dateKey} style={{ marginBottom: 32 }}>
              {/* Date header */}
              <div style={{
                fontSize: 11, fontWeight: 700, letterSpacing: "0.2em", textTransform: "uppercase",
                color: "var(--text-faint)", padding: "10px 0", borderBottom: "1px solid var(--border-main)", marginBottom: 2,
              }}>
                {formatDate(dayMatches[0].played_at)}
              </div>

              {dayMatches.map(m => (
                <MatchCard
                  key={m.id}
                  match={m}
                  eloMap={eloMap}
                  counts={voteCounts[m.id] ?? { home: 0, draw: 0, away: 0 }}
                  userVote={userVotes[m.id] ?? null}
                  onVote={submitVote}
                  submitting={submitting === m.id}
                  locked={isPast(m.played_at)}
                />
              ))}
            </div>
          ))
        )}
      </div>
    </main>
  );
}

// ── Match Card ───────────────────────────────────────────────────────────────

function MatchCard({
  match: m,
  eloMap,
  counts,
  userVote,
  onVote,
  submitting,
  locked,
}: {
  match: MatchRow;
  eloMap: Record<string, number>;
  counts: { home: number; draw: number; away: number };
  userVote: string | null;
  onVote: (matchId: string, prediction: string) => void;
  submitting: boolean;
  locked: boolean;
}) {
  const homeElo = eloMap[m.home_team] ?? DEFAULT_ELO;
  const awayElo = eloMap[m.away_team] ?? DEFAULT_ELO;
  const homeProb = Math.round(expectedScore(homeElo, awayElo) * 100);
  const awayProb = 100 - homeProb;
  const hColor = eloColor(homeElo);
  const aColor = eloColor(awayElo);

  const totalVotes = counts.home + counts.draw + counts.away;
  const homeVotePct = totalVotes > 0 ? Math.round((counts.home / totalVotes) * 100) : 0;
  const drawVotePct = totalVotes > 0 ? Math.round((counts.draw / totalVotes) * 100) : 0;
  const awayVotePct = totalVotes > 0 ? Math.round((counts.away / totalVotes) * 100) : 0;

  const played = m.home_score !== null && m.away_score !== null;
  const actualResult = played
    ? m.home_score! > m.away_score! ? "home" : m.home_score! < m.away_score! ? "away" : "draw"
    : null;

  const leagueLabel = m.league?.name
    ? `${m.league.name}${m.league.season ? ` · S${m.league.season}` : ""}`
    : "";

  return (
    <div style={{
      background: "var(--bg-card)",
      borderBottom: "1px solid var(--border-row)",
      padding: "16px 20px",
    }}>
      {/* League + link */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <span style={{ fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--text-faint)", fontWeight: 700 }}>
          {leagueLabel}{m.day != null ? ` · MD ${m.day}` : ""}
        </span>
        <Link href={`/matches/${m.id}`} style={{ fontSize: 10, color: "#4ea8f7", fontWeight: 700, textDecoration: "none", letterSpacing: "0.1em" }}>
          VIEW MATCH →
        </Link>
      </div>

      {/* Teams + score/vs + ELO */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
        <div style={{ flex: 1, textAlign: "right" }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: "var(--text-main)" }}>{m.home_team}</div>
          <span style={{
            display: "inline-block", marginTop: 4, padding: "2px 8px",
            background: `${hColor}18`, color: hColor, fontWeight: 800, fontSize: 12,
            borderRadius: 3, fontVariantNumeric: "tabular-nums",
          }}>
            {homeElo}
          </span>
        </div>

        <div style={{ textAlign: "center", minWidth: 80 }}>
          {played ? (
            <div style={{ fontWeight: 900, fontSize: 22, color: "var(--text-main)", fontVariantNumeric: "tabular-nums" }}>
              {m.home_score} <span style={{ color: "var(--text-faint)", fontSize: 14 }}>—</span> {m.away_score}
            </div>
          ) : (
            <div style={{ fontSize: 12, color: "var(--text-faint)", letterSpacing: "0.1em", fontWeight: 700 }}>vs</div>
          )}
        </div>

        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: "var(--text-main)" }}>{m.away_team}</div>
          <span style={{
            display: "inline-block", marginTop: 4, padding: "2px 8px",
            background: `${aColor}18`, color: aColor, fontWeight: 800, fontSize: 12,
            borderRadius: 3, fontVariantNumeric: "tabular-nums",
          }}>
            {awayElo}
          </span>
        </div>
      </div>

      {/* ELO probability bar */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: "#4ea8f7", letterSpacing: "0.08em" }}>{homeProb}% ELO</span>
          <span style={{ fontSize: 10, fontWeight: 700, color: "var(--text-faint)", letterSpacing: "0.08em" }}>ELO PREDICTION</span>
          <span style={{ fontSize: 10, fontWeight: 700, color: "#a78bfa", letterSpacing: "0.08em" }}>{awayProb}% ELO</span>
        </div>
        <div style={{ display: "flex", height: 6, borderRadius: 3, overflow: "hidden" }}>
          <div style={{ width: `${homeProb}%`, background: "#4ea8f7", transition: "width 0.3s" }} />
          <div style={{ flex: 1, background: "#a78bfa" }} />
        </div>
      </div>

      {/* Vote buttons */}
      <div style={{ marginBottom: totalVotes > 0 ? 12 : 0 }}>
        <div style={{ display: "flex", gap: 8 }}>
          {(["home", "draw", "away"] as const).map(opt => {
            const label = opt === "home" ? m.home_team : opt === "away" ? m.away_team : "Draw";
            const isSelected = userVote === opt;
            const isCorrect = locked && actualResult === opt;
            const isWrong = locked && userVote === opt && actualResult !== opt;

            let bg = "transparent";
            let border = "1px solid var(--border-main)";
            let color = "var(--text-muted)";

            if (isSelected && !locked) {
              bg = opt === "home" ? "#4ea8f720" : opt === "away" ? "#a78bfa20" : "#f4c43020";
              border = `1px solid ${opt === "home" ? "#4ea8f7" : opt === "away" ? "#a78bfa" : "#f4c430"}`;
              color = opt === "home" ? "#4ea8f7" : opt === "away" ? "#a78bfa" : "#f4c430";
            }

            if (locked && isCorrect) {
              bg = "#22c55e18"; border = "1px solid #22c55e"; color = "#22c55e";
            } else if (isWrong) {
              bg = "#ef444418"; border = "1px solid #ef4444"; color = "#ef4444";
            } else if (locked && isSelected) {
              bg = "#64748b18"; border = "1px solid #64748b"; color = "#64748b";
            }

            return (
              <button
                key={opt}
                onClick={() => !locked && !submitting && onVote(m.id, opt)}
                disabled={locked || submitting}
                style={{
                  flex: 1, padding: "10px 8px", fontSize: 12, fontWeight: 700,
                  letterSpacing: "0.06em", textTransform: "uppercase",
                  background: bg, border, color,
                  cursor: locked ? "default" : submitting ? "wait" : "pointer",
                  opacity: locked && !isSelected && !isCorrect ? 0.5 : 1,
                  transition: "all 0.15s",
                  position: "relative",
                }}
              >
                {label}
                {isSelected && !locked && (
                  <span style={{ fontSize: 9, display: "block", marginTop: 2, opacity: 0.7 }}>YOUR PICK</span>
                )}
                {locked && isCorrect && played && (
                  <span style={{ fontSize: 9, display: "block", marginTop: 2, color: "#22c55e" }}>CORRECT</span>
                )}
                {isWrong && (
                  <span style={{ fontSize: 9, display: "block", marginTop: 2, color: "#ef4444" }}>WRONG</span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Vote results bar */}
      {totalVotes > 0 && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
            <span style={{ fontSize: 10, color: "#4ea8f7", fontWeight: 700 }}>{homeVotePct}%</span>
            <span style={{ fontSize: 10, color: "var(--text-faint)", letterSpacing: "0.1em" }}>
              {totalVotes} VOTE{totalVotes !== 1 ? "S" : ""}
            </span>
            <span style={{ fontSize: 10, color: "#a78bfa", fontWeight: 700 }}>{awayVotePct}%</span>
          </div>
          <div style={{ display: "flex", height: 6, borderRadius: 3, overflow: "hidden", background: "var(--bg-base)" }}>
            {homeVotePct > 0 && (
              <div style={{ width: `${homeVotePct}%`, background: "#4ea8f7", transition: "width 0.3s" }} />
            )}
            {drawVotePct > 0 && (
              <div style={{ width: `${drawVotePct}%`, background: "#f4c430", transition: "width 0.3s" }} />
            )}
            {awayVotePct > 0 && (
              <div style={{ width: `${awayVotePct}%`, background: "#a78bfa", transition: "width 0.3s" }} />
            )}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 3 }}>
            <span style={{ fontSize: 9, color: "var(--text-faint)" }}>{counts.home} home</span>
            <span style={{ fontSize: 9, color: "#f4c430", fontWeight: 600 }}>{drawVotePct}% draw</span>
            <span style={{ fontSize: 9, color: "var(--text-faint)" }}>{counts.away} away</span>
          </div>
        </div>
      )}
    </div>
  );
}
