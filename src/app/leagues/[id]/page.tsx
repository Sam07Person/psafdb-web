// /src/app/leagues/[id]/page.tsx
import { createClient } from "@supabase/supabase-js";
import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import StandingsTableWithForm from "./StandingsTableWithForm";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

type Zone = { name: string; color: string; spots: number; type: "top" | "bottom" };

async function getLeague(id: string) {
  const { data, error } = await supabase
    .from("leagues")
    .select("id, name, season, format, image, zones, created_at")
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

  // Bracket data — all knockout matches (played + upcoming), sorted earliest-first for left→right display
  const bracketByStage: Record<string, any[]> = {};
  for (const m of matches.filter((m: any) => !m.group_name)) {
    const stage = m.stage || "Knockout";
    if (!bracketByStage[stage]) bracketByStage[stage] = [];
    bracketByStage[stage].push(m);
  }
  // Sort stages: earliest (most matches) first → final last
  const bracketStages = Object.keys(bracketByStage).sort((a, b) => knockoutStageRank(b) - knockoutStageRank(a));
  const bracketThirdStage = bracketStages.find(s => s.toLowerCase().includes("third"));
  const mainBracketStages = bracketStages.filter(s => !s.toLowerCase().includes("third"));

  const playedMatches = matches.filter((m: any) => m.home_score !== null);
  const upcomingMatches = matches.filter((m: any) => m.home_score === null).reverse().slice(0, 5);
  const logo = getLeagueLogo(league.image);
  const totalGoals = matches.reduce((s: number, m: any) => s + (m.home_score || 0) + (m.away_score || 0), 0);

  // Resolve which zone applies to a row index
  function getRowZone(index: number, totalRows: number, zones: Zone[]): Zone | null {
    let topOffset = 0;
    for (const zone of zones.filter(z => z.type === "top")) {
      if (index >= topOffset && index < topOffset + zone.spots) return zone;
      topOffset += zone.spots;
    }
    let bottomOffset = 0;
    for (const zone of zones.filter(z => z.type === "bottom")) {
      if (totalRows - 1 - index >= bottomOffset && totalRows - 1 - index < bottomOffset + zone.spots) return zone;
      bottomOffset += zone.spots;
    }
    return null;
  }

  // Shared standings table renderer
  function StandingsTable({ rows, zones = [] }: { rows: StandingRow[]; zones?: Zone[] }) {
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
              const zone = getRowZone(index, rows.length, zones);
              return (
                <tr key={row.team} style={{ borderBottom: "1px solid var(--border-row)", background: zone ? `${zone.color}18` : "transparent", borderLeft: zone ? `2px solid ${zone.color}` : "2px solid transparent" }}>
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

  // Legend for zone colours below a standings table
  function ZoneLegend({ zones }: { zones: Zone[] }) {
    if (zones.length === 0) return null;
    return (
      <div style={{ background: "var(--bg-row)", padding: "6px 12px", display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
        {zones.map((zone, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ display: "inline-block", width: 8, height: 8, background: zone.color, flexShrink: 0 }} />
            <span style={{ fontSize: 10, color: "var(--text-muted)", letterSpacing: "0.08em" }}>{zone.name}</span>
          </div>
        ))}
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

  function KnockoutBracket({ stages, byStage }: { stages: string[]; byStage: Record<string, any[]> }) {
    if (stages.length === 0) return null;

    const BASE = 96;        // base slot height (px) for the earliest round
    const CW   = 28;        // connector column width (px)
    const MW   = 164;       // match card width (px)
    const AC   = "#a78bfa"; // accent colour

    // Third place is displayed separately below the main bracket
    const thirdStage = stages.find(s => s.toLowerCase().includes("third"));
    const main = stages.filter(s => !s.toLowerCase().includes("third"));

    function BracketCard({ match }: { match: any }) {
      const played = match.home_score !== null;
      const homeWin = played && match.home_score > match.away_score;
      const awayWin = played && match.away_score > match.home_score;
      return (
        <Link href={`/matches/${match.id}`} style={{ display: "block", textDecoration: "none" }} className="nav-card">
          <div style={{ background: "var(--bg-card)", border: "1px solid var(--border-main)", width: MW, overflow: "hidden" }}>
            {[{ team: match.home_team, score: match.home_score, win: homeWin }, { team: match.away_team, score: match.away_score, win: awayWin }].map((row, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "5px 9px", background: played && row.win ? "rgba(74,222,128,0.08)" : "transparent", borderBottom: i === 0 ? "1px solid var(--border-row)" : "none" }}>
                <span style={{ fontSize: 12, fontWeight: played && row.win ? 700 : 400, color: played && row.win ? "var(--text-body)" : "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: MW - 34 }}>
                  {row.team || "TBD"}
                </span>
                <span style={{ fontSize: 13, fontWeight: 900, color: played && row.win ? AC : "var(--text-faint)", flexShrink: 0, minWidth: 16, textAlign: "right" as const, fontVariantNumeric: "tabular-nums" }}>
                  {played ? row.score : ""}
                </span>
              </div>
            ))}
          </div>
        </Link>
      );
    }

    return (
      <div>
        {/* Bracket header */}
        <div style={{ background: "var(--bg-card)", borderTop: `3px solid ${AC}`, padding: "12px 20px", fontSize: 11, fontWeight: 700, letterSpacing: "0.2em", textTransform: "uppercase", color: AC }}>
          Bracket
        </div>

        {/* Scrollable bracket */}
        <div style={{ overflowX: "auto", background: "var(--bg-row)", padding: "24px 20px 28px" }}>
          <div style={{ display: "inline-flex", alignItems: "flex-start" }}>
            {main.map((stage, colIdx) => {
              const slotH = BASE * Math.pow(2, colIdx);
              const colMatches: any[] = byStage[stage] || [];
              const isLast = colIdx === main.length - 1;

              return (
                <div key={stage} style={{ display: "flex", alignItems: "flex-start" }}>
                  {/* Incoming arm (horizontal line to card) for rounds after the first */}
                  {colIdx > 0 && (
                    <div style={{ display: "flex", flexDirection: "column" }}>
                      {colMatches.map((_: any, mi: number) => (
                        <div key={mi} style={{ height: slotH, display: "flex", alignItems: "center" }}>
                          <div style={{ width: CW, height: 0, borderTop: `2px solid ${AC}` }} />
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Match cards column */}
                  <div>
                    {/* Stage label */}
                    <div style={{ textAlign: "center", fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 8, width: MW }}>
                      {stage}
                    </div>
                    {colMatches.map((match: any) => (
                      <div key={match.id} style={{ height: slotH, display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <BracketCard match={match} />
                      </div>
                    ))}
                  </div>

                  {/* Outgoing connector to next round */}
                  {!isLast && (
                    <div style={{ display: "flex", flexDirection: "column" }}>
                      {Array.from({ length: Math.ceil(colMatches.length / 2) }).map((_, pairIdx) => {
                        const hasBottom = pairIdx * 2 + 1 < colMatches.length;
                        return (
                          <div key={pairIdx}>
                            {/* Top match of pair: ┐ connector in bottom half of slot */}
                            <div style={{ height: slotH, position: "relative" }}>
                              <div style={{ position: "absolute", top: "50%", left: 0, right: 0, bottom: 0, borderTop: `2px solid ${AC}`, borderRight: `2px solid ${AC}` }} />
                            </div>
                            {/* Bottom match of pair: ┘ connector in top half of slot */}
                            {hasBottom && (
                              <div style={{ height: slotH, position: "relative" }}>
                                <div style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: "50%", borderRight: `2px solid ${AC}`, borderBottom: `2px solid ${AC}` }} />
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Third place play-off shown below the bracket */}
        {thirdStage && (byStage[thirdStage] || []).length > 0 && (
          <div style={{ marginTop: 2 }}>
            <div style={{ background: "var(--bg-card)", borderTop: `3px solid ${AC}`, padding: "12px 20px", fontSize: 11, fontWeight: 700, letterSpacing: "0.2em", textTransform: "uppercase", color: AC }}>
              Third Place Play-off
            </div>
            {byStage[thirdStage].map((match: any) => <MatchRow key={match.id} match={match} />)}
          </div>
        )}
      </div>
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
              <StandingsTableWithForm
                rows={standings}
                zones={league.zones || []}
                teamIdMap={teamIdMap}
                matches={matches}
              />
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
                      <StandingsTable rows={groupStandings[groupName]} zones={league.zones || []} />
                      <ZoneLegend zones={league.zones || []} />
                    </div>
                  ))}
                </div>
              )}

              {/* Knockout bracket */}
              {mainBracketStages.length > 0 && (
                <div style={{ marginTop: 2 }}>
                  <KnockoutBracket stages={bracketStages} byStage={bracketByStage} />
                </div>
              )}
            </>
          )}

          {/* ── KNOCKOUT FORMAT: visual bracket ── */}
          {isKnockout && (
            mainBracketStages.length === 0 && !bracketThirdStage ? (
              <div style={{ background: "var(--bg-card)", borderTop: "3px solid #a78bfa", padding: "40px 20px", textAlign: "center", color: "var(--text-faint)", fontSize: 13 }}>
                No matches yet
              </div>
            ) : (
              <KnockoutBracket stages={bracketStages} byStage={bracketByStage} />
            )
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
