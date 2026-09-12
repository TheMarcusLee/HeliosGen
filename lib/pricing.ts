import { IMAGE_MODELS, VIDEO_MODELS } from "./modelConfig";

/**
 * Provider pricing, seeded and learned.
 *
 * Kie.ai bills in credits at a fixed rate (1 credit = $0.005). Each model page
 * publishes its credit price in a `pricingDesc` field; the table below is a
 * transcription of those pages as of the date in PRICING_AS_OF, with the source
 * URL kept per entry so a stale figure can be checked in seconds. Published
 * prices are estimates only. Completed Kie jobs report `creditsConsumed`, the
 * actual charge, which the job poller writes into the generation ledger; once a
 * model has real charges on record they take precedence over the table.
 * WaveSpeed quotes `base_price` per model at listing time, and its actuals land
 * in the same ledger.
 */
export const KIE_CREDIT_USD = 0.005;
export const PRICING_AS_OF = "2026-09-11";
export const creditsToUsd = (credits: number) => Math.round(credits * KIE_CREDIT_USD * 10000) / 10000;

type ByKey = Record<string, number>;
interface ImageRule { unit: "image"; credits: number | ByKey; source: string; note?: string }
interface SecondRule { unit: "second"; credits: ByKey; withAudio?: ByKey; /** Per second of input plus output when a reference video is supplied. */ withVideoInput?: ByKey; source: string; note?: string }
interface VideoRule { unit: "video"; credits: Record<string, ByKey>; withVideoInput?: ByKey; source: string; note?: string }
export type KiePriceRule = ImageRule | SecondRule | VideoRule;
const docs = (p: string) => `https://docs.kie.ai/market/${p}`;
const gpt = { unit: "image" as const, credits: { "1k": 6, "2k": 10, "4k": 16 }, source: docs("gpt/gpt-image-2-text-to-image") };
const seedance25 = { unit: "second" as const, credits: { "480p": 28, "720p": 63, "1080p": 114 }, withVideoInput: { "480p": 17, "720p": 38, "1080p": 68.5 }, source: docs("bytedance/seedance-2-5"), note: "1080p reflects a limited-time discount until 2026-10-17." };
/** Credits per unit, keyed by the app's model ids. Omitted models have no published price on file. */
export const KIE_PRICES: Record<string, KiePriceRule> = {
  "google-nano-banana": { unit: "image", credits: 4, source: docs("google/nano-banana") },
  "nano-banana-2": { unit: "image", credits: { "1k": 8, "2k": 12, "4k": 18 }, source: docs("google/nanobanana2") },
  "nano-banana-pro": { unit: "image", credits: { "1k": 18, "2k": 18, "4k": 24 }, source: docs("google/pro-image-to-image") },
  "nano-banana-2-lite": { unit: "image", credits: 4, source: docs("google/nano-banana-2-lite") },
  "z-image": { unit: "image", credits: 0.8, source: docs("z-image/z-image") },
  "grok-imagine-image": { unit: "image", credits: 4, source: docs("grok-imagine-image-2-0/text-to-image") },
  "gpt-image-2": gpt,
  "gpt-image-2-5-flare": { ...gpt, source: docs("gpt/gpt-image-2-5-flare-text-to-image") },
  "gpt-image-2-5-sunburst": { ...gpt, source: docs("gpt/gpt-image-2-5-sunburst-text-to-image") },
  veo3_lite: { unit: "video", credits: { "720p": { any: 30 }, "1080p": { any: 35 }, "4k": { any: 150 } }, source: "https://docs.kie.ai/veo3-api/generate-veo-3-video" },
  veo3_fast: { unit: "video", credits: { "720p": { any: 60 }, "1080p": { any: 65 }, "4k": { any: 180 } }, source: "https://docs.kie.ai/veo3-api/generate-veo-3-video" },
  veo3: { unit: "video", credits: { "720p": { any: 250 }, "1080p": { any: 255 }, "4k": { any: 370 } }, source: "https://docs.kie.ai/veo3-api/generate-veo-3-video" },
  "gemini-omni-video": { unit: "video", credits: { "720p": { "4": 63, "6": 84, "8": 105, "10": 126 }, "1080p": { "4": 63, "6": 84, "8": 105, "10": 126 }, "4k": { "4": 147, "6": 168, "8": 189, "10": 210 } }, withVideoInput: { "720p": 168, "1080p": 168, "4k": 252 }, source: docs("gemini-omni-video") },
  "kling-3.0": { unit: "second", credits: { "720p": 14, "1080p": 18, "4k": 67 }, withAudio: { "720p": 20, "1080p": 27, "4k": 67 }, source: docs("kling/kling-3-0"), note: "Standard = 720p, Pro = 1080p." },
  "kling-3.0-turbo": { unit: "second", credits: { "720p": 18, "1080p": 22.5 }, source: docs("kling/v3-turbo-image-to-video") },
  "grok-imagine": { unit: "second", credits: { "480p": 2.4, "720p": 4.5, "1080p": 8 }, source: docs("grok-imagine/image-to-video") },
  "grok-imagine-1-5-preview": { unit: "second", credits: { "480p": 2.4, "720p": 4.5, "1080p": 8 }, source: docs("grok-imagine/1-5-preview") },
  "seedance-2": { unit: "second", credits: { "480p": 19, "720p": 41, "1080p": 102, "4k": 208 }, withVideoInput: { "480p": 11.5, "720p": 25, "1080p": 62, "4k": 128 }, source: docs("bytedance/seedance-2") },
  "seedance-2-fast": { unit: "second", credits: { "480p": 11.7, "720p": 24.8 }, withVideoInput: { "480p": 6.8, "720p": 15 }, source: docs("bytedance/seedance-2-fast") },
  "seedance-2-mini": { unit: "second", credits: { "480p": 3.8, "720p": 8.2 }, withVideoInput: { "480p": 2.4, "720p": 5 }, source: docs("bytedance/seedance-2-mini") },
  "seedance-2-5": seedance25,
  "seedance-2-5-edit": { ...seedance25, note: "Edit always carries video input; charged per second of input plus output." },
  happyhorse: { unit: "second", credits: { "720p": 22.5, "1080p": 29 }, source: docs("happyhorse-1-1/image-to-video") },
  "minimax-h3": { unit: "second", credits: { "768p": 8, "2k": 13 }, withVideoInput: { "768p": 8, "2k": 13 }, source: docs("minimax-h3/image-to-video"), note: "Input video seconds are charged at the same rate; the first five input images are free." },
  "kling-3.0-motion-control": { unit: "second", credits: { "720p": 20, "1080p": 27 }, source: docs("kling/motion-control-v3") },
};
/** Normalise the app's resolution/mode spellings to the table's keys. */
export function normalizeResolution(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const v = value.toLowerCase();
  return ({ std: "720p", pro: "1080p", hd: "720p", "4k": "4k", "768p": "768p", "2k": "2k" } as Record<string, string>)[v] ?? (/^\d+p$/.test(v) ? v : v);
}
export interface Estimate { usd: number; credits?: number; basis: "manual" | "actual" | "published" | "quoted" | "unknown"; detail: string; source?: string }
export function estimateKieImage(modelId: string, quality = "1k"): Estimate | undefined {
  const rule = KIE_PRICES[modelId];
  if (!rule || rule.unit !== "image") return undefined;
  const q = quality.toLowerCase();
  const credits = typeof rule.credits === "number" ? rule.credits : rule.credits[q] ?? rule.credits["1k"] ?? Object.values(rule.credits)[0];
  return { usd: creditsToUsd(credits), credits, basis: "published", detail: `Published Kie.ai price (${credits} credits${typeof rule.credits === "number" ? "" : ` at ${q}`}) as of ${PRICING_AS_OF}.`, source: rule.source };
}
export interface VideoEstimateInput { seconds?: number; resolution?: string; sound?: boolean; /** Seconds of reference video supplied (motion transfer, edit). */ inputSeconds?: number }
export function estimateKieVideo(modelId: string, input: VideoEstimateInput = {}): Estimate | undefined {
  const rule = KIE_PRICES[modelId], model = VIDEO_MODELS.find(m => m.id === modelId);
  if (!rule || rule.unit === "image") return undefined;
  const resolution = normalizeResolution(input.resolution ?? model?.defaultResolution ?? model?.defaultMode) ?? Object.keys(rule.credits)[0];
  const seconds = input.seconds ?? (model?.defaultDuration && model.defaultDuration > 0 ? model.defaultDuration : 5);
  if (rule.unit === "video") {
    if (input.inputSeconds && rule.withVideoInput?.[resolution] !== undefined) { const credits = rule.withVideoInput[resolution]; return { usd: creditsToUsd(credits), credits, basis: "published", detail: `Published Kie.ai price (${credits} credits per video with video input, ${resolution}) as of ${PRICING_AS_OF}.`, source: rule.source }; }
    const table = rule.credits[resolution] ?? Object.values(rule.credits)[0];
    const credits = table.any ?? table[String(Object.keys(table).map(Number).filter(Number.isFinite).sort((a, b) => Math.abs(a - seconds) - Math.abs(b - seconds))[0])];
    return { usd: creditsToUsd(credits), credits, basis: "published", detail: `Published Kie.ai price (${credits} credits per video, ${resolution}${table.any ? "" : `, ${seconds}s`}) as of ${PRICING_AS_OF}.`, source: rule.source };
  }
  const perSecond = (input.inputSeconds && rule.withVideoInput?.[resolution]) || (input.sound && rule.withAudio?.[resolution]) || rule.credits[resolution] || Object.values(rule.credits)[0];
  const billed = input.inputSeconds && rule.withVideoInput?.[resolution] ? seconds + input.inputSeconds : seconds;
  const credits = Math.round(perSecond * billed * 100) / 100;
  return { usd: creditsToUsd(credits), credits, basis: "published", detail: `Published Kie.ai rate (${perSecond} credits/s at ${resolution}${input.inputSeconds && rule.withVideoInput?.[resolution] ? `, ${billed}s of input plus output` : `, ${seconds}s`}${input.sound && rule.withAudio ? ", with audio" : ""}) as of ${PRICING_AS_OF}.`, source: rule.source };
}
/** Median of recent actual charges for a model, when the provider has reported them. The caller supplies the charges (see lib/campaigns/estimates.ts). */
export function learnedEstimate(provider: string, actualCosts: number[]): Estimate | undefined {
  const costs = actualCosts.filter(c => c > 0).sort((a, b) => a - b);
  if (!costs.length) return undefined;
  const mid = Math.floor(costs.length / 2), median = costs.length % 2 ? costs[mid] : (costs[mid - 1] + costs[mid]) / 2;
  return { usd: Math.round(median * 10000) / 10000, basis: "actual", detail: `Median of your last ${costs.length} actual ${provider} charge${costs.length === 1 ? "" : "s"} for this model.` };
}
export interface ResolveInput { provider: string; modelId: string; kind: "image" | "video"; manualUsd?: number | null; image?: { quality?: string }; video?: VideoEstimateInput; /** Recent actual charges for this route, newest first, when known. */ actualCosts?: number[] }
/** Manual override, then real charges, then the published table, then unknown. Account-backed providers cost $0 in API spend. */
export function resolveEstimate(input: ResolveInput): Estimate {
  if (input.manualUsd != null) return { usd: input.manualUsd, basis: "manual", detail: "Entered in Campaign controls." };
  if (input.provider === "codex" || input.provider === "antigravity") return { usd: 0, basis: "published", detail: "Connected account: no per-generation API charge; subscription limits apply." };
  const learned = input.actualCosts?.length ? learnedEstimate(input.provider, input.actualCosts) : undefined;
  if (learned) return learned;
  if (input.provider === "kie") {
    const published = input.kind === "image" ? estimateKieImage(input.modelId, input.image?.quality) : estimateKieVideo(input.modelId, input.video);
    if (published) return published;
  }
  const name = (input.kind === "image" ? IMAGE_MODELS : VIDEO_MODELS).find(m => m.id === input.modelId)?.name ?? input.modelId;
  return { usd: 0, basis: "unknown", detail: `No published or observed price for ${name}. Enter an estimate in Campaign controls.` };
}
