import { createClient } from "@supabase/supabase-js";
import Link from "next/link";
import { notFound } from "next/navigation";
import PlayerStatsTable from "./PlayerStatsTable";
import {
  calcMatchBreakdown,
  calcOverallRating,
  getRatingColor,
  DEFAULT_TIER_BONUSES,
  type MatchStatRow,
  type MatchResult,
} from "@/lib/ratings";
import { computeCurrentElos, expectedScore, eloColor, DEFAULT_ELO } from "@/lib/elo";
import { getLang } from "@/lib/lang-server";
import { t as tt, type Lang } from "@/lib/i18n";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

async function getMatch(id: string) {
  const { data, error } = await supabase
    .from("matches")
    .select("id,league_id,played_at,home_team,away_team,home_score,away_score,forfeited_by,stage,group_name,league:leagues(id,name,season)")
    .eq("id", id)
    .single();
  if (error || !data) return null;
  return data;
}

async function getTeamStats(matchId: string) {
  const { data } = await supabase
    .from("match_team_stats")
    .select("team_side,possession,passes,key_passes,assists,shots,shots_on_target,goals,tackles,key_tackles,interceptions,key_interceptions,possessions_lost,goal_kicks,corner_kicks,throw_ins,free_kicks,penalties,fouls,offsides,yellow_cards,red_cards")
    .eq("match_id", matchId);
  return data ?? [];
}

async function getPlayerStats(matchId: string) {
  const { data, error } = await supabase
    .from("match_player_stats")
    .select("player_id,team_side,position,score,passes,key_passes,assists,shots,shots_on_target,goals,tackles,key_tackles,interceptions,key_interceptions,possessions_lost,gk_saves,gk_catches,players(handle,name)")
    .eq("match_id", matchId);

  if (!error && data) return data as any[];

  // Fallback without join
  const { data: data2 } = await supabase
    .from("match_player_stats")
    .select("player_id,team_side,position,score,passes,key_passes,assists,shots,shots_on_target,goals,tackles,key_tackles,interceptions,key_interceptions,possessions_lost,gk_saves,gk_catches")
    .eq("match_id", matchId);

  if (!data2) return [];

  const ids = [...new Set(data2.map((r: any) => r.player_id))];
  if (ids.length) {
    const { data: players } = await supabase.from("players").select("id,handle,name").in("id", ids);
    const map = new Map((players ?? []).map((p: any) => [p.id, { handle: p.handle, name: p.name }]));
    return data2.map((r: any) => ({ ...r, players: map.get(r.player_id) ?? null }));
  }
  return data2;
}

async function getPreviousEncounters(homeTeam: string, awayTeam: string, excludeMatchId: string) {
  const { data } = await supabase
    .from("matches")
    .select("id,played_at,home_team,away_team,home_score,away_score,forfeited_by,league:leagues(id,name,season)")
    .or(
      `and(home_team.eq.${homeTeam},away_team.eq.${awayTeam}),and(home_team.eq.${awayTeam},away_team.eq.${homeTeam})`
    )
    .not("home_score", "is", null)
    .neq("id", excludeMatchId)
    .order("played_at", { ascending: false })
    .limit(10);
  return data ?? [];
}

async function getTeamIds(homeTeam: string, awayTeam: string): Promise<Map<string, string>> {
  const { data } = await supabase
    .from("teams")
    .select("id,name")
    .in("name", [homeTeam, awayTeam]);
  const map = new Map<string, string>();
  for (const t of data ?? []) map.set(t.name, t.id);
  return map;
}

async function getPlayerOverallRatings(playerIds: string[]): Promise<Record<string, number>> {
  if (!playerIds.length) return {};

  const { data: tierSettingsData } = await supabase.from("tier_settings").select("tier,bonus");
  const tierBonuses: Record<number, number> = { ...DEFAULT_TIER_BONUSES };
  if (tierSettingsData) for (const row of tierSettingsData) tierBonuses[row.tier] = row.bonus;

  const { data } = await supabase
    .from("match_player_stats")
    .select("player_id,team_side,position,score,goals,assists,shots_on_target,key_passes,passes,tackles,key_tackles,interceptions,key_interceptions,possessions_lost,gk_saves,gk_catches,benched,stats_incomplete,is_starter,sub_number,matches(home_score,away_score,leagues(tier,use_tier_bonus))")
    .in("player_id", playerIds);
  if (!data) return {};

  const normalized = data.map((s: any) => ({
    ...s,
    benched: s.benched ?? (!s.is_starter && s.sub_number !== null && s.score === 0),
    stats_incomplete: s.stats_incomplete ?? false,
    matches: Array.isArray(s.matches) ? s.matches[0] ?? null : s.matches ?? null,
  }));

  const byPlayer = new Map<string, any[]>();
  for (const s of normalized) {
    if (!byPlayer.has(s.player_id)) byPlayer.set(s.player_id, []);
    byPlayer.get(s.player_id)!.push(s);
  }

  const result: Record<string, number> = {};
  for (const [pid, stats] of byPlayer) {
    const played = stats.filter((s: any) => !s.benched && !s.stats_incomplete && s.matches);
    if (played.length < 3) continue;
    const matchRatingsList: number[] = [];
    const tierCounts: Record<number, number> = {};
    for (const s of played) {
      const m = s.matches;
      const isHome = s.team_side === "home";
      const statRow: MatchStatRow = {
        goals: s.goals ?? 0, assists: s.assists ?? 0, key_passes: s.key_passes ?? 0,
        shots_on_target: s.shots_on_target ?? 0, passes: s.passes ?? 0,
        tackles: s.tackles ?? 0, key_tackles: s.key_tackles ?? 0,
        interceptions: s.interceptions ?? 0, key_interceptions: s.key_interceptions ?? 0,
        possessions_lost: s.possessions_lost ?? 0, gk_saves: s.gk_saves ?? 0,
        gk_catches: s.gk_catches ?? 0,
        goals_conceded: (isHome ? m.away_score : m.home_score) ?? 0,
        score: s.score ?? 0, position: s.position,
      };
      const my = isHome ? m.home_score : m.away_score;
      const opp = isHome ? m.away_score : m.home_score;
      const res: MatchResult = my > opp ? "W" : my < opp ? "L" : "D";
      matchRatingsList.push(calcMatchBreakdown(statRow, res, s.position).final);
      if (m.leagues?.use_tier_bonus !== false) {
        const tier = m.leagues?.tier ?? 2;
        tierCounts[tier] = (tierCounts[tier] ?? 0) + 1;
      }
    }
    if (matchRatingsList.length < 3) continue;
    const tierEntries = Object.entries(tierCounts).sort((a, b) => Number(b[1]) - Number(a[1]));
    const domTier = tierEntries.length > 0 ? +tierEntries[0][0] : 2;
    result[pid] = calcOverallRating(matchRatingsList, domTier, tierBonuses);
  }
  return result;
}

type LineupPlayer = { playerId: string; name: string; rating: number | null };
type LineupSlot = { slot: string; player: LineupPlayer | null };

const LINEUP_SLOT_ORDER = ["GK", "LW", "RW", "LB", "RB", "CM"] as const;
const LINEUP_DISPLAY_ORDER = ["GK", "LB", "RB", "CM", "LW", "RW"] as const;
const LINEUP_SLOT_POOLS: Record<string, string[]> = {
  GK: ["GK"],
  LB: ["LB", "LWB", "LCB"],
  RB: ["RB", "RWB", "RCB"],
  CM: ["CM", "LM", "RM", "CF", "ST", "CB"],
  LW: ["LW", "LF"],
  RW: ["RW", "RF"],
};

async function getBestLineup(teamName: string): Promise<LineupSlot[]> {
  const { data: recentMatches } = await supabase
    .from("matches")
    .select("id,home_team")
    .or(`home_team.eq.${teamName},away_team.eq.${teamName}`)
    .not("home_score", "is", null)
    .order("played_at", { ascending: false })
    .limit(10);
  if (!recentMatches?.length) return LINEUP_DISPLAY_ORDER.map(s => ({ slot: s, player: null }));

  const matchSideMap = new Map<string, string>(
    recentMatches.map((m: any) => [m.id, m.home_team === teamName ? "home" : "away"])
  );
  const matchIds = [...matchSideMap.keys()];

  const { data: stats } = await supabase
    .from("match_player_stats")
    .select("player_id,match_id,team_side,position,benched,players(handle,name)")
    .in("match_id", matchIds);

  if (!stats?.length) return LINEUP_DISPLAY_ORDER.map(s => ({ slot: s, player: null }));

  const playerMap = new Map<string, { name: string; positions: string[] }>();
  for (const s of stats) {
    if (s.team_side !== matchSideMap.get(s.match_id)) continue;
    if (s.benched) continue;
    const p = Array.isArray(s.players) ? s.players[0] : s.players;
    const name = p?.name || p?.handle || s.player_id.slice(0, 8);
    if (!playerMap.has(s.player_id)) playerMap.set(s.player_id, { name, positions: [] });
    if (s.position) playerMap.get(s.player_id)!.positions.push(s.position);
  }

  const playerIds = [...playerMap.keys()];
  if (!playerIds.length) return LINEUP_DISPLAY_ORDER.map(s => ({ slot: s, player: null }));
  const ratings = await getPlayerOverallRatings(playerIds);

  // Build candidates with dominant position, sorted by rating desc (unrated last)
  const candidates = playerIds
    .map(pid => {
      const { name, positions } = playerMap.get(pid)!;
      const posCount: Record<string, number> = {};
      for (const p of positions) posCount[p] = (posCount[p] ?? 0) + 1;
      const dominantPos = Object.entries(posCount).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
      return { playerId: pid, name, dominantPos, rating: ratings[pid] ?? null };
    })
    .sort((a, b) => {
      if (a.rating !== null && b.rating !== null) return b.rating - a.rating;
      if (a.rating !== null) return -1;
      if (b.rating !== null) return 1;
      return 0;
    });

  // Fill slots in priority order (specific first, CM catch-all last)
  const used = new Set<string>();
  const filled: Record<string, LineupPlayer | null> = {};
  for (const slot of LINEUP_SLOT_ORDER) {
    const pool = LINEUP_SLOT_POOLS[slot];
    const pick = candidates.find(c => !used.has(c.playerId) && c.dominantPos && pool.includes(c.dominantPos));
    if (pick) {
      filled[slot] = { playerId: pick.playerId, name: pick.name, rating: pick.rating };
      used.add(pick.playerId);
    } else {
      // CM fallback: take best unslotted player regardless of position
      if (slot === "CM") {
        const fallback = candidates.find(c => !used.has(c.playerId));
        if (fallback) {
          filled[slot] = { playerId: fallback.playerId, name: fallback.name, rating: fallback.rating };
          used.add(fallback.playerId);
        } else {
          filled[slot] = null;
        }
      } else {
        filled[slot] = null;
      }
    }
  }

  return LINEUP_DISPLAY_ORDER.map(slot => ({ slot, player: filled[slot] ?? null }));
}

export const revalidate = 60;

const TEAM_STAT_ROWS: [string, string, boolean][] = [
  ["matchdetail.stat.possession", "possession", true],
  ["matchdetail.stat.passes", "passes", false],
  ["matchdetail.stat.key_passes", "key_passes", false],
  ["matchdetail.stat.shots", "shots", false],
  ["matchdetail.stat.shots_on_target", "shots_on_target", false],
  ["matchdetail.stat.goals", "goals", false],
  ["matchdetail.stat.assists", "assists", false],
  ["matchdetail.stat.tackles", "tackles", false],
  ["matchdetail.stat.key_tackles", "key_tackles", false],
  ["matchdetail.stat.interceptions", "interceptions", false],
  ["matchdetail.stat.key_interceptions", "key_interceptions", false],
  ["matchdetail.stat.possessions_lost", "possessions_lost", false],
  ["matchdetail.stat.corners", "corner_kicks", false],
  ["matchdetail.stat.fouls", "fouls", false],
  ["matchdetail.stat.yellow_cards", "yellow_cards", false],
  ["matchdetail.stat.red_cards", "red_cards", false],
  ["matchdetail.stat.offsides", "offsides", false],
];

export default async function MatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const lang: Lang = await getLang();
  const match = await getMatch(id);
  if (!match) notFound();

  const played = match.home_score !== null && match.away_score !== null;

  const [teamStats, playerStats, teamIds, prevEncounters, eloMap, homeBestXI, awayBestXI] = await Promise.all([
    getTeamStats(id),
    getPlayerStats(id),
    getTeamIds(match.home_team, match.away_team),
    getPreviousEncounters(match.home_team, match.away_team, id),
    // Use ELO up to (not including) this match so we get the pre-match ratings
    computeCurrentElos(supabase, { beforeDate: match.played_at }),
    played ? Promise.resolve<LineupSlot[]>([]) : getBestLineup(match.home_team),
    played ? Promise.resolve<LineupSlot[]>([]) : getBestLineup(match.away_team),
  ]);

  const homeStats = teamStats.find((s: any) => s.team_side === "home") ?? null;
  const awayStats = teamStats.find((s: any) => s.team_side === "away") ?? null;

  // Per-match ratings (0–100) for each player in this game
  const matchRatings: Record<string, number> = {};
  if (played) {
    for (const s of playerStats) {
      const isHome = s.team_side === "home";
      const statRow: MatchStatRow = {
        goals: s.goals ?? 0, assists: s.assists ?? 0, key_passes: s.key_passes ?? 0,
        shots_on_target: s.shots_on_target ?? 0, passes: s.passes ?? 0,
        tackles: s.tackles ?? 0, key_tackles: s.key_tackles ?? 0,
        interceptions: s.interceptions ?? 0, key_interceptions: s.key_interceptions ?? 0,
        possessions_lost: s.possessions_lost ?? 0, gk_saves: s.gk_saves ?? 0,
        gk_catches: s.gk_catches ?? 0,
        goals_conceded: isHome ? match.away_score! : match.home_score!,
        score: s.score ?? 0, position: s.position,
      };
      const my = isHome ? match.home_score! : match.away_score!;
      const opp = isHome ? match.away_score! : match.home_score!;
      const res: MatchResult = my > opp ? "W" : my < opp ? "L" : "D";
      matchRatings[s.player_id] = calcMatchBreakdown(statRow, res, s.position).final;
    }
  }

  // Overall career ratings for all players in this game
  const playerIds = [...new Set(playerStats.map((s: any) => s.player_id as string))];
  const overallRatings = await getPlayerOverallRatings(playerIds);

  const enrichedPlayerStats = playerStats.map((s: any) => ({
    ...s,
    matchRating: matchRatings[s.player_id] ?? null,
    overallRating: overallRatings[s.player_id] ?? null,
  }));
  const league = (match as any).league ?? null;
  const homeWin = played && match.home_score! > match.away_score!;
  const awayWin = played && match.away_score! > match.home_score!;

  return (
    <main style={{ minHeight: "calc(100vh - 56px)" }}>
      {/* Header */}
      <section style={{ borderBottom: "1px solid var(--border-main)", padding: "40px 24px 32px", background: "var(--bg-nav)" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto" }}>
          {/* Breadcrumb */}
          <div style={{ fontSize: 11, letterSpacing: "0.25em", color: "var(--text-faint)", fontWeight: 700, textTransform: "uppercase", marginBottom: 20 }}>
            <Link href="/" style={{ color: "var(--text-faint)", textDecoration: "none" }}>{tt(lang, "nav.home")}</Link>
            <span style={{ margin: "0 8px" }}>/</span>
            <Link href="/matches" style={{ color: "var(--text-faint)", textDecoration: "none" }}>{tt(lang, "nav.matches")}</Link>
            <span style={{ margin: "0 8px" }}>/</span>
            {match.home_team} vs {match.away_team}
          </div>

          {league && (
            <div style={{ fontSize: 11, color: "#4ea8f7", letterSpacing: "0.15em", fontWeight: 700, textTransform: "uppercase", marginBottom: 16 }}>
              <Link href={`/leagues/${league.id}`} style={{ color: "#4ea8f7", textDecoration: "none" }}>
                {league.name}{league.season ? ` · ${tt(lang, "matchdetail.season", { n: league.season })}` : ""}
              </Link>
            </div>
          )}

          {/* Score */}
          <div style={{ display: "flex", alignItems: "center", gap: 32 }}>
            <div style={{ flex: 1, textAlign: "right" }}>
              <div style={{ fontSize: "clamp(18px, 3vw, 30px)", fontWeight: 900, letterSpacing: "-0.02em", color: homeWin ? "var(--text-main)" : "var(--text-muted)" }}>
                {teamIds.get(match.home_team) ? (
                  <Link href={`/teams/${teamIds.get(match.home_team)}`} style={{ color: "inherit", textDecoration: "none" }} className="hover:underline">{match.home_team}</Link>
                ) : match.home_team}
              </div>
              {homeWin && <div style={{ fontSize: 10, color: "#4ade80", letterSpacing: "0.15em", fontWeight: 700, textTransform: "uppercase", marginTop: 4 }}>{tt(lang, "matchdetail.winner")}</div>}
            </div>

            <div style={{ textAlign: "center", flexShrink: 0 }}>
              {played ? (
                <div style={{ fontSize: "clamp(40px, 7vw, 72px)", fontWeight: 900, letterSpacing: "-0.04em", color: "var(--text-main)", fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>
                  {match.home_score}<span style={{ color: "var(--border-main)", margin: "0 6px" }}>—</span>{match.away_score}
                </div>
              ) : (
                <div style={{ fontSize: 28, color: "var(--text-faint)", letterSpacing: "0.1em" }}>{tt(lang, "matchdetail.vs")}</div>
              )}
              <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 8, letterSpacing: "0.08em" }}>
                {new Date(match.played_at).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}
              </div>
              {(match as any).stage && (
                <div style={{ fontSize: 10, color: "var(--text-sub)", letterSpacing: "0.12em", textTransform: "uppercase", marginTop: 4 }}>{(match as any).stage}</div>
              )}
              {(match as any).forfeited_by && (
                <div style={{ marginTop: 8, fontSize: 10, color: "#e63946", background: "#e6394620", padding: "3px 10px", letterSpacing: "0.08em", display: "inline-block" }}>
                  {tt(lang, "matchdetail.forfeit", { team: (match as any).forfeited_by === "home" ? match.home_team : match.away_team })}
                </div>
              )}
            </div>

            <div style={{ flex: 1 }}>
              <div style={{ fontSize: "clamp(18px, 3vw, 30px)", fontWeight: 900, letterSpacing: "-0.02em", color: awayWin ? "var(--text-main)" : "var(--text-muted)" }}>
                {teamIds.get(match.away_team) ? (
                  <Link href={`/teams/${teamIds.get(match.away_team)}`} style={{ color: "inherit", textDecoration: "none" }} className="hover:underline">{match.away_team}</Link>
                ) : match.away_team}
              </div>
              {awayWin && <div style={{ fontSize: 10, color: "#4ade80", letterSpacing: "0.15em", fontWeight: 700, textTransform: "uppercase", marginTop: 4 }}>{tt(lang, "matchdetail.winner")}</div>}
            </div>
          </div>
        </div>
      </section>

      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "32px 24px 48px", display: "flex", flexDirection: "column", gap: 2 }}>

        {/* ELO Prediction */}
        {(() => {
          const homeElo = eloMap[match.home_team] ?? DEFAULT_ELO;
          const awayElo = eloMap[match.away_team] ?? DEFAULT_ELO;
          const homeProb = expectedScore(homeElo, awayElo);
          const homeP = Math.round(homeProb * 100);
          const awayP = 100 - homeP;
          const homeFav = homeP >= 55;
          const awayFav = awayP >= 55;
          const favLabel = homeFav
            ? tt(lang, "matchdetail.favored", { team: match.home_team })
            : awayFav
            ? tt(lang, "matchdetail.favored", { team: match.away_team })
            : tt(lang, "matchdetail.evenlyMatched");
          const hColor = eloColor(homeElo);
          const aColor = eloColor(awayElo);
          // For played matches, show whether prediction was correct
          let predNote: string | null = null;
            let predType: "correct" | "upset" | "draw" | null = null;
          if (played) {
            const predictedHome = homeP > awayP;
            const predictedAway = awayP > homeP;
            const actualHomeWin = match.home_score! > match.away_score!;
            const actualAwayWin = match.away_score! > match.home_score!;
            const draw = match.home_score === match.away_score;
            if (draw) { predNote = tt(lang, "matchdetail.endedDraw"); predType = "draw"; }
            else if ((predictedHome && actualHomeWin) || (predictedAway && actualAwayWin))
              { predNote = tt(lang, "matchdetail.predictionCorrect"); predType = "correct"; }
            else if (!homeFav && !awayFav)
              { predNote = draw ? tt(lang, "matchdetail.endedDraw") : tt(lang, "matchdetail.closeMatch"); predType = "draw"; }
            else
              { predNote = tt(lang, "matchdetail.upset"); predType = "upset"; }
          }
          return (
            <div>
              <div style={{ background: "var(--bg-card)", borderTop: "3px solid #22c55e", padding: "14px 20px", fontSize: 11, fontWeight: 700, letterSpacing: "0.2em", textTransform: "uppercase", color: "#22c55e", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span>{tt(lang, "matchdetail.eloPrediction")}</span>
                {played && predNote && (
                  <span style={{ fontSize: 10, color: predType === "correct" ? "#4ade80" : predType === "upset" ? "#f87171" : "var(--text-faint)", letterSpacing: "0.1em" }}>
                    {predNote}
                  </span>
                )}
              </div>
              <div style={{ background: "var(--bg-card)", padding: "20px 24px" }}>
                {/* ELO ratings row */}
                <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 14 }}>
                  <div style={{ flex: 1, textAlign: "right" }}>
                    <span style={{ display: "inline-block", padding: "3px 10px", background: `${hColor}18`, color: hColor, fontWeight: 800, fontSize: 15, borderRadius: 4, fontVariantNumeric: "tabular-nums" }}>
                      {homeElo}
                    </span>
                  </div>
                  <div style={{ fontSize: 10, color: "var(--text-faint)", letterSpacing: "0.15em", textTransform: "uppercase", flexShrink: 0 }}>{tt(lang, "matchdetail.elo")}</div>
                  <div style={{ flex: 1 }}>
                    <span style={{ display: "inline-block", padding: "3px 10px", background: `${aColor}18`, color: aColor, fontWeight: 800, fontSize: 15, borderRadius: 4, fontVariantNumeric: "tabular-nums" }}>
                      {awayElo}
                    </span>
                  </div>
                </div>
                {/* Probability bar */}
                <div style={{ display: "flex", height: 8, borderRadius: 4, overflow: "hidden", marginBottom: 10 }}>
                  <div style={{ width: `${homeP}%`, background: "#4ea8f7", transition: "width 0.3s" }} />
                  <div style={{ flex: 1, background: "#a78bfa" }} />
                </div>
                {/* Percentages */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ fontSize: 18, fontWeight: 900, color: homeFav ? "#4ea8f7" : "var(--text-muted)", fontVariantNumeric: "tabular-nums" }}>
                    {homeP}%
                    <span style={{ fontSize: 10, color: "var(--text-faint)", fontWeight: 400, marginLeft: 6, letterSpacing: "0.08em" }}>{tt(lang, "matchdetail.homeWin")}</span>
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-faint)", letterSpacing: "0.1em", textTransform: "uppercase" }}>
                    {played ? tt(lang, "matchdetail.preMatch") : favLabel}
                  </div>
                  <div style={{ fontSize: 18, fontWeight: 900, color: awayFav ? "#a78bfa" : "var(--text-muted)", fontVariantNumeric: "tabular-nums", textAlign: "right" }}>
                    <span style={{ fontSize: 10, color: "var(--text-faint)", fontWeight: 400, marginRight: 6, letterSpacing: "0.08em" }}>{tt(lang, "matchdetail.awayWin")}</span>
                    {awayP}%
                  </div>
                </div>
              </div>
            </div>
          );
        })()}

        {/* Head-to-Head — only shown for unplayed matches */}
        {!played && (() => {
          // Calculate H2H record from home/away perspective
          let homeW = 0, draws = 0, awayW = 0, homeGF = 0, awayGF = 0;
          for (const e of prevEncounters) {
            const eHome = (e as any).home_team === match.home_team;
            const hs = (e as any).home_score as number;
            const as_ = (e as any).away_score as number;
            const myScore = eHome ? hs : as_;
            const oppScore = eHome ? as_ : hs;
            homeGF += myScore; awayGF += oppScore;
            if (myScore > oppScore) homeW++;
            else if (myScore < oppScore) awayW++;
            else draws++;
          }
          return (
            <div>
              <div style={{ background: "var(--bg-card)", borderTop: "3px solid #f472b6", padding: "14px 20px", fontSize: 11, fontWeight: 700, letterSpacing: "0.2em", textTransform: "uppercase", color: "#f472b6" }}>
                {tt(lang, "matchdetail.previousEncounters")}
              </div>
              <div style={{ background: "var(--bg-card)", padding: "20px 24px" }}>
                {prevEncounters.length === 0 ? (
                  <div style={{ fontSize: 13, color: "var(--text-faint)", textAlign: "center", padding: "16px 0" }}>
                    {tt(lang, "matchdetail.noPrevious")}
                  </div>
                ) : (
                  <>
                    {/* H2H Summary */}
                    <div style={{ display: "flex", justifyContent: "center", gap: 0, marginBottom: 20 }}>
                      <div style={{ flex: 1, textAlign: "center", padding: "12px 16px", background: "var(--bg-row)", borderLeft: "3px solid #4ea8f7" }}>
                        <div style={{ fontSize: 28, fontWeight: 900, color: "#4ea8f7" }}>{homeW}</div>
                        <div style={{ fontSize: 10, color: "var(--text-faint)", letterSpacing: "0.15em", textTransform: "uppercase", marginTop: 4 }}>{match.home_team}</div>
                      </div>
                      <div style={{ flex: 1, textAlign: "center", padding: "12px 16px", background: "var(--bg-row)", borderLeft: "1px solid var(--border-main)" }}>
                        <div style={{ fontSize: 28, fontWeight: 900, color: "var(--text-muted)" }}>{draws}</div>
                        <div style={{ fontSize: 10, color: "var(--text-faint)", letterSpacing: "0.15em", textTransform: "uppercase", marginTop: 4 }}>{tt(lang, "matchdetail.draws")}</div>
                      </div>
                      <div style={{ flex: 1, textAlign: "center", padding: "12px 16px", background: "var(--bg-row)", borderLeft: "1px solid var(--border-main)", borderRight: "3px solid #a78bfa" }}>
                        <div style={{ fontSize: 28, fontWeight: 900, color: "#a78bfa" }}>{awayW}</div>
                        <div style={{ fontSize: 10, color: "var(--text-faint)", letterSpacing: "0.15em", textTransform: "uppercase", marginTop: 4 }}>{match.away_team}</div>
                      </div>
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text-faint)", textAlign: "center", marginBottom: 16, letterSpacing: "0.08em" }}>
                      {tt(lang, "matchdetail.goals")} {homeGF} – {awayGF} &nbsp;·&nbsp; {prevEncounters.length === 1 ? tt(lang, "matchdetail.matchCountOne", { n: prevEncounters.length }) : tt(lang, "matchdetail.matchCount", { n: prevEncounters.length })}
                    </div>
                    {/* Match list */}
                    <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                      {prevEncounters.map((e: any) => {
                        const eIsHome = e.home_team === match.home_team;
                        const myScore = eIsHome ? e.home_score : e.away_score;
                        const oppScore = eIsHome ? e.away_score : e.home_score;
                        const result = myScore > oppScore ? "W" : myScore < oppScore ? "L" : "D";
                        const resultColor = result === "W" ? "#4ade80" : result === "L" ? "#e63946" : "#f4c430";
                        const league = e.league;
                        return (
                          <Link key={e.id} href={`/matches/${e.id}`} style={{ textDecoration: "none" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", background: "var(--bg-row)", borderLeft: `3px solid ${resultColor}`, transition: "background 0.1s" }} className="nav-card">
                              <div style={{ width: 20, height: 20, borderRadius: 4, background: resultColor + "22", color: resultColor, fontSize: 11, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{result}</div>
                              <div style={{ fontWeight: 700, fontSize: 14, color: "var(--text-body)", flexShrink: 0 }}>
                                {e.home_score} – {e.away_score}
                              </div>
                              <div style={{ fontSize: 13, color: "var(--text-muted)", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {e.home_team} vs {e.away_team}
                              </div>
                              {league && (
                                <div style={{ fontSize: 10, color: "var(--text-faint)", letterSpacing: "0.08em", flexShrink: 0 }}>
                                  {league.name}{league.season ? ` S${league.season}` : ""}
                                </div>
                              )}
                              <div style={{ fontSize: 11, color: "var(--text-faint)", letterSpacing: "0.05em", flexShrink: 0 }}>
                                {new Date(e.played_at).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}
                              </div>
                            </div>
                          </Link>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            </div>
          );
        })()}

        {/* Predicted Lineup — unplayed matches only */}
        {!played && (homeBestXI.length > 0 || awayBestXI.length > 0) && (
          <div>
            <div style={{ background: "var(--bg-card)", borderTop: "3px solid #a78bfa", padding: "14px 20px", fontSize: 11, fontWeight: 700, letterSpacing: "0.2em", textTransform: "uppercase", color: "#a78bfa", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span>{tt(lang, "matchdetail.predictedLineup")}</span>
              <span style={{ fontSize: 10, color: "var(--text-faint)", fontWeight: 400, letterSpacing: "0.08em", textTransform: "none" }}>{tt(lang, "matchdetail.lineupBased")}</span>
            </div>
            <div style={{ background: "var(--bg-card)" }}>
              {/* Column headers */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 52px 1fr", borderBottom: "1px solid var(--border-main)" }}>
                <div style={{ padding: "10px 16px", fontSize: 11, fontWeight: 800, color: "#4ea8f7", letterSpacing: "0.1em", textTransform: "uppercase" }}>{match.home_team}</div>
                <div style={{ padding: "10px 0", fontSize: 10, fontWeight: 700, color: "var(--text-faint)", letterSpacing: "0.12em", textTransform: "uppercase", textAlign: "center" }}>{tt(lang, "matchdetail.pos")}</div>
                <div style={{ padding: "10px 16px", fontSize: 11, fontWeight: 800, color: "#a78bfa", letterSpacing: "0.1em", textTransform: "uppercase", textAlign: "right" }}>{match.away_team}</div>
              </div>
              {/* One row per slot */}
              {LINEUP_DISPLAY_ORDER.map((slot, i) => {
                const homeSlot = homeBestXI.find((s: LineupSlot) => s.slot === slot);
                const awaySlot = awayBestXI.find((s: LineupSlot) => s.slot === slot);
                const hp = homeSlot?.player ?? null;
                const ap = awaySlot?.player ?? null;
                return (
                  <div key={slot} style={{ display: "grid", gridTemplateColumns: "1fr 52px 1fr", background: i % 2 === 0 ? "var(--bg-row)" : "transparent", borderBottom: "1px solid var(--border-row)" }}>
                    {/* Home player */}
                    <div style={{ padding: "10px 16px", display: "flex", alignItems: "center", gap: 8 }}>
                      {hp ? (
                        <Link href={`/players/${hp.playerId}`} style={{ textDecoration: "none", display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0 }}>
                          <div style={{ flex: 1, fontSize: 13, color: "var(--text-body)", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{hp.name}</div>
                          {hp.rating !== null ? (
                            <div style={{ fontSize: 12, fontWeight: 900, color: getRatingColor(hp.rating), flexShrink: 0 }}>{hp.rating}</div>
                          ) : (
                            <div style={{ fontSize: 11, color: "var(--text-faint)", flexShrink: 0 }}>—</div>
                          )}
                        </Link>
                      ) : (
                        <div style={{ fontSize: 12, color: "var(--text-faint)", fontStyle: "italic" }}>{tt(lang, "matchdetail.tbd")}</div>
                      )}
                    </div>
                    {/* Slot label */}
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <div style={{ fontSize: 9, fontWeight: 800, color: "var(--text-faint)", letterSpacing: "0.1em", background: "var(--bg-nav)", padding: "3px 6px", textAlign: "center" }}>{slot}</div>
                    </div>
                    {/* Away player */}
                    <div style={{ padding: "10px 16px", display: "flex", alignItems: "center", gap: 8, justifyContent: "flex-end" }}>
                      {ap ? (
                        <Link href={`/players/${ap.playerId}`} style={{ textDecoration: "none", display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                          {ap.rating !== null ? (
                            <div style={{ fontSize: 12, fontWeight: 900, color: getRatingColor(ap.rating), flexShrink: 0 }}>{ap.rating}</div>
                          ) : (
                            <div style={{ fontSize: 11, color: "var(--text-faint)", flexShrink: 0 }}>—</div>
                          )}
                          <div style={{ fontSize: 13, color: "var(--text-body)", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: "right" }}>{ap.name}</div>
                        </Link>
                      ) : (
                        <div style={{ fontSize: 12, color: "var(--text-faint)", fontStyle: "italic" }}>{tt(lang, "matchdetail.tbd")}</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Team Stats */}
        {(homeStats || awayStats) && (
          <div>
            <div style={{ background: "var(--bg-card)", borderTop: "3px solid #4ea8f7", padding: "14px 20px", fontSize: 11, fontWeight: 700, letterSpacing: "0.2em", textTransform: "uppercase", color: "#4ea8f7" }}>
              {tt(lang, "matchdetail.teamStats")}
            </div>
            <div style={{ background: "var(--bg-card)", overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ background: "var(--bg-row)" }}>
                    <th style={{ padding: "10px 24px", textAlign: "right", fontSize: 13, fontWeight: 800, color: "var(--text-body)", borderBottom: "1px solid var(--border-main)", width: "38%" }}>
                      {teamIds.get(match.home_team) ? <Link href={`/teams/${teamIds.get(match.home_team)}`} style={{ color: "inherit", textDecoration: "none" }} className="hover:underline">{match.home_team}</Link> : match.home_team}
                    </th>
                    <th style={{ padding: "10px 16px", textAlign: "center", fontSize: 10, color: "var(--text-faint)", fontWeight: 700, letterSpacing: "0.15em", textTransform: "uppercase", borderBottom: "1px solid var(--border-main)", width: "24%" }}>{tt(lang, "matchdetail.stat")}</th>
                    <th style={{ padding: "10px 24px", textAlign: "left", fontSize: 13, fontWeight: 800, color: "var(--text-body)", borderBottom: "1px solid var(--border-main)", width: "38%" }}>
                      {teamIds.get(match.away_team) ? <Link href={`/teams/${teamIds.get(match.away_team)}`} style={{ color: "inherit", textDecoration: "none" }} className="hover:underline">{match.away_team}</Link> : match.away_team}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {TEAM_STAT_ROWS.map(([label, key, isPct]) => {
                    const hv = homeStats ? (homeStats as any)[key] ?? 0 : 0;
                    const av = awayStats ? (awayStats as any)[key] ?? 0 : 0;
                    const fmt = (v: any) => isPct ? `${Number(v).toFixed(1)}%` : String(v ?? 0);
                    const hWin = hv > av;
                    const aWin = av > hv;
                    return (
                      <tr key={key} style={{ borderBottom: "1px solid var(--border-row)" }}>
                        <td style={{ padding: "9px 24px", textAlign: "right", fontWeight: hWin ? 800 : 400, color: hWin ? "var(--text-body)" : "var(--text-muted)", fontSize: 15 }}>{fmt(hv)}</td>
                        <td style={{ padding: "9px 16px", textAlign: "center", fontSize: 10, color: "var(--text-faint)", letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 600 }}>{tt(lang, label)}</td>
                        <td style={{ padding: "9px 24px", textAlign: "left", fontWeight: aWin ? 800 : 400, color: aWin ? "var(--text-body)" : "var(--text-muted)", fontSize: 15 }}>{fmt(av)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Player Stats — interactive client component */}
        <PlayerStatsTable
          playerStats={enrichedPlayerStats}
          homeTeam={match.home_team}
          awayTeam={match.away_team}
        />
      </div>
    </main>
  );
}
