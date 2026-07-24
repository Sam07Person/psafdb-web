"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, useRef, useEffect } from "react";

export type LeagueOption = { id: string; name: string; ended: boolean };

export function StatsFilterBar({ leagues, selectedLeagues = [], seasons = [], selectedSeason = "", matchdays = [], dayFrom, dayTo }: { leagues: LeagueOption[]; selectedLeagues?: string[]; seasons?: string[]; selectedSeason?: string; matchdays?: number[]; dayFrom?: number; dayTo?: number }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const selectedSet = new Set(selectedLeagues);

  const toggleLeague = (id: string) => {
    const next = new Set(selectedSet);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    const params = new URLSearchParams(searchParams.toString());
    if (next.size > 0) params.set("league", [...next].join(","));
    else params.delete("league");
    params.delete("tab");
    router.push(`/stats?${params.toString()}`);
  };

  const clearLeagues = () => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("league");
    params.delete("tab");
    router.push(`/stats?${params.toString()}`);
  };

  const handleSeason = (val: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (val) params.set("season", val);
    else params.delete("season");
    params.delete("tab");
    router.push(`/stats?${params.toString()}`);
  };

  const handleDayFrom = (val: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (val === "") params.delete("from");
    else params.set("from", val);
    router.push(`/stats?${params.toString()}`);
  };

  const handleDayTo = (val: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (val === "") params.delete("to");
    else params.set("to", val);
    router.push(`/stats?${params.toString()}`);
  };

  const clearMatchdays = () => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("from");
    params.delete("to");
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

  const leagueLabel = selectedLeagues.length === 0
    ? "All Leagues"
    : selectedLeagues.length === 1
      ? (leagues.find(l => l.id === selectedLeagues[0])?.name ?? "1 League")
      : `${selectedLeagues.length} Leagues`;

  return (
    <div style={{ borderBottom: "1px solid var(--border-main)", background: "var(--bg-nav)", padding: "14px 24px" }}>
      <div style={{ maxWidth: 1200, margin: "0 auto", display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
        {/* League multi-select */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.15em", textTransform: "uppercase", color: "var(--text-faint)" }}>
            League
          </span>
          <div ref={dropdownRef} style={{ position: "relative" }}>
            <button
              onClick={() => setDropdownOpen(v => !v)}
              style={{
                background: "var(--bg-card)",
                border: `1px solid ${selectedLeagues.length > 0 ? "#7070f0" : "var(--border-main)"}`,
                color: selectedLeagues.length > 0 ? "#9090f8" : "var(--text-body)",
                padding: "5px 10px",
                fontSize: 12,
                cursor: "pointer",
                minWidth: 180,
                textAlign: "left",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
              }}
            >
              <span>{leagueLabel}</span>
              <span style={{ fontSize: 9, opacity: 0.6 }}>{dropdownOpen ? "▲" : "▼"}</span>
            </button>

            {dropdownOpen && (
              <div style={{
                position: "absolute",
                top: "100%",
                left: 0,
                marginTop: 4,
                background: "var(--bg-card)",
                border: "1px solid var(--border-main)",
                zIndex: 100,
                minWidth: 240,
                maxHeight: 320,
                overflowY: "auto",
                boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
              }}>
                {/* Clear all */}
                <button
                  onClick={clearLeagues}
                  style={{
                    width: "100%", textAlign: "left", padding: "8px 12px",
                    fontSize: 11, fontWeight: 700, color: selectedLeagues.length === 0 ? "#9090f8" : "var(--text-muted)",
                    background: selectedLeagues.length === 0 ? "#7070f015" : "transparent",
                    border: "none", borderBottom: "1px solid var(--border-main)",
                    cursor: "pointer", letterSpacing: "0.06em",
                  }}
                >
                  All Leagues
                </button>
                {leagues.map(l => {
                  const active = selectedSet.has(l.id);
                  return (
                    <button
                      key={l.id}
                      onClick={() => toggleLeague(l.id)}
                      style={{
                        width: "100%", textAlign: "left", padding: "7px 12px",
                        fontSize: 12, fontWeight: active ? 700 : 400,
                        color: active ? "#9090f8" : "var(--text-body)",
                        background: active ? "#7070f015" : "transparent",
                        border: "none", borderBottom: "1px solid var(--border-row)",
                        cursor: "pointer",
                        display: "flex", alignItems: "center", gap: 8,
                      }}
                    >
                      <span style={{
                        display: "inline-flex", alignItems: "center", justifyContent: "center",
                        width: 16, height: 16, fontSize: 10,
                        border: `1px solid ${active ? "#7070f0" : "var(--border-main)"}`,
                        background: active ? "#7070f030" : "transparent",
                        color: active ? "#9090f8" : "transparent",
                        flexShrink: 0,
                      }}>
                        {active ? "✓" : ""}
                      </span>
                      <span>{l.name}{l.ended ? " (ended)" : ""}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Season filter */}
        {seasons.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.15em", textTransform: "uppercase", color: "var(--text-faint)" }}>
              Season
            </span>
            <select
              value={selectedSeason}
              onChange={e => handleSeason(e.target.value)}
              style={{
                background: "var(--bg-card)",
                border: "1px solid var(--border-main)",
                color: "var(--text-body)",
                padding: "5px 10px",
                fontSize: 12,
                cursor: "pointer",
                minWidth: 80,
              }}
            >
              <option value="">All Seasons</option>
              {seasons.map(s => (
                <option key={s} value={s}>Season {s}</option>
              ))}
            </select>
          </div>
        )}

        {/* Matchday range filter */}
        {matchdays.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.15em", textTransform: "uppercase", color: "var(--text-faint)" }}>
              Matchday
            </span>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <select
                value={dayFrom ?? ""}
                onChange={e => handleDayFrom(e.target.value)}
                style={{
                  background: "var(--bg-card)",
                  border: `1px solid ${dayFrom != null ? "#7070f0" : "var(--border-main)"}`,
                  color: dayFrom != null ? "#9090f8" : "var(--text-body)",
                  padding: "5px 8px",
                  fontSize: 12,
                  cursor: "pointer",
                  minWidth: 64,
                }}
              >
                <option value="">From</option>
                {matchdays.map(d => (
                  <option key={`f${d}`} value={d}>MD {d}</option>
                ))}
              </select>
              <span style={{ fontSize: 11, color: "var(--text-faint)" }}>–</span>
              <select
                value={dayTo ?? ""}
                onChange={e => handleDayTo(e.target.value)}
                style={{
                  background: "var(--bg-card)",
                  border: `1px solid ${dayTo != null ? "#7070f0" : "var(--border-main)"}`,
                  color: dayTo != null ? "#9090f8" : "var(--text-body)",
                  padding: "5px 8px",
                  fontSize: 12,
                  cursor: "pointer",
                  minWidth: 64,
                }}
              >
                <option value="">To</option>
                {matchdays.map(d => (
                  <option key={`t${d}`} value={d}>MD {d}</option>
                ))}
              </select>
              {(dayFrom != null || dayTo != null) && (
                <button
                  onClick={clearMatchdays}
                  title="Clear matchday range"
                  style={{
                    background: "transparent",
                    border: "1px solid var(--border-main)",
                    color: "var(--text-faint)",
                    padding: "4px 7px",
                    fontSize: 11,
                    cursor: "pointer",
                    lineHeight: 1,
                  }}
                >
                  ✕
                </button>
              )}
            </div>
          </div>
        )}

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
