import { getKieApiToken } from "../../guest/db";
import { searchTikTok } from "./searchProvider";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { z } from "zod";
import { POST as generateImage } from "@/app/api/generate/route";
import { POST as generateVideo } from "@/app/api/generate-video/route";
import { GET as jobStatus } from "@/app/api/job-status/route";
import { getCampaign, saveCampaign } from "../db";
import { claimLease } from "../lease";
import { budgetSchema, budgetUsage } from "../operations";
import { effectivePrompt, type Campaign, type CampaignAsset } from "../types";
import { getCodexAccountStatus } from "../../codexAccount";
import { IMAGE_MODELS } from "../../modelConfig";
import { decideNext, inspectSource, reviewOutput, searchSocial } from "./intelligence";
import { clipVideo, retrieveVideo, sourceUrl, motionImage } from "./media";
import { directorBusy, startDirectorSchema, type DirectorRun, type Decision } from "./types";
import { clipLimits, motionModel, motionModelSummary, motionRequestBody } from "./motionModels";

const request = (path: string, body?: unknown) => new NextRequest(`http://localhost${path}`, body === undefined ? undefined : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const defaults = { mediaReady: (kind: "anchor" | "motion" | "still", provider: "codex" | "kie") => kind !== "motion" && provider === "codex" || !!getKieApiToken(), decideNext, inspectSource, reviewOutput, searchSocial, searchTikTok, clipVideo, retrieveVideo, motionImage, generateImage, generateVideo, jobStatus, accountStatus: getCodexAccountStatus };
export type DirectorTools = Omit<typeof defaults, "generateImage" | "generateVideo" | "jobStatus"> & Record<"generateImage" | "generateVideo" | "jobStatus", (req: NextRequest) => Promise<Response>>;
export const approveDirectorSchema = z.object({ maxGenerations: z.number().int().min(2).max(30), motionEstimateUsd: z.number().positive().max(1000).optional(), referenceReuseConfirmed: z.literal(true) });
function event(run: DirectorRun, tool: string, summary: string, outcome?: string) { run.events.push({ id: randomUUID(), at: Date.now(), tool, summary, outcome }); }
function findRun(c: Campaign, id: string) { const run = c.directors?.find(d => d.id === id); if (!run) throw new Error("Director run not found."); return run; }
function inFlight(run: DirectorRun) { return run.jobs.some(j => j.status === "running" || j.status === "submitting"); }
function withLock<T>(id: string, work: () => T) { const release = claimLease(`production:${id}`); if (!release) throw new Error("Production is updating. Try again shortly."); try { return work(); } finally { release(); } }
export function startDirector(id: string, input: z.input<typeof startDirectorSchema>) {
  return withLock(id, () => {
    const c = getCampaign(id), data = startDirectorSchema.parse(input);
    if (c.planning || c.runs.some(r => ["running", "paused"].includes(r.status)) || c.directors?.some(d => !["done", "stopped"].includes(d.status) || inFlight(d))) throw new Error("Finish or stop the active production first.");
    if (data.revisionOf && !c.assets.some(a => a.id === data.revisionOf && a.directorId)) throw new Error("Director revision source not found.");
    const videoModel = motionModel(data.videoModel ?? c.motionModel).id;
    const urls = [...new Set(data.sourceUrls.map(sourceUrl))];
    const run: DirectorRun = { id: randomUUID(), messageId: randomUUID(), ...data, videoModel, createdAt: Date.now(), decisionCount: 0, status: "running", jobs: [], events: [], sources: urls.map(url => ({ id: randomUUID(), url, title: url.startsWith("/generated/") ? "Uploaded motion reference" : "Supplied social reference", discoveredAt: Date.now(), status: "found" })), memory: structuredClone(c.memory), identity: structuredClone(c.identity), referenceUrls: [...c.referenceUrls], imageProvider: c.imageProvider ?? "kie", imageModel: c.imageModel };
    event(run, "start", "Research started. Source retrieval and visual inspection run in the background; media generation waits for your approval.");
    c.directors ??= []; c.directors.push(run); c.error = undefined;
    c.messages.push({ id: randomUUID(), role: "user", content: data.objective, createdAt: Date.now() }, { id: run.messageId, role: "assistant", content: "I’m finding and inspecting real source footage, then choosing a motion reference that fits this campaign.", createdAt: Date.now() });
    if (c.title === "Untitled campaign") c.title = data.objective.slice(0, 80);
    return saveCampaign(c);
  });
}
export function approveDirector(id: string, runId: string, input: z.input<typeof approveDirectorSchema>) {
  return withLock(id, () => {
    const c = getCampaign(id), run = findRun(c, runId), data = approveDirectorSchema.parse(input);
    if (run.status !== "awaiting_approval" || !run.proposal) throw new Error("This run is not awaiting production approval.");
    if (c.planning || c.runs.some(r => ["running", "paused"].includes(r.status)) || directorBusy({ directors: c.directors?.filter(d => d.id !== runId) })) throw new Error("Finish other production first.");
    if (!c.identity?.references.length) throw new Error("Select or build and save an influencer identity before production.");
    if (c.identity.defaults.contentClass === "adult") throw new Error("Director production currently supports SFW identities.");
    if (!IMAGE_MODELS.some(m => m.id === c.imageModel && m.supportsImages && m.ratios.includes("9:16"))) throw new Error("Choose a reference-capable image model supporting 9:16.");
    const model = motionModel(run.videoModel);
    if (data.maxGenerations < run.reels * (2 + run.stillsPerReel)) throw new Error("The allowance must cover at least one anchor, motion video, and requested stills for each Reel.");
    const budget = c.budget ?? budgetSchema.parse({}), used = budgetUsage(c);
    const imageEstimateUsd = c.imageProvider === "codex" ? 0 : budget.imageEstimateUsd ?? undefined;
    const known = imageEstimateUsd !== undefined && data.motionEstimateUsd !== undefined;
    const maxReservedUsd = known ? data.maxGenerations * Math.max(imageEstimateUsd!, data.motionEstimateUsd!) : undefined;
    if (used.generations + data.maxGenerations > budget.maxGenerations) throw new Error("The approved allowance exceeds the campaign generation limit.");
    if (budget.maxEstimatedUsd !== null && (!known || used.unknown)) throw new Error("Set image and motion-transfer estimates before using a dollar planning limit. Previously unpriced jobs also need accounting.");
    if (budget.maxEstimatedUsd !== null && used.estimatedUsd + maxReservedUsd! > budget.maxEstimatedUsd + 0.000001) throw new Error("The allowance exceeds the campaign estimated-cost limit.");
    // The source assessment is bound to the identity/brief that was actually inspected.
    if (JSON.stringify(c.identity) !== JSON.stringify(run.identity) || JSON.stringify(c.memory) !== JSON.stringify(run.memory) || JSON.stringify(c.referenceUrls) !== JSON.stringify(run.referenceUrls)) {
      run.identity = structuredClone(c.identity); run.memory = structuredClone(c.memory); run.referenceUrls = [...c.referenceUrls];
      run.sources.forEach(s => { s.inspection = undefined; s.selection = undefined; if (s.media) s.status = "retrieved"; });
      run.proposal = undefined; run.status = "running";
      event(run, "context_changed", "Identity or brief changed. Reassessing retrieved sources before requesting approval again.");
      return saveCampaign(c);
    }
    run.imageProvider = c.imageProvider ?? "kie"; run.imageModel = c.imageModel;
    run.approval = { ...data, imageEstimateUsd, maxReservedUsd, at: Date.now() }; run.status = "running"; run.error = undefined;
    event(run, "approved", `Up to ${data.maxGenerations} media generations authorized, including revisions. Motion: ${motionModelSummary(model)}. Outputs still need human review.`);
    return saveCampaign(c);
  });
}
export function controlDirector(id: string, runId: string, operation: "pause" | "resume" | "stop") {
  // Controls must remain responsive during a long inspection/provider call. The worker merges them at commit.
  const c = getCampaign(id), run = findRun(c, runId);
  if (operation === "stop") { run.jobs.filter(j => j.status === "submitting").forEach(j => { j.status = "uncertain"; j.error = "Stopped with an unknown submission outcome. Check the provider ledger before another generation."; }); run.status = "stopped"; event(run, "stop", "Stopped. An already submitted provider job will still be collected and counted."); }
  else if (operation === "pause" && run.status === "running") { run.status = "paused"; event(run, "pause", "Paused after the current operation."); }
  else if (operation === "resume" && ["paused", "blocked"].includes(run.status)) {
    if (run.jobs.some(j => j.status === "submitting")) throw new Error("A submission has no saved job ID. Check the provider ledger; this run cannot safely resubmit it.");
    if (c.planning || c.runs.some(r => ["running", "paused"].includes(r.status))) throw new Error("Finish the other production first.");
    run.status = "running"; run.error = undefined; run.decisionCount = Math.min(run.decisionCount, 55); event(run, "resume", "Resuming with saved sources, reviews, and remaining allowance.");
  } else throw new Error("This operation does not apply to the current run.");
  return saveCampaign(c);
}
export const directorReplySchema = z.object({ text: z.string().trim().min(1).max(4000), sourceUrls: z.array(z.string().max(2000)).max(8).default([]) });
export function replyDirector(id: string, runId: string, input: z.input<typeof directorReplySchema>) {
  return withLock(id, () => {
    const c = getCampaign(id), run = findRun(c, runId), data = directorReplySchema.parse(input);
    if (!["blocked", "paused"].includes(run.status)) throw new Error("Pause the director before adding guidance.");
    if (inFlight(run)) throw new Error("Wait for the submitted job to settle or check the provider ledger before continuing.");
    if (c.planning || c.runs.some(r => ["running", "paused"].includes(r.status))) throw new Error("Finish other production first.");
    if (run.approval && data.sourceUrls.length) throw new Error("The production approval binds its source clips. Start a new run to adapt different footage.");
    const urls = data.sourceUrls.map(sourceUrl).filter(url => !run.sources.some(s => s.url === url));
    if (run.sources.length + urls.length > 32) throw new Error("Source limit reached. Start a new run.");
    run.sources.push(...[...new Set(urls)].map(url => ({ id: randomUUID(), url, title: "Additional user reference", discoveredAt: Date.now(), status: "found" as const })));
    run.userReplies = [...(run.userReplies ?? []), data.text].slice(-6); run.status = "running"; run.error = undefined; run.decisionCount = Math.min(run.decisionCount, 48);
    event(run, "user_guidance", data.text);
    c.messages.push({ id: randomUUID(), role: "user", content: data.text, createdAt: Date.now() });
    return saveCampaign(c);
  });
}
export function delivered(run: DirectorRun, assets: CampaignAsset[]) {
  return run.sources.filter(s => {
    const items = assets.filter(a => a.sourceId === s.id);
    return items.some(a => a.productionKind === "motion" && a.automatedReview?.pass) && items.filter(a => a.productionKind === "still" && a.automatedReview?.pass && !items.some(b => b.parentAssetId === a.id && b.automatedReview?.pass)).length >= run.stillsPerReel && items.some(a => a.kind === "text");
  }).length >= run.reels;
}
export async function advanceDirector(id: string, tools: DirectorTools = defaults): Promise<Campaign> {
  const release = claimLease(`production:${id}`); if (!release) return getCampaign(id);
  try {
    const c = getCampaign(id), run = c.directors?.find(d => d.status === "running" || d.jobs.some(j => j.status === "running"));
    if (!run) return c;
    const ownAssets = () => c.assets.filter(a => a.directorId === run.id);
    const originalStatus = run.status;
    function commit() {
      release!.assertOwned();
      const latest = getCampaign(id), current = findRun(latest, run!.id);
      if (current.status !== originalStatus && ["paused", "stopped"].includes(current.status)) run!.status = current.status;
      const newEvents = current.events.filter(e => !run!.events.some(x => x.id === e.id)); run!.events.push(...newEvents);
      latest.directors = latest.directors!.map(d => d.id === run!.id ? run! : d);
      for (const asset of ownAssets()) {
        const found = latest.assets.find(a => a.id === asset.id);
        if (!found) latest.assets.push(asset);
        else { found.reviewEvidence = asset.reviewEvidence; found.automatedReview = asset.automatedReview; found.url = asset.url; }
      }
      return saveCampaign(latest);
    }
    try {
      const job = run.jobs.find(j => ["submitting", "running"].includes(j.status));
      if (job) {
        if (job.status === "submitting") throw new Error("Submission interrupted before a job ID was saved. Check the provider ledger; automatic retry is disabled.");
        const response = await tools.jobStatus(request(`/api/job-status?taskId=${encodeURIComponent(job.taskId!)}`)), result = await response.json();
        if (!response.ok || result.status === "not_found") throw new Error("Cannot recover the provider job. Check the provider ledger before continuing.");
        if (result.status === "error") { job.status = "error"; job.error = result.error || "Provider generation failed."; event(run, "generation_failed", job.error!); }
        else if (result.status === "done") {
          const url = result.videoUrl || result.imageUrls?.[0] || result.imageUrl;
          if (!url) throw new Error("Provider completed without a media output.");
          const parent = ownAssets().filter(a => a.sourceId === job.sourceId && a.productionKind === job.kind && a.automatedReview?.pass === false).at(-1) ?? c.assets.find(a => a.id === run.revisionOf && a.productionKind === job.kind);
          const source = run.sources.find(s => s.id === job.sourceId)!;
          const asset: CampaignAsset = { id: randomUUID(), directorId: run.id, sourceId: job.sourceId, productionKind: job.kind, messageId: run.messageId, stepId: job.id, title: job.title, pack: source.title, kind: job.kind === "motion" ? "video" : "image", url, prompt: job.prompt, look: source.selection!.direction, review: "pending", createdAt: Date.now(), parentAssetId: parent?.id, version: (parent?.version ?? 0) + 1 };
          c.assets.push(asset); job.assetId = asset.id; job.status = "done"; event(run, "generated", `${job.title} is ready for visual QA.`);
        } else if (Date.now() - job.startedAt > 60 * 60_000) { job.status = "error"; job.error = "Polling exceeded one hour. Check the provider ledger."; throw new Error(job.error); }
        return commit();
      }
      if (run.status !== "running") return c;
      if (run.decisionCount >= 64) throw new Error("The research/decision limit was reached. Review the evidence and resume if more work is needed.");
      if (!(await tools.accountStatus()).chatReady) throw new Error("Connect your OpenAI account in Settings for director search and visual review.");
      const decision: Decision = run.proposal && run.approval ? run.proposal : await tools.decideNext(run, ownAssets());
      run.proposal = undefined; run.decisionCount++;
      event(run, decision.tool, "reason" in decision ? decision.reason : decision.tool === "finish" ? decision.summary : decision.question);
      commit();
      // Pause/stop can arrive while the agent reasons. Do not begin its next operation afterward.
      if (getCampaign(id).directors?.find(d => d.id === run.id)?.status !== "running") return getCampaign(id);
      try {
        const source = "sourceId" in decision ? run.sources.find(s => s.id === decision.sourceId) : undefined;
        if ("sourceId" in decision && !source) throw new Error("Source ID does not exist.");
        switch (decision.tool) {
          case "search": {
            if (run.events.filter(e => e.tool === "search").length > 4 || run.sources.length >= 24) throw new Error("Search allowance exhausted. Use retrieved sources or request a supplied video.");
            run.searchRequests = (run.searchRequests ?? 0) + 1; commit();
            const result = await (run.searchProvider === "web" ? tools.searchSocial : tools.searchTikTok)(decision.query, run.sources.map(s => s.url)); run.sources.push(...result.sources); event(run, "search_result", result.summary, `${result.sources.length} direct source links found`); break;
          }
          case "retrieve": {
            if (source!.status !== "found") throw new Error("This source was already retrieved or is unavailable.");
            try { const result = await tools.retrieveVideo(source!.url, source!.downloadUrl); source!.media = result.media; source!.metrics = { ...source!.metrics, ...Object.fromEntries(Object.entries(result.metrics).filter(([, v]) => v !== undefined)) } as typeof result.metrics; source!.title = result.title || source!.title; source!.status = "retrieved"; event(run, "retrieved", `${source!.title}: ${result.media.duration.toFixed(1)} seconds, ${result.media.sampleTimes.length} sampled frames.`); }
            catch (error) { source!.status = "unavailable"; source!.error = (error as Error).message; event(run, "unavailable", source!.error); } break;
          }
          case "inspect_source": {
            if (!source!.media || source!.inspection) throw new Error("Retrieve an uninspected source first.");
            source!.inspection = await tools.inspectSource(run, source!); source!.status = "inspected"; event(run, "inspected", source!.inspection.summary, source!.inspection.suitable ? `Suitable · ${source!.inspection.score}/100` : "Rejected"); break;
          }
          case "select_source": {
            if (!source!.inspection?.suitable || !source!.media) throw new Error("Only a retrieved source that passed visual inspection can be selected.");
            if (run.sources.filter(s => s.inspection).length < Math.min(2, run.sources.filter(s => s.status !== "unavailable").length)) throw new Error("Inspect at least two available candidates before selection, or establish that the alternatives cannot be retrieved.");
            if (run.approval) throw new Error("Production approval binds selected sources. Finish this run before adapting another source.");
            if (source!.selection) throw new Error("Source already selected.");
            if (run.sources.filter(s => s.selection).length >= run.reels) throw new Error("Requested source count already selected.");
            source!.selection = { start: decision.start, end: decision.end, direction: decision.direction, clip: await tools.clipVideo(source!.media, decision.start, decision.end, clipLimits(motionModel(run.videoModel))) }; event(run, "selected", `${source!.title} · ${decision.start}–${decision.end}s. ${decision.direction}`); break;
          }
          case "generate": {
            if (!source!.selection) throw new Error("Select and clip an inspected source first.");
            if (run.sources.filter(s => s.selection).length < run.reels) throw new Error("Select all requested sources before proposing production approval.");
            if (!run.approval) { run.proposal = decision; run.status = "awaiting_approval"; event(run, "approval_needed", "Sources selected. Approve the generation allowance to begin media production."); break; }
            if (run.jobs.length >= run.approval.maxGenerations) throw new Error("Approved generation allowance exhausted. Stop and create a new run if more production is needed.");
            if (run.jobs.filter(j => j.sourceId === source!.id && j.kind === decision.kind).length >= (decision.kind === "still" ? run.stillsPerReel + 2 : 3)) throw new Error("Revision limit reached for this source and output type.");
            if (run.jobs.some(j => j.sourceId === source!.id && j.kind === decision.kind && j.prompt.includes(decision.prompt))) throw new Error("Do not repeat the same generation prompt. Apply the visual review correction.");
            const anchor = ownAssets().filter(a => a.sourceId === source!.id && a.productionKind === "anchor" && a.automatedReview?.pass).at(-1);
            if (decision.kind !== "anchor" && !anchor?.url) throw new Error("Generate and visually approve an anchor before motion or matching stills.");
            if (decision.kind !== "motion" && run.imageProvider === "codex" && !(await tools.accountStatus()).imageReady) throw new Error("OpenAI account image generation is unavailable. No fallback provider will be charged.");
            if (!tools.mediaReady(decision.kind, run.imageProvider)) throw new Error("Connect Kie.ai in Settings before submitting motion transfer or Kie images.");
            const imageUrls = [...(anchor?.url && decision.kind !== "anchor" ? [anchor.url] : []), ...(run.identity?.references.map(r => r.url) ?? []), ...run.referenceUrls];
            const model = motionModel(run.videoModel);
            const startFrameUrl = decision.kind === "motion" ? await tools.motionImage(anchor!.url!, clipLimits(model)) : undefined;
            const prompt = effectivePrompt({ prompt: decision.prompt, look: source!.selection.direction }, run.identity);
            const newJob = { id: randomUUID(), sourceId: source!.id, kind: decision.kind, title: decision.title, prompt, status: "submitting" as const, startedAt: Date.now(), reservedUsd: decision.kind === "motion" ? run.approval.motionEstimateUsd : run.approval.imageEstimateUsd };
            run.jobs.push(newJob); commit(); release.assertOwned();
            const common = { workflowId: run.id, nodeId: newJob.id, identityAssetId: run.identity?.id, workflowMetadata: { contentClass: "sfw", routes: {} } };
            const body = decision.kind === "motion"
              ? { ...motionRequestBody(model, { prompt, anchorUrl: startFrameUrl!, clipUrl: source!.selection.clip.localUrl, clipDuration: source!.selection.end - source!.selection.start, identityUrls: run.identity?.references.map(r => r.url) ?? [] }), ...common }
              : { codexProvider: run.imageProvider === "codex", model: run.imageModel, prompt, aspectRatio: "9:16", imageUrls: imageUrls.slice(0, IMAGE_MODELS.find(m => m.id === run.imageModel)?.maxImages ?? 3), ...common };
            const response = await (decision.kind === "motion" ? tools.generateVideo : tools.generateImage)(request(decision.kind === "motion" ? "/api/generate-video" : "/api/generate", body));
            const result = await response.json();
            if (!response.ok || !result.taskId) throw new Error(result.error || "Provider did not return a job ID. Check its ledger before another submission.");
            Object.assign(newJob, { taskId: result.taskId, status: "running" }); break;
          }
          case "review_output": {
            const asset = ownAssets().find(a => a.id === decision.assetId);
            if (!asset || asset.kind === "text" || asset.automatedReview) throw new Error("Choose an unreviewed generated media output.");
            const result = await tools.reviewOutput(run, asset, run.sources.find(s => s.id === asset.sourceId)); asset.url = result.localUrl; asset.automatedReview = result.review; asset.reviewEvidence = result.evidence;
            event(run, "qa_result", result.review.summary, result.review.pass ? "Visual QA passed · human approval pending" : `Revision needed: ${result.review.correction}`); break;
          }
          case "caption":
            if (!ownAssets().some(a => a.sourceId === source!.id && a.productionKind === "motion" && a.automatedReview?.pass)) throw new Error("Complete and review this source's motion adaptation before its caption.");
            if (ownAssets().some(a => a.sourceId === source!.id && a.kind === "text")) throw new Error("A caption already exists. Revise it through the asset controls.");
            c.assets.push({ id: randomUUID(), directorId: run.id, sourceId: source!.id, messageId: run.messageId, stepId: randomUUID(), title: `${source!.title.slice(0, 100)} · caption`, pack: source!.title, kind: "text", text: decision.text, prompt: decision.text, look: source!.selection!.direction, review: "pending", createdAt: Date.now(), version: 1 }); break;
          case "finish":
            if (!delivered(run, ownAssets()) || ownAssets().some(a => a.kind !== "text" && !a.automatedReview)) throw new Error("The requested Reels, stills, captions and visual reviews are not complete.");
            run.status = "done"; break;
          case "need_input": run.status = "blocked"; run.error = decision.question; break;
        }
      } catch (error) {
        event(run, "tool_error", (error as Error).message);
        if (inFlight(run) || run.events.slice(-6).filter(e => e.tool === "tool_error").length >= 3 || (run.approval && run.jobs.length >= run.approval.maxGenerations && !delivered(run, ownAssets()))) throw error;
      }
    } catch (error) { if (run.status !== "stopped") run.status = "blocked"; run.error = (error as Error).message; event(run, "blocked", run.error); }
    return commit();
  } finally { release(); }
}
