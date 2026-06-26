// ============================================================
// TEST VERSION of extract-match — modify this freely to
// experiment with different AI prompts / models / logic.
// The production route at /api/admin/extract-match is untouched.
// ============================================================

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
  return raw.replace(/^groups?\s+/i, "Group ").trim();
}

// Parse JSON from the model, repairing thousands separators inside numbers
// (e.g. a score "1,165" emitted as `"score": 1,165` is invalid JSON). Strips the
// comma between a digit and a following group of exactly 3 digits.
function parseLooseJson(s: string): any {
  let t = s.trim();
  for (let i = 0; i < 4; i++) {
    const next = t.replace(/(\d),(\d{3})(?!\d)/g, "$1$2");
    if (next === t) break;
    t = next;
  }
  return JSON.parse(t);
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
      response_format: { type: "json_object" }, // guarantees syntactically valid JSON
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

  const parsed = parseLooseJson(jsonStr.trim());

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

type StripMeta = { dataUrl: string; isSub: boolean; label: string };

// One GPT-4o call for ONE team: every player's cropped row strip is sent as a
// separate, ordered image so the model can never mix one player's stats with
// another's. Returns that team's players in lineup order.
async function extractTeamPlayersFromStrips(strips: StripMeta[]) {
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) throw new Error("OPENAI_API_KEY not configured");

  const imageContents = strips.map((s) => ({
    type: "image_url" as const,
    image_url: { url: s.dataUrl },
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
          content: `You extract football/soccer player statistics. You are given a SEQUENCE of cropped images. Each image shows EXACTLY ONE player's stat row. Treat every image independently — never carry a value from one image to another.

For each image extract that single player's data. Be precise with numbers and names.
- Player NAMES are the primary key — read them very carefully.
- For user IDs (alphanumeric codes), they are case-sensitive and prone to OCR errors (0/O, 1/l/I, S/5, etc.). Give your best guess.
- Ratings are shown as a coloured shield with a number; extract the number. A grey "-" shield means no rating (null).
- Stats shown as "X (Y)": X is the total, Y is the parenthetical (key / on-target). Extract X and Y separately.
- Use 0 for a blank/zero numeric stat. Use null only when a field is genuinely unreadable.
- Write every number as a plain integer with NO thousands separators (e.g. 1165, never "1,165").

IMPORTANT — validity check: set "is_player_row": true ONLY if the image shows exactly ONE player's full stat row (one name on the left followed by that player's stat columns). Set "is_player_row": false if the image instead shows: a match-summary / team-totals box (e.g. "Possession %", a centre score panel), a column-header strip, MULTIPLE players, or otherwise is not a single clean player row. When false, still return the object but you may leave fields null/0.

Return a JSON object of the form {"players": [ ... ]} whose array has EXACTLY one object per image, in the SAME ORDER as the images.`,
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Here are ${strips.length} cropped player rows for ONE team, top-to-bottom. Return a JSON object {"players": [ ... ]} whose array has exactly ${strips.length} objects in the same order, each:
{
  "name": "Player Name",
  "user_id": "abc123",
  "position": "GK",
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
  "is_player_row": true
}`,
            },
            ...imageContents,
          ],
        },
      ],
      max_tokens: 4000,
      response_format: { type: "json_object" }, // guarantees syntactically valid JSON
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`OpenAI API error: ${err}`);
  }

  const data = await response.json();
  let jsonStr = (data.choices?.[0]?.message?.content || "").trim();
  if (jsonStr.startsWith("```json")) jsonStr = jsonStr.slice(7);
  else if (jsonStr.startsWith("```")) jsonStr = jsonStr.slice(3);
  if (jsonStr.endsWith("```")) jsonStr = jsonStr.slice(0, -3);

  let arr: any = parseLooseJson(jsonStr.trim());
  if (!Array.isArray(arr)) arr = arr.players || arr.rows || [];

  const num = (v: any) => (typeof v === "number" ? v : v == null ? 0 : (parseInt(String(v).replace(/[^0-9-]/g, "")) || 0));

  return (arr as any[]).map((p, i) => {
    const meta = strips[i] || { isSub: false, label: String(i + 1) };
    const subNumber = meta.isSub ? (parseInt(meta.label.replace(/\D/g, "")) || i + 1) : null;
    return {
      position: meta.isSub ? "" : (p.position ?? ""),
      name: p.name ?? "",
      user_id: p.user_id ?? null,
      level: p.level ?? null,
      overall_rating: p.overall_rating ?? null,
      ping: p.ping ?? null,
      score: num(p.score),
      passes: num(p.passes),
      key_passes: num(p.key_passes),
      assists: num(p.assists),
      shots: num(p.shots),
      shots_on_target: num(p.shots_on_target),
      goals: num(p.goals),
      tackles: num(p.tackles),
      key_tackles: num(p.key_tackles),
      interceptions: num(p.interceptions),
      key_interceptions: num(p.key_interceptions),
      possessions_lost: num(p.possessions_lost),
      gk_saves: num(p.gk_saves),
      gk_catches: num(p.gk_catches),
      is_starter: !meta.isSub,
      sub_number: subNumber,
      stats_incomplete: false,
      _strip: meta.dataUrl, // source row image, for the review UI
      _isPlayerRow: p.is_player_row !== false, // false ⇒ overview/summary/mixed crop
    };
  });
}

function normName(s: any): string {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

// how many strip players' names appear in a team's skeleton player list
function nameOverlap(stripPlayers: any[], teamPlayers: any[]): number {
  const set = new Set(teamPlayers.map((p) => normName(p.name)).filter(Boolean));
  let m = 0;
  for (const p of stripPlayers) {
    const n = normName(p.name);
    if (n && set.has(n)) m++;
  }
  return m;
}

// sum of non-zero detailed stats — distinguishes a real detailed panel from a
// basic overview lineup (which has no per-player detailed stats)
function statRichness(players: any[]): number {
  let s = 0;
  for (const p of players) {
    s += [p.passes, p.tackles, p.interceptions, p.possessions_lost, p.shots, p.gk_saves]
      .reduce((a: number, b: any) => a + (Number(b) || 0), 0);
  }
  return s;
}

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

  const { data: dbPlayersRaw } = await supabaseAdmin
    .from("players")
    .select("id, name, handle, game_user_id");

  const dbPlayers: DbPlayer[] = (dbPlayersRaw || []).map(p => ({
    id: p.id,
    name: p.name,
    handle: p.handle,
    game_user_id: p.game_user_id,
  }));

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

  const homeValidation = matchAllPlayers(homePlayers, dbPlayers);
  const awayValidation = matchAllPlayers(awayPlayers, dbPlayers);

  const validated = JSON.parse(JSON.stringify(extractedData));

  if (validated.home_team?.players) {
    validated.home_team.players = validated.home_team.players.map((p: any, i: number) => {
      const validation = homeValidation[i];
      return {
        ...p,
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
        _corrected_user_id: validation.confidence >= 60 && validation.matchedDbPlayer?.game_user_id
          ? validation.matchedDbPlayer.game_user_id
          : null,
      };
    });
  }

  const allValidations = [...homeValidation, ...awayValidation];
  const matchingSummary = getMatchingSummary(allValidations);

  return { validated, matchingSummary, homeValidation, awayValidation };
}

export async function POST(req: NextRequest) {
  const auth = requireAuth(req);
  if (!auth.ok) return json(401, { error: auth.error });

  try {
    const body = await req.json();
    const { images, stripSets } = body;

    if (!images || !Array.isArray(images) || images.length === 0) {
      return json(400, { error: "No images provided" });
    }

    // 1) Whole-image call: team-level stats, score, metadata, home/away identity
    //    and skeleton player names (used to assign strips to the right team).
    const extractedData = await extractDataWithOpenAI(images);

    // 2) Per-team strip calls: each cut player row is a separate image so the
    //    model can't mix one player's stats with another's. Overrides player
    //    stats; team-level stats stay from the whole-image call above.
    let strippedTeams = 0;
    if (Array.isArray(stripSets) && stripSets.length > 0) {
      const home = extractedData.home_team?.players || [];
      const away = extractedData.away_team?.players || [];

      // extract players for each set (one GPT-4o call per set / per team)
      const rawSets: any[][] = [];
      for (const set of stripSets) {
        const strips: StripMeta[] = (set?.strips || []).filter((s: any) => s?.dataUrl);
        if (strips.length === 0) continue;
        try {
          rawSets.push(await extractTeamPlayersFromStrips(strips));
        } catch (e) {
          console.error("Strip extraction failed for a set:", e);
        }
      }

      // Keep only sets that are a real single-team panel. The model flags each
      // crop as is_player_row, so a match-summary/overview image (mixed rows /
      // team-totals box → most rows flagged false) is rejected. Lenient: a real
      // panel just needs enough named rows and a player-row majority (so AI noise
      // on one or two rows doesn't drop a whole team).
      const sets = rawSets
        .filter((s) => {
          const named = s.filter((p) => p.name && String(p.name).trim()).length;
          const playerRows = s.filter((p) => p._isPlayerRow !== false).length;
          // named lineup + player-row majority + actual detailed stats present
          // (a score-only overview lineup has zero richness → rejected)
          return named >= 4 && playerRows >= Math.ceil(s.length / 2) && statRichness(s) > 0;
        })
        .sort((a, b) => statRichness(b) - statRichness(a));

      // Assign sets to teams. With TWO valid panels (the usual case) assign BOTH
      // by whichever orientation best matches the skeleton names — by elimination,
      // so a team still gets its strips even if its name match is weak. With one,
      // assign it to the better-matching team.
      let homeStripped = false, awayStripped = false;
      if (sets.length >= 2) {
        const a = sets[0], b = sets[1];
        const orientAB = nameOverlap(a, home) + nameOverlap(b, away);
        const orientBA = nameOverlap(b, home) + nameOverlap(a, away);
        const homeSet = orientAB >= orientBA ? a : b;
        const awaySet = orientAB >= orientBA ? b : a;
        if (extractedData.home_team) { extractedData.home_team.players = homeSet; homeStripped = true; }
        if (extractedData.away_team) { extractedData.away_team.players = awaySet; awayStripped = true; }
      } else if (sets.length === 1) {
        const s = sets[0];
        if (nameOverlap(s, home) >= nameOverlap(s, away)) {
          if (extractedData.home_team) { extractedData.home_team.players = s; homeStripped = true; }
        } else if (extractedData.away_team) {
          extractedData.away_team.players = s; awayStripped = true;
        }
      }
      strippedTeams = (homeStripped ? 1 : 0) + (awayStripped ? 1 : 0);

      // Detailed stats come ONLY from a real strip panel. A team WITHOUT one (e.g.
      // only the overview was uploaded for it) must be marked stats-incomplete so
      // the overview's score-only rows aren't imported as real zero stats.
      const markIncomplete = (players: any[]): any[] =>
        (players || []).map((p) => ({
          ...p,
          passes: null, key_passes: null, assists: null, shots: null,
          shots_on_target: null, goals: null, tackles: null, key_tackles: null,
          interceptions: null, key_interceptions: null, possessions_lost: null,
          gk_saves: null, gk_catches: null,
          stats_incomplete: true,
        }));
      if (!homeStripped && extractedData.home_team) {
        extractedData.home_team.players = markIncomplete(extractedData.home_team.players);
      }
      if (!awayStripped && extractedData.away_team) {
        extractedData.away_team.players = markIncomplete(extractedData.away_team.players);
      }
    }

    const { validated, matchingSummary, homeValidation, awayValidation } =
      await validateExtractedPlayers(extractedData);

    const allWarnings = [
      ...homeValidation.flatMap(v => v.warnings),
      ...awayValidation.flatMap(v => v.warnings),
    ];

    return json(200, {
      success: true,
      extracted: validated,
      imageCount: images.length,
      strippedTeams,
      hasDetailedStats: extractedData.has_detailed_stats,
      validation: {
        summary: matchingSummary,
        warnings: allWarnings,
        needsReview: matchingSummary.lowConfidence > 0 || matchingSummary.newPlayers > 0 || matchingSummary.withWarnings > 0,
      },
    });
  } catch (error: any) {
    console.error("Extraction error (TEST):", error);
    return json(500, {
      error: error.message || "Failed to extract match data",
    });
  }
}
