"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

type PlayerStat = {
  player_id: string;
  team_side: "home" | "away";
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
  players?: { handle: string | null; name: string | null } | null;
};

type SortKey = keyof Omit<PlayerStat, "player_id" | "team_side" | "position" | "players">;

const POSITION_STYLE: Record<string, { color: string; background: string }> = {
  GK:  { color: "#fde68a", background: "rgba(251,191,36,0.15)" },
  LB:  { color: "#86efac", background: "rgba(74,222,128,0.12)" },
  RB:  { color: "#86efac", background: "rgba(74,222,128,0.12)" },
  CB:  { color: "#86efac", background: "rgba(74,222,128,0.12)" },
  LCB: { color: "#86efac", background: "rgba(74,222,128,0.12)" },
  RCB: { color: "#86efac", background: "rgba(74,222,128,0.12)" },
  LWB: { color: "#5eead4", background: "rgba(45,212,191,0.12)" },
  RWB: { color: "#5eead4", background: "rgba(45,212,191,0.12)" },
  CM:  { color: "#93c5fd", background: "rgba(147,197,253,0.12)" },
  LM:  { color: "#93c5fd", background: "rgba(147,197,253,0.12)" },
  RM:  { color: "#93c5fd", background: "rgba(147,197,253,0.12)" },
  LW:  { color: "#c4b5fd", background: "rgba(196,181,253,0.12)" },
  RW:  { color: "#c4b5fd", background: "rgba(196,181,253,0.12)" },
  LF:  { color: "#fdba74", background: "rgba(249,115,22,0.12)" },
  RF:  { color: "#fdba74", background: "rgba(249,115,22,0.12)" },
  CF:  { color: "#fca5a5", background: "rgba(239,68,68,0.12)" },
  ST:  { color: "#fca5a5", background: "rgba(239,68,68,0.12)" },
};

const COLUMNS: [string, SortKey][] = [
  ["G",     "goals"],
  ["A",     "assists"],
  ["Sh",    "shots"],
  ["SOT",   "shots_on_target"],
  ["Pass",  "passes"],
  ["KP",    "key_passes"],
  ["Tkl",   "tackles"],
  ["KT",    "key_tackles"],
  ["Int",   "interceptions"],
  ["KI",    "key_interceptions"],
  ["Lost",  "possessions_lost"],
  ["Saves", "gk_saves"],
  ["Catch", "gk_catches"],
  ["Score", "score"],
];

export default function PlayerStatsTable({
  playerStats,
  homeTeam,
  awayTeam,
}: {
  playerStats: PlayerStat[];
  homeTeam: string;
  awayTeam: string;
}) {
  const [playerFilter, setPlayerFilter] = useState("");
  const [sideFilter, setSideFilter] = useState<"all" | "home" | "away">("all");
  const [positionFilter, setPositionFilter] = useState("all");
  const [sortKey, setSortKey] = useState<SortKey>("score");
  const [sortDir, setSortDir] = useState<"desc" | "asc">("desc");

  const availablePositions = useMemo(() => {
    const set = new Set<string>();
    playerStats.forEach((r) => { if (r.position) set.add(r.position); });
    return Array.from(set).sort();
  }, [playerStats]);

  const rows = useMemo(() => {
    const needle = playerFilter.trim().toLowerCase();
    let list = playerStats;
    if (sideFilter !== "all") list = list.filter((r) => r.team_side === sideFilter);
    if (positionFilter !== "all") list = list.filter((r) => r.position === positionFilter);
    if (needle) list = list.filter((r) => {
      const name = (r.players?.name ?? "").toLowerCase();
      const handle = (r.players?.handle ?? "").toLowerCase();
      return name.includes(needle) || handle.includes(needle);
    });
    const dir = sortDir === "desc" ? -1 : 1;
    return [...list].sort((a, b) => {
      const av = (a[sortKey] as number) ?? 0;
      const bv = (b[sortKey] as number) ?? 0;
      return av < bv ? dir : av > bv ? -dir : 0;
    });
  }, [playerStats, playerFilter, sideFilter, positionFilter, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => d === "desc" ? "asc" : "desc");
    else { setSortKey(key); setSortDir("desc"); }
  }

  const inputStyle: React.CSSProperties = {
    background: "#09090f",
    border: "1px solid #1a1a2e",
    color: "#e0e0f0",
    padding: "7px 12px",
    fontSize: 12,
    outline: "none",
    width: "100%",
  };

  if (playerStats.length === 0) return null;

  return (
    <div>
      {/* Header bar */}
      <div style={{ background: "#0d0d1a", borderTop: "3px solid #a78bfa", padding: "14px 20px", fontSize: 11, fontWeight: 700, letterSpacing: "0.2em", textTransform: "uppercase", color: "#a78bfa" }}>
        Player Stats
      </div>

      {/* Filters */}
      <div style={{ background: "#0a0a13", borderBottom: "1px solid #1a1a2e", padding: "12px 20px", display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
        <input
          value={playerFilter}
          onChange={(e) => setPlayerFilter(e.target.value)}
          placeholder="Search player..."
          style={{ ...inputStyle, width: 180 }}
        />
        <select value={sideFilter} onChange={(e) => setSideFilter(e.target.value as any)} style={inputStyle}>
          <option value="all">All sides</option>
          <option value="home">{homeTeam}</option>
          <option value="away">{awayTeam}</option>
        </select>
        <select value={positionFilter} onChange={(e) => setPositionFilter(e.target.value)} style={inputStyle}>
          <option value="all">All positions</option>
          {availablePositions.map((pos) => (
            <option key={pos} value={pos}>{pos}</option>
          ))}
        </select>
        <div style={{ marginLeft: "auto", fontSize: 11, color: "#3a3a5a" }}>
          {rows.length} player{rows.length !== 1 ? "s" : ""}
        </div>
      </div>

      {/* Table */}
      <div style={{ background: "#0d0d1a", overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, minWidth: 900 }}>
          <thead>
            <tr style={{ background: "#09090f" }}>
              <th style={{ padding: "8px 20px", textAlign: "left", fontSize: 10, color: "#3a3a5a", fontWeight: 700, letterSpacing: "0.15em", textTransform: "uppercase", borderBottom: "1px solid #1a1a2e", whiteSpace: "nowrap" }}>Player</th>
              <th style={{ padding: "8px 10px", textAlign: "center", fontSize: 10, color: "#3a3a5a", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", borderBottom: "1px solid #1a1a2e" }}>Pos</th>
              <th style={{ padding: "8px 10px", textAlign: "center", fontSize: 10, color: "#3a3a5a", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", borderBottom: "1px solid #1a1a2e" }}>Side</th>
              {COLUMNS.map(([label, key]) => (
                <th
                  key={key}
                  onClick={() => toggleSort(key)}
                  style={{
                    padding: "8px 10px",
                    textAlign: "center",
                    fontSize: 10,
                    color: sortKey === key ? "#a78bfa" : "#3a3a5a",
                    fontWeight: 700,
                    letterSpacing: "0.1em",
                    textTransform: "uppercase",
                    borderBottom: "1px solid #1a1a2e",
                    cursor: "pointer",
                    userSelect: "none",
                    whiteSpace: "nowrap",
                  }}
                >
                  {label}{sortKey === key ? (sortDir === "desc" ? " ↓" : " ↑") : ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const label = r.players?.name || r.players?.handle || r.player_id.slice(0, 8) + "…";
              const posSty = r.position ? POSITION_STYLE[r.position] : null;
              const isHome = r.team_side === "home";
              return (
                <tr key={r.player_id + r.team_side} style={{ borderBottom: "1px solid #0a0a14" }}>
                  <td style={{ padding: "9px 20px", whiteSpace: "nowrap" }}>
                    <Link href={`/players/${r.player_id}`} style={{ fontWeight: 600, color: "#d0d0e8", textDecoration: "none" }} className="nav-link">
                      {label}
                    </Link>
                  </td>
                  <td style={{ padding: "9px 10px", textAlign: "center" }}>
                    {r.position ? (
                      <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 6px", color: posSty?.color ?? "#9090b0", background: posSty?.background ?? "rgba(255,255,255,0.06)" }}>
                        {r.position}
                      </span>
                    ) : <span style={{ color: "#2a2a3a" }}>—</span>}
                  </td>
                  <td style={{ padding: "9px 10px", textAlign: "center" }}>
                    <span style={{
                      fontSize: 10, fontWeight: 700, padding: "2px 6px",
                      color: isHome ? "#93c5fd" : "#fca5a5",
                      background: isHome ? "rgba(147,197,253,0.1)" : "rgba(239,68,68,0.1)",
                    }}>
                      {isHome ? "H" : "A"}
                    </span>
                  </td>
                  {COLUMNS.map(([, key]) => {
                    const val = (r[key as keyof PlayerStat] as number) ?? 0;
                    const isSorted = sortKey === key;
                    return (
                      <td key={key} style={{ padding: "9px 10px", textAlign: "center", color: isSorted ? "#e0e0f0" : val > 0 ? "#9090b0" : "#2a2a3a", fontWeight: isSorted && val > 0 ? 700 : 400, fontVariantNumeric: "tabular-nums" }}>
                        {val}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
