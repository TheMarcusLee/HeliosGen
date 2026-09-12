import { z } from "zod";
import type { CampaignMemory } from "../operations";
import type { IdentityAsset } from "../../cloneMe";
import type { AccountProvider, CampaignImageProvider } from "../providers";
export const startDirectorSchema = z.object({ revisionOf: z.string().optional(), objective: z.string().trim().min(10).max(8000), searchProvider: z.enum(["tiktok", "web"]).default("tiktok"), videoModel: z.string().optional(), sourceUrls: z.array(z.string().max(2000)).max(8).default([]), reels: z.number().int().min(1).max(3).default(1), stillsPerReel: z.number().int().min(0).max(3).default(1) });
export const decisionSchema = z.discriminatedUnion("tool", [
  z.object({ tool: z.literal("search"), query: z.string().min(3).max(400), reason: z.string().max(1200) }),
  z.object({ tool: z.literal("retrieve"), sourceId: z.string(), reason: z.string().max(1200) }),
  z.object({ tool: z.literal("inspect_source"), sourceId: z.string(), reason: z.string().max(1200) }),
  z.object({ tool: z.literal("select_source"), sourceId: z.string(), start: z.number().min(0), end: z.number().min(3), direction: z.string().min(10).max(2000), reason: z.string().max(1200) }),
  z.object({ tool: z.literal("propose_identity"), name: z.string().min(1).max(120), dna: z.string().min(20).max(4000), personality: z.string().max(2000), direction: z.string().min(10).max(2000), reason: z.string().max(1200) }),
  z.object({ tool: z.literal("generate"), sourceId: z.string(), kind: z.enum(["anchor", "motion", "still"]), title: z.string().min(1).max(120), prompt: z.string().min(10).max(2500), reason: z.string().max(1200) }),
  z.object({ tool: z.literal("review_output"), assetId: z.string(), reason: z.string().max(1200) }),
  z.object({ tool: z.literal("caption"), sourceId: z.string(), text: z.string().min(1).max(4000), reason: z.string().max(1200) }),
  z.object({ tool: z.literal("finish"), summary: z.string().min(1).max(3000) }),
  z.object({ tool: z.literal("need_input"), question: z.string().min(1).max(2000) }),
]);
export type Decision = z.infer<typeof decisionSchema>;
export const inspectionSchema = z.object({ suitable: z.boolean(), score: z.number().min(0).max(100), subjectCount: z.number().int().min(0), faceVisibility: z.enum(["clear", "partial", "hidden"]), occlusion: z.enum(["low", "medium", "high"]), motion: z.string().max(1500), aestheticFit: z.string().max(1500), issues: z.array(z.string().max(500)).max(12), axes: z.object({ subjectConsistency: z.number().min(0).max(1), staticCamera: z.number().min(0).max(1), framing: z.number().min(0).max(1), frontFacing: z.number().min(0).max(1), clarity: z.number().min(0).max(1) }).optional(), observations: z.array(z.object({ second: z.number().min(0), observation: z.string().max(500) })).min(2).max(16), suggestedStart: z.number().min(0), suggestedEnd: z.number().min(0), summary: z.string().max(1500) });
export const reviewSchema = z.object({ pass: z.boolean(), identityScore: z.number().min(0).max(100), motionScore: z.number().min(0).max(100), issues: z.array(z.string().max(500)).max(12), observations: z.array(z.string().max(500)).min(1).max(16), correction: z.string().max(2500), summary: z.string().max(1500) });
export type MediaEvidence = { localUrl: string; duration: number; width: number; height: number; sheets: string[]; sampleTimes: number[]; cutTimes: number[]; };
export interface DirectorSource {
  downloadUrl?: string;
  /** Batch-relative discovery ranking, when the source came from live search. */
  ranking?: { score: number; reasons: string[] };
  id: string; url: string; title: string; discoveredAt: number; query?: string;
  status: "found" | "retrieved" | "inspected" | "unavailable";
  media?: MediaEvidence; metrics?: { views?: number; likes?: number; publishedAt?: string; checkedAt: number }; error?: string;
  inspection?: z.infer<typeof inspectionSchema>;
  selection?: { start: number; end: number; clip: MediaEvidence; direction: string };
}
export interface DirectorJob {
  id: string; sourceId?: string; kind: "anchor" | "motion" | "still" | "identity"; title: string; prompt: string;
  status: "submitting" | "running" | "done" | "error" | "uncertain"; taskId?: string; assetId?: string; startedAt: number; reservedUsd?: number; error?: string;
}
export interface DirectorRun {
  revisionOf?: string;
  id: string; messageId: string; objective: string; reels: number; stillsPerReel: number;
  status: "running" | "awaiting_approval" | "awaiting_identity" | "paused" | "blocked" | "done" | "stopped";
  /** Influencer designed by the agent to fit the selected footage; candidates are generated, the user picks one. */
  identityProposal?: { name: string; dna: string; personality: string; direction: string; candidates: string[] };
  userReplies?: string[];
  /** "tiktok" is the built-in live browser search; "web" is OpenAI account web search. Older records may carry "scrapecreators". */
  searchProvider?: "tiktok" | "web" | "scrapecreators"; searchEstimateUsd?: number; searchRequests?: number;
  /** Reference-video model for motion adaptation. Older runs without it use the default. */
  videoModel?: string;
  createdAt: number; decisionCount: number; sources: DirectorSource[]; jobs: DirectorJob[];
  events: { id: string; at: number; tool: string; summary: string; outcome?: string }[];
  memory?: CampaignMemory; identity?: IdentityAsset; referenceUrls: string[]; imageProvider: CampaignImageProvider; imageModel: string;
  /** Connected account that reasons, inspects and reviews for this run. Older runs default to Codex. */
  agentProvider?: AccountProvider;
  proposal?: Extract<Decision, { tool: "generate" | "propose_identity" }>;
  approval?: { at: number; maxGenerations: number; imageEstimateUsd?: number; motionEstimateUsd?: number; maxReservedUsd?: number; referenceReuseConfirmed: boolean };
  error?: string;
}
export function directorBusy(c: { directors?: DirectorRun[] }) { return !!c.directors?.some(d => ["running", "paused"].includes(d.status) || d.jobs.some(j => ["running", "submitting"].includes(j.status))); }
export function parseJSON(text: string) { return JSON.parse(text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")); }
