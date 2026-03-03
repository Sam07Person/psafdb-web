"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import Link from "next/link";
import { expectedScore } from "@/lib/elo";

type MatchRow = {
  id: string;
  league_id: string | null;
  played_at: string;
  home_team: string;
  away_team: string;
  home_score: number | null;
  away_score: number | null;
  forfeited_by: string | null;
  league?: { name: string; season: string | null } | null;
};

export default function MatchesPage() {
  const [matches, setMatches] = useState<MatchRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [eloMap, setEloMap] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!supabase) return;
    (async () => {
      const [{ data }, eloRes] = await Promise.all([
        supabase
          .from("matches")
          .select("id,league_id,played_at,home_team,away_team,home_score,away_score,forfeited_by,league:leagues(name,season)")
          .order("played_at", { ascending: false }),
        fetch("/api/elo").then((r) => r.json()).catch(() => ({})),
      ]);
      setMatches((data ?? []) as unknown as MatchRow[]);
      setEloMap(eloRes ?? {});
      setLoading(false);
    })();
  }, []);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return matches;
    return matches.filter((m) => {
      const league = `${m.league?.name ?? ""} ${m.league?.season ?? ""}`.toLowerCase();
      const teams = `${m.home_team} ${m.away_team}`.toLowerCase();
      return league.includes(needle) || teams.includes(needle);
    });
  }, [matches, q]);

  return (
    <main style={{ minHeight: "calc(100vh - 56px)" }}>
      {/* Header */}
      <section style={{ borderBottom: "1px solid var(--border-main)", padding: "32px 24px 24px", background: "var(--bg-nav)" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto" }}>
          <div style={{ fontSize: 11, letterSpacing: "0.25em", color: "var(--text-faint)", fontWeight: 700, textTransform: "uppercase", marginBottom: 14 }}>
            <Link href="/" style={{ color: "var(--text-faint)", textDecoration: "none" }}>Home</Link>
            <span style={{ margin: "0 8px" }}>/</span>
            Matches
          </div>
          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 20, flexWrap: "wrap" }}>
            <h1 style={{ fontSize: 32, fontWeight: 900, letterSpacing: "-0.02em", color: "var(--text-main)", margin: 0 }}>Matches</h1>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search teams or league..."
              style={{ background: "var(--bg-card)", border: "1px solid var(--border-main)", color: "var(--text-body)", padding: "8px 14px", fontSize: 13, outline: "none", width: 260 }}
            />
          </div>
        </div>
      </section>

      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "0 24px 48px" }}>
        {loading ? (
          <div style={{ color: "var(--text-faint)", fontSize: 13, padding: "40px 0" }}>Loading...</div>
        ) : filtered.length === 0 ? (
          <div style={{ color: "var(--text-faint)", fontSize: 13, padding: "40px 0" }}>No matches found.</div>
        ) : (
          <div>
            {filtered.map((m) => {
              const played = m.home_score !== null && m.away_score !== null;
              const homeWin = played && m.home_score! > m.away_score!;
              const awayWin = played && m.away_score! > m.home_score!;
              const leagueLabel = m.league?.name
                ? `${m.league.name}${m.league.season ? ` · S${m.league.season}` : ""}`
                : "No league";

              return (
                <Link
                  key={m.id}
                  href={`/matches/${m.id}`}
                  style={{ display: "flex", alignItems: "center", padding: "14px 20px", borderBottom: "1px solid var(--border-row)", textDecoration: "none" }}
                  className="nav-card"
                >
                  <div style={{ width: 160, flexShrink: 0 }}>
                    <div style={{ fontSize: 10, color: "var(--text-faint)", letterSpacing: "0.12em", textTransform: "uppercase", fontWeight: 700 }}>{leagueLabel}</div>
                    <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 3 }}>{new Date(m.played_at).toLocaleDateString()}</div>
                  </div>
                  <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 12, justifyContent: "center" }}>
                    <span style={{ fontSize: 14, fontWeight: homeWin ? 800 : 500, color: homeWin ? "var(--text-body)" : "var(--text-muted)", flex: 1, textAlign: "right" }}>{m.home_team}</span>
                    <div style={{ minWidth: 88, textAlign: "center" }}>
                      {played ? (
                        <span style={{ fontWeight: 900, fontSize: 20, color: "var(--text-main)", fontVariantNumeric: "tabular-nums" }}>
                          {m.home_score} <span style={{ color: "#2a2a3a", fontSize: 14 }}>—</span> {m.away_score}
                        </span>
                      ) : (() => {
                        const hElo = eloMap[m.home_team];
                        const aElo = eloMap[m.away_team];
                        if (hElo == null || aElo == null) {
                          return <span style={{ fontSize: 12, color: "var(--text-faint)", letterSpacing: "0.1em" }}>vs</span>;
                        }
                        const homeP = Math.round(expectedScore(hElo, aElo) * 100);
                        const awayP = 100 - homeP;
                        const homeFav = homeP >= 55;
                        const awayFav = awayP >= 55;
                        return (
                          <div>
                            <span style={{ fontSize: 12, color: "var(--text-faint)", letterSpacing: "0.1em" }}>vs</span>
                            <div style={{ display: "flex", justifyContent: "center", gap: 6, marginTop: 4 }}>
                              <span style={{ fontSize: 10, fontWeight: 700, color: homeFav ? "#4ea8f7" : "var(--text-faint)", fontVariantNumeric: "tabular-nums" }}>{homeP}%</span>
                              <span style={{ fontSize: 10, color: "var(--border-main)" }}>·</span>
                              <span style={{ fontSize: 10, fontWeight: 700, color: awayFav ? "#a78bfa" : "var(--text-faint)", fontVariantNumeric: "tabular-nums" }}>{awayP}%</span>
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                    <span style={{ fontSize: 14, fontWeight: awayWin ? 800 : 500, color: awayWin ? "var(--text-body)" : "var(--text-muted)", flex: 1 }}>{m.away_team}</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginLeft: 20, flexShrink: 0 }}>
                    {m.forfeited_by && (
                      <span style={{ fontSize: 10, color: "#e63946", background: "#e6394620", padding: "2px 6px", letterSpacing: "0.08em" }}>FORFEIT</span>
                    )}
                    <span style={{ fontSize: 11, color: "#4ea8f7", letterSpacing: "0.1em", fontWeight: 700 }}>VIEW →</span>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}
