/**
 * Discovery domain types. Providers normalise into these so the director and
 * the trend board never learn which endpoint produced a row.
 */
export interface DiscoveredVideo {
  id: string;
  platform: "tiktok";
  /** Canonical public page URL. */
  url: string;
  /** Direct media URL. Served only to the browser session that holds the visitor cookie, and expires. */
  mediaUrl?: string;
  coverUrl?: string;
  /** Animated cover, useful for a preview without a download. */
  previewUrl?: string;
  authorHandle: string;
  caption: string;
  hashtags: string[];
  soundId?: string;
  soundTitle?: string;
  durationSec?: number;
  views?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  postedAt?: string;
  collectedAt: string;
}
export interface RankedVideo extends DiscoveredVideo {
  /** 0 to 1 composite. What the director sorts on. */
  score: number;
  viewsPerDay: number;
  /** Likes plus comments over views. */
  engagement: number;
  /** Why this ranked where it did, in plain words. */
  reasons: string[];
}
/** A hashtag or sound that the search results are full of right now. */
export interface TrendSignal {
  id: string;
  kind: "hashtag" | "sound";
  label: string;
  url: string;
  views: number;
  posts: number;
}
