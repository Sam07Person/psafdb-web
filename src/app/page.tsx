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
];

export default function HomePage() {
  return (
    <main style={{ minHeight: "calc(100vh - 56px)" }}>
      {/* Hero */}
      <section style={{ borderBottom: "1px solid #1a1a2e", background: "linear-gradient(160deg, #0d0d20 0%, #07070f 60%)", padding: "80px 24px 64px" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 20, marginBottom: 24 }}>
            <Image
              src="/psaf.png"
              alt="PSAF"
              width={64}
              height={64}
              style={{ filter: "invert(1) sepia(1) saturate(3) hue-rotate(320deg) brightness(1.2)" }}
            />
            <div>
              <div style={{ fontSize: 11, letterSpacing: "0.3em", color: "#e63946", fontWeight: 700, textTransform: "uppercase", marginBottom: 4 }}>
                Pro Soccer Association
              </div>
              <h1 style={{ fontSize: "clamp(36px, 6vw, 72px)", fontWeight: 900, lineHeight: 1, letterSpacing: "-0.02em", color: "#f0f0fa", margin: 0 }}>
                PSAFDB
              </h1>
            </div>
          </div>
          <p style={{ fontSize: 16, color: "#5a5a7a", maxWidth: 480, lineHeight: 1.6, margin: 0, paddingLeft: 84 }}>
            The complete statistical database for PSAF — tracking every match, player, and league result.
          </p>
        </div>
      </section>

      {/* Nav Cards */}
      <section style={{ maxWidth: 1200, margin: "0 auto", padding: "48px 24px" }}>
        <div style={{ fontSize: 11, letterSpacing: "0.25em", color: "#3a3a5a", fontWeight: 700, textTransform: "uppercase", marginBottom: 20 }}>
          Browse Database
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 2 }}>
          {NAV_ITEMS.map(({ href, label, sub, accent, icon }) => (
            <Link
              key={href}
              href={href}
              style={{ textDecoration: "none", display: "block", background: "#0d0d1a", borderTop: `3px solid ${accent}`, padding: "28px 24px", transition: "background 0.15s" }}
              className="nav-card"
            >
              <div style={{ fontSize: 22, marginBottom: 16, color: accent }}>{icon}</div>
              <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: "-0.01em", color: "#e8e8f0", marginBottom: 4 }}>{label}</div>
              <div style={{ fontSize: 12, color: "#4a4a6a", letterSpacing: "0.05em" }}>{sub}</div>
              <div style={{ marginTop: 20, fontSize: 11, color: accent, fontWeight: 700, letterSpacing: "0.15em", textTransform: "uppercase" }}>
                View →
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* Leagues Spotlight */}
      <section style={{ maxWidth: 1200, margin: "0 auto", padding: "0 24px 64px" }}>
        <div style={{ fontSize: 11, letterSpacing: "0.25em", color: "#3a3a5a", fontWeight: 700, textTransform: "uppercase", marginBottom: 20 }}>
          Active Leagues
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 2 }}>
          {[
            { img: "/cd.png", name: "Champions Division", abbr: "CD", color: "#f4c430" },
            { img: "/pl.png", name: "Premier League", abbr: "PL", color: "#4ea8f7" },
          ].map(({ img, name, abbr, color }) => (
            <Link
              key={abbr}
              href="/leagues"
              style={{ textDecoration: "none", display: "flex", alignItems: "center", gap: 20, background: "#0d0d1a", borderLeft: `3px solid ${color}`, padding: "20px 24px" }}
              className="nav-card"
            >
              <div style={{ width: 48, height: 48, display: "flex", alignItems: "center", justifyContent: "center", background: "#07070f", flexShrink: 0 }}>
                <Image
                  src={img}
                  alt={abbr}
                  width={36}
                  height={36}
                  style={{ filter: `invert(1) sepia(1) saturate(3) hue-rotate(${abbr === "CD" ? "20deg" : "180deg"}) brightness(1.2)` }}
                />
              </div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: "0.05em", color: "#e8e8f0" }}>{name}</div>
                <div style={{ fontSize: 11, color: "#3a3a5a", letterSpacing: "0.15em", fontWeight: 600, textTransform: "uppercase", marginTop: 2 }}>{abbr}</div>
              </div>
              <div style={{ marginLeft: "auto", fontSize: 11, color, fontWeight: 700 }}>→</div>
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}
