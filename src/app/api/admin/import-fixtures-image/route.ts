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

// Levenshtein distance for fuzzy matching
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

// Find best matching team
function findBestTeamMatch(
  searchName: string, 
  teams: { id: string; name: string }[],
  logs: string[]
): { id: string; name: string; score: number } | null {
  if (!searchName || teams.length === 0) return null;

  const normalizedSearch = searchName.toLowerCase().trim()
    .replace(/^@/, '') // Remove @ prefix
    .replace(/fc$/i, '').replace(/^fc/i, '') // Remove FC
    .trim();

  let bestMatch: { id: string; name: string; score: number } | null = null;

  for (const team of teams) {
    const normalizedTeam = team.name.toLowerCase().trim()
      .replace(/fc$/i, '').replace(/^fc/i, '')
      .trim();

    // Exact match
    if (normalizedSearch === normalizedTeam) {
      return { ...team, score: 0 };
    }

    // Check if one contains the other
    if (normalizedSearch.includes(normalizedTeam) || normalizedTeam.includes(normalizedSearch)) {
      const score = Math.abs(normalizedSearch.length - normalizedTeam.length);
      if (!bestMatch || score < bestMatch.score) {
        bestMatch = { ...team, score };
      }
      continue;
    }

    // Levenshtein distance
    const distance = levenshteinDistance(normalizedSearch, normalizedTeam);
    const maxLen = Math.max(normalizedSearch.length, normalizedTeam.length);
    const similarity = 1 - (distance / maxLen);

    // Only consider matches with >50% similarity
    if (similarity > 0.5) {
      const score = distance;
      if (!bestMatch || score < bestMatch.score) {
        bestMatch = { ...team, score };
      }
    }
  }

  return bestMatch;
}

// Find best matching league
function findBestLeagueMatch(searchName: string, leagues: { id: string; name: string; season: string | null }[]): { id: string; name: string; season: string | null; score: number } | null {
  if (!searchName || leagues.length === 0) return null;

  const normalizedSearch = searchName.toLowerCase().trim();

  let bestMatch: { id: string; name: string; season: string | null; score: number } | null = null;

  for (const league of leagues) {
    const normalizedLeague = league.name.toLowerCase().trim();

    // Exact match
    if (normalizedSearch === normalizedLeague) {
      return { ...league, score: 0 };
    }

    // Check if one contains the other
    if (normalizedSearch.includes(normalizedLeague) || normalizedLeague.includes(normalizedSearch)) {
      const score = Math.abs(normalizedSearch.length - normalizedLeague.length);
      if (!bestMatch || score < bestMatch.score) {
        bestMatch = { ...league, score };
      }
      continue;
    }

    // Levenshtein distance
    const distance = levenshteinDistance(normalizedSearch, normalizedLeague);
    const maxLen = Math.max(normalizedSearch.length, normalizedLeague.length);
    const similarity = 1 - (distance / maxLen);

    if (similarity > 0.5) {
      const score = distance;
      if (!bestMatch || score < bestMatch.score) {
        bestMatch = { ...league, score };
      }
    }
  }

  return bestMatch;
}

async function extractFixturesWithOpenAI(base64Image: string) {
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) throw new Error("OPENAI_API_KEY not configured");

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
          content: `You are a data extraction assistant. Extract football/soccer fixture information from Discord screenshots.

The screenshots show fixture announcements with:
- League name (e.g., "Conference Division Green", "Premier League")
- Day/Round number (e.g., "Day 3", "Day 1")
- Match date and time (always in UK timezone)
- Two teams per fixture (often with @ mentions)

Return ONLY valid JSON with no markdown formatting.`,
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Extract all fixtures from this screenshot. Return JSON in this exact format:
{
  "league_name": "Conference Division Green",
  "day": 3,
  "fixtures": [
    {
      "home_team": "Galatasaray SK",
      "away_team": "Borazanspor",
      "date": "2026-02-19",
      "time": "17:00",
      "stage": "group"
    },
    {
      "home_team": "Szot United",
      "away_team": "Velocita FC",
      "date": "2026-02-19",
      "time": "17:30",
      "stage": "group"
    }
  ]
}

Notes:
- Extract the league name from the header (e.g., "Conference Division Green", "Premier League")
- Extract the day/round number (e.g., "Day 3" → 3, "Day 1" → 1)
- Remove @ symbols from team names
- Date format: YYYY-MM-DD
- Time format: HH:MM (24-hour, UK timezone)
- Stage is usually "group" for league matches, or "knockout", "semi", "final" etc.
- If score is shown (e.g., "? : ?"), it means the match hasn't been played yet`,
            },
            {
              type: "image_url",
              image_url: { url: base64Image },
            },
          ],
        },
      ],
      max_tokens: 4000,
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

export async function POST(req: NextRequest) {
  const auth = requireAuth(req);
  if (!auth.ok) return json(401, { error: auth.error });

  if (!supabaseAdmin) return json(500, { error: "Server missing SUPABASE_SERVICE_ROLE_KEY" });

  const logs: string[] = [];
  const errors: string[] = [];

  try {
    const body = await req.json();
    const { image } = body;

    if (!image) {
      return json(400, { error: "No image provided" });
    }

    logs.push("Extracting fixtures from image...");

    // Extract data with AI
    const extractedData = await extractFixturesWithOpenAI(image);
    logs.push(`Extracted: League="${extractedData.league_name}", Day=${extractedData.day}, Fixtures=${extractedData.fixtures?.length || 0}`);

    // Fetch all teams for matching
    const { data: allTeams } = await supabaseAdmin
      .from("teams")
      .select("id, name");

    const teams = allTeams || [];
    logs.push(`Loaded ${teams.length} teams for matching`);

    // Fetch all leagues for matching
    const { data: allLeagues } = await supabaseAdmin
      .from("leagues")
      .select("id, name, season");

    const leagues = allLeagues || [];
    logs.push(`Loaded ${leagues.length} leagues for matching`);

    // Find the league
    const leagueMatch = findBestLeagueMatch(extractedData.league_name, leagues);
    if (!leagueMatch) {
      return json(400, {
        error: `Could not find a matching league for "${extractedData.league_name}". Please create the league first.`,
        extracted: extractedData,
        logs,
      });
    }
    logs.push(`Matched league: "${extractedData.league_name}" → "${leagueMatch.name}" (${leagueMatch.id})`);

    // Get teams that belong to this league (via team_leagues junction table or direct league_id)
    const { data: leagueTeamsJunction } = await supabaseAdmin
      .from("team_leagues")
      .select("team_id")
      .eq("league_id", leagueMatch.id);

    const { data: leagueTeamsDirect } = await supabaseAdmin
      .from("teams")
      .select("id")
      .eq("league_id", leagueMatch.id);

    // Combine both sources of league teams
    const leagueTeamIds = new Set<string>();
    (leagueTeamsJunction || []).forEach(t => leagueTeamIds.add(t.team_id));
    (leagueTeamsDirect || []).forEach(t => leagueTeamIds.add(t.id));

    // Filter to only teams in this league
    const leagueTeams = teams.filter(t => leagueTeamIds.has(t.id));
    logs.push(`Found ${leagueTeams.length} teams in league "${leagueMatch.name}"`);

    // Track which teams have been matched (for deduction logic)
    const matchedTeamIds = new Set<string>();

    // First pass: try to match all teams and track which ones succeed
    const fixturesWithMatches: Array<{
      fixture: any;
      homeMatch: { id: string; name: string } | null;
      awayMatch: { id: string; name: string } | null;
    }> = [];

    for (const fixture of extractedData.fixtures || []) {
      // Try to find matches in league teams first, then fall back to all teams
      let homeTeamMatch = findBestTeamMatch(fixture.home_team, leagueTeams, logs);
      if (!homeTeamMatch) {
        homeTeamMatch = findBestTeamMatch(fixture.home_team, teams, logs);
      }

      let awayTeamMatch = findBestTeamMatch(fixture.away_team, leagueTeams, logs);
      if (!awayTeamMatch) {
        awayTeamMatch = findBestTeamMatch(fixture.away_team, teams, logs);
      }

      if (homeTeamMatch) matchedTeamIds.add(homeTeamMatch.id);
      if (awayTeamMatch) matchedTeamIds.add(awayTeamMatch.id);

      fixturesWithMatches.push({
        fixture,
        homeMatch: homeTeamMatch ? { id: homeTeamMatch.id, name: homeTeamMatch.name } : null,
        awayMatch: awayTeamMatch ? { id: awayTeamMatch.id, name: awayTeamMatch.name } : null,
      });
    }

    // Find unmatched teams in the league (for deduction)
    const unmatchedLeagueTeams = leagueTeams.filter(t => !matchedTeamIds.has(t.id));
    logs.push(`Unmatched teams in league: ${unmatchedLeagueTeams.length} (${unmatchedLeagueTeams.map(t => t.name).join(", ")})`);

    // Second pass: apply deduction logic for unmatched teams
    const fixturesCreated: any[] = [];
    const fixturesSkipped: any[] = [];

    for (const { fixture, homeMatch, awayMatch } of fixturesWithMatches) {
      let finalHomeMatch = homeMatch;
      let finalAwayMatch = awayMatch;

      // Deduction logic: if one team not found and only one unmatched team remains
      if (!finalHomeMatch && finalAwayMatch && unmatchedLeagueTeams.length === 1) {
        const deducedTeam = unmatchedLeagueTeams[0];
        finalHomeMatch = { id: deducedTeam.id, name: deducedTeam.name };
        logs.push(`🔮 Deduced home team: "${fixture.home_team}" → "${deducedTeam.name}" (only unmatched team in league)`);
        // Remove from unmatched list
        unmatchedLeagueTeams.splice(0, 1);
      }

      if (!finalAwayMatch && finalHomeMatch && unmatchedLeagueTeams.length === 1) {
        const deducedTeam = unmatchedLeagueTeams[0];
        finalAwayMatch = { id: deducedTeam.id, name: deducedTeam.name };
        logs.push(`🔮 Deduced away team: "${fixture.away_team}" → "${deducedTeam.name}" (only unmatched team in league)`);
        // Remove from unmatched list
        unmatchedLeagueTeams.splice(0, 1);
      }

      // Check if we still have missing teams
      if (!finalHomeMatch) {
        errors.push(`Could not find team: "${fixture.home_team}"`);
        fixturesSkipped.push({ ...fixture, reason: `Home team not found: ${fixture.home_team}` });
        continue;
      }
      logs.push(`Matched home team: "${fixture.home_team}" → "${finalHomeMatch.name}"`);

      if (!finalAwayMatch) {
        errors.push(`Could not find team: "${fixture.away_team}"`);
        fixturesSkipped.push({ ...fixture, reason: `Away team not found: ${fixture.away_team}` });
        continue;
      }
      logs.push(`Matched away team: "${fixture.away_team}" → "${finalAwayMatch.name}"`);

      // Parse date and time (UK timezone)
      let playedAt: string;
      try {
        const dateTimeStr = `${fixture.date}T${fixture.time}:00`;
        const ukDate = new Date(dateTimeStr + "+00:00");
        playedAt = ukDate.toISOString();
      } catch (e) {
        errors.push(`Invalid date/time for ${fixture.home_team} vs ${fixture.away_team}`);
        fixturesSkipped.push({ ...fixture, reason: "Invalid date/time" });
        continue;
      }

      // Check if fixture already exists
      const { data: existing } = await supabaseAdmin
        .from("matches")
        .select("id")
        .eq("league_id", leagueMatch.id)
        .eq("home_team", finalHomeMatch.name)
        .eq("away_team", finalAwayMatch.name)
        .maybeSingle();

      if (existing) {
        logs.push(`Fixture already exists: ${finalHomeMatch.name} vs ${finalAwayMatch.name}`);
        fixturesSkipped.push({ ...fixture, reason: "Already exists" });
        continue;
      }

      // Create the fixture
      const { data: newMatch, error: insertError } = await supabaseAdmin
        .from("matches")
        .insert({
          league_id: leagueMatch.id,
          home_team: finalHomeMatch.name,
          away_team: finalAwayMatch.name,
          played_at: playedAt,
          home_score: null,
          away_score: null,
          day: extractedData.day || null,
          stage: fixture.stage || "group",
        })
        .select()
        .single();

      if (insertError) {
        errors.push(`Failed to create fixture ${finalHomeMatch.name} vs ${finalAwayMatch.name}: ${insertError.message}`);
        fixturesSkipped.push({ ...fixture, reason: insertError.message });
      } else {
        fixturesCreated.push({
          id: newMatch.id,
          home_team: finalHomeMatch.name,
          away_team: finalAwayMatch.name,
          played_at: playedAt,
          day: extractedData.day,
        });
        logs.push(`Created fixture: ${finalHomeMatch.name} vs ${finalAwayMatch.name}`);
      }
    }

    return json(201, {
      success: errors.length === 0,
      extracted: extractedData,
      league: {
        id: leagueMatch.id,
        name: leagueMatch.name,
      },
      stats: {
        total: extractedData.fixtures?.length || 0,
        created: fixturesCreated.length,
        skipped: fixturesSkipped.length,
        teamsInLeague: leagueTeams.length,
      },
      fixturesCreated,
      fixturesSkipped,
      errors: errors.length > 0 ? errors : null,
      logs,
    });
  } catch (error: any) {
    console.error("Import fixtures error:", error);
    return json(500, {
      error: error.message || "Failed to import fixtures",
      errors,
      logs,
    });
  }
}