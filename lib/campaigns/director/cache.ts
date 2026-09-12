import { db } from "../../guest/sqlite";
import type { MediaEvidence } from "./types";
import type { z } from "zod";
import type { inspectionSchema } from "./types";

/**
 * Never retrieve or inspect the same source video twice.
 *
 * Retrieval (yt-dlp, ffmpeg, contact sheets) and inspection (a vision model
 * call over those sheets) are the two expensive steps of research, and their
 * results for a given video do not change: same file, same framing, same
 * subject count. Retrieval is keyed by canonical source URL. Inspection also
 * depends on which influencer the clip is judged against (aesthetic fit), so it
 * is keyed by source URL plus identity; a run with no identity yet shares one
 * "no identity" bucket. Set HELIOS_DIRECTOR_NO_CACHE=1 to bypass.
 */
type Inspection = z.infer<typeof inspectionSchema>;
function table() {
  const d = db();
  d.exec("CREATE TABLE IF NOT EXISTS director_media (url TEXT PRIMARY KEY, media TEXT NOT NULL, title TEXT, metrics TEXT, created_at INTEGER NOT NULL)");
  d.exec("CREATE TABLE IF NOT EXISTS director_inspections (key TEXT PRIMARY KEY, url TEXT NOT NULL, inspection TEXT NOT NULL, created_at INTEGER NOT NULL)");
  return d;
}
const enabled = () => process.env.HELIOS_DIRECTOR_NO_CACHE !== "1";
export interface CachedMedia { media: MediaEvidence; title?: string; metrics?: { views?: number; likes?: number; publishedAt?: string; checkedAt: number }; createdAt: number }
export function getCachedMedia(url: string): CachedMedia | undefined {
  if (!enabled()) return undefined;
  const row = table().prepare("SELECT media, title, metrics, created_at FROM director_media WHERE url = ?").get(url) as { media: string; title: string | null; metrics: string | null; created_at: number } | undefined;
  if (!row) return undefined;
  return { media: JSON.parse(row.media), title: row.title ?? undefined, metrics: row.metrics ? JSON.parse(row.metrics) : undefined, createdAt: row.created_at };
}
export function setCachedMedia(url: string, value: Omit<CachedMedia, "createdAt">) {
  if (!enabled()) return;
  table().prepare("INSERT INTO director_media (url, media, title, metrics, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(url) DO UPDATE SET media = excluded.media, title = excluded.title, metrics = excluded.metrics, created_at = excluded.created_at")
    .run(url, JSON.stringify(value.media), value.title ?? null, value.metrics ? JSON.stringify(value.metrics) : null, Date.now());
}
export function dropCachedMedia(url: string) {
  table().prepare("DELETE FROM director_media WHERE url = ?").run(url);
  table().prepare("DELETE FROM director_inspections WHERE url = ?").run(url);
}
const inspectionKey = (url: string, identityId?: string) => `${url}|${identityId ?? "no-identity"}`;
export function getCachedInspection(url: string, identityId?: string): { inspection: Inspection; createdAt: number } | undefined {
  if (!enabled()) return undefined;
  const row = table().prepare("SELECT inspection, created_at FROM director_inspections WHERE key = ?").get(inspectionKey(url, identityId)) as { inspection: string; created_at: number } | undefined;
  return row ? { inspection: JSON.parse(row.inspection), createdAt: row.created_at } : undefined;
}
export function setCachedInspection(url: string, identityId: string | undefined, inspection: Inspection) {
  if (!enabled()) return;
  table().prepare("INSERT INTO director_inspections (key, url, inspection, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET inspection = excluded.inspection, created_at = excluded.created_at")
    .run(inspectionKey(url, identityId), url, JSON.stringify(inspection), Date.now());
}
