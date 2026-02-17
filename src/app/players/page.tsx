"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import Link from "next/link";

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
};

function cx(...s: Array<string | false | null | undefined>) {
  return s.filter(Boolean).join(" ");
}

export default function PlayersPage() {
  const [players, setPlayers] = useState<PlayerWithStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<any>(null);

  const [q, setQ] = useState("");
  const [sortKey, setSortKey] = useState<"name" | "matches_played" | "total_goals" | "total_assists">("total_goals");
  const [sortDir, setSortDir] = useState<"desc" | "asc">("desc");

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

      // Fetch aggregated stats for all players
      const { data: statsData, error: statsError } = await supabase
        .from("match_player_stats")
        .select("player_id,goals,assists");

      if (statsError) {
        setError(statsError);
        setLoading(false);
        return;
      }

      // Aggregate stats per player
      const statsMap = new Map<string, { matches: number; goals: number; assists: number }>();
      for (const stat of statsData ?? []) {
        const existing = statsMap.get(stat.player_id) || { matches: 0, goals: 0, assists: 0 };
        statsMap.set(stat.player_id, {
          matches: existing.matches + 1,
          goals: existing.goals + (stat.goals ?? 0),
          assists: existing.assists + (stat.assists ?? 0),
        });
      }

      // Combine players with their stats
      const combined: PlayerWithStats[] = (playersData ?? []).map((p) => {
        const stats = statsMap.get(p.id) || { matches: 0, goals: 0, assists: 0 };
        return {
          ...p,
          matches_played: stats.matches,
          total_goals: stats.goals,
          total_assists: stats.assists,
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
          <div className="text-3xl font-bold tracking-tight">Players</div>
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
                    </div>
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/10 text-white/60 transition group-hover:bg-white/20 group-hover:text-white">
                      →
                    </div>
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