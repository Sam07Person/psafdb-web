"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { supabase } from "@/lib/supabaseClient";
import Link from "next/link";

// ── Types ────────────────────────────────────────────────────────────────────

type League = { id: string; name: string; season: string | null; format: string | null; zones: Zone[] | null; ended: boolean | null };
type Zone = { name: string; color: string; spots: number; type: "top" | "bottom" };

type Match = {
  id: string;
  home_team: string;
  away_team: string;
  home_score: number | null;
  away_score: number | null;
  played_at: string;
  day: number | null;
  group_name: string | null;
  forfeited_by: string | null;
  stage?: string | null;
};

type Fixture = {
  key: string; // unique key
  home_team: string;
  away_team: string;
  home_score: number | null;
  away_score: number | null;
  day: number | null;
  group_name: string | null;
  forfeited_by: string | null;
  isReal: boolean; // true = from DB, false = generated
  matchId: string | null;
  played: boolean; // true = already played (locked)
};

type StandingRow = {
  team: string; played: number; won: number; drawn: number; lost: number;
  gf: number; ga: number; points: number; forfeit_deductions: number;
};

// ── Standings logic ──────────────────────────────────────────────────────────

function applyMatchToStandings(s: Record<string, StandingRow>, home_team: string, away_team: string, home_score: number | null, away_score: number | null, forfeited_by: string | null) {
  const ensure = (name: string) => {
    if (!s[name]) s[name] = { team: name, played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, points: 0, forfeit_deductions: 0 };
  };
  ensure(home_team);
  ensure(away_team);
  if (home_score === null || away_score === null) return;

  const home = s[home_team];
  const away = s[away_team];

  home.played++; home.gf += home_score; home.ga += away_score;
  if (home_score > away_score) { home.won++; home.points += 3; }
  else if (home_score < away_score) { home.lost++; }
  else { home.drawn++; home.points += 1; }

  away.played++; away.gf += away_score; away.ga += home_score;
  if (away_score > home_score) { away.won++; away.points += 3; }
  else if (away_score < home_score) { away.lost++; }
  else { away.drawn++; away.points += 1; }

  if (forfeited_by === "home") { home.points -= 1; home.forfeit_deductions++; }
  else if (forfeited_by === "away") { away.points -= 1; away.forfeit_deductions++; }
}

function getH2HResult(teamA: string, teamB: string, fixtures: Fixture[]): number {
  for (const f of fixtures) {
    if (f.home_score === null || f.away_score === null) continue;
    if (f.home_team === teamA && f.away_team === teamB) {
      if (f.home_score > f.away_score) return 1;
      if (f.home_score < f.away_score) return -1;
      return 0;
    }
    if (f.home_team === teamB && f.away_team === teamA) {
      if (f.away_score > f.home_score) return 1;
      if (f.away_score < f.home_score) return -1;
      return 0;
    }
  }
  return 0;
}

function sortRows(rows: StandingRow[], fixtures?: Fixture[], mode: "league" | "group" = "league"): StandingRow[] {
  return [...rows].sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (mode === "group" && fixtures) {
      const h2h = getH2HResult(a.team, b.team, fixtures);
      if (h2h !== 0) return -h2h;
      const gdA = a.gf - a.ga, gdB = b.gf - b.ga;
      if (gdB !== gdA) return gdB - gdA;
      return b.gf - a.gf;
    }
    const gdA = a.gf - a.ga, gdB = b.gf - b.ga;
    if (gdB !== gdA) return gdB - gdA;
    if (fixtures) {
      const h2h = getH2HResult(a.team, b.team, fixtures);
      if (h2h !== 0) return -h2h;
    }
    return b.gf - a.gf;
  });
}

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

// ── Generate missing fixtures ────────────────────────────────────────────────

function generateMissingFixtures(teams: string[], existingMatches: Match[], group_name: string | null): Fixture[] {
  // Build set of pairs that already have a fixture (in either direction)
  const existingPairs = new Set<string>();
  const existingExact = new Set<string>();
  for (const m of existingMatches) {
    existingExact.add(`${m.home_team}__${m.away_team}`);
    // Canonical pair key (sorted alphabetically)
    const pair = [m.home_team, m.away_team].sort().join("__");
    existingPairs.add(pair);
  }

  const fixtures: Fixture[] = [];

  // First add all existing matches as fixtures
  for (const m of existingMatches) {
    const played = m.home_score !== null && m.away_score !== null;
    fixtures.push({
      key: m.id,
      home_team: m.home_team,
      away_team: m.away_team,
      home_score: m.home_score,
      away_score: m.away_score,
      day: m.day,
      group_name: m.group_name,
      forfeited_by: m.forfeited_by,
      isReal: true,
      matchId: m.id,
      played,
    });
  }

  // Detect if double round-robin: count pairs that have both directions
  let reverseCount = 0;
  for (const m of existingMatches) {
    if (existingExact.has(`${m.away_team}__${m.home_team}`)) reverseCount++;
  }
  // If >25% of matches have reverse fixtures, it's double round-robin
  const isDouble = reverseCount > existingMatches.length * 0.25;

  // Find highest existing day number
  const maxDay = existingMatches.reduce((max, m) => Math.max(max, m.day ?? 0), 0);
  const genDay = maxDay + 1;

  // Generate missing fixtures only for pairs with no match in either direction
  for (let i = 0; i < teams.length; i++) {
    for (let j = i + 1; j < teams.length; j++) {
      const pair = [teams[i], teams[j]].sort().join("__");
      if (existingPairs.has(pair)) {
        // Pair already has at least one fixture
        if (isDouble) {
          // Double round-robin: check if reverse also exists
          if (!existingExact.has(`${teams[i]}__${teams[j]}`)) {
            fixtures.push({
              key: `gen_${teams[i]}_${teams[j]}`,
              home_team: teams[i], away_team: teams[j],
              home_score: null, away_score: null, day: genDay,
              group_name, forfeited_by: null, isReal: false, matchId: null, played: false,
            });
          }
          if (!existingExact.has(`${teams[j]}__${teams[i]}`)) {
            fixtures.push({
              key: `gen_${teams[j]}_${teams[i]}`,
              home_team: teams[j], away_team: teams[i],
              home_score: null, away_score: null, day: genDay,
              group_name, forfeited_by: null, isReal: false, matchId: null, played: false,
            });
          }
        }
        continue;
      }
      // No fixture at all for this pair — generate one
      fixtures.push({
        key: `gen_${teams[i]}_${teams[j]}`,
        home_team: teams[i], away_team: teams[j],
        home_score: null, away_score: null, day: genDay,
        group_name, forfeited_by: null, isReal: false, matchId: null, played: false,
      });
    }
  }

  return fixtures;
}

// ── Component ────────────────────────────────────────────────────────────────

export default function TablePredictorPage() {
  const [leagues, setLeagues] = useState<League[]>([]);
  const [selectedLeague, setSelectedLeague] = useState<string | null>(null);
  const [teams, setTeams] = useState<string[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [fixtures, setFixtures] = useState<Fixture[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingLeague, setLoadingLeague] = useState(false);
  const [zones, setZones] = useState<Zone[]>([]);

  // Load leagues
  useEffect(() => {
    if (!supabase) return;
    (async () => {
      const { data } = await supabase
        .from("leagues")
        .select("id, name, season, format, zones, ended")
        .order("created_at", { ascending: false });
      // Only show active league-format leagues (not pure knockout, not ended)
      const filtered = (data ?? []).filter((l: any) => (l.format === "league" || l.format === "group_knockout") && !l.ended);
      setLeagues(filtered as League[]);
      setLoading(false);
    })();
  }, []);

  // Load league data when selected
  const loadLeague = useCallback(async (leagueId: string) => {
    if (!supabase) return;
    setLoadingLeague(true);
    setSelectedLeague(leagueId);

    const league = leagues.find(l => l.id === leagueId);
    setZones((league?.zones ?? []) as Zone[]);

    // Fetch teams
    const [{ data: direct }, { data: junction }] = await Promise.all([
      supabase.from("teams").select("id, name").eq("league_id", leagueId),
      supabase.from("team_leagues").select("team_id, teams(id, name)").eq("league_id", leagueId),
    ]);

    const seen = new Set<string>();
    const teamNames: string[] = [];
    for (const t of direct ?? []) {
      if (!seen.has(t.name)) { seen.add(t.name); teamNames.push(t.name); }
    }
    for (const j of junction ?? []) {
      const t = (j as any).teams;
      if (t && !seen.has(t.name)) { seen.add(t.name); teamNames.push(t.name); }
    }
    teamNames.sort();
    setTeams(teamNames);

    // Fetch matches with pagination (Supabase 1000-row cap)
    const PAGE = 999;
    const allMatches: Match[] = [];
    let from = 0;
    while (true) {
      const { data: page } = await supabase
        .from("matches")
        .select("id, home_team, away_team, home_score, away_score, played_at, day, group_name, forfeited_by, stage")
        .eq("league_id", leagueId)
        .order("played_at", { ascending: true })
        .range(from, from + PAGE - 1);
      if (!page || page.length === 0) break;
      allMatches.push(...(page as any[]));
      if (page.length < PAGE) break;
      from += PAGE;
    }
    // Filter out knockout matches — keep group stage and null stage, exclude knockout rounds
    const KNOCKOUT_STAGES = ["final", "third place", "semifinal", "semi-final", "quarterfinal", "quarter-final", "round of 16", "round of 32", "knockout"];
    const leagueMatches = allMatches.filter(m => {
      if (!m.stage) return true; // null/empty = league match
      if (m.stage === "group") return true; // group stage match
      return !KNOCKOUT_STAGES.some(k => (m.stage ?? "").toLowerCase().includes(k));
    }) as Match[];
    setMatches(leagueMatches);

    // Generate fixtures
    if (league?.format === "group_knockout") {
      // Group by group_name
      const groups = new Map<string, Match[]>();
      const groupTeams = new Map<string, Set<string>>();
      for (const m of leagueMatches) {
        const g = m.group_name ?? "default";
        if (!groups.has(g)) { groups.set(g, []); groupTeams.set(g, new Set()); }
        groups.get(g)!.push(m);
        groupTeams.get(g)!.add(m.home_team);
        groupTeams.get(g)!.add(m.away_team);
      }
      const allFixtures: Fixture[] = [];
      for (const [g, gMatches] of groups) {
        const gTeams = [...(groupTeams.get(g) ?? [])].sort();
        allFixtures.push(...generateMissingFixtures(gTeams, gMatches, g === "default" ? null : g));
      }
      setFixtures(allFixtures);
    } else {
      setFixtures(generateMissingFixtures(teamNames, leagueMatches, null));
    }

    setLoadingLeague(false);
  }, [leagues]);

  // Update fixture score
  const updateScore = useCallback((fixtureKey: string, side: "home" | "away", value: string) => {
    setFixtures(prev => prev.map(f => {
      if (f.key !== fixtureKey || f.played) return f;
      const num = value === "" ? null : parseInt(value, 10);
      if (value !== "" && isNaN(num!)) return f;
      return side === "home"
        ? { ...f, home_score: num }
        : { ...f, away_score: num };
    }));
  }, []);

  // Reset a fixture prediction
  const resetFixture = useCallback((fixtureKey: string) => {
    setFixtures(prev => prev.map(f => {
      if (f.key !== fixtureKey || f.played) return f;
      return { ...f, home_score: null, away_score: null, forfeited_by: null };
    }));
  }, []);

  // Forfeit a fixture (toggle)
  const forfeitFixture = useCallback((fixtureKey: string, side: "home" | "away") => {
    setFixtures(prev => prev.map(f => {
      if (f.key !== fixtureKey || f.played) return f;
      // If already forfeited by this side, undo it
      if (f.forfeited_by === side) {
        return { ...f, home_score: null, away_score: null, forfeited_by: null };
      }
      return {
        ...f,
        home_score: side === "home" ? 0 : 3,
        away_score: side === "home" ? 3 : 0,
        forfeited_by: side,
      };
    }));
  }, []);

  // Compute standings from all fixtures
  const standings = useMemo(() => {
    const league = leagues.find(l => l.id === selectedLeague);

    if (league?.format === "group_knockout") {
      // Group standings
      const groups = new Map<string, Fixture[]>();
      for (const f of fixtures) {
        const g = f.group_name ?? "default";
        if (!groups.has(g)) groups.set(g, []);
        groups.get(g)!.push(f);
      }
      const result = new Map<string, StandingRow[]>();
      for (const [g, gFixtures] of groups) {
        const s: Record<string, StandingRow> = {};
        for (const f of gFixtures) {
          applyMatchToStandings(s, f.home_team, f.away_team, f.home_score, f.away_score, f.forfeited_by);
        }
        // Ensure all teams appear even without results
        const gTeams = new Set<string>();
        for (const f of gFixtures) { gTeams.add(f.home_team); gTeams.add(f.away_team); }
        for (const t of gTeams) {
          if (!s[t]) s[t] = { team: t, played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, points: 0, forfeit_deductions: 0 };
        }
        result.set(g, sortRows(Object.values(s), gFixtures, "group"));
      }
      return result;
    } else {
      const s: Record<string, StandingRow> = {};
      for (const t of teams) s[t] = { team: t, played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, points: 0, forfeit_deductions: 0 };
      for (const f of fixtures) {
        applyMatchToStandings(s, f.home_team, f.away_team, f.home_score, f.away_score, f.forfeited_by);
      }
      return new Map([["default", sortRows(Object.values(s), fixtures)]]);
    }
  }, [fixtures, teams, selectedLeague, leagues]);

  // Group fixtures by day for display
  const fixturesByDay = useMemo(() => {
    const groups = new Map<string, Fixture[]>();
    for (const f of fixtures) {
      const dayLabel = f.played ? `MD ${f.day ?? "?"} (Played)` : `MD ${f.day ?? "?"}`;
      const key = `${f.played ? "p" : "u"}_${f.day ?? "?"}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(f);
    }
    // Sort: played first by day, then unplayed by day
    const sorted = [...groups.entries()].sort(([a], [b]) => {
      const aPlayed = a.startsWith("p");
      const bPlayed = b.startsWith("p");
      if (aPlayed !== bPlayed) return aPlayed ? -1 : 1;
      const aDay = parseInt(a.split("_")[1]) || 999;
      const bDay = parseInt(b.split("_")[1]) || 999;
      return aDay - bDay;
    });
    return sorted;
  }, [fixtures]);

  // Stats
  const predictedCount = fixtures.filter(f => !f.played && f.home_score !== null && f.away_score !== null).length;
  const remainingCount = fixtures.filter(f => !f.played && (f.home_score === null || f.away_score === null)).length;
  const playedCount = fixtures.filter(f => f.played).length;

  const selectedLeagueObj = leagues.find(l => l.id === selectedLeague);

  // Save predictions to file
  const savePredictions = useCallback(() => {
    const predictions = fixtures
      .filter(f => !f.played && f.home_score !== null && f.away_score !== null)
      .map(f => ({
        key: f.key,
        home_team: f.home_team,
        away_team: f.away_team,
        home_score: f.home_score,
        away_score: f.away_score,
        forfeited_by: f.forfeited_by,
      }));
    const payload = {
      league_id: selectedLeague,
      league_name: selectedLeagueObj?.name ?? "",
      saved_at: new Date().toISOString(),
      predictions,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `table-prediction-${(selectedLeagueObj?.name ?? "league").replace(/\s+/g, "-").toLowerCase()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [fixtures, selectedLeague, selectedLeagueObj]);

  // Load predictions from file
  const loadPredictions = useCallback(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const payload = JSON.parse(ev.target?.result as string);
          if (payload.league_id !== selectedLeague) {
            alert(`This prediction file is for "${payload.league_name}" but you have a different league selected.`);
            return;
          }
          const predMap = new Map<string, typeof payload.predictions[0]>();
          for (const p of payload.predictions) {
            predMap.set(p.key, p);
            // Also match by team pair for generated fixtures with different keys
            predMap.set(`${p.home_team}__${p.away_team}`, p);
          }
          setFixtures(prev => prev.map(f => {
            if (f.played) return f;
            const match = predMap.get(f.key) ?? predMap.get(`${f.home_team}__${f.away_team}`);
            if (match) {
              return {
                ...f,
                home_score: match.home_score,
                away_score: match.away_score,
                forfeited_by: match.forfeited_by ?? null,
              };
            }
            return f;
          }));
        } catch {
          alert("Invalid prediction file.");
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }, [selectedLeague]);

  return (
    <main style={{ minHeight: "calc(100vh - 56px)" }}>
      {/* Header */}
      <section style={{ borderBottom: "1px solid var(--border-main)", padding: "32px 24px 24px", background: "var(--bg-nav)" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto" }}>
          <div style={{ fontSize: 11, letterSpacing: "0.25em", color: "var(--text-faint)", fontWeight: 700, textTransform: "uppercase", marginBottom: 14 }}>
            <Link href="/" style={{ color: "var(--text-faint)", textDecoration: "none" }}>Home</Link>
            <span style={{ margin: "0 8px" }}>/</span>
            Table Predictor
          </div>
          <h1 style={{ fontSize: 32, fontWeight: 900, letterSpacing: "-0.02em", color: "var(--text-main)", margin: 0 }}>
            Table Predictor
          </h1>
          <p style={{ color: "var(--text-faint)", fontSize: 13, marginTop: 6 }}>
            Predict the remaining fixtures and see how the final table looks.
          </p>
        </div>
      </section>

      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "24px 24px 48px" }}>
        {/* League selector */}
        {loading ? (
          <div style={{ color: "var(--text-faint)", fontSize: 13, padding: "40px 0" }}>Loading leagues...</div>
        ) : (
          <>
            <div style={{ marginBottom: 24 }}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.15em", textTransform: "uppercase", color: "var(--text-faint)", marginBottom: 8 }}>
                Select League
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {leagues.map(l => (
                  <button
                    key={l.id}
                    onClick={() => loadLeague(l.id)}
                    style={{
                      padding: "8px 16px",
                      fontSize: 12,
                      fontWeight: 700,
                      letterSpacing: "0.06em",
                      background: selectedLeague === l.id ? "#f4c43018" : "var(--bg-card)",
                      color: selectedLeague === l.id ? "#f4c430" : "var(--text-sub)",
                      border: selectedLeague === l.id ? "1px solid #f4c430" : "1px solid var(--border-main)",
                      cursor: "pointer",
                      transition: "all 0.15s",
                    }}
                  >
                    {l.name}{l.season ? ` · S${l.season}` : ""}
                  </button>
                ))}
              </div>
            </div>

            {loadingLeague && (
              <div style={{ color: "var(--text-faint)", fontSize: 13, padding: "40px 0" }}>Loading league data...</div>
            )}

            {selectedLeague && !loadingLeague && (
              <>
              {/* Save / Load buttons */}
              <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
                <button
                  onClick={savePredictions}
                  disabled={predictedCount === 0}
                  style={{
                    padding: "7px 16px", fontSize: 11, fontWeight: 700, letterSpacing: "0.08em",
                    textTransform: "uppercase", cursor: predictedCount === 0 ? "default" : "pointer",
                    background: predictedCount > 0 ? "#22c55e18" : "var(--bg-card)",
                    color: predictedCount > 0 ? "#22c55e" : "var(--text-faint)",
                    border: predictedCount > 0 ? "1px solid #22c55e50" : "1px solid var(--border-main)",
                    transition: "all 0.15s",
                  }}
                >
                  Save Predictions
                </button>
                <button
                  onClick={loadPredictions}
                  style={{
                    padding: "7px 16px", fontSize: 11, fontWeight: 700, letterSpacing: "0.08em",
                    textTransform: "uppercase", cursor: "pointer",
                    background: "#4ea8f718", color: "#4ea8f7",
                    border: "1px solid #4ea8f750",
                    transition: "all 0.15s",
                  }}
                >
                  Load Predictions
                </button>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
                {/* Left: Standings */}
                <div>
                  <div style={{ position: "sticky", top: 56 }}>
                    {[...standings.entries()].map(([group, rows]) => (
                      <div key={group} style={{ marginBottom: 16 }}>
                        <div style={{
                          background: "var(--bg-card)", borderTop: "3px solid #f4c430",
                          padding: "14px 20px", fontSize: 11, fontWeight: 700, letterSpacing: "0.2em",
                          textTransform: "uppercase", color: "#f4c430",
                          display: "flex", alignItems: "center", justifyContent: "space-between",
                        }}>
                          <span>{group !== "default" ? group : "Standings"}</span>
                          <span style={{ fontSize: 10, color: "var(--text-faint)", fontWeight: 600, letterSpacing: "0.08em" }}>
                            {predictedCount} predicted · {remainingCount} remaining
                          </span>
                        </div>
                        <div style={{ overflowX: "auto" }}>
                          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                            <thead>
                              <tr style={{ background: "var(--bg-row)" }}>
                                {["#", "Team", "P", "W", "D", "L", "GF", "GA", "GD", "Pts"].map(h => (
                                  <th key={h} style={{
                                    padding: "8px 10px",
                                    textAlign: h === "Team" || h === "#" ? "left" : "center",
                                    fontSize: 10, color: "var(--text-faint)", fontWeight: 700,
                                    letterSpacing: "0.15em", textTransform: "uppercase",
                                    borderBottom: "1px solid var(--border-main)", whiteSpace: "nowrap",
                                  }}>{h}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {rows.map((row, index) => {
                                const gd = row.gf - row.ga;
                                const zone = getRowZone(index, rows.length, zones);
                                return (
                                  <tr key={row.team} style={{
                                    borderBottom: "1px solid var(--border-row)",
                                    background: zone ? `${zone.color}18` : "transparent",
                                    borderLeft: zone ? `2px solid ${zone.color}` : "2px solid transparent",
                                    transition: "background 0.2s",
                                  }}>
                                    <td style={{ padding: "10px 10px", color: "var(--text-faint)", fontSize: 11, fontWeight: 700 }}>{index + 1}</td>
                                    <td style={{ padding: "10px 10px", fontWeight: 700, color: "var(--text-body)", whiteSpace: "nowrap" }}>{row.team}</td>
                                    <td style={{ padding: "10px 10px", textAlign: "center", color: "var(--text-muted)" }}>{row.played}</td>
                                    <td style={{ padding: "10px 10px", textAlign: "center", color: "#4ade80", fontWeight: 600 }}>{row.won}</td>
                                    <td style={{ padding: "10px 10px", textAlign: "center", color: "#f4c430", fontWeight: 600 }}>{row.drawn}</td>
                                    <td style={{ padding: "10px 10px", textAlign: "center", color: "#e63946", fontWeight: 600 }}>{row.lost}</td>
                                    <td style={{ padding: "10px 10px", textAlign: "center", color: "var(--text-sub)" }}>{row.gf}</td>
                                    <td style={{ padding: "10px 10px", textAlign: "center", color: "var(--text-sub)" }}>{row.ga}</td>
                                    <td style={{ padding: "10px 10px", textAlign: "center", color: gd > 0 ? "#4ade80" : gd < 0 ? "#e63946" : "var(--text-muted)", fontWeight: 600 }}>
                                      {gd > 0 ? "+" : ""}{gd}
                                    </td>
                                    <td style={{ padding: "10px 14px", textAlign: "center", fontWeight: 900, fontSize: 15, color: "var(--text-main)" }}>{row.points}</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                        {/* Zone legend */}
                        {zones.length > 0 && group === [...standings.keys()][0] && (
                          <div style={{ background: "var(--bg-row)", padding: "6px 12px", display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
                            {zones.map((zone, i) => (
                              <div key={i} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                <span style={{ display: "inline-block", width: 8, height: 8, background: zone.color, flexShrink: 0 }} />
                                <span style={{ fontSize: 10, color: "var(--text-muted)", letterSpacing: "0.08em" }}>{zone.name}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Right: Fixtures */}
                <div>
                  {fixturesByDay.map(([dayKey, dayFixtures]) => {
                    const isPlayedGroup = dayKey.startsWith("p");
                    const dayNum = dayKey.split("_")[1];
                    return (
                      <div key={dayKey} style={{ marginBottom: 16 }}>
                        <div style={{
                          background: "var(--bg-card)",
                          borderTop: `3px solid ${isPlayedGroup ? "#22c55e" : "#4ea8f7"}`,
                          padding: "10px 16px",
                          fontSize: 10, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase",
                          color: isPlayedGroup ? "#22c55e" : "#4ea8f7",
                          display: "flex", justifyContent: "space-between", alignItems: "center",
                        }}>
                          <span>Matchday {dayNum}</span>
                          {isPlayedGroup && (
                            <span style={{ fontSize: 9, color: "#22c55e", background: "#22c55e15", padding: "2px 8px", letterSpacing: "0.1em" }}>
                              PLAYED
                            </span>
                          )}
                          {!isPlayedGroup && (
                            <span style={{ fontSize: 9, color: "#4ea8f7", background: "#4ea8f715", padding: "2px 8px", letterSpacing: "0.1em" }}>
                              PREDICT
                            </span>
                          )}
                        </div>
                        {dayFixtures.map(f => (
                          <FixtureRow
                            key={f.key}
                            fixture={f}
                            onUpdate={updateScore}
                            onReset={resetFixture}
                            onForfeit={forfeitFixture}
                          />
                        ))}
                      </div>
                    );
                  })}
                </div>
              </div>
              </>
            )}
          </>
        )}
      </div>
    </main>
  );
}

// ── Fixture Row ──────────────────────────────────────────────────────────────

function FixtureRow({
  fixture: f,
  onUpdate,
  onReset,
  onForfeit,
}: {
  fixture: Fixture;
  onUpdate: (key: string, side: "home" | "away", value: string) => void;
  onReset: (key: string) => void;
  onForfeit: (key: string, side: "home" | "away") => void;
}) {
  const predicted = !f.played && f.home_score !== null && f.away_score !== null;
  const isForfeited = f.forfeited_by !== null;

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 6,
      background: "var(--bg-card)", borderBottom: "1px solid var(--border-row)",
      padding: "8px 12px",
      opacity: f.played ? 0.7 : 1,
    }}>
      {/* Group badge */}
      {f.group_name && (
        <span style={{ fontSize: 9, color: "var(--text-faint)", fontWeight: 700, letterSpacing: "0.1em", minWidth: 42, textTransform: "uppercase" }}>
          {f.group_name.replace("Group ", "Grp ")}
        </span>
      )}

      {/* Home FF button */}
      {!f.played && (
        <button
          onClick={() => onForfeit(f.key, "home")}
          title={`${f.home_team} forfeits`}
          style={{
            padding: "2px 5px", fontSize: 8, fontWeight: 800, letterSpacing: "0.05em",
            background: isForfeited && f.forfeited_by === "home" ? "#e6394630" : "transparent",
            border: isForfeited && f.forfeited_by === "home" ? "1px solid #e6394660" : "1px solid var(--border-main)",
            color: isForfeited && f.forfeited_by === "home" ? "#e63946" : "var(--text-faint)",
            cursor: "pointer", lineHeight: 1.2,
          }}
        >
          FF
        </button>
      )}

      {/* Home team */}
      <div style={{
        flex: 1, textAlign: "right", fontSize: 12, fontWeight: 700,
        color: isForfeited && f.forfeited_by === "home" ? "#e63946"
          : predicted && f.home_score! > f.away_score! ? "#4ade80" : "var(--text-body)",
        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
      }}>
        {f.home_team}
      </div>

      {/* Score inputs */}
      {f.played ? (
        <div style={{
          display: "flex", alignItems: "center", gap: 4,
          fontWeight: 900, fontSize: 14, color: "var(--text-main)", fontVariantNumeric: "tabular-nums",
          minWidth: 60, justifyContent: "center",
        }}>
          {f.home_score} <span style={{ color: "var(--text-faint)", fontSize: 10 }}>-</span> {f.away_score}
        </div>
      ) : (
        <div style={{ display: "flex", alignItems: "center", gap: 4, minWidth: 80, justifyContent: "center" }}>
          <input
            type="text"
            inputMode="numeric"
            value={f.home_score ?? ""}
            onChange={e => {
              onUpdate(f.key, "home", e.target.value);
            }}
            style={{
              width: 28, height: 28, textAlign: "center",
              background: f.home_score !== null ? (isForfeited ? "#e6394618" : "#4ea8f718") : "var(--bg-base)",
              border: f.home_score !== null ? (isForfeited ? "1px solid #e6394650" : "1px solid #4ea8f750") : "1px solid var(--border-main)",
              color: "var(--text-main)", fontSize: 13, fontWeight: 800,
              outline: "none", fontVariantNumeric: "tabular-nums",
            }}
            maxLength={2}
            disabled={isForfeited}
          />
          <span style={{ color: "var(--text-faint)", fontSize: 10 }}>-</span>
          <input
            type="text"
            inputMode="numeric"
            value={f.away_score ?? ""}
            onChange={e => {
              onUpdate(f.key, "away", e.target.value);
            }}
            style={{
              width: 28, height: 28, textAlign: "center",
              background: f.away_score !== null ? (isForfeited ? "#e6394618" : "#4ea8f718") : "var(--bg-base)",
              border: f.away_score !== null ? (isForfeited ? "1px solid #e6394650" : "1px solid #4ea8f750") : "1px solid var(--border-main)",
              color: "var(--text-main)", fontSize: 13, fontWeight: 800,
              outline: "none", fontVariantNumeric: "tabular-nums",
            }}
            maxLength={2}
            disabled={isForfeited}
          />
          {predicted && (
            <button
              onClick={() => onReset(f.key)}
              style={{
                width: 18, height: 18, fontSize: 10, lineHeight: 1,
                background: "transparent", border: "none", color: "var(--text-faint)",
                cursor: "pointer", padding: 0,
              }}
              title="Reset"
            >
              ✕
            </button>
          )}
        </div>
      )}

      {/* Away team */}
      <div style={{
        flex: 1, fontSize: 12, fontWeight: 700,
        color: isForfeited && f.forfeited_by === "away" ? "#e63946"
          : predicted && f.away_score! > f.home_score! ? "#4ade80" : "var(--text-body)",
        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
      }}>
        {f.away_team}
      </div>

      {/* Away FF button */}
      {!f.played && (
        <button
          onClick={() => onForfeit(f.key, "away")}
          title={`${f.away_team} forfeits`}
          style={{
            padding: "2px 5px", fontSize: 8, fontWeight: 800, letterSpacing: "0.05em",
            background: isForfeited && f.forfeited_by === "away" ? "#e6394630" : "transparent",
            border: isForfeited && f.forfeited_by === "away" ? "1px solid #e6394660" : "1px solid var(--border-main)",
            color: isForfeited && f.forfeited_by === "away" ? "#e63946" : "var(--text-faint)",
            cursor: "pointer", lineHeight: 1.2,
          }}
        >
          FF
        </button>
      )}
    </div>
  );
}
