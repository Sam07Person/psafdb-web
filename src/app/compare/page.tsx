"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/lib/supabaseClient";
import Link from "next/link";
import {
  calcMatchRating,
  calcOverallRating,
  getRatingColor,
  getRatingLabel,
  DEFAULT_TIER_BONUSES,
  type MatchStatRow,
  type MatchResult,
} from "@/lib/ratings";

const C1 = "#4ea8f7"; // blue  — player 1
const C2 = "#a78bfa"; // purple — player 2

type PlayerRow = { id: string; handle: string | null; name: string | null; game_user_id: string | null };

type PlayerStats = {
  player: PlayerRow;
  matchesPlayed: number;
  matchesWithStats: number;
  wins: number; draws: number; losses: number;
  goals: number; assists: number; shots: number; shotsOnTarget: number;
  passes: number; keyPasses: number;
  tackles: number; keyTackles: number;
  interceptions: number; keyInterceptions: number;
  possLost: number; gkSaves: number; gkCatches: number;
  avgScore: number;
  overallRating: number | null;
  ratingColor: string;
  mostPlayedPos: string | null;
};

async function loadPlayerStats(
  playerId: string,
  tierBonuses: Record<number, number>
): Promise<PlayerStats | null> {
  if (!supabase) return null;

  const [playerRes, statsRes] = await Promise.all([
    supabase.from("players").select("id,handle,name,game_user_id").eq("id", playerId).single(),
    supabase
      .from("match_player_stats")
      .select(
        "team_side,position,score,passes,key_passes,assists,shots,shots_on_target,goals,tackles,key_tackles,interceptions,key_interceptions,possessions_lost,gk_saves,gk_catches,benched,stats_incomplete,matches(id,home_score,away_score,leagues(tier))"
      )
      .eq("player_id", playerId),
  ]);

  if (!playerRes.data) return null;
  const player = playerRes.data as PlayerRow;

  const stats = (statsRes.data ?? []).map((s: any) => {
    const rawMatch = Array.isArray(s.matches) ? s.matches[0] ?? null : s.matches ?? null;
    const leagues = rawMatch?.leagues;
    return {
      ...s,
      benched: s.benched ?? false,
      stats_incomplete: s.stats_incomplete ?? false,
      matches: rawMatch
        ? { ...rawMatch, leagues: Array.isArray(leagues) ? leagues[0] ?? null : leagues ?? null }
        : null,
    };
  });

  const played = stats.filter((s: any) => !s.benched);
  const withStats = played.filter((s: any) => !s.stats_incomplete && s.matches);

  let wins = 0, draws = 0, losses = 0, totalScore = 0;
  let goals = 0, assists = 0, shots = 0, shotsOnTarget = 0;
  let passes = 0, keyPasses = 0, tackles = 0, keyTackles = 0;
  let interceptions = 0, keyInterceptions = 0, possLost = 0;
  let gkSaves = 0, gkCatches = 0;

  for (const s of played) {
    totalScore += s.score ?? 0;
    if (s.matches) {
      const isHome = s.team_side === "home";
      const my = isHome ? s.matches.home_score : s.matches.away_score;
      const opp = isHome ? s.matches.away_score : s.matches.home_score;
      if (my > opp) wins++; else if (my < opp) losses++; else draws++;
    }
    if (!s.stats_incomplete) {
      goals += s.goals ?? 0; assists += s.assists ?? 0; shots += s.shots ?? 0;
      shotsOnTarget += s.shots_on_target ?? 0; passes += s.passes ?? 0;
      keyPasses += s.key_passes ?? 0; tackles += s.tackles ?? 0;
      keyTackles += s.key_tackles ?? 0; interceptions += s.interceptions ?? 0;
      keyInterceptions += s.key_interceptions ?? 0; possLost += s.possessions_lost ?? 0;
      gkSaves += s.gk_saves ?? 0; gkCatches += s.gk_catches ?? 0;
    }
  }

  // Rating
  const tierCounts: Record<number, number> = {};
  for (const s of withStats) {
    const t = s.matches?.leagues?.tier ?? 2;
    tierCounts[t] = (tierCounts[t] ?? 0) + 1;
  }
  const dominantTier = parseInt(
    Object.entries(tierCounts).sort((a, b) => Number(b[1]) - Number(a[1]))[0]?.[0] ?? "2"
  );

  const posCounts: Record<string, number> = {};
  for (const s of withStats) if (s.position) posCounts[s.position] = (posCounts[s.position] ?? 0) + 1;
  const dominantPos = Object.entries(posCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  const statRows: MatchStatRow[] = withStats.map((s: any) => {
    const isHome = s.team_side === "home";
    return {
      goals: s.goals ?? 0, assists: s.assists ?? 0, key_passes: s.key_passes ?? 0,
      shots_on_target: s.shots_on_target ?? 0, passes: s.passes ?? 0,
      tackles: s.tackles ?? 0, key_tackles: s.key_tackles ?? 0,
      interceptions: s.interceptions ?? 0, key_interceptions: s.key_interceptions ?? 0,
      possessions_lost: s.possessions_lost ?? 0, gk_saves: s.gk_saves ?? 0, gk_catches: s.gk_catches ?? 0,
      goals_conceded: isHome ? s.matches.away_score : s.matches.home_score,
      score: s.score ?? 0, position: s.position,
    };
  });

  const results: MatchResult[] = withStats.map((s: any) => {
    const isHome = s.team_side === "home";
    const my = isHome ? s.matches.home_score : s.matches.away_score;
    const opp = isHome ? s.matches.away_score : s.matches.home_score;
    return my > opp ? "W" : my < opp ? "L" : "D";
  });

  const matchRatings = statRows.map((row, i) =>
    calcMatchRating(row, results[i], row.position ?? dominantPos)
  );
  const overallRating = matchRatings.length >= 3
    ? calcOverallRating(matchRatings, dominantTier, tierBonuses)
    : null;

  const allPosCounts: Record<string, number> = {};
  for (const s of played) if (s.position) allPosCounts[s.position] = (allPosCounts[s.position] ?? 0) + 1;
  const mostPlayedPos = Object.entries(allPosCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  return {
    player, matchesPlayed: played.length, matchesWithStats: withStats.length,
    wins, draws, losses, goals, assists, shots, shotsOnTarget,
    passes, keyPasses, tackles, keyTackles, interceptions, keyInterceptions,
    possLost, gkSaves, gkCatches,
    avgScore: played.length > 0 ? totalScore / played.length : 0,
    overallRating,
    ratingColor: overallRating !== null ? getRatingColor(overallRating) : "#666",
    mostPlayedPos,
  };
}

// ── Sub-components ──────────────────────────────────────────────────────────

function CompareBar({ v1, v2, lowerBetter = false }: { v1: number; v2: number; lowerBetter?: boolean }) {
  const total = v1 + v2;
  if (total === 0) return <div style={{ height: 4, background: "var(--border-main)", borderRadius: 2 }} />;
  const pct1 = (v1 / total) * 100;
  const win1 = lowerBetter ? v1 < v2 : v1 > v2;
  const win2 = lowerBetter ? v2 < v1 : v2 > v1;
  return (
    <div style={{ height: 4, display: "flex", borderRadius: 2, overflow: "hidden" }}>
      <div style={{ width: `${pct1}%`, background: win1 ? C1 : win2 ? `${C1}35` : `${C1}55`, transition: "width 0.4s" }} />
      <div style={{ flex: 1, background: win2 ? C2 : win1 ? `${C2}35` : `${C2}55`, transition: "flex 0.4s" }} />
    </div>
  );
}

function StatRow({
  label, v1, v2, lowerBetter = false, decimals = 0, suffix = "",
}: {
  label: string; v1: number; v2: number; lowerBetter?: boolean; decimals?: number; suffix?: string;
}) {
  const win1 = lowerBetter ? v1 < v2 : v1 > v2;
  const win2 = lowerBetter ? v2 < v1 : v2 > v1;
  const fmt = (n: number) => `${n.toFixed(decimals)}${suffix}`;
  return (
    <div style={{ padding: "10px 20px", borderBottom: "1px solid var(--border-row)" }}>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 5 }}>
        <span style={{
          flex: 1, textAlign: "right", fontWeight: win1 ? 800 : 400,
          fontSize: 14, color: win1 ? C1 : "var(--text-sub)", fontVariantNumeric: "tabular-nums",
        }}>
          {fmt(v1)}
        </span>
        <span style={{
          width: 160, textAlign: "center", fontSize: 10, color: "var(--text-faint)",
          letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 600, flexShrink: 0,
        }}>
          {label}
        </span>
        <span style={{
          flex: 1, fontWeight: win2 ? 800 : 400,
          fontSize: 14, color: win2 ? C2 : "var(--text-sub)", fontVariantNumeric: "tabular-nums",
        }}>
          {fmt(v2)}
        </span>
      </div>
      <CompareBar v1={v1} v2={v2} lowerBetter={lowerBetter} />
    </div>
  );
}

function SectionHeader({ label, color }: { label: string; color: string }) {
  return (
    <div style={{
      padding: "10px 20px", fontSize: 10, fontWeight: 700, letterSpacing: "0.2em",
      textTransform: "uppercase", color, borderBottom: "1px solid var(--border-main)",
    }}>
      {label}
    </div>
  );
}

function PlayerPanel({
  slot, color, onSelect,
}: {
  slot: 1 | 2; color: string;
  onSelect: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PlayerRow[]>([]);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const search = useCallback(async (q: string) => {
    if (!supabase || q.length < 2) { setResults([]); setOpen(false); return; }
    setSearching(true);
    const [r1, r2] = await Promise.all([
      supabase.from("players").select("id,handle,name,game_user_id").ilike("name", `%${q}%`).limit(6),
      supabase.from("players").select("id,handle,name,game_user_id").ilike("handle", `%${q}%`).limit(6),
    ]);
    const seen = new Set<string>();
    const merged: PlayerRow[] = [];
    for (const p of [...(r1.data ?? []), ...(r2.data ?? [])]) {
      if (!seen.has(p.id)) { seen.add(p.id); merged.push(p as PlayerRow); }
    }
    setResults(merged.slice(0, 8));
    setOpen(merged.length > 0);
    setSearching(false);
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const q = e.target.value;
    setQuery(q);
    clearTimeout(debounce.current);
    debounce.current = setTimeout(() => search(q), 280);
  };

  const handleSelect = (p: PlayerRow) => {
    setQuery(p.name || p.handle || p.id);
    setOpen(false);
    onSelect(p.id);
  };

  return (
    <div style={{ position: "relative" }}>
      <div style={{
        fontSize: 10, fontWeight: 700, letterSpacing: "0.2em",
        textTransform: "uppercase", color, marginBottom: 8,
      }}>
        Player {slot}
      </div>
      <input
        value={query}
        onChange={handleChange}
        onFocus={() => results.length > 0 && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 160)}
        placeholder="Search by name or handle…"
        style={{
          width: "100%", padding: "10px 14px", background: "var(--bg-card)",
          border: `1.5px solid ${query ? color + "80" : "var(--border-main)"}`,
          color: "var(--text-main)", fontSize: 13, outline: "none", boxSizing: "border-box",
        }}
      />
      {searching && (
        <div style={{ position: "absolute", right: 12, top: "50%", fontSize: 11, color: "var(--text-faint)" }}>…</div>
      )}
      {open && (
        <div style={{
          position: "absolute", top: "100%", left: 0, right: 0, zIndex: 50,
          background: "var(--bg-nav)", border: "1px solid var(--border-main)", borderTop: "none",
          maxHeight: 280, overflowY: "auto",
        }}>
          {results.map(p => (
            <div
              key={p.id}
              onMouseDown={() => handleSelect(p)}
              className="nav-card"
              style={{ padding: "10px 14px", cursor: "pointer", borderBottom: "1px solid var(--border-row)" }}
            >
              <div style={{ fontWeight: 700, fontSize: 13, color: "var(--text-body)" }}>
                {p.name || p.handle}
              </div>
              {p.name && p.handle && (
                <div style={{ fontSize: 11, color: "var(--text-faint)" }}>@{p.handle}</div>
              )}
              {p.game_user_id && (
                <div style={{ fontSize: 10, color: "var(--text-faint)", fontFamily: "monospace" }}>
                  {p.game_user_id}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PlayerCard({ stats, loading, color }: { stats: PlayerStats | null; loading: boolean; color: string }) {
  if (loading) {
    return (
      <div style={{ background: "var(--bg-card)", borderTop: `3px solid ${color}`, padding: "20px", minHeight: 80 }}>
        <div style={{ color: "var(--text-faint)", fontSize: 13 }}>Loading…</div>
      </div>
    );
  }
  if (!stats) return <div style={{ background: "var(--bg-card)", borderTop: `3px solid ${color}`, minHeight: 80 }} />;

  return (
    <div style={{ background: "var(--bg-card)", borderTop: `3px solid ${color}`, padding: "16px 20px" }}>
      <Link href={`/players/${stats.player.id}`} style={{ textDecoration: "none" }}>
        <div style={{ fontWeight: 800, fontSize: 16, color: "var(--text-main)" }}>
          {stats.player.name || stats.player.handle}
        </div>
        {stats.player.name && stats.player.handle && (
          <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 2 }}>@{stats.player.handle}</div>
        )}
      </Link>
      <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap", alignItems: "center" }}>
        {stats.mostPlayedPos && (
          <span style={{
            fontSize: 11, padding: "2px 8px",
            border: "1px solid var(--border-main)", color: "var(--text-muted)",
          }}>
            {stats.mostPlayedPos}
          </span>
        )}
        {stats.overallRating !== null ? (
          <span style={{
            fontSize: 12, padding: "2px 10px", fontWeight: 800,
            border: `1px solid ${stats.ratingColor}50`,
            background: `${stats.ratingColor}18`, color: stats.ratingColor,
          }}>
            {stats.overallRating} · {getRatingLabel(stats.overallRating)}
          </span>
        ) : (
          <span style={{ fontSize: 11, color: "var(--text-faint)" }}>Rating N/A (&lt;3 matches)</span>
        )}
        <span style={{ fontSize: 11, color: "var(--text-faint)" }}>
          {stats.matchesPlayed} apps
        </span>
        <span style={{ fontSize: 11, color: "var(--text-faint)" }}>
          {stats.wins}W {stats.draws}D {stats.losses}L
        </span>
      </div>
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────

export default function ComparePage() {
  const [tierBonuses, setTierBonuses] = useState<Record<number, number>>(DEFAULT_TIER_BONUSES);
  const [p1Id, setP1Id] = useState<string | null>(null);
  const [p2Id, setP2Id] = useState<string | null>(null);
  const [p1Stats, setP1Stats] = useState<PlayerStats | null>(null);
  const [p2Stats, setP2Stats] = useState<PlayerStats | null>(null);
  const [loading1, setLoading1] = useState(false);
  const [loading2, setLoading2] = useState(false);

  useEffect(() => {
    fetch("/api/admin/settings")
      .then(r => r.json())
      .then(d => {
        const settings = Array.isArray(d) ? d : Array.isArray(d.tierSettings) ? d.tierSettings : null;
        if (settings) {
          const map: Record<number, number> = {};
          for (const row of settings) map[row.tier] = row.bonus;
          setTierBonuses(map);
        }
      })
      .catch(() => {});
  }, []);

  const handleSelect1 = useCallback(async (id: string) => {
    setP1Id(id); setP1Stats(null); setLoading1(true);
    setP1Stats(await loadPlayerStats(id, tierBonuses));
    setLoading1(false);
  }, [tierBonuses]);

  const handleSelect2 = useCallback(async (id: string) => {
    setP2Id(id); setP2Stats(null); setLoading2(true);
    setP2Stats(await loadPlayerStats(id, tierBonuses));
    setLoading2(false);
  }, [tierBonuses]);

  const handleSwap = () => {
    const [ti, ts] = [p1Id, p1Stats];
    setP1Id(p2Id); setP1Stats(p2Stats);
    setP2Id(ti); setP2Stats(ts);
  };

  const both = p1Stats && p2Stats;
  // Per-match denominators (use matchesWithStats for detailed stats)
  const n1 = Math.max(p1Stats?.matchesWithStats ?? 0, 1);
  const n2 = Math.max(p2Stats?.matchesWithStats ?? 0, 1);
  const pm1 = (v: number) => (p1Stats?.matchesWithStats ?? 0) > 0 ? v / n1 : 0;
  const pm2 = (v: number) => (p2Stats?.matchesWithStats ?? 0) > 0 ? v / n2 : 0;
  const wr1 = p1Stats && p1Stats.matchesPlayed > 0 ? (p1Stats.wins / p1Stats.matchesPlayed) * 100 : 0;
  const wr2 = p2Stats && p2Stats.matchesPlayed > 0 ? (p2Stats.wins / p2Stats.matchesPlayed) * 100 : 0;
  const showGK = both && (p1Stats.gkSaves + p1Stats.gkCatches + p2Stats.gkSaves + p2Stats.gkCatches > 0);

  return (
    <main style={{ minHeight: "calc(100vh - 56px)" }}>
      {/* Page header */}
      <section style={{ borderBottom: "1px solid var(--border-main)", padding: "32px 24px 24px", background: "var(--bg-nav)" }}>
        <div style={{ maxWidth: 900, margin: "0 auto" }}>
          <div style={{ fontSize: 11, letterSpacing: "0.25em", color: "var(--text-faint)", fontWeight: 700, textTransform: "uppercase", marginBottom: 14 }}>
            <Link href="/" style={{ color: "var(--text-faint)", textDecoration: "none" }}>Home</Link>
            <span style={{ margin: "0 8px" }}>/</span>
            Compare
          </div>
          <h1 style={{ fontSize: 28, fontWeight: 900, letterSpacing: "-0.02em", color: "var(--text-main)", margin: 0 }}>
            Player Comparison
          </h1>
          <p style={{ marginTop: 8, color: "var(--text-muted)", fontSize: 13 }}>
            Search for two players to compare their stats and ratings head-to-head.
          </p>
        </div>
      </section>

      {/* Search + player cards */}
      <div style={{ maxWidth: 900, margin: "0 auto", padding: "24px 24px 0" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 44px 1fr", gap: 12, alignItems: "end" }}>
          <PlayerPanel slot={1} color={C1} onSelect={handleSelect1} />
          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "center", paddingBottom: 2 }}>
            <button
              onClick={handleSwap}
              disabled={!p1Stats && !p2Stats}
              title="Swap players"
              style={{
                width: 36, height: 36, background: "var(--bg-card)", border: "1px solid var(--border-main)",
                color: "var(--text-muted)", cursor: (p1Stats || p2Stats) ? "pointer" : "default",
                fontSize: 18, display: "flex", alignItems: "center", justifyContent: "center",
                opacity: (p1Stats || p2Stats) ? 1 : 0.35, transition: "opacity 0.2s",
              }}
            >
              ⇄
            </button>
          </div>
          <PlayerPanel slot={2} color={C2} onSelect={handleSelect2} />
        </div>

        {(p1Id || p2Id) && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 44px 1fr", gap: 12, marginTop: 12 }}>
            <PlayerCard stats={p1Stats} loading={loading1} color={C1} />
            <div />
            <PlayerCard stats={p2Stats} loading={loading2} color={C2} />
          </div>
        )}
      </div>

      {/* Comparison table */}
      {both && (
        <div style={{ maxWidth: 900, margin: "20px auto 64px", padding: "0 24px" }}>
          {/* Legend */}
          <div style={{ display: "flex", gap: 24, justifyContent: "center", marginBottom: 16 }}>
            {([
              { color: C1, name: p1Stats.player.name || p1Stats.player.handle },
              { color: C2, name: p2Stats.player.name || p2Stats.player.handle },
            ] as const).map(({ color, name }) => (
              <div key={color} style={{ display: "flex", alignItems: "center", gap: 7 }}>
                <div style={{ width: 10, height: 10, borderRadius: 2, background: color }} />
                <span style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 600 }}>{name}</span>
              </div>
            ))}
          </div>

          {/* ── Overview ── */}
          <div style={{ background: "var(--bg-card)", borderTop: "3px solid var(--border-main)", marginBottom: 2 }}>
            <SectionHeader label="Overview" color="var(--text-muted)" />

            {/* Overall rating — big numbers */}
            <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--border-row)" }}>
              <div style={{ display: "flex", alignItems: "center", marginBottom: 8 }}>
                <div style={{ flex: 1, textAlign: "right" }}>
                  {p1Stats.overallRating !== null
                    ? <span style={{ fontSize: 32, fontWeight: 900, color: p1Stats.ratingColor, fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>{p1Stats.overallRating}</span>
                    : <span style={{ fontSize: 13, color: "var(--text-faint)" }}>N/A</span>}
                </div>
                <span style={{ width: 160, textAlign: "center", fontSize: 10, color: "var(--text-faint)", letterSpacing: "0.12em", textTransform: "uppercase", fontWeight: 700, flexShrink: 0 }}>
                  Overall Rating
                </span>
                <div style={{ flex: 1 }}>
                  {p2Stats.overallRating !== null
                    ? <span style={{ fontSize: 32, fontWeight: 900, color: p2Stats.ratingColor, fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>{p2Stats.overallRating}</span>
                    : <span style={{ fontSize: 13, color: "var(--text-faint)" }}>N/A</span>}
                </div>
              </div>
              {p1Stats.overallRating !== null && p2Stats.overallRating !== null && (
                <CompareBar v1={p1Stats.overallRating} v2={p2Stats.overallRating} />
              )}
            </div>

            <StatRow label="Matches Played" v1={p1Stats.matchesPlayed} v2={p2Stats.matchesPlayed} />
            <StatRow label="Wins" v1={p1Stats.wins} v2={p2Stats.wins} />
            <StatRow label="Draws" v1={p1Stats.draws} v2={p2Stats.draws} />
            <StatRow label="Losses" v1={p1Stats.losses} v2={p2Stats.losses} lowerBetter />
            <StatRow label="Win Rate %" v1={wr1} v2={wr2} decimals={1} suffix="%" />
            <StatRow label="Avg Score" v1={p1Stats.avgScore} v2={p2Stats.avgScore} decimals={2} />
          </div>

          {/* ── Attacking ── */}
          <div style={{ background: "var(--bg-card)", borderTop: "3px solid #e63946", marginBottom: 2 }}>
            <SectionHeader label="Attacking · per match" color="#e63946" />
            <StatRow label="Goals (total)" v1={p1Stats.goals} v2={p2Stats.goals} />
            <StatRow label="Assists (total)" v1={p1Stats.assists} v2={p2Stats.assists} />
            <StatRow label="G + A" v1={p1Stats.goals + p1Stats.assists} v2={p2Stats.goals + p2Stats.assists} />
            <StatRow label="Goals / Match" v1={pm1(p1Stats.goals)} v2={pm2(p2Stats.goals)} decimals={2} />
            <StatRow label="Assists / Match" v1={pm1(p1Stats.assists)} v2={pm2(p2Stats.assists)} decimals={2} />
            <StatRow label="Key Passes / M" v1={pm1(p1Stats.keyPasses)} v2={pm2(p2Stats.keyPasses)} decimals={2} />
            <StatRow label="Shots on Target / M" v1={pm1(p1Stats.shotsOnTarget)} v2={pm2(p2Stats.shotsOnTarget)} decimals={2} />
          </div>

          {/* ── Defending ── */}
          <div style={{ background: "var(--bg-card)", borderTop: "3px solid #4ade80", marginBottom: 2 }}>
            <SectionHeader label="Defending · per match" color="#4ade80" />
            <StatRow label="Tackles / Match" v1={pm1(p1Stats.tackles)} v2={pm2(p2Stats.tackles)} decimals={2} />
            <StatRow label="Key Tackles / M" v1={pm1(p1Stats.keyTackles)} v2={pm2(p2Stats.keyTackles)} decimals={2} />
            <StatRow label="Interceptions / M" v1={pm1(p1Stats.interceptions)} v2={pm2(p2Stats.interceptions)} decimals={2} />
            <StatRow label="Key Ints / M" v1={pm1(p1Stats.keyInterceptions)} v2={pm2(p2Stats.keyInterceptions)} decimals={2} />
            <StatRow label="Poss. Lost / M" v1={pm1(p1Stats.possLost)} v2={pm2(p2Stats.possLost)} decimals={2} lowerBetter />
          </div>

          {/* ── Passing ── */}
          <div style={{ background: "var(--bg-card)", borderTop: `3px solid ${C1}`, marginBottom: 2 }}>
            <SectionHeader label="Passing · per match" color={C1} />
            <StatRow label="Passes / Match" v1={pm1(p1Stats.passes)} v2={pm2(p2Stats.passes)} decimals={1} />
            <StatRow label="Key Passes / M" v1={pm1(p1Stats.keyPasses)} v2={pm2(p2Stats.keyPasses)} decimals={2} />
          </div>

          {/* ── GK (conditional) ── */}
          {showGK && (
            <div style={{ background: "var(--bg-card)", borderTop: "3px solid #f4c430", marginBottom: 2 }}>
              <SectionHeader label="Goalkeeper · per match" color="#f4c430" />
              <StatRow label="Saves / Match" v1={pm1(p1Stats.gkSaves)} v2={pm2(p2Stats.gkSaves)} decimals={2} />
              <StatRow label="Catches / Match" v1={pm1(p1Stats.gkCatches)} v2={pm2(p2Stats.gkCatches)} decimals={2} />
            </div>
          )}

          {/* Footer note */}
          <div style={{ marginTop: 12, fontSize: 11, color: "var(--text-faint)", textAlign: "center" }}>
            Per-match stats based on matches with complete data · {p1Stats.matchesWithStats} vs {p2Stats.matchesWithStats} qualifying matches
          </div>
        </div>
      )}

      {/* Empty state */}
      {!p1Id && !p2Id && (
        <div style={{ maxWidth: 900, margin: "56px auto", padding: "0 24px", textAlign: "center" }}>
          <div style={{ fontSize: 36, marginBottom: 14 }}>⚡</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text-sub)", marginBottom: 8 }}>
            Head-to-head comparison
          </div>
          <div style={{ fontSize: 13, color: "var(--text-faint)" }}>
            Search for two players above to compare their career stats and ratings.
          </div>
        </div>
      )}
    </main>
  );
}
