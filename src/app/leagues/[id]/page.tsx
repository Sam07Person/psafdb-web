// /src/app/leagues/[id]/page.tsx
import { createClient } from "@supabase/supabase-js";
import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import StandingsTableWithForm from "./StandingsTableWithForm";
import { LeagueTabBar } from "./LeagueTabBar";
import { LeagueStatsClient, type PlayerStat, type TeamStat } from "./LeagueStatsClient";

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
  away.played++; away.gf += match.away_score; away.ga += match.home_score;

  if (match.forfeited_by === "both") {
    // Double forfeit: both teams get a loss and -1 deduction
    home.lost++; home.points -= 1; home.forfeit_deductions++;
    away.lost++; away.points -= 1; away.forfeit_deductions++;
  } else {
    if (match.home_score > match.away_score) { home.won++; home.points += 3; }
    else if (match.home_score < match.away_score) { home.lost++; }
    else { home.drawn++; home.points += 1; }

    if (match.away_score > match.home_score) { away.won++; away.points += 3; }
    else if (match.away_score < match.home_score) { away.lost++; }
    else { away.drawn++; away.points += 1; }

    if (match.forfeited_by === "home") { home.points -= 1; home.forfeit_deductions++; }
    else if (match.forfeited_by === "away") { away.points -= 1; away.forfeit_deductions++; }
  }
}

function getH2HResult(teamA: string, teamB: string, matches: any[]): number {
  // Returns: 1 if A beats B, -1 if B beats A, 0 if draw or not played
  for (const m of matches) {
    if (m.home_score === null || m.away_score === null) continue;
    if (m.home_team === teamA && m.away_team === teamB) {
      if (m.home_score > m.away_score) return 1;
      if (m.home_score < m.away_score) return -1;
      return 0;
    }
    if (m.home_team === teamB && m.away_team === teamA) {
      if (m.away_score > m.home_score) return 1;
      if (m.away_score < m.home_score) return -1;
      return 0;
    }
  }
  return 0; // not played
}

function sortRows(rows: StandingRow[], matches?: any[], mode: "league" | "group" = "league"): StandingRow[] {
  return [...rows].sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (mode === "group" && matches) {
      // Group format: points → h2h → GD → GF
      const h2h = getH2HResult(a.team, b.team, matches);
      if (h2h !== 0) return -h2h;
      const gdA = a.gf - a.ga, gdB = b.gf - b.ga;
      if (gdB !== gdA) return gdB - gdA;
      return b.gf - a.gf;
    }
    // League format: points → GD → h2h → GF
    const gdA = a.gf - a.ga, gdB = b.gf - b.ga;
    if (gdB !== gdA) return gdB - gdA;
    if (matches) {
      const h2h = getH2HResult(a.team, b.team, matches);
      if (h2h !== 0) return -h2h;
    }
    return b.gf - a.gf;
  });
}

function calculateStandings(teams: any[], matches: any[]): StandingRow[] {
  const s: Record<string, StandingRow> = {};
  for (const t of teams) s[t.name] = { team: t.name, played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, points: 0, forfeit_deductions: 0 };
  for (const m of matches) applyMatchToStandings(s, m);
  return sortRows(Object.values(s), matches);
}

function calculateGroupStandings(matches: any[]): Record<string, StandingRow[]> {
  const byGroup: Record<string, Record<string, StandingRow>> = {};
  const matchesByGroup: Record<string, any[]> = {};
  for (const m of matches.filter((m: any) => m.group_name)) {
    const g = m.group_name;
    if (!byGroup[g]) { byGroup[g] = {}; matchesByGroup[g] = []; }
    applyMatchToStandings(byGroup[g], m);
    matchesByGroup[g].push(m);
  }
  const result: Record<string, StandingRow[]> = {};
  for (const [g, s] of Object.entries(byGroup)) result[g] = sortRows(Object.values(s), matchesByGroup[g], "group");
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

// ── Two-leg tie merging ──────────────────────────────────────────────────────
// Detects pairs where Team A vs Team B and Team B vs Team A in the same stage
// and merges them into a single "tie" with aggregate score.
type MergedTie = {
  id: string;         // first leg match id (used as key)
  ids: string[];      // both match ids
  team1: string;
  team2: string;
  leg1: { home_score: number | null; away_score: number | null; home_team: string; away_team: string; id: string } | null;
  leg2: { home_score: number | null; away_score: number | null; home_team: string; away_team: string; id: string } | null;
  agg1: number | null; // team1's aggregate goals
  agg2: number | null; // team2's aggregate goals
  played: boolean;
  forfeited_by: string | null;
};

function mergeKnockoutLegs(stageMatches: any[]): MergedTie[] {
  const used = new Set<string>();
  const ties: MergedTie[] = [];

  for (let i = 0; i < stageMatches.length; i++) {
    if (used.has(stageMatches[i].id)) continue;
    const m = stageMatches[i];

    // Find the reverse fixture (same teams, swapped sides) in same stage
    let pairIdx = -1;
    for (let j = i + 1; j < stageMatches.length; j++) {
      if (used.has(stageMatches[j].id)) continue;
      const n = stageMatches[j];
      if ((m.home_team === n.away_team && m.away_team === n.home_team) ||
          (m.home_team === n.home_team && m.away_team === n.away_team)) {
        pairIdx = j;
        break;
      }
    }

    if (pairIdx === -1) {
      // Single match, no pair — pass through as-is
      const played = m.home_score !== null && m.away_score !== null;
      ties.push({
        id: m.id,
        ids: [m.id],
        team1: m.home_team,
        team2: m.away_team,
        leg1: m,
        leg2: null,
        agg1: played ? m.home_score : null,
        agg2: played ? m.away_score : null,
        played,
        forfeited_by: m.forfeited_by,
      });
    } else {
      // Two-leg tie found
      const n = stageMatches[pairIdx];
      used.add(m.id);
      used.add(n.id);

      // Determine chronological order (earlier = leg 1)
      const mDate = m.played_at || "";
      const nDate = n.played_at || "";
      const [first, second] = mDate <= nDate ? [m, n] : [n, m];

      // team1 = home team in leg 1
      const team1 = first.home_team;
      const team2 = first.away_team;

      const leg1Played = first.home_score !== null && first.away_score !== null;
      const leg2Played = second.home_score !== null && second.away_score !== null;
      const bothPlayed = leg1Played && leg2Played;
      const anyPlayed = leg1Played || leg2Played;

      // Aggregate: team1's goals across played legs
      let agg1: number | null = null;
      let agg2: number | null = null;
      if (anyPlayed) {
        agg1 = 0;
        agg2 = 0;
        if (leg1Played) {
          agg1 += first.home_score;
          agg2 += first.away_score;
        }
        if (leg2Played) {
          agg1 += second.home_team === team1 ? second.home_score : second.away_score;
          agg2 += second.home_team === team1 ? second.away_score : second.home_score;
        }
      }

      ties.push({
        id: first.id,
        ids: [first.id, second.id],
        team1,
        team2,
        leg1: first,
        leg2: second,
        agg1,
        agg2,
        played: anyPlayed,
        forfeited_by: null,
      });
    }
  }

  return ties;
}

async function getLeagueStats(playedMatchIds: string[], playedMatches: any[], teamIdMap: Record<string, string>) {
  if (!playedMatchIds.length) return { players: [] as PlayerStat[], teams: [] as TeamStat[] };

  const { data: statsData } = await supabase
    .from("match_player_stats")
    .select("player_id,goals,assists,key_passes,passes,shots_on_target,tackles,key_tackles,interceptions,key_interceptions,possessions_lost,gk_saves,gk_catches,benched,players(id,name,handle)")
    .in("match_id", playedMatchIds)
    .limit(5000);

  const byPlayer: Record<string, PlayerStat> = {};
  for (const s of statsData ?? []) {
    if (s.benched) continue;
    if (!byPlayer[s.player_id]) {
      const p = Array.isArray(s.players) ? s.players[0] : s.players;
      byPlayer[s.player_id] = {
        playerId: s.player_id,
        name: p?.name || p?.handle || s.player_id.slice(0, 8),
        games: 0, goals: 0, assists: 0, key_passes: 0, passes: 0,
        shots_on_target: 0, tackles: 0, key_tackles: 0,
        interceptions: 0, key_interceptions: 0, possessions_lost: 0,
        gk_saves: 0, gk_catches: 0,
      };
    }
    const r = byPlayer[s.player_id];
    r.games++;
    r.goals += s.goals || 0;
    r.assists += s.assists || 0;
    r.key_passes += s.key_passes || 0;
    r.passes += s.passes || 0;
    r.shots_on_target += s.shots_on_target || 0;
    r.tackles += s.tackles || 0;
    r.key_tackles += s.key_tackles || 0;
    r.interceptions += s.interceptions || 0;
    r.key_interceptions += s.key_interceptions || 0;
    r.possessions_lost += s.possessions_lost || 0;
    r.gk_saves += s.gk_saves || 0;
    r.gk_catches += s.gk_catches || 0;
  }

  const teamMap: Record<string, TeamStat> = {};
  for (const m of playedMatches) {
    for (const [side, opp] of [["home", "away"], ["away", "home"]] as const) {
      const name = m[`${side}_team`];
      const scored = m[`${side}_score`];
      const conceded = m[`${opp}_score`];
      if (!teamMap[name]) teamMap[name] = { name, teamId: teamIdMap[name] ?? null, games: 0, gf: 0, ga: 0, cs: 0 };
      teamMap[name].games++;
      teamMap[name].gf += scored;
      teamMap[name].ga += conceded;
      if (conceded === 0) teamMap[name].cs++;
    }
  }

  return {
    players: Object.values(byPlayer),
    teams: Object.values(teamMap).sort((a, b) => b.gf - a.gf),
  };
}

export const revalidate = 60;

export default async function LeagueDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ tab?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const activeTab = sp?.tab === "stats" ? "stats" : "overview";
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
  // Merge two-leg ties into single entries with aggregate scores
  const rawBracketByStage: Record<string, any[]> = {};
  for (const m of matches.filter((m: any) => !m.group_name)) {
    const stage = m.stage || "Knockout";
    if (!rawBracketByStage[stage]) rawBracketByStage[stage] = [];
    rawBracketByStage[stage].push(m);
  }
  const bracketByStage: Record<string, MergedTie[]> = {};
  for (const [stage, stageMatches] of Object.entries(rawBracketByStage)) {
    bracketByStage[stage] = mergeKnockoutLegs(stageMatches);
  }
  // Sort stages: earliest (most matches) first → final last
  const bracketStages = Object.keys(bracketByStage).sort((a, b) => knockoutStageRank(b) - knockoutStageRank(a));
  const bracketThirdStage = bracketStages.find(s => s.toLowerCase().includes("third"));
  const mainBracketStages = bracketStages.filter(s => !s.toLowerCase().includes("third"));

  const playedMatches = matches.filter((m: any) => m.home_score !== null);
  const upcomingMatches = matches.filter((m: any) => m.home_score === null).reverse().slice(0, 5);
  const logo = getLeagueLogo(league.image);

  const leagueStats = activeTab === "stats"
    ? await getLeagueStats(playedMatches.map((m: any) => m.id), playedMatches, teamIdMap)
    : null;
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

  function KnockoutBracket({ stages, byStage }: { stages: string[]; byStage: Record<string, MergedTie[]> }) {
    if (stages.length === 0) return null;

    const BASE = 96;        // base slot height (px) for the earliest round
    const CW   = 28;        // connector column width (px)
    const MW   = 190;       // match card width (px)
    const AC   = "#a78bfa"; // accent colour

    // Third place is displayed separately below the main bracket
    const thirdStage = stages.find(s => s.toLowerCase().includes("third"));
    const main = stages.filter(s => !s.toLowerCase().includes("third"));

    function BracketCard({ tie }: { tie: MergedTie }) {
      const isTwoLeg = tie.leg2 !== null;
      const leg1Played = tie.leg1 !== null && tie.leg1.home_score !== null && tie.leg1.away_score !== null;
      const leg2Played = tie.leg2 !== null && tie.leg2.home_score !== null && tie.leg2.away_score !== null;
      const bothPlayed = isTwoLeg && leg1Played && leg2Played;
      // Only highlight winner when all legs are complete (or single-leg tie)
      const isComplete = isTwoLeg ? bothPlayed : tie.played;
      const t1Win = isComplete && tie.agg1 !== null && tie.agg2 !== null && tie.agg1 > tie.agg2;
      const t2Win = isComplete && tie.agg1 !== null && tie.agg2 !== null && tie.agg2 > tie.agg1;

      const rows = [
        { team: tie.team1, agg: tie.agg1, win: t1Win },
        { team: tie.team2, agg: tie.agg2, win: t2Win },
      ];

      // Build leg score labels for two-leg ties
      let legLabel: string | null = null;
      if (isTwoLeg && tie.leg1 && tie.leg2) {
        const parts: string[] = [];
        if (leg1Played) parts.push(`${tie.leg1.home_score}-${tie.leg1.away_score}`);
        if (leg2Played) parts.push(`${tie.leg2.home_score}-${tie.leg2.away_score}`);
        if (parts.length > 0) {
          const legsText = bothPlayed ? parts.join(", ") : `${parts[0]} (Leg 2 TBD)`;
          legLabel = legsText;
        }
      }

      const cardContent = (
        <div style={{ background: "var(--bg-card)", border: "1px solid var(--border-main)", width: MW, overflow: "hidden" }}>
          {rows.map((row, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "5px 9px", background: tie.played && row.win ? "rgba(74,222,128,0.08)" : "transparent", borderBottom: i === 0 ? "1px solid var(--border-row)" : "none" }}>
              <span style={{ fontSize: 12, fontWeight: tie.played && row.win ? 700 : 400, color: tie.played && row.win ? "var(--text-body)" : "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: MW - 50 }}>
                {row.team || "TBD"}
              </span>
              <span style={{ fontSize: 13, fontWeight: 900, color: tie.played && row.win ? AC : "var(--text-faint)", flexShrink: 0, minWidth: 16, textAlign: "right" as const, fontVariantNumeric: "tabular-nums" }}>
                {tie.played && row.agg !== null ? row.agg : ""}
              </span>
            </div>
          ))}
          {isTwoLeg && legLabel && (
            <div style={{ padding: "2px 9px 3px", fontSize: 9, color: "var(--text-faint)", letterSpacing: "0.04em", borderTop: "1px solid var(--border-row)" }}>
              Legs: {legLabel}
            </div>
          )}
        </div>
      );

      return (
        <Link href={`/matches/${tie.ids[0]}`} style={{ display: "block", textDecoration: "none" }} className="nav-card">
          {cardContent}
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
                    {colMatches.map((tie: MergedTie) => (
                      <div key={tie.id} style={{ height: slotH, display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <BracketCard tie={tie} />
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
            {byStage[thirdStage].map((tie: MergedTie) => {
              if (tie.leg1) return <MatchRow key={tie.id} match={tie.leg1} />;
              return null;
            })}
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

      <LeagueTabBar activeTab={activeTab} />

      {activeTab === "stats" && leagueStats && (
        <LeagueStatsClient
          playerStats={leagueStats.players}
          teamStats={leagueStats.teams}
          teamIdMap={teamIdMap}
        />
      )}

      {activeTab === "overview" && <div style={{ maxWidth: 1200, margin: "0 auto", padding: "32px 24px", display: "grid", gridTemplateColumns: "1fr 300px", gap: 2 }}>
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
      </div>}
    </main>
  );
}
