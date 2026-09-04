import { getWaveSpeedApiKey } from "./guest/db";

const BASE_URL = "https://api.wavespeed.ai/api/v3";
const MODEL_CACHE_MS = 60 * 60 * 1000;
const MODEL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]*(\/[A-Za-z0-9][A-Za-z0-9_.-]*)+$/;

export interface WaveSpeedRequestProperty {
  type?: string;
  description?: string;
  default?: unknown;
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  items?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface WaveSpeedRequestSchema {
  type?: string;
  properties?: Record<string, WaveSpeedRequestProperty>;
  required?: string[];
  [key: string]: unknown;
}

export interface WaveSpeedModel {
  modelId: string;
  name: string;
  description: string;
  type: string;
  basePrice?: number;
  requestSchema?: WaveSpeedRequestSchema;
}

export type WaveSpeedMediaFamily = "image" | "video";

const IMAGE_OUTPUT_TYPES = new Set([
  "image-to-image",
  "text-to-image",
]);

const VIDEO_OUTPUT_TYPES = new Set([
  "audio-to-video",
  "digital-human",
  "image-to-video",
  "motion-control",
  "text-to-video",
  "video-dubbing",
  "video-effects",
  "video-extend",
  "video-to-video",
]);

const AMBIGUOUS_MEDIA_TYPES = new Set(["ai-remover", "lora-support", "portrait-transfer", "upscaler"]);
const VIDEO_ID_MARKERS = [
  "/video", "video-", "-video", "/t2v", "/i2v", "/v2v", "text-to-video", "image-to-video", "video-to-video",
  "video-extend", "/mocha", "pixverse/swap",
];

/** Classify models by the media they produce, rather than by every media word in their input type. */
export function isWaveSpeedMediaModel(
  model: Pick<WaveSpeedModel, "type"> & Partial<Pick<WaveSpeedModel, "modelId" | "name">>,
  family: WaveSpeedMediaFamily,
): boolean {
  const type = model.type.trim().toLowerCase();
  if (IMAGE_OUTPUT_TYPES.has(type)) return family === "image";
  if (VIDEO_OUTPUT_TYPES.has(type)) return family === "video";
  if (!AMBIGUOUS_MEDIA_TYPES.has(type)) return false;

  const identity = `${model.modelId ?? ""} ${model.name ?? ""}`.toLowerCase();
  const isVideo = VIDEO_ID_MARKERS.some((marker) => identity.includes(marker));
  return family === (isVideo ? "video" : "image");
}

type JsonObject = Record<string, unknown>;

let modelCache: { expiresAt: number; models: WaveSpeedModel[] } | null = null;

export class WaveSpeedApiError extends Error {
  readonly retryable: boolean;
  readonly httpStatus?: number;

  constructor(message: string, retryable: boolean, httpStatus?: number) {
    super(message);
    this.name = "WaveSpeedApiError";
    this.retryable = retryable;
    this.httpStatus = httpStatus;
  }
}

function object(value: unknown): JsonObject | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : undefined;
}

function errorMessage(body: unknown, fallback: string): string {
  const value = object(body);
  const data = object(value?.data);
  const nested = object(data?.error);
  return String(
    data?.error ?? nested?.message ?? value?.message ?? value?.msg ?? value?.error ?? fallback,
  );
}

async function waveSpeedFetch(path: string, init?: RequestInit): Promise<unknown> {
  const apiKey = getWaveSpeedApiKey();
  if (!apiKey) {
    throw new Error("WaveSpeed API key is not configured. Add it in Settings → API Keys.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  try {
    const response = await fetch(`${BASE_URL}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...init?.headers,
      },
      cache: "no-store",
      signal: controller.signal,
    });
    const text = await response.text();
    let body: unknown = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = text; }
    if (!response.ok) {
      const fallback = response.status === 401
        ? "Invalid WaveSpeed API key. Update it in Settings → API Keys."
        : `WaveSpeed request failed with HTTP ${response.status}`;
      throw new WaveSpeedApiError(errorMessage(body, fallback), response.status === 429 || response.status >= 500, response.status);
    }
    const envelope = object(body);
    if (typeof envelope?.code === "number" && envelope.code !== 200 && envelope.code !== 0) {
      throw new WaveSpeedApiError(errorMessage(body, `WaveSpeed API error ${envelope.code}`), envelope.code >= 500);
    }
    return body;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new WaveSpeedApiError("WaveSpeed request timed out after 60 seconds.", true);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeModel(value: unknown): WaveSpeedModel | null {
  const raw = object(value);
  if (!raw) return null;
  const modelId = String(raw.model_id ?? raw.id ?? raw.modelId ?? raw.name ?? "").trim();
  if (!modelId || !isValidWaveSpeedModelId(modelId)) return null;
  const apiSchema = object(raw.api_schema);
  const apiSchemas = Array.isArray(apiSchema?.api_schemas) ? apiSchema.api_schemas : [];
  const runSchema = apiSchemas
    .map(object)
    .find((candidate) => candidate?.type === "model_run" || candidate?.method === "POST");
  const requestSchema = object(runSchema?.request_schema) as WaveSpeedRequestSchema | undefined;
  const basePrice = typeof raw.base_price === "number" ? raw.base_price : undefined;
  return {
    modelId,
    name: String(raw.name ?? modelId),
    description: String(raw.description ?? ""),
    type: String(raw.type ?? "unknown"),
    ...(basePrice !== undefined ? { basePrice } : {}),
    ...(requestSchema ? { requestSchema } : {}),
  };
}

export function isValidWaveSpeedModelId(modelId: string): boolean {
  return modelId.length <= 240 && !modelId.includes("..") && MODEL_ID_PATTERN.test(modelId);
}

export async function listWaveSpeedModels(options?: { forceRefresh?: boolean }): Promise<WaveSpeedModel[]> {
  if (!options?.forceRefresh && modelCache && modelCache.expiresAt > Date.now()) {
    return modelCache.models;
  }
  const body = object(await waveSpeedFetch("/models"));
  const payload = body?.data;
  const rows = Array.isArray(payload)
    ? payload
    : Array.isArray(object(payload)?.models)
      ? object(payload)!.models as unknown[]
      : Array.isArray(body?.models)
        ? body.models
        : [];
  const models = rows.map(normalizeModel).filter((model): model is WaveSpeedModel => model !== null);
  modelCache = { expiresAt: Date.now() + MODEL_CACHE_MS, models };
  return models;
}

export async function submitWaveSpeedPrediction(
  modelId: string,
  input: JsonObject,
): Promise<{ predictionId: string; status: string }> {
  if (!isValidWaveSpeedModelId(modelId)) {
    throw new Error("Invalid WaveSpeed model ID. Expected a provider/model path such as wavespeed-ai/z-image/turbo.");
  }
  const body = object(await waveSpeedFetch(`/${modelId}`, {
    method: "POST",
    body: JSON.stringify(input),
  }));
  const data = object(body?.data) ?? body;
  const predictionId = String(data?.id ?? "").trim();
  if (!predictionId) throw new Error("WaveSpeed accepted the request but returned no prediction ID.");
  return { predictionId, status: String(data?.status ?? "created") };
}

export async function getWaveSpeedPrediction(predictionId: string): Promise<JsonObject> {
  if (!predictionId || predictionId.length > 240 || !/^[A-Za-z0-9_.-]+$/.test(predictionId)) {
    throw new Error("Invalid WaveSpeed prediction ID.");
  }
  const body = object(await waveSpeedFetch(`/predictions/${encodeURIComponent(predictionId)}/result`));
  return object(body?.data) ?? body ?? {};
}

export function extractWaveSpeedOutputUrls(value: unknown): string[] {
  const urls: string[] = [];
  const seen = new Set<unknown>();
  const visit = (candidate: unknown, depth: number) => {
    if (depth > 5 || candidate == null || seen.has(candidate)) return;
    if (typeof candidate === "string") {
      try {
        const url = new URL(candidate);
        if (url.protocol === "https:" || url.protocol === "http:") urls.push(url.toString());
      } catch { /* WaveSpeed can also return text outputs; ignore those here. */ }
      return;
    }
    if (typeof candidate !== "object") return;
    seen.add(candidate);
    if (Array.isArray(candidate)) {
      candidate.forEach((item) => visit(item, depth + 1));
      return;
    }
    const record = candidate as JsonObject;
    for (const key of ["url", "urls", "output", "outputs", "image", "images", "video", "videos", "audio", "audios"]) {
      if (key in record) visit(record[key], depth + 1);
    }
  };
  visit(value, 0);
  return [...new Set(urls)];
}

export function clearWaveSpeedModelCache(): void {
  modelCache = null;
}
