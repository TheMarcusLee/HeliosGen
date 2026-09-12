import { randomUUID } from "node:crypto";
import { discoverTikTok } from "../discovery";
import type { RankOptions } from "../discovery/rank";
import { isDanceQuery } from "../discovery/danceSignals";
import { sourceUrl } from "./media";
import type { DirectorSource } from "./types";

/** TikTok's media CDNs. Bytes are served only to the browser session holding the visitor cookie. */
export function isTikTokMedia(input: string) {
  try { const u = new URL(input); return u.protocol === "https:" && !u.port && !u.username && !u.password && /(^|\.)(tiktokcdn(?:-us|-eu)?\.com|tiktokv\.com|tiktokv\.eu|byteoversea\.com|ibytedtos\.com)$/.test(u.hostname); } catch { return false; }
}
/** Live TikTok keyword search through the built-in browser session. No vendor, no per-call cost. */
export async function searchTikTok(query: string, excluded: string[], options: RankOptions & { keep?: number } = {}) {
  const result = await discoverTikTok(query, { keep: 8, dance: isDanceQuery(query), ...options });
  const sources: DirectorSource[] = [];
  for (const v of result.videos) {
    let url: string;
    try { url = sourceUrl(v.url); } catch { continue; }
    if (excluded.includes(url) || sources.some(s => s.url === url)) continue;
    sources.push({ id: randomUUID(), url, title: v.caption.slice(0, 200) || `TikTok by @${v.authorHandle}`, query, status: "found", discoveredAt: Date.now(), downloadUrl: v.mediaUrl && isTikTokMedia(v.mediaUrl) ? v.mediaUrl : undefined, ranking: { score: v.score, reasons: v.reasons }, metrics: { views: v.views, likes: v.likes, publishedAt: v.postedAt, checkedAt: Date.now() } });
    if (sources.length === 6) break;
  }
  const trends = result.trends.slice(0, 6).map(t => `${t.label} (${t.posts} posts)`).join(", ");
  return { sources, summary: `${result.summary}${trends ? ` Recurring in results: ${trends}.` : ""}` };
}
