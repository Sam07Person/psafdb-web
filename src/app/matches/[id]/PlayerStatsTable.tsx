"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { getRatingColor } from "@/lib/ratings";

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
  matchRating: number | null;
  overallRating: number | null;
  players?: { handle: string | null; name: string | null } | null;
};

type SortKey = keyof Omit<PlayerStat, "player_id" | "team_side" | "position" | "players">;

const POSITION_ORDER: Record<string, number> = {
  GK: 0,
  LB: 1, LCB: 2, CB: 3, RCB: 4, RB: 5,
  LWB: 6, RWB: 7,
  LM: 8, CM: 9, RM: 10,
  LW: 11, RW: 12,
  LF: 13, RF: 14, CF: 15, ST: 16,
};

function posRank(pos: string | null) {
  return pos ? (POSITION_ORDER[pos] ?? 99) : 99;
}

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
  ["Rtg",   "matchRating"],
];

function TeamTable({
  rows,
  teamName,
  sortKey,
  sortDir,
  onToggleSort,
  accentColor,
}: {
  rows: PlayerStat[];
  teamName: string;
  sortKey: SortKey | "position";
  sortDir: "desc" | "asc";
  onToggleSort: (key: SortKey) => void;
  accentColor: string;
}) {
  return (
    <div>
      <div style={{
        background: "#0d0d1a",
        borderTop: `3px solid ${accentColor}`,
        padding: "12px 20px",
        fontSize: 12,
        fontWeight: 800,
        letterSpacing: "0.12em",
        textTransform: "uppercase",
        color: accentColor,
      }}>
        {teamName}
        <span style={{ marginLeft: 10, fontSize: 10, fontWeight: 400, color: "#3a3a5a" }}>
          {rows.length} player{rows.length !== 1 ? "s" : ""}
        </span>
      </div>
      <div style={{ background: "#0d0d1a", overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, minWidth: 860 }}>
          <thead>
            <tr style={{ background: "#09090f" }}>
              <th style={{ padding: "8px 20px", textAlign: "left", fontSize: 10, color: "#3a3a5a", fontWeight: 700, letterSpacing: "0.15em", textTransform: "uppercase", borderBottom: "1px solid #1a1a2e", whiteSpace: "nowrap" }}>Player</th>
              <th style={{ padding: "8px 10px", textAlign: "center", fontSize: 10, color: "#3a3a5a", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", borderBottom: "1px solid #1a1a2e" }}>Pos</th>
              {COLUMNS.map(([label, key]) => (
                <th
                  key={key}
                  onClick={() => onToggleSort(key)}
                  style={{
                    padding: "8px 10px",
                    textAlign: "center",
                    fontSize: 10,
                    color: sortKey !== "position" && sortKey === key ? accentColor : "#3a3a5a",
                    fontWeight: 700,
                    letterSpacing: "0.1em",
                    textTransform: "uppercase",
                    borderBottom: "1px solid #1a1a2e",
                    cursor: "pointer",
                    userSelect: "none",
                    whiteSpace: "nowrap",
                  }}
                >
                  {label}{sortKey !== "position" && sortKey === key ? (sortDir === "desc" ? " ↓" : " ↑") : ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={2 + COLUMNS.length} style={{ padding: "24px 20px", textAlign: "center", color: "#2a2a3a", fontSize: 12 }}>
                  No players found
                </td>
              </tr>
            ) : rows.map((r) => {
              const label = r.players?.name || r.players?.handle || r.player_id.slice(0, 8) + "…";
              const posSty = r.position ? POSITION_STYLE[r.position] : null;
              return (
                <tr key={r.player_id} style={{ borderBottom: "1px solid #0a0a14" }}>
                  <td style={{ padding: "9px 20px", whiteSpace: "nowrap" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                      <Link href={`/players/${r.player_id}`} style={{ fontWeight: 600, color: "#d0d0e8", textDecoration: "none" }} className="nav-link">
                        {label}
                      </Link>
                      {r.overallRating != null && (
                        <span style={{
                          fontSize: 9, fontWeight: 900, letterSpacing: "0.04em",
                          color: getRatingColor(r.overallRating),
                          border: `1px solid ${getRatingColor(r.overallRating)}55`,
                          padding: "1px 5px", background: "rgba(0,0,0,0.3)", flexShrink: 0,
                        }}>
                          {r.overallRating}
                        </span>
                      )}
                    </div>
                  </td>
                  <td style={{ padding: "9px 10px", textAlign: "center" }}>
                    {r.position ? (
                      <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 6px", color: posSty?.color ?? "#9090b0", background: posSty?.background ?? "rgba(255,255,255,0.06)" }}>
                        {r.position}
                      </span>
                    ) : <span style={{ color: "#2a2a3a" }}>—</span>}
                  </td>
                  {COLUMNS.map(([, key]) => {
                    const isSorted = sortKey !== "position" && sortKey === key;
                    if (key === "matchRating") {
                      const rtg = r.matchRating;
                      return (
                        <td key={key} style={{ padding: "9px 10px", textAlign: "center", background: isSorted ? "rgba(255,255,255,0.03)" : undefined }}>
                          {rtg != null
                            ? <span style={{ fontWeight: 900, fontSize: 13, color: getRatingColor(rtg) }}>{rtg}</span>
                            : <span style={{ color: "#2a2a3a" }}>—</span>}
                        </td>
                      );
                    }
                    const val = (r[key as keyof PlayerStat] as number) ?? 0;
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
  const [positionFilter, setPositionFilter] = useState("all");
  const [sortKey, setSortKey] = useState<SortKey | "position">("position");
  const [sortDir, setSortDir] = useState<"desc" | "asc">("asc");

  const availablePositions = useMemo(() => {
    const set = new Set<string>();
    playerStats.forEach((r) => { if (r.position) set.add(r.position); });
    return Array.from(set).sort();
  }, [playerStats]);

  const filtered = useMemo(() => {
    const needle = playerFilter.trim().toLowerCase();
    return playerStats.filter((r) => {
      if (positionFilter !== "all" && r.position !== positionFilter) return false;
      if (needle) {
        const name = (r.players?.name ?? "").toLowerCase();
        const handle = (r.players?.handle ?? "").toLowerCase();
        if (!name.includes(needle) && !handle.includes(needle)) return false;
      }
      return true;
    });
  }, [playerStats, playerFilter, positionFilter]);

  const sorted = useMemo(() => {
    if (sortKey === "position") {
      return [...filtered].sort((a, b) => posRank(a.position) - posRank(b.position));
    }
    const dir = sortDir === "desc" ? -1 : 1;
    return [...filtered].sort((a, b) => {
      const av = (a[sortKey] as number) ?? 0;
      const bv = (b[sortKey] as number) ?? 0;
      if (av !== bv) return av < bv ? dir : -dir;
      // secondary sort by position when tied
      return posRank(a.position) - posRank(b.position);
    });
  }, [filtered, sortKey, sortDir]);

  const homeRows = sorted.filter((r) => r.team_side === "home");
  const awayRows = sorted.filter((r) => r.team_side === "away");

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => d === "desc" ? "asc" : "desc");
    else { setSortKey(key); setSortDir("desc"); }
    // clicking a stat column exits position-order mode
  }

  const inputStyle: React.CSSProperties = {
    background: "#09090f",
    border: "1px solid #1a1a2e",
    color: "#e0e0f0",
    padding: "7px 12px",
    fontSize: 12,
    outline: "none",
  };

  if (playerStats.length === 0) return null;

  return (
    <div>
      {/* Section header */}
      <div style={{ background: "#0d0d1a", borderTop: "3px solid #a78bfa", padding: "14px 20px", fontSize: 11, fontWeight: 700, letterSpacing: "0.2em", textTransform: "uppercase", color: "#a78bfa" }}>
        Player Stats
      </div>

      {/* Filters */}
      <div style={{ background: "#0a0a13", borderBottom: "1px solid #1a1a2e", padding: "12px 20px", display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <input
          value={playerFilter}
          onChange={(e) => setPlayerFilter(e.target.value)}
          placeholder="Search player..."
          style={{ ...inputStyle, width: 180 }}
        />
        <select value={positionFilter} onChange={(e) => setPositionFilter(e.target.value)} style={inputStyle}>
          <option value="all">All positions</option>
          {availablePositions.map((pos) => (
            <option key={pos} value={pos}>{pos}</option>
          ))}
        </select>
      </div>

      {/* Home team */}
      <div style={{ marginTop: 2 }}>
        <TeamTable
          rows={homeRows}
          teamName={homeTeam}
          sortKey={sortKey}
          sortDir={sortDir}
          onToggleSort={toggleSort}
          accentColor="#93c5fd"
        />
      </div>

      {/* Away team */}
      <div style={{ marginTop: 2 }}>
        <TeamTable
          rows={awayRows}
          teamName={awayTeam}
          sortKey={sortKey}
          sortDir={sortDir}
          onToggleSort={toggleSort}
          accentColor="#fca5a5"
        />
      </div>
    </div>
  );
}
