import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { 
  matchAllPlayers, 
  getMatchingSummary, 
  getConfidenceLevel,
  DbPlayer,
  ExtractedPlayer,
  MatchResult 
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
  // "Groups C" → "Group C", "groups b" → "Group B"
  return raw.replace(/^groups?\s+/i, "Group ").trim();
}

async function extractDataWithOpenAI(base64Images: string[]) {
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) throw new Error("OPENAI_API_KEY not configured");

  const imageContents = base64Images.map((img) => ({
    type: "image_url" as const,
    image_url: { url: img },
  }));

  const isSingleImage = base64Images.length === 1;

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

If only ONE image is provided (basic view only):
- You will see team stats, score, and player names/positions/scores
- You will NOT have detailed player stats (goals, assists, passes, tackles, etc.)
- Mark "stats_incomplete": true for each player
- Only extract: name, user_id, position, score, level, overall_rating, ping, is_starter, sub_number
- Set all other stats (goals, assists, passes, etc.) to null

If MULTIPLE images are provided:
- Most of the time, detailed stats are available for BOTH teams. Extract them all and mark "stats_incomplete": false for all players whose stats you can see.
- The detailed stats view shows a table/list of each player's individual stats (passes, tackles, shots, goals, etc.). If you can see this table for a team, that team has detailed stats.
- ONLY mark "stats_incomplete": true if you genuinely cannot see a player's detailed stats in ANY of the provided images.
- In rare cases, detailed stats may only be visible for one team. In that case, mark only the other team's players as stats_incomplete: true.
- NEVER invent or guess stats you cannot see. But DO extract stats that ARE visible - do not skip them.

For player ratings shown as colored badges (green/yellow/red with numbers), extract the number.
For stats shown as "X (Y)", X is the total and Y is key/on-target.

CRITICAL FOR PLAYER NAMES AND IDs:
- Player NAMES are much more reliable for matching than IDs. Extract names very carefully!
- For player IDs (alphanumeric codes like "Gv26ZzCS"), these are case-sensitive and often have OCR errors.
- Common OCR mistakes: 0↔O, 1↔l↔I, S↔5, 3↔8, G↔Q, n↔h
- If you're uncertain about a character in the ID, still extract your best guess.
- The name will be used as the primary matching key, so ensure names are accurate.

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
              text: `Extract all match data from these ${base64Images.length} screenshot(s). 

${isSingleImage ? "NOTE: Only 1 image provided - this is likely the basic overview without detailed player stats. Mark all players with stats_incomplete: true and set detailed stats to null." : "NOTE: Multiple images provided - detailed stats are usually available for BOTH teams. Extract all visible stats and set stats_incomplete: false. Only set stats_incomplete: true for a player if their detailed stats are genuinely not visible in any image."}

Return JSON in this exact format:
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
        "user_id": "abc123",
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
  "match_time": "16:00",
  "half": "Second Half",
  "group_name": "Group A",
  "stage": null,
  "has_detailed_stats_team_1": true,
  "has_detailed_stats_team_2": true
}

When stats_incomplete is true, set these to null: passes, key_passes, assists, shots, shots_on_target, goals, tackles, key_tackles, interceptions, key_interceptions, possessions_lost, gk_saves, gk_catches

IMPORTANT: 
- Extract team_1 as the team shown on the LEFT side of the screen
- Extract team_2 as the team shown on the RIGHT side of the screen  
- DO NOT assume left=home or right=away
- Include all players: starters (is_starter: true) and subs (is_starter: false, sub_number: 1, 2, or 3)
- Focus on getting player NAMES exactly right - they are the primary matching key`,
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
  
  // Convert team_1/team_2 to home_team/away_team format for compatibility
  return {
    home_team: parsed.team_1 || parsed.home_team,
    away_team: parsed.team_2 || parsed.away_team,
    match_time: parsed.match_time,
    half: parsed.half,
    group_name: parsed.group_name ? normalizeGroupName(parsed.group_name) : null,
    stage: parsed.stage || null,
    has_detailed_stats: (parsed.has_detailed_stats_team_1 || parsed.has_detailed_stats_team_2) ?? parsed.has_detailed_stats ?? !isSingleImage,
    has_detailed_stats_team_1: parsed.has_detailed_stats_team_1 ?? parsed.has_detailed_stats ?? !isSingleImage,
    has_detailed_stats_team_2: parsed.has_detailed_stats_team_2 ?? parsed.has_detailed_stats ?? !isSingleImage,
    home_away_unconfirmed: true,
  };
}

/**
 * Validate extracted players against database and add confidence scores
 */
async function validateExtractedPlayers(extractedData: any): Promise<{
  validated: any;
  matchingSummary: ReturnType<typeof getMatchingSummary>;
  homeValidation: MatchResult[];
  awayValidation: MatchResult[];
}> {
  if (!supabaseAdmin) {
    return {
      validated: extractedData,
      matchingSummary: { total: 0, highConfidence: 0, mediumConfidence: 0, lowConfidence: 0, newPlayers: 0, withWarnings: 0 },
      homeValidation: [],
      awayValidation: [],
    };
  }

  // Fetch all players from database
  const { data: dbPlayersRaw } = await supabaseAdmin
    .from("players")
    .select("id, name, handle, game_user_id");
  
  const dbPlayers: DbPlayer[] = (dbPlayersRaw || []).map(p => ({
    id: p.id,
    name: p.name,
    handle: p.handle,
    game_user_id: p.game_user_id,
  }));

  // Extract players from data
  const homePlayers: ExtractedPlayer[] = (extractedData.home_team?.players || []).map((p: any) => ({
    ...p,
    name: p.name || "",
    user_id: p.user_id || null,
  }));

  const awayPlayers: ExtractedPlayer[] = (extractedData.away_team?.players || []).map((p: any) => ({
    ...p,
    name: p.name || "",
    user_id: p.user_id || null,
  }));

  // Match players against database
  const homeValidation = matchAllPlayers(homePlayers, dbPlayers);
  const awayValidation = matchAllPlayers(awayPlayers, dbPlayers);

  // Update extracted data with validation results
  const validated = JSON.parse(JSON.stringify(extractedData));

  if (validated.home_team?.players) {
    validated.home_team.players = validated.home_team.players.map((p: any, i: number) => {
      const validation = homeValidation[i];
      return {
        ...p,
        // Add validation data
        _validation: {
          confidence: validation.confidence,
          confidenceLevel: getConfidenceLevel(validation.confidence),
          matchMethod: validation.matchMethod,
          isNewPlayer: validation.isNewPlayer,
          matchedPlayerId: validation.matchedDbPlayer?.id || null,
          matchedPlayerName: validation.matchedDbPlayer?.name || null,
          matchedGameUserId: validation.matchedDbPlayer?.game_user_id || null,
          suggestions: validation.suggestions.slice(0, 3),
          warnings: validation.warnings,
        },
        // Provide corrected user_id if we have a high-confidence match
        _corrected_user_id: validation.confidence >= 60 && validation.matchedDbPlayer?.game_user_id
          ? validation.matchedDbPlayer.game_user_id
          : null,
      };
    });
  }

  if (validated.away_team?.players) {
    validated.away_team.players = validated.away_team.players.map((p: any, i: number) => {
      const validation = awayValidation[i];
      return {
        ...p,
        // Add validation data
        _validation: {
          confidence: validation.confidence,
          confidenceLevel: getConfidenceLevel(validation.confidence),
          matchMethod: validation.matchMethod,
          isNewPlayer: validation.isNewPlayer,
          matchedPlayerId: validation.matchedDbPlayer?.id || null,
          matchedPlayerName: validation.matchedDbPlayer?.name || null,
          matchedGameUserId: validation.matchedDbPlayer?.game_user_id || null,
          suggestions: validation.suggestions.slice(0, 3),
          warnings: validation.warnings,
        },
        // Provide corrected user_id if we have a high-confidence match
        _corrected_user_id: validation.confidence >= 60 && validation.matchedDbPlayer?.game_user_id
          ? validation.matchedDbPlayer.game_user_id
          : null,
      };
    });
  }

  const allValidations = [...homeValidation, ...awayValidation];
  const matchingSummary = getMatchingSummary(allValidations);

  return {
    validated,
    matchingSummary,
    homeValidation,
    awayValidation,
  };
}

export async function POST(req: NextRequest) {
  const auth = requireAuth(req);
  if (!auth.ok) return json(401, { error: auth.error });

  try {
    const body = await req.json();
    const { images } = body;

    if (!images || !Array.isArray(images) || images.length === 0) {
      return json(400, { error: "No images provided" });
    }

    // Extract data from images
    const extractedData = await extractDataWithOpenAI(images);

    // Validate players against database
    const { validated, matchingSummary, homeValidation, awayValidation } = 
      await validateExtractedPlayers(extractedData);

    // Collect all warnings
    const allWarnings = [
      ...homeValidation.flatMap(v => v.warnings),
      ...awayValidation.flatMap(v => v.warnings),
    ];

    return json(200, {
      success: true,
      extracted: validated,
      imageCount: images.length,
      hasDetailedStats: extractedData.has_detailed_stats,
      validation: {
        summary: matchingSummary,
        warnings: allWarnings,
        needsReview: matchingSummary.lowConfidence > 0 || matchingSummary.newPlayers > 0 || matchingSummary.withWarnings > 0,
      },
    });
  } catch (error: any) {
    console.error("Extraction error:", error);
    return json(500, {
      error: error.message || "Failed to extract match data",
    });
  }
}
