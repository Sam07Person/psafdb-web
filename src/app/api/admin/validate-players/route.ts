import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  matchPlayer,
  DbPlayer,
  ExtractedPlayer,
  TeamRosterContext,
  ocrAwareSimilarity,
  isValidPlayerId,
} from "@/lib/playerMatcher";

function json(status: number, body: unknown) {
  return NextResponse.json(body, { status });
}

function requireAuth(req: NextRequest) {
  const adminPassword = req.headers.get("x-admin-password");
  if (!process.env.ADMIN_IMPORT_PASSWORD) {
    return { ok: false as const, error: "Server configuration error" };
  }
  if (adminPassword !== process.env.ADMIN_IMPORT_PASSWORD) {
    return { ok: false as const, error: "Invalid admin password" };
  }

  const expected = process.env.ADMIN_IMPORT_TOKEN;
  if (!expected) return { ok: false as const, error: "Server configuration error" };

  const auth = req.headers.get("authorization") || "";
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (!token || token !== expected) return { ok: false as const, error: "Invalid token" };

  return { ok: true as const };
}

// Normalize team name for comparison
function normalizeTeamName(name: string): string {
  return name.toLowerCase().trim()
    .replace(/\s+fc$/i, '')
    .replace(/^fc\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Check if team names match (fuzzy)
function doTeamNamesMatch(name1: string, name2: string): boolean {
  const n1 = normalizeTeamName(name1);
  const n2 = normalizeTeamName(name2);

  if (n1 === n2) return true;
  if (n1.includes(n2) || n2.includes(n1)) return true;

  return false;
}

interface ValidatedPlayer extends ExtractedPlayer {
  matchResult: {
    playerId: string | null;
    confidence: number;
    matchMethod: string;
    needsUserReview: boolean;
    suggestions: Array<{
      id: string;
      name: string | null;
      game_user_id: string | null;
      confidence: number;
      matchReasons: string[];
    }>;
  };
}

export async function POST(req: NextRequest) {
  const auth = requireAuth(req);
  if (!auth.ok) return json(401, { error: auth.error });

  if (!supabaseAdmin) return json(500, { error: "Server missing SUPABASE_SERVICE_ROLE_KEY" });

  const logs: string[] = [];

  try {
    const body = await req.json();
    const { extractedData } = body;

    if (!extractedData) {
      return json(400, { error: "No extracted data provided" });
    }

    // Fetch all players
    const { data: allPlayersData } = await supabaseAdmin
      .from("players")
      .select("id, name, handle, game_user_id");

    const allPlayers: DbPlayer[] = allPlayersData || [];
    logs.push(`Loaded ${allPlayers.length} players from database`);

    // Get team names
    const homeTeamName = extractedData.home_team?.team_name || "";
    const awayTeamName = extractedData.away_team?.team_name || "";

    // Fetch recent matches for both teams to build roster context
    const getTeamRoster = async (teamName: string): Promise<TeamRosterContext | null> => {
      if (!teamName || !supabaseAdmin) return null;

      // Find recent matches where this team played
      const { data: recentMatches } = await supabaseAdmin
        .from("matches")
        .select("id")
        .or(`home_team.ilike.%${normalizeTeamName(teamName)}%,away_team.ilike.%${normalizeTeamName(teamName)}%`)
        .order("played_at", { ascending: false })
        .limit(10);

      if (!recentMatches || recentMatches.length === 0) {
        logs.push(`No recent matches found for team: ${teamName}`);
        return null;
      }

      const matchIds = recentMatches.map(m => m.id);

      // Get players who played in these matches
      const { data: recentStats } = await supabaseAdmin
        .from("match_player_stats")
        .select("player_id")
        .in("match_id", matchIds);

      if (!recentStats) return null;

      const recentPlayerIds = [...new Set(recentStats.map(s => s.player_id))];

      // Get player details
      const recentPlayers = allPlayers.filter(p => recentPlayerIds.includes(p.id));

      logs.push(`Found ${recentPlayers.length} recent players for team: ${teamName}`);

      return {
        teamName,
        recentPlayerIds,
        recentPlayers,
      };
    };

    const homeRoster = await getTeamRoster(homeTeamName);
    const awayRoster = await getTeamRoster(awayTeamName);

    // Validate home team players
    const homePlayersValidated: ValidatedPlayer[] = [];
    for (const player of extractedData.home_team?.players || []) {
      const matchResult = matchPlayer(player, allPlayers, homeRoster, logs);
      homePlayersValidated.push({
        ...player,
        matchResult: {
          playerId: matchResult.playerId,
          confidence: matchResult.confidence,
          matchMethod: matchResult.matchMethod,
          needsUserReview: matchResult.needsUserReview,
          suggestions: matchResult.suggestions.map(s => ({
            id: s.player.id,
            name: s.player.name,
            game_user_id: s.player.game_user_id,
            confidence: s.confidence,
            matchReasons: s.matchReasons,
          })),
        },
      });
    }

    // Validate away team players
    const awayPlayersValidated: ValidatedPlayer[] = [];
    for (const player of extractedData.away_team?.players || []) {
      const matchResult = matchPlayer(player, allPlayers, awayRoster, logs);
      awayPlayersValidated.push({
        ...player,
        matchResult: {
          playerId: matchResult.playerId,
          confidence: matchResult.confidence,
          matchMethod: matchResult.matchMethod,
          needsUserReview: matchResult.needsUserReview,
          suggestions: matchResult.suggestions.map(s => ({
            id: s.player.id,
            name: s.player.name,
            game_user_id: s.player.game_user_id,
            confidence: s.confidence,
            matchReasons: s.matchReasons,
          })),
        },
      });
    }

    // Count players needing review
    const playersNeedingReview = [
      ...homePlayersValidated.filter(p => p.matchResult.needsUserReview),
      ...awayPlayersValidated.filter(p => p.matchResult.needsUserReview),
    ];

    // Build validated extracted data
    const validatedData = {
      ...extractedData,
      home_team: {
        ...extractedData.home_team,
        players: homePlayersValidated,
      },
      away_team: {
        ...extractedData.away_team,
        players: awayPlayersValidated,
      },
    };

    return json(200, {
      success: true,
      validatedData,
      stats: {
        totalPlayers: homePlayersValidated.length + awayPlayersValidated.length,
        playersNeedingReview: playersNeedingReview.length,
        homeTeamRosterSize: homeRoster?.recentPlayers.length || 0,
        awayTeamRosterSize: awayRoster?.recentPlayers.length || 0,
      },
      teamRosters: {
        home: homeRoster?.recentPlayers.map(p => ({
          id: p.id,
          name: p.name,
          game_user_id: p.game_user_id,
        })) || [],
        away: awayRoster?.recentPlayers.map(p => ({
          id: p.id,
          name: p.name,
          game_user_id: p.game_user_id,
        })) || [],
      },
      logs,
    });
  } catch (error: any) {
    console.error("Validation error:", error);
    return json(500, {
      error: error.message || "Failed to validate players",
      logs,
    });
  }
}
