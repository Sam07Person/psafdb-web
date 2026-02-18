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

async function extractTeamsWithOpenAI(base64Image: string) {
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
          content: `You are a data extraction assistant. Extract team names from leaderboard/standings screenshots.
Return ONLY a JSON array of team names, nothing else. No markdown formatting.
Example: ["Team A", "Team B", "Team C"]`,
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Extract all team names from this leaderboard/standings image. Return only a JSON array of team name strings.",
            },
            {
              type: "image_url",
              image_url: { url: base64Image },
            },
          ],
        },
      ],
      max_tokens: 2000,
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

  return JSON.parse(jsonStr.trim()) as string[];
}

export async function POST(req: NextRequest) {
  const auth = requireAuth(req);
  if (!auth.ok) return json(401, { error: auth.error });

  if (!supabaseAdmin) return json(500, { error: "Server missing SUPABASE_SERVICE_ROLE_KEY" });

  const logs: string[] = [];
  const errors: string[] = [];

  try {
    const body = await req.json();
    const { image, league_id } = body;

    if (!image) {
      return json(400, { error: "No image provided" });
    }

    logs.push("Extracting team names from image...");

    const teamNames = await extractTeamsWithOpenAI(image);
    logs.push(`Found ${teamNames.length} teams: ${teamNames.join(", ")}`);

    const teamsCreated: string[] = [];
    const teamsExisting: string[] = [];
    const teamsLinked: string[] = [];

    for (const teamName of teamNames) {
      // Check if team exists
      const { data: existing, error: findError } = await supabaseAdmin
        .from("teams")
        .select("id, name, league_id")
        .eq("name", teamName)
        .maybeSingle();

      if (findError) {
        errors.push(`Error finding team ${teamName}: ${findError.message}`);
        continue;
      }

      let teamId: string;

      if (existing) {
        teamId = existing.id;
        teamsExisting.push(teamName);
        logs.push(`Team exists: ${teamName}`);
      } else {
        // Create new team with primary league_id
        const { data: newTeam, error: createError } = await supabaseAdmin
          .from("teams")
          .insert({ name: teamName, league_id: league_id || null })
          .select("id")
          .single();

        if (createError) {
          errors.push(`Error creating team ${teamName}: ${createError.message}`);
          continue;
        }

        teamId = newTeam.id;
        teamsCreated.push(teamName);
        logs.push(`Created team: ${teamName}`);
      }

      // Add to team_leagues junction table if league specified
      if (league_id) {
        const { error: linkError } = await supabaseAdmin
          .from("team_leagues")
          .upsert(
            { team_id: teamId, league_id: league_id },
            { onConflict: "team_id,league_id" }
          );

        if (linkError) {
          logs.push(`Note: Could not link ${teamName} to league: ${linkError.message}`);
        } else {
          if (existing) {
            teamsLinked.push(teamName);
          }
          logs.push(`Linked ${teamName} to league`);
        }
      }
    }

    return json(201, {
      success: errors.length === 0,
      extracted: teamNames,
      stats: {
        total: teamNames.length,
        created: teamsCreated.length,
        existing: teamsExisting.length,
        linked: teamsLinked.length,
        teamsCreated,
        teamsExisting,
        teamsLinked,
      },
      errors: errors.length > 0 ? errors : null,
      logs,
    });
  } catch (error: any) {
    console.error("Import teams error:", error);
    return json(500, {
      error: error.message || "Failed to import teams",
      errors,
      logs,
    });
  }
}