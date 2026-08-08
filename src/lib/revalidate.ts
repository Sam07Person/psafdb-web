import { revalidatePath } from "next/cache";

/**
 * Egress control.
 *
 * The server-rendered pages below aggregate over `matches` and
 * `match_player_stats`, which means each cache miss pulls a large payload out of
 * PostgREST. They previously used `revalidate = 60`, so a single steady visitor
 * could trigger up to 1,440 full-table regenerations per day.
 *
 * They now use a 6 hour window (`revalidate = 21600`). To avoid the staleness
 * that would normally imply, every admin mutation calls `revalidateContent()`,
 * which evicts those cache entries immediately — so content is fresh right after
 * an import, and otherwise costs at most 4 regenerations per day.
 *
 * Only server-cached routes are listed. Client-rendered pages (`/news`,
 * `/players`, `/matches`, `/leagues`, `/awards`, `/table-predictor`) fetch from
 * the browser and hold no server cache entry, so revalidating them is a no-op.
 */
const STATIC_PATHS = [
  "/stats",
  "/teams",
  "/elo",
  "/api/elo",
] as const;

/**
 * Dynamic detail routes. Passing the literal segment pattern with type "page"
 * evicts every generated variant of that route.
 */
const DYNAMIC_PATHS = [
  "/matches/[id]",
  "/teams/[id]",
  "/leagues/[id]",
] as const;

/**
 * Evict the cached aggregate pages. Safe to call from any route handler;
 * failures are swallowed so a revalidation problem can never fail a write that
 * already succeeded.
 */
export function revalidateContent(): void {
  for (const path of STATIC_PATHS) {
    try {
      revalidatePath(path);
    } catch (err) {
      console.warn(`[revalidate] failed for ${path}:`, err);
    }
  }

  for (const path of DYNAMIC_PATHS) {
    try {
      revalidatePath(path, "page");
    } catch (err) {
      console.warn(`[revalidate] failed for ${path}:`, err);
    }
  }
}
