// /src/app/leagues/[id]/page.tsx
import { createClient } from "@supabase/supabase-js";
import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

async function getLeague(id: string) {
  const { data, error } = await supabase
    .from("leagues")
    .select("id, name, season, format, created_at")
    .eq("id", id)
    .single();
  if (error || !data) return null;
  return data;
}

async function getLeagueTeams(leagueId: string) {
  const { data, error } = await supabase
    .from("teams")
    .select("id, name")
    .eq("league_id", leagueId)
    .order("name", { ascending: true });
  if (error) return [];
  return data || [];
}

async function getLeagueMatches(leagueId: string) {
  const { data, error } = await supabase
    .from("matches")
    .select("id, home_team, away_team, home_score, away_score, played_at, stage, group_name, forfeited_by")
    .eq("league_id", leagueId)
    .order("played_at", { ascending: false });
  if (error) return [];
  return data || [];
}

function calculateStandings(teams: any[], matches: any[]) {
  const standings: Record<string, {
    team: string; played: number; won: number; drawn: number; lost: number;
    gf: number; ga: number; points: number; forfeit_deductions: number;
  }> = {};

  for (const team of teams) {
    standings[team.name] = { team: team.name, played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, points: 0, forfeit_deductions: 0 };
  }
  for (const match of matches) {
    if (!standings[match.home_team]) {
      standings[match.home_team] = { team: match.home_team, played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, points: 0, forfeit_deductions: 0 };
    }
    if (!standings[match.away_team]) {
      standings[match.away_team] = { team: match.away_team, played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, points: 0, forfeit_deductions: 0 };
    }
  }

  for (const match of matches) {
    if (match.home_score === null || match.away_score === null) continue;
    const home = standings[match.home_team];
    const away = standings[match.away_team];

    if (home) {
      home.played++;
      home.gf += match.home_score;
      home.ga += match.away_score;
      if (match.home_score > match.away_score) { home.won++; home.points += 3; }
      else if (match.home_score < match.away_score) { home.lost++; }
      else { home.drawn++; home.points += 1; }
    }
    if (away) {
      away.played++;
      away.gf += match.away_score;
      away.ga += match.home_score;
      if (match.away_score > match.home_score) { away.won++; away.points += 3; }
      else if (match.away_score < match.home_score) { away.lost++; }
      else { away.drawn++; away.points += 1; }
    }

    // Forfeit: deduct 1 point from forfeiting team
    if (match.forfeited_by === "home" && home) {
      home.points = Math.max(0, home.points - 1);
      home.forfeit_deductions++;
    } else if (match.forfeited_by === "away" && away) {
      away.points = Math.max(0, away.points - 1);
      away.forfeit_deductions++;
    }
  }

  return Object.values(standings).sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    const gdA = a.gf - a.ga;
    const gdB = b.gf - b.ga;
    if (gdB !== gdA) return gdB - gdA;
    return b.gf - a.gf;
  });
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

export const revalidate = 60;

export default async function LeagueDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const league = await getLeague(id);
  if (!league) notFound();

  const [teams, matches] = await Promise.all([getLeagueTeams(id), getLeagueMatches(id)]);
  const standings = calculateStandings(teams, matches);
  const playedMatches = matches.filter((m: any) => m.home_score !== null);
  const upcomingMatches = matches.filter((m: any) => m.home_score === null).reverse().slice(0, 5);
  const logo = getLeagueLogo(league.name);
  const totalGoals = matches.reduce((s: number, m: any) => s + (m.home_score || 0) + (m.away_score || 0), 0);

  return (
    <main style={{ minHeight: "calc(100vh - 56px)" }}>
      {/* Header */}
      <section style={{ borderBottom: "1px solid #1a1a2e", padding: "40px 24px 32px", background: "#09091a" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto" }}>
          <div style={{ fontSize: 11, letterSpacing: "0.25em", color: "#3a3a5a", fontWeight: 700, textTransform: "uppercase", marginBottom: 14 }}>
            <Link href="/" style={{ color: "#3a3a5a", textDecoration: "none" }}>Home</Link>
            <span style={{ margin: "0 8px" }}>/</span>
            <Link href="/leagues" style={{ color: "#3a3a5a", textDecoration: "none" }}>Leagues</Link>
            <span style={{ margin: "0 8px" }}>/</span>
            {league.name}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            {logo ? (
              <div style={{ width: 56, height: 56, background: "#0d0d1a", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <Image src={logo.img} alt={league.name} width={38} height={38} style={{ filter: logo.filter }} />
              </div>
            ) : null}
            <div>
              <h1 style={{ fontSize: 32, fontWeight: 900, letterSpacing: "-0.02em", color: "#f0f0fa", margin: 0 }}>{league.name}</h1>
              <div style={{ display: "flex", gap: 12, marginTop: 6, alignItems: "center" }}>
                {league.season && <span style={{ fontSize: 12, color: "#3a3a5a" }}>Season {league.season}</span>}
                {league.format && <span style={{ fontSize: 11, color: "#5a5a7a", background: "#0d0d1a", padding: "2px 8px", letterSpacing: "0.08em", textTransform: "uppercase" }}>{league.format.replace("_", " ")}</span>}
              </div>
            </div>
          </div>
        </div>
      </section>

      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "32px 24px", display: "grid", gridTemplateColumns: "1fr 300px", gap: 2 }}>
        {/* Left: Standings + Results */}
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>

          {/* Standings */}
          <div>
            <div style={{ background: "#0d0d1a", borderTop: "3px solid #f4c430", padding: "14px 20px", fontSize: 11, fontWeight: 700, letterSpacing: "0.2em", textTransform: "uppercase", color: "#f4c430" }}>
              Standings
            </div>
            {standings.length === 0 ? (
              <div style={{ background: "#0d0d1a", padding: "40px 20px", textAlign: "center", color: "#3a3a5a", fontSize: 13 }}>No teams yet</div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: "#09090f" }}>
                      {["#", "Team", "P", "W", "D", "L", "GF", "GA", "GD", "Pts"].map(h => (
                        <th key={h} style={{ padding: "8px 12px", textAlign: h === "Team" || h === "#" ? "left" : "center", fontSize: 10, color: "#3a3a5a", fontWeight: 700, letterSpacing: "0.15em", textTransform: "uppercase", borderBottom: "1px solid #1a1a2e" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {standings.map((row, index) => {
                      const gd = row.gf - row.ga;
                      const isTop = index === 0 && standings.length > 1;
                      return (
                        <tr key={row.team} style={{ borderBottom: "1px solid #0f0f1a", background: isTop ? "#0f0f1e" : "transparent" }}>
                          <td style={{ padding: "10px 12px", color: "#3a3a5a", fontSize: 11, fontWeight: 700 }}>{index + 1}</td>
                          <td style={{ padding: "10px 12px", fontWeight: 700, color: "#e0e0f0" }}>
                            {row.team}
                            {row.forfeit_deductions > 0 && (
                              <span style={{ marginLeft: 6, fontSize: 10, color: "#e63946", background: "#e6394620", padding: "1px 5px" }}>-{row.forfeit_deductions}pts</span>
                            )}
                          </td>
                          <td style={{ padding: "10px 12px", textAlign: "center", color: "#5a5a7a" }}>{row.played}</td>
                          <td style={{ padding: "10px 12px", textAlign: "center", color: "#4ade80", fontWeight: 600 }}>{row.won}</td>
                          <td style={{ padding: "10px 12px", textAlign: "center", color: "#f4c430", fontWeight: 600 }}>{row.drawn}</td>
                          <td style={{ padding: "10px 12px", textAlign: "center", color: "#e63946", fontWeight: 600 }}>{row.lost}</td>
                          <td style={{ padding: "10px 12px", textAlign: "center", color: "#9090b0" }}>{row.gf}</td>
                          <td style={{ padding: "10px 12px", textAlign: "center", color: "#9090b0" }}>{row.ga}</td>
                          <td style={{ padding: "10px 12px", textAlign: "center", color: gd > 0 ? "#4ade80" : gd < 0 ? "#e63946" : "#5a5a7a", fontWeight: 600 }}>
                            {gd > 0 ? "+" : ""}{gd}
                          </td>
                          <td style={{ padding: "10px 16px", textAlign: "center", fontWeight: 900, fontSize: 15, color: "#f0f0fa" }}>{row.points}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Recent Results */}
          <div style={{ marginTop: 2 }}>
            <div style={{ background: "#0d0d1a", borderTop: "3px solid #e63946", padding: "14px 20px", fontSize: 11, fontWeight: 700, letterSpacing: "0.2em", textTransform: "uppercase", color: "#e63946" }}>
              Recent Results
            </div>
            {playedMatches.length === 0 ? (
              <div style={{ background: "#0d0d1a", padding: "40px 20px", textAlign: "center", color: "#3a3a5a", fontSize: 13 }}>No matches played yet</div>
            ) : (
              <div>
                {playedMatches.slice(0, 10).map((match: any) => {
                  const homeWin = match.home_score > match.away_score;
                  const awayWin = match.away_score > match.home_score;
                  return (
                    <Link
                      key={match.id}
                      href={`/matches/${match.id}`}
                      style={{ display: "flex", alignItems: "center", padding: "12px 20px", borderBottom: "1px solid #0f0f1a", textDecoration: "none", background: "transparent" }}
                      className="nav-card"
                    >
                      <span style={{ flex: 1, textAlign: "right", fontSize: 13, fontWeight: homeWin ? 700 : 400, color: homeWin ? "#e0e0f0" : "#5a5a7a" }}>{match.home_team}</span>
                      <div style={{ margin: "0 16px", display: "flex", alignItems: "center", gap: 8, minWidth: 80, justifyContent: "center" }}>
                        <span style={{ fontWeight: 900, fontSize: 18, color: "#f0f0fa", fontVariantNumeric: "tabular-nums" }}>{match.home_score}</span>
                        <span style={{ color: "#2a2a3a", fontSize: 12 }}>—</span>
                        <span style={{ fontWeight: 900, fontSize: 18, color: "#f0f0fa", fontVariantNumeric: "tabular-nums" }}>{match.away_score}</span>
                      </div>
                      <span style={{ flex: 1, fontSize: 13, fontWeight: awayWin ? 700 : 400, color: awayWin ? "#e0e0f0" : "#5a5a7a" }}>{match.away_team}</span>
                      {match.forfeited_by && (
                        <span style={{ fontSize: 10, color: "#e63946", background: "#e6394620", padding: "2px 6px", marginLeft: 8, letterSpacing: "0.08em" }}>FORFEIT</span>
                      )}
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Right Sidebar */}
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {/* Stats */}
          <div style={{ background: "#0d0d1a", borderTop: "3px solid #4ea8f7" }}>
            <div style={{ padding: "14px 20px", fontSize: 11, fontWeight: 700, letterSpacing: "0.2em", textTransform: "uppercase", color: "#4ea8f7", borderBottom: "1px solid #1a1a2e" }}>
              League Info
            </div>
            {[
              { label: "Teams", val: standings.length },
              { label: "Matches Played", val: playedMatches.length },
              { label: "Total Goals", val: totalGoals },
              { label: "Forfeits", val: matches.filter((m: any) => m.forfeited_by).length },
            ].map(({ label, val }) => (
              <div key={label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 20px", borderBottom: "1px solid #0f0f1a" }}>
                <span style={{ fontSize: 12, color: "#4a4a6a" }}>{label}</span>
                <span style={{ fontSize: 14, fontWeight: 800, color: "#e0e0f0" }}>{val}</span>
              </div>
            ))}
          </div>

          {/* Upcoming */}
          {upcomingMatches.length > 0 && (
            <div style={{ background: "#0d0d1a", borderTop: "3px solid #a78bfa" }}>
              <div style={{ padding: "14px 20px", fontSize: 11, fontWeight: 700, letterSpacing: "0.2em", textTransform: "uppercase", color: "#a78bfa", borderBottom: "1px solid #1a1a2e" }}>
                Upcoming
              </div>
              {upcomingMatches.map((match: any) => (
                <div key={match.id} style={{ padding: "12px 20px", borderBottom: "1px solid #0f0f1a" }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "#c0c0d8" }}>
                    {match.home_team} <span style={{ color: "#3a3a5a", margin: "0 4px" }}>vs</span> {match.away_team}
                  </div>
                  <div style={{ fontSize: 11, color: "#3a3a5a", marginTop: 4 }}>
                    {new Date(match.played_at).toLocaleDateString()}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
