"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, useRef, useEffect } from "react";
import { useLanguage } from "@/components/LanguageProvider";

export type LeagueOption = { id: string; name: string; ended: boolean };

const STATUS_IDS = ["", "played", "upcoming"] as const;

export function MatchesFilterBar({
  leagues,
  search = "",
  status = "",
  selectedLeagues = [],
  seasons = [],
  selectedSeason = "",
  matchdays = [],
  dayFrom,
  dayTo,
}: {
  leagues: LeagueOption[];
  search?: string;
  status?: string;
  selectedLeagues?: string[];
  seasons?: string[];
  selectedSeason?: string;
  matchdays?: number[];
  dayFrom?: number;
  dayTo?: number;
}) {
  const router = useRouter();
  const { t } = useLanguage();
  const searchParams = useSearchParams();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [searchInput, setSearchInput] = useState(search);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Keep local input in sync when URL changes externally (e.g. clear all)
  useEffect(() => {
    setSearchInput(search);
  }, [search]);

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

  const push = (params: URLSearchParams) => {
    router.push(`/matches?${params.toString()}`);
  };

  const setParam = (key: string, val: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (val) params.set(key, val);
    else params.delete(key);
    push(params);
  };

  // Debounced search input
  useEffect(() => {
    const t = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString());
      const v = searchInput.trim();
      if (v) params.set("q", v);
      else params.delete("q");
      // Only push when actually changed to avoid loops
      if (params.get("q") !== (searchParams.get("q") ?? "")) push(params);
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  const selectedSet = new Set(selectedLeagues);

  const toggleLeague = (id: string) => {
    const next = new Set(selectedSet);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setParam("league", next.size > 0 ? [...next].join(",") : "");
  };

  const clearLeagues = () => setParam("league", "");

  const clearMatchdays = () => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("from");
    params.delete("to");
    push(params);
  };

  const clearAll = () => {
    router.push("/matches");
  };

  const anyFilterActive =
    status !== "" ||
    selectedLeagues.length > 0 ||
    selectedSeason !== "" ||
    dayFrom != null ||
    dayTo != null ||
    search.trim() !== "";

  const leagueLabel =
    selectedLeagues.length === 0
      ? t("matches.league.all")
      : selectedLeagues.length === 1
        ? (leagues.find((l) => l.id === selectedLeagues[0])?.name ?? t("matches.league.one"))
        : t("matches.league.many", { n: selectedLeagues.length });

  return (
    <div style={{ borderBottom: "1px solid var(--border-main)", background: "var(--bg-nav)", padding: "14px 24px" }}>
      <div style={{ maxWidth: 1200, margin: "0 auto", display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
        {/* Search */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.15em", textTransform: "uppercase", color: "var(--text-faint)" }}>
            Search
          </span>
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            aria-label="Search teams or league"
            style={{
              background: "var(--bg-card)",
              border: `1px solid ${search.trim() !== "" ? "#7070f0" : "var(--border-main)"}`,
              color: "var(--text-body)",
              padding: "6px 10px",
              fontSize: 12,
              outline: "none",
              width: 180,
            }}
          />
        </div>

        {/* Status filter */}
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {STATUS_IDS.map((id) => {
            const active = status === id;
            const label =
              id === "played" ? t("matches.status.played")
              : id === "upcoming" ? t("matches.status.upcoming")
              : t("matches.status.all");
            return (
              <button
                key={id}
                onClick={() => setParam("status", id)}
                style={{
                  padding: "5px 12px",
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  background: active ? "#7070f020" : "var(--bg-card)",
                  border: `1px solid ${active ? "#7070f0" : "var(--border-main)"}`,
                  color: active ? "#9090f8" : "var(--text-muted)",
                  cursor: "pointer",
                }}
              >
                {label}
              </button>
            );
          })}
        </div>

        {/* League multi-select */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.15em", textTransform: "uppercase", color: "var(--text-faint)" }}>
            League
          </span>
          <div ref={dropdownRef} style={{ position: "relative" }}>
            <button
              onClick={() => setDropdownOpen((v) => !v)}
              style={{
                background: "var(--bg-card)",
                border: `1px solid ${selectedLeagues.length > 0 ? "#7070f0" : "var(--border-main)"}`,
                color: selectedLeagues.length > 0 ? "#9090f8" : "var(--text-body)",
                padding: "5px 10px",
                fontSize: 12,
                cursor: "pointer",
                minWidth: 150,
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
              <div
                style={{
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
                }}
              >
                <button
                  onClick={clearLeagues}
                  style={{
                    width: "100%",
                    textAlign: "left",
                    padding: "8px 12px",
                    fontSize: 11,
                    fontWeight: 700,
                    color: selectedLeagues.length === 0 ? "#9090f8" : "var(--text-muted)",
                    background: selectedLeagues.length === 0 ? "#7070f015" : "transparent",
                    border: "none",
                    borderBottom: "1px solid var(--border-main)",
                    cursor: "pointer",
                    letterSpacing: "0.06em",
                  }}
                >
                  {t("matches.league.all")}
                </button>
                {[...leagues]
                  .sort((a, b) => Number(a.ended) - Number(b.ended))
                  .map((l) => {
                  const active = selectedSet.has(l.id);
                  return (
                    <button
                      key={l.id}
                      onClick={() => toggleLeague(l.id)}
                      style={{
                        width: "100%",
                        textAlign: "left",
                        padding: "7px 12px",
                        fontSize: 12,
                        fontWeight: active ? 700 : 400,
                        color: active ? "#9090f8" : "var(--text-body)",
                        background: active ? "#7070f015" : "transparent",
                        border: "none",
                        borderBottom: "1px solid var(--border-row)",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                      }}
                    >
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          width: 16,
                          height: 16,
                          fontSize: 10,
                          border: `1px solid ${active ? "#7070f0" : "var(--border-main)"}`,
                          background: active ? "#7070f030" : "transparent",
                          color: active ? "#9090f8" : "transparent",
                          flexShrink: 0,
                        }}
                      >
                        {active ? "✓" : ""}
                      </span>
                      <span>
                        {l.name}
                        {l.ended ? ` (${t("common.ended")})` : ""}
                      </span>
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
              onChange={(e) => setParam("season", e.target.value)}
              style={{
                background: "var(--bg-card)",
                border: `1px solid ${selectedSeason !== "" ? "#7070f0" : "var(--border-main)"}`,
                color: selectedSeason !== "" ? "#9090f8" : "var(--text-body)",
                padding: "5px 10px",
                fontSize: 12,
                cursor: "pointer",
                minWidth: 80,
              }}
            >
              <option value="">{t("matches.season.all")}</option>
              {seasons.map((s) => (
                <option key={s} value={s}>
                  {t("common.season")} {s}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Matchday range filter */}
        {matchdays.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.15em", textTransform: "uppercase", color: "var(--text-faint)" }}>
              {t("matches.matchday")}
            </span>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <select
                value={dayFrom ?? ""}
                onChange={(e) => setParam("from", e.target.value)}
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
                <option value="">{t("common.all")}</option>
                {matchdays.map((d) => (
                  <option key={`f${d}`} value={d}>
                    {t("matches.matchday")} {d}
                  </option>
                ))}
              </select>
              <span style={{ fontSize: 11, color: "var(--text-faint)" }}>–</span>
              <select
                value={dayTo ?? ""}
                onChange={(e) => setParam("to", e.target.value)}
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
                <option value="">{t("common.all")}</option>
                {matchdays.map((d) => (
                  <option key={`t${d}`} value={d}>
                    {t("matches.matchday")} {d}
                  </option>
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

        {/* Clear all */}
        {anyFilterActive && (
          <button
            onClick={clearAll}
            style={{
              marginLeft: "auto",
              background: "transparent",
              border: "1px solid var(--border-main)",
              color: "var(--text-faint)",
              padding: "5px 12px",
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              cursor: "pointer",
            }}
          >
            {t("common.clearAll")}
          </button>
        )}
      </div>
    </div>
  );
}
