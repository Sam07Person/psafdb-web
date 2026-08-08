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

// GET - List all leagues
export async function GET(req: NextRequest) {
  // Staff (match-import) may read leagues for the import dropdown; mutations stay admin-only.
  const auth = requireImportAuth(req);
  if (!auth.ok) return json(401, { error: auth.error });

  if (!supabaseAdmin) return json(500, { error: "Server missing SUPABASE_SERVICE_ROLE_KEY" });

  const { data, error } = await supabaseAdmin
    .from("leagues")
    .select("id,name,season,format,image,tier,use_tier_bonus,award_champion,ended,zones,created_at")
    .order("created_at", { ascending: false });

  if (error) return json(500, { error: error.message });

  return json(200, { leagues: data });
}

// POST - Create new league
async function postHandler(req: NextRequest) {
  const auth = requireAuth(req);
  if (!auth.ok) return json(401, { error: auth.error });

  if (!supabaseAdmin) return json(500, { error: "Server missing SUPABASE_SERVICE_ROLE_KEY" });

  const body = await req.json().catch(() => null);
  if (!body) return json(400, { error: "Invalid JSON body" });

  const { name, season, format, image, tier, use_tier_bonus, award_champion, ended, zones } = body;
  if (!name || typeof name !== "string") return json(400, { error: "name is required" });

  const { data, error } = await supabaseAdmin
    .from("leagues")
    .insert({
      name,
      season: season || null,
      format: format || "league",
      image: image || null,
      tier: tier ? parseInt(tier) : 2,
      use_tier_bonus: use_tier_bonus ?? true,
      award_champion: award_champion ?? true,
      ended: ended ?? false,
      zones: zones ?? [],
    })
    .select()
    .single();

  if (error) return json(500, { error: error.message });

  return json(201, { league: data });
}

// PUT - Update league
async function putHandler(req: NextRequest) {
  const auth = requireAuth(req);
  if (!auth.ok) return json(401, { error: auth.error });

  if (!supabaseAdmin) return json(500, { error: "Server missing SUPABASE_SERVICE_ROLE_KEY" });

  const body = await req.json().catch(() => null);
  if (!body) return json(400, { error: "Invalid JSON body" });

  const { id, name, season, format, image, tier, use_tier_bonus, award_champion, ended, zones } = body;
  if (!id) return json(400, { error: "id is required" });
  if (!name || typeof name !== "string") return json(400, { error: "name is required" });

  const { data, error } = await supabaseAdmin
    .from("leagues")
    .update({
      name,
      season: season || null,
      format: format || "league",
      image: image || null,
      tier: tier ? parseInt(tier) : 2,
      use_tier_bonus: use_tier_bonus ?? true,
      award_champion: award_champion ?? true,
      ended: ended ?? false,
      zones: zones ?? [],
    })
    .eq("id", id)
    .select()
    .single();

  if (error) return json(500, { error: error.message });

  return json(200, { league: data });
}

// DELETE - Delete league
async function deleteHandler(req: NextRequest) {
  const auth = requireAuth(req);
  if (!auth.ok) return json(401, { error: auth.error });

  if (!supabaseAdmin) return json(500, { error: "Server missing SUPABASE_SERVICE_ROLE_KEY" });

  const body = await req.json().catch(() => null);
  if (!body) return json(400, { error: "Invalid JSON body" });

  const { id } = body;
  if (!id) return json(400, { error: "id is required" });

  const { error } = await supabaseAdmin
    .from("leagues")
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

export async function DELETE(req: NextRequest) {
  const res = await deleteHandler(req);
  if (res.ok) revalidateContent();
  return res;
}
