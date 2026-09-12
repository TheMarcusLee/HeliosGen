import type { DirectorRun, MediaEvidence } from "./director/types";
import type { z as Zod } from "zod";
import type { reviewSchema } from "./director/types";
import type { CampaignMemory, CampaignBudget, TrendCandidate, CampaignPost } from "./operations";
import { z } from "zod";
import type { IdentityAsset } from "../cloneMe";
import type { CampaignImageProvider } from "./providers";

export const stepSchema = z.object({
  kind: z.enum(["image", "video", "text"]),
  title: z.string().min(1).max(120),
  pack: z.string().min(1).max(120),
  prompt: z.string().min(1).max(8000),
  look: z.string().max(2000).default(""),
  referenceStep: z.number().int().min(0).nullable().default(null),
  aspectRatio: z.enum(["1:1", "9:16", "16:9", "3:4", "4:3"]).default("9:16"),
});
export const planSchema = z.object({
  reply: z.string().min(1).max(12000),
  title: z.string().min(1).max(120),
  assumptions: z.array(z.string().max(1000)).max(12).default([]),
  identityDraft: z.object({ name: z.string().min(1).max(120), dna: z.string().min(1).max(4000), personality: z.string().max(2000) }).nullable().default(null),
  steps: z.array(stepSchema).max(12),
}).superRefine((plan, ctx) => {
  plan.steps.forEach((step, index) => {
    if (step.referenceStep !== null && (step.referenceStep >= index || plan.steps[step.referenceStep]?.kind !== "image")) {
      ctx.addIssue({ code: "custom", message: "References must point to an earlier image step.", path: ["steps", index, "referenceStep"] });
    }
  });
});
export type CreativePlan = z.infer<typeof planSchema>;
export type ProductionStep = z.infer<typeof stepSchema> & {
  id: string;
  status: "queued" | "submitting" | "running" | "done" | "error";
  taskId?: string;
  error?: string;
  /** Diagnostic detail behind the step's "More info" toggle: provider, model, raw output, likely cause. */
  errorDetail?: string;
  startedAt?: number;
  reservedUsd?: number;
};
export interface CampaignAsset {
  directorId?: string;
  sourceId?: string;
  productionKind?: "anchor" | "motion" | "still" | "identity";
  reviewEvidence?: MediaEvidence;
  automatedReview?: Zod.infer<typeof reviewSchema>;
  id: string;
  messageId: string;
  stepId: string;
  title: string;
  pack: string;
  kind: "image" | "video" | "text";
  url?: string;
  text?: string;
  prompt: string;
  look: string;
  review: "pending" | "approved" | "rejected";
  identityId?: string;
  parentAssetId?: string;
  createdAt?: number;
  version?: number;
}
export interface CampaignMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
  plan?: CreativePlan;
  revisionOf?: string;
}
export interface CampaignRun {
  memory?: CampaignMemory;
  revisionOf?: string;
  id: string;
  messageId: string;
  workflowId: string;
  status: "running" | "paused" | "done" | "error";
  steps: ProductionStep[];
  identity?: IdentityAsset;
  referenceUrls?: string[];
  imageProvider?: CampaignImageProvider;
  imageModel: string;
  videoModel: string;
}
export interface Campaign {
  directors?: DirectorRun[];
  memory?: CampaignMemory;
  memoryHistory?: { version: number; savedAt: number; memory: CampaignMemory }[];
  budget?: CampaignBudget;
  trends?: TrendCandidate[];
  posts?: CampaignPost[];
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: CampaignMessage[];
  assets: CampaignAsset[];
  runs: CampaignRun[];
  identity?: IdentityAsset;
  referenceUrls: string[];
  model: string;
  imageProvider?: CampaignImageProvider;
  imageModel: string;
  videoModel: string;
  /** Default reference-video model for Research & adapt runs. */
  motionModel?: string;
  planning?: boolean;
  planningStartedAt?: number;
  error?: string;
}
export type CampaignSummary = Pick<Campaign, "id" | "title" | "updatedAt"> & { assetCount: number; running: boolean };

export function parseCreativePlan(text: string): CreativePlan {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  return planSchema.parse(JSON.parse(cleaned));
}

export function effectivePrompt(step: Pick<ProductionStep, "prompt" | "look">, identity?: IdentityAsset): string {
  return [identity ? `Preserve this identity's face, body proportions, skin tone and hair baseline: ${identity.triggerWord}. ${identity.basePrompts.join("\n")}` : "",
    step.prompt, step.look ? `This content pack's styling and setting: ${step.look}. Styling is specific to this pack; preserve the identity.` : ""].filter(Boolean).join("\n\n");
}
