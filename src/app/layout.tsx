import "./globals.css";
import type { ReactNode } from "react";
import ThemeProvider from "@/components/ThemeProvider";
import LanguageProvider from "@/components/LanguageProvider";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { getLang } from "@/lib/lang-server";

export const metadata = {
  title: "PSAFDB",
  description: "Pro Soccer Association Football Database",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const lang = await getLang();
  return (
    <html lang={lang}>
      <body style={{ background: "var(--bg-base)", color: "var(--text-main)", minHeight: "100vh" }}>
        <ThemeProvider>
          <LanguageProvider initialLang={lang}>
            <Header />
            {children}
            <Footer />
          </LanguageProvider>
        </ThemeProvider>
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
