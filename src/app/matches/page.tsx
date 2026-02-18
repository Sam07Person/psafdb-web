"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import Link from "next/link";

type MatchRow = {
  id: string;
  league_id: string | null;
  played_at: string;
  home_team: string;
  away_team: string;
  home_score: number;
  away_score: number;
  league?: { name: string; season: string | null } | null;
};

type TeamSide = "home" | "away";

type TeamStatsRow = {
  match_id: string;
  team_side: TeamSide;
  possession: number;
  passes: number;
  key_passes: number;
  assists: number;
  shots: number;
  shots_on_target: number;
  goals: number;
  tackles: number;
  key_tackles: number;
  interceptions: number;
  key_interceptions: number;
  possessions_lost: number;
  goal_kicks: number;
  corner_kicks: number;
  throw_ins: number;
  free_kicks: number;
  penalties: number;
  fouls: number;
  offsides: number;
  yellow_cards: number;
  red_cards: number;
};

type PlayerMini = { handle: string | null; name: string | null };

type PlayerStatsRow = {
  match_id: string;
  player_id: string;
  team_side: TeamSide;
  position: string | null;
  score: number;
  passes: number;
  key_passes: number;
  assists: number;
  shots: number;
  shots_on_target: number;
  goals: number;
  tackles: number;
  key_tackles: number;
  interceptions: number;
  key_interceptions: number;
  possessions_lost: number;
  gk_saves: number;
  gk_catches: number;
  players?: PlayerMini | null; // nested relation if FK exists
};

// Position display colors
const POSITION_COLORS: Record<string, string> = {
  GK: "border-yellow-400/30 bg-yellow-400/10 text-yellow-200",
  LB: "border-green-400/30 bg-green-400/10 text-green-200",
  RB: "border-green-400/30 bg-green-400/10 text-green-200",
  CB: "border-green-400/30 bg-green-400/10 text-green-200",
  LCB: "border-green-400/30 bg-green-400/10 text-green-200",
  RCB: "border-green-400/30 bg-green-400/10 text-green-200",
  LWB: "border-teal-400/30 bg-teal-400/10 text-teal-200",
  RWB: "border-teal-400/30 bg-teal-400/10 text-teal-200",
  CM: "border-blue-400/30 bg-blue-400/10 text-blue-200",
  LM: "border-blue-400/30 bg-blue-400/10 text-blue-200",
  RM: "border-blue-400/30 bg-blue-400/10 text-blue-200",
  LW: "border-purple-400/30 bg-purple-400/10 text-purple-200",
  RW: "border-purple-400/30 bg-purple-400/10 text-purple-200",
  LF: "border-orange-400/30 bg-orange-400/10 text-orange-200",
  RF: "border-orange-400/30 bg-orange-400/10 text-orange-200",
  CF: "border-red-400/30 bg-red-400/10 text-red-200",
  ST: "border-red-400/30 bg-red-400/10 text-red-200",
};

function cx(...s: Array<string | false | null | undefined>) {
  return s.filter(Boolean).join(" ");
}

function formatDT(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function StatPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-white/60">{label}</div>
      <div className="text-sm font-semibold text-white">{value}</div>
    </div>
  );
}

function PositionBadge({ position }: { position: string | null }) {
  if (!position) {
    return <span className="text-white/40">—</span>;
  }

  const colorClass = POSITION_COLORS[position] ?? "border-white/30 bg-white/10 text-white/80";

  return (
    <span className={cx("rounded-full border px-2 py-0.5 text-xs font-medium", colorClass)}>
      {position}
    </span>
  );
}

export default function MatchesPage() {
  const [matches, setMatches] = useState<MatchRow[]>([]);
  const [error, setError] = useState<any>(null);

  const [q, setQ] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  // detail caches
  const [teamStatsByMatch, setTeamStatsByMatch] = useState<Record<string, TeamStatsRow[]>>({});
  const [playerStatsByMatch, setPlayerStatsByMatch] = useState<Record<string, PlayerStatsRow[]>>({});
  const [loadingDetails, setLoadingDetails] = useState<Record<string, boolean>>({});

  // player table controls
  const [playerFilter, setPlayerFilter] = useState<string>("");
  const [sideFilter, setSideFilter] = useState<"all" | TeamSide>("all");
  const [positionFilter, setPositionFilter] = useState<string>("all");
  const [sortKey, setSortKey] = useState<keyof PlayerStatsRow>("goals");
  const [sortDir, setSortDir] = useState<"desc" | "asc">("desc");

  useEffect(() => {
    if (!supabase) return;
    (async () => {
      // Try to include league name/season if relationship exists.
      const { data, error } = await supabase
        .from("matches")
        .select("id,league_id,played_at,home_team,away_team,home_score,away_score,league:leagues(name,season)")
        .order("played_at", { ascending: false })
        .limit(50);

      if (error) setError(error);
      else setMatches((data ?? []) as unknown as MatchRow[]);
    })();
  }, []);

  const filteredMatches = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return matches;

    return matches.filter((m) => {
      const league = `${m.league?.name ?? ""} ${m.league?.season ?? ""}`.toLowerCase();
      const teams = `${m.home_team} ${m.away_team}`.toLowerCase();
      return league.includes(needle) || teams.includes(needle);
    });
  }, [matches, q]);

  async function loadDetails(matchId: string) {
    if (!supabase) return;
    if (teamStatsByMatch[matchId] && playerStatsByMatch[matchId]) return;

    setLoadingDetails((p) => ({ ...p, [matchId]: true }));

    // 1) team stats
    const ts = await supabase
      .from("match_team_stats")
      .select(
        "match_id,team_side,possession,passes,key_passes,assists,shots,shots_on_target,goals,tackles,key_tackles,interceptions,key_interceptions,possessions_lost,goal_kicks,corner_kicks,throw_ins,free_kicks,penalties,fouls,offsides,yellow_cards,red_cards"
      )
      .eq("match_id", matchId);

    // 2) player stats (try nested players relation) - now includes position
    let ps = await supabase
      .from("match_player_stats")
      .select(
        "match_id,player_id,team_side,position,score,passes,key_passes,assists,shots,shots_on_target,goals,tackles,key_tackles,interceptions,key_interceptions,possessions_lost,gk_saves,gk_catches,players(handle,name)"
      )
      .eq("match_id", matchId);

    // Fallback if FK relations aren't set up in Supabase
    if (ps.error) {
      const ps2 = await supabase
        .from("match_player_stats")
        .select(
          "match_id,player_id,team_side,position,score,passes,key_passes,assists,shots,shots_on_target,goals,tackles,key_tackles,interceptions,key_interceptions,possessions_lost,gk_saves,gk_catches"
        )
        .eq("match_id", matchId);

      if (!ps2.error) {
        // fetch players separately
        const ids = Array.from(new Set((ps2.data ?? []).map((r: any) => r.player_id)));
        const pl = ids.length
          ? await supabase.from("players").select("id,handle,name").in("id", ids)
          : { data: [], error: null as any };

        const map = new Map<string, PlayerMini>();
        for (const p of (pl.data ?? []) as any[]) map.set(p.id, { handle: p.handle ?? null, name: p.name ?? null });

        ps = {
          data: (ps2.data ?? []).map((r: any) => ({ ...r, players: map.get(r.player_id) ?? null })),
          error: null,
        } as any;
      } else {
        ps = ps2 as any;
      }
    }

    if (ts.error) {
      setError({ where: "match_team_stats", ...ts.error });
    } else {
      setTeamStatsByMatch((p) => ({ ...p, [matchId]: (ts.data ?? []) as TeamStatsRow[] }));
    }

    if ((ps as any).error) {
      setError({ where: "match_player_stats", ...(ps as any).error });
    } else {
      setPlayerStatsByMatch((p) => ({ ...p, [matchId]: ((ps as any).data ?? []) as PlayerStatsRow[] }));
    }

    setLoadingDetails((p) => ({ ...p, [matchId]: false }));
  }

  function toggleExpanded(id: string) {
    setExpanded((cur) => {
      const next = cur === id ? null : id;
      if (next) loadDetails(next);
      return next;
    });
  }

  const expandedTeamStats = expanded ? teamStatsByMatch[expanded] ?? [] : [];
  const expandedPlayerStatsRaw = expanded ? playerStatsByMatch[expanded] ?? [] : [];

  const expandedTeamStatsMap = useMemo(() => {
    const home = expandedTeamStats.find((r) => r.team_side === "home") ?? null;
    const away = expandedTeamStats.find((r) => r.team_side === "away") ?? null;
    return { home, away };
  }, [expandedTeamStats]);

  // Get unique positions for filter dropdown
  const availablePositions = useMemo(() => {
    const positions = new Set<string>();
    expandedPlayerStatsRaw.forEach((r) => {
      if (r.position) positions.add(r.position);
    });
    return Array.from(positions).sort();
  }, [expandedPlayerStatsRaw]);

  const expandedPlayerStats = useMemo(() => {
    const needle = playerFilter.trim().toLowerCase();
    let rows = expandedPlayerStatsRaw;

    if (sideFilter !== "all") rows = rows.filter((r) => r.team_side === sideFilter);

    if (positionFilter !== "all") rows = rows.filter((r) => r.position === positionFilter);

    if (needle) {
      rows = rows.filter((r) => {
        const name = (r.players?.name ?? "").toLowerCase();
        const handle = (r.players?.handle ?? "").toLowerCase();
        return name.includes(needle) || handle.includes(needle);
      });
    }

    const dir = sortDir === "desc" ? -1 : 1;
    rows = [...rows].sort((a, b) => {
      const av = (a[sortKey] as any) ?? 0;
      const bv = (b[sortKey] as any) ?? 0;
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });

    return rows;
  }, [expandedPlayerStatsRaw, playerFilter, sideFilter, positionFilter, sortKey, sortDir]);

  if (!supabase) {
    return (
      <main className="mx-auto max-w-6xl px-6 py-10">
        <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
          <div className="text-xl font-semibold">Recent Matches</div>
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
          <div className="text-3xl font-bold tracking-tight">Matches</div>
          <div className="mt-1 text-sm text-white/70">Click a match to see every stat (teams + players).</div>
        </div>

        <div className="w-full md:w-[360px]">
          <label className="text-xs uppercase tracking-wide text-white/60">Search teams / league</label>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Blue, Red, PSA 2026..."
            className="mt-2 w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm outline-none ring-0 placeholder:text-white/30 focus:border-white/20"
          />
        </div>
      </div>

      {/* Matches list */}
      <div className="mt-8 grid gap-4">
        {filteredMatches.map((m) => {
          const isOpen = expanded === m.id;
          const league = m.league ?? null;

          const leagueLabel = league?.name
            ? `${league.name}${league.season ? ` • ${league.season}` : ""}`
            : m.league_id
              ? `League: ${m.league_id.slice(0, 8)}…`
              : "No league";

          const scoreLine = `${m.home_score} - ${m.away_score}`;

          return (
            <div key={m.id} className="rounded-2xl border border-white/10 bg-white/5 shadow-[0_0_0_1px_rgba(255,255,255,0.02)]">
              <button
                onClick={() => toggleExpanded(m.id)}
                className="w-full rounded-2xl px-5 py-4 text-left transition hover:bg-white/5"
              >
                <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                  <div className="min-w-0">
                    <div className="text-xs uppercase tracking-wide text-white/60">{leagueLabel}</div>
                    <div className="mt-1 flex flex-wrap items-baseline gap-x-2">
                      <div className="text-lg font-semibold">{m.home_team}</div>
                      <div className="text-white/60">vs</div>
                      <div className="text-lg font-semibold">{m.away_team}</div>
                      <div className="ml-1 rounded-full border border-white/10 bg-black/20 px-2 py-0.5 text-sm font-semibold">
                        {scoreLine}
                      </div>
                    </div>
                    <div className="mt-1 text-sm text-white/60">{formatDT(m.played_at)}</div>
                  </div>

                  <div className="mt-2 flex items-center gap-2 md:mt-0">
                    <span className="text-sm text-white/60">{isOpen ? "Hide stats" : "View stats"}</span>
                    <span className={cx("inline-block h-2 w-2 rounded-full", isOpen ? "bg-emerald-400" : "bg-white/30")} />
                  </div>
                </div>
              </button>

              {/* Expanded details */}
              {isOpen && (
                <div className="border-t border-white/10 px-5 py-5">
                  {loadingDetails[m.id] ? (
                    <div className="text-sm text-white/70">Loading stats…</div>
                  ) : (
                    <div className="grid gap-6">
                      {/* Quick summary pills */}
                      <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
                        <StatPill label="Match ID" value={m.id.slice(0, 8) + "…"} />
                        <StatPill label="Home" value={m.home_team} />
                        <StatPill label="Away" value={m.away_team} />
                        <StatPill label="Score" value={`${m.home_score} - ${m.away_score}`} />
                        <StatPill label="Played" value={new Date(m.played_at).toLocaleDateString()} />
                        <StatPill label="Time" value={new Date(m.played_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} />
                      </div>

                      {/* Team stats */}
                      <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-lg font-semibold">Team stats</div>
                          <div className="text-xs text-white/60">Home vs Away</div>
                        </div>

                        {(!expandedTeamStatsMap.home && !expandedTeamStatsMap.away) ? (
                          <div className="mt-3 text-sm text-white/70">No team stats for this match.</div>
                        ) : (
                          <div className="mt-4 overflow-auto">
                            <table className="min-w-[720px] w-full border-separate border-spacing-y-2 text-sm">
                              <thead>
                                <tr className="text-left text-xs uppercase tracking-wide text-white/60">
                                  <th className="py-2">Stat</th>
                                  <th className="py-2">{m.home_team}</th>
                                  <th className="py-2">{m.away_team}</th>
                                </tr>
                              </thead>
                              <tbody>
                                {[
                                  ["Possession (%)", "possession"],
                                  ["Passes", "passes"],
                                  ["Key passes", "key_passes"],
                                  ["Assists", "assists"],
                                  ["Shots", "shots"],
                                  ["Shots on target", "shots_on_target"],
                                  ["Goals", "goals"],
                                  ["Tackles", "tackles"],
                                  ["Key tackles", "key_tackles"],
                                  ["Interceptions", "interceptions"],
                                  ["Key interceptions", "key_interceptions"],
                                  ["Possessions lost", "possessions_lost"],
                                  ["Corners", "corner_kicks"],
                                  ["Fouls", "fouls"],
                                  ["Offsides", "offsides"],
                                  ["Yellow", "yellow_cards"],
                                  ["Red", "red_cards"],
                                ].map(([label, key]) => {
                                  const k = key as keyof TeamStatsRow;
                                  const hv = expandedTeamStatsMap.home ? expandedTeamStatsMap.home[k] : 0;
                                  const av = expandedTeamStatsMap.away ? expandedTeamStatsMap.away[k] : 0;

                                  const fmt = (v: any) => (k === "possession" ? Number(v).toFixed(1) : String(v ?? 0));

                                  return (
                                    <tr key={key} className="rounded-xl bg-white/5">
                                      <td className="px-3 py-2 font-medium">{label}</td>
                                      <td className="px-3 py-2">{fmt(hv)}</td>
                                      <td className="px-3 py-2">{fmt(av)}</td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>

                      {/* Player stats */}
                      <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                          <div>
                            <div className="text-lg font-semibold">Player stats</div>
                            <div className="text-sm text-white/60">Filter + sort (click headers)</div>
                          </div>

                          <div className="grid w-full gap-3 md:w-auto md:grid-cols-4">
                            <div>
                              <label className="text-xs uppercase tracking-wide text-white/60">Player</label>
                              <input
                                value={playerFilter}
                                onChange={(e) => setPlayerFilter(e.target.value)}
                                placeholder="alice, bob..."
                                className="mt-2 w-full rounded-2xl border border-white/10 bg-black/20 px-3 py-2 text-sm outline-none placeholder:text-white/30 focus:border-white/20"
                              />
                            </div>

                            <div>
                              <label className="text-xs uppercase tracking-wide text-white/60">Side</label>
                              <select
                                value={sideFilter}
                                onChange={(e) => setSideFilter(e.target.value as any)}
                                className="mt-2 w-full rounded-2xl border border-white/10 bg-black/20 px-3 py-2 text-sm outline-none focus:border-white/20"
                              >
                                <option value="all">All</option>
                                <option value="home">Home</option>
                                <option value="away">Away</option>
                              </select>
                            </div>

                            <div>
                              <label className="text-xs uppercase tracking-wide text-white/60">Position</label>
                              <select
                                value={positionFilter}
                                onChange={(e) => setPositionFilter(e.target.value)}
                                className="mt-2 w-full rounded-2xl border border-white/10 bg-black/20 px-3 py-2 text-sm outline-none focus:border-white/20"
                              >
                                <option value="all">All positions</option>
                                {availablePositions.map((pos) => (
                                  <option key={pos} value={pos}>{pos}</option>
                                ))}
                              </select>
                            </div>

                            <div>
                              <label className="text-xs uppercase tracking-wide text-white/60">Sort</label>
                              <select
                                value={`${String(sortKey)}:${sortDir}`}
                                onChange={(e) => {
                                  const [k, d] = e.target.value.split(":");
                                  setSortKey(k as any);
                                  setSortDir(d as any);
                                }}
                                className="mt-2 w-full rounded-2xl border border-white/10 bg-black/20 px-3 py-2 text-sm outline-none focus:border-white/20"
                              >
                                <option value="goals:desc">Goals (high → low)</option>
                                <option value="shots:desc">Shots (high → low)</option>
                                <option value="shots_on_target:desc">SOT (high → low)</option>
                                <option value="assists:desc">Assists (high → low)</option>
                                <option value="passes:desc">Passes (high → low)</option>
                                <option value="tackles:desc">Tackles (high → low)</option>
                                <option value="interceptions:desc">Interceptions (high → low)</option>
                                <option value="score:desc">Score (high → low)</option>
                              </select>
                            </div>
                          </div>
                        </div>

                        {expandedPlayerStats.length === 0 ? (
                          <div className="mt-4 text-sm text-white/70">No player stats for this match.</div>
                        ) : (
                          <div className="mt-4 overflow-auto">
                            <table className="min-w-[1200px] w-full text-sm">
                              <thead className="text-left text-xs uppercase tracking-wide text-white/60">
                                <tr>
                                  <th className="py-2">Player</th>
                                  <th className="py-2">Pos</th>
                                  <th className="py-2">Side</th>
                                  {[
                                    ["goals", "G"],
                                    ["assists", "A"],
                                    ["shots", "Sh"],
                                    ["shots_on_target", "SOT"],
                                    ["passes", "Pass"],
                                    ["key_passes", "KP"],
                                    ["tackles", "Tkl"],
                                    ["interceptions", "Int"],
                                    ["possessions_lost", "Lost"],
                                    ["gk_saves", "Saves"],
                                    ["gk_catches", "Catch"],
                                    ["score", "Score"],
                                  ].map(([k, label]) => (
                                    <th
                                      key={k}
                                      className="py-2 cursor-pointer select-none hover:text-white"
                                      onClick={() => {
                                        const key = k as keyof PlayerStatsRow;
                                        setSortKey(key);
                                        setSortDir((d) => (sortKey === key ? (d === "desc" ? "asc" : "desc") : "desc"));
                                      }}
                                    >
                                      {label}
                                      {sortKey === (k as any) ? (sortDir === "desc" ? " ↓" : " ↑") : ""}
                                    </th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {expandedPlayerStats.map((r) => {
                                  const label =
                                    r.players?.name ||
                                    r.players?.handle ||
                                    r.player_id.slice(0, 8) + "…";

                                  return (
                                    <tr key={r.player_id} className="border-t border-white/10">
                                      <td className="py-2 font-medium">{label}</td>
                                      <td className="py-2">
                                        <PositionBadge position={r.position} />
                                      </td>
                                      <td className="py-2">
                                        <span
                                          className={cx(
                                            "rounded-full border px-2 py-0.5 text-xs",
                                            r.team_side === "home"
                                              ? "border-sky-400/30 bg-sky-400/10 text-sky-200"
                                              : "border-rose-400/30 bg-rose-400/10 text-rose-200"
                                          )}
                                        >
                                          {r.team_side}
                                        </span>
                                      </td>
                                      <td className="py-2">{r.goals}</td>
                                      <td className="py-2">{r.assists}</td>
                                      <td className="py-2">{r.shots}</td>
                                      <td className="py-2">{r.shots_on_target}</td>
                                      <td className="py-2">{r.passes}</td>
                                      <td className="py-2">{r.key_passes}</td>
                                      <td className="py-2">{r.tackles}</td>
                                      <td className="py-2">{r.interceptions}</td>
                                      <td className="py-2">{r.possessions_lost}</td>
                                      <td className="py-2">{r.gk_saves}</td>
                                      <td className="py-2">{r.gk_catches}</td>
                                      <td className="py-2 font-semibold">{r.score}</td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {filteredMatches.length === 0 && (
          <div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-white/70">
            No matches found.
          </div>
        )}
      </div>
    </main>
  );
}