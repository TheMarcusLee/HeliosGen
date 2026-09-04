import { NextRequest, NextResponse } from "next/server";
import { GUEST_USER_ID } from "@/lib/guestMode";
import * as guestDb from "@/lib/guest/db";
import { jobStore } from "@/lib/jobStore";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { MEDIA_DIR } from "@/lib/guest/paths";
import { isValidWaveSpeedModelId, submitWaveSpeedPrediction, WaveSpeedApiError } from "@/lib/wavespeed";
import { pollWaveSpeedJob, toWaveSpeedTaskId } from "@/lib/wavespeedJobPoller";

const RESERVED_INPUTS = new Set(["webhook", "webhook_url", "enable_sync_mode", "sync_mode"]);
const MAX_LOCAL_MEDIA_BYTES = 15 * 1024 * 1024;

function mediaTypeForPath(path: string): string {
  const types: Record<string, string> = {
    ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif",
    ".mp4": "video/mp4", ".webm": "video/webm", ".mp3": "audio/mpeg", ".wav": "audio/wav", ".m4a": "audio/mp4",
  };
  return types[extname(path).toLowerCase()] ?? "application/octet-stream";
}

async function resolveLocalMedia(value: unknown, depth = 0): Promise<unknown> {
  if (depth > 8) throw new Error("WaveSpeed input nesting is too deep.");
  if (typeof value === "string" && value.startsWith("/generated/")) {
    const relative = normalize(decodeURIComponent(value.slice("/generated/".length).split(/[?#]/)[0]));
    if (!relative || relative.startsWith("..") || relative.includes("\0")) {
      throw new Error("WaveSpeed input contains an invalid local media path.");
    }
    const buffer = await readFile(join(MEDIA_DIR, relative));
    if (buffer.byteLength > MAX_LOCAL_MEDIA_BYTES) {
      throw new Error("Local WaveSpeed media inputs must be 15 MB or smaller. Use a public URL for larger files.");
    }
    return `data:${mediaTypeForPath(relative)};base64,${buffer.toString("base64")}`;
  }
  if (Array.isArray(value)) return Promise.all(value.map((item) => resolveLocalMedia(item, depth + 1)));
  if (value && typeof value === "object") {
    const entries = await Promise.all(Object.entries(value as Record<string, unknown>)
      .map(async ([key, item]) => [key, await resolveLocalMedia(item, depth + 1)] as const));
    return Object.fromEntries(entries);
  }
  return value;
}

function sanitizeInput(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("input must be a JSON object containing the selected model's parameters.");
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > 100) throw new Error("input may contain at most 100 parameters.");
  const output: Record<string, unknown> = {};
  for (const [key, item] of entries) {
    if (!key || key.length > 100) throw new Error("WaveSpeed input contains an invalid parameter name.");
    if (RESERVED_INPUTS.has(key.toLowerCase())) continue;
    output[key] = item;
  }
  if (JSON.stringify(output).length > 2_000_000) throw new Error("WaveSpeed input is too large (2 MB maximum).");
  return output;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as Record<string, unknown>;
    const modelId = typeof body.modelId === "string" ? body.modelId.trim() : "";
    const mediaType = body.mediaType === "video" ? "video" : body.mediaType === "image" ? "image" : null;
    if (!isValidWaveSpeedModelId(modelId)) {
      return NextResponse.json({ error: "modelId must be a valid WaveSpeed provider/model path." }, { status: 400 });
    }
    if (!mediaType) {
      return NextResponse.json({ error: 'mediaType must be either "image" or "video".' }, { status: 400 });
    }
    const input = await resolveLocalMedia(sanitizeInput(body.input)) as Record<string, unknown>;
    const prompt = typeof input.prompt === "string" ? input.prompt : "";
    const { predictionId, status } = await submitWaveSpeedPrediction(modelId, input);
    const taskId = toWaveSpeedTaskId(predictionId);

    jobStore.set(taskId, { status: "pending", type: mediaType, userId: GUEST_USER_ID });
    guestDb.insertGeneration({
      task_id: taskId,
      user_id: GUEST_USER_ID,
      generation_type: mediaType,
      status: "pending",
      prompt,
      model: `wavespeed:${modelId}`,
      reference_image_urls: [],
    });
    pollWaveSpeedJob(taskId, mediaType);

    return NextResponse.json({ taskId, provider: "wavespeed", predictionId, status, modelId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "WaveSpeed generation request failed.";
    const status = error instanceof WaveSpeedApiError && error.httpStatus === 401
      ? 401
      : message.includes("not configured") ? 401 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
