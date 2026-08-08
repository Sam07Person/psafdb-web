import { createClient } from "@supabase/supabase-js";
import Link from "next/link";
import { getLang } from "@/lib/lang-server";
import { t as translate, type Lang } from "@/lib/i18n";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const DEFAULT_ELO = 1000;
const K_BASE = 32;

function goalDiffMultiplier(gd: number): number {
  if (gd <= 1) return 1.0;
  if (gd === 2) return 1.5;
  return 1.75 + (gd - 3) * 0.05;
}

function tierMultiplier(tier: number | null): number {
  if (tier === 1) return 1.2;
  if (tier === 3) return 0.8;
  return 1.0;
}

function expectedScore(rA: number, rB: number): number {
  return 1 / (1 + Math.pow(10, (rB - rA) / 400));
}

function eloColor(elo: number): string {
  if (elo >= 1150) return "#22c55e";
  if (elo >= 1075) return "#84cc16";
  if (elo >= 1000) return "#eab308";
  if (elo >= 925)  return "#f97316";
  return "#ef4444";
}

type EloEntry = {
  team: string;
  teamId?: string | null;
  elo: number;
  change: number;
  gp: number;
  w: number;
  d: number;
  l: number;
  history: number[]; // ELO after each game
};

async function computeElo(): Promise<EloEntry[]> {
  // Fetch all leagues (all seasons)
  const { data: leagues } = await supabase
    .from("leagues")
    .select("id,tier");

  const tierMap = new Map<string, number | null>(
    (leagues ?? []).map((l) => [l.id, l.tier])
  );

  // Fetch all played matches in chronological order
  const { data: matches } = await supabase
    .from("matches")
    .select("id,home_team,away_team,home_score,away_score,played_at,league_id")
    .not("home_score", "is", null)
    .not("away_score", "is", null)
    .order("played_at", { ascending: true });

  if (!matches?.length) return [];

  // Build team ID map and no-ELO exclusion set from all teams
  const { data: allTeams } = await supabase
    .from("teams")
    .select("id,name,no_elo");

  const teamIdMap = new Map<string, string>(
    (allTeams ?? []).map((t) => [t.name, t.id])
  );
  const noEloNames = new Set<string>(
    (allTeams ?? []).filter((t) => t.no_elo).map((t) => t.name as string)
  );

  const elos = new Map<string, number>();
  const records = new Map<string, { w: number; d: number; l: number; gp: number }>();
  const history = new Map<string, number[]>();

  function getElo(t: string) { return elos.get(t) ?? DEFAULT_ELO; }
  function ensureRecord(t: string) {
    if (!records.has(t)) records.set(t, { w: 0, d: 0, l: 0, gp: 0 });
    if (!history.has(t)) history.set(t, []);
  }

  for (const m of matches) {
    if (noEloNames.has(m.home_team) || noEloNames.has(m.away_team)) continue;
    const hElo = getElo(m.home_team);
    const aElo = getElo(m.away_team);

    const hExp = expectedScore(hElo, aElo);
    const aExp = 1 - hExp;

    const hs = m.home_score as number;
    const as_ = m.away_score as number;
    const gd = Math.abs(hs - as_);

    let hActual: number, aActual: number;
    if (hs > as_)      { hActual = 1;   aActual = 0;   }
    else if (hs < as_) { hActual = 0;   aActual = 1;   }
    else               { hActual = 0.5; aActual = 0.5; }

    const tier  = tierMap.get(m.league_id) ?? null;
    const tMult = tierMultiplier(tier);
    const gMult = hActual === 0.5 ? 1.0 : goalDiffMultiplier(gd);
    const K     = K_BASE * tMult * gMult;

    const newH = hElo + K * (hActual - hExp);
    const newA = aElo + K * (aActual - aExp);

    elos.set(m.home_team, newH);
    elos.set(m.away_team, newA);

    ensureRecord(m.home_team);
    ensureRecord(m.away_team);

    const hr = records.get(m.home_team)!;
    const ar = records.get(m.away_team)!;
    hr.gp++; ar.gp++;
    if      (hActual === 1)   { hr.w++; ar.l++; }
    else if (hActual === 0)   { hr.l++; ar.w++; }
    else                      { hr.d++; ar.d++; }

    history.get(m.home_team)!.push(Math.round(newH));
    history.get(m.away_team)!.push(Math.round(newA));
  }

  // Collect all teams that have played at least one match, excluding no-ELO teams
  const teamSet = new Set<string>();
  for (const m of matches) {
    if (noEloNames.has(m.home_team) || noEloNames.has(m.away_team)) continue;
    teamSet.add(m.home_team);
    teamSet.add(m.away_team);
  }

  return Array.from(teamSet)
    .map((team) => ({
      team,
      teamId: teamIdMap.get(team) ?? null,
      elo:    Math.round(elos.get(team) ?? DEFAULT_ELO),
      change: Math.round((elos.get(team) ?? DEFAULT_ELO) - DEFAULT_ELO),
      ...(records.get(team) ?? { w: 0, d: 0, l: 0, gp: 0 }),
      history: history.get(team) ?? [],
    }))
    .sort((a, b) => b.elo - a.elo);
}

// Egress control: these routes scan large tables (matches / match_player_stats).
// At revalidate=60 a single steady visitor triggered up to 1,440 full-table
// regenerations per day. Data changes roughly daily, so 6h is plenty; the admin
// mutation routes call revalidateContent() for immediate freshness after imports.
export const revalidate = 21600;

export default async function EloPage() {
  const lang: Lang = await getLang();
  const t = (k: string, v?: Record<string, string | number>) => translate(lang, k, v);
  const entries = await computeElo();

  return (
    <main style={{ minHeight: "calc(100vh - 56px)" }}>
      {/* Header */}
      <section style={{ borderBottom: "1px solid var(--border-main)", padding: "32px 24px 24px", background: "var(--bg-nav)" }}>
        <div style={{ maxWidth: 1000, margin: "0 auto" }}>
          <div style={{ fontSize: 11, letterSpacing: "0.25em", color: "var(--text-faint)", fontWeight: 700, textTransform: "uppercase", marginBottom: 14 }}>
            <Link href="/" style={{ color: "var(--text-faint)", textDecoration: "none" }}>{t("breadcrumb.home")}</Link>
            <span style={{ margin: "0 8px" }}>/</span>
            {t("elo.title")}
          </div>
          <h1 style={{ fontSize: 32, fontWeight: 900, letterSpacing: "-0.02em", color: "var(--text-main)", margin: 0 }}>
            {t("elo.title")}
          </h1>
          <p style={{ marginTop: 8, color: "var(--text-muted)", fontSize: 13 }}>
            {t("elo.desc")}
          </p>
        </div>
      </section>

      <div style={{ maxWidth: 1000, margin: "0 auto", padding: "32px 24px 64px" }}>
        {entries.length === 0 ? (
          <p style={{ color: "var(--text-muted)" }}>{t("common.noResults")}</p>
        ) : (
          <div style={{ background: "var(--bg-card)", borderTop: "3px solid #4ea8f7", overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: "var(--bg-row)" }}>
                  <th style={{ padding: "10px 16px", textAlign: "left",   fontSize: 10, color: "var(--text-faint)", fontWeight: 700, letterSpacing: "0.15em", textTransform: "uppercase", borderBottom: "1px solid var(--border-main)", width: 40 }}>{t("elo.col.rank")}</th>
                  <th style={{ padding: "10px 16px", textAlign: "left",   fontSize: 10, color: "var(--text-faint)", fontWeight: 700, letterSpacing: "0.15em", textTransform: "uppercase", borderBottom: "1px solid var(--border-main)" }}>{t("elo.col.team")}</th>
                  <th style={{ padding: "10px 16px", textAlign: "center", fontSize: 10, color: "var(--text-faint)", fontWeight: 700, letterSpacing: "0.15em", textTransform: "uppercase", borderBottom: "1px solid var(--border-main)" }}>{t("elo.col.elo")}</th>
                  <th style={{ padding: "10px 16px", textAlign: "center", fontSize: 10, color: "var(--text-faint)", fontWeight: 700, letterSpacing: "0.15em", textTransform: "uppercase", borderBottom: "1px solid var(--border-main)" }}>{t("elo.col.change")}</th>
                  <th style={{ padding: "10px 16px", textAlign: "center", fontSize: 10, color: "var(--text-faint)", fontWeight: 700, letterSpacing: "0.15em", textTransform: "uppercase", borderBottom: "1px solid var(--border-main)" }}>{t("elo.col.gp")}</th>
                  <th style={{ padding: "10px 16px", textAlign: "center", fontSize: 10, color: "var(--text-faint)", fontWeight: 700, letterSpacing: "0.15em", textTransform: "uppercase", borderBottom: "1px solid var(--border-main)" }}>{t("elo.col.w")}</th>
                  <th style={{ padding: "10px 16px", textAlign: "center", fontSize: 10, color: "var(--text-faint)", fontWeight: 700, letterSpacing: "0.15em", textTransform: "uppercase", borderBottom: "1px solid var(--border-main)" }}>{t("elo.col.d")}</th>
                  <th style={{ padding: "10px 16px", textAlign: "center", fontSize: 10, color: "var(--text-faint)", fontWeight: 700, letterSpacing: "0.15em", textTransform: "uppercase", borderBottom: "1px solid var(--border-main)" }}>{t("elo.col.l")}</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e, i) => {
                  const color  = eloColor(e.elo);
                  const noGames = e.gp === 0;
                  return (
                    <tr key={e.team} style={{ borderBottom: "1px solid var(--border-row)", opacity: noGames ? 0.45 : 1 }}>
                      {/* Rank */}
                      <td style={{ padding: "11px 16px", color: "var(--text-faint)", fontWeight: 700, fontSize: 12 }}>
                        {i + 1}
                      </td>
                      {/* Team */}
                      <td style={{ padding: "11px 16px", fontWeight: 700, fontSize: 14 }}>
                        {e.teamId ? (
                          <Link href={`/teams/${e.teamId}`} style={{ color: "var(--text-body)", textDecoration: "none" }} className="hover:underline">
                            {e.team}
                          </Link>
                        ) : e.team}
                      </td>
                      {/* ELO */}
                      <td style={{ padding: "11px 16px", textAlign: "center" }}>
                        <span style={{
                          display: "inline-block",
                          minWidth: 58,
                          padding: "3px 10px",
                          borderRadius: 4,
                          background: `${color}18`,
                          color,
                          fontWeight: 800,
                          fontSize: 14,
                          fontVariantNumeric: "tabular-nums",
                          letterSpacing: "0.02em",
                        }}>
                          {e.elo}
                        </span>
                      </td>
                      {/* Change */}
                      <td style={{ padding: "11px 16px", textAlign: "center", fontWeight: 700, fontSize: 13, fontVariantNumeric: "tabular-nums",
                        color: e.change > 0 ? "#4ade80" : e.change < 0 ? "#f87171" : "var(--text-muted)" }}>
                        {e.change > 0 ? `+${e.change}` : e.change === 0 ? "—" : e.change}
                      </td>
                      {/* GP */}
                      <td style={{ padding: "11px 16px", textAlign: "center", color: "var(--text-sub)", fontVariantNumeric: "tabular-nums" }}>{e.gp}</td>
                      {/* W */}
                      <td style={{ padding: "11px 16px", textAlign: "center", color: e.w > 0 ? "#4ade80" : "var(--text-faint)", fontWeight: e.w > 0 ? 700 : 400, fontVariantNumeric: "tabular-nums" }}>{e.w}</td>
                      {/* D */}
                      <td style={{ padding: "11px 16px", textAlign: "center", color: e.d > 0 ? "#eab308" : "var(--text-faint)", fontWeight: e.d > 0 ? 700 : 400, fontVariantNumeric: "tabular-nums" }}>{e.d}</td>
                      {/* L */}
                      <td style={{ padding: "11px 16px", textAlign: "center", color: e.l > 0 ? "#f87171" : "var(--text-faint)", fontWeight: e.l > 0 ? 700 : 400, fontVariantNumeric: "tabular-nums" }}>{e.l}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Legend */}
        <div style={{ marginTop: 24, display: "flex", gap: 20, flexWrap: "wrap" }}>
          {[
            { label: "≥ 1150", color: "#22c55e" },
            { label: "≥ 1075", color: "#84cc16" },
            { label: "≥ 1000", color: "#eab308" },
            { label: "≥ 925",  color: "#f97316" },
            { label: "< 925",  color: "#ef4444" },
          ].map(({ label, color }) => (
            <div key={label} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{ width: 10, height: 10, borderRadius: 2, background: color }} />
              <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{label}</span>
            </div>
          ))}
          <div style={{ marginLeft: "auto", fontSize: 11, color: "var(--text-faint)" }}>
            {t("elo.legend.formula")}
          </div>
        </div>
      </div>
    </main>
  );
}
