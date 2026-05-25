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
  image: string | null;
  ended: boolean | null;
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

function getLeagueLogo(image: string | null): { img: string; filter: string } | null {
  if (!image) return null;
  // invert(1) hue-rotate(180deg): removes white background (white→black = invisible on dark),
  // hue cancels out (H+180+180=H), lightness inverts around 50% preserving colours
  const filters: Record<string, string> = {
    cd: "invert(1) sepia(1) saturate(3) hue-rotate(180deg) brightness(1.2)",
    pl: "invert(1) sepia(1) saturate(3) hue-rotate(20deg) brightness(1.3)",
    cl: "invert(1) hue-rotate(180deg) brightness(1.1)",
    ml: "invert(1) hue-rotate(180deg) brightness(1.1)",
  };
  if (!filters[image]) return null;
  return { img: `/${image}.png`, filter: filters[image] };
}

function getAccent(format: string | null): string {
  switch (format) {
    case "knockout": return "#e63946";
    case "group_knockout": return "#a78bfa";
    default: return "#f4c430";
  }
}

function LeagueCard({ l }: { l: LeagueWithStats }) {
  const logo = getLeagueLogo(l.image);
  const accent = getAccent(l.format);
  return (
    <Link
      href={`/leagues/${l.id}`}
      style={{ textDecoration: "none", display: "block", background: "var(--bg-card)", borderTop: `3px solid ${accent}`, padding: "24px" }}
      className="nav-card"
    >
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 20 }}>
        {logo ? (
          <div style={{ width: 44, height: 44, display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg-base)", flexShrink: 0 }}>
            <Image src={logo.img} alt={l.name} width={30} height={30} style={{ filter: logo.filter }} />
          </div>
        ) : (
          <div style={{ width: 44, height: 44, background: "var(--bg-base)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <span style={{ fontSize: 18, color: accent }}>◆</span>
          </div>
        )}
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: "var(--text-main)", lineHeight: 1.2 }}>{l.name}</div>
          {l.season && <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 3, letterSpacing: "0.08em" }}>Season {l.season}</div>}
        </div>
        {l.ended && (
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--text-faint)", background: "var(--bg-base)", padding: "3px 7px", flexShrink: 0 }}>
            Ended
          </span>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 1 }}>
        {[
          { val: l.team_count, label: "Teams" },
          { val: l.match_count, label: "Matches" },
          { val: formatLabel(l.format), label: "Format" },
        ].map(({ val, label }) => (
          <div key={label} style={{ background: "var(--bg-base)", padding: "10px 12px" }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: "var(--text-body)" }}>{val}</div>
            <div style={{ fontSize: 10, color: "var(--text-faint)", letterSpacing: "0.15em", textTransform: "uppercase", marginTop: 2 }}>{label}</div>
          </div>
        ))}
      </div>
    </Link>
  );
}

function LeagueGrid({ leagues }: { leagues: LeagueWithStats[] }) {
  const active = leagues.filter(l => !l.ended);
  const finished = leagues.filter(l => l.ended);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 48 }}>
      {active.length > 0 && (
        <div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 2 }}>
            {active.map(l => <LeagueCard key={l.id} l={l} />)}
          </div>
        </div>
      )}

      {finished.length > 0 && (
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.2em", textTransform: "uppercase", color: "var(--text-faint)" }}>
              Finished Seasons
            </div>
            <div style={{ flex: 1, height: 1, background: "var(--border-main)" }} />
            <div style={{ fontSize: 11, color: "var(--text-faint)" }}>{finished.length}</div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 2, opacity: 0.75 }}>
            {finished.map(l => <LeagueCard key={l.id} l={l} />)}
          </div>
        </div>
      )}
    </div>
  );
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
        .select("id,name,season,format,image,ended,created_at")
        .order("created_at", { ascending: false });
      if (leaguesError) { setError(leaguesError); setLoading(false); return; }

      const [
        { data: matchesData, error: matchesError },
        { data: junctionData },
        { data: directData },
      ] = await Promise.all([
        supabase.from("matches").select("league_id,home_team,away_team"),
        supabase.from("team_leagues").select("league_id,team_id"),
        supabase.from("teams").select("league_id,id").not("league_id", "is", null),
      ]);
      if (matchesError) { setError(matchesError); setLoading(false); return; }

      // Team counts from junction table and direct league_id
      const teamCountMap = new Map<string, Set<string>>();
      for (const row of junctionData ?? []) {
        if (!row.league_id) continue;
        if (!teamCountMap.has(row.league_id)) teamCountMap.set(row.league_id, new Set());
        teamCountMap.get(row.league_id)!.add(row.team_id);
      }
      for (const row of directData ?? []) {
        if (!row.league_id) continue;
        if (!teamCountMap.has(row.league_id)) teamCountMap.set(row.league_id, new Set());
        teamCountMap.get(row.league_id)!.add(row.id);
      }

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
        const registeredCount = teamCountMap.get(l.id)?.size ?? 0;
        return { ...l, match_count: stats.matches, team_count: Math.max(stats.teams.size, registeredCount) };
      });

      setLeagues(combined);
      setLoading(false);
    })();
  }, []);

  return (
    <main style={{ minHeight: "calc(100vh - 56px)" }}>
      {/* Header */}
      <section style={{ borderBottom: "1px solid var(--border-main)", padding: "40px 24px 32px", background: "var(--bg-nav)" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto" }}>
          <div style={{ fontSize: 11, letterSpacing: "0.25em", color: "var(--text-faint)", fontWeight: 700, textTransform: "uppercase", marginBottom: 10 }}>
            <Link href="/" style={{ color: "var(--text-faint)", textDecoration: "none" }}>Home</Link>
            <span style={{ margin: "0 8px" }}>/</span>
            Leagues
          </div>
          <h1 style={{ fontSize: 36, fontWeight: 900, letterSpacing: "-0.02em", color: "var(--text-main)", margin: 0 }}>
            Leagues
          </h1>
          <p style={{ fontSize: 13, color: "var(--text-faint)", marginTop: 6 }}>
            {leagues.length} competition{leagues.length !== 1 ? "s" : ""} in the database
          </p>
        </div>
      </section>

      <section style={{ maxWidth: 1200, margin: "0 auto", padding: "40px 24px" }}>
        {!supabase ? (
          <div style={{ background: "var(--bg-card)", borderLeft: "3px solid #e63946", padding: "20px 24px", color: "var(--text-sub)" }}>
            Missing Supabase environment variables.
          </div>
        ) : error ? (
          <div style={{ background: "var(--bg-card)", borderLeft: "3px solid #e63946", padding: "20px 24px" }}>
            <div style={{ color: "#e63946", fontWeight: 700, marginBottom: 8 }}>Error</div>
            <pre style={{ fontSize: 11, color: "var(--text-sub)", overflow: "auto" }}>{JSON.stringify(error, null, 2)}</pre>
          </div>
        ) : loading ? (
          <div style={{ color: "var(--text-faint)", fontSize: 13, letterSpacing: "0.1em" }}>LOADING...</div>
        ) : leagues.length === 0 ? (
          <div style={{ background: "var(--bg-card)", borderLeft: "3px solid var(--border-main)", padding: "20px 24px", color: "var(--text-faint)" }}>
            No leagues found.
          </div>
        ) : (
          <LeagueGrid leagues={leagues} />
        )}
      </section>
    </main>
  );
}
