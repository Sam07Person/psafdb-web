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

// GET - List all players
export async function GET(req: NextRequest) {
  const auth = requireAuth(req);
  if (!auth.ok) return json(401, { error: auth.error });

  if (!supabaseAdmin) return json(500, { error: "Server missing SUPABASE_SERVICE_ROLE_KEY" });

  const { data, error } = await supabaseAdmin
    .from("players")
    .select("id,name,handle,game_user_id,created_at")
    .order("name", { ascending: true });

  if (error) return json(500, { error: error.message });

  return json(200, { players: data });
}

// POST - Create new player
export async function POST(req: NextRequest) {
  const auth = requireAuth(req);
  if (!auth.ok) return json(401, { error: auth.error });

  if (!supabaseAdmin) return json(500, { error: "Server missing SUPABASE_SERVICE_ROLE_KEY" });

  const body = await req.json().catch(() => null);
  if (!body) return json(400, { error: "Invalid JSON body" });

  const { name, handle, game_user_id } = body;
  if (!name && !handle && !game_user_id) {
    return json(400, { error: "At least one of name, handle, or game_user_id is required" });
  }

  const { data, error } = await supabaseAdmin
    .from("players")
    .insert({
      name: name || null,
      handle: handle || null,
      game_user_id: game_user_id || null,
    })
    .select()
    .single();

  if (error) return json(500, { error: error.message });

  return json(201, { player: data });
}

// PUT - Update player
export async function PUT(req: NextRequest) {
  const auth = requireAuth(req);
  if (!auth.ok) return json(401, { error: auth.error });

  if (!supabaseAdmin) return json(500, { error: "Server missing SUPABASE_SERVICE_ROLE_KEY" });

  const body = await req.json().catch(() => null);
  if (!body) return json(400, { error: "Invalid JSON body" });

  const { id, name, handle, game_user_id } = body;
  if (!id) return json(400, { error: "id is required" });

  const { data, error } = await supabaseAdmin
    .from("players")
    .update({
      name: name || null,
      handle: handle || null,
      game_user_id: game_user_id || null,
    })
    .eq("id", id)
    .select()
    .single();

  if (error) return json(500, { error: error.message });

  return json(200, { player: data });
}

// DELETE - Delete player
export async function DELETE(req: NextRequest) {
  const auth = requireAuth(req);
  if (!auth.ok) return json(401, { error: auth.error });

  if (!supabaseAdmin) return json(500, { error: "Server missing SUPABASE_SERVICE_ROLE_KEY" });

  const body = await req.json().catch(() => null);
  if (!body) return json(400, { error: "Invalid JSON body" });

  const { id } = body;
  if (!id) return json(400, { error: "id is required" });

  const { error } = await supabaseAdmin
    .from("players")
    .delete()
    .eq("id", id);

  if (error) return json(500, { error: error.message });

  return json(200, { ok: true });
}