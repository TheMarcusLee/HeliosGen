import { randomUUID } from "node:crypto";
import { db } from "../guest/sqlite";

/**
 * Source clips captured from the user's own browser session (the bundled
 * InstaVault extension) and stored as local media. They are ordinary
 * `/generated/...` references, so the director accepts them as supplied
 * sources without any network retrieval.
 */
export interface Capture {
  id: string;
  /** Local media reference. */
  url: string;
  sourceUrl: string;
  author: string;
  caption: string;
  mediaType: "video" | "image";
  postedAt?: string;
  createdAt: number;
}
function table() {
  const d = db();
  d.exec("CREATE TABLE IF NOT EXISTS campaign_captures (id TEXT PRIMARY KEY, url TEXT NOT NULL, source_url TEXT NOT NULL, author TEXT NOT NULL, caption TEXT NOT NULL, media_type TEXT NOT NULL, posted_at TEXT, created_at INTEGER NOT NULL)");
  return d;
}
type Row = { id: string; url: string; source_url: string; author: string; caption: string; media_type: "video" | "image"; posted_at: string | null; created_at: number };
const fromRow = (r: Row): Capture => ({ id: r.id, url: r.url, sourceUrl: r.source_url, author: r.author, caption: r.caption, mediaType: r.media_type, postedAt: r.posted_at ?? undefined, createdAt: r.created_at });
export function saveCapture(input: Omit<Capture, "id" | "createdAt">): Capture {
  const existing = table().prepare("SELECT * FROM campaign_captures WHERE url = ?").get(input.url) as Row | undefined;
  if (existing) return fromRow(existing); // same bytes dedupe to the same local URL
  const capture: Capture = { ...input, id: randomUUID(), createdAt: Date.now() };
  table().prepare("INSERT INTO campaign_captures (id, url, source_url, author, caption, media_type, posted_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run(capture.id, capture.url, capture.sourceUrl, capture.author, capture.caption, capture.mediaType, capture.postedAt ?? null, capture.createdAt);
  return capture;
}
export function listCaptures(limit = 100): Capture[] {
  return (table().prepare("SELECT * FROM campaign_captures ORDER BY created_at DESC LIMIT ?").all(limit) as Row[]).map(fromRow);
}
export function deleteCapture(id: string) {
  table().prepare("DELETE FROM campaign_captures WHERE id = ?").run(id);
}
