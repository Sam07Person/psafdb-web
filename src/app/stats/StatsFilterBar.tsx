"use client";

import { useRouter, useSearchParams } from "next/navigation";

export type LeagueOption = { id: string; name: string; ended: boolean };

export function StatsFilterBar({ leagues, selectedLeague }: { leagues: LeagueOption[]; selectedLeague: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const handleLeague = (val: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (val) params.set("league", val);
    else params.delete("league");
    // Reset tab when changing league
    params.delete("tab");
    router.push(`/stats?${params.toString()}`);
  };

  const handleTab = (tab: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (tab) params.set("tab", tab);
    else params.delete("tab");
    router.push(`/stats?${params.toString()}`);
  };

  const activeTab = searchParams.get("tab") || "attacking";

  const SECTIONS = [
    { id: "attacking", label: "Attacking" },
    { id: "passing", label: "Passing" },
    { id: "defending", label: "Defending" },
    { id: "gk", label: "Goalkeeping" },
    { id: "teams", label: "Team Stats" },
  ];

  return (
    <div style={{ borderBottom: "1px solid var(--border-main)", background: "var(--bg-nav)", padding: "14px 24px" }}>
      <div style={{ maxWidth: 1200, margin: "0 auto", display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
        {/* League filter */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.15em", textTransform: "uppercase", color: "var(--text-faint)" }}>
            League
          </span>
          <select
            value={selectedLeague}
            onChange={e => handleLeague(e.target.value)}
            style={{
              background: "var(--bg-card)",
              border: "1px solid var(--border-main)",
              color: "var(--text-body)",
              padding: "5px 10px",
              fontSize: 12,
              cursor: "pointer",
              minWidth: 180,
            }}
          >
            <option value="">All Leagues</option>
            {leagues.map(l => (
              <option key={l.id} value={l.id}>
                {l.name}{l.ended ? " (ended)" : ""}
              </option>
            ))}
          </select>
        </div>

        {/* Section tabs */}
        <div style={{ display: "flex", gap: 4, marginLeft: "auto", flexWrap: "wrap" }}>
          {SECTIONS.map(s => (
            <button
              key={s.id}
              onClick={() => handleTab(s.id)}
              style={{
                padding: "6px 14px",
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                background: activeTab === s.id ? "#7070f020" : "var(--bg-card)",
                border: `1px solid ${activeTab === s.id ? "#7070f0" : "var(--border-main)"}`,
                color: activeTab === s.id ? "#9090f8" : "var(--text-muted)",
                cursor: "pointer",
              }}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
