import type { DiscoveredVideo, TrendSignal } from "./types";

/** The one item shape TikTok's search and explore endpoints return. */
export interface TikTokItem {
  id?: string;
  desc?: string;
  createTime?: number | string;
  video?: { duration?: number; cover?: string; dynamicCover?: string; playAddr?: string; bitrateInfo?: Array<{ PlayAddr?: { UrlList?: string[] } }> };
  author?: { uniqueId?: string; nickname?: string };
  music?: { id?: string; title?: string; authorName?: string };
  stats?: { playCount?: number; diggCount?: number; commentCount?: number; shareCount?: number };
  textExtra?: Array<{ hashtagName?: string }>;
}
export function toVideo(it: TikTokItem): DiscoveredVideo | undefined {
  const author = it.author?.uniqueId;
  if (!it.id || !author || !/^\d+$/.test(it.id) || !/^[\w.-]+$/.test(author)) return undefined;
  const mediaUrl = [it.video?.playAddr, ...(it.video?.bitrateInfo?.flatMap(b => b.PlayAddr?.UrlList ?? []) ?? [])].find(u => !!u && /^https:\/\//.test(u));
  return {
    id: it.id, platform: "tiktok", url: `https://www.tiktok.com/@${author}/video/${it.id}`, mediaUrl,
    coverUrl: it.video?.cover, previewUrl: it.video?.dynamicCover, authorHandle: author, caption: it.desc ?? "",
    hashtags: (it.textExtra ?? []).map(t => t.hashtagName).filter((h): h is string => !!h),
    soundId: it.music?.id, soundTitle: it.music?.title, durationSec: it.video?.duration,
    views: it.stats?.playCount, likes: it.stats?.diggCount, comments: it.stats?.commentCount, shares: it.stats?.shareCount,
    postedAt: it.createTime ? new Date(Number(it.createTime) * 1000).toISOString() : undefined,
    collectedAt: new Date().toISOString(),
  };
}
export function dedupeItems(items: TikTokItem[]): TikTokItem[] {
  const seen = new Set<string>();
  return items.filter(it => it.id && !seen.has(it.id) && seen.add(it.id));
}
/** Tags every creator staples on regardless of subject. They carry no information about what is trending. */
export const JUNK_TAGS = new Set(["fyp", "fypã", "foryou", "foryoupage", "fy", "viral", "viralvideo", "trending", "tiktok", "parati", "paratii", "xyzbca", "capcut", "duet", "funny", "explore"]);
/** TikTok names an unnamed track after the video that used it. These are per-video, not shared trends. */
export const GENERIC_SOUND = /^(original sound|sonido original|som original|suara asli|son original|оригинальный звук|オリジナル楽曲|origineel geluid|originalton|suono originale)/i;
/**
 * Neither endpoint has a "trending hashtags" call, so trends are read off the
 * content: what the results are full of right now is what is trending.
 */
export function deriveTrends(items: TikTokItem[], limit = 12): TrendSignal[] {
  const tags = new Map<string, { posts: number; views: number }>();
  const sounds = new Map<string, { title: string; posts: number; views: number }>();
  for (const it of items) {
    const views = it.stats?.playCount ?? 0;
    for (const t of it.textExtra ?? []) {
      if (!t.hashtagName || JUNK_TAGS.has(t.hashtagName.toLowerCase())) continue;
      const cur = tags.get(t.hashtagName) ?? { posts: 0, views: 0 };
      tags.set(t.hashtagName, { posts: cur.posts + 1, views: cur.views + views });
    }
    const sid = it.music?.id;
    if (sid && !GENERIC_SOUND.test(it.music?.title ?? "")) {
      const cur = sounds.get(sid) ?? { title: it.music?.title ?? "", posts: 0, views: 0 };
      sounds.set(sid, { ...cur, posts: cur.posts + 1, views: cur.views + views });
    }
  }
  const signals: TrendSignal[] = [
    ...[...tags.entries()].map(([name, v]) => ({ id: `tt:hashtag:${name.toLowerCase()}`, kind: "hashtag" as const, label: `#${name}`, url: `https://www.tiktok.com/tag/${encodeURIComponent(name)}`, views: v.views, posts: v.posts })),
    ...[...sounds.entries()].map(([id, s]) => ({ id: `tt:sound:${id}`, kind: "sound" as const, label: s.title || `sound ${id}`, url: `https://www.tiktok.com/music/x-${id}`, views: s.views, posts: s.posts })),
  ];
  // Appearing repeatedly matters more than one lucky video.
  return signals.sort((a, b) => b.posts - a.posts || b.views - a.views).slice(0, limit);
}
