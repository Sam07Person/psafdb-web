"use client";

import Link from "next/link";
import Image from "next/image";
import SearchBar from "./SearchBar";
import ThemeToggle from "./ThemeToggle";
import LanguageToggle from "./LanguageToggle";
import { useLanguage } from "./LanguageProvider";

const NAV_LINKS: { href: string; key: string }[] = [
  { href: "/news", key: "nav.news" },
  { href: "/matches", key: "nav.matches" },
  { href: "/leagues", key: "nav.leagues" },
  { href: "/teams", key: "nav.teams" },
  { href: "/players", key: "nav.players" },
  { href: "/stats", key: "nav.stats" },
  { href: "/compare", key: "nav.compare" },
  { href: "/elo", key: "nav.elo" },
  { href: "/predictions", key: "nav.predictions" },
  { href: "/awards", key: "nav.awards" },
];

export default function Header() {
  const { t } = useLanguage();

  return (
    <header style={{ borderBottom: "1px solid var(--border-main)", background: "var(--bg-nav)" }}>
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "0 24px", display: "flex", alignItems: "center", justifyContent: "space-between", height: 56 }}>
        {/* Logo + Brand */}
        <Link href="/" style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none", flexShrink: 0 }}>
          <Image src="/psaf.png" alt="PSAF" width={32} height={32} unoptimized />
          <span style={{ fontWeight: 800, fontSize: 15, letterSpacing: "0.15em", color: "var(--text-main)", textTransform: "uppercase", whiteSpace: "nowrap" }}>PSAFDB</span>
        </Link>

        {/* Search */}
        <SearchBar />

        {/* Nav Links */}
        <nav style={{ display: "flex", alignItems: "center", gap: 0 }}>
          {NAV_LINKS.map(({ href, key }) => (
            <Link
              key={href}
              href={href}
              style={{
                padding: "6px 8px",
                fontSize: 11.5,
                fontWeight: 600,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                color: "var(--text-sub)",
                textDecoration: "none",
                transition: "color 0.15s",
              }}
              className="nav-link"
            >
              {t(key)}
            </Link>
          ))}
          <Link
            href="/staff/import"
            style={{
              marginLeft: 8,
              padding: "6px 14px",
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: "#3b82f6",
              textDecoration: "none",
              border: "1px solid #3b82f640",
            }}
          >
            {t("nav.staff")}
          </Link>
          <Link
            href="/admin/import"
            style={{
              marginLeft: 8,
              padding: "6px 14px",
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: "#e63946",
              textDecoration: "none",
              border: "1px solid #e6394640",
            }}
          >
            {t("nav.admin")}
          </Link>
          <div style={{ marginLeft: 8 }}>
            <LanguageToggle />
          </div>
          <div style={{ marginLeft: 8 }}>
            <ThemeToggle />
          </div>
        </nav>
      </div>
    </header>
  );
}
