import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { GUEST_USER_ID } from "@/lib/guestMode";
import * as guestDb from "@/lib/guest/db";
import { jobStore } from "@/lib/jobStore";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { MEDIA_DIR } from "@/lib/guest/paths";
import { isValidWaveSpeedModelId, listWaveSpeedModels, submitWaveSpeedPrediction, WaveSpeedApiError } from "@/lib/wavespeed";
import { areWaveSpeedModelsFallbackCompatible, validateWaveSpeedInput } from "@/lib/wavespeedSchema";
import { insertLedgerAttempt, saveWaveSpeedRunPlan } from "@/lib/guest/generationLedger";
import { pollWaveSpeedJob, toWaveSpeedRunTaskId } from "@/lib/wavespeedJobPoller";
import { validateContentRoute } from "@/lib/cloneMe";

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
    const allModels = await listWaveSpeedModels();
    const primary = allModels.find((candidate) => candidate.modelId === modelId);
    if (!primary) return NextResponse.json({ error: `WaveSpeed model not found: ${modelId}` }, { status: 404 });
    const missing = validateWaveSpeedInput(primary.requestSchema, input);
    if (missing.length) {
      return NextResponse.json({ error: `Missing required WaveSpeed input${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}` }, { status: 400 });
    }

    const fallbackIds = Array.isArray(body.fallbackModelIds)
      ? [...new Set(body.fallbackModelIds.filter((value): value is string => typeof value === "string").map((value) => value.trim()).filter(Boolean))].slice(0, 8)
      : [];
    const models = [primary];
    for (const fallbackId of fallbackIds) {
      if (!isValidWaveSpeedModelId(fallbackId)) {
        return NextResponse.json({ error: `Invalid fallback model ID: ${fallbackId}` }, { status: 400 });
      }
      const fallback = allModels.find((candidate) => candidate.modelId === fallbackId);
      if (!fallback) return NextResponse.json({ error: `Fallback model not found: ${fallbackId}` }, { status: 404 });
      if (!areWaveSpeedModelsFallbackCompatible(primary, fallback)) {
        return NextResponse.json({ error: `Fallback model is not schema-compatible with ${modelId}: ${fallbackId}` }, { status: 400 });
      }
      models.push(fallback);
    }

    const maxCost = typeof body.maxCost === "number" && Number.isFinite(body.maxCost) && body.maxCost >= 0
      ? body.maxCost
      : undefined;
    const firstQuote = primary.basePrice ?? 0;
    if (maxCost !== undefined && firstQuote > maxCost) {
      return NextResponse.json({ error: `Estimated cost $${firstQuote.toFixed(4)} exceeds this node's $${maxCost.toFixed(4)} limit.` }, { status: 400 });
    }
    const prompt = typeof input.prompt === "string" ? input.prompt : "";
    const workflowMetadata = validateContentRoute({ prompt, metadata: body.workflowMetadata, provider: "wavespeed", modelId });
    const { predictionId, status } = await submitWaveSpeedPrediction(modelId, input);
    const taskId = toWaveSpeedRunTaskId(randomUUID());
    const workflowId = typeof body.workflowId === "string" ? body.workflowId.slice(0, 240) : undefined;
    const nodeId = typeof body.nodeId === "string" ? body.nodeId.slice(0, 240) : undefined;
    const identityAssetId = typeof body.identityAssetId === "string" ? body.identityAssetId.slice(0, 240) : undefined;

    saveWaveSpeedRunPlan({
      taskId,
      mediaType,
      workflowId,
      nodeId,
      identityAssetId,
      models,
      currentIndex: 0,
      predictionId,
      input,
      maxCost,
      estimatedSpend: firstQuote,
    });
    insertLedgerAttempt({
      taskId,
      workflowId,
      nodeId,
      identityAssetId,
      modelId,
      attemptIndex: 0,
      quotedCost: primary.basePrice,
      metadata: { predictionId, mediaType, contentClass: workflowMetadata.contentClass, route: workflowMetadata.routes[workflowMetadata.contentClass] },
    });

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

    return NextResponse.json({
      taskId, provider: "wavespeed", predictionId, status, modelId,
      estimatedCost: primary.basePrice ?? null,
      fallbackCount: models.length - 1,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "WaveSpeed generation request failed.";
    const status = error instanceof WaveSpeedApiError && error.httpStatus === 401
      ? 401
      : message.includes("not configured") ? 401 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
