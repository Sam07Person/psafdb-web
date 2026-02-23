"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import Link from "next/link";
import Image from "next/image";

type LeagueRow = {
  id: string;
  name: string;
  season: string | null;
  format: string | null;
  created_at: string | null;
};

type LeagueWithStats = LeagueRow & {
  match_count: number;
  team_count: number;
};

function formatLabel(format: string | null): string {
  switch (format) {
    case "knockout": return "Knockout";
    case "group_knockout": return "Group + KO";
    case "league":
    default: return "League";
  }
}

function getLeagueLogo(name: string): { img: string; filter: string } | null {
  const n = name.toLowerCase();
  if (n.includes("champion") || n.includes("cd")) {
    return { img: "/cd.png", filter: "invert(1) sepia(1) saturate(3) hue-rotate(20deg) brightness(1.3)" };
  }
  if (n.includes("premier") || n.includes("pl")) {
    return { img: "/pl.png", filter: "invert(1) sepia(1) saturate(3) hue-rotate(180deg) brightness(1.2)" };
  }
  return null;
}

function getAccent(format: string | null): string {
  switch (format) {
    case "knockout": return "#e63946";
    case "group_knockout": return "#a78bfa";
    default: return "#f4c430";
  }
}

export default function LeaguesPage() {
  const [leagues, setLeagues] = useState<LeagueWithStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<any>(null);

  useEffect(() => {
    if (!supabase) return;
    (async () => {
      setLoading(true);
      const { data: leaguesData, error: leaguesError } = await supabase
        .from("leagues")
        .select("id,name,season,format,created_at")
        .order("created_at", { ascending: false });
      if (leaguesError) { setError(leaguesError); setLoading(false); return; }

      const { data: matchesData, error: matchesError } = await supabase
        .from("matches")
        .select("league_id,home_team,away_team");
      if (matchesError) { setError(matchesError); setLoading(false); return; }

      const statsMap = new Map<string, { matches: number; teams: Set<string> }>();
      for (const match of matchesData ?? []) {
        if (!match.league_id) continue;
        const existing = statsMap.get(match.league_id) || { matches: 0, teams: new Set<string>() };
        existing.matches += 1;
        if (match.home_team) existing.teams.add(match.home_team);
        if (match.away_team) existing.teams.add(match.away_team);
        statsMap.set(match.league_id, existing);
      }

      const combined: LeagueWithStats[] = (leaguesData ?? []).map((l) => {
        const stats = statsMap.get(l.id) || { matches: 0, teams: new Set<string>() };
        return { ...l, match_count: stats.matches, team_count: stats.teams.size };
      });

      setLeagues(combined);
      setLoading(false);
    })();
  }, []);

  return (
    <main style={{ minHeight: "calc(100vh - 56px)" }}>
      {/* Header */}
      <section style={{ borderBottom: "1px solid #1a1a2e", padding: "40px 24px 32px", background: "#09091a" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto" }}>
          <div style={{ fontSize: 11, letterSpacing: "0.25em", color: "#3a3a5a", fontWeight: 700, textTransform: "uppercase", marginBottom: 10 }}>
            <Link href="/" style={{ color: "#3a3a5a", textDecoration: "none" }}>Home</Link>
            <span style={{ margin: "0 8px" }}>/</span>
            Leagues
          </div>
          <h1 style={{ fontSize: 36, fontWeight: 900, letterSpacing: "-0.02em", color: "#f0f0fa", margin: 0 }}>
            Leagues
          </h1>
          <p style={{ fontSize: 13, color: "#3a3a5a", marginTop: 6 }}>
            {leagues.length} competition{leagues.length !== 1 ? "s" : ""} in the database
          </p>
        </div>
      </section>

      <section style={{ maxWidth: 1200, margin: "0 auto", padding: "40px 24px" }}>
        {!supabase ? (
          <div style={{ background: "#0d0d1a", borderLeft: "3px solid #e63946", padding: "20px 24px", color: "#9090b0" }}>
            Missing Supabase environment variables.
          </div>
        ) : error ? (
          <div style={{ background: "#0d0d1a", borderLeft: "3px solid #e63946", padding: "20px 24px" }}>
            <div style={{ color: "#e63946", fontWeight: 700, marginBottom: 8 }}>Error</div>
            <pre style={{ fontSize: 11, color: "#9090b0", overflow: "auto" }}>{JSON.stringify(error, null, 2)}</pre>
          </div>
        ) : loading ? (
          <div style={{ color: "#3a3a5a", fontSize: 13, letterSpacing: "0.1em" }}>LOADING...</div>
        ) : leagues.length === 0 ? (
          <div style={{ background: "#0d0d1a", borderLeft: "3px solid #2a2a3d", padding: "20px 24px", color: "#3a3a5a" }}>
            No leagues found.
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 2 }}>
            {leagues.map((l) => {
              const logo = getLeagueLogo(l.name);
              const accent = getAccent(l.format);
              return (
                <Link
                  key={l.id}
                  href={`/leagues/${l.id}`}
                  style={{ textDecoration: "none", display: "block", background: "#0d0d1a", borderTop: `3px solid ${accent}`, padding: "24px" }}
                  className="nav-card"
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 20 }}>
                    {logo ? (
                      <div style={{ width: 44, height: 44, display: "flex", alignItems: "center", justifyContent: "center", background: "#07070f", flexShrink: 0 }}>
                        <Image src={logo.img} alt={l.name} width={30} height={30} style={{ filter: logo.filter }} />
                      </div>
                    ) : (
                      <div style={{ width: 44, height: 44, background: "#07070f", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                        <span style={{ fontSize: 18, color: accent }}>◆</span>
                      </div>
                    )}
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 16, fontWeight: 800, color: "#e8e8f0", lineHeight: 1.2 }}>{l.name}</div>
                      {l.season && <div style={{ fontSize: 11, color: "#3a3a5a", marginTop: 3, letterSpacing: "0.08em" }}>Season {l.season}</div>}
                    </div>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 1 }}>
                    {[
                      { val: l.team_count, label: "Teams" },
                      { val: l.match_count, label: "Matches" },
                      { val: formatLabel(l.format), label: "Format" },
                    ].map(({ val, label }) => (
                      <div key={label} style={{ background: "#07070f", padding: "10px 12px" }}>
                        <div style={{ fontSize: 16, fontWeight: 800, color: "#e0e0f0" }}>{val}</div>
                        <div style={{ fontSize: 10, color: "#3a3a5a", letterSpacing: "0.15em", textTransform: "uppercase", marginTop: 2 }}>{label}</div>
                      </div>
                    ))}
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
