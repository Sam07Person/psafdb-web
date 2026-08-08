"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import Link from "next/link";
import { calcMatchBreakdown, isRatingEligibleScore, type MatchStatRow, type MatchResult } from "@/lib/ratings";
import { useLanguage } from "@/components/LanguageProvider";

// ── Types ────────────────────────────────────────────────────────────────────

type Zone = { name: string; color: string; spots: number; type: "top" | "bottom" };

type League = {
  id: string;
  name: string;
  season: string | null;
  format: string | null;
  ended: boolean | null;
  zones: Zone[] | null;
  tier: number | null;
};

type Match = {
  id: string;
  home_team: string;
  away_team: string;
  home_score: number | null;
  away_score: number | null;
  played_at: string;
  league_id: string | null;
  day: number | null;
  forfeited_by: string | null;
  stage: string | null;
};

type StatRow = {
  match_id: string;
  player_id: string;
  team_side: "home" | "away";
  position: string | null;
  goals: number;
  assists: number;
  score: number;
  passes: number;
  key_passes: number;
  shots_on_target: number;
  tackles: number;
  key_tackles: number;
  interceptions: number;
  key_interceptions: number;
  possessions_lost: number;
  gk_saves: number;
  gk_catches: number;
  benched: boolean;
  stats_incomplete: boolean;
  // `id` is not selected — pName() only reads name/handle, and the column was
  // pure egress cost across every stat row.
  players: { handle: string | null; name: string | null } | null;
};

type TeamRow = { id: string; name: string; no_elo: boolean | null };

type StandingRow = {
  team: string; played: number; won: number; drawn: number; lost: number;
  gf: number; ga: number; points: number;
};

type NewsItem = {
  id: string;
  type: string;
  date: string;
  title: string;
  body: string;
  accent: string;
  icon: string;
  tag: string;
  leagueId?: string;
  leagueName?: string;
  matchId?: string;
  meta?: Record<string, unknown>;
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function ordinal(n: number): string {
  if (n >= 11 && n <= 13) return "th";
  switch (n % 10) {
    case 1: return "st";
    case 2: return "nd";
    case 3: return "rd";
    default: return "th";
  }
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function pName(s: StatRow): string {
  return s.players?.name ?? s.players?.handle ?? "Unknown";
}

// ── Standings ────────────────────────────────────────────────────────────────

function applyMatchToStandings(s: Record<string, StandingRow>, m: Match) {
  if (m.home_score === null || m.away_score === null) return;
  const ensure = (name: string) => {
    if (!s[name]) s[name] = { team: name, played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, points: 0 };
  };
  ensure(m.home_team); ensure(m.away_team);
  const h = s[m.home_team], a = s[m.away_team];
  h.played++; h.gf += m.home_score; h.ga += m.away_score;
  a.played++; a.gf += m.away_score; a.ga += m.home_score;
  if (m.home_score > m.away_score) { h.won++; h.points += 3; a.lost++; }
  else if (m.away_score > m.home_score) { a.won++; a.points += 3; h.lost++; }
  else { h.drawn++; h.points += 1; a.drawn++; a.points += 1; }
  if (m.forfeited_by === "home") h.points = Math.max(0, h.points - 1);
  else if (m.forfeited_by === "away") a.points = Math.max(0, a.points - 1);
}

function sortStandings(s: Record<string, StandingRow>): StandingRow[] {
  return Object.values(s).sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    const gdB = b.gf - b.ga, gdA = a.gf - a.ga;
    if (gdB !== gdA) return gdB - gdA;
    return b.gf - a.gf;
  });
}

function snapshotStandings(rows: StandingRow[]): Map<string, number> {
  const m = new Map<string, number>();
  rows.forEach((r, i) => m.set(r.team, i));
  return m;
}

// ── ELO ──────────────────────────────────────────────────────────────────────

const DEFAULT_ELO = 1000;
const K_BASE = 32;

function gdMult(gd: number): number {
  if (gd <= 1) return 1.0;
  if (gd === 2) return 1.5;
  return 1.75 + (gd - 3) * 0.05;
}

function tierMult(tier: number | null): number {
  if (tier === 1) return 1.2;
  if (tier === 3) return 0.8;
  return 1.0;
}

function expScore(rA: number, rB: number): number {
  return 1 / (1 + Math.pow(10, (rB - rA) / 400));
}

// ── TOTW ─────────────────────────────────────────────────────────────────────

type SlotKey = "GK" | "LB" | "RB" | "CM" | "LW" | "RW";

const SLOT_POOLS: Record<SlotKey, string[]> = {
  GK: ["GK"],
  LB: ["LB", "LWB", "LCB"],
  RB: ["RB", "RWB", "RCB"],
  CM: ["CM", "LM", "RM", "CF", "ST", "CB"],
  LW: ["LW", "LF"],
  RW: ["RW", "RF"],
};

const SLOT_ORDER: SlotKey[] = ["GK", "LW", "RW", "LB", "RB", "CM"];

type TOTWEntry = { slot: SlotKey; playerId: string; name: string; rating: number };

function computeTOTW(dayStats: StatRow[], matchById: Map<string, Match>): TOTWEntry[] {
  const eligible = dayStats
    .filter(s => !s.benched && !s.stats_incomplete && s.position && s.players
      && isRatingEligibleScore(s.score))
    .map(s => {
      const m = matchById.get(s.match_id);
      if (!m || m.home_score === null || m.away_score === null) return null;
      const isHome = s.team_side === "home";
      const gc = isHome ? m.away_score : m.home_score;
      const myScore = isHome ? m.home_score : m.away_score;
      const oppScore = isHome ? m.away_score : m.home_score;
      const result: MatchResult = myScore > oppScore ? "W" : myScore < oppScore ? "L" : "D";
      const statRow: MatchStatRow = {
        goals: s.goals ?? 0, assists: s.assists ?? 0, key_passes: s.key_passes ?? 0,
        shots_on_target: s.shots_on_target ?? 0, passes: s.passes ?? 0,
        tackles: s.tackles ?? 0, key_tackles: s.key_tackles ?? 0,
        interceptions: s.interceptions ?? 0, key_interceptions: s.key_interceptions ?? 0,
        possessions_lost: s.possessions_lost ?? 0, gk_saves: s.gk_saves ?? 0,
        gk_catches: s.gk_catches ?? 0, goals_conceded: gc,
        score: s.score ?? 0, position: s.position,
      };
      return { s, rating: calcMatchBreakdown(statRow, result, s.position!).final };
    })
    .filter((x): x is { s: StatRow; rating: number } => x !== null);

  eligible.sort((a, b) => b.rating - a.rating);

  const result: TOTWEntry[] = [];
  const used = new Set<string>();

  for (const slotKey of SLOT_ORDER) {
    const pool = SLOT_POOLS[slotKey];
    for (const { s, rating } of eligible) {
      const pos = s.position?.toUpperCase().trim() ?? "";
      if (!pool.includes(pos)) continue;
      if (used.has(s.player_id)) continue;
      result.push({ slot: slotKey, playerId: s.player_id, name: pName(s), rating });
      used.add(s.player_id);
      break;
    }
  }
  return result;
}

// ── News generation ───────────────────────────────────────────────────────────

function generateNews(
  leagues: League[],
  matches: Match[],
  stats: StatRow[],
  teams: TeamRow[],
): NewsItem[] {
  const items: NewsItem[] = [];

  const matchById = new Map<string, Match>(matches.map(m => [m.id, m]));
  const leagueById = new Map<string, League>(leagues.map(l => [l.id, l]));
  const noEloTeams = new Set<string>(teams.filter(t => t.no_elo).map(t => t.name));
  const tierMap = new Map<string, number | null>(leagues.map(l => [l.id, l.tier]));

  const matchesByLeague = new Map<string, Match[]>();
  for (const m of matches) {
    if (!m.league_id) continue;
    if (!matchesByLeague.has(m.league_id)) matchesByLeague.set(m.league_id, []);
    matchesByLeague.get(m.league_id)!.push(m);
  }

  const statsByMatch = new Map<string, StatRow[]>();
  for (const s of stats) {
    if (!statsByMatch.has(s.match_id)) statsByMatch.set(s.match_id, []);
    statsByMatch.get(s.match_id)!.push(s);
  }

  // ── 1. League Winner & Relegation ─────────────────────────────────────────
  for (const league of leagues) {
    if (!league.ended || league.format !== "league") continue;
    const leagueMatches = (matchesByLeague.get(league.id) ?? [])
      .filter(m => m.home_score !== null && m.away_score !== null);
    if (leagueMatches.length === 0) continue;

    const s: Record<string, StandingRow> = {};
    for (const m of leagueMatches) applyMatchToStandings(s, m);
    const standings = sortStandings(s);
    if (standings.length === 0) continue;

    const lastDate = [...leagueMatches].sort((a, b) => b.played_at.localeCompare(a.played_at))[0].played_at;
    const suffix = league.season ? ` (Season ${league.season})` : "";
    const winner = standings[0];

    items.push({
      id: `league_winner_${league.id}`,
      type: "league_winner",
      date: lastDate,
      title: `${winner.team} are ${league.name} Champions`,
      body: `${winner.team} have been crowned champions of ${league.name}${suffix}, finishing with ${winner.points} points from ${winner.played} matches — ${winner.won}W ${winner.drawn}D ${winner.lost}L.`,
      accent: "#f4c430",
      icon: "🏆",
      tag: "League Winner",
      leagueId: league.id,
      leagueName: league.name,
    });

    // Relegation zones
    const bottomZones = (league.zones ?? []).filter(z => z.type === "bottom");
    const totalBottom = bottomZones.reduce((sum, z) => sum + z.spots, 0);
    if (totalBottom > 0 && standings.length > totalBottom) {
      const relegated = standings.slice(standings.length - totalBottom).map(r => r.team);
      items.push({
        id: `league_relegation_${league.id}`,
        type: "league_relegation",
        date: lastDate,
        title: `${league.name} Relegation Confirmed`,
        body: `${relegated.join(", ")} ${relegated.length === 1 ? "has" : "have"} been relegated from ${league.name}${suffix} after a difficult season.`,
        accent: "#e63946",
        icon: "📉",
        tag: "Relegation",
        leagueId: league.id,
        leagueName: league.name,
      });
    }
  }

  // ── 1b. Knockout / Group-Knockout Winner ─────────────────────────────────
  for (const league of leagues) {
    if (!league.ended) continue;
    if (league.format !== "knockout" && league.format !== "group_knockout") continue;
    const leagueMatches = (matchesByLeague.get(league.id) ?? [])
      .filter(m => m.home_score !== null && m.away_score !== null);
    if (leagueMatches.length === 0) continue;

    // Find the Final match — accept "Final", "final", "F", and reject anything containing "semi"/"third"/"quarter"
    const finals = leagueMatches.filter(m => {
      const s = (m.stage ?? "").toLowerCase().trim();
      if (!s) return false;
      if (s.includes("semi") || s.includes("third") || s.includes("quarter") || s.includes("round of")) return false;
      return s === "final" || s === "f" || s.endsWith(" final") || s === "finals";
    });
    if (finals.length === 0) continue;

    // If multiple legs, pick the latest played
    const final = [...finals].sort((a, b) => b.played_at.localeCompare(a.played_at))[0];
    if (final.home_score === final.away_score) continue; // can't determine without tiebreaker info

    const winner = final.home_score! > final.away_score! ? final.home_team : final.away_team;
    const runnerUp = final.home_score! > final.away_score! ? final.away_team : final.home_team;
    const score = `${final.home_score}–${final.away_score}`;
    const suffix = league.season ? ` (Season ${league.season})` : "";

    items.push({
      id: `knockout_winner_${league.id}`,
      type: "league_winner",
      date: final.played_at,
      title: `${winner} Crowned ${league.name} Champions`,
      body: `${winner} have won ${league.name}${suffix}, defeating ${runnerUp} ${score} in the Final to lift the trophy.`,
      accent: "#f4c430",
      icon: "🏆",
      tag: "Tournament Winner",
      leagueId: league.id,
      leagueName: league.name,
      matchId: final.id,
    });
  }

  // ── 2. Hattricks ─────────────────────────────────────────────────────────
  const hattricksByMatch = new Map<string, Array<{ stat: StatRow; myScore: number; oppScore: number }>>();
  for (const s of stats) {
    if (!s.goals || s.goals < 3 || s.benched) continue;
    const m = matchById.get(s.match_id);
    if (!m || m.home_score === null || m.away_score === null) continue;
    const isHome = s.team_side === "home";
    const myScore = isHome ? m.home_score : m.away_score;
    const oppScore = isHome ? m.away_score : m.home_score;
    if (!hattricksByMatch.has(s.match_id)) hattricksByMatch.set(s.match_id, []);
    hattricksByMatch.get(s.match_id)!.push({ stat: s, myScore, oppScore });
  }

  for (const [matchId, hattricks] of hattricksByMatch) {
    const m = matchById.get(matchId)!;
    const league = m.league_id ? leagueById.get(m.league_id) : null;
    const score = `${m.home_score}–${m.away_score}`;

    if (hattricks.length >= 2) {
      // Multiple hattrick scorers
      const names = hattricks.map(h => `${pName(h.stat)} (${h.stat.goals} goals)`).join(" and ");
      const sameTeam = hattricks.every(h => h.stat.team_side === hattricks[0].stat.team_side);
      const winners = hattricks.filter(h => h.myScore > h.oppScore);

      let body: string;
      if (sameTeam) {
        body = `An extraordinary attacking display saw ${names} both bag hattricks for ${hattricks[0].stat.team_side === "home" ? m.home_team : m.away_team} in a ${score} ${winners.length > 0 ? "win" : hattricks[0].myScore === hattricks[0].oppScore ? "draw" : "defeat"}.`;
      } else {
        body = `An incredible match saw ${names} score hattricks for opposing sides in a ${score} result between ${m.home_team} and ${m.away_team}.`;
      }

      items.push({
        id: `hattrick_multi_${matchId}`,
        type: "hattrick_multi",
        date: m.played_at,
        title: `${hattricks.length === 2 ? "Double" : "Multiple"} Hattrick — ${m.home_team} ${score} ${m.away_team}`,
        body,
        accent: "#a78bfa",
        icon: "⚽",
        tag: "Double Hattrick",
        leagueId: league?.id,
        leagueName: league?.name,
        matchId,
      });
    } else {
      const { stat: s, myScore, oppScore } = hattricks[0];
      const myTeam = s.team_side === "home" ? m.home_team : m.away_team;
      const margin = myScore - oppScore;

      let title: string, body: string, accent: string, icon: string, tag: string;

      if (margin === 1) {
        title = `${pName(s)}'s Crucial Hattrick Seals Narrow Victory for ${myTeam}`;
        body = `${pName(s)} delivered when it mattered most, scoring ${s.goals} goals as ${myTeam} edged out a tense ${m.home_team} ${score} ${m.away_team} result. With only a one-goal margin, every strike was decisive.`;
        accent = "#f4c430"; icon = "⭐"; tag = "Crucial Hattrick";
      } else if (margin === -1) {
        title = `${pName(s)}'s Hattrick Not Enough — ${myTeam} Fall Short`;
        body = `Despite ${pName(s)} producing a stunning ${s.goals}-goal haul, ${myTeam} couldn't quite get over the line, falling to a narrow ${m.home_team} ${score} ${m.away_team} defeat. A heartbreaking effort that deserved more.`;
        accent = "#e63946"; icon = "💔"; tag = "Hattrick — Narrow Loss";
      } else if (margin > 0) {
        title = `${pName(s)} Bags a Hattrick in ${myTeam}'s Win`;
        body = `${pName(s)} was in devastating form, scoring ${s.goals} goals as ${myTeam} ran out winners ${m.home_team} ${score} ${m.away_team}. A dominant individual display.`;
        accent = "#4ade80"; icon = "⚽"; tag = "Hattrick";
      } else if (margin === 0) {
        title = `${pName(s)}'s Hattrick Not Enough to Win as ${myTeam} Draw`;
        body = `${pName(s)} scored ${s.goals} goals but ${myTeam} couldn't find a winner — it ended all square ${m.home_team} ${score} ${m.away_team}. A standout display in a hard-fought draw.`;
        accent = "#f97316"; icon = "⚽"; tag = "Hattrick";
      } else {
        title = `${pName(s)}'s Hattrick in Vain as ${myTeam} Lose`;
        body = `${pName(s)} scored ${s.goals} goals but it wasn't enough — ${myTeam} were beaten ${m.home_team} ${score} ${m.away_team}. Another impressive effort in a losing cause.`;
        accent = "#f97316"; icon = "⚽"; tag = "Hattrick";
      }

      items.push({
        id: `hattrick_${matchId}_${s.player_id}`,
        type: "hattrick",
        date: m.played_at,
        title, body, accent, icon, tag,
        leagueId: league?.id,
        leagueName: league?.name,
        matchId,
      });
    }
  }

  // ── 3. Match result stories ───────────────────────────────────────────────
  // Deterministic "random" pick from an array based on match id hash
  function pick<T>(arr: T[], seed: string): T {
    let h = 0;
    for (let i = 0; i < seed.length; i++) h = ((h << 5) - h + seed.charCodeAt(i)) | 0;
    return arr[Math.abs(h) % arr.length];
  }

  for (const m of matches) {
    if (m.home_score === null || m.away_score === null) continue;
    const totalGoals = m.home_score + m.away_score;
    const diff = m.home_score - m.away_score;
    const isDraw = diff === 0;
    const homeWin = diff > 0;
    const winner = homeWin ? m.home_team : m.away_team;
    const loser = homeWin ? m.away_team : m.home_team;
    const winnerScore = homeWin ? m.home_score : m.away_score;
    const loserScore = homeWin ? m.away_score : m.home_score;
    const absDiff = Math.abs(diff);
    const score = `${m.home_score}–${m.away_score}`;
    const league = m.league_id ? leagueById.get(m.league_id) : null;
    const isForfeited = !!m.forfeited_by;
    const isCleanSheet = !isDraw && loserScore === 0;
    const isNarrow = !isDraw && absDiff === 1;

    let title: string | null = null, body: string | null = null, tag: string | null = null;
    let accent = "var(--text-faint)", icon = "⚽", type = "clean_sheet";

    // ── Forfeits ──
    if (isForfeited) {
      title = pick([
        `${loser} Forfeit — ${winner} Awarded ${score} Win`,
        `Walkover for ${winner} as ${loser} Fail to Show`,
        `${loser} No-Show — ${winner} Take the Points`,
      ], m.id);
      body = pick([
        `${loser} failed to fulfil the fixture and the match was awarded to ${winner} by forfeit, resulting in a ${score} scoreline.`,
        `${winner} received a walkover victory after ${loser} were unable to field a team. The result goes down as ${score}.`,
        `No contest required — ${loser} forfeited and ${winner} pick up a ${score} win without kicking a ball.`,
      ], m.id);
      tag = "Forfeit"; accent = "#ef4444"; icon = "🚫"; type = "forfeit";
    }
    // ── 0-0 draws ──
    else if (isDraw && totalGoals === 0) {
      title = pick([
        `${m.home_team} and ${m.away_team} Share Goalless Stalemate`,
        `Defences on Top as ${m.home_team} and ${m.away_team} Draw 0-0`,
        `Blank at Both Ends — ${m.home_team} 0-0 ${m.away_team}`,
        `Neither Side Can Break the Deadlock — ${m.home_team} 0-0 ${m.away_team}`,
      ], m.id);
      body = pick([
        `A disciplined defensive showing from both sides meant neither ${m.home_team} nor ${m.away_team} could find the net. Honours even.`,
        `Goalkeepers and centre-backs dominated proceedings as ${m.home_team} and ${m.away_team} cancelled each other out in a tense goalless encounter.`,
        `Despite their best efforts, neither ${m.home_team} nor ${m.away_team} could find a breakthrough in a match where defensive organisation reigned supreme.`,
      ], m.id);
      tag = "Goalless Draw"; accent = "#64748b"; icon = "🤝"; type = "goalless_draw";
    }
    // ── High-scoring draws (4+ total) ──
    else if (isDraw && totalGoals >= 4) {
      title = pick([
        `Thriller Ends All Square — ${m.home_team} ${score} ${m.away_team}`,
        `${m.home_team} and ${m.away_team} Serve Up ${totalGoals}-Goal Classic`,
        `Incredible ${score} Draw Between ${m.home_team} and ${m.away_team}`,
        `No Winner in ${totalGoals}-Goal Spectacular — ${m.home_team} ${score} ${m.away_team}`,
      ], m.id);
      body = pick([
        `A breathtaking end-to-end encounter produced ${totalGoals} goals but no winner as ${m.home_team} and ${m.away_team} shared the spoils in a ${score} thriller.`,
        `${m.home_team} and ${m.away_team} traded blows in a pulsating ${score} draw packed with ${totalGoals} goals and drama from start to finish.`,
        `Neither side could hold on for the win in an extraordinary ${score} draw. ${totalGoals} goals, endless entertainment, but ultimately a point each.`,
      ], m.id);
      tag = "Goal Fest Draw"; accent = "#f59e0b"; icon = "🎭"; type = "high_draw";
    }
    // ── Thrashings (5+ goal difference) ──
    else if (!isDraw && absDiff >= 5) {
      title = pick([
        `${winner} Demolish ${loser} in ${score} Rout`,
        `Humiliation for ${loser} as ${winner} Run Riot — ${score}`,
        `${winner} Put ${loser} to the Sword in ${score} Hammering`,
        `${winnerScore}-Goal ${winner} Dismantle Helpless ${loser}`,
      ], m.id);
      body = pick([
        `A complete demolition job saw ${winner} destroy ${loser} with a commanding ${score} victory. The ${absDiff}-goal margin tells the full story of a thoroughly one-sided affair.`,
        `${loser} had no answer as ${winner} turned on the style in devastating fashion, running out ${score} winners in a match that was over long before the final whistle.`,
        `${winner} were simply ruthless, tearing ${loser} apart with ${winnerScore} goals in a performance that sent a message to the rest of the league.`,
      ], m.id);
      tag = "Thrashing"; accent = "#dc2626"; icon = "💥"; type = "thrashing";
    }
    // ── Comprehensive win (3-4 goal difference) ──
    else if (!isDraw && absDiff >= 3 && absDiff < 5) {
      title = pick([
        `${winner} Cruise Past ${loser} — ${score}`,
        `Comfortable ${score} Win for ${winner} Over ${loser}`,
        `${winner} Dispatch ${loser} with Ease — ${score}`,
        `${winner} Make Light Work of ${loser} in ${score} Victory`,
      ], m.id);
      body = pick([
        `${winner} were in control throughout, recording a convincing ${score} win over ${loser} in a thoroughly professional display.`,
        `A clinical performance from ${winner} saw them ease past ${loser} with a ${score} victory that was never really in doubt.`,
        `${loser} were outclassed as ${winner} took all three points in a dominant ${score} display from start to finish.`,
      ], m.id);
      tag = "Comprehensive Win"; accent = "#4ade80"; icon = "✅"; type = "comprehensive";
    }
    // ── Goal fest wins (7+ total goals) ──
    else if (!isDraw && totalGoals >= 7) {
      title = pick([
        `${totalGoals} Goals! ${winner} Prevail in ${score} Goal Fest`,
        `${winner} Win Wild ${score} Encounter Against ${loser}`,
        `Mayhem as ${winner} Edge ${loser} in ${totalGoals}-Goal Thriller`,
      ], m.id);
      body = pick([
        `A chaotic match produced ${totalGoals} goals as ${winner} emerged victorious in a ${score} classic against ${loser}. Entertainment was guaranteed — defending was optional.`,
        `Both defences were nowhere to be seen as ${winner} and ${loser} served up a ${totalGoals}-goal thriller. ${winner} took the spoils with a ${score} win.`,
        `In a game that had everything, ${winner} and ${loser} combined for ${totalGoals} goals in an unbelievable ${score} result.`,
      ], m.id);
      tag = "Goal Fest"; accent = "#f59e0b"; icon = "🎆"; type = "goal_fest";
    }
    // ── 1-0 clean sheet ──
    else if (isCleanSheet && isNarrow) {
      title = pick([
        `${winner} Edge Out ${loser} 1-0 — Clean Sheet and All Three Points`,
        `Solitary Goal Enough as ${winner} Beat ${loser} 1-0`,
        `${winner} Grind Out 1-0 Win Over ${loser}`,
        `One Moment of Quality Separates ${winner} and ${loser}`,
      ], m.id);
      body = pick([
        `${winner} kept it tight and clinical, shutting out ${loser} with a 1-0 win. A disciplined defensive performance combined with a single decisive goal took all three points.`,
        `It was the fine margins that decided this one — ${winner} found the only goal and made it count, holding ${loser} at bay for a hard-earned 1-0 victory.`,
        `${winner} proved that sometimes one goal is all you need, keeping a clean sheet and edging past ${loser} in a tightly contested 1-0 win.`,
      ], m.id);
      tag = "1-0 Clean Sheet"; accent = "#22d3ee"; icon = "🛡️";
    }
    // ── Clean sheet (2-0, 3-0, 4-0) ──
    else if (isCleanSheet) {
      title = pick([
        `${winner} Blank ${loser} ${winnerScore}-0 — Dominant Clean Sheet`,
        `Shutout for ${winner} as ${loser} Draw Blank in ${score} Defeat`,
        `${winner} Keep Clean Sheet in Comfortable ${score} Win`,
        `Not a Sniff for ${loser} as ${winner} Win ${score}`,
      ], m.id);
      body = pick([
        `${winner} kept a clean sheet in a convincing ${score} victory over ${loser}, conceding nothing while scoring ${winnerScore} at the other end.`,
        `${loser} couldn't find a way through as ${winner} locked the door and strolled to a ${score} victory with a clean sheet to boot.`,
        `A defensive masterclass from ${winner} meant ${loser} went home with nothing — not even a goal to show for their efforts in a ${score} loss.`,
      ], m.id);
      tag = "Clean Sheet"; accent = "#22d3ee"; icon = "🛡️";
    }
    // ── Narrow win ──
    else if (isNarrow) {
      title = pick([
        `${winner} Edge Out ${loser} in a Narrow ${score} Win`,
        `${winner} Hold On for ${score} Victory Over ${loser}`,
        `Tight Affair Settled as ${winner} Beat ${loser} ${score}`,
        `${winner} Scrape Past ${loser} — ${score}`,
      ], m.id);
      body = pick([
        `${winner} held on to claim all three points in a tight ${score} contest against ${loser} — just a single goal separating the sides at the final whistle.`,
        `It went down to the wire but ${winner} did just enough to see off ${loser} in a nervy ${score} encounter where the margins were razor-thin.`,
        `A one-goal cushion was all ${winner} needed as they ground out a ${score} result against a determined ${loser} side.`,
      ], m.id);
      tag = "Narrow Win"; accent = "#a78bfa"; icon = "⚔️"; type = "narrow_win";
    }

    if (title && body && tag) {
      items.push({
        id: `result_${m.id}`,
        type,
        date: m.played_at,
        title, body,
        accent,
        icon,
        tag,
        leagueId: league?.id,
        leagueName: league?.name,
        matchId: m.id,
      });
    }
  }

  // ── 3b. Individual performance stories ──────────────────────────────────
  for (const m of matches) {
    if (m.home_score === null || m.away_score === null) continue;
    if (m.forfeited_by) continue;
    const mStats = statsByMatch.get(m.id) ?? [];
    const league = m.league_id ? leagueById.get(m.league_id) : null;
    const score = `${m.home_score}–${m.away_score}`;

    for (const s of mStats) {
      if (s.benched || s.stats_incomplete) continue;
      const myTeam = s.team_side === "home" ? m.home_team : m.away_team;

      // ── Brace (exactly 2 goals) ──
      if (s.goals === 2) {
        const title = pick([
          `${pName(s)} Scores a Brace as ${myTeam} Feature in ${score} Result`,
          `Two-Goal ${pName(s)} Stars for ${myTeam}`,
          `${pName(s)} at the Double for ${myTeam} in ${score} Match`,
        ], m.id + s.player_id);
        const body = pick([
          `${pName(s)} found the net twice for ${myTeam} in the ${score} result against ${myTeam === m.home_team ? m.away_team : m.home_team}. A clinical two-goal contribution.`,
          `A two-goal display from ${pName(s)} was a highlight as ${myTeam} played out a ${score} match. The striker's finishing was on point.`,
          `${pName(s)} grabbed a brace, netting two goals in ${myTeam}'s ${score} game. A performance to remember.`,
        ], m.id + s.player_id);
        items.push({
          id: `brace_${m.id}_${s.player_id}`,
          type: "brace",
          date: m.played_at,
          title, body,
          accent: "#86efac",
          icon: "⚽",
          tag: "Brace",
          leagueId: league?.id,
          leagueName: league?.name,
          matchId: m.id,
        });
      }

      // ── Assist king (3+ assists in one match) ──
      if ((s.assists ?? 0) >= 3) {
        const title = pick([
          `${pName(s)} Provides ${s.assists} Assists in One Game`,
          `Playmaker ${pName(s)} Sets Up ${s.assists} Goals for ${myTeam}`,
          `${pName(s)}'s ${s.assists}-Assist Masterclass for ${myTeam}`,
        ], m.id + s.player_id + "a");
        const body = pick([
          `${pName(s)} was the creative force behind ${myTeam}'s attack, providing ${s.assists} assists in the ${score} result. A sensational passing display.`,
          `Vision, timing, precision — ${pName(s)} had it all, threading ${s.assists} assists for ${myTeam} in a ${score} game.`,
          `${pName(s)} turned provider with ${s.assists} assists, pulling the strings for ${myTeam} in their ${score} fixture.`,
        ], m.id + s.player_id + "a");
        items.push({
          id: `assist_king_${m.id}_${s.player_id}`,
          type: "assist_king",
          date: m.played_at,
          title, body,
          accent: "#7dd3fc",
          icon: "🎯",
          tag: "Assist King",
          leagueId: league?.id,
          leagueName: league?.name,
          matchId: m.id,
        });
      }

      // ── GK save hero (8+ saves) ──
      if ((s.gk_saves ?? 0) >= 8) {
        const title = pick([
          `${pName(s)} Makes ${s.gk_saves} Saves in Heroic Display`,
          `Shot-Stopper ${pName(s)} Keeps ${myTeam} in It with ${s.gk_saves} Saves`,
          `Incredible ${s.gk_saves}-Save Performance from ${pName(s)}`,
        ], m.id + s.player_id + "gk");
        const body = pick([
          `${pName(s)} was a wall between the sticks, making ${s.gk_saves} saves for ${myTeam} in the ${score} result. Without this performance the scoreline could have been very different.`,
          `${myTeam} owe a huge debt to ${pName(s)}, whose ${s.gk_saves} saves kept them competitive in a ${score} match.`,
          `An outstanding goalkeeping display from ${pName(s)} saw them pull off ${s.gk_saves} saves — a truly commanding presence.`,
        ], m.id + s.player_id + "gk");
        items.push({
          id: `save_hero_${m.id}_${s.player_id}`,
          type: "save_hero",
          date: m.played_at,
          title, body,
          accent: "#fbbf24",
          icon: "🧤",
          tag: "Save Hero",
          leagueId: league?.id,
          leagueName: league?.name,
          matchId: m.id,
        });
      }

      // ── Defensive wall (10+ tackles+interceptions) ──
      const defActions = (s.tackles ?? 0) + (s.key_tackles ?? 0) + (s.interceptions ?? 0) + (s.key_interceptions ?? 0);
      if (defActions >= 10) {
        const title = pick([
          `${pName(s)} Puts In ${defActions}-Action Defensive Shift`,
          `Defensive Masterclass from ${pName(s)} — ${defActions} Actions`,
          `${pName(s)} a Rock at the Back for ${myTeam}`,
        ], m.id + s.player_id + "d");
        const body = pick([
          `${pName(s)} was everywhere for ${myTeam}, racking up ${defActions} combined tackles and interceptions in the ${score} result. An absolute wall at the back.`,
          `Nobody got past ${pName(s)} easily — ${defActions} defensive actions in one match shows the kind of tireless, no-nonsense display ${myTeam} needed.`,
          `A commanding defensive performance from ${pName(s)} saw them record ${defActions} tackles and interceptions, marshalling ${myTeam}'s backline in the ${score} game.`,
        ], m.id + s.player_id + "d");
        items.push({
          id: `def_wall_${m.id}_${s.player_id}`,
          type: "def_wall",
          date: m.played_at,
          title, body,
          accent: "#94a3b8",
          icon: "🧱",
          tag: "Defensive Wall",
          leagueId: league?.id,
          leagueName: league?.name,
          matchId: m.id,
        });
      }

      // ── Goal + Assist combo (1+ goals AND 2+ assists) ──
      if ((s.goals ?? 0) >= 1 && (s.assists ?? 0) >= 2) {
        const g = s.goals!, a = s.assists!;
        const title = pick([
          `${pName(s)} Scores ${g} and Assists ${a} in Complete Display`,
          `${pName(s)} Involved in ${g + a} Goals for ${myTeam}`,
          `All-Round ${pName(s)} — ${g}G ${a}A for ${myTeam}`,
        ], m.id + s.player_id + "ga");
        const body = pick([
          `${pName(s)} was involved in everything good for ${myTeam}, contributing ${g} goal${g > 1 ? "s" : ""} and ${a} assists in the ${score} result. A complete attacking performance.`,
          `Goals and assists — ${pName(s)} had both, finishing with ${g}G and ${a}A as ${myTeam} played out a ${score} match.`,
          `${pName(s)} was the heartbeat of ${myTeam}'s attack with ${g} goal${g > 1 ? "s" : ""} and ${a} assists in a ${score} game. Involved in everything.`,
        ], m.id + s.player_id + "ga");
        items.push({
          id: `ga_combo_${m.id}_${s.player_id}`,
          type: "ga_combo",
          date: m.played_at,
          title, body,
          accent: "#c084fc",
          icon: "💫",
          tag: "Goal + Assist",
          leagueId: league?.id,
          leagueName: league?.name,
          matchId: m.id,
        });
      }
    }
  }

  // ── 4. TOTW ───────────────────────────────────────────────────────────────
  const matchdayGroups = new Map<string, Match[]>();
  for (const m of matches) {
    if (!m.league_id || m.day === null) continue;
    const key = `${m.league_id}__${m.day}`;
    if (!matchdayGroups.has(key)) matchdayGroups.set(key, []);
    matchdayGroups.get(key)!.push(m);
  }

  const now = new Date().toISOString();
  for (const [key, dayMatches] of matchdayGroups) {
    // A matchday is complete when every match with a past date has a score.
    // Future-dated fixtures (unplayed knockouts etc.) are excluded from this check.
    const pastMatches = dayMatches.filter(m => m.played_at && m.played_at <= now);
    if (pastMatches.length === 0) continue;
    if (!pastMatches.every(m => m.home_score !== null && m.away_score !== null)) continue;

    const matchIds = new Set(pastMatches.map(m => m.id));
    const dayStats = stats.filter(s => matchIds.has(s.match_id));
    if (dayStats.length === 0) continue;

    const totwEntries = computeTOTW(dayStats, matchById);
    if (totwEntries.length === 0) continue;

    const [leagueId, dayStr] = key.split("__");
    const day = parseInt(dayStr);
    const league = leagueById.get(leagueId);
    const datedMatches = dayMatches.filter(m => m.played_at);
    const lastDate = datedMatches.length > 0
      ? [...datedMatches].sort((a, b) => b.played_at!.localeCompare(a.played_at!))[0].played_at!
      : new Date().toISOString();

    items.push({
      id: `totw_${leagueId}_${day}`,
      type: "totw",
      date: lastDate,
      title: `Team of the Week — ${league?.name ?? "Unknown League"}, Day ${day}`,
      body: totwEntries.map(e => `${e.slot}: ${e.name} (${e.rating})`).join(" · "),
      accent: "#f4c430",
      icon: "⭐",
      tag: "Team of the Week",
      leagueId,
      leagueName: league?.name,
      meta: { entries: totwEntries, day },
    });
  }

  // ── 5. League Standings: Gap & Overtakes ─────────────────────────────────
  for (const league of leagues) {
    if (league.format !== "league") continue;
    const leagueMatches = (matchesByLeague.get(league.id) ?? [])
      .filter(m => m.home_score !== null && m.away_score !== null)
      .sort((a, b) => a.played_at.localeCompare(b.played_at));
    if (leagueMatches.length === 0) continue;

    const s: Record<string, StandingRow> = {};
    let prevGap = 0;

    for (const m of leagueMatches) {
      const prevRows = sortStandings(s);
      const prevRanks = snapshotStandings(prevRows);

      applyMatchToStandings(s, m);

      const newRows = sortStandings(s);
      const newRanks = snapshotStandings(newRows);

      // Overtake detection for each team involved
      for (const teamName of [m.home_team, m.away_team]) {
        const before = prevRanks.get(teamName) ?? -1;
        const after = newRanks.get(teamName) ?? -1;
        if (before <= 0 || after < 0 || after >= before) continue; // not in standings, at top already, or didn't improve

        const overtaken = prevRows.slice(after, before).map(r => r.team).filter(t => t !== teamName);
        if (overtaken.length === 0) continue;

        items.push({
          id: `standings_overtake_${m.id}_${teamName}`,
          type: "standings_overtake",
          date: m.played_at,
          title: `${teamName} Overtake${overtaken.length > 1 ? "s" : ""} ${overtaken.join(", ")} in ${league.name}`,
          body: `${teamName} have climbed to ${after + 1}${ordinal(after + 1)} place in the ${league.name} standings, moving above ${overtaken.join(", ")} following their match against ${teamName === m.home_team ? m.away_team : m.home_team}.`,
          accent: "#4ade80",
          icon: "📈",
          tag: "Standings",
          leagueId: league.id,
          leagueName: league.name,
          matchId: m.id,
        });
      }

      // 6-point gap event (only when gap first crosses the 6-point threshold)
      if (newRows.length >= 2) {
        const newGap = newRows[0].points - newRows[1].points;
        if (newGap >= 6 && prevGap < 6) {
          items.push({
            id: `league_gap_${league.id}_${m.id}`,
            type: "league_gap",
            date: m.played_at,
            title: `${newRows[0].team} Stretch Lead to ${newGap} Points in ${league.name}`,
            body: `${newRows[0].team} have opened up a commanding ${newGap}-point gap at the top of ${league.name}, pulling clear of ${newRows[1].team} and putting themselves firmly in control of the title race.`,
            accent: "#f97316",
            icon: "🔥",
            tag: "Title Lead",
            leagueId: league.id,
            leagueName: league.name,
          });
        }
        prevGap = newGap;
      }
    }
  }

  // ── 6. ELO Overtakes ─────────────────────────────────────────────────────
  {
    const chronoMatches = [...matches]
      .filter(m => m.home_score !== null && m.away_score !== null)
      .sort((a, b) => a.played_at.localeCompare(b.played_at));

    const elos = new Map<string, number>();
    const getElo = (t: string) => elos.get(t) ?? DEFAULT_ELO;

    for (const m of chronoMatches) {
      // Skip if either team has no_elo flag
      if (noEloTeams.has(m.home_team) || noEloTeams.has(m.away_team)) continue;

      if (!elos.has(m.home_team)) elos.set(m.home_team, DEFAULT_ELO);
      if (!elos.has(m.away_team)) elos.set(m.away_team, DEFAULT_ELO);

      // Snapshot rankings before
      const allTeams = [...elos.keys()];
      const sortedBefore = [...allTeams].sort((a, b) => getElo(b) - getElo(a));
      const ranksBefore = new Map(sortedBefore.map((t, i) => [t, i]));

      // Compute ELO change
      const hElo = getElo(m.home_team);
      const aElo = getElo(m.away_team);
      const tier = m.league_id ? (tierMap.get(m.league_id) ?? null) : null;
      const tM = tierMult(tier);
      const hs = m.home_score as number;
      const as_ = m.away_score as number;
      const gd = Math.abs(hs - as_);
      const hActual = hs > as_ ? 1 : hs < as_ ? 0 : 0.5;
      const aActual = 1 - hActual;
      const hExp = expScore(hElo, aElo);
      const aExp = 1 - hExp;
      const gM = hActual === 0.5 ? 1.0 : gdMult(gd);
      const K = K_BASE * tM * gM;

      elos.set(m.home_team, hElo + K * (hActual - hExp));
      elos.set(m.away_team, aElo + K * (aActual - aExp));

      // Snapshot rankings after
      const sortedAfter = [...allTeams].sort((a, b) => getElo(b) - getElo(a));
      const ranksAfter = new Map(sortedAfter.map((t, i) => [t, i]));

      // Detect overtakes for both teams
      for (const teamName of [m.home_team, m.away_team]) {
        const before = ranksBefore.get(teamName) ?? -1;
        const after = ranksAfter.get(teamName) ?? -1;
        if (before <= 0 || after < 0 || after >= before) continue;

        const opponent = teamName === m.home_team ? m.away_team : m.home_team;
        const overtaken = sortedBefore.slice(after, before).filter(t => t !== teamName && !noEloTeams.has(t));
        if (overtaken.length === 0) continue;

        items.push({
          id: `elo_overtake_${m.id}_${teamName}`,
          type: "elo_overtake",
          date: m.played_at,
          title: `${teamName} ${after === 0 ? "Go Top of" : "Rise in"} the ELO Rankings`,
          body: `Following their result against ${opponent}, ${teamName} have overtaken ${overtaken.join(", ")} in the ELO standings, climbing to ${after === 0 ? "top spot" : `${after + 1}${ordinal(after + 1)} place`} with ${Math.round(getElo(teamName))} ELO.`,
          accent: "#22c55e",
          icon: "📊",
          tag: "ELO",
        });
      }
    }
  }

  // Sort newest first
  return items.sort((a, b) => b.date.localeCompare(a.date));
}

// ── Filter config ─────────────────────────────────────────────────────────────

const FILTERS = [
  { key: "all", labelKey: "news.filter.all" },
  { key: "league", labelKey: "news.filter.titles", types: ["league_winner", "league_relegation"] },
  { key: "goals", labelKey: "news.filter.goals", types: ["hattrick", "hattrick_multi", "brace", "assist_king", "ga_combo"] },
  { key: "results", labelKey: "news.filter.results", types: ["clean_sheet", "goalless_draw", "high_draw", "thrashing", "comprehensive", "goal_fest", "forfeit", "narrow_win"] as const },
  { key: "performance", labelKey: "news.filter.performance", types: ["save_hero", "def_wall"] },
  { key: "standings", labelKey: "news.filter.standings", types: ["standings_overtake", "league_gap"] },
  { key: "totw", labelKey: "news.filter.totw", types: ["totw"] },
  { key: "elo", labelKey: "news.filter.elo", types: ["elo_overtake"] },
] as const;

// ── News card ─────────────────────────────────────────────────────────────────

function NewsCard({ item }: { item: NewsItem }) {
  const { t } = useLanguage();
  const totwEntries = item.meta?.entries as TOTWEntry[] | undefined;

  return (
    <article style={{
      background: "var(--bg-card)",
      borderLeft: `3px solid ${item.accent}`,
      padding: "20px 24px",
      display: "flex",
      flexDirection: "column",
      gap: 10,
    }}>
      {/* Tag + date row */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 14 }}>{item.icon}</span>
          <span style={{
            fontSize: 9, fontWeight: 800, letterSpacing: "0.2em", textTransform: "uppercase",
            color: item.accent, background: `${item.accent}18`, padding: "2px 8px",
          }}>
            {item.tag}
          </span>
          {item.leagueName && (
            <>
              <span style={{ color: "var(--text-faint)", fontSize: 10 }}>·</span>
              {item.leagueId ? (
                <Link href={`/leagues/${item.leagueId}`} style={{ fontSize: 10, color: "var(--text-faint)", textDecoration: "none" }} className="nav-link">
                  {item.leagueName}
                </Link>
              ) : (
                <span style={{ fontSize: 10, color: "var(--text-faint)" }}>{item.leagueName}</span>
              )}
            </>
          )}
        </div>
        <span style={{ fontSize: 11, color: "var(--text-faint)", whiteSpace: "nowrap" }}>{formatDate(item.date)}</span>
      </div>

      {/* Title */}
      <div style={{ fontSize: 16, fontWeight: 800, color: "var(--text-main)", lineHeight: 1.3 }}>{item.title}</div>

      {/* Body */}
      {item.type !== "totw" && (
        <p style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.6, margin: 0 }}>{item.body}</p>
      )}

      {/* TOTW special layout */}
      {item.type === "totw" && totwEntries && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 2 }}>
          {totwEntries.map(e => (
            <Link
              key={e.playerId}
              href={`/players/${e.playerId}`}
              style={{ textDecoration: "none" }}
            >
              <div style={{
                background: "var(--bg-base)",
                border: "1px solid var(--border-main)",
                padding: "6px 10px",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 2,
                minWidth: 70,
              }}>
                <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.15em", color: "var(--text-faint)", textTransform: "uppercase" }}>{e.slot}</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text-body)" }}>{e.name}</span>
                <span style={{ fontSize: 11, fontWeight: 800, color: "#f4c430" }}>{e.rating}</span>
              </div>
            </Link>
          ))}
        </div>
      )}

      {/* Match link */}
      {item.matchId && (
        <div style={{ marginTop: 2 }}>
          <Link
            href={`/matches/${item.matchId}`}
            style={{ fontSize: 11, color: item.accent, textDecoration: "none", fontWeight: 600, letterSpacing: "0.06em" }}
            className="nav-link"
          >
            View match →
          </Link>
        </div>
      )}
    </article>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function NewsPage() {
  const { t } = useLanguage();
  const [newsItems, setNewsItems] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<string>("all");

  useEffect(() => {
    if (!supabase) { setError("Database unavailable"); setLoading(false); return; }

    (async () => {
      try {
        // ── Egress control ───────────────────────────────────────────────────
        // This page used to pull the *entire* match_player_stats table on every
        // visit (~1.3 MB raw). Because it is a client component there is no
        // shared cache, so every visitor paid that in full.
        //
        // League-level stories (champions, relegation, standings gaps, ELO
        // overtakes) derive only from `matches`, which is small and still
        // fetched in full — so the historical feed is unaffected. Only the
        // per-match stories (hattricks, standout performances, TOTW) read
        // stats, and those are now scoped to a recent window.
        //
        // Raise STATS_WINDOW_DAYS if you want older individual stories back;
        // cost scales roughly linearly with it.
        const STATS_WINDOW_DAYS = 90;

        const [
          { data: leagues },
          { data: matches },
          { data: teams },
        ] = await Promise.all([
          supabase!.from("leagues").select("id,name,season,format,ended,zones,tier"),
          supabase!.from("matches")
            .select("id,home_team,away_team,home_score,away_score,played_at,league_id,day,forfeited_by,stage")
            .order("played_at", { ascending: false }),
          supabase!.from("teams").select("id,name,no_elo"),
        ]);

        const allMatches = (matches ?? []) as Match[];

        const cutoff = new Date(Date.now() - STATS_WINDOW_DAYS * 86_400_000).toISOString();
        const recentMatchIds = allMatches
          .filter(m => m.played_at && m.played_at >= cutoff)
          .map(m => m.id);

        // `rating` / `rating_version` are deliberately not selected: computeTOTW
        // recalculates ratings locally via calcMatchBreakdown, so the stored
        // columns were fetched and thrown away on every row.
        const STATS_SELECT = "match_id,player_id,team_side,position,goals,assists,score,passes,key_passes,shots_on_target,tackles,key_tackles,interceptions,key_interceptions,possessions_lost,gk_saves,gk_catches,benched,stats_incomplete,players(handle,name)";

        // Chunked so the `in.()` filter stays well inside proxy URL limits, and
        // so no single request can approach PostgREST's 1000-row cap
        // (a match yields at most ~22 stat rows, so 40 ids ≈ 880 rows).
        const ID_CHUNK = 40;
        const allStats: StatRow[] = [];
        for (let i = 0; i < recentMatchIds.length; i += ID_CHUNK) {
          const { data: page } = await supabase!
            .from("match_player_stats")
            .select(STATS_SELECT)
            .in("match_id", recentMatchIds.slice(i, i + ID_CHUNK));
          if (page) allStats.push(...(page as unknown as StatRow[]));
        }

        const items = generateNews(
          (leagues ?? []) as League[],
          allMatches,
          allStats,
          (teams ?? []) as TeamRow[],
        );
        setNewsItems(items);
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "Failed to load news");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const filtered = activeFilter === "all"
    ? newsItems
    : newsItems.filter(item => {
        const f = FILTERS.find(f => f.key === activeFilter);
        return f && "types" in f && f.types.includes(item.type as never);
      });

  return (
    <main style={{ maxWidth: 860, margin: "0 auto", padding: "40px 24px" }}>
      {/* Header */}
      <div style={{ marginBottom: 32 }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.25em", textTransform: "uppercase", color: "var(--text-faint)", marginBottom: 8 }}>
          PSAFDB
        </div>
        <h1 style={{ fontSize: 28, fontWeight: 900, color: "var(--text-main)", margin: 0, letterSpacing: "-0.01em" }}>News</h1>
        <p style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 8 }}>
          Automated coverage of league results, tournament winners, standout performances, and standings movement.
        </p>
      </div>

      {/* Filter tabs */}
      <div style={{ display: "flex", gap: 2, marginBottom: 24, flexWrap: "wrap" }}>
        {FILTERS.map(f => (
          <button
            key={f.key}
            onClick={() => setActiveFilter(f.key)}
            style={{
              padding: "7px 16px",
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              cursor: "pointer",
              background: activeFilter === f.key ? "var(--text-faint)" : "var(--bg-card)",
              color: activeFilter === f.key ? "var(--bg-base)" : "var(--text-muted)",
              border: `1px solid ${activeFilter === f.key ? "var(--text-faint)" : "var(--border-main)"}`,
              transition: "all 0.1s",
            }}
          >
            {t(f.labelKey)}
          </button>
        ))}
        {!loading && (
          <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--text-faint)", alignSelf: "center" }}>
            {filtered.length} {filtered.length === 1 ? "story" : "stories"}
          </span>
        )}
      </div>

      {/* Content */}
      {loading ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} style={{ background: "var(--bg-card)", height: 110, borderLeft: "3px solid var(--border-main)", opacity: 0.5 }} />
          ))}
        </div>
      ) : error ? (
        <div style={{ background: "var(--bg-card)", padding: "40px 24px", textAlign: "center", color: "#e63946" }}>
          {error}
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ background: "var(--bg-card)", padding: "60px 24px", textAlign: "center", color: "var(--text-faint)", fontSize: 14 }}>
          No stories yet.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {filtered.map(item => <NewsCard key={item.id} item={item} />)}
        </div>
      )}
    </main>
  );
}
