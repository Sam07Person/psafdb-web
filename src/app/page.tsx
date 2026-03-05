import Link from "next/link";
import Image from "next/image";

const NAV_ITEMS = [
  {
    href: "/matches",
    label: "Matches",
    sub: "Results & Stats",
    accent: "#e63946",
    icon: "⚽",
  },
  {
    href: "/players",
    label: "Players",
    sub: "Profiles & Rankings",
    accent: "#4ea8f7",
    icon: "◈",
  },
  {
    href: "/leagues",
    label: "Leagues",
    sub: "Tables & Fixtures",
    accent: "#f4c430",
    icon: "◆",
  },
  {
    href: "/teams",
    label: "Teams",
    sub: "Squads & Records",
    accent: "#a78bfa",
    icon: "◉",
  },
  {
    href: "/awards",
    label: "Awards",
    sub: "Team of the Week",
    accent: "#f4a261",
    icon: "★",
  },
  {
    href: "/elo",
    label: "ELO Rankings",
    sub: "Team Ratings by Result",
    accent: "#22c55e",
    icon: "▲",
  },
  {
    href: "/compare",
    label: "Compare",
    sub: "Head-to-Head Stats",
    accent: "#f472b6",
    icon: "⇄",
  },
  {
    href: "/stats",
    label: "Stats",
    sub: "Player & Team Statistics",
    accent: "#34d399",
    icon: "▦",
  },
];

export default function HomePage() {
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
                Pro Soccer Association
              </div>
              <h1 style={{ fontSize: "clamp(36px, 6vw, 72px)", fontWeight: 900, lineHeight: 1, letterSpacing: "-0.02em", color: "var(--text-main)", margin: 0 }}>
                PSAFDB
              </h1>
            </div>
          </div>
          <p style={{ fontSize: 16, color: "var(--text-muted)", maxWidth: 480, lineHeight: 1.6, margin: 0, paddingLeft: 84 }}>
            The complete statistical database for PSAF — tracking every match, player, and league result.
          </p>
        </div>
      </section>

      {/* Nav Cards */}
      <section style={{ maxWidth: 1200, margin: "0 auto", padding: "48px 24px" }}>
        <div style={{ fontSize: 11, letterSpacing: "0.25em", color: "var(--text-faint)", fontWeight: 700, textTransform: "uppercase", marginBottom: 20 }}>
          Browse Database
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 2 }}>
          {NAV_ITEMS.map(({ href, label, sub, accent, icon }) => (
            <Link
              key={href}
              href={href}
              style={{ textDecoration: "none", display: "block", background: "var(--bg-card)", borderTop: `3px solid ${accent}`, padding: "28px 24px", transition: "background 0.15s" }}
              className="nav-card"
            >
              <div style={{ fontSize: 22, marginBottom: 16, color: accent }}>{icon}</div>
              <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: "-0.01em", color: "var(--text-main)", marginBottom: 4 }}>{label}</div>
              <div style={{ fontSize: 12, color: "var(--text-muted)", letterSpacing: "0.05em" }}>{sub}</div>
              <div style={{ marginTop: 20, fontSize: 11, color: accent, fontWeight: 700, letterSpacing: "0.15em", textTransform: "uppercase" }}>
                View →
              </div>
            </Link>
          ))}
        </div>
      </section>

    </main>
  );
}
