import "./globals.css";
import type { ReactNode } from "react";
import Link from "next/link";
import Image from "next/image";
import SearchBar from "@/components/SearchBar";
import ThemeProvider from "@/components/ThemeProvider";
import ThemeToggle from "@/components/ThemeToggle";
import { Analytics } from "@vercel/analytics/next";

export const metadata = {
  title: "PSAFDB",
  description: "Pro Soccer Association Football Database",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ background: "var(--bg-base)", color: "var(--text-main)", minHeight: "100vh" }}>
        <ThemeProvider>
          {/* Top Navigation */}
          <header style={{ borderBottom: "1px solid var(--border-main)", background: "var(--bg-nav)" }}>
            <div style={{ maxWidth: 1200, margin: "0 auto", padding: "0 24px", display: "flex", alignItems: "center", justifyContent: "space-between", height: 56 }}>
              {/* Logo + Brand */}
              <Link href="/" style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none" }}>
                <Image src="/psaf.png" alt="PSAF" width={32} height={32} unoptimized />
                <span style={{ fontWeight: 800, fontSize: 15, letterSpacing: "0.15em", color: "var(--text-main)", textTransform: "uppercase" }}>PSAFDB</span>
              </Link>

              {/* Search */}
              <SearchBar />

              {/* Nav Links */}
              <nav style={{ display: "flex", alignItems: "center", gap: 2 }}>
                {[
                  { href: "/matches", label: "Matches" },
                  { href: "/leagues", label: "Leagues" },
                  { href: "/teams", label: "Teams" },
                  { href: "/players", label: "Players" },
                  { href: "/stats", label: "Stats" },
                  { href: "/compare", label: "Compare" },
                  { href: "/elo", label: "ELO" },
                  { href: "/awards", label: "Awards" },
                ].map(({ href, label }) => (
                  <Link
                    key={href}
                    href={href}
                    style={{
                      padding: "6px 14px",
                      fontSize: 12,
                      fontWeight: 600,
                      letterSpacing: "0.1em",
                      textTransform: "uppercase",
                      color: "var(--text-sub)",
                      textDecoration: "none",
                      transition: "color 0.15s",
                    }}
                    className="nav-link"
                  >
                    {label}
                  </Link>
                ))}
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
                  Admin
                </Link>
                <div style={{ marginLeft: 8 }}>
                  <ThemeToggle />
                </div>
              </nav>
            </div>
          </header>

          {children}

          <footer style={{ borderTop: "1px solid var(--border-main)", marginTop: 80, padding: "24px 0" }}>
            <div style={{ maxWidth: 1200, margin: "0 auto", padding: "0 24px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Image src="/psaf.png" alt="PSAF" width={18} height={18} style={{ opacity: 0.5 }} unoptimized />
                <span style={{ fontSize: 11, color: "var(--text-faint)", fontWeight: 600, letterSpacing: "0.15em", textTransform: "uppercase" }}>PSAFDB</span>
              </div>
              <span style={{ fontSize: 11, color: "var(--text-faint)" }}>Pro Soccer Association Football Database © {new Date().getFullYear()}</span>
            </div>
          </footer>
        </ThemeProvider>
        <Analytics />
      </body>
    </html>
  );
}
