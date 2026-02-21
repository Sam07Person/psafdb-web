import { NextRequest, NextResponse } from "next/server";

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

If MULTIPLE images are provided (detailed view available):
- Extract all detailed player stats
- Mark "stats_incomplete": false for each player

For player ratings shown as colored badges (green/yellow/red with numbers), extract the number.
For stats shown as "X (Y)", X is the total and Y is key/on-target.

IMPORTANT: 
- Pay very close attention to player IDs (the alphanumeric codes). These are case-sensitive and must be exact.
- Common OCR mistakes to avoid: 0 vs O, 1 vs l vs I, G vs Q, x vs s, h vs H vs n
- DO NOT assume which team is "home" or "away" based on screen position. Just label them as "team_1" and "team_2".

Return ONLY valid JSON with no markdown formatting.`,
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Extract all match data from these ${base64Images.length} screenshot(s). 

${isSingleImage ? "NOTE: Only 1 image provided - this is likely the basic overview without detailed player stats. Mark all players with stats_incomplete: true and set detailed stats to null." : "NOTE: Multiple images provided - extract full detailed stats for all players."}

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
  "has_detailed_stats": ${!isSingleImage}
}

When stats_incomplete is true, set these to null: passes, key_passes, assists, shots, shots_on_target, goals, tackles, key_tackles, interceptions, key_interceptions, possessions_lost, gk_saves, gk_catches

IMPORTANT: 
- Extract team_1 as the team shown on the LEFT side of the screen
- Extract team_2 as the team shown on the RIGHT side of the screen  
- DO NOT assume left=home or right=away
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
  
  // Convert team_1/team_2 to home_team/away_team format for compatibility
  return {
    home_team: parsed.team_1 || parsed.home_team,
    away_team: parsed.team_2 || parsed.away_team,
    match_time: parsed.match_time,
    half: parsed.half,
    has_detailed_stats: parsed.has_detailed_stats ?? !isSingleImage,
    home_away_unconfirmed: true,
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

    const extractedData = await extractDataWithOpenAI(images);

    return json(200, {
      success: true,
      extracted: extractedData,
      imageCount: images.length,
      hasDetailedStats: extractedData.has_detailed_stats,
    });
  } catch (error: any) {
    console.error("Extraction error:", error);
    return json(500, {
      error: error.message || "Failed to extract match data",
    });
  }
}