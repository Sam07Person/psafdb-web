"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";

type SearchResults = {
  players: { id: string; name: string | null; handle: string | null }[];
  teams:   { id: string; name: string }[];
  leagues: { id: string; name: string; season: string | null }[];
  matches: { id: string; home_team: string; away_team: string; home_score: number; away_score: number; played_at: string }[];
};

type ResultItem = { href: string; label: string; sub: string; category: string };

function buildItems(r: SearchResults): ResultItem[] {
  const items: ResultItem[] = [];
  for (const p of r.players) {
    items.push({ category: "Players", href: `/players/${p.id}`, label: p.name ?? p.handle ?? "Unknown", sub: p.handle ?? "" });
  }
  for (const t of r.teams) {
    items.push({ category: "Teams", href: `/teams/${t.id}`, label: t.name, sub: "Team" });
  }
  for (const l of r.leagues) {
    items.push({ category: "Leagues", href: `/leagues/${l.id}`, label: l.name, sub: l.season ? `Season ${l.season}` : "League" });
  }
  for (const m of r.matches) {
    const date = new Date(m.played_at).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
    items.push({ category: "Matches", href: `/matches/${m.id}`, label: `${m.home_team} ${m.home_score}–${m.away_score} ${m.away_team}`, sub: date });
  }
  return items;
}

const CATEGORY_COLORS: Record<string, string> = {
  Players: "#4ea8f7",
  Teams:   "#a78bfa",
  Leagues: "#f4c430",
  Matches: "#e63946",
};

export default function SearchBar() {
  const [query, setQuery]     = useState("");
  const [results, setResults] = useState<SearchResults | null>(null);
  const [open, setOpen]       = useState(false);
  const [loading, setLoading] = useState(false);
  const [focused, setFocused] = useState(-1);

  const inputRef    = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const router      = useRouter();

  const items = results ? buildItems(results) : [];

  const search = useCallback(async (q: string) => {
    if (q.length < 2) { setResults(null); setOpen(false); return; }
    setLoading(true);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
      const data: SearchResults = await res.json();
      setResults(data);
      setOpen(true);
      setFocused(-1);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(query), 280);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, search]);

  // Close on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Global keyboard shortcut: / or Ctrl+K to focus
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if ((e.key === "/" || (e.ctrlKey && e.key === "k")) && document.activeElement !== inputRef.current) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    }
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!open || items.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setFocused(f => Math.min(f + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setFocused(f => Math.max(f - 1, -1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const target = focused >= 0 ? items[focused] : items[0];
      if (target) { router.push(target.href); setOpen(false); setQuery(""); }
    } else if (e.key === "Escape") {
      setOpen(false);
      inputRef.current?.blur();
    }
  }

  // Group items by category for display
  const grouped: Record<string, ResultItem[]> = {};
  let idx = 0;
  const itemIndices: number[] = [];
  for (const item of items) {
    if (!grouped[item.category]) grouped[item.category] = [];
    grouped[item.category].push(item);
    itemIndices.push(idx++);
  }

  const hasResults = items.length > 0;

  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      {/* Input */}
      <div style={{ display: "flex", alignItems: "center", background: "var(--bg-input)", borderWidth: 1, borderStyle: "solid", borderColor: open ? "#4ea8f740" : "var(--border-main)", borderRadius: 6, padding: "0 10px", gap: 6, width: 220, transition: "border-color 0.15s" }}>
        <svg width="13" height="13" viewBox="0 0 20 20" fill="none" style={{ flexShrink: 0, opacity: 0.35, color: "var(--text-main)" }}>
          <circle cx="8.5" cy="8.5" r="5.75" stroke="currentColor" strokeWidth="2" />
          <path d="M13 13l4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
        <input
          ref={inputRef}
          value={query}
          onChange={e => setQuery(e.target.value)}
          onFocus={() => { if (results && items.length > 0) setOpen(true); }}
          onKeyDown={handleKeyDown}
          placeholder="Search…"
          style={{
            background: "transparent",
            border: "none",
            outline: "none",
            color: "var(--text-main)",
            fontSize: 12,
            width: "100%",
            padding: "6px 0",
          }}
        />
        {loading ? (
          <span style={{ fontSize: 10, color: "var(--text-faint)", flexShrink: 0 }}>...</span>
        ) : (
          <kbd style={{ fontSize: 9, color: "var(--text-faint)", border: "1px solid var(--border-main)", borderRadius: 3, padding: "1px 4px", flexShrink: 0, lineHeight: 1.5 }}>
            /
          </kbd>
        )}
      </div>

      {/* Dropdown */}
      {open && (
        <div style={{
          position: "absolute",
          top: "calc(100% + 6px)",
          right: 0,
          width: 340,
          background: "var(--bg-card)",
          border: "1px solid var(--border-main)",
          borderRadius: 8,
          boxShadow: "0 16px 48px rgba(0,0,0,0.4)",
          zIndex: 1000,
          overflow: "hidden",
        }}>
          {!hasResults ? (
            <div style={{ padding: "14px 16px", fontSize: 12, color: "var(--text-faint)" }}>No results for "{query}"</div>
          ) : (
            <>
              {Object.entries(grouped).map(([category, catItems]) => {
                const color = CATEGORY_COLORS[category] ?? "#9090b0";
                return (
                  <div key={category}>
                    <div style={{ padding: "8px 14px 4px", fontSize: 9, fontWeight: 700, letterSpacing: "0.2em", textTransform: "uppercase", color }}>
                      {category}
                    </div>
                    {catItems.map((item) => {
                      const globalIdx = items.indexOf(item);
                      const isFocused = globalIdx === focused;
                      return (
                        <button
                          key={item.href}
                          onMouseDown={() => { router.push(item.href); setOpen(false); setQuery(""); }}
                          onMouseEnter={() => setFocused(globalIdx)}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            width: "100%",
                            padding: "8px 14px",
                            background: isFocused ? "var(--bg-input)" : "transparent",
                            border: "none",
                            cursor: "pointer",
                            textAlign: "left",
                            gap: 8,
                          }}
                        >
                          <span style={{ fontSize: 13, color: "var(--text-body)", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {item.label}
                          </span>
                          {item.sub && item.sub !== "Team" && (
                            <span style={{ fontSize: 11, color: "var(--text-muted)", flexShrink: 0 }}>{item.sub}</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                );
              })}
              <div style={{ borderTop: "1px solid var(--border-row)", padding: "6px 14px", fontSize: 10, color: "var(--text-faint)", display: "flex", gap: 12 }}>
                <span>↑↓ navigate</span>
                <span>↵ open</span>
                <span>esc close</span>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
