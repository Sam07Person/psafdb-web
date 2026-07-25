"use client";

import Link from "next/link";
import Image from "next/image";
import { useLanguage } from "@/components/LanguageProvider";

const NAV_ITEMS = [
  { href: "/matches", labelKey: "nav.matches", subKey: "home.matches.sub", accent: "#e63946", icon: "⚽" },
  { href: "/players", labelKey: "nav.players", subKey: "home.players.sub", accent: "#4ea8f7", icon: "◈" },
  { href: "/leagues", labelKey: "nav.leagues", subKey: "home.leagues.sub", accent: "#f4c430", icon: "◆" },
  { href: "/teams", labelKey: "nav.teams", subKey: "home.teams.sub", accent: "#a78bfa", icon: "◉" },
  { href: "/news", labelKey: "nav.news", subKey: "home.news.sub", accent: "#38bdf8", icon: "📰" },
  { href: "/awards", labelKey: "nav.awards", subKey: "home.awards.sub", accent: "#f4a261", icon: "★" },
  { href: "/elo", labelKey: "nav.elo", subKey: "home.elo.sub", accent: "#22c55e", icon: "▲" },
  { href: "/compare", labelKey: "nav.compare", subKey: "home.compare.sub", accent: "#f472b6", icon: "⇄" },
  { href: "/predictions", labelKey: "nav.predictions", subKey: "home.predictions.sub", accent: "#facc15", icon: "🔮" },
  { href: "/table-predictor", labelKey: "predictor.title", subKey: "home.predictor.sub", accent: "#fb923c", icon: "📊" },
  { href: "/stats", labelKey: "nav.stats", subKey: "home.stats.sub", accent: "#34d399", icon: "▦" },
];

export default function HomePage() {
  const { t } = useLanguage();

  return (
    <main style={{ minHeight: "calc(100vh - 56px)" }}>
      {/* Hero */}
      <section style={{ borderBottom: "1px solid var(--border-main)", background: "var(--bg-nav)", padding: "80px 24px 64px" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 20, marginBottom: 24 }}>
            <Image
              src="/psaf.png"
              alt="PSAF"
              width={64}
              height={64}
              unoptimized
            />
            <div>
              <div style={{ fontSize: 11, letterSpacing: "0.3em", color: "#e63946", fontWeight: 700, textTransform: "uppercase", marginBottom: 4 }}>
                {t("brand.tagline")}
              </div>
              <h1 style={{ fontSize: "clamp(36px, 6vw, 72px)", fontWeight: 900, lineHeight: 1, letterSpacing: "-0.02em", color: "var(--text-main)", margin: 0 }}>
                PSAFDB
              </h1>
            </div>
          </div>
          <p style={{ fontSize: 16, color: "var(--text-muted)", maxWidth: 480, lineHeight: 1.6, margin: 0, paddingLeft: 84 }}>
            {t("home.heroText")}
          </p>
        </div>
      </section>

      {/* Nav Cards */}
      <section style={{ maxWidth: 1200, margin: "0 auto", padding: "48px 24px" }}>
        <div style={{ fontSize: 11, letterSpacing: "0.25em", color: "var(--text-faint)", fontWeight: 700, textTransform: "uppercase", marginBottom: 20 }}>
          {t("home.browse")}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 2 }}>
          {NAV_ITEMS.map(({ href, labelKey, subKey, accent, icon }) => (
            <Link
              key={href}
              href={href}
              style={{ textDecoration: "none", display: "block", background: "var(--bg-card)", borderTop: `3px solid ${accent}`, padding: "28px 24px", transition: "background 0.15s" }}
              className="nav-card"
            >
              <div style={{ fontSize: 22, marginBottom: 16, color: accent }}>{icon}</div>
              <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: "-0.01em", color: "var(--text-main)", marginBottom: 4 }}>{t(labelKey)}</div>
              <div style={{ fontSize: 12, color: "var(--text-muted)", letterSpacing: "0.05em" }}>{t(subKey)}</div>
              <div style={{ marginTop: 20, fontSize: 11, color: accent, fontWeight: 700, letterSpacing: "0.15em", textTransform: "uppercase" }}>
                {t("home.view")} →
              </div>
            </Link>
          ))}
        </div>
      </section>

    </main>
  );
}
