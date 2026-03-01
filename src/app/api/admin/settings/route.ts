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

// GET - Public: returns tier settings for use in rating calculations
export async function GET() {
  if (!supabaseAdmin) return json(500, { error: "Server missing SUPABASE_SERVICE_ROLE_KEY" });

  const { data, error } = await supabaseAdmin
    .from("tier_settings")
    .select("tier,label,bonus")
    .order("tier", { ascending: true });

  if (error) return json(500, { error: error.message });

  return json(200, { tierSettings: data ?? [] });
}

// PUT - Admin only: update tier bonus values
export async function PUT(req: NextRequest) {
  const auth = requireAuth(req);
  if (!auth.ok) return json(401, { error: auth.error });

  if (!supabaseAdmin) return json(500, { error: "Server missing SUPABASE_SERVICE_ROLE_KEY" });

  const body = await req.json().catch(() => null);
  if (!body || !Array.isArray(body.tierSettings)) {
    return json(400, { error: "tierSettings array is required" });
  }

  for (const row of body.tierSettings) {
    const { error } = await supabaseAdmin
      .from("tier_settings")
      .upsert({ tier: row.tier, label: row.label, bonus: row.bonus });
    if (error) return json(500, { error: error.message });
  }

  return json(200, { ok: true });
}
