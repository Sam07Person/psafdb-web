"use client";

import Image from "next/image";
import { useLanguage } from "./LanguageProvider";

export default function Footer() {
  const { t } = useLanguage();

  return (
    <footer style={{ borderTop: "1px solid var(--border-main)", marginTop: 80, padding: "24px 0" }}>
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "0 24px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Image src="/psaf.png" alt="PSAF" width={18} height={18} style={{ opacity: 0.5 }} unoptimized />
          <span style={{ fontSize: 11, color: "var(--text-faint)", fontWeight: 600, letterSpacing: "0.15em", textTransform: "uppercase" }}>PSAFDB</span>
        </div>
        <span style={{ fontSize: 11, color: "var(--text-faint)" }}>
          {t("footer.copyright")} © {new Date().getFullYear()}
        </span>
      </div>
    </footer>
  );
}
