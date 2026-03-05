"use client";

import { useRouter, usePathname } from "next/navigation";

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "stats", label: "League Stats" },
];

export function LeagueTabBar({ activeTab }: { activeTab: string }) {
  const router = useRouter();
  const pathname = usePathname();

  return (
    <div style={{ borderBottom: "1px solid var(--border-main)", background: "var(--bg-nav)" }}>
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "0 24px", display: "flex" }}>
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => router.push(tab.id === "overview" ? pathname : `${pathname}?tab=${tab.id}`)}
            style={{
              padding: "10px 20px",
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              background: "transparent",
              border: "none",
              borderBottom: activeTab === tab.id ? "2px solid #7070f0" : "2px solid transparent",
              color: activeTab === tab.id ? "var(--text-body)" : "var(--text-muted)",
              cursor: "pointer",
              marginBottom: -1,
              transition: "color 0.15s",
              whiteSpace: "nowrap",
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>
    </div>
  );
}
