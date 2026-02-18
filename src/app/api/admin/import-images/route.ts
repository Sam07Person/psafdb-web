import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

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

// Calculate Levenshtein distance between two strings
function levenshteinDistance(str1: string, str2: string): number {
  const m = str1.length;
  const n = str2.length;
  const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (str1[i - 1] === str2[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
  }

  return dp[m][n];
}

// Check if two strings are similar (case-insensitive, allows for OCR-like errors)
function areSimilar(str1: string | null, str2: string | null, maxDistance: number = 2): boolean {
  if (!str1 || !str2) return false;

  if (str1.toLowerCase() === str2.toLowerCase()) return true;

  if (Math.abs(str1.length - str2.length) <= 1) {
    const distance = levenshteinDistance(str1.toLowerCase(), str2.toLowerCase());
    return distance <= maxDistance;
  }

  return false;
}

// Check if player IDs are similar (stricter - same length, max 2 char difference)
function arePlayerIdsSimilar(id1: string | null, id2: string | null): boolean {
  if (!id1 || !id2) return false;

  if (id1.length !== id2.length) return false;

  if (id1.toLowerCase() === id2.toLowerCase()) return true;

  let differences = 0;
  for (let i = 0; i < id1.length; i++) {
    if (id1[i].toLowerCase() !== id2[i].toLowerCase()) {
      differences++;
      if (differences > 2) return false;
    }
  }

  return differences <= 2;
}

// Check if names are similar
function areNamesSimilar(name1: string | null, name2: string | null): boolean {
  if (!name1 || !name2) return false;

  const n1 = name1.toLowerCase().trim();
  const n2 = name2.toLowerCase().trim();

  if (n1 === n2) return true;

  if (n1.includes(n2) || n2.includes(n1)) return true;

  const maxDistance = Math.max(2, Math.floor(Math.min(n1.length, n2.length) / 4));
  return levenshteinDistance(n1, n2) <= maxDistance;
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

The images show:
1. A match overview with team stats in the center and player lineups on both sides
2. Detailed player statistics for each team

For player ratings shown as colored badges (green/yellow/red with numbers), extract the number.
For stats shown as "X (Y)", X is the total and Y is key/on-target.

IMPORTANT: Pay very close attention to player IDs (the alphanumeric codes). These are case-sensitive and must be exact. Common OCR mistakes to avoid:
- 0 vs O, 1 vs l vs I, G vs Q, x vs s, h vs H vs n

Return ONLY valid JSON with no markdown formatting.`,
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Extract all match data from these screenshots. Return JSON in this exact format:
{
  "home_team": {
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
        "user_id": "abc123",
        "level": 70,
        "overall_rating": 85,
        "ping": 50,
        "score": 500,
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
  "away_team": { ... same structure ... },
  "match_time": "16:05",
  "half": "Second Half"
}

The home team is on the LEFT side of the match overview image (usually has the team panel at bottom-left).
The away team is on the RIGHT side (team panel at bottom-right).
Include all players: starters (is_starter: true) and subs (is_starter: false, sub_number: 1, 2, or 3).`,
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

  return JSON.parse(jsonStr.trim());
}

// Find matching fixture for the extracted match
async function findMatchingFixture(
  homeTeam: string,
  awayTeam: string,
  logs: string[]
): Promise<{
  id: string;
  league_id: string | null;
  home_team: string;
  away_team: string;
  played_at: string;
  day: number | null;
} | null> {
  if (!supabaseAdmin) return null;

  logs.push(`Looking for fixture: "${homeTeam}" vs "${awayTeam}"`);

  // Get all unplayed fixtures (where scores are null)
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

  // Find fixtures that match the teams
  const matchingFixtures: typeof fixtures = [];

  for (const fixture of fixtures) {
    // Check exact order (home vs away)
    const homeMatches = doTeamNamesMatch(homeTeam, fixture.home_team);
    const awayMatches = doTeamNamesMatch(awayTeam, fixture.away_team);

    if (homeMatches && awayMatches) {
      logs.push(`Found matching fixture: ${fixture.home_team} vs ${fixture.away_team} (${fixture.played_at})`);
      matchingFixtures.push(fixture);
    }
  }

  if (matchingFixtures.length === 0) {
    logs.push(`No matching fixture found for "${homeTeam}" vs "${awayTeam}"`);
    return null;
  }

  // If multiple matches, pick the one closest to now
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

  logs.push(`Selected fixture (closest to now): ${closestFixture.home_team} vs ${closestFixture.away_team} at ${closestFixture.played_at}`);

  return {
    id: closestFixture.id,
    league_id: closestFixture.league_id,
    home_team: closestFixture.home_team,
    away_team: closestFixture.away_team,
    played_at: closestFixture.played_at,
    day: closestFixture.day,
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
    const { images, league_id } = body;

    if (!images || !Array.isArray(images) || images.length === 0) {
      return json(400, { error: "No images provided" });
    }

    const isAutoMode = league_id === "auto" || league_id === "";

    logs.push(`Received ${images.length} images`);
    logs.push(`League mode: ${isAutoMode ? "Auto (find fixture)" : league_id ? "Manual" : "None"}`);

    const extractedData = await extractDataWithOpenAI(images);

    logs.push(`Extracted data: home_team=${extractedData.home_team?.team_name}, away_team=${extractedData.away_team?.team_name}`);
    logs.push(`Home goals: ${extractedData.home_team?.goals}, Away goals: ${extractedData.away_team?.goals}`);
    logs.push(`Home players: ${extractedData.home_team?.players?.length || 0}`);
    logs.push(`Away players: ${extractedData.away_team?.players?.length || 0}`);

    // Try to find matching fixture in auto mode
    let matchingFixture: Awaited<ReturnType<typeof findMatchingFixture>> = null;
    let finalLeagueId: string | null = null;
    let matchId: string;
    let match: any;
    let isUpdatedFixture = false;

    if (isAutoMode) {
      matchingFixture = await findMatchingFixture(
        extractedData.home_team.team_name,
        extractedData.away_team.team_name,
        logs
      );

      if (matchingFixture) {
        finalLeagueId = matchingFixture.league_id;
        logs.push(`Auto-detected league from fixture: ${finalLeagueId || "none"}`);
      } else {
        logs.push(`No fixture found, will create as non-league match`);
      }
    } else if (league_id && league_id !== "auto") {
      finalLeagueId = league_id;
    }

    if (matchingFixture) {
      // Update existing fixture with scores
      const { data: updatedMatch, error: updateError } = await supabaseAdmin
        .from("matches")
        .update({
          home_score: extractedData.home_team.goals,
          away_score: extractedData.away_team.goals,
          played_at: new Date().toISOString(), // Update to actual play time
        })
        .eq("id", matchingFixture.id)
        .select()
        .single();

      if (updateError) throw new Error(`Failed to update fixture: ${updateError.message}`);

      match = updatedMatch;
      matchId = matchingFixture.id;
      isUpdatedFixture = true;
      logs.push(`Updated existing fixture: ${matchId}`);
    } else {
      // Create new match
      const { data: newMatch, error: matchError } = await supabaseAdmin
        .from("matches")
        .insert({
          league_id: finalLeagueId,
          played_at: new Date().toISOString(),
          home_team: extractedData.home_team.team_name,
          away_team: extractedData.away_team.team_name,
          home_score: extractedData.home_team.goals,
          away_score: extractedData.away_team.goals,
        })
        .select()
        .single();

      if (matchError) throw new Error(`Failed to create match: ${matchError.message}`);

      match = newMatch;
      matchId = newMatch.id;
      logs.push(`Created new match: ${matchId}`);
    }

    // Delete existing team stats and player stats if updating a fixture
    if (isUpdatedFixture) {
      await supabaseAdmin.from("match_team_stats").delete().eq("match_id", matchId);
      await supabaseAdmin.from("match_player_stats").delete().eq("match_id", matchId);
      logs.push(`Cleared existing stats for fixture`);
    }

    // Insert team stats
    const homeTeamStats = {
      match_id: matchId,
      team_name: extractedData.home_team.team_name,
      team_side: "home",
      is_home: true,
      possession: extractedData.home_team.possession,
      passes: extractedData.home_team.passes,
      key_passes: extractedData.home_team.key_passes,
      assists: extractedData.home_team.assists,
      shots: extractedData.home_team.shots,
      shots_on_target: extractedData.home_team.shots_on_target,
      goals: extractedData.home_team.goals,
      tackles: extractedData.home_team.tackles,
      key_tackles: extractedData.home_team.key_tackles,
      interceptions: extractedData.home_team.interceptions,
      key_interceptions: extractedData.home_team.key_interceptions,
      possessions_lost: extractedData.home_team.possessions_lost,
      goal_kicks: extractedData.home_team.goal_kicks,
      corner_kicks: extractedData.home_team.corner_kicks,
      throw_ins: extractedData.home_team.throw_ins,
      free_kicks: extractedData.home_team.free_kicks,
      penalties: extractedData.home_team.penalties,
      fouls: extractedData.home_team.fouls,
      offsides: extractedData.home_team.offsides,
      set_piece_timeouts: extractedData.home_team.set_piece_timeouts || 0,
      yellow_cards: extractedData.home_team.yellow_cards,
      red_cards: extractedData.home_team.red_cards,
    };

    const awayTeamStats = {
      match_id: matchId,
      team_name: extractedData.away_team.team_name,
      team_side: "away",
      is_home: false,
      possession: extractedData.away_team.possession,
      passes: extractedData.away_team.passes,
      key_passes: extractedData.away_team.key_passes,
      assists: extractedData.away_team.assists,
      shots: extractedData.away_team.shots,
      shots_on_target: extractedData.away_team.shots_on_target,
      goals: extractedData.away_team.goals,
      tackles: extractedData.away_team.tackles,
      key_tackles: extractedData.away_team.key_tackles,
      interceptions: extractedData.away_team.interceptions,
      key_interceptions: extractedData.away_team.key_interceptions,
      possessions_lost: extractedData.away_team.possessions_lost,
      goal_kicks: extractedData.away_team.goal_kicks,
      corner_kicks: extractedData.away_team.corner_kicks,
      throw_ins: extractedData.away_team.throw_ins,
      free_kicks: extractedData.away_team.free_kicks,
      penalties: extractedData.away_team.penalties,
      fouls: extractedData.away_team.fouls,
      offsides: extractedData.away_team.offsides,
      set_piece_timeouts: extractedData.away_team.set_piece_timeouts || 0,
      yellow_cards: extractedData.away_team.yellow_cards,
      red_cards: extractedData.away_team.red_cards,
    };

    const { error: teamStatsError } = await supabaseAdmin
      .from("match_team_stats")
      .insert([homeTeamStats, awayTeamStats]);

    if (teamStatsError) {
      errors.push(`Team stats: ${teamStatsError.message}`);
    } else {
      logs.push("Team stats inserted successfully");
    }

    // Fetch all players for fuzzy matching
    const { data: allPlayers } = await supabaseAdmin
      .from("players")
      .select("id, name, handle, game_user_id");

    const playersList = allPlayers || [];
    logs.push(`Loaded ${playersList.length} existing players for matching`);

    // Fetch recent matches for the teams to get player history
    const { data: recentHomeMatches } = await supabaseAdmin
      .from("matches")
      .select("id")
      .or(`home_team.eq.${extractedData.home_team.team_name},away_team.eq.${extractedData.home_team.team_name}`)
      .order("played_at", { ascending: false })
      .limit(5);

    const { data: recentAwayMatches } = await supabaseAdmin
      .from("matches")
      .select("id")
      .or(`home_team.eq.${extractedData.away_team.team_name},away_team.eq.${extractedData.away_team.team_name}`)
      .order("played_at", { ascending: false })
      .limit(5);

    const recentMatchIds = [
      ...(recentHomeMatches || []).map(m => m.id),
      ...(recentAwayMatches || []).map(m => m.id),
    ].filter(id => id !== matchId); // Exclude current match

    let recentPlayers: any[] = [];
    if (recentMatchIds.length > 0) {
      const { data: recentStats } = await supabaseAdmin
        .from("match_player_stats")
        .select("player_id")
        .in("match_id", recentMatchIds);

      const recentPlayerIds = [...new Set((recentStats || []).map(s => s.player_id))];

      if (recentPlayerIds.length > 0) {
        const { data: recentPlayerData } = await supabaseAdmin
          .from("players")
          .select("id, name, handle, game_user_id")
          .in("id", recentPlayerIds);

        recentPlayers = recentPlayerData || [];
      }
      logs.push(`Found ${recentPlayers.length} players from recent team matches`);
    }

    // Process players
    const allPlayerStats: any[] = [];
    const playersCreated: string[] = [];
    const playersMatched: string[] = [];

    const processPlayer = async (p: any, teamSide: "home" | "away") => {
      if (!p.user_id && !p.name) {
        errors.push(`Player missing both user_id and name`);
        return null;
      }

      // Determine if player was benched (sub with 0 score = didn't play)
      const isBenched = !p.is_starter && p.sub_number !== null && (p.score === 0 || p.score === undefined);

      if (isBenched) {
        logs.push(`📋 ${p.name} marked as benched (Sub ${p.sub_number}, score: ${p.score || 0})`);
      }

      logs.push(`Processing player: ${p.name} (${p.user_id || 'no user_id'})${isBenched ? ' [BENCHED]' : ''}`);

      try {
        let playerId: string | null = null;
        let matchMethod = "";

        // CHECK 1: Exact match by game_user_id
        if (p.user_id) {
          const exactMatch = playersList.find(pl => pl.game_user_id === p.user_id);
          if (exactMatch) {
            playerId = exactMatch.id;
            matchMethod = "exact game_user_id";
          }
        }

        // CHECK 2: Similar player ID + similar name (OCR error correction)
        if (!playerId && p.user_id && p.name) {
          for (const pl of playersList) {
            if (arePlayerIdsSimilar(p.user_id, pl.game_user_id) && areNamesSimilar(p.name, pl.name)) {
              playerId = pl.id;
              matchMethod = `similar ID+name (${pl.game_user_id} ≈ ${p.user_id})`;
              logs.push(`🔧 Fuzzy match: "${p.name}" ID ${p.user_id} -> ${pl.game_user_id}`);
              break;
            }
          }
        }

        // CHECK 3: Check recent team matches for similar player IDs
        if (!playerId && p.user_id && recentPlayers.length > 0) {
          for (const pl of recentPlayers) {
            if (arePlayerIdsSimilar(p.user_id, pl.game_user_id)) {
              playerId = pl.id;
              matchMethod = `similar ID in recent matches (${pl.game_user_id} ≈ ${p.user_id})`;
              logs.push(`🔧 Recent match fuzzy: "${p.name}" ID ${p.user_id} -> ${pl.name} (${pl.game_user_id})`);
              break;
            }
          }
        }

        // CHECK 4: Exact match by name (fallback)
        if (!playerId && p.name) {
          const nameMatch = playersList.find(pl =>
            pl.name?.toLowerCase() === p.name.toLowerCase()
          );
          if (nameMatch) {
            playerId = nameMatch.id;
            matchMethod = "exact name";

            if (!nameMatch.game_user_id && p.user_id) {
              await supabaseAdmin!
                .from("players")
                .update({ game_user_id: p.user_id })
                .eq("id", playerId);
              logs.push(`Updated game_user_id for ${p.name}`);
            }
          }
        }

        // CHECK 5: Similar name only (last resort before creating)
        if (!playerId && p.name) {
          for (const pl of playersList) {
            if (areNamesSimilar(p.name, pl.name)) {
              playerId = pl.id;
              matchMethod = `similar name (${pl.name} ≈ ${p.name})`;
              logs.push(`🔧 Name fuzzy match: "${p.name}" -> "${pl.name}"`);
              break;
            }
          }
        }

        // If still not found, create new player
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
          playersCreated.push(p.name);
          matchMethod = "created new";

          playersList.push({
            id: playerId,
            name: p.name,
            handle: p.user_id,
            game_user_id: p.user_id,
          });
        } else {
          playersMatched.push(`${p.name} (${matchMethod})`);
        }

        logs.push(`✓ ${p.name} -> ${playerId} [${matchMethod}]${isBenched ? ' [BENCHED]' : ''}`);

        return {
          match_id: matchId,
          player_id: playerId,
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
          benched: isBenched,  // NEW: Track if player was benched
        };
      } catch (err: any) {
        errors.push(`Player ${p.name} exception: ${err.message}`);
        return null;
      }
    };

    // Process home team players
    for (const player of extractedData.home_team.players || []) {
      const stats = await processPlayer(player, "home");
      if (stats) allPlayerStats.push(stats);
    }

    // Process away team players
    for (const player of extractedData.away_team.players || []) {
      const stats = await processPlayer(player, "away");
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
      errors.push("No player stats to insert - check if players were extracted from images");
    }

    // Get league name for response
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
      fixtureInfo: matchingFixture ? {
        id: matchingFixture.id,
        originalHomeTeam: matchingFixture.home_team,
        originalAwayTeam: matchingFixture.away_team,
        scheduledAt: matchingFixture.played_at,
        day: matchingFixture.day,
      } : null,
      league: finalLeagueId ? { id: finalLeagueId, name: leagueName } : null,
      errors: errors.length > 0 ? errors : null,
      logs,
      stats: {
        teamStatsInserted: !errors.some((e) => e.includes("Team stats")),
        playerStatsInserted: !errors.some((e) => e.includes("Player stats")),
        playersCreated,
        playersMatched,
        playerStatsCount: allPlayerStats.length,
        homePlayersExtracted: extractedData.home_team.players?.length || 0,
        awayPlayersExtracted: extractedData.away_team.players?.length || 0,
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