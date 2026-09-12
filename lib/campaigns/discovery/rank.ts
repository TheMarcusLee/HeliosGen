import type { DiscoveredVideo, RankedVideo } from "./types";

/**
 * Ranking philosophy: the goal is not "biggest video", it is "video we can
 * still get in front of, that a motion model can read". A clip with 400 views
 * is one person's Tuesday, and a four-year-old clip is a perfect capture of a
 * format nobody is doing now. Both are cheap to drop here before any expensive
 * retrieval or inspection happens.
 */
export interface RankOptions {
  /** Floor on reach. Off when zero. */
  minViews?: number;
  /** How old a clip may be, in days. Unknown dates are kept. Off when zero. */
  maxAgeDays?: number;
  /** Ideal clip window; a source longer than this still works but needs trimming. */
  clipSeconds?: { min: number; max: number };
  now?: number;
}
export interface RankWeights { velocity: number; engagement: number; duration: number; freshness: number }
export const DEFAULT_WEIGHTS: RankWeights = { velocity: 0.45, engagement: 0.25, duration: 0.15, freshness: 0.15 };
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const logNorm = (value: number, max: number) => max <= 0 ? 0 : Math.log10(1 + value) / Math.log10(1 + max);
export function ageInDays(video: DiscoveredVideo, now = Date.now()): number | undefined {
  if (!video.postedAt) return undefined;
  const at = Date.parse(video.postedAt);
  return Number.isFinite(at) ? (now - at) / 86_400_000 : undefined;
}
export function viewsPerDay(video: DiscoveredVideo, now = Date.now()) {
  return Math.round((video.views ?? 0) / Math.max(1, ageInDays(video, now) ?? 1));
}
export function engagementRate(video: DiscoveredVideo) {
  const views = video.views ?? 0;
  return views > 0 ? ((video.likes ?? 0) + (video.comments ?? 0)) / views : 0;
}
export interface RankResult { ranked: RankedVideo[]; dropped: Record<string, number> }
/** Normalisation is batch-relative on purpose: absolute counts are not comparable across queries, but rank within one pull is. */
export function rankVideos(videos: DiscoveredVideo[], options: RankOptions = {}, weights: RankWeights = DEFAULT_WEIGHTS): RankResult {
  const now = options.now ?? Date.now(), dropped: Record<string, number> = {};
  const kept = videos.filter(v => {
    if (options.minViews && (v.views ?? 0) < options.minViews) { dropped.views = (dropped.views ?? 0) + 1; return false; }
    const age = ageInDays(v, now);
    if (options.maxAgeDays && age !== undefined && age > options.maxAgeDays) { dropped.age = (dropped.age ?? 0) + 1; return false; }
    return true;
  });
  const maxVelocity = Math.max(...kept.map(v => viewsPerDay(v, now)), 1);
  const maxEngagement = Math.max(...kept.map(engagementRate), 0.0001);
  const window = options.clipSeconds ?? { min: 3, max: 10 };
  const ranked = kept.map((v): RankedVideo => {
    const perDay = viewsPerDay(v, now), engagement = engagementRate(v), reasons: string[] = [];
    const velocity = logNorm(perDay, maxVelocity);
    const engagementScore = clamp01(engagement / maxEngagement);
    // A source that already fits the clip window needs no trimming; a very long one is likely a compilation or a talking video.
    const seconds = v.durationSec;
    const duration = seconds === undefined ? 0.5 : seconds < window.min ? 0 : seconds <= window.max ? 1 : seconds <= 60 ? clamp01(1 - (seconds - window.max) / 60) : 0;
    const age = ageInDays(v, now);
    const freshness = age === undefined ? 0.5 : clamp01(1 - age / 30);
    if (velocity > 0.8) reasons.push(`${perDay.toLocaleString()} views/day, near the top of this search`);
    if (engagementScore > 0.7) reasons.push(`strong response (${(engagement * 100).toFixed(1)}% likes+comments per view)`);
    if (duration === 1) reasons.push(`${seconds}s fits the clip window without trimming`);
    if (seconds !== undefined && seconds < window.min) reasons.push(`${seconds}s is shorter than the minimum clip`);
    if (age !== undefined && age <= 7) reasons.push("posted this week");
    if (age !== undefined && age > 30) reasons.push(`${Math.round(age)} days old`);
    const score = clamp01(velocity * weights.velocity + engagementScore * weights.engagement + duration * weights.duration + freshness * weights.freshness);
    return { ...v, score: Number(score.toFixed(4)), viewsPerDay: perDay, engagement: Number(engagement.toFixed(4)), reasons };
  }).sort((a, b) => b.score - a.score);
  return { ranked, dropped };
}
/** "views 41, age 12" for the run log, or empty when nothing was dropped. */
export function describeDropped(dropped: Record<string, number>) {
  return Object.entries(dropped).sort((a, b) => b[1] - a[1]).map(([reason, n]) => `${reason} ${n}`).join(", ");
}
