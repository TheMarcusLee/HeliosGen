import { getWaveSpeedApiKey } from "./guest/db";
import * as guestDb from "./guest/db";
import { jobEvents } from "./jobEvents";
import { jobStore, type JobResult } from "./jobStore";
import { mirrorToR2 } from "./storage";
import { extractWaveSpeedOutputUrls, getWaveSpeedPrediction, WaveSpeedApiError } from "./wavespeed";

const TASK_PREFIX = "wavespeed:";
const MAX_POLL_MS = 30 * 60 * 1000;
const FAILURE_STATES = new Set(["failed", "cancelled", "timeout", "deleted"]);
const active = new Set<string>();

type Kind = "image" | "video";

export function toWaveSpeedTaskId(predictionId: string): string {
  return `${TASK_PREFIX}${predictionId}`;
}

export function isWaveSpeedTaskId(taskId: string): boolean {
  return taskId.startsWith(TASK_PREFIX);
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
  const predictionId = predictionIdFromTaskId(taskId);
  let intervalMs = 2_000;

  while (Date.now() < deadline) {
    await sleep(intervalMs);
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
      await settleSuccess(taskId, kind, urls);
      return;
    }
    if (FAILURE_STATES.has(status)) {
      settle(taskId, kind, {
        status: "error",
        error: String(data.error ?? `WaveSpeed task ended with status: ${status}`),
      });
      return;
    }
    intervalMs = Math.min(10_000, intervalMs + 1_000);
  }

  settle(taskId, kind, { status: "error", error: "WaveSpeed generation timed out." });
}

async function settleSuccess(taskId: string, kind: Kind, sourceUrls: string[]): Promise<void> {
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
