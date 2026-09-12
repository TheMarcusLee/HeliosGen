import { replyDirector, directorReplySchema, startDirector, approveDirector, controlDirector, advanceDirector, approveDirectorSchema, chooseIdentity, identityProposalSchema, updateIdentityProposal } from "@/lib/campaigns/director/engine";
import { startDirectorSchema, directorBusy } from "@/lib/campaigns/director/types";
import { randomUUID } from "node:crypto";
import { memorySchema, budgetSchema, budgetUsage } from "@/lib/campaigns/operations";
import { discoverTrends, discoverTikTokTrends } from "@/lib/campaigns/trends";
import { draftPost, queuePost, cancelPost, postDraftSchema } from "@/lib/campaigns/publishing";
import { ACCOUNT_IMAGE_MODEL } from "@/lib/campaigns/providers";
import { isAccountChatModel } from "@/lib/campaigns/agents";
import { NextRequest } from "next/server";
import { z } from "zod";
import { getCampaign, saveCampaign } from "@/lib/campaigns/db";
import { advanceCampaign, planCampaign, saveInfluencer, selectIdentity, startCampaignRun, reviseText, retryRun, editPlan, planEditSchema } from "@/lib/campaigns/service";
import { MODELS } from "@/lib/models";
import { IMAGE_MODELS, VIDEO_MODELS } from "@/lib/modelConfig";
import { MOTION_MODELS } from "@/lib/campaigns/director/motionModels";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const actionSchema = z.discriminatedUnion("action", [
  directorReplySchema.extend({ action: z.literal("director-reply"), runId: z.string() }),
  startDirectorSchema.extend({ action: z.literal("director-start") }),
  approveDirectorSchema.extend({ action: z.literal("director-approve"), runId: z.string() }),
  z.object({ action: z.literal("director-control"), runId: z.string(), operation: z.enum(["pause", "resume", "stop"]) }),
  z.object({ action: z.literal("director-advance") }),
  z.object({ action: z.literal("director-identity"), runId: z.string(), assetId: z.string() }),
  identityProposalSchema.extend({ action: z.literal("director-identity-proposal"), runId: z.string() }),
  z.object({ action: z.literal("revise-text"), assetId: z.string(), text: z.string().trim().min(1).max(8000) }),
  z.object({ action: z.literal("memory"), memory: memorySchema }),
  z.object({ action: z.literal("budget"), budget: budgetSchema }),
  z.object({ action: z.literal("discover"), query: z.string().trim().min(2).max(200), region: z.string().regex(/^[A-Z]{2}$/).default("US"), source: z.enum(["tiktok", "youtube"]).default("tiktok") }),
  z.object({ action: z.literal("add-trend"), title: z.string().trim().min(1).max(200), url: z.string().url().refine(u => u.startsWith("https://")), notes: z.string().max(2000) }),
  z.object({ action: z.literal("select-trend"), trendId: z.string(), selected: z.boolean() }),
  z.object({ action: z.literal("draft-post"), draft: postDraftSchema }),
  z.object({ action: z.literal("queue-post"), postId: z.string() }),
  z.object({ action: z.literal("cancel-post"), postId: z.string() }),
  z.object({ action: z.literal("message"), text: z.string().trim().min(1).max(12000), revisionOf: z.string().optional(), azureConfig: z.object({ azureEndpoint: z.string().optional(), azureDeployment: z.string().optional(), azureModelName: z.string().optional() }).optional() }),
  z.object({ action: z.literal("start"), messageId: z.string() }),
  planEditSchema.extend({ action: z.literal("edit-plan"), messageId: z.string() }),
  z.object({ action: z.literal("advance") }),
  z.object({ action: z.literal("identity"), identityId: z.string().nullable() }),
  z.object({ action: z.literal("save-identity"), assetId: z.string() }),
  z.object({ action: z.literal("review"), assetId: z.string(), review: z.enum(["pending", "approved", "rejected"]) }),
  z.object({ action: z.literal("run"), runId: z.string(), operation: z.enum(["pause", "resume", "stop", "retry"]) }),
  z.object({ action: z.literal("settings"), title: z.string().trim().min(1).max(120).optional(), model: z.string().optional(), imageModel: z.string().optional(), imageProvider: z.enum(["codex", "antigravity", "kie"]).optional(), imageFallback: z.boolean().optional(), videoModel: z.string().optional(), motionModel: z.string().optional(), referenceUrls: z.array(z.string().refine(s => /^\/generated\/[\w./%-]+$/.test(s) || /^https:\/\//.test(s), "Use an uploaded image or HTTPS URL.")).max(8).optional() }),
]);
export async function GET(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try { return Response.json({ campaign: getCampaign((await context.params).id) }); }
  catch { return Response.json({ error: "Campaign not found." }, { status: 404 }); }
}
export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = actionSchema.parse(await req.json());
    if (body.action === "director-reply") return Response.json({ campaign: replyDirector(id, body.runId, body) });
    if (body.action === "director-start") return Response.json({ campaign: startDirector(id, body) });
    if (body.action === "director-approve") return Response.json({ campaign: approveDirector(id, body.runId, body) });
    if (body.action === "director-control") return Response.json({ campaign: controlDirector(id, body.runId, body.operation) });
    if (body.action === "director-advance") return Response.json({ campaign: await advanceDirector(id) });
    if (body.action === "director-identity") return Response.json({ campaign: chooseIdentity(id, body.runId, body.assetId) });
    if (body.action === "director-identity-proposal") return Response.json({ campaign: updateIdentityProposal(id, body.runId, body) });
    if (body.action === "message") return Response.json({ campaign: await planCampaign(id, body.text, body.azureConfig, undefined, body.revisionOf) });
    if (body.action === "start") return Response.json({ campaign: startCampaignRun(id, body.messageId) });
    if (body.action === "edit-plan") return Response.json({ campaign: editPlan(id, body.messageId, body) });
    if (body.action === "advance") return Response.json({ campaign: await advanceCampaign(id) });
    if (body.action === "identity") return Response.json({ campaign: selectIdentity(id, body.identityId) });
    if (body.action === "save-identity") return Response.json({ campaign: saveInfluencer(id, body.assetId) });
    if (body.action === "revise-text") return Response.json({ campaign: reviseText(id, body.assetId, body.text) });
    if (body.action === "run" && body.operation === "retry") return Response.json({ campaign: retryRun(id, body.runId) });
    if (body.action === "discover") return Response.json({ campaign: body.source === "youtube" ? await discoverTrends(id, body.query, body.region) : await discoverTikTokTrends(id, body.query) });
    if (body.action === "draft-post") return Response.json({ campaign: draftPost(id, body.draft) });
    if (body.action === "queue-post") return Response.json({ campaign: queuePost(id, body.postId) });
    if (body.action === "cancel-post") return Response.json({ campaign: await cancelPost(id, body.postId) });
    const c = getCampaign(id);
    if (body.action === "memory" || body.action === "budget") {
      if (directorBusy(c) || c.planning || c.runs.some(r => r.status === "running" || r.status === "paused")) throw new Error("Finish production before changing its brief or budget.");
      if (body.action === "memory") {
        c.memory = body.memory; c.memoryHistory ??= [];
        c.memoryHistory.push({ version: c.memoryHistory.length + 1, savedAt: Date.now(), memory: structuredClone(body.memory) });
      } else {
        const used = budgetUsage(c);
        if (body.budget.maxGenerations < used.generations) throw new Error("The limit cannot be below generations already submitted.");
        c.budget = body.budget;
      }
    }
    if (body.action === "add-trend") {
      c.trends ??= [];
      if (c.trends.length >= 50) throw new Error("Keep at most 50 inspiration sources per campaign.");
      c.trends.push({ id: randomUUID(), title: body.title, url: body.url, notes: body.notes, manual: true, channel: "Added by you", publishedAt: "", fetchedAt: Date.now(), views: 0, likes: 0, viewsPerDay: 0, selected: true, query: "" });
    }
    if (body.action === "select-trend") {
      const trend = c.trends?.find(t => t.id === body.trendId);
      if (!trend) throw new Error("Trend not found.");
      trend.selected = body.selected;
    }
    if (body.action === "settings") {
      if (directorBusy(c) || c.planning || c.runs.some(r => r.status === "running" || r.status === "paused")) throw new Error("Wait for the current production before changing campaign settings.");
      if (body.model && !isAccountChatModel(body.model) && !MODELS.some(m => m.id === body.model)) throw new Error("Unknown assistant model.");
      if (body.imageModel && !IMAGE_MODELS.some(m => m.id === body.imageModel && m.supportsImages)) throw new Error("Choose a reference-capable image model.");
      if (body.videoModel && !VIDEO_MODELS.some(m => m.id === body.videoModel && m.handles.includes("startFrame") && m.durations.includes(5) && !m.apiInput.useMotionControl && !m.requiredHandles?.some(h => h !== "startFrame"))) throw new Error("Choose an image-to-video model.");
      if (body.motionModel && !MOTION_MODELS.some(m => m.id === body.motionModel)) throw new Error("Choose a video model that accepts a reference video.");
      const provider = body.imageProvider ?? c.imageProvider ?? "kie";
      if (provider !== "kie" && (body.imageModel ?? c.imageModel) !== ACCOUNT_IMAGE_MODEL[provider]) throw new Error(provider === "codex" ? "OpenAI account images require GPT Image 2." : "Google account images use Nano Banana Pro through Antigravity.");
      if (c.budget) {
        if ((body.imageModel && body.imageModel !== c.imageModel) || (body.imageProvider && body.imageProvider !== c.imageProvider)) c.budget.imageEstimateUsd = null;
        if (body.videoModel && body.videoModel !== c.videoModel) c.budget.videoEstimateUsd = null;
      }
      for (const key of ["title", "model", "imageProvider", "imageFallback", "imageModel", "videoModel", "motionModel", "referenceUrls"] as const) {
        if (body[key] !== undefined) Object.assign(c, { [key]: body[key] });
      }
    } else if (body.action === "review") {
      const asset = c.assets.find(a => a.id === body.assetId);
      if (!asset) throw new Error("Asset not found.");
      asset.review = body.review;
    } else if (body.action === "run") {
      const run = c.runs.find(r => r.id === body.runId);
      if (!run) throw new Error("Run not found.");
      if (body.operation === "pause" && run.status === "running") run.status = "paused";
      if (body.operation === "resume" && run.status === "paused") run.status = "running";
      if (body.operation === "stop") {
        if (run.steps.some(s => s.status === "running" || s.status === "submitting")) throw new Error("The current provider job is still running. Pause to prevent subsequent generations, then stop after it finishes.");
        run.status = "error";
        run.steps.filter(s => s.status === "queued").forEach(s => { s.status = "error"; s.error = "Stopped by user."; });
      }
    }
    return Response.json({ campaign: saveCampaign(c) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Campaign action failed." }, { status: 400 });
  }
}
