"use client";

import { useLanguage } from "./LanguageProvider";

export default function LanguageToggle() {
  const { lang, toggleLang } = useLanguage();
  return (
    <button
      onClick={toggleLang}
      title={lang === "en" ? "Türkçe'ye geç" : "Switch to English"}
      style={{
        background: "transparent",
        border: "1px solid var(--border-main)",
        borderRadius: 6,
        height: 32,
        padding: "0 10px",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 12,
        fontWeight: 700,
        letterSpacing: "0.05em",
        color: "var(--text-sub)",
        flexShrink: 0,
        transition: "border-color 0.15s, color 0.15s",
      }}
    >
      {lang === "en" ? "EN" : "TR"}
    </button>
  );
}
