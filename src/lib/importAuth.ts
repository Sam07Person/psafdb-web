import type { NextRequest } from "next/server";

/**
 * Auth for the match-results import flow.
 *
 * Two kinds of caller are accepted:
 *  - Admin: sends `x-admin-password` == ADMIN_IMPORT_PASSWORD AND a
 *    `Authorization: Bearer <ADMIN_IMPORT_TOKEN>` header (used by the full
 *    admin dashboard).
 *  - Staff: sends `x-staff-username` == STAFF_IMPORT_USERNAME AND
 *    `x-admin-password` == STAFF_IMPORT_PASSWORD (used by the dedicated
 *    /staff/import page). No bearer token required.
 *
 * Staff credentials are ONLY honoured by routes that opt in via
 * requireImportAuth. Routes that mutate other data continue to call their
 * admin-only requireAuth, so staff can read (for team/player matching) and run
 * the import pipeline, but cannot edit leagues/teams/players/settings.
 */

type AuthOk = { ok: true; role: "admin" | "staff" };
type AuthFail = { ok: false; error: string };
export type ImportAuthResult = AuthOk | AuthFail;

function bearerToken(req: NextRequest): string {
  const auth = req.headers.get("authorization") || "";
  return auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
}

export function isAdmin(req: NextRequest): boolean {
  const pw = req.headers.get("x-admin-password");
  const expectedPw = process.env.ADMIN_IMPORT_PASSWORD;
  const expectedTok = process.env.ADMIN_IMPORT_TOKEN;
  if (!expectedPw || !expectedTok) return false;
  return pw === expectedPw && bearerToken(req) === expectedTok;
}

export function isStaff(req: NextRequest): boolean {
  const pw = req.headers.get("x-admin-password");
  const user = req.headers.get("x-staff-username");
  const expectedUser = process.env.STAFF_IMPORT_USERNAME;
  const expectedPw = process.env.STAFF_IMPORT_PASSWORD;
  if (!expectedUser || !expectedPw) return false;
  return user === expectedUser && pw === expectedPw;
}

/** Accept an admin OR a staff caller. */
export function requireImportAuth(req: NextRequest): ImportAuthResult {
  if (isAdmin(req)) return { ok: true, role: "admin" };
  if (isStaff(req)) return { ok: true, role: "staff" };
  return { ok: false, error: "Invalid credentials" };
}
