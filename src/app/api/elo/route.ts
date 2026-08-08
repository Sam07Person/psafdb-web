import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { computeCurrentElos } from "@/lib/elo";

// Egress control: this route scans large tables (matches / match_player_stats).
// At revalidate=60 a single steady visitor triggered up to 1,440 full-table
// regenerations per day. Data changes roughly daily, so 6h is plenty; the admin
// mutation routes call revalidateContent() for immediate freshness after imports.
export const revalidate = 21600;
// Next 15+ does not cache GET route handlers by default; opt in explicitly.
export const dynamic = "force-static";

export async function GET() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
  const eloMap = await computeCurrentElos(supabase);
  return NextResponse.json(eloMap);
}
