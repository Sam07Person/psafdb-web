"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import Link from "next/link";

type LeagueRow = {
  id: string;
  name: string;
  season: string | null;
  format: string | null; // 'league' | 'knockout' | 'group_knockout'
  created_at: string | null;
};

type LeagueWithStats = LeagueRow & {
  match_count: number;
  team_count: number;
};

function cx(...s: Array<string | false | null | undefined>) {
  return s.filter(Boolean).join(" ");
}

function formatLabel(format: string | null): string {
  switch (format) {
    case "knockout":
      return "Knockout";
    case "group_knockout":
      return "Group Stage + Knockout";
    case "league":
    default:
      return "League";
  }
}

function formatColor(format: string | null): string {
  switch (format) {
    case "knockout":
      return "border-red-400/30 bg-red-400/10 text-red-200";
    case "group_knockout":
      return "border-purple-400/30 bg-purple-400/10 text-purple-200";
    case "league":
    default:
      return "border-emerald-400/30 bg-emerald-400/10 text-emerald-200";
  }
}

export default function LeaguesPage() {
  const [leagues, setLeagues] = useState<LeagueWithStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<any>(null);

  useEffect(() => {
    if (!supabase) return;

    (async () => {
      setLoading(true);

      // Fetch all leagues
      const { data: leaguesData, error: leaguesError } = await supabase
        .from("leagues")
        .select("id,name,season,format,created_at")
        .order("created_at", { ascending: false });

      if (leaguesError) {
        setError(leaguesError);
        setLoading(false);
        return;
      }

      // Fetch match counts and teams per league
      const { data: matchesData, error: matchesError } = await supabase
        .from("matches")
        .select("league_id,home_team,away_team");

      if (matchesError) {
        setError(matchesError);
        setLoading(false);
        return;
      }

      // Aggregate stats per league
      const statsMap = new Map<string, { matches: number; teams: Set<string> }>();
      for (const match of matchesData ?? []) {
        if (!match.league_id) continue;
        const existing = statsMap.get(match.league_id) || { matches: 0, teams: new Set<string>() };
        existing.matches += 1;
        if (match.home_team) existing.teams.add(match.home_team);
        if (match.away_team) existing.teams.add(match.away_team);
        statsMap.set(match.league_id, existing);
      }

      // Combine leagues with stats
      const combined: LeagueWithStats[] = (leaguesData ?? []).map((l) => {
        const stats = statsMap.get(l.id) || { matches: 0, teams: new Set<string>() };
        return {
          ...l,
          match_count: stats.matches,
          team_count: stats.teams.size,
        };
      });

      setLeagues(combined);
      setLoading(false);
    })();
  }, []);

  if (!supabase) {
    return (
      <main className="mx-auto max-w-6xl px-6 py-10">
        <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
          <div className="text-xl font-semibold">Leagues</div>
          <p className="mt-2 text-white/70">
            Missing env vars. Add <code className="rounded bg-black/30 px-1">NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
            <code className="rounded bg-black/30 px-1">NEXT_PUBLIC_SUPABASE_ANON_KEY</code> to <code className="rounded bg-black/30 px-1">.env.local</code>.
          </p>
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="mx-auto max-w-6xl px-6 py-10">
        <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-6">
          <div className="text-lg font-semibold">Error</div>
          <pre className="mt-3 overflow-auto text-xs text-white/80">{JSON.stringify(error, null, 2)}</pre>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      {/* Header */}
      <div>
        <div className="text-3xl font-bold tracking-tight">Leagues</div>
        <div className="mt-1 text-sm text-white/70">
          {leagues.length} league{leagues.length !== 1 ? "s" : ""}. Click to view standings and teams.
        </div>
      </div>

      {/* Leagues list */}
      <div className="mt-8">
        {loading ? (
          <div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-white/70">
            Loading leagues...
          </div>
        ) : leagues.length === 0 ? (
          <div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-white/70">
            No leagues found. Import some matches with league data to get started.
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {leagues.map((l) => (
              <Link
                key={l.id}
                href={`/leagues/${l.id}`}
                className="group rounded-2xl border border-white/10 bg-white/5 p-5 transition hover:border-white/20 hover:bg-white/10"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-lg font-semibold group-hover:text-white">
                      {l.name}
                    </div>
                    {l.season && (
                      <div className="mt-0.5 text-sm text-white/50">{l.season}</div>
                    )}
                  </div>
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/10 text-white/60 transition group-hover:bg-white/20 group-hover:text-white">
                    →
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <span className={cx("rounded-full border px-2 py-0.5 text-xs font-medium", formatColor(l.format))}>
                    {formatLabel(l.format)}
                  </span>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-2">
                  <div className="rounded-xl bg-black/20 px-3 py-2 text-center">
                    <div className="text-lg font-bold">{l.team_count}</div>
                    <div className="text-[10px] uppercase tracking-wide text-white/50">Teams</div>
                  </div>
                  <div className="rounded-xl bg-black/20 px-3 py-2 text-center">
                    <div className="text-lg font-bold">{l.match_count}</div>
                    <div className="text-[10px] uppercase tracking-wide text-white/50">Matches</div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}