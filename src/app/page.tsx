import Link from "next/link";

export default function HomePage() {
  return (
    <main className="min-h-screen bg-gray-900">
      {/* Hero Section */}
      <div className="mx-auto max-w-6xl px-6 py-20">
        <div className="text-center">
          <h1 className="text-5xl font-bold tracking-tight text-white md:text-6xl">
            PSAFDB
          </h1>
          <p className="mt-4 text-xl text-white/70">
            Pro Soccer Association Football Database
          </p>
          <p className="mt-2 text-white/50">
            Track matches, players, leagues, and stats
          </p>
        </div>

        {/* Navigation Cards */}
        <div className="mt-16 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          <Link
            href="/matches"
            className="group rounded-2xl border border-white/10 bg-white/5 p-8 transition hover:border-white/20 hover:bg-white/10"
          >
            <div className="text-4xl">⚽</div>
            <h2 className="mt-4 text-2xl font-semibold text-white group-hover:text-emerald-400">
              Matches
            </h2>
            <p className="mt-2 text-white/60">
              View recent match results, team stats, and player performances.
            </p>
          </Link>

          <Link
            href="/players"
            className="group rounded-2xl border border-white/10 bg-white/5 p-8 transition hover:border-white/20 hover:bg-white/10"
          >
            <div className="text-4xl">👤</div>
            <h2 className="mt-4 text-2xl font-semibold text-white group-hover:text-sky-400">
              Players
            </h2>
            <p className="mt-2 text-white/60">
              Browse all registered players and their career statistics.
            </p>
          </Link>

          <Link
            href="/leagues"
            className="group rounded-2xl border border-white/10 bg-white/5 p-8 transition hover:border-white/20 hover:bg-white/10"
          >
            <div className="text-4xl">🏆</div>
            <h2 className="mt-4 text-2xl font-semibold text-white group-hover:text-amber-400">
              Leagues
            </h2>
            <p className="mt-2 text-white/60">
              Check league standings, fixtures, and tournament brackets.
            </p>
          </Link>
        </div>

        {/* Quick Links */}
        <div className="mt-16 rounded-2xl border border-white/10 bg-white/5 p-8">
          <h3 className="text-lg font-semibold text-white">Quick Links</h3>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link
              href="/matches"
              className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/70 transition hover:bg-white/10 hover:text-white"
            >
              Recent Results
            </Link>
            <Link
              href="/leagues"
              className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/70 transition hover:bg-white/10 hover:text-white"
            >
              League Tables
            </Link>
            <Link
              href="/players"
              className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/70 transition hover:bg-white/10 hover:text-white"
            >
              Top Scorers
            </Link>
            <Link
              href="/teams"
              className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/70 transition hover:bg-white/10 hover:text-white"
            >
              Teams
            </Link>
          </div>
        </div>
      </div>

      <footer className="border-t border-white/10 py-8">
        <div className="mx-auto max-w-6xl px-6 text-center text-sm text-white/40">
          PSAFDB © {new Date().getFullYear()}
        </div>
      </footer>
    </main>
  );
}
