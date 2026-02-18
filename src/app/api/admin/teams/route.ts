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

// GET - List all teams with their leagues
export async function GET(req: NextRequest) {
  const auth = requireAuth(req);
  if (!auth.ok) return json(401, { error: auth.error });

  if (!supabaseAdmin) return json(500, { error: "Server missing SUPABASE_SERVICE_ROLE_KEY" });

  // Get teams with their primary league
  const { data: teamsData, error: teamsError } = await supabaseAdmin
    .from("teams")
    .select(`
      id,
      name,
      league_id,
      created_at,
      league:leagues!teams_league_id_fkey(id, name, season)
    `)
    .order("name", { ascending: true });

  if (teamsError) {
    console.error("Error fetching teams:", teamsError);
    return json(500, { error: teamsError.message });
  }

  // Get all team_leagues relationships
  const { data: teamLeaguesData } = await supabaseAdmin
    .from("team_leagues")
    .select(`
      team_id,
      league_id,
      league:leagues(id, name, season)
    `);

  // Build a map of team_id -> leagues
  const teamLeaguesMap: Record<string, any[]> = {};
  for (const tl of teamLeaguesData || []) {
    if (!teamLeaguesMap[tl.team_id]) {
      teamLeaguesMap[tl.team_id] = [];
    }
    const league = Array.isArray(tl.league) ? tl.league[0] : tl.league;
    if (league) {
      teamLeaguesMap[tl.team_id].push(league);
    }
  }

  // Combine teams with their leagues
  const teams = (teamsData || []).map((t: any) => {
    const primaryLeague = Array.isArray(t.league) ? t.league[0] : t.league;
    const additionalLeagues = teamLeaguesMap[t.id] || [];
    
    // Combine primary league with additional leagues, removing duplicates
    const allLeagues = primaryLeague 
      ? [primaryLeague, ...additionalLeagues.filter(l => l.id !== primaryLeague.id)]
      : additionalLeagues;

    return {
      ...t,
      league: primaryLeague,
      leagues: allLeagues,
      league_ids: allLeagues.map((l: any) => l.id),
    };
  });

  return json(200, { teams });
}

// POST - Create a new team
export async function POST(req: NextRequest) {
  const auth = requireAuth(req);
  if (!auth.ok) return json(401, { error: auth.error });

  if (!supabaseAdmin) return json(500, { error: "Server missing SUPABASE_SERVICE_ROLE_KEY" });

  try {
    const body = await req.json();
    const { name, league_id, league_ids } = body;

    if (!name) {
      return json(400, { error: "Team name is required" });
    }

    // Use first league_id as primary, or from league_ids array
    const primaryLeagueId = league_id || (league_ids && league_ids[0]) || null;

    const { data: team, error } = await supabaseAdmin
      .from("teams")
      .insert({ name, league_id: primaryLeagueId })
      .select()
      .single();

    if (error) {
      return json(500, { error: error.message });
    }

    // Add to team_leagues junction table for all leagues
    const leaguesToAdd = league_ids || (league_id ? [league_id] : []);
    if (leaguesToAdd.length > 0) {
      const teamLeagueInserts = leaguesToAdd.map((lid: string) => ({
        team_id: team.id,
        league_id: lid,
      }));

      await supabaseAdmin
        .from("team_leagues")
        .upsert(teamLeagueInserts, { onConflict: "team_id,league_id" });
    }

    return json(201, { team });
  } catch (err: any) {
    return json(500, { error: err.message });
  }
}

// PUT - Update a team
export async function PUT(req: NextRequest) {
  const auth = requireAuth(req);
  if (!auth.ok) return json(401, { error: auth.error });

  if (!supabaseAdmin) return json(500, { error: "Server missing SUPABASE_SERVICE_ROLE_KEY" });

  try {
    const body = await req.json();
    const { id, name, league_id, league_ids } = body;

    if (!id) {
      return json(400, { error: "Team ID is required" });
    }

    // Use first league_id as primary
    const primaryLeagueId = league_id || (league_ids && league_ids[0]) || null;

    const { data: team, error } = await supabaseAdmin
      .from("teams")
      .update({ name, league_id: primaryLeagueId })
      .eq("id", id)
      .select()
      .single();

    if (error) {
      return json(500, { error: error.message });
    }

    // Update team_leagues: delete old, insert new
    if (league_ids !== undefined) {
      // Delete existing relationships
      await supabaseAdmin
        .from("team_leagues")
        .delete()
        .eq("team_id", id);

      // Insert new relationships
      if (league_ids.length > 0) {
        const teamLeagueInserts = league_ids.map((lid: string) => ({
          team_id: id,
          league_id: lid,
        }));

        await supabaseAdmin
          .from("team_leagues")
          .insert(teamLeagueInserts);
      }
    }

    return json(200, { team });
  } catch (err: any) {
    return json(500, { error: err.message });
  }
}

// DELETE - Delete a team
export async function DELETE(req: NextRequest) {
  const auth = requireAuth(req);
  if (!auth.ok) return json(401, { error: auth.error });

  if (!supabaseAdmin) return json(500, { error: "Server missing SUPABASE_SERVICE_ROLE_KEY" });

  try {
    const body = await req.json();
    const { id } = body;

    if (!id) {
      return json(400, { error: "Team ID is required" });
    }

    // team_leagues will be deleted automatically due to CASCADE
    const { error } = await supabaseAdmin
      .from("teams")
      .delete()
      .eq("id", id);

    if (error) {
      return json(500, { error: error.message });
    }

    return json(200, { success: true });
  } catch (err: any) {
    return json(500, { error: err.message });
  }
}