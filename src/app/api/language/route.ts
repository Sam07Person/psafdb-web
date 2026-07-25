import { NextRequest, NextResponse } from "next/server";
import { LANG_COOKIE } from "@/lib/lang-server";

const VALID = ["en", "tr"];

export async function POST(req: NextRequest) {
  let body: { lang?: string } = {};
  try {
    body = await req.json();
  } catch {
    // empty / invalid body — ignore
  }

  const lang = VALID.includes(body.lang as string) ? (body.lang as string) : "en";

  const res = NextResponse.json({ ok: true, lang });
  res.cookies.set(LANG_COOKIE, lang, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
  });
  return res;
}
