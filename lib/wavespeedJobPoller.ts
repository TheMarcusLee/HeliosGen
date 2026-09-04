import { getWaveSpeedApiKey } from "./guest/db";
import * as guestDb from "./guest/db";
import { jobEvents } from "./jobEvents";
import { jobStore, type JobResult } from "./jobStore";
import { mirrorToR2 } from "./storage";
import { extractWaveSpeedOutputUrls, getWaveSpeedPrediction, WaveSpeedApiError } from "./wavespeed";
import { submitWaveSpeedPrediction } from "./wavespeed";
import {
  getWaveSpeedRunPlan,
  insertLedgerAttempt,
  saveWaveSpeedRunPlan,
  settleLedgerAttempt,
} from "./guest/generationLedger";
import { remapWaveSpeedInput, validateWaveSpeedInput } from "./wavespeedSchema";

const TASK_PREFIX = "wavespeed:";
const RUN_TASK_PREFIX = "wavespeed-run:";
const MAX_POLL_MS = 30 * 60 * 1000;
const FAILURE_STATES = new Set(["failed", "cancelled", "timeout", "deleted"]);
const active = new Set<string>();

type Kind = "image" | "video";

export function toWaveSpeedTaskId(predictionId: string): string {
  return `${TASK_PREFIX}${predictionId}`;
}

export function toWaveSpeedRunTaskId(runId: string): string {
  return `${RUN_TASK_PREFIX}${runId}`;
}

export function isWaveSpeedTaskId(taskId: string): boolean {
  return taskId.startsWith(TASK_PREFIX) || taskId.startsWith(RUN_TASK_PREFIX);
}

function predictionIdFromTaskId(taskId: string): string {
  return isWaveSpeedTaskId(taskId) ? taskId.slice(TASK_PREFIX.length) : taskId;
}

export function pollWaveSpeedJob(taskId: string, kind: Kind): void {
  if (!isWaveSpeedTaskId(taskId) || active.has(taskId)) return;
  active.add(taskId);
  void loop(taskId, kind)
    .catch((error) => {
      console.error(`[wavespeed-poller] ${taskId} crashed:`, error);
      settle(taskId, kind, {
        status: "error",
        error: error instanceof Error ? error.message : "WaveSpeed generation failed.",
      });
    })
    .finally(() => active.delete(taskId));
}

export function resumeWaveSpeedJob(taskId: string, kind: Kind): void {
  if (active.has(taskId) || !isWaveSpeedTaskId(taskId) || !getWaveSpeedApiKey()) return;
  pollWaveSpeedJob(taskId, kind);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function loop(taskId: string, kind: Kind): Promise<void> {
  const deadline = Date.now() + MAX_POLL_MS;
  let intervalMs = 2_000;

  while (Date.now() < deadline) {
    await sleep(intervalMs);
    const plan = getWaveSpeedRunPlan(taskId);
    const predictionId = plan?.predictionId ?? predictionIdFromTaskId(taskId);
    let data: Record<string, unknown>;
    try {
      data = await getWaveSpeedPrediction(predictionId);
    } catch (error) {
      if (error instanceof WaveSpeedApiError && !error.retryable) throw error;
      console.warn(`[wavespeed-poller] ${taskId} transient poll error:`, error instanceof Error ? error.message : error);
      intervalMs = Math.min(10_000, intervalMs + 1_000);
      continue;
    }

    const status = String(data.status ?? "").toLowerCase();
    if (status === "completed") {
      const urls = extractWaveSpeedOutputUrls(data.outputs ?? data.output ?? data);
      if (urls.length === 0) {
        settle(taskId, kind, { status: "error", error: "WaveSpeed completed but returned no media URL." });
        return;
      }
      const outputUrl = await settleSuccess(taskId, kind, urls);
      if (plan) settleLedgerAttempt(taskId, plan.currentIndex, "done", undefined, outputUrl);
      return;
    }
    if (FAILURE_STATES.has(status)) {
      const message = String(data.error ?? `WaveSpeed task ended with status: ${status}`);
      if (plan) {
        settleLedgerAttempt(taskId, plan.currentIndex, "error", message);
        const continued = await tryNextFallback(plan);
        if (continued) {
          intervalMs = 2_000;
          continue;
        }
      }
      settle(taskId, kind, { status: "error", error: message });
      return;
    }
    intervalMs = Math.min(10_000, intervalMs + 1_000);
  }

  settle(taskId, kind, { status: "error", error: "WaveSpeed generation timed out." });
}

async function tryNextFallback(plan: NonNullable<ReturnType<typeof getWaveSpeedRunPlan>>): Promise<boolean> {
  const primary = plan.models[0];
  let estimatedSpend = plan.estimatedSpend;
  for (let nextIndex = plan.currentIndex + 1; nextIndex < plan.models.length; nextIndex++) {
    const next = plan.models[nextIndex];
    const nextQuote = next.basePrice ?? 0;
    if (plan.maxCost !== undefined && estimatedSpend + nextQuote > plan.maxCost) {
      insertLedgerAttempt({
        taskId: plan.taskId,
        workflowId: plan.workflowId,
        nodeId: plan.nodeId,
        modelId: next.modelId,
        attemptIndex: nextIndex,
        quotedCost: next.basePrice,
        metadata: { reason: "cost_limit" },
      });
      settleLedgerAttempt(plan.taskId, nextIndex, "skipped", "Skipped because the run cost limit would be exceeded.");
      continue;
    }

    const input = remapWaveSpeedInput(primary.requestSchema, next.requestSchema, plan.input);
    const missing = validateWaveSpeedInput(next.requestSchema, input);
    if (missing.length) {
      insertLedgerAttempt({
        taskId: plan.taskId,
        workflowId: plan.workflowId,
        nodeId: plan.nodeId,
        modelId: next.modelId,
        attemptIndex: nextIndex,
        quotedCost: next.basePrice,
        metadata: { reason: "missing_input", missing },
      });
      settleLedgerAttempt(plan.taskId, nextIndex, "skipped", `Missing remapped input: ${missing.join(", ")}`);
      continue;
    }

    try {
      const submitted = await submitWaveSpeedPrediction(next.modelId, input);
      insertLedgerAttempt({
        taskId: plan.taskId,
        workflowId: plan.workflowId,
        nodeId: plan.nodeId,
        modelId: next.modelId,
        attemptIndex: nextIndex,
        quotedCost: next.basePrice,
        metadata: { predictionId: submitted.predictionId, fallback: true },
      });
      estimatedSpend += nextQuote;
      saveWaveSpeedRunPlan({
        taskId: plan.taskId,
        mediaType: plan.mediaType,
        workflowId: plan.workflowId,
        nodeId: plan.nodeId,
        models: plan.models,
        currentIndex: nextIndex,
        predictionId: submitted.predictionId,
        input: plan.input,
        maxCost: plan.maxCost,
        estimatedSpend,
      });
      return true;
    } catch (error) {
      insertLedgerAttempt({
        taskId: plan.taskId,
        workflowId: plan.workflowId,
        nodeId: plan.nodeId,
        modelId: next.modelId,
        attemptIndex: nextIndex,
        quotedCost: next.basePrice,
        metadata: { fallback: true, submitFailed: true },
      });
      settleLedgerAttempt(plan.taskId, nextIndex, "error", error instanceof Error ? error.message : "Fallback submission failed.");
    }
  }
  return false;
}

async function settleSuccess(taskId: string, kind: Kind, sourceUrls: string[]): Promise<string> {
  const folder = kind === "video" ? "videos" : "images";
  let storedUrls = sourceUrls;
  try {
    storedUrls = await Promise.all(sourceUrls.map((url) => mirrorToR2(url, folder)));
  } catch (error) {
    console.error(`[wavespeed-poller] ${taskId} storage mirror failed, using temporary source URLs:`, error);
  }
  settle(taskId, kind, kind === "video"
    ? { status: "done", videoUrl: storedUrls[0] }
    : { status: "done", imageUrl: storedUrls[0], imageUrls: storedUrls });
  return storedUrls[0];
}

function settle(taskId: string, kind: Kind, result: JobResult): void {
  jobStore.set(taskId, result);
  jobEvents.emit(`job:${taskId}`, result);
  if (result.status === "done") {
    guestDb.updateGeneration(taskId, kind === "video"
      ? { status: "done", video_url: result.videoUrl }
      : { status: "done", image_url: result.imageUrl, image_urls: result.imageUrls });
  } else if (result.status === "error") {
    guestDb.updateGeneration(taskId, { status: "error", error_msg: result.error });
  }
}
