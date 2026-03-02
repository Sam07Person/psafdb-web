"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { getRatingColor, getRatingLabel } from "@/lib/ratings";

type TeamRow = {
  id: string;
  name: string;
  league: { id: string; name: string; season: string | null } | null;
  stats: { played: number; won: number; drawn: number; lost: number; gf: number; ga: number };
  rating: number | null;
};

type SortKey = "name" | "league" | "played" | "won" | "drawn" | "lost" | "gf" | "ga" | "gd" | "pts" | "rating";

const COLUMNS: { label: string; key: SortKey; align: "left" | "center" }[] = [
  { label: "Team",   key: "name",   align: "left" },
  { label: "League", key: "league", align: "left" },
  { label: "Rating", key: "rating", align: "center" },
  { label: "P",  key: "played", align: "center" },
  { label: "W",  key: "won",    align: "center" },
  { label: "D",  key: "drawn",  align: "center" },
  { label: "L",  key: "lost",   align: "center" },
  { label: "GF", key: "gf",     align: "center" },
  { label: "GA", key: "ga",     align: "center" },
  { label: "GD", key: "gd",     align: "center" },
  { label: "Pts", key: "pts",   align: "center" },
];

function getValue(team: TeamRow, key: SortKey): string | number {
  const { stats } = team;
  switch (key) {
    case "name":   return team.name.toLowerCase();
    case "league": return (team.league?.name ?? "").toLowerCase();
    case "played": return stats.played;
    case "won":    return stats.won;
    case "drawn":  return stats.drawn;
    case "lost":   return stats.lost;
    case "gf":     return stats.gf;
    case "ga":     return stats.ga;
    case "gd":     return stats.gf - stats.ga;
    case "pts":    return stats.won * 3 + stats.drawn;
    case "rating": return team.rating ?? -1;
  }
}

export default function TeamsTable({ teams }: { teams: TeamRow[] }) {
  const [search, setSearch] = useState("");
  const [leagueFilter, setLeagueFilter] = useState("all");
  const [sortKey, setSortKey] = useState<SortKey>("pts");
  const [sortDir, setSortDir] = useState<"desc" | "asc">("desc");

  const leagues = useMemo(() => {
    const seen = new Map<string, string>();
    for (const t of teams) {
      if (t.league) seen.set(t.league.id, t.league.name);
    }
    return Array.from(seen.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [teams]);

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    let list = teams;

    if (needle) list = list.filter((t) => t.name.toLowerCase().includes(needle));
    if (leagueFilter === "__none__") list = list.filter((t) => !t.league);
    else if (leagueFilter !== "all") list = list.filter((t) => t.league?.id === leagueFilter);

    const dir = sortDir === "desc" ? -1 : 1;
    return [...list].sort((a, b) => {
      const av = getValue(a, sortKey);
      const bv = getValue(b, sortKey);
      if (av < bv) return dir;
      if (av > bv) return -dir;
      // secondary: pts desc, then name asc
      const ap = getValue(a, "pts") as number;
      const bp = getValue(b, "pts") as number;
      if (bp !== ap) return bp - ap;
      return (a.name.toLowerCase() < b.name.toLowerCase()) ? -1 : 1;
    });
  }, [teams, search, leagueFilter, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => d === "desc" ? "asc" : "desc");
    else {
      setSortKey(key);
      setSortDir(key === "name" || key === "league" ? "asc" : "desc");
    }
  }

  const inputCls = "rounded border border-white/10 text-white/80 text-sm px-3 py-2 outline-none focus:border-white/30 placeholder:text-white/30";
  const selectStyle: React.CSSProperties = { background: "var(--border-main)", color: "var(--text-body)" };

  return (
    <>
      {/* Filters */}
      <div className="mb-4 flex flex-wrap gap-3 items-center">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search team name..."
          className={inputCls}
          style={{ width: 200 }}
        />
        <select
          value={leagueFilter}
          onChange={(e) => setLeagueFilter(e.target.value)}
          className={inputCls}
          style={selectStyle}
        >
          <option value="all">All leagues</option>
          {leagues.map(([id, name]) => (
            <option key={id} value={id}>{name}</option>
          ))}
          <option value="__none__">No league</option>
        </select>
        <span className="text-sm text-white/40">
          {rows.length} team{rows.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Table */}
      {rows.length === 0 ? (
        <div className="rounded-xl bg-white/5 border border-white/10 p-12 text-center text-white/40">
          No teams match your filters
        </div>
      ) : (
        <div className="rounded-xl bg-white/5 border border-white/10 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/10 bg-white/5">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-white/40 uppercase tracking-wider">#</th>
                  {COLUMNS.map(({ label, key, align }) => (
                    <th
                      key={key}
                      onClick={() => toggleSort(key)}
                      className={`px-4 py-3 text-${align} text-xs font-semibold uppercase tracking-wider cursor-pointer select-none whitespace-nowrap transition ${sortKey === key ? "text-emerald-400" : "text-white/40 hover:text-white/60"}`}
                    >
                      {label}{sortKey === key ? (sortDir === "desc" ? " ↓" : " ↑") : ""}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((team, index) => {
                  const pts = team.stats.won * 3 + team.stats.drawn;
                  const gd = team.stats.gf - team.stats.ga;
                  const rColor = team.rating !== null ? getRatingColor(team.rating) : null;
                  const rLabel = team.rating !== null ? getRatingLabel(team.rating) : null;
                  return (
                    <tr key={team.id} className="border-b border-white/5 hover:bg-white/5 transition">
                      <td className="px-4 py-3 text-white/30 text-sm">{index + 1}</td>
                      <td className="px-4 py-3">
                        <Link href={`/teams/${team.id}`} className="font-medium text-white hover:text-emerald-400 transition">
                          {team.name}
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        {team.league ? (
                          <Link href={`/leagues/${team.league.id}`} className="text-sm text-white/60 hover:text-white/80 transition">
                            {team.league.name}
                            {team.league.season && <span className="text-white/30 ml-1">({team.league.season})</span>}
                          </Link>
                        ) : (
                          <span className="text-white/20 text-sm">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {rColor ? (
                          <span
                            className="inline-flex flex-col items-center leading-none"
                            title={rLabel ?? undefined}
                          >
                            <span className="text-base font-bold tabular-nums" style={{ color: rColor }}>{team.rating}</span>
                          </span>
                        ) : (
                          <span className="text-white/20 text-sm">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center text-white/60 tabular-nums">{team.stats.played}</td>
                      <td className="px-4 py-3 text-center text-emerald-400 font-medium tabular-nums">{team.stats.won}</td>
                      <td className="px-4 py-3 text-center text-yellow-400 font-medium tabular-nums">{team.stats.drawn}</td>
                      <td className="px-4 py-3 text-center text-red-400 font-medium tabular-nums">{team.stats.lost}</td>
                      <td className="px-4 py-3 text-center text-white/60 tabular-nums">{team.stats.gf}</td>
                      <td className="px-4 py-3 text-center text-white/60 tabular-nums">{team.stats.ga}</td>
                      <td className={`px-4 py-3 text-center font-medium tabular-nums ${gd > 0 ? "text-emerald-400" : gd < 0 ? "text-red-400" : "text-white/40"}`}>
                        {gd > 0 ? "+" : ""}{gd}
                      </td>
                      <td className="px-4 py-3 text-center font-bold text-white tabular-nums">{pts}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
