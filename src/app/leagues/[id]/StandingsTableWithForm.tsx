"use client";

import Link from "next/link";
import { useState, useRef } from "react";

type Zone = { name: string; color: string; spots: number; type: "top" | "bottom" };
type StandingRow = {
  team: string; played: number; won: number; drawn: number; lost: number;
  gf: number; ga: number; points: number; forfeit_deductions: number;
};

function getRowZone(index: number, totalRows: number, zones: Zone[]): Zone | null {
  let topOffset = 0;
  for (const zone of zones.filter(z => z.type === "top")) {
    if (index >= topOffset && index < topOffset + zone.spots) return zone;
    topOffset += zone.spots;
  }
  let bottomOffset = 0;
  for (const zone of zones.filter(z => z.type === "bottom")) {
    if (totalRows - 1 - index >= bottomOffset && totalRows - 1 - index < bottomOffset + zone.spots) return zone;
    bottomOffset += zone.spots;
  }
  return null;
}

type FormEntry = {
  result: "W" | "D" | "L";
  opponent: string;
  myScore: number;
  oppScore: number;
  isHome: boolean;
};

function getTeamForm(teamName: string, matches: any[]): FormEntry[] {
  return matches
    .filter((m: any) => (m.home_team === teamName || m.away_team === teamName) && m.home_score !== null)
    .slice(0, 4)
    .map((m: any) => {
      const isHome = m.home_team === teamName;
      const my = isHome ? m.home_score : m.away_score;
      const opp = isHome ? m.away_score : m.home_score;
      return {
        result: my > opp ? "W" as const : my < opp ? "L" as const : "D" as const,
        opponent: isHome ? m.away_team : m.home_team,
        myScore: my,
        oppScore: opp,
        isHome,
      };
    });
}

const RESULT_STYLE: Record<"W" | "D" | "L", { bg: string; color: string }> = {
  W: { bg: "#4ade8022", color: "#4ade80" },
  D: { bg: "#f4c43022", color: "#f4c430" },
  L: { bg: "#e6394622", color: "#e63946" },
};

function FormBadge({ entry }: { entry: FormEntry }) {
  const [show, setShow] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const [coords, setCoords] = useState({ top: 0, left: 0 });

  const label = entry.result === "W" ? "Win" : entry.result === "L" ? "Loss" : "Draw";

  const handleEnter = () => {
    if (ref.current) {
      const rect = ref.current.getBoundingClientRect();
      setCoords({ top: rect.top - 8, left: rect.left + rect.width / 2 });
    }
    setShow(true);
  };

  return (
    <span
      ref={ref}
      onMouseEnter={handleEnter}
      onMouseLeave={() => setShow(false)}
      style={{
        position: "relative",
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        width: 18, height: 18, borderRadius: 3, fontSize: 10, fontWeight: 800,
        background: RESULT_STYLE[entry.result].bg, color: RESULT_STYLE[entry.result].color,
        cursor: "default",
      }}
    >
      {entry.result}
      {show && (
        <div style={{
          position: "fixed",
          top: coords.top,
          left: coords.left,
          transform: "translate(-50%, -100%)",
          background: "#1a1a2e",
          border: `1px solid ${RESULT_STYLE[entry.result].color}40`,
          borderRadius: 6,
          padding: "6px 10px",
          whiteSpace: "nowrap",
          zIndex: 9999,
          pointerEvents: "none",
          boxShadow: "0 4px 12px rgba(0,0,0,0.5)",
        }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: RESULT_STYLE[entry.result].color, marginBottom: 2 }}>
            {label}
          </div>
          <div style={{ fontSize: 11, fontWeight: 600, color: "#e8e8f0" }}>
            vs {entry.opponent}
          </div>
          <div style={{ fontSize: 10, color: "#a0a0b8", marginTop: 1 }}>
            {entry.myScore} - {entry.oppScore} ({entry.isHome ? "Home" : "Away"})
          </div>
        </div>
      )}
    </span>
  );
}

export default function StandingsTableWithForm({
  rows,
  zones = [],
  teamIdMap,
  matches,
}: {
  rows: StandingRow[];
  zones?: Zone[];
  teamIdMap: Record<string, string>;
  matches: any[];
}) {
  const [showForm, setShowForm] = useState(false);

  return (
    <>
      {/* Header with toggle */}
      <div style={{ background: "var(--bg-card)", borderTop: "3px solid #f4c430", padding: "14px 20px", fontSize: 11, fontWeight: 700, letterSpacing: "0.2em", textTransform: "uppercase", color: "#f4c430", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span>Standings</span>
        {rows.length > 0 && (
          <button
            onClick={() => setShowForm(f => !f)}
            style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", cursor: "pointer", padding: "3px 10px", background: showForm ? "#f4c43018" : "transparent", color: showForm ? "#f4c430" : "var(--text-faint)", border: `1px solid ${showForm ? "#f4c430" : "var(--border-main)"}`, transition: "all 0.15s" }}
          >
            {showForm ? "Hide Form" : "Form"}
          </button>
        )}
      </div>

      {rows.length === 0 ? (
        <div style={{ background: "var(--bg-card)", padding: "40px 20px", textAlign: "center", color: "var(--text-faint)", fontSize: 13 }}>
          No teams yet
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "var(--bg-row)" }}>
                {["#", "Team", "P", "W", "D", "L", "GF", "GA", "GD", "Pts"].map(h => (
                  <th key={h} style={{ padding: "8px 12px", textAlign: h === "Team" || h === "#" ? "left" : "center", fontSize: 10, color: "var(--text-faint)", fontWeight: 700, letterSpacing: "0.15em", textTransform: "uppercase", borderBottom: "1px solid var(--border-main)", whiteSpace: "nowrap" }}>{h}</th>
                ))}
                {showForm && (
                  <th style={{ padding: "8px 12px", textAlign: "left", fontSize: 10, color: "#f4c430", fontWeight: 700, letterSpacing: "0.15em", textTransform: "uppercase", borderBottom: "1px solid var(--border-main)", whiteSpace: "nowrap" }}>
                    Form
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => {
                const gd = row.gf - row.ga;
                const zone = getRowZone(index, rows.length, zones);
                const form = showForm ? getTeamForm(row.team, matches) : [];
                return (
                  <tr key={row.team} style={{ borderBottom: "1px solid var(--border-row)", background: zone ? `${zone.color}18` : "transparent", borderLeft: zone ? `2px solid ${zone.color}` : "2px solid transparent" }}>
                    <td style={{ padding: "10px 12px", color: "var(--text-faint)", fontSize: 11, fontWeight: 700 }}>{index + 1}</td>
                    <td style={{ padding: "10px 12px", fontWeight: 700, color: "var(--text-body)" }}>
                      {teamIdMap[row.team] ? (
                        <Link href={`/teams/${teamIdMap[row.team]}`} style={{ color: "var(--text-body)", textDecoration: "none" }} className="nav-link">
                          {row.team}
                        </Link>
                      ) : row.team}
                    </td>
                    <td style={{ padding: "10px 12px", textAlign: "center", color: "var(--text-muted)" }}>{row.played}</td>
                    <td style={{ padding: "10px 12px", textAlign: "center", color: "#4ade80", fontWeight: 600 }}>{row.won}</td>
                    <td style={{ padding: "10px 12px", textAlign: "center", color: "#f4c430", fontWeight: 600 }}>{row.drawn}</td>
                    <td style={{ padding: "10px 12px", textAlign: "center", color: "#e63946", fontWeight: 600 }}>{row.lost}</td>
                    <td style={{ padding: "10px 12px", textAlign: "center", color: "var(--text-sub)" }}>{row.gf}</td>
                    <td style={{ padding: "10px 12px", textAlign: "center", color: "var(--text-sub)" }}>{row.ga}</td>
                    <td style={{ padding: "10px 12px", textAlign: "center", color: gd > 0 ? "#4ade80" : gd < 0 ? "#e63946" : "var(--text-muted)", fontWeight: 600 }}>
                      {gd > 0 ? "+" : ""}{gd}
                    </td>
                    <td style={{ padding: "10px 16px", textAlign: "center", fontWeight: 900, fontSize: 15, color: "var(--text-main)" }}>{row.points}</td>
                    {showForm && (
                      <td style={{ padding: "10px 12px" }}>
                        <div style={{ display: "flex", gap: 3, alignItems: "center" }}>
                          {form.map((f, i) => (
                            <FormBadge key={i} entry={f} />
                          ))}
                          {Array.from({ length: 4 - form.length }).map((_, i) => (
                            <span key={`e${i}`} style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 18, height: 18, borderRadius: 3, background: "var(--bg-row)", color: "var(--text-faint)", fontSize: 11 }}>·</span>
                          ))}
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Zone legend */}
      {zones.length > 0 && (
        <div style={{ background: "var(--bg-row)", padding: "6px 12px", display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
          {zones.map((zone, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ display: "inline-block", width: 8, height: 8, background: zone.color, flexShrink: 0 }} />
              <span style={{ fontSize: 10, color: "var(--text-muted)", letterSpacing: "0.08em" }}>{zone.name}</span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
