import { integrationKey } from "./integrations";
import { getCampaign, saveCampaign } from "./db";
import type { TrendCandidate } from "./operations";
import { discoverTikTok } from "./discovery";
function mergeTrends(id: string, candidates: TrendCandidate[]) {
  const c = getCampaign(id);
  const saved = (c.trends ?? []).filter(t => t.selected);
  c.trends = [...saved, ...candidates.filter(t => !saved.some(s => s.id === t.id))].slice(0, 50);
  return saveCampaign(c);
}
/** Live TikTok discovery through the built-in browser session. Free; needs an installed Chrome. */
export async function discoverTikTokTrends(id: string, query: string, discover = discoverTikTok) {
  const result = await discover(query, { keep: 20 });
  const now = Date.now();
  return mergeTrends(id, result.videos.map(v => ({ id: `tt:${v.id}`, url: v.url, title: v.caption.slice(0, 200) || `TikTok by @${v.authorHandle}`, channel: `@${v.authorHandle}`, publishedAt: v.postedAt ?? "", fetchedAt: now, views: v.views ?? 0, likes: v.likes ?? 0, viewsPerDay: v.viewsPerDay, selected: false, query, notes: [v.reasons.join("; "), result.trends.length ? `Recurring: ${result.trends.slice(0, 5).map(t => t.label).join(", ")}` : ""].filter(Boolean).join(" · ") })));
}
export async function discoverTrends(id: string, query: string, region = "US", fetcher = fetch) {
  const key = integrationKey("youtube");
  if (!key) throw new Error("Connect a YouTube Data API key in Campaign controls to discover recent content.");
  async function youtube(path: string, params: Record<string, string>) {
    const response = await fetcher(`https://www.googleapis.com/youtube/v3/${path}?${new URLSearchParams({ ...params, key: key! })}`, { signal: AbortSignal.timeout(20000), redirect: "error", cache: "no-store" });
    if (!response.ok) throw new Error(`YouTube returned ${response.status}. Check the API key, enabled Data API and quota.`);
    return response.json();
  }
  const search = await youtube("search", { part: "snippet", q: query, type: "video", videoDuration: "short", maxResults: "20", order: "viewCount", publishedAfter: new Date(Date.now() - 30 * 86400000).toISOString(), regionCode: region, safeSearch: "strict" });
  const ids = (search.items ?? []).map((item: { id: { videoId: string } }) => item.id.videoId).filter(Boolean);
  const details = ids.length ? await youtube("videos", { part: "snippet,statistics", id: ids.join(",") }) : { items: [] };
  const now = Date.now();
  const candidates: TrendCandidate[] = details.items.map((item: { id: string; snippet: { title: string; channelTitle: string; publishedAt: string }; statistics: { viewCount?: string; likeCount?: string } }) => ({
    id: item.id, url: `https://www.youtube.com/watch?v=${item.id}`, title: item.snippet.title, channel: item.snippet.channelTitle, publishedAt: item.snippet.publishedAt, fetchedAt: now, views: Number(item.statistics.viewCount ?? 0), likes: Number(item.statistics.likeCount ?? 0), viewsPerDay: Math.round(Number(item.statistics.viewCount ?? 0) / Math.max(1, (now - Date.parse(item.snippet.publishedAt)) / 86400000)), selected: false, query,
  })).sort((a: TrendCandidate, b: TrendCandidate) => b.viewsPerDay - a.viewsPerDay);
  return mergeTrends(id, candidates);
}
