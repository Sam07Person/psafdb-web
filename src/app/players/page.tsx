"use client";

import { useEffect, useMemo, useState } from "react";
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

type PlayerRow = {
  id: string;
  handle: string | null;
  name: string | null;
  game_user_id: string | null;
  created_at: string | null;
};

type PlayerWithStats = PlayerRow & {
  matches_played: number;
  total_goals: number;
  total_assists: number;
  rating: number | null;
  dominant_position: string | null;
};

type RawStatRow = {
  player_id: string;
  team_side: "home" | "away" | null;
  goals: number | null;
  assists: number | null;
  key_passes: number | null;
  shots_on_target: number | null;
  passes: number | null;
  tackles: number | null;
  key_tackles: number | null;
  interceptions: number | null;
  key_interceptions: number | null;
  possessions_lost: number | null;
  gk_saves: number | null;
  gk_catches: number | null;
  score: number | null;
  position: string | null;
  benched: boolean | null;
  stats_incomplete: boolean | null;
  matches: { home_score: number | null; away_score: number | null; leagues: { tier: number | null; use_tier_bonus: boolean | null } | null } | null;
};

function cx(...s: Array<string | false | null | undefined>) {
  return s.filter(Boolean).join(" ");
}

export default function PlayersPage() {
  const [players, setPlayers] = useState<PlayerWithStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<any>(null);
  const [tierBonuses, setTierBonuses] = useState<Record<number, number>>(DEFAULT_TIER_BONUSES);

  const [q, setQ] = useState("");
  const [sortKey, setSortKey] = useState<"name" | "matches_played" | "total_goals" | "total_assists" | "rating">("rating");
  const [sortDir, setSortDir] = useState<"desc" | "asc">("desc");

  useEffect(() => {
    fetch("/api/admin/settings")
      .then(r => r.json())
      .then(d => {
        if (Array.isArray(d.tierSettings)) {
          const map: Record<number, number> = {};
          for (const row of d.tierSettings) map[row.tier] = row.bonus;
          setTierBonuses(map);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!supabase) return;

    (async () => {
      setLoading(true);

      // Fetch all players
      const { data: playersData, error: playersError } = await supabase
        .from("players")
        .select("id,handle,name,game_user_id,created_at")
        .order("created_at", { ascending: false });

      if (playersError) {
        setError(playersError);
        setLoading(false);
        return;
      }

      // Fetch all stats using pagination to bypass Supabase's server-side row cap (default 1000)
      const CHUNK = 1000;
      let allStatsRaw: any[] = [];
      let from = 0;
      let fetchError: any = null;
      while (true) {
        const { data: chunk, error: chunkErr } = await supabase
          .from("match_player_stats")
          .select(
            "player_id,team_side,goals,assists,key_passes,shots_on_target,passes,tackles,key_tackles,interceptions,key_interceptions,possessions_lost,gk_saves,gk_catches,score,position,benched,stats_incomplete,matches(home_score,away_score,leagues(tier,use_tier_bonus))"
          )
          .range(from, from + CHUNK - 1);
        if (chunkErr) { fetchError = chunkErr; break; }
        if (!chunk || chunk.length === 0) break;
        allStatsRaw = allStatsRaw.concat(chunk);
        if (chunk.length < CHUNK) break;
        from += CHUNK;
      }

      if (fetchError) {
        setError(fetchError);
        setLoading(false);
        return;
      }
      const statsData = allStatsRaw;

      // Group stats per player (normalize matches + nested leagues from array to object)
      const statsByPlayer = new Map<string, RawStatRow[]>();
      for (const raw of (statsData ?? []) as any[]) {
        const rawMatch = Array.isArray(raw.matches) ? raw.matches[0] ?? null : raw.matches ?? null;
        const normalizedMatch = rawMatch ? {
          ...rawMatch,
          leagues: Array.isArray(rawMatch.leagues) ? rawMatch.leagues[0] ?? null : rawMatch.leagues ?? null,
        } : null;
        const stat: RawStatRow = {
          ...raw,
          matches: normalizedMatch,
        };
        const existing = statsByPlayer.get(stat.player_id) ?? [];
        existing.push(stat);
        statsByPlayer.set(stat.player_id, existing);
      }

      // Combine players with their stats and compute ratings
      const combined: PlayerWithStats[] = (playersData ?? []).map((p) => {
        const stats = statsByPlayer.get(p.id) ?? [];

        // Aggregate basic stats
        let totalGoals = 0;
        let totalAssists = 0;
        for (const s of stats) {
          totalGoals += s.goals ?? 0;
          totalAssists += s.assists ?? 0;
        }

        // Compute rating
        let rating: number | null = null;
        if (stats.length > 0) {
          // Only use played (non-benched, complete) stats for rating
          const playedStats = stats.filter(
            s => !s.benched && !s.stats_incomplete && s.matches
          );

          if (playedStats.length >= 3) {
            // Determine dominant position
            const posCounts = new Map<string, number>();
            for (const s of playedStats) {
              if (s.position) posCounts.set(s.position, (posCounts.get(s.position) ?? 0) + 1);
            }
            let dominantPos: string | null = null;
            let maxCount = 0;
            for (const [pos, count] of posCounts) {
              if (count > maxCount) { maxCount = count; dominantPos = pos; }
            }

            // Determine dominant league tier (skip leagues with use_tier_bonus disabled)
            const tierCounts = new Map<number, number>();
            for (const s of playedStats) {
              if (s.matches?.leagues?.use_tier_bonus === false) continue;
              const tier = s.matches?.leagues?.tier ?? 2;
              tierCounts.set(tier, (tierCounts.get(tier) ?? 0) + 1);
            }
            let dominantTier = 2;
            let maxTierCount = 0;
            for (const [tier, count] of tierCounts) {
              if (count > maxTierCount) { maxTierCount = count; dominantTier = tier; }
            }

            // Per-match ratings
            const matchRatingValues: number[] = [];
            for (const s of playedStats) {
              const m = s.matches!;
              const isHome = s.team_side === "home";
              const myScore = isHome ? (m.home_score ?? 0) : (m.away_score ?? 0);
              const oppScore = isHome ? (m.away_score ?? 0) : (m.home_score ?? 0);
              const result: MatchResult = myScore > oppScore ? "W" : myScore < oppScore ? "L" : "D";

              const statRow: MatchStatRow = {
                goals: s.goals ?? 0,
                assists: s.assists ?? 0,
                key_passes: s.key_passes ?? 0,
                shots_on_target: s.shots_on_target ?? 0,
                passes: s.passes ?? 0,
                tackles: s.tackles ?? 0,
                key_tackles: s.key_tackles ?? 0,
                interceptions: s.interceptions ?? 0,
                key_interceptions: s.key_interceptions ?? 0,
                possessions_lost: s.possessions_lost ?? 0,
                gk_saves: s.gk_saves ?? 0,
                gk_catches: s.gk_catches ?? 0,
                goals_conceded: oppScore,
                score: s.score ?? 0,
                position: s.position,
              };
              matchRatingValues.push(calcMatchRating(statRow, result, s.position ?? dominantPos));
            }

            rating = calcOverallRating(matchRatingValues, dominantTier, tierBonuses);
          }
        }

        // Dominant position from all stats with a position set
        const posCounts = new Map<string, number>();
        for (const s of stats) {
          if (s.position) posCounts.set(s.position, (posCounts.get(s.position) ?? 0) + 1);
        }
        let dominant_position: string | null = null;
        let maxPosCount = 0;
        for (const [pos, count] of posCounts) {
          if (count > maxPosCount) { maxPosCount = count; dominant_position = pos; }
        }

        return {
          ...p,
          matches_played: stats.length,
          total_goals: totalGoals,
          total_assists: totalAssists,
          rating,
          dominant_position,
        };
      });

      setPlayers(combined);
      setLoading(false);
    })();
  }, []);

  const filteredPlayers = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let rows = players;

    if (needle) {
      rows = rows.filter((p) => {
        const name = (p.name ?? "").toLowerCase();
        const handle = (p.handle ?? "").toLowerCase();
        return name.includes(needle) || handle.includes(needle);
      });
    }

    const dir = sortDir === "desc" ? -1 : 1;
    rows = [...rows].sort((a, b) => {
      let av: any, bv: any;

      if (sortKey === "name") {
        av = (a.name ?? a.handle ?? "").toLowerCase();
        bv = (b.name ?? b.handle ?? "").toLowerCase();
      } else if (sortKey === "rating") {
        av = a.rating ?? -1;
        bv = b.rating ?? -1;
      } else {
        av = a[sortKey] ?? 0;
        bv = b[sortKey] ?? 0;
      }

      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });

    return rows;
  }, [players, q, sortKey, sortDir]);

  if (!supabase) {
    return (
      <main className="mx-auto max-w-6xl px-6 py-10">
        <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
          <div className="text-xl font-semibold">Players</div>
          <p className="mt-2 text-white/70">
            Missing env vars. Add <code className="rounded bg-black/30 px-1">NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
            <code className="rounded bg-black/30 px-1">NEXT_PUBLIC_SUPABASE_ANON_KEY</code> to <code className="rounded bg-black/30 px-1">.env.local</code>.
          </p>
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="mx-auto max-w-6xl px-6 py-10">
        <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-6">
          <div className="text-lg font-semibold">Error</div>
          <pre className="mt-3 overflow-auto text-xs text-white/80">{JSON.stringify(error, null, 2)}</pre>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="flex items-center gap-4 text-sm mb-2">
            <Link href="/" className="text-white/50 hover:text-white/80 transition">
              ← Home
            </Link>
          </div>
          <div className="flex items-center gap-4 flex-wrap">
            <div className="text-3xl font-bold tracking-tight">Players</div>
            <Link
              href="/compare"
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold uppercase tracking-widest text-white/60 hover:border-white/20 hover:text-white/80 transition"
            >
              ⚡ Compare Players
            </Link>
          </div>
          <div className="mt-1 text-sm text-white/70">
            {players.length} registered player{players.length !== 1 ? "s" : ""}. Click to view full stats.
          </div>
        </div>

        <div className="flex flex-col gap-3 md:flex-row md:items-end">
          <div className="w-full md:w-[240px]">
            <label className="text-xs uppercase tracking-wide text-white/60">Search</label>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Player name..."
              className="mt-2 w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm outline-none ring-0 placeholder:text-white/30 focus:border-white/20"
            />
          </div>

          <div className="w-full md:w-[200px]">
            <label className="text-xs uppercase tracking-wide text-white/60">Sort by</label>
            <select
              value={`${sortKey}:${sortDir}`}
              onChange={(e) => {
                const [k, d] = e.target.value.split(":");
                setSortKey(k as any);
                setSortDir(d as any);
              }}
              className="mt-2 w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm outline-none focus:border-white/20"
            >
              <option value="rating:desc">Rating (high → low)</option>
              <option value="rating:asc">Rating (low → high)</option>
              <option value="total_goals:desc">Goals (high → low)</option>
              <option value="total_goals:asc">Goals (low → high)</option>
              <option value="total_assists:desc">Assists (high → low)</option>
              <option value="total_assists:asc">Assists (low → high)</option>
              <option value="matches_played:desc">Matches (high → low)</option>
              <option value="matches_played:asc">Matches (low → high)</option>
              <option value="name:asc">Name (A → Z)</option>
              <option value="name:desc">Name (Z → A)</option>
            </select>
          </div>
        </div>
      </div>

      {/* Players list */}
      <div className="mt-8">
        {loading ? (
          <div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-white/70">
            Loading players...
          </div>
        ) : filteredPlayers.length === 0 ? (
          <div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-white/70">
            No players found.
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {filteredPlayers.map((p) => {
              const displayName = p.name || p.handle || `Player ${p.id.slice(0, 8)}`;
              const ratingColor = p.rating != null ? getRatingColor(p.rating) : null;
              const ratingLabel = p.rating != null ? getRatingLabel(p.rating) : null;

              return (
                <Link
                  key={p.id}
                  href={`/players/${p.id}`}
                  className="group rounded-2xl border border-white/10 bg-white/5 p-5 transition hover:border-white/20 hover:bg-white/10"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-lg font-semibold group-hover:text-white">
                        {displayName}
                      </div>
                      {p.handle && p.name && (
                        <div className="mt-0.5 truncate text-sm text-white/50">@{p.handle}</div>
                      )}
                      {p.dominant_position && (
                        <div className="mt-1 inline-block rounded bg-white/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white/50">
                          {p.dominant_position}
                        </div>
                      )}
                    </div>
                    {p.rating != null ? (
                      <div
                        className="flex shrink-0 flex-col items-center justify-center rounded-xl px-3 py-1.5 text-center"
                        style={{ backgroundColor: (ratingColor ?? "") + "22", border: `1px solid ${ratingColor ?? ""}55` }}
                      >
                        <div className="text-xl font-bold leading-none" style={{ color: ratingColor ?? undefined }}>
                          {p.rating}
                        </div>
                        <div className="mt-0.5 text-[9px] uppercase tracking-widest" style={{ color: (ratingColor ?? "") + "cc" }}>
                          {ratingLabel}
                        </div>
                      </div>
                    ) : (
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/10 text-white/60 transition group-hover:bg-white/20 group-hover:text-white">
                        →
                      </div>
                    )}
                  </div>

                  <div className="mt-4 grid grid-cols-3 gap-2">
                    <div className="rounded-xl bg-black/20 px-3 py-2 text-center">
                      <div className="text-lg font-bold">{p.matches_played}</div>
                      <div className="text-[10px] uppercase tracking-wide text-white/50">Matches</div>
                    </div>
                    <div className="rounded-xl bg-black/20 px-3 py-2 text-center">
                      <div className="text-lg font-bold text-emerald-400">{p.total_goals}</div>
                      <div className="text-[10px] uppercase tracking-wide text-white/50">Goals</div>
                    </div>
                    <div className="rounded-xl bg-black/20 px-3 py-2 text-center">
                      <div className="text-lg font-bold text-sky-400">{p.total_assists}</div>
                      <div className="text-[10px] uppercase tracking-wide text-white/50">Assists</div>
                    </div>
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
