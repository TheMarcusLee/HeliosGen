import { join } from "path";

/**
 * Writable locations for guest-mode persistence.
 *
 * In web/dev these default to the repo (`data/` and `public/generated/`, both
 * gitignored). In the packaged desktop app the install dir is read-only, so the
 * Tauri shell sets HELIOS_DATA_DIR / HELIOS_MEDIA_DIR to per-user app-data
 * folders before spawning the Next.js server sidecar.
 *
 * Stored media URLs stay as `/generated/<folder>/<file>` regardless of where the
 * bytes live — `app/generated/[...path]/route.ts` serves them from MEDIA_DIR
 * when they are not physically under `public/`.
 */
export const DATA_DIR = process.env.HELIOS_DATA_DIR || join(process.cwd(), "data");

export const MEDIA_DIR =
  process.env.HELIOS_MEDIA_DIR || join(process.cwd(), "public", "generated");
