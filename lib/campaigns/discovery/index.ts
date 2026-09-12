import { deriveTrends, toVideo } from "./tiktokItems";
import { searchTikTokItems, type SearchOptions } from "./tiktokSearch";
import { describeDropped, rankVideos, type RankOptions } from "./rank";
import type { DiscoveredVideo, RankedVideo, TrendSignal } from "./types";

export type { DiscoveredVideo, RankedVideo, TrendSignal } from "./types";
export { tiktokBrowserStatus, sharedTikTokSession, closeTikTokSession } from "./tiktokSession";
export { rankVideos } from "./rank";
export { deriveTrends } from "./tiktokItems";
export { danceTextScore, isDanceQuery } from "./danceSignals";

export interface DiscoveryResult { videos: RankedVideo[]; trends: TrendSignal[]; summary: string }
/** Live TikTok keyword discovery: search, drop what is not worth looking at, rank, and read the trends off the results. */
export async function discoverTikTok(query: string, options: SearchOptions & RankOptions & { keep?: number } = {}): Promise<DiscoveryResult> {
  const items = await searchTikTokItems(query, options);
  const videos = items.map(toVideo).filter((v): v is DiscoveredVideo => !!v);
  const { ranked, dropped } = rankVideos(videos, { maxAgeDays: 90, ...options });
  const kept = ranked.slice(0, options.keep ?? 12);
  const droppedNote = describeDropped(dropped);
  return {
    videos: kept,
    trends: deriveTrends(items),
    summary: `Live TikTok keyword search for “${query}”: ${videos.length} videos seen, ${kept.length} kept after ranking by views per day, engagement, clip fit and recency${droppedNote ? ` (dropped: ${droppedNote})` : ""}. Visual suitability is not yet assessed.`,
  };
}
