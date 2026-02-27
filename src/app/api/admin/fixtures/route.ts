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
    return { ok: false as const, error: "Invalid admin password or token" };
  }

  const expected = process.env.ADMIN_IMPORT_TOKEN;
  if (!expected) return { ok: false as const, error: "Server configuration error" };

  const auth = req.headers.get("authorization") || "";
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (!token || token !== expected) return { ok: false as const, error: "Invalid admin password or token" };

  return { ok: true as const };
}

// GET - List all fixtures (matches)
export async function GET(req: NextRequest) {
  const auth = requireAuth(req);
  if (!auth.ok) return json(401, { error: auth.error });

  if (!supabaseAdmin) return json(500, { error: "Server missing SUPABASE_SERVICE_ROLE_KEY" });

  // Try with stage and group_name columns
  const result = await supabaseAdmin
    .from("matches")
    .select("id,league_id,played_at,home_team,away_team,home_score,away_score,stage,group_name,day,forfeited_by,league:leagues(name)")
    .order("played_at", { ascending: false });

  // If stage/group_name don't exist, fall back
  if (result.error) {
    const fallbackResult = await supabaseAdmin
      .from("matches")
      .select("id,league_id,played_at,home_team,away_team,home_score,away_score,league:leagues(name)")
      .order("played_at", { ascending: false });

    if (fallbackResult.error) return json(500, { error: fallbackResult.error.message });

    // Add null stage/group_name to match expected shape
    const fixtures = (fallbackResult.data || []).map((f: any) => ({
      ...f,
      stage: null,
      group_name: null,
    }));

    return json(200, { fixtures });
  }

  return json(200, { fixtures: result.data });
}

// POST - Create new fixture
export async function POST(req: NextRequest) {
  const auth = requireAuth(req);
  if (!auth.ok) return json(401, { error: auth.error });

  if (!supabaseAdmin) return json(500, { error: "Server missing SUPABASE_SERVICE_ROLE_KEY" });

  const body = await req.json().catch(() => null);
  if (!body) return json(400, { error: "Invalid JSON body" });

  const { league_id, played_at, home_team, away_team, home_score, away_score, stage, group_name } = body;

  if (!played_at) return json(400, { error: "played_at is required" });
  if (!home_team) return json(400, { error: "home_team is required" });
  if (!away_team) return json(400, { error: "away_team is required" });

  // Build insert object conditionally to avoid issues if columns don't exist
  const insertData: Record<string, any> = {
    league_id: league_id || null,
    played_at,
    home_team,
    away_team,
    home_score: home_score !== null && home_score !== undefined ? home_score : null,
    away_score: away_score !== null && away_score !== undefined ? away_score : null,
  };

  // Try with stage and group_name
  if (stage !== undefined) insertData.stage = stage || null;
  if (group_name !== undefined) insertData.group_name = group_name || null;

  const { data, error } = await supabaseAdmin
    .from("matches")
    .insert({
      league_id: body.league_id || null,
      played_at: body.played_at,
      home_team: body.home_team,
      away_team: body.away_team,
      home_score: body.home_score ?? null,
      away_score: body.away_score ?? null,
      stage: body.stage || null,
      group_name: body.group_name || null,
      day: body.day ?? null,
      forfeited_by: body.forfeited_by ?? null,
    })
    .select()
    .single();

  if (error) {
    // If error might be due to missing columns, try without stage/group_name
    if (error.message.includes("stage") || error.message.includes("group_name")) {
      const basicInsert = {
        league_id: league_id || null,
        played_at,
        home_team,
        away_team,
        home_score: home_score !== null && home_score !== undefined ? home_score : null,
        away_score: away_score !== null && away_score !== undefined ? away_score : null,
      };

      const retryResult = await supabaseAdmin
        .from("matches")
        .insert(basicInsert)
        .select()
        .single();

      if (retryResult.error) return json(500, { error: retryResult.error.message });
      return json(201, { fixture: retryResult.data });
    }
    return json(500, { error: error.message });
  }

  return json(201, { fixture: data });
}

// PUT - Update fixture
export async function PUT(req: NextRequest) {
  const auth = requireAuth(req);
  if (!auth.ok) return json(401, { error: auth.error });

  if (!supabaseAdmin) return json(500, { error: "Server missing SUPABASE_SERVICE_ROLE_KEY" });

  const body = await req.json().catch(() => null);
  if (!body) return json(400, { error: "Invalid JSON body" });

  const { id, league_id, played_at, home_team, away_team, home_score, away_score, stage, group_name } = body;

  if (!id) return json(400, { error: "id is required" });
  if (!played_at) return json(400, { error: "played_at is required" });
  if (!home_team) return json(400, { error: "home_team is required" });
  if (!away_team) return json(400, { error: "away_team is required" });

  // Build update object
  const updateData: Record<string, any> = {
    league_id: league_id || null,
    played_at,
    home_team,
    away_team,
    home_score: home_score !== null && home_score !== undefined ? home_score : null,
    away_score: away_score !== null && away_score !== undefined ? away_score : null,
  };

  if (stage !== undefined) updateData.stage = stage || null;
  if (group_name !== undefined) updateData.group_name = group_name || null;

  const { data, error } = await supabaseAdmin
    .from("matches")
    .update({
      league_id: body.league_id || null,
      played_at: body.played_at,
      home_team: body.home_team,
      away_team: body.away_team,
      home_score: body.home_score ?? null,
      away_score: body.away_score ?? null,
      stage: body.stage || null,
      group_name: body.group_name || null,
      day: body.day ?? null,
      forfeited_by: body.forfeited_by ?? null,
    })
    .eq("id", body.id)
    .select()
    .single();

  if (error) {
    // If error might be due to missing columns, try without stage/group_name
    if (error.message.includes("stage") || error.message.includes("group_name")) {
      const basicUpdate = {
        league_id: league_id || null,
        played_at,
        home_team,
        away_team,
        home_score: home_score !== null && home_score !== undefined ? home_score : null,
        away_score: away_score !== null && away_score !== undefined ? away_score : null,
      };

      const retryResult = await supabaseAdmin
        .from("matches")
        .update(basicUpdate)
        .eq("id", id)
        .select()
        .single();

      if (retryResult.error) return json(500, { error: retryResult.error.message });
      return json(200, { fixture: retryResult.data });
    }
    return json(500, { error: error.message });
  }

  return json(200, { fixture: data });
}

// PATCH - Set forfeit on a fixture
export async function PATCH(req: NextRequest) {
  const auth = requireAuth(req);
  if (!auth.ok) return json(401, { error: auth.error });

  if (!supabaseAdmin) return json(500, { error: "Server missing SUPABASE_SERVICE_ROLE_KEY" });

  const body = await req.json().catch(() => null);
  if (!body) return json(400, { error: "Invalid JSON body" });

  const { id, forfeited_by } = body;
  if (!id) return json(400, { error: "id is required" });

  // forfeited_by must be "home", "away", or null
  if (forfeited_by !== "home" && forfeited_by !== "away" && forfeited_by !== null) {
    return json(400, { error: "forfeited_by must be 'home', 'away', or null" });
  }

  const { data, error } = await supabaseAdmin
    .from("matches")
    .update({ forfeited_by })
    .eq("id", id)
    .select()
    .single();

  if (error) return json(500, { error: error.message });

  return json(200, { fixture: data });
}

// DELETE - Delete fixture
export async function DELETE(req: NextRequest) {
  const auth = requireAuth(req);
  if (!auth.ok) return json(401, { error: auth.error });

  if (!supabaseAdmin) return json(500, { error: "Server missing SUPABASE_SERVICE_ROLE_KEY" });

  const body = await req.json().catch(() => null);
  if (!body) return json(400, { error: "Invalid JSON body" });

  const { id } = body;
  if (!id) return json(400, { error: "id is required" });

  // Also delete related stats
  await supabaseAdmin.from("match_team_stats").delete().eq("match_id", id);
  await supabaseAdmin.from("match_player_stats").delete().eq("match_id", id);

  const { error } = await supabaseAdmin
    .from("matches")
    .delete()
    .eq("id", id);

  if (error) return json(500, { error: error.message });

  return json(200, { ok: true });
}