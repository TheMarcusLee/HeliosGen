import { dedupeItems, toVideo, type TikTokItem } from "./tiktokItems";
import { sharedTikTokSession, type TikTokSession } from "./tiktokSession";
import type { DiscoveredVideo } from "./types";

/**
 * TikTok keyword search through the same unsigned endpoint the web app uses:
 *
 *   GET /api/search/general/full/?keyword=…&offset=0&count=20
 *
 * Two things about it that are not guessable:
 * - Paging needs the search id. `offset=20` on its own returns an empty page
 *   that reads as "that was everything". The id is `extra.logid` on the first
 *   response and rides along on every page after it.
 * - It returns mixed cards, so only entries carrying an `item` are videos.
 * - Non-zero status codes still carry full pages, so trust the items, not the label.
 */
const BASE = "aid=1988&app_name=tiktok_web&device_platform=web_pc&region=US&os=mac&from_page=search";
export function searchPath(keyword: string, offset: number, searchId?: string) {
  return `/api/search/general/full/?${BASE}&keyword=${encodeURIComponent(keyword)}&offset=${offset}&count=20${searchId ? `&search_id=${encodeURIComponent(searchId)}` : ""}`;
}
interface SearchPage { data?: Array<{ item?: TikTokItem }>; has_more?: number | boolean; cursor?: number | string; extra?: { logid?: string } }
export function itemsOf(json: unknown): TikTokItem[] {
  return ((json as SearchPage | null)?.data ?? []).filter(d => d?.item).map(d => d.item!);
}
export interface SearchOptions { limit?: number; pages?: number; session?: TikTokSession }
/** Raw items, in the order TikTok returned them. */
export async function searchTikTokItems(keyword: string, options: SearchOptions = {}): Promise<TikTokItem[]> {
  const session = options.session ?? sharedTikTokSession(), want = options.limit ?? 40, pages = options.pages ?? 2;
  const out: TikTokItem[] = [];
  let searchId: string | undefined, offset = 0;
  for (let page = 0; page < pages && out.length < want; page++) {
    const json = await session.getJson(searchPath(keyword.replace(/^#/, ""), offset, searchId)) as SearchPage | null;
    if (!json) break;
    const batch = itemsOf(json);
    if (!batch.length) break;
    out.push(...batch);
    searchId ??= json.extra?.logid;
    if (!json.has_more) break;
    offset = Number(json.cursor ?? offset + batch.length);
  }
  return dedupeItems(out);
}
export async function searchTikTokVideos(keyword: string, options: SearchOptions = {}): Promise<DiscoveredVideo[]> {
  return (await searchTikTokItems(keyword, options)).map(toVideo).filter((v): v is DiscoveredVideo => !!v);
}
