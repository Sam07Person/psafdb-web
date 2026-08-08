import { NextRequest, NextResponse } from "next/server";
import { revalidateContent } from "@/lib/revalidate";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireImportAuth } from "@/lib/importAuth";

// -------- Types --------

const VALID_POSITIONS = [
  "GK", "LB", "RB", "CB", "LF", "RF", "LW", "RW", "CM",
  "LCB", "RCB", "ST", "LM", "RM", "CF", "LWB", "RWB"
] as const;

type Position = typeof VALID_POSITIONS[number];

type LeagueInput = {
  id?: string;
  name: string;
  season?: string | null;
};

type MatchInput = {
  id?: string;
  played_at: string; // ISO string
  home_team: string;
  away_team: string;
  home_score?: number;
  away_score?: number;
};

type TeamStatsInput = {
  possession?: number; // percent, can be decimal
  passes?: number;
  key_passes?: number;
  assists?: number;
  shots?: number;
  shots_on_target?: number;
  goals?: number;
  tackles?: number;
  key_tackles?: number;
  interceptions?: number;
  key_interceptions?: number;
  possessions_lost?: number;
  goal_kicks?: number;
  corner_kicks?: number;
  throw_ins?: number;
  free_kicks?: number;
  penalties?: number;
  fouls?: number;
  offsides?: number;
  yellow_cards?: number;
  red_cards?: number;
};

type PlayerStatInput = {
  game_user_id?: string; // preferred unique identity from the game
  handle?: string;       // fallback unique identity if you use it
  name?: string;

  team_side: "home" | "away";
  position?: Position | string | null; // player position

  score?: number;
  passes?: number;
  key_passes?: number;
  assists?: number;
  shots?: number;
  shots_on_target?: number;
  goals?: number;
  tackles?: number;
  key_tackles?: number;
  interceptions?: number;
  key_interceptions?: number;
  possessions_lost?: number;
  gk_saves?: number;
  gk_catches?: number;
};

type ImportMatchPayload = {
  league?: LeagueInput; // optional, but strongly recommended for dedupe (league_id non-null)
  match: MatchInput;
  team_stats?: {
    home?: TeamStatsInput;
    away?: TeamStatsInput;
  };
  players?: PlayerStatInput[];
};

// -------- Helpers --------

function json(status: number, body: unknown) {
  return NextResponse.json(body, { status });
}

function requireAuth(req: NextRequest) {
  // Accept full admin creds OR the dedicated staff import username+password.
  return requireImportAuth(req);
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function toInt(v: unknown, def = 0) {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : def;
}

function toNum(v: unknown, def = 0) {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : def;
}

function normalizeTeamSide(v: unknown): "home" | "away" | null {
  if (v === "home" || v === "away") return v;
  return null;
}

function normalizePosition(v: unknown): Position | null {
  if (typeof v !== "string") return null;
  const upper = v.toUpperCase().trim();
  if (VALID_POSITIONS.includes(upper as Position)) {
    return upper as Position;
  }
  return null;
}

function pickTeamStats(input?: TeamStatsInput): Required<TeamStatsInput> {
  // Fill defaults so DB NOT NULL columns are satisfied.
  return {
    possession: toNum(input?.possession, 0),
    passes: toInt(input?.passes, 0),
    key_passes: toInt(input?.key_passes, 0),
    assists: toInt(input?.assists, 0),
    shots: toInt(input?.shots, 0),
    shots_on_target: toInt(input?.shots_on_target, 0),
    goals: toInt(input?.goals, 0),
    tackles: toInt(input?.tackles, 0),
    key_tackles: toInt(input?.key_tackles, 0),
    interceptions: toInt(input?.interceptions, 0),
    key_interceptions: toInt(input?.key_interceptions, 0),
    possessions_lost: toInt(input?.possessions_lost, 0),
    goal_kicks: toInt(input?.goal_kicks, 0),
    corner_kicks: toInt(input?.corner_kicks, 0),
    throw_ins: toInt(input?.throw_ins, 0),
    free_kicks: toInt(input?.free_kicks, 0),
    penalties: toInt(input?.penalties, 0),
    fouls: toInt(input?.fouls, 0),
    offsides: toInt(input?.offsides, 0),
    yellow_cards: toInt(input?.yellow_cards, 0),
    red_cards: toInt(input?.red_cards, 0),
  };
}

function pickPlayerStats(input: PlayerStatInput) {
  return {
    position: normalizePosition(input.position),
    score: toInt(input.score, 0),
    passes: toInt(input.passes, 0),
    key_passes: toInt(input.key_passes, 0),
    assists: toInt(input.assists, 0),
    shots: toInt(input.shots, 0),
    shots_on_target: toInt(input.shots_on_target, 0),
    goals: toInt(input.goals, 0),
    tackles: toInt(input.tackles, 0),
    key_tackles: toInt(input.key_tackles, 0),
    interceptions: toInt(input.interceptions, 0),
    key_interceptions: toInt(input.key_interceptions, 0),
    possessions_lost: toInt(input.possessions_lost, 0),
    gk_saves: toInt(input.gk_saves, 0),
    gk_catches: toInt(input.gk_catches, 0),
  };
}

// -------- Game-extracted payload support --------

type GameTeamStats = {
  teamName: string;
  passes?: number;
  keyPasses?: number;
  assists?: number;
  shots?: number;
  shotsOnTarget?: number;
  goals?: number;
  tackles?: number;
  keyTackles?: number;
  interceptions?: number;
  keyInterceptions?: number;
  possession?: number;
  possessionsLost?: number;
  fouls?: number;
  offsides?: number;
  freeKicks?: number;
  penalties?: number;
  goalKicks?: number;
  cornerKicks?: number;
  throwIns?: number;
  yellowCards?: number;
  redCards?: number;

  // extra fields we ignore:
  handballs?: number;
  setPieceTimeouts?: number;
};

type GamePlayerStats = {
  playerName: string;
  playerId?: string;

  position?: string; // player position (fixed typo from 'postion')
  postion?: string;  // keep for backwards compatibility with typo

  passes?: number;
  keyPasses?: number;
  assists?: number;
  shots?: number;
  shotsOnTarget?: number;
  goals?: number;
  tackles?: number;
  keyTackles?: number;
  interceptions?: number;
  keyInterceptions?: number;
  possessionsLost?: number;
  gKSaves?: number;
  gKCatches?: number;
  score?: number;

  // extra fields we ignore:
  team?: string;
  overallRating?: number;
};

type GameExtractPayload = {
  played_at?: string;
  playedAt?: string;
  league?: LeagueInput;

  team1Stats: GameTeamStats;
  team2Stats: GameTeamStats;
  team1PlayerStats?: GamePlayerStats[];
  team2PlayerStats?: GamePlayerStats[];
  noTeamPlayerStats?: GamePlayerStats[];
};

function isGameExtractPayload(v: any): v is GameExtractPayload {
  return (
    v &&
    typeof v === "object" &&
    v.team1Stats &&
    v.team2Stats &&
    typeof v.team1Stats === "object" &&
    typeof v.team2Stats === "object"
  );
}

function toImportPayloadFromGameExtract(game: GameExtractPayload): ImportMatchPayload {
  const played_at = (game.played_at ?? game.playedAt ?? new Date().toISOString()).toString();

  const home_team = game.team1Stats?.teamName ?? "Team 1";
  const away_team = game.team2Stats?.teamName ?? "Team 2";

  const home_score = toInt(game.team1Stats?.goals, 0);
  const away_score = toInt(game.team2Stats?.goals, 0);

  const team_stats = {
    home: {
      possession: toNum(game.team1Stats?.possession, 0),
      passes: toInt(game.team1Stats?.passes, 0),
      key_passes: toInt(game.team1Stats?.keyPasses, 0),
      assists: toInt(game.team1Stats?.assists, 0),
      shots: toInt(game.team1Stats?.shots, 0),
      shots_on_target: toInt(game.team1Stats?.shotsOnTarget, 0),
      goals: home_score,
      tackles: toInt(game.team1Stats?.tackles, 0),
      key_tackles: toInt(game.team1Stats?.keyTackles, 0),
      interceptions: toInt(game.team1Stats?.interceptions, 0),
      key_interceptions: toInt(game.team1Stats?.keyInterceptions, 0),
      possessions_lost: toInt(game.team1Stats?.possessionsLost, 0),
      goal_kicks: toInt(game.team1Stats?.goalKicks, 0),
      corner_kicks: toInt(game.team1Stats?.cornerKicks, 0),
      throw_ins: toInt(game.team1Stats?.throwIns, 0),
      free_kicks: toInt(game.team1Stats?.freeKicks, 0),
      penalties: toInt(game.team1Stats?.penalties, 0),
      fouls: toInt(game.team1Stats?.fouls, 0),
      offsides: toInt(game.team1Stats?.offsides, 0),
      yellow_cards: toInt(game.team1Stats?.yellowCards, 0),
      red_cards: toInt(game.team1Stats?.redCards, 0),
    },
    away: {
      possession: toNum(game.team2Stats?.possession, 0),
      passes: toInt(game.team2Stats?.passes, 0),
      key_passes: toInt(game.team2Stats?.keyPasses, 0),
      assists: toInt(game.team2Stats?.assists, 0),
      shots: toInt(game.team2Stats?.shots, 0),
      shots_on_target: toInt(game.team2Stats?.shotsOnTarget, 0),
      goals: away_score,
      tackles: toInt(game.team2Stats?.tackles, 0),
      key_tackles: toInt(game.team2Stats?.keyTackles, 0),
      interceptions: toInt(game.team2Stats?.interceptions, 0),
      key_interceptions: toInt(game.team2Stats?.keyInterceptions, 0),
      possessions_lost: toInt(game.team2Stats?.possessionsLost, 0),
      goal_kicks: toInt(game.team2Stats?.goalKicks, 0),
      corner_kicks: toInt(game.team2Stats?.cornerKicks, 0),
      throw_ins: toInt(game.team2Stats?.throwIns, 0),
      free_kicks: toInt(game.team2Stats?.freeKicks, 0),
      penalties: toInt(game.team2Stats?.penalties, 0),
      fouls: toInt(game.team2Stats?.fouls, 0),
      offsides: toInt(game.team2Stats?.offsides, 0),
      yellow_cards: toInt(game.team2Stats?.yellowCards, 0),
      red_cards: toInt(game.team2Stats?.redCards, 0),
    },
  };

  const t1 = Array.isArray(game.team1PlayerStats) ? game.team1PlayerStats : [];
  const t2 = Array.isArray(game.team2PlayerStats) ? game.team2PlayerStats : [];
  // ignore noTeamPlayerStats by default (safer than assigning wrong team)
  // const nt = Array.isArray(game.noTeamPlayerStats) ? game.noTeamPlayerStats : [];

  const players: PlayerStatInput[] = [
    ...t1.map((p) => ({
      game_user_id: isNonEmptyString(p.playerId) ? p.playerId : undefined,
      handle: isNonEmptyString(p.playerName) ? p.playerName : undefined,
      name: isNonEmptyString(p.playerName) ? p.playerName : undefined,
      team_side: "home" as const,
      position: p.position ?? p.postion ?? null, // support both spellings

      score: toInt(p.score, 0),
      passes: toInt(p.passes, 0),
      key_passes: toInt(p.keyPasses, 0),
      assists: toInt(p.assists, 0),
      shots: toInt(p.shots, 0),
      shots_on_target: toInt(p.shotsOnTarget, 0),
      goals: toInt(p.goals, 0),
      tackles: toInt(p.tackles, 0),
      key_tackles: toInt(p.keyTackles, 0),
      interceptions: toInt(p.interceptions, 0),
      key_interceptions: toInt(p.keyInterceptions, 0),
      possessions_lost: toInt(p.possessionsLost, 0),
      gk_saves: toInt(p.gKSaves, 0),
      gk_catches: toInt(p.gKCatches, 0),
    })),
    ...t2.map((p) => ({
      game_user_id: isNonEmptyString(p.playerId) ? p.playerId : undefined,
      handle: isNonEmptyString(p.playerName) ? p.playerName : undefined,
      name: isNonEmptyString(p.playerName) ? p.playerName : undefined,
      team_side: "away" as const,
      position: p.position ?? p.postion ?? null, // support both spellings

      score: toInt(p.score, 0),
      passes: toInt(p.passes, 0),
      key_passes: toInt(p.keyPasses, 0),
      assists: toInt(p.assists, 0),
      shots: toInt(p.shots, 0),
      shots_on_target: toInt(p.shotsOnTarget, 0),
      goals: toInt(p.goals, 0),
      tackles: toInt(p.tackles, 0),
      key_tackles: toInt(p.keyTackles, 0),
      interceptions: toInt(p.interceptions, 0),
      key_interceptions: toInt(p.keyInterceptions, 0),
      possessions_lost: toInt(p.possessionsLost, 0),
      gk_saves: toInt(p.gKSaves, 0),
      gk_catches: toInt(p.gKCatches, 0),
    })),
  ];

  return {
    league: game.league,
    match: { played_at, home_team, away_team, home_score, away_score },
    team_stats,
    players,
  };
}

// -------- Route --------

export async function GET(req: NextRequest) {
  const auth = requireAuth(req);
  if (!auth.ok) return json(401, { error: auth.error });

  return json(200, {
    ok: true,
    endpoint: "/api/admin/import",
    expects: {
      league: { name: "string", season: "string|null (optional)" },
      match: { played_at: "ISO string", home_team: "string", away_team: "string", home_score: "int", away_score: "int" },
      team_stats: { home: "object", away: "object" },
      players: [
        {
          game_user_id: "string (preferred unique id)",
          handle: "string (fallback unique id)",
          name: "string",
          team_side: "home|away",
          position: "GK|LB|RB|CB|LF|RF|LW|RW|CM|LCB|RCB|ST|LM|RM|CF|LWB|RWB",
          // ...stats fields
        },
      ],
    },
  });
}

async function postHandler(req: NextRequest) {
  const auth = requireAuth(req);
  if (!auth.ok) return json(401, { error: auth.error });

  if (!supabaseAdmin) return json(500, { error: "Server missing SUPABASE_SERVICE_ROLE_KEY" });
  const db = supabaseAdmin;

  const raw = await req.json().catch(() => null);
  if (!raw || typeof raw !== "object") return json(400, { error: "Invalid JSON body" });

  const body: ImportMatchPayload = isGameExtractPayload(raw)
    ? toImportPayloadFromGameExtract(raw)
    : (raw as ImportMatchPayload);

  if (!body || typeof body !== "object") return json(400, { error: "Invalid JSON body" });

  // Validate match
  const match = body.match;
  if (!match || typeof match !== "object") return json(400, { error: "match is required" });
  if (!isNonEmptyString(match.played_at)) return json(400, { error: "match.played_at is required (ISO string)" });
  if (!isNonEmptyString(match.home_team)) return json(400, { error: "match.home_team is required" });
  if (!isNonEmptyString(match.away_team)) return json(400, { error: "match.away_team is required" });

  // Validate league (strongly recommended so matches dedupe properly)
  const league = body.league;
  if (league) {
    if (!isNonEmptyString(league.name)) return json(400, { error: "league.name is required" });
  }

  // Safety: limit request size
  const players = Array.isArray(body.players) ? body.players : [];
  if (players.length > 60) return json(400, { error: "Too many players in one match (max 60)" });

  // 1) Resolve league_id (optional, but recommended)
  let league_id: string | null = null;

  if (league) {
    // If league id provided, accept it. Else find-or-create by (name, season).
    if (isNonEmptyString(league.id)) {
      league_id = league.id;
    } else {
      const season = league.season ?? null;

      // Try find existing
      let q = db.from("leagues").select("id").eq("name", league.name).limit(1);
      q = season === null ? q.is("season", null) : q.eq("season", season);

      const found = await q.maybeSingle();
      if (found.error) return json(500, { error: found.error.message, step: "league_select" });

      if (found.data?.id) {
        league_id = found.data.id as string;
      } else {
        const created = await supabaseAdmin
          .from("leagues")
          .insert({ name: league.name, season })
          .select("id")
          .single();

        if (created.error) return json(500, { error: created.error.message, step: "league_insert" });
        league_id = created.data.id as string;
      }
    }
  }

  // 1b) Block import if league has ended
  if (league_id) {
    const { data: leagueCheck } = await supabaseAdmin
      .from("leagues")
      .select("ended")
      .eq("id", league_id)
      .single();
    if (leagueCheck?.ended) {
      return json(403, { error: "This league has ended — no new results can be imported." });
    }
  }

  // 2) Upsert match (uses your UNIQUE(league_id, played_at, home_team, away_team))
  // IMPORTANT: if league_id is null, Postgres UNIQUE allows multiple nulls -> dedupe may not work.
  // So we strongly recommend including league in the payload.
  const matchRow = {
    id: isNonEmptyString(match.id) ? match.id : undefined,
    league_id,
    played_at: match.played_at,
    home_team: match.home_team,
    away_team: match.away_team,
    home_score: toInt(match.home_score, 0),
    away_score: toInt(match.away_score, 0),
  };

  const matchUpsert = await supabaseAdmin
    .from("matches")
    .upsert(matchRow, {
      onConflict: "league_id,played_at,home_team,away_team",
    })
    .select("id, league_id, played_at, home_team, away_team, home_score, away_score")
    .single();

  if (matchUpsert.error) {
    return json(500, {
      error: matchUpsert.error.message,
      step: "match_upsert",
      hint: league_id
        ? undefined
        : "league_id is null. Provide { league: { name, season } } for reliable match dedupe.",
    });
  }

  const match_id = matchUpsert.data.id as string;

    // 3) Upsert players, build mapping to player_id
  // Prefer game_user_id if you added it; fallback to handle.
  const playerIdByKey = new Map<string, string>();

  async function playersHasGameUserId() {
    const probe = await db.from("players").select("game_user_id").limit(1);
    return !probe.error;
  }

  if (players.length > 0) {
    const hasGameIdColumn = await playersHasGameUserId();

    if (!hasGameIdColumn) {
      // If DB can't store game_user_id, require handle in payload
      const missingHandle = players.find((p) => !isNonEmptyString(p.handle));
      if (missingHandle) {
        return json(400, {
          error:
            "players.handle is required because players.game_user_id column is not present in the database yet.",
          hint:
            "Either add players.game_user_id in Supabase, or include handle for every player in the import payload.",
        });
      }
    }

    const upsertRows = players.map((p) => ({
      game_user_id: hasGameIdColumn && isNonEmptyString(p.game_user_id) ? p.game_user_id : null,
      handle: isNonEmptyString(p.handle) ? p.handle : null,
      name: isNonEmptyString(p.name) ? p.name : null,
    }));

    const onConflict = hasGameIdColumn ? "game_user_id" : "handle";

    const upsertRes = await supabaseAdmin
      .from("players")
      .upsert(
        hasGameIdColumn
          ? upsertRows
          : upsertRows
              .filter((r) => isNonEmptyString(r.handle))
              .map((r) => ({ handle: r.handle, name: r.name })),
        { onConflict }
      )
      // IMPORTANT: no spaces in select string (your tooling errors with spaces)
      .select(hasGameIdColumn ? "id,game_user_id,handle" : "id,handle");

    if (upsertRes.error) {
      return json(500, { error: upsertRes.error.message, step: "players_upsert" });
    }

    for (const row of upsertRes.data ?? []) {
      const id = (row as any).id as string;
      const gameId = (row as any).game_user_id as string | null | undefined;
      const handle = (row as any).handle as string | null | undefined;

      if (isNonEmptyString(gameId)) playerIdByKey.set(`game:${gameId}`, id);
      if (isNonEmptyString(handle)) playerIdByKey.set(`handle:${handle}`, id);
    }
  }


  // 4) Upsert match_player_stats (PK: match_id, player_id)
  if (players.length > 0) {
    const statsRows = players.map((p) => {
      const side = normalizeTeamSide(p.team_side)!;
      const key = isNonEmptyString(p.game_user_id) ? `game:${p.game_user_id}` : `handle:${p.handle}`;
      const player_id = playerIdByKey.get(key);

      if (!player_id) {
        throw new Error(`Failed to resolve player id for ${key}`);
      }

      return {
        match_id,
        player_id,
        team_side: side,
        ...pickPlayerStats(p),
      };
    });

    // If a player-id couldn't resolve, catch and return a clean error
    try {
      const statsUpsert = await supabaseAdmin
        .from("match_player_stats")
        .upsert(statsRows, { onConflict: "match_id,player_id" })
        .select();

      if (statsUpsert.error) return json(500, { error: statsUpsert.error.message, step: "player_stats_upsert" });
    } catch (e: any) {
      return json(500, { error: e?.message ?? "Failed to prepare match_player_stats rows", step: "player_stats_map" });
    }
  }

  // 5) Upsert match_team_stats (PK: match_id, team_side) — optional payload
  if (body.team_stats?.home || body.team_stats?.away) {
    const rows = [
      body.team_stats?.home
        ? { match_id, team_side: "home" as const, ...pickTeamStats(body.team_stats.home) }
        : null,
      body.team_stats?.away
        ? { match_id, team_side: "away" as const, ...pickTeamStats(body.team_stats.away) }
        : null,
    ].filter(Boolean) as Array<any>;

    if (rows.length > 0) {
      const teamUpsert = await supabaseAdmin
        .from("match_team_stats")
        .upsert(rows, { onConflict: "match_id,team_side" })
        .select();

      if (teamUpsert.error) {
        return json(500, {
          error: teamUpsert.error.message,
          step: "team_stats_upsert",
          hint: "Did you create the match_team_stats table with PK (match_id, team_side)?",
        });
      }
    }
  }

  return json(200, {
    ok: true,
    match: matchUpsert.data,
    imported: {
      league_id,
      match_id,
      players: players.length,
      team_stats: Boolean(body.team_stats?.home || body.team_stats?.away),
    },
  });
}

// ── Cache eviction wrappers ──────────────────────────────────────────────────
// The cached aggregate pages (/stats, /teams, /elo, detail routes) use a 6h
// revalidate window to keep Supabase egress down. Evict them after every
// successful write so the long window never shows stale data.

export async function POST(req: NextRequest) {
  const res = await postHandler(req);
  if (res.ok) revalidateContent();
  return res;
}
