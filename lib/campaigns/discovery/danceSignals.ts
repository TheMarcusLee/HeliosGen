/**
 * Cheap first-pass dance detection on text only. It costs nothing and removes
 * most non-dance noise before any retrieval or inspection is spent. The visual
 * inspection makes the final call.
 */
const STRONG = ["dance", "dancechallenge", "dancetrend", "choreo", "choreography", "danceroutine", "dancetutorial", "learnthedance", "dancecover", "dancewithme", "originaldance", "hittheangle", "8count", "eightcount", "freestyle", "shuffle", "krump", "afrodance", "amapiano", "linedance", "kpopdance"];
const SUPPORTING = ["trend", "viral", "transition", "beatdrop", "onbeat", "sound", "audio", "duet", "tutorial", "steps", "moves", "routine", "challenge"];
const NEGATIVE = ["recipe", "cooking", "asmr", "storytime", "grwm", "haul", "unboxing", "review", "podcast", "skit", "prank", "news", "politics", "gaming", "gameplay", "makeup", "vlog", "workout", "gym"];
const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}\s#]/gu, " ");
const hits = (haystack: string, needles: string[]) => needles.reduce((n, term) => haystack.includes(term) ? n + 1 : n, 0);
/** 0 to 1. Deliberately generous: a false positive costs one inspection, a false negative costs a missed trend. */
export function danceTextScore(input: { caption?: string; hashtags?: string[]; soundTitle?: string }): number {
  const blob = norm([input.caption, input.soundTitle, ...(input.hashtags ?? []).map(h => `#${h}`)].filter(Boolean).join(" "));
  // "dc @someone" is the near-universal dance-credit convention on TikTok.
  const credit = /\bdc\s*[:@]/.test(blob) ? 1 : 0;
  const raw = hits(blob, STRONG) * 0.35 + credit * 0.3 + hits(blob, SUPPORTING) * 0.08 - hits(blob, NEGATIVE) * 0.25;
  return Math.max(0, Math.min(1, raw));
}
/** Whether a search objective is about dance, so discovery can favour dance signals. */
export const isDanceQuery = (query: string) => /\b(danc\w*|choreo\w*|routine|8 ?count|footwork)\b/i.test(query);
