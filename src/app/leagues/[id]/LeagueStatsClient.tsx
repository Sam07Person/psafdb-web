"use client";

import { useState } from "react";
import Link from "next/link";

export type PlayerStat = {
  playerId: string;
  name: string;
  position?: string | null;
  games: number;
  goals: number;
  assists: number;
  key_passes: number;
  passes: number;
  shots_on_target: number;
  tackles: number;
  key_tackles: number;
  interceptions: number;
  key_interceptions: number;
  possessions_lost: number;
  gk_saves: number;
  gk_catches: number;
};

export type TeamStat = {
  name: string;
  teamId: string | null;
  games: number;
  gf: number;
  ga: number;
  cs: number;
};

type Section = "attacking" | "passing" | "defending" | "gk" | "teams";

const SECTIONS: { id: Section; label: string }[] = [
  { id: "attacking", label: "Attacking" },
  { id: "passing", label: "Passing" },
  { id: "defending", label: "Defending" },
  { id: "gk", label: "Goalkeeping" },
  { id: "teams", label: "Team Stats" },
];

const thStyle: React.CSSProperties = {
  padding: "8px 12px",
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: "0.15em",
  textTransform: "uppercase",
  borderBottom: "1px solid var(--border-main)",
  whiteSpace: "nowrap",
  userSelect: "none",
};

const tdStyle: React.CSSProperties = {
  padding: "9px 12px",
  fontSize: 13,
};

function SortIndicator({ active, asc }: { active: boolean; asc: boolean }) {
  if (!active) return <span style={{ opacity: 0.25, fontSize: 9, marginLeft: 3 }}>↕</span>;
  return <span style={{ fontSize: 9, marginLeft: 3 }}>{asc ? "↑" : "↓"}</span>;
}

type ColDef<T> = {
  key: keyof T;
  label: string;
  defaultAsc?: boolean;
  render?: (val: any, row: T, rank: number) => React.ReactNode;
  align?: "left" | "center" | "right";
};

function StatTable<T extends Record<string, any>>({
  rows,
  cols,
  defaultSort,
  rowKey,
  minGames = 1,
}: {
  rows: T[];
  cols: ColDef<T>[];
  defaultSort: keyof T;
  rowKey: (r: T) => string;
  minGames?: number;
}) {
  const [sortKey, setSortKey] = useState<keyof T>(defaultSort);
  const [asc, setAsc] = useState(false);

  const filtered = rows.filter(r => (r.games ?? r.gf ?? 0) >= minGames);
  const sorted = [...filtered].sort((a, b) => {
    const va = a[sortKey] as number;
    const vb = b[sortKey] as number;
    if (va === vb) return 0;
    return asc ? va - vb : vb - va;
  });

  const toggle = (key: keyof T) => {
    if (key === sortKey) {
      setAsc(v => !v);
    } else {
      setSortKey(key);
      const col = cols.find(c => c.key === key);
      setAsc(col?.defaultAsc ?? false);
    }
  };

  if (sorted.length === 0) {
    return (
      <div style={{ padding: "32px 20px", textAlign: "center", color: "var(--text-faint)", fontSize: 13 }}>
        No data yet
      </div>
    );
  }

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ background: "var(--bg-row)" }}>
            <th style={{ ...thStyle, textAlign: "left", color: "var(--text-faint)", width: 32 }}>#</th>
            {cols.map(col => (
              <th
                key={String(col.key)}
                onClick={() => toggle(col.key)}
                style={{
                  ...thStyle,
                  textAlign: col.align ?? (col.key === "name" ? "left" : "center"),
                  color: sortKey === col.key ? "var(--text-sub)" : "var(--text-faint)",
                  cursor: "pointer",
                }}
              >
                {col.label}
                <SortIndicator active={sortKey === col.key} asc={asc} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, i) => (
            <tr key={rowKey(row)} style={{ borderBottom: "1px solid var(--border-row)" }}>
              <td style={{ ...tdStyle, color: "var(--text-faint)", fontSize: 11, fontWeight: 700 }}>{i + 1}</td>
              {cols.map(col => (
                <td
                  key={String(col.key)}
                  style={{
                    ...tdStyle,
                    textAlign: col.align ?? (col.key === "name" ? "left" : "center"),
                    fontWeight: col.key === "name" ? 700 : 400,
                    color: col.key === "name" ? "var(--text-body)" : "var(--text-sub)",
                  }}
                >
                  {col.render ? col.render(row[col.key], row, i) : (row[col.key] ?? 0)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PlayerLink({ stat }: { stat: PlayerStat }) {
  return (
    <Link href={`/players/${stat.playerId}`} style={{ color: "inherit", textDecoration: "none" }} className="nav-link">
      {stat.name}
    </Link>
  );
}

export function LeagueStatsClient({
  playerStats,
  teamStats,
  teamIdMap,
  defaultSection,
  onSectionChange,
  hideSectionNav,
  activeTeamNames,
  showTeamFilters,
  showPlayerFilters,
}: {
  playerStats: PlayerStat[];
  teamStats: TeamStat[];
  teamIdMap: Record<string, string>;
  defaultSection?: Section;
  onSectionChange?: (s: Section) => void;
  hideSectionNav?: boolean;
  activeTeamNames?: string[];
  showTeamFilters?: boolean;
  showPlayerFilters?: boolean;
}) {
  const [section, setSection] = useState<Section>(defaultSection ?? "attacking");
  const [teamMinGames, setTeamMinGames] = useState(0);
  const [playerMinGames, setPlayerMinGames] = useState(0);
  const [activeOnly, setActiveOnly] = useState(true);
  const [selectedPositions, setSelectedPositions] = useState<Set<string>>(new Set());

  const handleSection = (s: Section) => {
    setSection(s);
    onSectionChange?.(s);
  };

  // All distinct positions present in the data, ordered by position role
  const POSITION_ORDER = [
    "GK",
    "LB", "LWB", "CB", "RB", "RWB",
    "CDM",
    "CM", "CAM",
    "LM", "LW", "RM", "RW",
    "CF", "SS", "ST",
    "SUB 1", "SUB 2", "SUB 3",
  ];
  const presentPositions = new Set(playerStats.map(p => p.position?.toUpperCase()).filter(Boolean) as string[]);
  const availablePositions = [
    ...POSITION_ORDER.filter(p => presentPositions.has(p)),
    ...[...presentPositions].filter(p => !POSITION_ORDER.includes(p)).sort(),
  ];

  const filteredPlayers = playerStats.filter(p => {
    if (showPlayerFilters && playerMinGames > 0 && p.games < playerMinGames) return false;
    if (showPlayerFilters && selectedPositions.size > 0 && !selectedPositions.has(p.position?.toUpperCase() || "")) return false;
    return true;
  });
  const gkPlayers = filteredPlayers.filter(p => p.gk_saves > 0 || p.gk_catches > 0);

  const isPlayerSection = section === "attacking" || section === "passing" || section === "defending" || section === "gk";

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", padding: "28px 24px" }}>
      {/* Section nav */}
      {!hideSectionNav && <div style={{ display: "flex", gap: 4, marginBottom: 20, flexWrap: "wrap" }}>
        {SECTIONS.map(s => (
          <button
            key={s.id}
            onClick={() => handleSection(s.id)}
            style={{
              padding: "6px 14px",
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              background: section === s.id ? "#7070f020" : "var(--bg-card)",
              border: `1px solid ${section === s.id ? "#7070f0" : "var(--border-main)"}`,
              color: section === s.id ? "#9090f8" : "var(--text-muted)",
              cursor: "pointer",
            }}
          >
            {s.label}
          </button>
        ))}
      </div>}

      {/* Player min games + position filter */}
      {showPlayerFilters && isPlayerSection && (
        <div style={{ background: "var(--bg-card)", padding: "10px 20px", borderBottom: "1px solid var(--border-main)", display: "flex", alignItems: "center", gap: 16, marginBottom: 0, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--text-faint)" }}>Min GP</span>
            <select
              value={playerMinGames}
              onChange={e => setPlayerMinGames(Number(e.target.value))}
              style={{
                background: "var(--bg-base)", border: "1px solid var(--border-main)",
                color: "var(--text-body)", padding: "3px 8px", fontSize: 11, cursor: "pointer",
              }}
            >
              {[0, 1, 2, 3, 5, 8, 10, 15, 20].map(n => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </div>
          {availablePositions.length > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--text-faint)" }}>Position</span>
              {availablePositions.map(pos => {
                const active = selectedPositions.has(pos);
                return (
                  <button
                    key={pos}
                    onClick={() => {
                      setSelectedPositions(prev => {
                        const next = new Set(prev);
                        if (next.has(pos)) next.delete(pos); else next.add(pos);
                        return next;
                      });
                    }}
                    style={{
                      padding: "2px 8px",
                      fontSize: 10,
                      fontWeight: 700,
                      letterSpacing: "0.08em",
                      textTransform: "uppercase",
                      background: active ? "#7070f020" : "var(--bg-base)",
                      border: `1px solid ${active ? "#7070f0" : "var(--border-main)"}`,
                      color: active ? "#9090f8" : "var(--text-faint)",
                      cursor: "pointer",
                    }}
                  >
                    {pos}
                  </button>
                );
              })}
              {selectedPositions.size > 0 && (
                <button
                  onClick={() => setSelectedPositions(new Set())}
                  style={{
                    padding: "2px 8px", fontSize: 10, fontWeight: 700,
                    background: "transparent", border: "1px solid var(--border-main)",
                    color: "var(--text-faint)", cursor: "pointer",
                  }}
                >
                  Clear
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Attacking */}
      {section === "attacking" && (
        <div style={{ background: "var(--bg-card)", borderTop: "3px solid #e63946" }}>
          <div style={{ padding: "12px 20px", fontSize: 11, fontWeight: 700, letterSpacing: "0.2em", textTransform: "uppercase", color: "#e63946", borderBottom: "1px solid var(--border-main)" }}>
            Attacking Stats
          </div>
          <StatTable<PlayerStat>
            rows={filteredPlayers}
            defaultSort="goals"
            rowKey={r => r.playerId}
            cols={[
              { key: "name", label: "Player", render: (_, r) => <PlayerLink stat={r} /> },
              { key: "games", label: "GP" },
              { key: "goals", label: "Goals" },
              { key: "assists", label: "Assists" },
              { key: "shots_on_target", label: "SoT" },
              { key: "key_passes", label: "Key Passes" },
            ]}
          />
        </div>
      )}

      {/* Passing */}
      {section === "passing" && (
        <div style={{ background: "var(--bg-card)", borderTop: "3px solid #4ea8f7" }}>
          <div style={{ padding: "12px 20px", fontSize: 11, fontWeight: 700, letterSpacing: "0.2em", textTransform: "uppercase", color: "#4ea8f7", borderBottom: "1px solid var(--border-main)" }}>
            Passing Stats
          </div>
          <StatTable<PlayerStat & { passes_pg: number; kp_pg: number }>
            rows={filteredPlayers.map(p => ({
              ...p,
              passes_pg: p.games > 0 ? Math.round((p.passes / p.games) * 10) / 10 : 0,
              kp_pg: p.games > 0 ? Math.round((p.key_passes / p.games) * 10) / 10 : 0,
            }))}
            defaultSort="passes"
            rowKey={r => r.playerId}
            cols={[
              { key: "name", label: "Player", render: (_, r) => <PlayerLink stat={r} /> },
              { key: "games", label: "GP" },
              { key: "passes", label: "Total Passes" },
              { key: "passes_pg", label: "Passes/Game" },
              { key: "key_passes", label: "Key Passes" },
              { key: "kp_pg", label: "KP/Game" },
            ]}
          />
        </div>
      )}

      {/* Defending */}
      {section === "defending" && (
        <div style={{ background: "var(--bg-card)", borderTop: "3px solid #4ade80" }}>
          <div style={{ padding: "12px 20px", fontSize: 11, fontWeight: 700, letterSpacing: "0.2em", textTransform: "uppercase", color: "#4ade80", borderBottom: "1px solid var(--border-main)" }}>
            Defensive Stats
          </div>
          <StatTable<PlayerStat & { total_tackles: number; total_ints: number }>
            rows={filteredPlayers.map(p => ({
              ...p,
              total_tackles: p.tackles + p.key_tackles,
              total_ints: p.interceptions + p.key_interceptions,
            }))}
            defaultSort="total_tackles"
            rowKey={r => r.playerId}
            cols={[
              { key: "name", label: "Player", render: (_, r) => <PlayerLink stat={r} /> },
              { key: "games", label: "GP" },
              { key: "total_tackles", label: "Tackles" },
              { key: "key_tackles", label: "Key Tackles" },
              { key: "total_ints", label: "Interceptions" },
              { key: "key_interceptions", label: "Key Int" },
              { key: "possessions_lost", label: "Poss. Lost", defaultAsc: true },
            ]}
          />
        </div>
      )}

      {/* GK */}
      {section === "gk" && (
        <div style={{ background: "var(--bg-card)", borderTop: "3px solid #f4c430" }}>
          <div style={{ padding: "12px 20px", fontSize: 11, fontWeight: 700, letterSpacing: "0.2em", textTransform: "uppercase", color: "#f4c430", borderBottom: "1px solid var(--border-main)" }}>
            Goalkeeping Stats
          </div>
          {gkPlayers.length === 0 ? (
            <div style={{ padding: "32px 20px", textAlign: "center", color: "var(--text-faint)", fontSize: 13 }}>No GK data recorded</div>
          ) : (
            <StatTable<PlayerStat & { saves_pg: number }>
              rows={gkPlayers.map(p => ({
                ...p,
                saves_pg: p.games > 0 ? Math.round((p.gk_saves / p.games) * 10) / 10 : 0,
              }))}
              defaultSort="gk_saves"
              rowKey={r => r.playerId}
              cols={[
                { key: "name", label: "Player", render: (_, r) => <PlayerLink stat={r} /> },
                { key: "games", label: "GP" },
                { key: "gk_saves", label: "Saves" },
                { key: "saves_pg", label: "Saves/Game" },
                { key: "gk_catches", label: "Catches" },
              ]}
            />
          )}
        </div>
      )}

      {/* Teams */}
      {section === "teams" && (() => {
        const activeSet = activeTeamNames ? new Set(activeTeamNames) : null;
        const filteredTeams = teamStats.filter(t => {
          if (showTeamFilters && activeOnly && activeSet && !activeSet.has(t.name)) return false;
          if (showTeamFilters && t.games < teamMinGames) return false;
          return true;
        });
        return (
        <div style={{ background: "var(--bg-card)", borderTop: "3px solid #a78bfa" }}>
          <div style={{ padding: "12px 20px", fontSize: 11, fontWeight: 700, letterSpacing: "0.2em", textTransform: "uppercase", color: "#a78bfa", borderBottom: "1px solid var(--border-main)", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
            <span>Team Stats</span>
            {showTeamFilters && (
              <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10, fontWeight: 600, letterSpacing: "0.08em", color: "var(--text-sub)", textTransform: "uppercase", cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={activeOnly}
                    onChange={e => setActiveOnly(e.target.checked)}
                    style={{ cursor: "pointer" }}
                  />
                  Active leagues only
                </label>
                <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.08em", color: "var(--text-sub)", textTransform: "uppercase" }}>Min GP</span>
                  <select
                    value={teamMinGames}
                    onChange={e => setTeamMinGames(Number(e.target.value))}
                    style={{
                      background: "var(--bg-base)", border: "1px solid var(--border-main)",
                      color: "var(--text-body)", padding: "3px 8px", fontSize: 11, cursor: "pointer",
                    }}
                  >
                    {[0, 1, 2, 3, 5, 8, 10, 15, 20].map(n => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </select>
                </div>
              </div>
            )}
          </div>
          <StatTable<TeamStat & { gd: number; gpg: number; gapg: number }>
            rows={filteredTeams.map(t => ({
              ...t,
              gd: t.gf - t.ga,
              gpg: t.games > 0 ? Math.round((t.gf / t.games) * 10) / 10 : 0,
              gapg: t.games > 0 ? Math.round((t.ga / t.games) * 10) / 10 : 0,
            }))}
            defaultSort="gf"
            rowKey={r => r.name}
            minGames={0}
            cols={[
              {
                key: "name",
                label: "Team",
                render: (val: string, r: TeamStat & { gd: number; gpg: number; gapg: number }) => {
                  const id = teamIdMap[val];
                  return id
                    ? <Link href={`/teams/${id}`} style={{ color: "inherit", textDecoration: "none" }} className="nav-link">{val}</Link>
                    : val;
                },
              },
              { key: "games", label: "GP" },
              { key: "gf", label: "Goals For" },
              { key: "ga", label: "Goals Against", defaultAsc: true },
              {
                key: "gd",
                label: "GD",
                render: (val: number) => (
                  <span style={{ color: val > 0 ? "#4ade80" : val < 0 ? "#e63946" : "var(--text-muted)", fontWeight: 600 }}>
                    {val > 0 ? "+" : ""}{val}
                  </span>
                ),
              },
              { key: "gpg", label: "GF/Game" },
              { key: "gapg", label: "GA/Game", defaultAsc: true },
              { key: "cs", label: "Clean Sheets" },
            ]}
          />
        </div>
        );
      })()}
    </div>
  );
}
