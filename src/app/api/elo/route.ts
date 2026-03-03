import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { computeCurrentElos } from "@/lib/elo";

export const revalidate = 60;

export async function GET() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
  const eloMap = await computeCurrentElos(supabase);
  return NextResponse.json(eloMap);
}
