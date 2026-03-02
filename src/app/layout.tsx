import "./globals.css";
import type { ReactNode } from "react";
import Link from "next/link";
import Image from "next/image";

export const metadata = {
  title: "PSAFDB",
  description: "Pro Soccer Association Football Database",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ background: "#07070f", color: "#e8e8f0", minHeight: "100vh" }}>
        {/* Top Navigation */}
        <header style={{ borderBottom: "1px solid #1a1a2e", background: "#09091a" }}>
          <div style={{ maxWidth: 1200, margin: "0 auto", padding: "0 24px", display: "flex", alignItems: "center", justifyContent: "space-between", height: 56 }}>
            {/* Logo + Brand */}
            <Link href="/" style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none" }}>
              <Image src="/psaf.png" alt="PSAF" width={32} height={32} unoptimized />
              <span style={{ fontWeight: 800, fontSize: 15, letterSpacing: "0.15em", color: "#e8e8f0", textTransform: "uppercase" }}>PSAFDB</span>
            </Link>

            {/* Nav Links */}
            <nav style={{ display: "flex", alignItems: "center", gap: 2 }}>
              {[
                { href: "/matches", label: "Matches" },
                { href: "/leagues", label: "Leagues" },
                { href: "/teams", label: "Teams" },
                { href: "/players", label: "Players" },
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
                    color: "#9090b0",
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
            </nav>
          </div>
        </header>

        {children}

        <footer style={{ borderTop: "1px solid #1a1a2e", marginTop: 80, padding: "24px 0" }}>
          <div style={{ maxWidth: 1200, margin: "0 auto", padding: "0 24px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Image src="/psaf.png" alt="PSAF" width={18} height={18} style={{ opacity: 0.5 }} unoptimized />
              <span style={{ fontSize: 11, color: "#3a3a5a", fontWeight: 600, letterSpacing: "0.15em", textTransform: "uppercase" }}>PSAFDB</span>
            </div>
            <span style={{ fontSize: 11, color: "#3a3a5a" }}>Pro Soccer Association Football Database © {new Date().getFullYear()}</span>
          </div>
        </footer>
      </body>
    </html>
  );
}
