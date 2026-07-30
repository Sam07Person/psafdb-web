"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";

type Role = "GK" | "DEF" | "MID" | "FWD";

type Judgment = {
  attacking: number | null;
  defending: number | null;
  passing: number | null;
  consistency: number | null;
  gk: number | null;
  // Keeper components, judged instead of the single `gk` number.
  gk_gc: number | null;
  gk_saves: number | null;
  gk_catches: number | null;
  gk_efficiency: number | null;   // judged save %, becomes a ±12 bonus
  final: number | null;
  notes: string | null;
  skipped?: boolean;
};

type Item = {
  matchId: string;
  playerId: string;
  player: string;
  fixture: string;
  playedAt: string;
  leagueName: string | null;
  teamSide: "home" | "away";
  position: string;
  role: Role;
  result: "W" | "D" | "L";
  stats: Record<string, number>;
  formula: {
    final: number;
    scores: Record<string, number>;
    weights: Record<string, number>;
    resultBonus: number;
    role: Role;
    gk: {
      weights: Record<string, number>;
      scores: Record<string, number>;
      savePercent: number | null;
      efficiencyBonus: number;
    } | null;
  };
  judgment: Judgment | null;
};

const BLANK: Judgment = {
  attacking: null, defending: null, passing: null,
  consistency: null, gk: null,
  gk_gc: null, gk_saves: null, gk_catches: null, gk_efficiency: null,
  final: null, notes: null,
};

/** The numeric sub-rating fields — everything on Judgment except notes/skipped. */
type SubField =
  | "attacking" | "defending" | "passing" | "consistency" | "gk"
  | "gk_gc" | "gk_saves" | "gk_catches" | "gk_efficiency";

// Shares of the final rating for a keeper. Mirrors GK_PART_WEIGHTS in
// lib/ratings.ts; together with defending 5% + passing 5% + consistency 11%
// these sum to exactly 100%.
const GK_PART_WEIGHTS: Record<string, number> = {
  gk_gc: 0.30, gk_saves: 0.30, gk_catches: 0.19,
};

/**
 * Keeper judging order, as requested — the outfield categories that still apply,
 * then the four components that make up goalkeeping.
 */
const GK_FIELD_ORDER: SubField[] = [
  "defending", "passing", "consistency",
  "gk_gc", "gk_saves", "gk_catches", "gk_efficiency",
];

/** Save % → ±12 bonus. Same curve as saveEfficiencyBonus() in lib/ratings.ts. */
function saveEfficiencyBonus(savePercent: number): number {
  const d = savePercent / 100 - 0.55;
  return Math.min(12, Math.max(-12, d * (d >= 0 ? 50 : 30)));
}

/** Weight of a field for a role, expanding the lump GK weight into its parts. */
function weightOf(field: SubField, weights: Record<string, number>, isGk: boolean): number {
  if (field in GK_PART_WEIGHTS) return isGk ? GK_PART_WEIGHTS[field] : 0;
  if (field === "gk_efficiency") return 0; // a bonus, not a weighted share
  if (field === "gk") return isGk ? 0 : (weights.gk ?? 0); // superseded by the parts
  return weights[field] ?? 0;
}

/**
 * Which sub-ratings to ask for, taken from the position weights themselves rather
 * than a hand-written list — a category carrying 0% for this role contributes
 * nothing to the overall, so asking for it would only add noise.
 *
 * Order follows the stat columns (see COLUMNS), not the weights, so each input
 * sits directly beneath the stats you're judging it on.
 */
function relevantFields(weights: Record<string, number>, isGk: boolean): SubField[] {
  // Keepers use their own fixed order, since goalkeeping splits into four
  // components that don't map onto the outfield stat columns.
  if (isGk) return GK_FIELD_ORDER.filter(f => f === "gk_efficiency" || weightOf(f, weights, true) > 0);
  return COLUMNS
    .map(c => c.field)
    .filter((f): f is SubField => f != null && weightOf(f, weights, false) > 0);
}

/**
 * The overall is DERIVED, never typed in: each sub-rating is multiplied by its
 * position weight, summed, and the result bonus added — exactly how the formula
 * builds its own final. Judging the overall separately would let it contradict
 * the sub-ratings and make the calibration data self-inconsistent.
 *
 * Returns null until every weighted category has been filled in.
 */
function deriveFinal(
  draft: Judgment,
  weights: Record<string, number>,
  resultBonus: number,
  isGk: boolean
): number | null {
  const fields = relevantFields(weights, isGk);
  if (fields.length === 0) return null;

  let base = 0;
  let bonus = resultBonus;

  for (const f of fields) {
    const v = draft[f];
    if (typeof v !== "number") return null; // incomplete
    if (f === "gk_efficiency") {
      // Judged as a save percentage, applied as a ±12 bonus like the formula does.
      bonus += saveEfficiencyBonus(v);
    } else {
      base += v * weightOf(f, weights, isGk);
    }
  }
  return Math.round(Math.min(100, Math.max(0, base + bonus)));
}

const FIELD_LABEL: Record<string, string> = {
  attacking: "Attacking",
  defending: "Defending",
  passing: "Passing",
  consistency: "Consistency",
  gk: "Goalkeeping",
  gk_gc: "Goals conceded",
  gk_saves: "Saves",
  gk_catches: "Catches",
  gk_efficiency: "Save efficiency",
};

/**
 * One column = one stat group plus the sub-rating it feeds. Both the stats grid
 * and the inputs grid render from this single list, so an input always sits in
 * the same column as the stats it's judged on.
 */
const COLUMNS: { title: string; keys: string[]; field: SubField | null }[] = [
  { title: "Attack",  keys: ["goals", "assists", "shots", "shots_on_target", "key_passes"], field: "attacking" },
  { title: "Passing", keys: ["passes", "possessions_lost"], field: "passing" },
  { title: "Defence", keys: ["tackles", "key_tackles", "interceptions", "key_interceptions", "goals_conceded"], field: "defending" },
  { title: "Keeper",  keys: ["gk_saves", "gk_catches"], field: "gk" },
  { title: "In-game", keys: ["game_score"], field: "consistency" },
];

const STAT_LABEL: Record<string, string> = {
  goals: "Goals", assists: "Assists", shots: "Shots", shots_on_target: "On target",
  key_passes: "Key passes", passes: "Passes", possessions_lost: "Poss. lost",
  tackles: "Tackles", key_tackles: "Key tackles", interceptions: "Int.",
  key_interceptions: "Key int.", goals_conceded: "Conceded",
  gk_saves: "Saves", gk_catches: "Catches", game_score: "Game score",
};

function ratingColor(v: number | null): string {
  if (v == null) return "var(--text-faint)";
  if (v >= 80) return "#22c55e";
  if (v >= 70) return "#84cc16";
  if (v >= 60) return "#eab308";
  if (v >= 50) return "#f97316";
  return "#ef4444";
}

export default function RatingCalibrationPage() {
  const [password, setPassword] = useState("");
  const [token, setToken] = useState("");
  const [authenticated, setAuthenticated] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  const [items, setItems] = useState<Item[]>([]);
  const [counts, setCounts] = useState<Record<string, { total: number; judged: number; skipped: number }>>({});
  const [totalJudged, setTotalJudged] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [setupHint, setSetupHint] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<any>(null);

  const [roleFilter, setRoleFilter] = useState<Role | "">("");
  const [includeJudged, setIncludeJudged] = useState(false);
  const [limit, setLimit] = useState(25);
  // Calibration-only floor. Separate from the rating eligibility rule, so moving
  // it changes what you get asked to judge and nothing else.
  const [minScore, setMinScore] = useState(70);
  const [excludeSubs, setExcludeSubs] = useState(true);
  const [totalSkipped, setTotalSkipped] = useState(0);

  const [index, setIndex] = useState(0);
  const [draft, setDraft] = useState<Judgment>(BLANK);
  const [showFormula, setShowFormula] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);

  const authHeaders = useMemo(() => ({
    "Content-Type": "application/json",
    "x-admin-password": password,
    Authorization: `Bearer ${token}`,
  }), [password, token]);

  const current = items[index] ?? null;

  const load = useCallback(async (pw = password, tok = token) => {
    // Credentials are passed in explicitly by the restore path, because state set
    // in the same tick isn't readable here yet. Bailing out beats firing a
    // guaranteed-401 request with empty headers.
    if (!pw || !tok) return;

    setLoading(true);
    setError(null);
    setSetupHint(null);
    try {
      const params = new URLSearchParams({ limit: String(limit), minScore: String(minScore) });
      if (roleFilter) params.set("role", roleFilter);
      if (includeJudged) params.set("includeJudged", "1");
      if (!excludeSubs) params.set("excludeSubs", "0");
      const res = await fetch(`/api/admin/rating-calibration?${params}`, {
        headers: { "x-admin-password": pw, Authorization: `Bearer ${tok}` },
      });
      const body = await res.json();
      if (res.status === 401) {
        // Saved credentials are stale (or the env vars changed). Drop them and
        // show the login form rather than stranding the user on an error page.
        try { localStorage.removeItem("psafdb_admin_auth"); } catch {}
        setAuthenticated(false);
        setPassword("");
        setToken("");
        setLoginError("Your saved sign-in is no longer valid. Please sign in again.");
        return;
      }
      if (!res.ok) {
        if (body.setupRequired) setSetupHint(body.hint ?? null);
        throw new Error(body.error || "Failed to load");
      }
      setItems(body.items ?? []);
      setCounts(body.counts ?? {});
      setTotalJudged(body.totalJudged ?? 0);
      setTotalSkipped(body.totalSkipped ?? 0);
      setDiagnostics(body.diagnostics ?? null);
      setIndex(0);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [password, token, limit, roleFilter, includeJudged, minScore, excludeSubs]);

  // Restore the admin session saved by the import page.
  useEffect(() => {
    try {
      const saved = localStorage.getItem("psafdb_admin_auth");
      if (!saved) return;
      const { password: pw, token: tok } = JSON.parse(saved);
      if (!pw || !tok) return;
      setPassword(pw);
      setToken(tok);
      (async () => {
        const res = await fetch("/api/admin/rating-calibration?limit=1", {
          headers: { "x-admin-password": pw, Authorization: `Bearer ${tok}` },
        });
        if (!res.ok) {
          try { localStorage.removeItem("psafdb_admin_auth"); } catch {}
          return;
        }
        // The effect below owns loading. It depends on password/token, so it fires
        // once those land — no race with the setPassword/setToken above, which is
        // what made auto-login fail while manual login worked.
        setAuthenticated(true);
      })();
    } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reload when the queue filters change. Skipped until credentials exist, so the
  // restore path above owns the very first load.
  useEffect(() => {
    if (authenticated && password && token) load(password, token);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authenticated, password, token, roleFilter, includeJudged, limit, minScore, excludeSubs]);

  // Load the existing judgment (if any) whenever the current performance changes.
  useEffect(() => {
    if (!current) { setDraft(BLANK); return; }
    setDraft(current.judgment ? { ...BLANK, ...current.judgment } : BLANK);
    setShowFormula(false);
  }, [current?.matchId, current?.playerId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);
    try {
      const res = await fetch("/api/admin/rating-calibration?limit=1", {
        headers: { "x-admin-password": password, Authorization: `Bearer ${token}` },
      });
      if (!res.ok) { setLoginError("Invalid admin password or token"); return; }
      try { localStorage.setItem("psafdb_admin_auth", JSON.stringify({ password, token })); } catch {}
      setAuthenticated(true);
    } catch (err: any) {
      setLoginError(err.message || "Failed to connect");
    }
  };

  const save = async (advance: boolean) => {
    if (!current) return;
    // The overall is derived, so a null here means a category is still blank.
    const finalValue = deriveFinal(draft, current.formula.weights, current.formula.resultBonus, current.formula.role === "GK");
    if (finalValue == null) return;

    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/rating-calibration", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          matchId: current.matchId,
          playerId: current.playerId,
          role: current.role,
          position: current.position,
          ...draft,
          final: finalValue,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Save failed");

      setItems(prev => prev.map((it, i) => i === index ? { ...it, judgment: { ...draft, final: finalValue } } : it));
      setTotalJudged(n => current.judgment ? n : n + 1);
      setCounts(prev => current.judgment ? prev : ({
        ...prev,
        [current.role]: {
          total: prev[current.role]?.total ?? 0,
          judged: (prev[current.role]?.judged ?? 0) + 1,
          skipped: prev[current.role]?.skipped ?? 0,
        },
      }));
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 900);
      if (advance && index < items.length - 1) setIndex(i => i + 1);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  /**
   * Skip: record "not worth judging" and never queue it again. Distinct from just
   * clicking Next, which leaves the performance in the pool for a later batch.
   */
  const skip = async () => {
    if (!current) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/rating-calibration", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          matchId: current.matchId,
          playerId: current.playerId,
          role: current.role,
          position: current.position,
          skipped: true,
          skipReason: draft.notes || null,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Skip failed");

      // Drop it from the queue outright so the batch shrinks rather than leaving
      // a dead card you have to click past.
      setItems(prev => prev.filter((_, i) => i !== index));
      setTotalSkipped(n => n + 1);
      setCounts(prev => ({
        ...prev,
        [current.role]: {
          total: prev[current.role]?.total ?? 0,
          judged: prev[current.role]?.judged ?? 0,
          skipped: (prev[current.role]?.skipped ?? 0) + 1,
        },
      }));
      setIndex(i => Math.min(i, Math.max(0, items.length - 2)));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  // Keyboard: ← → to move, Ctrl/Cmd+Enter to save and advance.
  useEffect(() => {
    if (!authenticated) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      const typing = tag === "INPUT" || tag === "TEXTAREA";
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); save(true); return; }
      if (typing) return;
      if (e.key === "ArrowRight") setIndex(i => Math.min(items.length - 1, i + 1));
      if (e.key === "ArrowLeft") setIndex(i => Math.max(0, i - 1));
      if (e.key === "s" || e.key === "S") { e.preventDefault(); skip(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!authenticated) {
    return (
      <div style={{ maxWidth: 380, margin: "80px auto", padding: 24 }}>
        <h1 style={{ fontSize: 20, fontWeight: 800, marginBottom: 4 }}>Rating calibration</h1>
        <p style={{ color: "var(--text-muted)", fontSize: 13, marginBottom: 20 }}>Admin sign-in required.</p>
        <form onSubmit={handleLogin} style={{ display: "grid", gap: 10 }}>
          <input
            type="password" placeholder="Admin password" value={password}
            onChange={e => setPassword(e.target.value)} style={inputStyle}
          />
          <input
            type="password" placeholder="Admin token" value={token}
            onChange={e => setToken(e.target.value)} style={inputStyle}
          />
          {loginError && <div style={{ color: "#ef4444", fontSize: 12 }}>{loginError}</div>}
          <button type="submit" style={primaryBtn}>Sign in</button>
        </form>
      </div>
    );
  }

  const weights = current?.formula.weights ?? {};
  const isGk = current?.formula.role === "GK";
  const relevant = current ? relevantFields(weights, isGk) : [];

  // Columns shown for this performance. The Keeper column is dropped for outfield
  // players with no keeper stats; everything else always shows, so the stats and
  // the inputs below them stay in lockstep.
  const visibleColumns = current
    ? COLUMNS.filter(col =>
        col.title !== "Keeper" ||
        current.role === "GK" ||
        col.keys.some(k => (current.stats[k] ?? 0) > 0)
      )
    : [];
  const derivedFinal = current ? deriveFinal(draft, weights, current.formula.resultBonus, isGk) : null;
  const missingCount = relevant.filter(f => typeof draft[f] !== "number").length;
  const grandTotal = Object.values(counts).reduce((a, c) => a + c.total, 0);

  const judgedInBatch = items.filter(i => i.judgment).length;
  const batchComplete = items.length > 0 && judgedInBatch === items.length;
  const onLastItem = items.length > 0 && index >= items.length - 1;
  // With "include judged" on, the queue is a fixed stratified sample, so refetching
  // returns the same rows. Only the unjudged queue actually advances.
  const canLoadNext = !includeJudged;
  const remaining = grandTotal - totalJudged;

  return (
    <div style={{ maxWidth: 1000, margin: "0 auto", padding: "24px 20px 80px" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>Rating calibration</h1>
          <p style={{ color: "var(--text-muted)", fontSize: 13, margin: "4px 0 0" }}>
            Judge each performance as you think it should be rated. The formula gets fitted to match you.
          </p>
        </div>
        <Link href="/admin/import" style={{ fontSize: 12, color: "var(--text-muted)" }}>← Admin</Link>
      </div>

      {/* Progress */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "18px 0" }}>
        {(["GK", "DEF", "MID", "FWD"] as Role[]).map(r => {
          const c = counts[r] ?? { total: 0, judged: 0 };
          const pct = c.total > 0 ? Math.round((c.judged / c.total) * 100) : 0;
          return (
            <button
              key={r}
              onClick={() => setRoleFilter(roleFilter === r ? "" : r)}
              style={{
                ...chipStyle,
                borderColor: roleFilter === r ? "var(--text-body)" : "var(--border-row)",
                background: roleFilter === r ? "var(--bg-row)" : "transparent",
              }}
            >
              <strong>{r}</strong>
              <span style={{ color: "var(--text-muted)", marginLeft: 6 }}>{c.judged}/{c.total}</span>
              <span style={{ color: "var(--text-faint)", marginLeft: 6, fontSize: 10 }}>{pct}%</span>
            </button>
          );
        })}
      </div>

      {/* Queue filters */}
      <div style={{
        display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap",
        fontSize: 12, padding: "12px 14px", marginBottom: 16,
        border: "1px solid var(--border-row)", borderRadius: 8,
      }}>
        <label style={{ display: "flex", alignItems: "center", gap: 7, color: "var(--text-muted)" }}>
          Min game score
          <input
            type="number" min={0} max={700} step={10} value={minScore}
            onChange={e => setMinScore(Math.max(0, Number(e.target.value) || 0))}
            style={{ ...inputStyle, padding: "4px 6px", width: 72 }}
          />
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--text-muted)" }}>
          <input type="checkbox" checked={excludeSubs} onChange={e => setExcludeSubs(e.target.checked)} />
          Exclude subs
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--text-muted)" }}>
          <input type="checkbox" checked={includeJudged} onChange={e => setIncludeJudged(e.target.checked)} />
          Include judged
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--text-muted)" }}>
          Batch
          <select value={limit} onChange={e => setLimit(Number(e.target.value))} style={{ ...inputStyle, padding: "4px 6px", width: "auto" }}>
            {[10, 25, 50, 100].map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <div style={{ marginLeft: "auto", color: "var(--text-faint)" }}>
          {totalJudged} judged{totalSkipped > 0 ? ` · ${totalSkipped} skipped` : ""} of {grandTotal}
        </div>
      </div>

      <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: -8, marginBottom: 16 }}>
        The score floor only affects which performances get queued here — it never
        changes how any match is rated.
      </div>

      {error && (
        <div style={{ ...card, borderColor: "#ef4444", marginBottom: 16 }}>
          <div style={{ color: "#ef4444", fontSize: 13.5, fontWeight: 700 }}>{error}</div>
          {setupHint && (
            <div style={{ color: "var(--text-muted)", fontSize: 12.5, marginTop: 8, lineHeight: 1.6 }}>
              {setupHint}
              <div style={{ marginTop: 8, fontFamily: "monospace", fontSize: 11.5, color: "var(--text-sub)" }}>
                migrations/001_freeze_ratings.sql<br />
                migrations/002_rating_judgments.sql
              </div>
            </div>
          )}
          <button onClick={() => load()} style={{ ...ghostBtn, marginTop: 12 }}>Retry</button>
        </div>
      )}

      {loading && <div style={{ color: "var(--text-muted)", fontSize: 13 }}>Loading…</div>}

      {/* An empty queue has several possible causes — say which one it is. */}
      {!loading && !error && items.length === 0 && (
        <div style={{ ...card, textAlign: "center", padding: 36 }}>
          {diagnostics && diagnostics.totalRows === 0 ? (
            <>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>No player stats in the database</div>
              <div style={{ color: "var(--text-muted)", fontSize: 13 }}>
                Import some match results first — there's nothing to judge yet.
              </div>
            </>
          ) : totalJudged > 0 && grandTotal > 0 && totalJudged >= grandTotal ? (
            <>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>Everything has been judged</div>
              <div style={{ color: "var(--text-muted)", fontSize: 13 }}>
                {totalJudged} performances. Tick “Include judged” to revisit any of them.
              </div>
            </>
          ) : roleFilter ? (
            <>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>Nothing left to judge for {roleFilter}</div>
              <button onClick={() => setRoleFilter("")} style={{ ...ghostBtn, marginTop: 12 }}>Show all roles</button>
            </>
          ) : (
            <>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>No performances match the filters</div>
              {diagnostics && (
                <div style={{ color: "var(--text-muted)", fontSize: 12.5, marginTop: 10, lineHeight: 1.8 }}>
                  Of {diagnostics.totalRows} stat rows, none were eligible:
                  <div style={{ marginTop: 8, display: "inline-block", textAlign: "left" }}>
                    {Object.entries(diagnostics.rejected as Record<string, number>)
                      .filter(([, n]) => n > 0)
                      .map(([k, n]) => (
                        <div key={k}>
                          <strong style={{ color: "var(--text-sub)" }}>{n}</strong>{" "}
                          {({
                            noPosition: "have no position recorded",
                            benched: "were benched",
                            incomplete: "have incomplete stats",
                            noResult: "belong to a match with no final score",
                            badScore: "have no valid game score (0, or 1–60)",
                            wrongRole: "are a different role",
                            alreadyJudged: "have already been judged",
                          } as Record<string, string>)[k] ?? k}
                        </div>
                      ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Batch finished — pull a fresh set without touching the filters. */}
      {!loading && batchComplete && (
        <div style={{
          ...card,
          marginBottom: 16,
          borderColor: "#4ade80",
          display: "flex", alignItems: "center", justifyContent: "space-between",
          gap: 16, flexWrap: "wrap",
        }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15 }}>
              Batch complete — {judgedInBatch} judged
            </div>
            <div style={{ color: "var(--text-muted)", fontSize: 12.5, marginTop: 3 }}>
              {remaining > 0
                ? `${remaining} performance${remaining === 1 ? "" : "s"} left${roleFilter ? ` for ${roleFilter}` : ""}.`
                : "Everything has been judged."}
            </div>
          </div>
          {remaining > 0 && canLoadNext && (
            <button onClick={() => load()} disabled={loading} style={primaryBtn}>
              Load next {Math.min(limit, remaining)}
            </button>
          )}
          {!canLoadNext && (
            <span style={{ fontSize: 12, color: "var(--text-faint)", maxWidth: 260 }}>
              Untick “Include judged” to pull a fresh batch — with it on, the queue stays fixed.
            </span>
          )}
        </div>
      )}

      {current && (
        <div style={card}>
          {/* Header */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontSize: 19, fontWeight: 800 }}>{current.player}</div>
              <div style={{ color: "var(--text-muted)", fontSize: 13, marginTop: 3 }}>
                {current.position} · {current.role} ·{" "}
                <span style={{ color: current.result === "W" ? "#4ade80" : current.result === "D" ? "#f4c430" : "#e63946", fontWeight: 700 }}>
                  {current.result}
                </span>
              </div>
              <div style={{ color: "var(--text-faint)", fontSize: 12, marginTop: 3 }}>
                {current.fixture} · {current.playedAt}{current.leagueName ? ` · ${current.leagueName}` : ""}
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 11, color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: "0.12em" }}>
                {index + 1} / {items.length}
              </div>
              {current.judgment && (
                <div style={{ fontSize: 11, color: "#4ade80", marginTop: 4 }}>● already judged</div>
              )}
            </div>
          </div>

          {/* Stats — one column per category, mirrored exactly by the inputs below */}
          <div style={{ ...gridStyle(visibleColumns.length), margin: "18px 0 0", padding: "14px 0 0", borderTop: "1px solid var(--border-row)" }}>
            {visibleColumns.map(col => (
              <div key={col.title}>
                <div style={{ fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--text-faint)", marginBottom: 6 }}>
                  {col.title}
                </div>
                {col.keys.filter(k => current.stats[k] !== undefined).map(k => (
                  <div key={k} style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, padding: "2px 0" }}>
                    <span style={{ color: "var(--text-muted)" }}>{STAT_LABEL[k] ?? k}</span>
                    <strong style={{ color: "var(--text-body)" }}>{current.stats[k]}</strong>
                  </div>
                ))}
              </div>
            ))}
          </div>

          {/* Judgement inputs — same columns as the stats, so each input sits
              directly under the stats it's judged on. A category that carries no
              weight for this position renders an empty cell to hold the column. */}
          <div style={{
            ...gridStyle(isGk ? Math.min(4, relevant.length) : visibleColumns.length),
            padding: "14px 0 0", marginTop: 14, borderTop: "1px solid var(--border-row)",
          }}>
            {(isGk
              // Keepers judge a fixed list in its own order — goalkeeping splits
              // into four parts that don't line up with the outfield stat columns.
              ? relevant.map(f => ({ key: f as string, field: f }))
              : visibleColumns.map(col => ({ key: col.title, field: col.field }))
            ).map(({ key, field }) => {
              const w = field ? weightOf(field, weights, isGk) : 0;
              const isBonus = field === "gk_efficiency";

              if (!field || (w <= 0 && !isBonus)) {
                return (
                  <div key={key} style={{ opacity: 0.35, fontSize: 10.5, color: "var(--text-faint)", paddingTop: 18 }}>
                    not scored for {current.role}
                  </div>
                );
              }

              const v = draft[field];
              const filled = typeof v === "number";
              const bonusValue = isBonus && filled ? saveEfficiencyBonus(v as number) : null;

              return (
                <div key={key}>
                  <label style={{ ...labelStyle, display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 6 }}>
                    <span>{FIELD_LABEL[field]}</span>
                    <span style={{ color: "var(--text-muted)", fontWeight: 700, whiteSpace: "nowrap" }}>
                      {isBonus ? "bonus" : `${Math.round(w * 100)}%`}
                    </span>
                  </label>
                  <input
                    type="number" min={0} max={100}
                    value={filled ? (v as number) : ""}
                    onChange={e => setDraft(d => ({ ...d, [field]: e.target.value === "" ? null : Number(e.target.value) }))}
                    style={{ ...inputStyle, borderColor: filled ? ratingColor(v as number) : "var(--border-row)" }}
                    placeholder={isBonus ? "save %" : "0–100"}
                  />
                  <div style={{ fontSize: 10.5, color: "var(--text-faint)", marginTop: 4, minHeight: 14 }}>
                    {!filled ? "—"
                      : isBonus
                        ? `${bonusValue! >= 0 ? "+" : ""}${bonusValue!.toFixed(1)} bonus`
                        : `contributes ${((v as number) * w).toFixed(1)}`}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Derived overall */}
          <div style={{ marginTop: 18, paddingTop: 16, borderTop: "1px solid var(--border-row)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
              <div>
                <div style={{ ...labelStyle, marginBottom: 2 }}>Overall — calculated from the above</div>
                <div style={{ fontSize: 11.5, color: "var(--text-faint)" }}>
                  {missingCount > 0
                    ? `Fill in ${missingCount} more categor${missingCount === 1 ? "y" : "ies"} to get an overall.`
                    : <>
                        {relevant.filter(f => f !== "gk_efficiency").map((f, i) => (
                          <span key={f}>
                            {i > 0 && " + "}
                            {(draft[f] as number)}×{Math.round(weightOf(f, weights, isGk) * 100)}%
                          </span>
                        ))}
                        {typeof draft.gk_efficiency === "number" && (() => {
                          const b = saveEfficiencyBonus(draft.gk_efficiency);
                          return ` ${b >= 0 ? "+" : "−"} ${Math.abs(b).toFixed(1)} (save eff.)`;
                        })()}
                        {current.formula.resultBonus > 0 && ` + ${current.formula.resultBonus} (${current.result})`}
                      </>}
                </div>
              </div>
              <div style={{
                fontWeight: 900, fontSize: 34, lineHeight: 1,
                color: derivedFinal != null ? ratingColor(derivedFinal) : "var(--text-faint)",
                minWidth: 70, textAlign: "right",
              }}>
                {derivedFinal ?? "—"}
              </div>
            </div>
          </div>

          <div style={{ marginTop: 14 }}>
            <label style={labelStyle}>Notes (optional)</label>
            <input
              type="text" value={draft.notes ?? ""}
              onChange={e => setDraft(d => ({ ...d, notes: e.target.value || null }))}
              placeholder="Why this rating?"
              style={inputStyle}
            />
          </div>

          {/* Formula comparison, hidden until asked for */}
          <div style={{ marginTop: 16 }}>
            {!showFormula ? (
              <button onClick={() => setShowFormula(true)} style={ghostBtn}>
                Reveal what the formula says
              </button>
            ) : (
              <div style={{ padding: 12, background: "var(--bg-row)", borderRadius: 6, fontSize: 12.5 }}>
                {/* Per-category comparison: this is where the formula is actually
                    wrong or right, not the overall. */}
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead>
                    <tr style={{ color: "var(--text-faint)", fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.1em" }}>
                      <th style={{ textAlign: "left", padding: "0 0 6px" }}>Category</th>
                      <th style={{ textAlign: "right", padding: "0 0 6px" }}>Formula</th>
                      <th style={{ textAlign: "right", padding: "0 0 6px" }}>You</th>
                      <th style={{ textAlign: "right", padding: "0 0 6px" }}>Diff</th>
                    </tr>
                  </thead>
                  <tbody>
                    {relevant.map(f => {
                      const isBonus = f === "gk_efficiency";
                      const formulaScore = isBonus
                        ? current.formula.gk?.savePercent ?? null
                        : (current.formula.gk?.scores as any)?.[f] ?? current.formula.scores[f] ?? 0;
                      const fv = formulaScore == null ? null : Math.round(formulaScore);
                      const mine = draft[f];
                      const diff = typeof mine === "number" && fv != null ? mine - fv : null;
                      return (
                        <tr key={f}>
                          <td style={{ padding: "3px 0", color: "var(--text-muted)" }}>
                            {FIELD_LABEL[f]}
                            <span style={{ color: "var(--text-faint)" }}>
                              {" "}{isBonus ? "bonus" : `${Math.round(weightOf(f, weights, isGk) * 100)}%`}
                            </span>
                          </td>
                          <td style={{ textAlign: "right", color: "var(--text-sub)" }}>{fv ?? "—"}</td>
                          <td style={{ textAlign: "right", color: typeof mine === "number" ? ratingColor(mine) : "var(--text-faint)" }}>
                            {typeof mine === "number" ? mine : "—"}
                          </td>
                          <td style={{ textAlign: "right", color: diff == null ? "var(--text-faint)" : Math.abs(diff) >= 15 ? "#f97316" : "var(--text-muted)" }}>
                            {diff == null ? "—" : `${diff > 0 ? "+" : ""}${diff}`}
                          </td>
                        </tr>
                      );
                    })}
                    <tr style={{ borderTop: "1px solid var(--border-row)" }}>
                      <td style={{ padding: "6px 0 0", fontWeight: 700 }}>Overall</td>
                      <td style={{ textAlign: "right", padding: "6px 0 0", fontWeight: 700, color: ratingColor(current.formula.final) }}>
                        {current.formula.final}
                      </td>
                      <td style={{ textAlign: "right", padding: "6px 0 0", fontWeight: 700, color: derivedFinal != null ? ratingColor(derivedFinal) : "var(--text-faint)" }}>
                        {derivedFinal ?? "—"}
                      </td>
                      <td style={{ textAlign: "right", padding: "6px 0 0", fontWeight: 700, color: "var(--text-muted)" }}>
                        {derivedFinal == null ? "—" : `${derivedFinal - current.formula.final > 0 ? "+" : ""}${derivedFinal - current.formula.final}`}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Actions */}
          <div style={{ display: "flex", gap: 10, marginTop: 20, alignItems: "center", flexWrap: "wrap" }}>
            <button onClick={() => setIndex(i => Math.max(0, i - 1))} disabled={index === 0} style={ghostBtn}>← Prev</button>
            <button onClick={() => setIndex(i => Math.min(items.length - 1, i + 1))} disabled={index >= items.length - 1} style={ghostBtn}>Next →</button>
            <button
              onClick={skip}
              disabled={saving}
              style={{ ...ghostBtn, borderColor: "#f97316", color: "#f97316" }}
              title="Not worth judging — remove it and never queue it again (S)"
            >
              Skip
            </button>
            {canLoadNext && remaining > 0 && (
              <button onClick={() => load()} disabled={loading} style={ghostBtn} title="Discard the rest of this batch and fetch a fresh one">
                Load next batch
              </button>
            )}
            <div style={{ flex: 1 }} />
            {savedFlash && <span style={{ color: "#4ade80", fontSize: 12 }}>Saved</span>}
            <button onClick={() => save(false)} disabled={saving || derivedFinal == null} style={ghostBtn}>Save</button>
            <button
              onClick={() => save(onLastItem && !canLoadNext ? false : true)}
              disabled={saving || derivedFinal == null}
              style={primaryBtn}
            >
              {onLastItem ? "Save & finish batch" : "Save & next"}
            </button>
          </div>
          <div style={{ marginTop: 10, fontSize: 11, color: "var(--text-faint)" }}>
            ← → to move · S to skip · Ctrl/Cmd + Enter to save and advance
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Fixed column count (not auto-fit) so the stats grid and the inputs grid always
 * produce identical tracks — auto-fit would let them wrap differently and the
 * alignment would drift at certain widths.
 */
function gridStyle(n: number): React.CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: `repeat(${Math.max(1, n)}, minmax(0, 1fr))`,
    gap: 14,
  };
}

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "8px 10px", background: "var(--bg-input, transparent)",
  border: "1px solid var(--border-row)", borderRadius: 6, color: "var(--text-body)",
  fontSize: 13, outline: "none",
};

const labelStyle: React.CSSProperties = {
  display: "block", fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase",
  color: "var(--text-faint)", marginBottom: 5,
};

const card: React.CSSProperties = {
  border: "1px solid var(--border-row)", borderRadius: 10, padding: 20,
  background: "var(--bg-card, transparent)",
};

const primaryBtn: React.CSSProperties = {
  padding: "9px 18px", borderRadius: 6, border: "none", cursor: "pointer",
  background: "var(--text-body)", color: "var(--bg-page, #000)", fontWeight: 700, fontSize: 13,
};

const ghostBtn: React.CSSProperties = {
  padding: "8px 14px", borderRadius: 6, cursor: "pointer",
  background: "transparent", border: "1px solid var(--border-row)",
  color: "var(--text-sub)", fontSize: 12.5,
};

const chipStyle: React.CSSProperties = {
  padding: "6px 12px", borderRadius: 20, border: "1px solid var(--border-row)",
  cursor: "pointer", fontSize: 12, color: "var(--text-body)",
};
