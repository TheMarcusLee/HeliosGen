/**
 * Local media storage. HeliosGen writes all generated and uploaded media to
 * disk under `MEDIA_DIR` (see `lib/guest/paths.ts`) and serves it same-origin
 * at `/generated/...` (`app/generated/[...path]/route.ts`). SHA-256 dedupe and
 * the hash index live in the local SQLite DB (`lib/guest/db.ts`).
 *
 * Thin, stable facade over `lib/guest/localStorage.ts`.
 */
import { mirrorToStorage, ensureStorage } from "./guest/localStorage";

export { uploadBuffer, uploadDataUrl, mirrorToStorage, ensureStorage } from "./guest/localStorage";

/** Legacy names kept so call sites don't churn — both write to local disk. */
export const mirrorToR2 = mirrorToStorage;
export const ensureR2 = ensureStorage;
