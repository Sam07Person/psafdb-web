import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  matchPlayer,
  DbPlayer,
  ExtractedPlayer,
  TeamRosterContext,
  ocrAwareSimilarity,
  isValidPlayerId,
  levenshteinDistance,
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

function normalizeGroupName(raw: string): string {
  return raw.replace(/^groups?\s+/i, "Group ").trim();
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

  const distance = levenshteinDistance(n1, n2);
  const maxLen = Math.max(n1.length, n2.length);
  const similarity = 1 - (distance / maxLen);

  return similarity > 0.7;
}

async function extractDataWithOpenAI(base64Images: string[]) {
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) throw new Error("OPENAI_API_KEY not configured");

  const imageContents = base64Images.map((img) => ({
    type: "image_url" as const,
    image_url: { url: img },
  }));

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${openaiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: `You are a data extraction assistant for a football/soccer match statistics database. 
Extract all match and player data from the screenshots provided. Be precise with numbers and names.

The images may show:
1. A match overview with team stats in the center and player lineups on both sides (basic view)
2. Detailed player statistics for each team (detailed view)

CRITICAL RULES FOR STATS:
- Extract all stats you can actually see in the images. NEVER invent or guess stats you cannot see.
- Most of the time, detailed stats are available for BOTH teams. Extract them all and mark "stats_incomplete": false.
- The detailed stats view shows a table/list of each player's individual stats (passes, tackles, shots, goals, etc.). If you can see this for a team, that team has detailed stats - extract them and set stats_incomplete: false.
- ONLY mark "stats_incomplete": true if you genuinely cannot see a player's detailed stats in ANY image.
- In rare cases, detailed stats may only be visible for one team. In that case, only mark the other team's players as stats_incomplete: true.
- When stats_incomplete is true, set these to null: passes, key_passes, assists, shots, shots_on_target, goals, tackles, key_tackles, interceptions, key_interceptions, possessions_lost, gk_saves, gk_catches

For player ratings shown as colored badges (green/yellow/red with numbers), extract the number.
For stats shown as "X (Y)", X is the total and Y is key/on-target.

CRITICAL FOR PLAYER IDs:
- Player IDs are 8 character alphanumeric codes shown next to player names
- Extract them EXACTLY as shown - they are case-sensitive
- Common OCR mistakes to watch for: 0 vs O, 1 vs l vs I, 5 vs S, 8 vs B, 6 vs G
- If uncertain about a character, prefer the alphanumeric interpretation (e.g., prefer "0" over "O" for round characters)

DO NOT assume which team is "home" or "away" based on screen position. Just label them as "team_1" and "team_2".

Look for any text on screen indicating the group or stage, such as "Groups A", "Groups B", "Group C", "Round of 16", "Semifinal", "Final", etc.
- "group_name": The specific group label if visible (e.g. "Group A"). Normalize "Groups C" → "Group C". Set to null if not a group stage match.
- "stage": The round/stage label if visible for knockout matches (e.g. "Round of 16", "Semifinal", "Final"). Set to null if not visible or if it is a group stage match.

Return ONLY valid JSON with no markdown formatting.`,
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Extract all match data from these screenshots. Return JSON in this exact format:
{
  "team_1": {
    "team_name": "Team Name",
    "possession": 50,
    "passes": 100,
    "key_passes": 10,
    "assists": 2,
    "shots": 10,
    "shots_on_target": 5,
    "goals": 2,
    "tackles": 30,
    "key_tackles": 5,
    "interceptions": 15,
    "key_interceptions": 3,
    "possessions_lost": 50,
    "goal_kicks": 5,
    "corner_kicks": 3,
    "throw_ins": 10,
    "free_kicks": 5,
    "penalties": 0,
    "fouls": 5,
    "offsides": 2,
    "set_piece_timeouts": 0,
    "yellow_cards": 1,
    "red_cards": 0,
    "players": [
      {
        "position": "GK",
        "name": "Player Name",
        "user_id": "abc12345",
        "level": 70,
        "overall_rating": 85,
        "ping": 50,
        "score": 500,
        "stats_incomplete": false,
        "passes": 20,
        "key_passes": 2,
        "assists": 0,
        "shots": 0,
        "shots_on_target": 0,
        "goals": 0,
        "tackles": 5,
        "key_tackles": 1,
        "interceptions": 3,
        "key_interceptions": 1,
        "possessions_lost": 10,
        "gk_saves": 5,
        "gk_catches": 2,
        "is_starter": true,
        "sub_number": null
      }
    ]
  },
  "team_2": { ... same structure ... },
  "match_time": "16:05",
  "half": "Second Half",
  "group_name": "Group A",
  "stage": null
}

IMPORTANT:
- Extract team_1 as the team shown on the LEFT side of the screen
- Extract team_2 as the team shown on the RIGHT side of the screen
- DO NOT assume left=home or right=away - just extract the data as team_1 and team_2
- Include all players: starters (is_starter: true) and subs (is_starter: false, sub_number: 1, 2, or 3)`,
            },
            ...imageContents,
          ],
        },
      ],
      max_tokens: 8000,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`OpenAI API error: ${err}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;

  if (!content) throw new Error("No response from OpenAI");

  let jsonStr = content.trim();
  if (jsonStr.startsWith("```json")) jsonStr = jsonStr.slice(7);
  else if (jsonStr.startsWith("```")) jsonStr = jsonStr.slice(3);
  if (jsonStr.endsWith("```")) jsonStr = jsonStr.slice(0, -3);

  const parsed = JSON.parse(jsonStr.trim());

  return {
    home_team: parsed.team_1 || parsed.home_team,
    away_team: parsed.team_2 || parsed.away_team,
    match_time: parsed.match_time,
    half: parsed.half,
    group_name: parsed.group_name ? normalizeGroupName(parsed.group_name) : null,
    stage: parsed.stage || null,
    home_away_unconfirmed: true,
  };
}

// Find matching fixture for the extracted match
async function findMatchingFixture(
  team1Name: string,
  team2Name: string,
  logs: string[]
): Promise<{
  id: string;
  league_id: string | null;
  home_team: string;
  away_team: string;
  played_at: string;
  day: number | null;
  swapped: boolean;
} | null> {
  if (!supabaseAdmin) return null;

  logs.push(`Looking for fixture with teams: "${team1Name}" and "${team2Name}"`);

  const { data: fixtures, error } = await supabaseAdmin
    .from("matches")
    .select("id, league_id, home_team, away_team, played_at, home_score, away_score, day")
    .or("home_score.is.null,away_score.is.null")
    .order("played_at", { ascending: true });

  if (error || !fixtures) {
    logs.push(`Error fetching fixtures: ${error?.message}`);
    return null;
  }

  logs.push(`Found ${fixtures.length} unplayed fixtures to search`);

  const matchingFixtures: Array<typeof fixtures[0] & { swapped: boolean }> = [];

  for (const fixture of fixtures) {
    const team1IsHome = doTeamNamesMatch(team1Name, fixture.home_team);
    const team2IsAway = doTeamNamesMatch(team2Name, fixture.away_team);

    if (team1IsHome && team2IsAway) {
      logs.push(`Found matching fixture (no swap): ${fixture.home_team} vs ${fixture.away_team}`);
      matchingFixtures.push({ ...fixture, swapped: false });
      continue;
    }

    const team1IsAway = doTeamNamesMatch(team1Name, fixture.away_team);
    const team2IsHome = doTeamNamesMatch(team2Name, fixture.home_team);

    if (team1IsAway && team2IsHome) {
      logs.push(`Found matching fixture (SWAPPED): ${fixture.home_team} vs ${fixture.away_team}`);
      matchingFixtures.push({ ...fixture, swapped: true });
    }
  }

  if (matchingFixtures.length === 0) {
    logs.push(`No matching fixture found`);
    return null;
  }

  const now = new Date().getTime();
  let closestFixture = matchingFixtures[0];
  let closestDistance = Math.abs(new Date(closestFixture.played_at).getTime() - now);

  for (const fixture of matchingFixtures) {
    const distance = Math.abs(new Date(fixture.played_at).getTime() - now);
    if (distance < closestDistance) {
      closestDistance = distance;
      closestFixture = fixture;
    }
  }

  return {
    id: closestFixture.id,
    league_id: closestFixture.league_id,
    home_team: closestFixture.home_team,
    away_team: closestFixture.away_team,
    played_at: closestFixture.played_at,
    day: closestFixture.day,
    swapped: closestFixture.swapped,
  };
}

// Get team roster context for player matching
async function getTeamRoster(
  teamName: string,
  allPlayers: DbPlayer[],
  logs: string[]
): Promise<TeamRosterContext | null> {
  if (!supabaseAdmin || !teamName) return null;

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

  const { data: recentStats } = await supabaseAdmin
    .from("match_player_stats")
    .select("player_id")
    .in("match_id", matchIds);

  if (!recentStats) return null;

  const recentPlayerIds = [...new Set(recentStats.map(s => s.player_id))];
  const recentPlayers = allPlayers.filter(p => recentPlayerIds.includes(p.id));

  logs.push(`Found ${recentPlayers.length} recent players for team: ${teamName}`);

  return {
    teamName,
    recentPlayerIds,
    recentPlayers,
  };
}

export async function POST(req: NextRequest) {
  const auth = requireAuth(req);
  if (!auth.ok) return json(401, { error: auth.error });

  if (!supabaseAdmin) return json(500, { error: "Server missing SUPABASE_SERVICE_ROLE_KEY" });

  const errors: string[] = [];
  const logs: string[] = [];

  try {
    const body = await req.json();
    const { images, league_id, extractedData: preExtractedData } = body;

    let extractedData: any;

    if (preExtractedData) {
      logs.push("Using pre-extracted data from preview");
      extractedData = preExtractedData;
    } else {
      if (!images || !Array.isArray(images) || images.length === 0) {
        return json(400, { error: "No images provided" });
      }
      logs.push(`Received ${images.length} images`);
      extractedData = await extractDataWithOpenAI(images);
    }

    const isAutoMode = league_id === "auto" || league_id === "";

    logs.push(`League mode: ${isAutoMode ? "Auto (find fixture)" : league_id ? "Manual" : "None"}`);
    logs.push(`Extracted teams: "${extractedData.home_team?.team_name}" and "${extractedData.away_team?.team_name}"`);

    let matchingFixture: Awaited<ReturnType<typeof findMatchingFixture>> = null;
    let finalLeagueId: string | null = null;
    let matchId: string;
    let match: any;
    let isUpdatedFixture = false;
    let teamsWereSwapped = false;

    let homeTeamData = extractedData.home_team;
    let awayTeamData = extractedData.away_team;

    if (isAutoMode) {
      matchingFixture = await findMatchingFixture(
        extractedData.home_team.team_name,
        extractedData.away_team.team_name,
        logs
      );

      if (matchingFixture) {
        finalLeagueId = matchingFixture.league_id;
        if (matchingFixture.swapped) {
          logs.push(`Swapping teams to match fixture`);
          homeTeamData = extractedData.away_team;
          awayTeamData = extractedData.home_team;
          teamsWereSwapped = true;
        }
      }
    } else if (league_id && league_id !== "auto") {
      finalLeagueId = league_id;
    }

    const finalHomeTeamName = matchingFixture ? matchingFixture.home_team : homeTeamData.team_name;
    const finalAwayTeamName = matchingFixture ? matchingFixture.away_team : awayTeamData.team_name;

    if (matchingFixture) {
      const { data: updatedMatch, error: updateError } = await supabaseAdmin
        .from("matches")
        .update({
          home_score: homeTeamData.goals,
          away_score: awayTeamData.goals,
          played_at: new Date().toISOString(),
          ...(extractedData.group_name != null ? { group_name: extractedData.group_name } : {}),
          ...(extractedData.stage != null ? { stage: extractedData.stage } : {}),
        })
        .eq("id", matchingFixture.id)
        .select()
        .single();

      if (updateError) throw new Error(`Failed to update fixture: ${updateError.message}`);

      match = updatedMatch;
      matchId = matchingFixture.id;
      isUpdatedFixture = true;
    } else {
      const { data: newMatch, error: matchError } = await supabaseAdmin
        .from("matches")
        .insert({
          league_id: finalLeagueId,
          played_at: new Date().toISOString(),
          home_team: finalHomeTeamName,
          away_team: finalAwayTeamName,
          home_score: homeTeamData.goals,
          away_score: awayTeamData.goals,
          group_name: extractedData.group_name || null,
          stage: extractedData.stage || null,
        })
        .select()
        .single();

      if (matchError) throw new Error(`Failed to create match: ${matchError.message}`);

      match = newMatch;
      matchId = newMatch.id;
    }

    if (isUpdatedFixture) {
      await supabaseAdmin.from("match_team_stats").delete().eq("match_id", matchId);
      await supabaseAdmin.from("match_player_stats").delete().eq("match_id", matchId);
      logs.push(`Cleared existing stats for fixture`);
    }

    // Insert team stats
    const homeTeamStats = {
      match_id: matchId,
      team_name: finalHomeTeamName,
      team_side: "home",
      is_home: true,
      possession: homeTeamData.possession,
      passes: homeTeamData.passes,
      key_passes: homeTeamData.key_passes,
      assists: homeTeamData.assists,
      shots: homeTeamData.shots,
      shots_on_target: homeTeamData.shots_on_target,
      goals: homeTeamData.goals,
      tackles: homeTeamData.tackles,
      key_tackles: homeTeamData.key_tackles,
      interceptions: homeTeamData.interceptions,
      key_interceptions: homeTeamData.key_interceptions,
      possessions_lost: homeTeamData.possessions_lost,
      goal_kicks: homeTeamData.goal_kicks,
      corner_kicks: homeTeamData.corner_kicks,
      throw_ins: homeTeamData.throw_ins,
      free_kicks: homeTeamData.free_kicks,
      penalties: homeTeamData.penalties,
      fouls: homeTeamData.fouls,
      offsides: homeTeamData.offsides,
      set_piece_timeouts: homeTeamData.set_piece_timeouts || 0,
      yellow_cards: homeTeamData.yellow_cards,
      red_cards: homeTeamData.red_cards,
    };

    const awayTeamStats = {
      match_id: matchId,
      team_name: finalAwayTeamName,
      team_side: "away",
      is_home: false,
      possession: awayTeamData.possession,
      passes: awayTeamData.passes,
      key_passes: awayTeamData.key_passes,
      assists: awayTeamData.assists,
      shots: awayTeamData.shots,
      shots_on_target: awayTeamData.shots_on_target,
      goals: awayTeamData.goals,
      tackles: awayTeamData.tackles,
      key_tackles: awayTeamData.key_tackles,
      interceptions: awayTeamData.interceptions,
      key_interceptions: awayTeamData.key_interceptions,
      possessions_lost: awayTeamData.possessions_lost,
      goal_kicks: awayTeamData.goal_kicks,
      corner_kicks: awayTeamData.corner_kicks,
      throw_ins: awayTeamData.throw_ins,
      free_kicks: awayTeamData.free_kicks,
      penalties: awayTeamData.penalties,
      fouls: awayTeamData.fouls,
      offsides: awayTeamData.offsides,
      set_piece_timeouts: awayTeamData.set_piece_timeouts || 0,
      yellow_cards: awayTeamData.yellow_cards,
      red_cards: awayTeamData.red_cards,
    };

    const { error: teamStatsError } = await supabaseAdmin
      .from("match_team_stats")
      .insert([homeTeamStats, awayTeamStats]);

    if (teamStatsError) {
      errors.push(`Team stats: ${teamStatsError.message}`);
    }

    // Fetch all players for matching
    const { data: allPlayersData } = await supabaseAdmin
      .from("players")
      .select("id, name, handle, game_user_id");

    const allPlayers: DbPlayer[] = allPlayersData || [];
    logs.push(`Loaded ${allPlayers.length} existing players for matching`);

    // Get team rosters for multi-factor matching
    const homeRoster = await getTeamRoster(finalHomeTeamName, allPlayers, logs);
    const awayRoster = await getTeamRoster(finalAwayTeamName, allPlayers, logs);

    // Process players with multi-factor matching
    const allPlayerStats: any[] = [];
    const playersCreated: string[] = [];
    const playersMatched: string[] = [];
    const playersNeedingReview: string[] = [];

    const processPlayer = async (p: any, teamSide: "home" | "away", teamRoster: TeamRosterContext | null) => {
      if (!p.user_id && !p.name) {
        errors.push(`Player missing both user_id and name`);
        return null;
      }

      const isBenched = !p.is_starter && p.sub_number !== null && (p.score === 0 || p.score === undefined);
      const statsIncomplete = p.stats_incomplete ?? false;

      logs.push(`Processing player: ${p.name} (${p.user_id || 'no user_id'})${isBenched ? ' [BENCHED]' : ''}`);

      try {
        let playerId: string | null = null;
        let matchMethod = "";
        let confidence = 0;

        // Check if player has a pre-selected match from UI validation
        if (p.matchResult?.playerId) {
          playerId = p.matchResult.playerId;
          matchMethod = `user_selected (${p.matchResult.matchMethod})`;
          confidence = p.matchResult.confidence;
          logs.push(`✓ Using pre-selected match: ${playerId}`);
        } else {
          // Use multi-factor matching
          const matchResult = matchPlayer(
            {
              position: p.position,
              name: p.name,
              user_id: p.user_id,
              level: p.level,
              overall_rating: p.overall_rating,
              score: p.score,
            },
            allPlayers,
            teamRoster,
            logs
          );

          playerId = matchResult.playerId;
          matchMethod = matchResult.matchMethod;
          confidence = matchResult.confidence;

          if (matchResult.needsUserReview) {
            playersNeedingReview.push(`${p.name} (${p.user_id || 'no ID'})`);
          }
        }

        // If still no match, create new player
        if (!playerId) {
          const { data: newPlayer, error: createError } = await supabaseAdmin!
            .from("players")
            .insert({
              name: p.name,
              handle: p.user_id || `player_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
              game_user_id: p.user_id || null,
            })
            .select("id")
            .single();

          if (createError) {
            errors.push(`Create player ${p.name} error: ${createError.message}`);
            return null;
          }

          playerId = newPlayer.id;
          playersCreated.push(`${p.name} (${p.user_id || 'no ID'})`);
          matchMethod = "created_new";

          // Add to players list for subsequent matching
          allPlayers.push({
            id: newPlayer.id,
            name: p.name,
            handle: p.user_id,
            game_user_id: p.user_id,
          });
        } else {
          playersMatched.push(`${p.name} [${matchMethod}] (${confidence}%)`);
        }

        logs.push(`✓ ${p.name} -> ${playerId} [${matchMethod}]`);

        // FIX: Ensure playerId is not null before creating stats
        if (!playerId) {
          errors.push(`Failed to get player ID for ${p.name}`);
          return null;
        }

        return {
          match_id: matchId,
          player_id: playerId, // Now guaranteed to be string, not null
          team_side: teamSide,
          position: p.position,
          goals: p.goals || 0,
          assists: p.assists || 0,
          shots: p.shots || 0,
          shots_on_target: p.shots_on_target || 0,
          saves: p.gk_saves || 0,
          score: p.score || 0,
          passes: p.passes || 0,
          key_passes: p.key_passes || 0,
          tackles: p.tackles || 0,
          key_tackles: p.key_tackles || 0,
          interceptions: p.interceptions || 0,
          key_interceptions: p.key_interceptions || 0,
          possessions_lost: p.possessions_lost || 0,
          gk_saves: p.gk_saves || 0,
          gk_catches: p.gk_catches || 0,
          is_starter: p.is_starter ?? true,
          sub_number: p.sub_number || null,
          benched: isBenched,
          stats_incomplete: statsIncomplete,
        };
      } catch (err: any) {
        errors.push(`Player ${p.name} exception: ${err.message}`);
        return null;
      }
    };

    // Process home team players
    for (const player of homeTeamData.players || []) {
      const stats = await processPlayer(player, "home", homeRoster);
      if (stats) allPlayerStats.push(stats);
    }

    // Process away team players
    for (const player of awayTeamData.players || []) {
      const stats = await processPlayer(player, "away", awayRoster);
      if (stats) allPlayerStats.push(stats);
    }

    logs.push(`Prepared ${allPlayerStats.length} player stats for insert`);

    if (allPlayerStats.length > 0) {
      const { error: playerStatsError } = await supabaseAdmin
        .from("match_player_stats")
        .insert(allPlayerStats);

      if (playerStatsError) {
        errors.push(`Player stats insert: ${playerStatsError.message}`);
      } else {
        logs.push(`Inserted ${allPlayerStats.length} player stats successfully`);
      }
    } else {
      errors.push("No player stats to insert");
    }

    // Get league name
    let leagueName: string | null = null;
    if (finalLeagueId) {
      const { data: leagueData } = await supabaseAdmin
        .from("leagues")
        .select("name")
        .eq("id", finalLeagueId)
        .single();
      leagueName = leagueData?.name || null;
    }

    return json(201, {
      success: errors.length === 0,
      match,
      extracted: extractedData,
      fixtureUpdated: isUpdatedFixture,
      teamsSwapped: teamsWereSwapped,
      hasDetailedStats: extractedData.has_detailed_stats ?? true,
      fixtureInfo: matchingFixture ? {
        id: matchingFixture.id,
        originalHomeTeam: matchingFixture.home_team,
        originalAwayTeam: matchingFixture.away_team,
        scheduledAt: matchingFixture.played_at,
        day: matchingFixture.day,
        swapped: matchingFixture.swapped,
      } : null,
      league: finalLeagueId ? { id: finalLeagueId, name: leagueName } : null,
      errors: errors.length > 0 ? errors : null,
      logs,
      stats: {
        teamStatsInserted: !errors.some((e) => e.includes("Team stats")),
        playerStatsInserted: !errors.some((e) => e.includes("Player stats")),
        playersCreated,
        playersMatched,
        playersNeedingReview,
        playerStatsCount: allPlayerStats.length,
        homePlayersExtracted: homeTeamData.players?.length || 0,
        awayPlayersExtracted: awayTeamData.players?.length || 0,
        playersWithIncompleteStats: allPlayerStats.filter(s => s.stats_incomplete).length,
      },
    });
  } catch (error: any) {
    console.error("Import error:", error);
    return json(500, {
      error: error.message || "Failed to import match",
      errors,
      logs,
    });
  }
}
