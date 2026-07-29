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
  final: number | null;
  notes: string | null;
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
  };
  judgment: Judgment | null;
};

const BLANK: Judgment = {
  attacking: null, defending: null, passing: null,
  consistency: null, gk: null, final: null, notes: null,
};

// Which sub-ratings actually matter for each role. Asking for a GK's attacking
// score, or a striker's goalkeeping, just adds noise to the fit.
const RELEVANT: Record<Role, (keyof Judgment)[]> = {
  GK:  ["gk", "passing", "consistency"],
  DEF: ["defending", "passing", "attacking", "consistency"],
  MID: ["attacking", "defending", "passing", "consistency"],
  FWD: ["attacking", "passing", "defending", "consistency"],
};

const FIELD_LABEL: Record<string, string> = {
  attacking: "Attacking",
  defending: "Defending",
  passing: "Passing",
  consistency: "Consistency",
  gk: "Goalkeeping",
};

const STAT_GROUPS: { title: string; keys: string[] }[] = [
  { title: "Attack",  keys: ["goals", "assists", "shots", "shots_on_target", "key_passes"] },
  { title: "Passing", keys: ["passes", "possessions_lost"] },
  { title: "Defence", keys: ["tackles", "key_tackles", "interceptions", "key_interceptions", "goals_conceded"] },
  { title: "Keeper",  keys: ["gk_saves", "gk_catches"] },
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
  const [counts, setCounts] = useState<Record<string, { total: number; judged: number }>>({});
  const [totalJudged, setTotalJudged] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [roleFilter, setRoleFilter] = useState<Role | "">("");
  const [includeJudged, setIncludeJudged] = useState(false);
  const [limit, setLimit] = useState(25);

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
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: String(limit) });
      if (roleFilter) params.set("role", roleFilter);
      if (includeJudged) params.set("includeJudged", "1");
      const res = await fetch(`/api/admin/rating-calibration?${params}`, {
        headers: { "x-admin-password": pw, Authorization: `Bearer ${tok}` },
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Failed to load");
      setItems(body.items ?? []);
      setCounts(body.counts ?? {});
      setTotalJudged(body.totalJudged ?? 0);
      setIndex(0);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [password, token, limit, roleFilter, includeJudged]);

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
        if (res.ok) setAuthenticated(true);
      })();
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (authenticated) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authenticated, roleFilter, includeJudged, limit]);

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
    if (!current || draft.final == null) return;
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
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Save failed");

      setItems(prev => prev.map((it, i) => i === index ? { ...it, judgment: { ...draft } } : it));
      setTotalJudged(n => current.judgment ? n : n + 1);
      setCounts(prev => current.judgment ? prev : ({
        ...prev,
        [current.role]: {
          total: prev[current.role]?.total ?? 0,
          judged: (prev[current.role]?.judged ?? 0) + 1,
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

  const relevant = current ? RELEVANT[current.role] : [];
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
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 12, fontSize: 12 }}>
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
          <span style={{ color: "var(--text-faint)" }}>{totalJudged} judged of {grandTotal}</span>
        </div>
      </div>

      {error && <div style={{ color: "#ef4444", fontSize: 13, marginBottom: 12 }}>{error}</div>}
      {loading && <div style={{ color: "var(--text-muted)", fontSize: 13 }}>Loading…</div>}

      {!loading && items.length === 0 && (
        <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>
          Nothing left to judge{roleFilter ? ` for ${roleFilter}` : ""}. Tick “Include judged” to revisit.
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

          {/* Stats */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 14, margin: "18px 0", padding: "14px 0", borderTop: "1px solid var(--border-row)", borderBottom: "1px solid var(--border-row)" }}>
            {STAT_GROUPS.map(g => {
              const keys = g.keys.filter(k => current.stats[k] !== undefined);
              const meaningful = g.title === "Keeper"
                ? current.role === "GK" || keys.some(k => current.stats[k] > 0)
                : true;
              if (!meaningful) return null;
              return (
                <div key={g.title}>
                  <div style={{ fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--text-faint)", marginBottom: 6 }}>{g.title}</div>
                  {keys.map(k => (
                    <div key={k} style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, padding: "2px 0" }}>
                      <span style={{ color: "var(--text-muted)" }}>{STAT_LABEL[k] ?? k}</span>
                      <strong style={{ color: "var(--text-body)" }}>{current.stats[k]}</strong>
                    </div>
                  ))}
                </div>
              );
            })}
            <div>
              <div style={{ fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--text-faint)", marginBottom: 6 }}>In-game</div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, padding: "2px 0" }}>
                <span style={{ color: "var(--text-muted)" }}>Game score</span>
                <strong>{current.stats.game_score}</strong>
              </div>
            </div>
          </div>

          {/* Judgement inputs */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 14 }}>
            {relevant.map(field => (
              <div key={field as string}>
                <label style={labelStyle}>{FIELD_LABEL[field as string]}</label>
                <input
                  type="number" min={0} max={100}
                  value={draft[field] ?? ""}
                  onChange={e => setDraft(d => ({ ...d, [field]: e.target.value === "" ? null : Number(e.target.value) }))}
                  style={{ ...inputStyle, borderColor: draft[field] != null ? ratingColor(draft[field] as number) : "var(--border-row)" }}
                  placeholder="0–100"
                />
              </div>
            ))}
          </div>

          <div style={{ marginTop: 18, paddingTop: 16, borderTop: "1px solid var(--border-row)" }}>
            <label style={{ ...labelStyle, fontSize: 12, color: "var(--text-body)" }}>
              Overall for this performance <span style={{ color: "#ef4444" }}>*</span>
            </label>
            <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 6 }}>
              <input
                type="range" min={0} max={100}
                value={draft.final ?? 50}
                onChange={e => setDraft(d => ({ ...d, final: Number(e.target.value) }))}
                style={{ flex: 1 }}
              />
              <input
                type="number" min={0} max={100}
                value={draft.final ?? ""}
                onChange={e => setDraft(d => ({ ...d, final: e.target.value === "" ? null : Number(e.target.value) }))}
                style={{ ...inputStyle, width: 84, fontWeight: 800, fontSize: 17, textAlign: "center", color: ratingColor(draft.final) }}
                placeholder="—"
              />
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
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                  <span style={{ color: "var(--text-muted)" }}>Current formula</span>
                  <strong style={{ color: ratingColor(current.formula.final), fontSize: 15 }}>{current.formula.final}</strong>
                </div>
                {draft.final != null && (
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                    <span style={{ color: "var(--text-muted)" }}>Your judgement</span>
                    <strong style={{ color: ratingColor(draft.final) }}>
                      {draft.final}
                      <span style={{ color: "var(--text-faint)", fontWeight: 400, marginLeft: 8 }}>
                        {draft.final > current.formula.final ? "+" : ""}{draft.final - current.formula.final}
                      </span>
                    </strong>
                  </div>
                )}
                <div style={{ display: "flex", flexWrap: "wrap", gap: "3px 14px", color: "var(--text-muted)", fontSize: 11.5, paddingTop: 8, borderTop: "1px solid var(--border-row)" }}>
                  {Object.entries(current.formula.scores)
                    .filter(([k]) => current.formula.weights[k] > 0)
                    .map(([k, v]) => (
                      <span key={k}>
                        {FIELD_LABEL[k] ?? k}: <strong style={{ color: "var(--text-sub)" }}>{Math.round(v)}</strong>
                        <span style={{ color: "var(--text-faint)" }}> ×{current.formula.weights[k]}</span>
                      </span>
                    ))}
                </div>
              </div>
            )}
          </div>

          {/* Actions */}
          <div style={{ display: "flex", gap: 10, marginTop: 20, alignItems: "center", flexWrap: "wrap" }}>
            <button onClick={() => setIndex(i => Math.max(0, i - 1))} disabled={index === 0} style={ghostBtn}>← Prev</button>
            <button onClick={() => setIndex(i => Math.min(items.length - 1, i + 1))} disabled={index >= items.length - 1} style={ghostBtn}>Next →</button>
            {canLoadNext && remaining > 0 && (
              <button onClick={() => load()} disabled={loading} style={ghostBtn} title="Discard the rest of this batch and fetch a fresh one">
                Load next batch
              </button>
            )}
            <div style={{ flex: 1 }} />
            {savedFlash && <span style={{ color: "#4ade80", fontSize: 12 }}>Saved</span>}
            <button onClick={() => save(false)} disabled={saving || draft.final == null} style={ghostBtn}>Save</button>
            <button
              onClick={() => save(onLastItem && !canLoadNext ? false : true)}
              disabled={saving || draft.final == null}
              style={primaryBtn}
            >
              {onLastItem ? "Save & finish batch" : "Save & next"}
            </button>
          </div>
          <div style={{ marginTop: 10, fontSize: 11, color: "var(--text-faint)" }}>
            ← → to move between performances · Ctrl/Cmd + Enter to save and advance
          </div>
        </div>
      )}
    </div>
  );
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
