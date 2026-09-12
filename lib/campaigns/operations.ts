import { z } from "zod";
import type { Campaign, CreativePlan } from "./types";
import { resolveEstimate, type Estimate, type VideoEstimateInput } from "../pricing";
import { clipLimits, motionModel } from "./director/motionModels";
export const referenceUrl = z.string().max(2000).refine(s => /^\/generated\/[\w./%-]+$/.test(s) || /^https:\/\//.test(s), "Use an uploaded reference or HTTPS URL.");
export const memorySchema = z.object({
  brand: z.string().max(200).default(""), brief: z.string().max(8000).default(""), audience: z.string().max(2000).default(""), voice: z.string().max(2000).default(""), constraints: z.string().max(4000).default(""),
  products: z.array(z.object({ name: z.string().min(1).max(200), description: z.string().max(2000), url: z.union([referenceUrl, z.literal("")]).default("") })).max(12).default([]),
});
export type CampaignMemory = z.infer<typeof memorySchema>;
export const budgetSchema = z.object({
  maxGenerations: z.number().int().min(0).max(10000).default(24),
  maxEstimatedUsd: z.number().min(0).max(100000).nullable().default(null),
  imageEstimateUsd: z.number().positive().max(1000).nullable().default(null),
  videoEstimateUsd: z.number().positive().max(1000).nullable().default(null),
});
export type CampaignBudget = z.infer<typeof budgetSchema>;
export function budgetUsage(c: Campaign) {
  const allocated = c.runs.flatMap(r => r.steps.filter(s => s.kind !== "text" && (!!s.startedAt || (s.status === "queued" && (r.status === "running" || r.status === "paused")))));
  let generations = allocated.length, estimatedUsd = allocated.reduce((n, s) => n + (s.reservedUsd ?? 0), 0), unknown = allocated.some(s => s.reservedUsd === undefined);
  for (const run of c.directors ?? []) {
    generations += run.jobs.length;
    estimatedUsd += run.jobs.reduce((n, j) => n + (j.reservedUsd ?? 0), 0);
    unknown ||= run.jobs.some(j => j.reservedUsd === undefined);
    if (run.approval && !["done", "stopped"].includes(run.status)) {
      const remaining = Math.max(0, (run.approval.jobsAtApproval ?? 0) + run.approval.maxGenerations - run.jobs.filter(j => !j.fallbackOf).length);
      generations += remaining;
      estimatedUsd += remaining * Math.max(run.approval.imageEstimateUsd ?? 0, run.approval.motionEstimateUsd ?? 0);
      unknown ||= remaining > 0 && (run.approval.imageEstimateUsd === undefined || run.approval.motionEstimateUsd === undefined);
    }
  }
  return { generations, estimatedUsd, unknown };
}
export interface CampaignEstimates { image: Estimate; video: Estimate; motion: Estimate }
export type CampaignRoutes = Pick<Campaign, "budget" | "imageProvider" | "imageModel" | "videoModel" | "motionModel">;
/**
 * Per-generation estimates for this campaign's routes from manual entry and the
 * published table only. Safe in the browser. The server variant in
 * lib/campaigns/estimates.ts also folds in observed charges from the ledger.
 */
export function campaignEstimates(c: CampaignRoutes, motion: VideoEstimateInput = {}, actualCosts: (provider: string, modelId: string) => number[] = () => []): CampaignEstimates {
  const budget = c.budget ?? budgetSchema.parse({});
  const model = motionModel(c.motionModel), limits = clipLimits(model);
  const seconds = motion.seconds ?? Math.min(5, limits.maxSeconds);
  const imageProvider = c.imageProvider ?? "kie";
  return {
    image: resolveEstimate({ provider: imageProvider, modelId: c.imageModel, kind: "image", manualUsd: budget.imageEstimateUsd, actualCosts: actualCosts(imageProvider, c.imageModel) }),
    video: resolveEstimate({ provider: "kie", modelId: c.videoModel, kind: "video", manualUsd: budget.videoEstimateUsd, video: { seconds: 5 }, actualCosts: actualCosts("kie", c.videoModel) }),
    motion: resolveEstimate({ provider: "kie", modelId: model.id, kind: "video", video: { seconds, inputSeconds: seconds, ...motion }, actualCosts: actualCosts("kie", model.id) }),
  };
}
const usdOrUnknown = (e: Estimate) => e.basis === "unknown" ? undefined : e.usd;
export function quotePlan(c: Campaign, plan: CreativePlan, estimates: CampaignEstimates = campaignEstimates(c)) {
  const budget = c.budget ?? budgetSchema.parse({});
  const costs = plan.steps.map(s => s.kind === "text" ? 0 : s.kind === "image" ? usdOrUnknown(estimates.image) : usdOrUnknown(estimates.video));
  const mediaCount = plan.steps.filter(s => s.kind !== "text").length;
  const usage = budgetUsage(c);
  const estimatedUsd = costs.reduce<number>((n, amount) => n + (amount ?? 0), 0);
  const unknown = costs.some(amount => amount === undefined);
  const reason = usage.generations + mediaCount > budget.maxGenerations ? "Campaign generation limit would be exceeded." : budget.maxEstimatedUsd !== null && (unknown || usage.unknown) ? "No price is known for a selected model. Enter an estimate in Campaign controls before using a dollar planning limit. Existing unpriced submissions must also be accounted for." : budget.maxEstimatedUsd !== null && usage.estimatedUsd + estimatedUsd > budget.maxEstimatedUsd + 0.000001 ? "Campaign estimated-cost limit would be exceeded." : undefined;
  return { costs, mediaCount, estimatedUsd, unknown, reason };
}
export interface TrendCandidate { manual?: boolean; notes?: string; id: string; title: string; url: string; channel: string; publishedAt: string; fetchedAt: number; views: number; likes: number; viewsPerDay: number; selected: boolean; query: string; }
export interface CampaignPost {
  id: string; assetIds: string[]; caption: string; accountIds: number[]; scheduledAt: string;
  status: "draft" | "queued" | "submitting" | "scheduled" | "processing" | "posted" | "failed" | "uncertain" | "cancelled";
  createdAt: number; approvedAt?: number; providerId?: string; error?: string; checkedAt?: number;
}
