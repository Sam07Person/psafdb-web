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
    .select("id, name, season, format, image, created_at")
    .eq("id", id)
    .single();
  if (error || !data) return null;
  return data;
}

async function getLeagueTeams(leagueId: string) {
  // Teams with direct league_id
  const { data: direct } = await supabase
    .from("teams")
    .select("id, name")
    .eq("league_id", leagueId);

  // Teams via junction table
  const { data: junction } = await supabase
    .from("team_leagues")
    .select("team_id, teams(id, name)")
    .eq("league_id", leagueId);

  const seen = new Set<string>();
  const result: { id: string; name: string }[] = [];

  for (const t of direct || []) {
    if (!seen.has(t.id)) { seen.add(t.id); result.push(t); }
  }
  for (const j of junction || []) {
    const t = (j as any).teams;
    if (t && !seen.has(t.id)) { seen.add(t.id); result.push({ id: t.id, name: t.name }); }
  }

  return result.sort((a, b) => a.name.localeCompare(b.name));
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

type StandingRow = {
  team: string; played: number; won: number; drawn: number; lost: number;
  gf: number; ga: number; points: number; forfeit_deductions: number;
};

function applyMatchToStandings(s: Record<string, StandingRow>, match: any) {
  const ensure = (name: string) => {
    if (!s[name]) s[name] = { team: name, played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, points: 0, forfeit_deductions: 0 };
  };
  ensure(match.home_team);
  ensure(match.away_team);

  if (match.home_score === null || match.away_score === null) return;

  const home = s[match.home_team];
  const away = s[match.away_team];

  home.played++; home.gf += match.home_score; home.ga += match.away_score;
  if (match.home_score > match.away_score) { home.won++; home.points += 3; }
  else if (match.home_score < match.away_score) { home.lost++; }
  else { home.drawn++; home.points += 1; }

  away.played++; away.gf += match.away_score; away.ga += match.home_score;
  if (match.away_score > match.home_score) { away.won++; away.points += 3; }
  else if (match.away_score < match.home_score) { away.lost++; }
  else { away.drawn++; away.points += 1; }

  if (match.forfeited_by === "home") { home.points -= 1; home.forfeit_deductions++; }
  else if (match.forfeited_by === "away") { away.points -= 1; away.forfeit_deductions++; }
}

function sortRows(rows: StandingRow[]): StandingRow[] {
  return [...rows].sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    const gdA = a.gf - a.ga, gdB = b.gf - b.ga;
    if (gdB !== gdA) return gdB - gdA;
    return b.gf - a.gf;
  });
}

function calculateStandings(teams: any[], matches: any[]): StandingRow[] {
  const s: Record<string, StandingRow> = {};
  for (const t of teams) s[t.name] = { team: t.name, played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, points: 0, forfeit_deductions: 0 };
  for (const m of matches) applyMatchToStandings(s, m);
  return sortRows(Object.values(s));
}

function calculateGroupStandings(matches: any[]): Record<string, StandingRow[]> {
  const byGroup: Record<string, Record<string, StandingRow>> = {};
  for (const m of matches.filter((m: any) => m.group_name)) {
    const g = m.group_name;
    if (!byGroup[g]) byGroup[g] = {};
    applyMatchToStandings(byGroup[g], m);
  }
  const result: Record<string, StandingRow[]> = {};
  for (const [g, s] of Object.entries(byGroup)) result[g] = sortRows(Object.values(s));
  return result;
}

function getLeagueLogo(image: string | null): { img: string; filter: string } | null {
  if (!image) return null;
  const filters: Record<string, string> = {
    cd: "invert(1) sepia(1) saturate(3) hue-rotate(180deg) brightness(1.2)",
    pl: "invert(1) sepia(1) saturate(3) hue-rotate(20deg) brightness(1.3)",
    cl: "invert(1) hue-rotate(180deg) brightness(1.1)",
    ml: "invert(1) hue-rotate(180deg) brightness(1.1)",
  };
  if (!filters[image]) return null;
  return { img: `/${image}.png`, filter: filters[image] };
}

// Canonical knockout stage order (later rounds first)
const KNOCKOUT_STAGE_ORDER = ["final", "third place", "semifinal", "semi-final", "quarterfinal", "quarter-final", "round of 16", "round of 32", "knockout"];
function knockoutStageRank(stage: string) {
  const s = stage.toLowerCase();
  const idx = KNOCKOUT_STAGE_ORDER.findIndex(k => s.includes(k));
  return idx === -1 ? 999 : idx;
}

export const revalidate = 60;

export default async function LeagueDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const league = await getLeague(id);
  if (!league) notFound();

  const [teams, matches] = await Promise.all([getLeagueTeams(id), getLeagueMatches(id)]);
  const teamIdMap: Record<string, string> = Object.fromEntries(teams.map((t: any) => [t.name, t.id]));

  const isGroupKnockout = league.format === "group_knockout";
  const isKnockout = league.format === "knockout";
  const isLeague = !isGroupKnockout && !isKnockout;

  // League format
  const standings = isLeague ? calculateStandings(teams, matches) : [];

  // Group + knockout format
  const groupMatches = matches.filter((m: any) => m.group_name);
  const groupStandings = isGroupKnockout ? calculateGroupStandings(matches) : {};
  const sortedGroups = Object.keys(groupStandings).sort();

  // Knockout matches (for both knockout-only and group+knockout)
  const knockoutMatchesPlayed = matches.filter((m: any) => m.home_score !== null && !m.group_name);
  const knockoutByStage: Record<string, any[]> = {};
  for (const m of knockoutMatchesPlayed) {
    const stage = m.stage || "Knockout";
    if (!knockoutByStage[stage]) knockoutByStage[stage] = [];
    knockoutByStage[stage].push(m);
  }
  const sortedKnockoutStages = Object.keys(knockoutByStage).sort((a, b) => knockoutStageRank(a) - knockoutStageRank(b));

  const playedMatches = matches.filter((m: any) => m.home_score !== null);
  const upcomingMatches = matches.filter((m: any) => m.home_score === null).reverse().slice(0, 5);
  const logo = getLeagueLogo(league.image);
  const totalGoals = matches.reduce((s: number, m: any) => s + (m.home_score || 0) + (m.away_score || 0), 0);

  // Shared standings table renderer
  function StandingsTable({ rows, advanceSpots = 0 }: { rows: StandingRow[]; advanceSpots?: number }) {
    return (
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ background: "var(--bg-row)" }}>
              {["#", "Team", "P", "W", "D", "L", "GF", "GA", "GD", "Pts"].map(h => (
                <th key={h} style={{ padding: "8px 12px", textAlign: h === "Team" || h === "#" ? "left" : "center", fontSize: 10, color: "var(--text-faint)", fontWeight: 700, letterSpacing: "0.15em", textTransform: "uppercase", borderBottom: "1px solid var(--border-main)" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => {
              const gd = row.gf - row.ga;
              const advances = advanceSpots > 0 && index < advanceSpots;
              return (
                <tr key={row.team} style={{ borderBottom: "1px solid var(--border-row)", background: advances ? "rgba(74,222,128,0.08)" : "transparent", borderLeft: advances ? "2px solid #4ade80" : "2px solid transparent" }}>
                  <td style={{ padding: "10px 12px", color: "var(--text-faint)", fontSize: 11, fontWeight: 700 }}>{index + 1}</td>
                  <td style={{ padding: "10px 12px", fontWeight: 700, color: "var(--text-body)" }}>
                    {teamIdMap[row.team] ? (
                      <Link href={`/teams/${teamIdMap[row.team]}`} style={{ color: "var(--text-body)", textDecoration: "none" }} className="nav-link">
                        {row.team}
                      </Link>
                    ) : row.team}
                  </td>
                  <td style={{ padding: "10px 12px", textAlign: "center", color: "var(--text-muted)" }}>{row.played}</td>
                  <td style={{ padding: "10px 12px", textAlign: "center", color: "#4ade80", fontWeight: 600 }}>{row.won}</td>
                  <td style={{ padding: "10px 12px", textAlign: "center", color: "#f4c430", fontWeight: 600 }}>{row.drawn}</td>
                  <td style={{ padding: "10px 12px", textAlign: "center", color: "#e63946", fontWeight: 600 }}>{row.lost}</td>
                  <td style={{ padding: "10px 12px", textAlign: "center", color: "var(--text-sub)" }}>{row.gf}</td>
                  <td style={{ padding: "10px 12px", textAlign: "center", color: "var(--text-sub)" }}>{row.ga}</td>
                  <td style={{ padding: "10px 12px", textAlign: "center", color: gd > 0 ? "#4ade80" : gd < 0 ? "#e63946" : "var(--text-muted)", fontWeight: 600 }}>
                    {gd > 0 ? "+" : ""}{gd}
                  </td>
                  <td style={{ padding: "10px 16px", textAlign: "center", fontWeight: 900, fontSize: 15, color: "var(--text-main)" }}>{row.points}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  function MatchRow({ match }: { match: any }) {
    const homeWin = match.home_score > match.away_score;
    const awayWin = match.away_score > match.home_score;
    return (
      <Link
        href={`/matches/${match.id}`}
        style={{ display: "flex", alignItems: "center", padding: "12px 20px", borderBottom: "1px solid var(--border-row)", textDecoration: "none", background: "transparent" }}
        className="nav-card"
      >
        <span style={{ flex: 1, textAlign: "right", fontSize: 13, fontWeight: homeWin ? 700 : 400, color: homeWin ? "var(--text-body)" : "var(--text-muted)" }}>{match.home_team}</span>
        <div style={{ margin: "0 16px", display: "flex", alignItems: "center", gap: 8, minWidth: 80, justifyContent: "center" }}>
          <span style={{ fontWeight: 900, fontSize: 18, color: "var(--text-main)", fontVariantNumeric: "tabular-nums" }}>{match.home_score}</span>
          <span style={{ color: "var(--text-faint)", fontSize: 12 }}>—</span>
          <span style={{ fontWeight: 900, fontSize: 18, color: "var(--text-main)", fontVariantNumeric: "tabular-nums" }}>{match.away_score}</span>
        </div>
        <span style={{ flex: 1, fontSize: 13, fontWeight: awayWin ? 700 : 400, color: awayWin ? "var(--text-body)" : "var(--text-muted)" }}>{match.away_team}</span>
        {match.forfeited_by && (
          <span style={{ fontSize: 10, color: "#e63946", background: "#e6394620", padding: "2px 6px", marginLeft: 8, letterSpacing: "0.08em" }}>FORFEIT</span>
        )}
      </Link>
    );
  }

  return (
    <main style={{ minHeight: "calc(100vh - 56px)" }}>
      {/* Header */}
      <section style={{ borderBottom: "1px solid var(--border-main)", padding: "40px 24px 32px", background: "var(--bg-nav)" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto" }}>
          <div style={{ fontSize: 11, letterSpacing: "0.25em", color: "var(--text-faint)", fontWeight: 700, textTransform: "uppercase", marginBottom: 14 }}>
            <Link href="/" style={{ color: "var(--text-faint)", textDecoration: "none" }}>Home</Link>
            <span style={{ margin: "0 8px" }}>/</span>
            <Link href="/leagues" style={{ color: "var(--text-faint)", textDecoration: "none" }}>Leagues</Link>
            <span style={{ margin: "0 8px" }}>/</span>
            {league.name}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            {logo ? (
              <div style={{ width: 56, height: 56, background: "var(--bg-card)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <Image src={logo.img} alt={league.name} width={38} height={38} style={{ filter: logo.filter }} />
              </div>
            ) : null}
            <div>
              <h1 style={{ fontSize: 32, fontWeight: 900, letterSpacing: "-0.02em", color: "var(--text-main)", margin: 0 }}>{league.name}</h1>
              <div style={{ display: "flex", gap: 12, marginTop: 6, alignItems: "center" }}>
                {league.season && <span style={{ fontSize: 12, color: "var(--text-faint)" }}>Season {league.season}</span>}
                {league.format && <span style={{ fontSize: 11, color: "var(--text-muted)", background: "var(--bg-card)", padding: "2px 8px", letterSpacing: "0.08em", textTransform: "uppercase" }}>{league.format.replace(/_/g, " ")}</span>}
              </div>
            </div>
          </div>
        </div>
      </section>

      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "32px 24px", display: "grid", gridTemplateColumns: "1fr 300px", gap: 2 }}>
        {/* Left: main content */}
        <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>

          {/* ── LEAGUE FORMAT: single standings table ── */}
          {isLeague && (
            <div>
              <div style={{ background: "var(--bg-card)", borderTop: "3px solid #f4c430", padding: "14px 20px", fontSize: 11, fontWeight: 700, letterSpacing: "0.2em", textTransform: "uppercase", color: "#f4c430" }}>
                Standings
              </div>
              {standings.length === 0
                ? <div style={{ background: "var(--bg-card)", padding: "40px 20px", textAlign: "center", color: "var(--text-faint)", fontSize: 13 }}>No teams yet</div>
                : <StandingsTable rows={standings} />
              }
            </div>
          )}

          {/* ── GROUP + KNOCKOUT FORMAT: group tables grid ── */}
          {isGroupKnockout && (
            <>
              {sortedGroups.length === 0 ? (
                <div style={{ background: "var(--bg-card)", borderTop: "3px solid #f4c430", padding: "40px 20px", textAlign: "center", color: "var(--text-faint)", fontSize: 13 }}>
                  No group stage matches yet
                </div>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 2 }}>
                  {sortedGroups.map(groupName => (
                    <div key={groupName}>
                      <div style={{ background: "var(--bg-card)", borderTop: "3px solid #f4c430", padding: "12px 20px", fontSize: 11, fontWeight: 700, letterSpacing: "0.2em", textTransform: "uppercase", color: "#f4c430" }}>
                        {groupName}
                      </div>
                      <StandingsTable rows={groupStandings[groupName]} advanceSpots={2} />
                      <div style={{ background: "var(--bg-row)", padding: "6px 12px", display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ display: "inline-block", width: 8, height: 8, background: "#4ade80", flexShrink: 0 }} />
                        <span style={{ fontSize: 10, color: "var(--text-muted)", letterSpacing: "0.08em" }}>Advances</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Knockout rounds */}
              {sortedKnockoutStages.length > 0 && (
                <div style={{ marginTop: 2 }}>
                  {sortedKnockoutStages.map(stage => (
                    <div key={stage} style={{ marginBottom: 2 }}>
                      <div style={{ background: "var(--bg-card)", borderTop: "3px solid #a78bfa", padding: "12px 20px", fontSize: 11, fontWeight: 700, letterSpacing: "0.2em", textTransform: "uppercase", color: "#a78bfa" }}>
                        {stage}
                      </div>
                      {knockoutByStage[stage].map((match: any) => (
                        <MatchRow key={match.id} match={match} />
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {/* ── KNOCKOUT FORMAT: results by stage only ── */}
          {isKnockout && (
            <>
              {sortedKnockoutStages.length === 0 ? (
                <div style={{ background: "var(--bg-card)", borderTop: "3px solid #a78bfa", padding: "40px 20px", textAlign: "center", color: "var(--text-faint)", fontSize: 13 }}>
                  No matches played yet
                </div>
              ) : (
                sortedKnockoutStages.map(stage => (
                  <div key={stage} style={{ marginBottom: 2 }}>
                    <div style={{ background: "var(--bg-card)", borderTop: "3px solid #a78bfa", padding: "12px 20px", fontSize: 11, fontWeight: 700, letterSpacing: "0.2em", textTransform: "uppercase", color: "#a78bfa" }}>
                      {stage}
                    </div>
                    {knockoutByStage[stage].map((match: any) => (
                      <MatchRow key={match.id} match={match} />
                    ))}
                  </div>
                ))
              )}
            </>
          )}

          {/* Recent Results (league format only — groups/knockout handle their own results above) */}
          {isLeague && (
            <div style={{ marginTop: 2 }}>
              <div style={{ background: "var(--bg-card)", borderTop: "3px solid #e63946", padding: "14px 20px", fontSize: 11, fontWeight: 700, letterSpacing: "0.2em", textTransform: "uppercase", color: "#e63946" }}>
                Recent Results
              </div>
              {playedMatches.length === 0
                ? <div style={{ background: "var(--bg-card)", padding: "40px 20px", textAlign: "center", color: "var(--text-faint)", fontSize: 13 }}>No matches played yet</div>
                : playedMatches.slice(0, 10).map((match: any) => <MatchRow key={match.id} match={match} />)
              }
            </div>
          )}

          {/* For group+knockout: also show recent group results below knockout */}
          {isGroupKnockout && groupMatches.filter((m: any) => m.home_score !== null).length > 0 && (
            <div style={{ marginTop: 2 }}>
              <div style={{ background: "var(--bg-card)", borderTop: "3px solid #e63946", padding: "14px 20px", fontSize: 11, fontWeight: 700, letterSpacing: "0.2em", textTransform: "uppercase", color: "#e63946" }}>
                Recent Group Results
              </div>
              {groupMatches.filter((m: any) => m.home_score !== null).slice(0, 10).map((match: any) => (
                <MatchRow key={match.id} match={match} />
              ))}
            </div>
          )}
        </div>

        {/* Right Sidebar */}
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <div style={{ background: "var(--bg-card)", borderTop: "3px solid #4ea8f7" }}>
            <div style={{ padding: "14px 20px", fontSize: 11, fontWeight: 700, letterSpacing: "0.2em", textTransform: "uppercase", color: "#4ea8f7", borderBottom: "1px solid var(--border-main)" }}>
              League Info
            </div>
            {[
              { label: "Teams", val: teams.length || standings.length },
              { label: "Groups", val: isGroupKnockout ? sortedGroups.length : "—" },
              { label: "Matches Played", val: playedMatches.length },
              { label: "Total Goals", val: totalGoals },
              { label: "Forfeits", val: matches.filter((m: any) => m.forfeited_by).length },
            ].filter(({ val }) => val !== "—").map(({ label, val }) => (
              <div key={label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 20px", borderBottom: "1px solid var(--border-row)" }}>
                <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{label}</span>
                <span style={{ fontSize: 14, fontWeight: 800, color: "var(--text-body)" }}>{val}</span>
              </div>
            ))}
          </div>

          {upcomingMatches.length > 0 && (
            <div style={{ background: "var(--bg-card)", borderTop: "3px solid #a78bfa" }}>
              <div style={{ padding: "14px 20px", fontSize: 11, fontWeight: 700, letterSpacing: "0.2em", textTransform: "uppercase", color: "#a78bfa", borderBottom: "1px solid var(--border-main)" }}>
                Upcoming
              </div>
              {upcomingMatches.map((match: any) => (
                <div key={match.id} style={{ padding: "12px 20px", borderBottom: "1px solid var(--border-row)" }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-sub)" }}>
                    {match.home_team} <span style={{ color: "var(--text-faint)", margin: "0 4px" }}>vs</span> {match.away_team}
                  </div>
                  {match.group_name && <div style={{ fontSize: 10, color: "var(--text-faint)", marginTop: 2, letterSpacing: "0.08em", textTransform: "uppercase" }}>{match.group_name}</div>}
                  {match.stage && !match.group_name && <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2, letterSpacing: "0.08em", textTransform: "uppercase" }}>{match.stage}</div>}
                  <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 4 }}>
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
