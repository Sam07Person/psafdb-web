"use client";

import { useTheme } from "./ThemeProvider";

export default function ThemeToggle() {
  const { theme, toggle } = useTheme();
  return (
    <button
      onClick={toggle}
      title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      style={{
        background: "transparent",
        border: "1px solid var(--border-main)",
        borderRadius: 6,
        width: 32,
        height: 32,
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 15,
        color: "var(--text-sub)",
        flexShrink: 0,
        transition: "border-color 0.15s, color 0.15s",
      }}
    >
      {theme === "dark" ? "☀" : "☾"}
    </button>
  );
}
