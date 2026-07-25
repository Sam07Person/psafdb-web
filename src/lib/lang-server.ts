import { cookies } from "next/headers";
import type { Lang } from "./i18n";

export const LANG_COOKIE = "psafdb-lang";

const VALID: Lang[] = ["en", "tr"];

/**
 * Read the current language from the request cookie, for use in
 * Server Components and Route Handlers. Falls back to "en".
 */
export async function getLang(): Promise<Lang> {
  const store = await cookies();
  const raw = store.get(LANG_COOKIE)?.value;
  return VALID.includes(raw as Lang) ? (raw as Lang) : "en";
}
