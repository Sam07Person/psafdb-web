import { NextRequest, NextResponse } from "next/server";
import { revalidateContent } from "@/lib/revalidate";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireImportAuth } from "@/lib/importAuth";

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

export async function GET(req: NextRequest) {
  // Staff (match-import) may read players for name matching; mutations stay admin-only.
  const auth = requireImportAuth(req);
  if (!auth.ok) return json(401, { error: auth.error });

  if (!supabaseAdmin) return json(500, { error: "Server missing SUPABASE_SERVICE_ROLE_KEY" });

  const { data, error } = await supabaseAdmin
    .from("players")
    .select("id,name,handle,game_user_id,discord_id,created_at")
    .order("name", { ascending: true });

  if (error) return json(500, { error: error.message });

  return json(200, { players: data });
}

async function postHandler(req: NextRequest) {
  const auth = requireAuth(req);
  if (!auth.ok) return json(401, { error: auth.error });

  if (!supabaseAdmin) return json(500, { error: "Server missing SUPABASE_SERVICE_ROLE_KEY" });

  const body = await req.json().catch(() => null);
  if (!body) return json(400, { error: "Invalid JSON body" });

  const { name, handle, game_user_id, discord_id } = body;
  if (!name && !handle && !game_user_id) {
    return json(400, { error: "At least one of name, handle, or game_user_id is required" });
  }

  const { data, error } = await supabaseAdmin
    .from("players")
    .insert({
      name: name || null,
      handle: handle || null,
      game_user_id: game_user_id || null,
      discord_id: discord_id || null,
    })
    .select()
    .single();

  if (error) return json(500, { error: error.message });

  return json(201, { player: data });
}

async function putHandler(req: NextRequest) {
  const auth = requireAuth(req);
  if (!auth.ok) return json(401, { error: auth.error });

  if (!supabaseAdmin) return json(500, { error: "Server missing SUPABASE_SERVICE_ROLE_KEY" });

  const body = await req.json().catch(() => null);
  if (!body) return json(400, { error: "Invalid JSON body" });

  const { id, name, handle, game_user_id, discord_id } = body;
  if (!id) return json(400, { error: "id is required" });

  const { data, error } = await supabaseAdmin
    .from("players")
    .update({
      name: name || null,
      handle: handle || null,
      game_user_id: game_user_id || null,
      discord_id: discord_id || null,
    })
    .eq("id", id)
    .select()
    .single();

  if (error) return json(500, { error: error.message });

  return json(200, { player: data });
}

async function patchHandler(req: NextRequest) {
  const auth = requireAuth(req);
  if (!auth.ok) return json(401, { error: auth.error });

  if (!supabaseAdmin) return json(500, { error: "Server missing SUPABASE_SERVICE_ROLE_KEY" });

  const body = await req.json().catch(() => null);
  if (!body) return json(400, { error: "Invalid JSON body" });

  const { sourceId, targetId } = body;
  if (!sourceId || !targetId) return json(400, { error: "sourceId and targetId are required" });
  if (sourceId === targetId) return json(400, { error: "Source and target players must be different" });

  const { data: sourcePlayer, error: sourceError } = await supabaseAdmin
    .from("players")
    .select("id")
    .eq("id", sourceId)
    .single();

  if (sourceError || !sourcePlayer) return json(404, { error: "Source player not found" });

  const { data: targetPlayer, error: targetError } = await supabaseAdmin
    .from("players")
    .select("id")
    .eq("id", targetId)
    .single();

  if (targetError || !targetPlayer) return json(404, { error: "Target player not found" });

  const { data: statsToTransfer, error: statsError } = await supabaseAdmin
    .from("match_player_stats")
    .select("player_id")
    .eq("player_id", sourceId);

  if (statsError) return json(500, { error: `Failed to fetch stats: ${statsError.message}` });

  const transferredCount = statsToTransfer?.length || 0;

  if (transferredCount > 0) {
    const { error: updateError } = await supabaseAdmin
      .from("match_player_stats")
      .update({ player_id: targetId })
      .eq("player_id", sourceId);

    if (updateError) return json(500, { error: `Failed to transfer stats: ${updateError.message}` });
  }

  const { error: deleteError } = await supabaseAdmin
    .from("players")
    .delete()
    .eq("id", sourceId);

  if (deleteError) return json(500, { error: `Failed to delete source player: ${deleteError.message}` });

  return json(200, { ok: true, transferredStats: transferredCount, message: `Successfully merged players. ${transferredCount} match results transferred.` });
}

async function deleteHandler(req: NextRequest) {
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

// ── Cache eviction wrappers ──────────────────────────────────────────────────
// The cached aggregate pages (/stats, /teams, /elo, detail routes) use a 6h
// revalidate window to keep Supabase egress down. Evict them after every
// successful write so the long window never shows stale data.

export async function POST(req: NextRequest) {
  const res = await postHandler(req);
  if (res.ok) revalidateContent();
  return res;
}

export async function PUT(req: NextRequest) {
  const res = await putHandler(req);
  if (res.ok) revalidateContent();
  return res;
}

export async function PATCH(req: NextRequest) {
  const res = await patchHandler(req);
  if (res.ok) revalidateContent();
  return res;
}

export async function DELETE(req: NextRequest) {
  const res = await deleteHandler(req);
  if (res.ok) revalidateContent();
  return res;
}
