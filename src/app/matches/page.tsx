"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import Link from "next/link";

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

  useEffect(() => {
    if (!supabase) return;
    (async () => {
      const { data } = await supabase
        .from("matches")
        .select("id,league_id,played_at,home_team,away_team,home_score,away_score,forfeited_by,league:leagues(name,season)")
        .order("played_at", { ascending: false });
      setMatches((data ?? []) as unknown as MatchRow[]);
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
      <section style={{ borderBottom: "1px solid #1a1a2e", padding: "32px 24px 24px", background: "#09091a" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto" }}>
          <div style={{ fontSize: 11, letterSpacing: "0.25em", color: "#3a3a5a", fontWeight: 700, textTransform: "uppercase", marginBottom: 14 }}>
            <Link href="/" style={{ color: "#3a3a5a", textDecoration: "none" }}>Home</Link>
            <span style={{ margin: "0 8px" }}>/</span>
            Matches
          </div>
          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 20, flexWrap: "wrap" }}>
            <h1 style={{ fontSize: 32, fontWeight: 900, letterSpacing: "-0.02em", color: "#f0f0fa", margin: 0 }}>Matches</h1>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search teams or league..."
              style={{ background: "#0d0d1a", border: "1px solid #1a1a2e", color: "#e0e0f0", padding: "8px 14px", fontSize: 13, outline: "none", width: 260 }}
            />
          </div>
        </div>
      </section>

      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "0 24px 48px" }}>
        {loading ? (
          <div style={{ color: "#3a3a5a", fontSize: 13, padding: "40px 0" }}>Loading...</div>
        ) : filtered.length === 0 ? (
          <div style={{ color: "#3a3a5a", fontSize: 13, padding: "40px 0" }}>No matches found.</div>
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
                  style={{ display: "flex", alignItems: "center", padding: "14px 20px", borderBottom: "1px solid #0f0f1a", textDecoration: "none" }}
                  className="nav-card"
                >
                  <div style={{ width: 160, flexShrink: 0 }}>
                    <div style={{ fontSize: 10, color: "#3a3a5a", letterSpacing: "0.12em", textTransform: "uppercase", fontWeight: 700 }}>{leagueLabel}</div>
                    <div style={{ fontSize: 11, color: "#2a2a4a", marginTop: 3 }}>{new Date(m.played_at).toLocaleDateString()}</div>
                  </div>
                  <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 12, justifyContent: "center" }}>
                    <span style={{ fontSize: 14, fontWeight: homeWin ? 800 : 500, color: homeWin ? "#e0e0f0" : "#5a5a7a", flex: 1, textAlign: "right" }}>{m.home_team}</span>
                    <div style={{ minWidth: 88, textAlign: "center" }}>
                      {played ? (
                        <span style={{ fontWeight: 900, fontSize: 20, color: "#f0f0fa", fontVariantNumeric: "tabular-nums" }}>
                          {m.home_score} <span style={{ color: "#2a2a3a", fontSize: 14 }}>—</span> {m.away_score}
                        </span>
                      ) : (
                        <span style={{ fontSize: 12, color: "#3a3a5a", letterSpacing: "0.1em" }}>vs</span>
                      )}
                    </div>
                    <span style={{ fontSize: 14, fontWeight: awayWin ? 800 : 500, color: awayWin ? "#e0e0f0" : "#5a5a7a", flex: 1 }}>{m.away_team}</span>
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
