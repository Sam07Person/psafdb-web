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

// GET - List all teams
export async function GET(req: NextRequest) {
  const auth = requireAuth(req);
  if (!auth.ok) return json(401, { error: auth.error });

  if (!supabaseAdmin) return json(500, { error: "Server missing SUPABASE_SERVICE_ROLE_KEY" });

  const { data, error } = await supabaseAdmin
    .from("teams")
    .select("id,name,league_id,created_at,league:leagues(name)")
    .order("name", { ascending: true });

  if (error) return json(500, { error: error.message });

  return json(200, { teams: data });
}

// POST - Create new team
export async function POST(req: NextRequest) {
  const auth = requireAuth(req);
  if (!auth.ok) return json(401, { error: auth.error });

  if (!supabaseAdmin) return json(500, { error: "Server missing SUPABASE_SERVICE_ROLE_KEY" });

  const body = await req.json().catch(() => null);
  if (!body) return json(400, { error: "Invalid JSON body" });

  const { name, league_id } = body;
  if (!name || typeof name !== "string") return json(400, { error: "name is required" });

  const { data, error } = await supabaseAdmin
    .from("teams")
    .insert({
      name,
      league_id: league_id || null,
    })
    .select()
    .single();

  if (error) return json(500, { error: error.message });

  return json(201, { team: data });
}

// PUT - Update team
export async function PUT(req: NextRequest) {
  const auth = requireAuth(req);
  if (!auth.ok) return json(401, { error: auth.error });

  if (!supabaseAdmin) return json(500, { error: "Server missing SUPABASE_SERVICE_ROLE_KEY" });

  const body = await req.json().catch(() => null);
  if (!body) return json(400, { error: "Invalid JSON body" });

  const { id, name, league_id } = body;
  if (!id) return json(400, { error: "id is required" });
  if (!name || typeof name !== "string") return json(400, { error: "name is required" });

  const { data, error } = await supabaseAdmin
    .from("teams")
    .update({
      name,
      league_id: league_id || null,
    })
    .eq("id", id)
    .select()
    .single();

  if (error) return json(500, { error: error.message });

  return json(200, { team: data });
}

// DELETE - Delete team
export async function DELETE(req: NextRequest) {
  const auth = requireAuth(req);
  if (!auth.ok) return json(401, { error: auth.error });

  if (!supabaseAdmin) return json(500, { error: "Server missing SUPABASE_SERVICE_ROLE_KEY" });

  const body = await req.json().catch(() => null);
  if (!body) return json(400, { error: "Invalid JSON body" });

  const { id } = body;
  if (!id) return json(400, { error: "id is required" });

  const { error } = await supabaseAdmin
    .from("teams")
    .delete()
    .eq("id", id);

  if (error) return json(500, { error: error.message });

  return json(200, { ok: true });
}