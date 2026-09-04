import type {
  WaveSpeedMediaFamily,
  WaveSpeedRequestProperty,
  WaveSpeedRequestSchema,
} from "./wavespeedTypes";

export type WaveSpeedInputKind = "prompt" | "image" | "video" | "audio" | "value";

const RESERVED_PARAMETERS = new Set(["webhook", "webhook_url", "enable_sync_mode", "sync_mode"]);

export function waveSpeedInputKind(name: string, property?: WaveSpeedRequestProperty): WaveSpeedInputKind {
  const key = name.toLowerCase();
  const description = String(property?.description ?? "").toLowerCase();
  if (key === "prompt" || key.endsWith("_prompt") || key.startsWith("prompt_")) return "prompt";
  if (/(^|_)(audio|audios|sound|sounds)(_|$)/.test(key) || description.includes("audio url")) return "audio";
  if (/(^|_)(video|videos)(_|$)/.test(key) || description.includes("video url")) return "video";
  if (
    /(^|_)(image|images|photo|photos|frame|frames|mask)(_|$)/.test(key)
    || description.includes("image url")
    || description.includes("image urls")
  ) return "image";
  return "value";
}

export function orderedWaveSpeedProperties(schema?: WaveSpeedRequestSchema): Array<[string, WaveSpeedRequestProperty]> {
  const properties = schema?.properties ?? {};
  const explicit = Array.isArray(schema?.["x-order-properties"])
    ? schema["x-order-properties"]!.filter((name) => name in properties)
    : [];
  const remaining = Object.keys(properties).filter((name) => !explicit.includes(name));
  return [...explicit, ...remaining]
    .map((name) => [name, properties[name]] as [string, WaveSpeedRequestProperty])
    .filter(([name, property]) => !property.disabled && !RESERVED_PARAMETERS.has(name.toLowerCase()));
}

export function defaultWaveSpeedParameters(schema?: WaveSpeedRequestSchema): Record<string, unknown> {
  return Object.fromEntries(
    orderedWaveSpeedProperties(schema)
      .filter(([, property]) => property.default !== undefined)
      .map(([name, property]) => [name, property.default]),
  );
}

export function coerceWaveSpeedValue(raw: string, property: WaveSpeedRequestProperty): unknown {
  if (property.type === "integer") {
    const value = Number.parseInt(raw, 10);
    return Number.isFinite(value) ? value : undefined;
  }
  if (property.type === "number") {
    const value = Number.parseFloat(raw);
    return Number.isFinite(value) ? value : undefined;
  }
  if (property.type === "boolean") return raw === "true";
  if (property.type === "array" || property.type === "object") {
    try { return JSON.parse(raw); } catch { return raw; }
  }
  return raw;
}

export function validateWaveSpeedInput(
  schema: WaveSpeedRequestSchema | undefined,
  input: Record<string, unknown>,
): string[] {
  const required = schema?.required ?? [];
  return required.filter((name) => {
    const value = input[name];
    return value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0);
  });
}

export function buildWaveSpeedInput(
  schema: WaveSpeedRequestSchema | undefined,
  parameters: Record<string, unknown>,
  connected: Record<string, unknown>,
): Record<string, unknown> {
  const allowed = new Set(orderedWaveSpeedProperties(schema).map(([name]) => name));
  const output: Record<string, unknown> = {};
  for (const source of [parameters, connected]) {
    for (const [name, value] of Object.entries(source)) {
      if (!allowed.has(name) || value === undefined || value === null || value === "") continue;
      if (Array.isArray(value) && value.length === 0) continue;
      output[name] = value;
    }
  }
  return output;
}

export function waveSpeedOutputFamily(type: string, modelId = ""): WaveSpeedMediaFamily | null {
  const normalized = type.toLowerCase();
  if (["text-to-image", "image-to-image"].includes(normalized)) return "image";
  if (["text-to-video", "image-to-video", "video-to-video", "video-extend", "video-effects", "motion-control", "digital-human", "audio-to-video", "video-dubbing"].includes(normalized)) return "video";
  if (["lora-support", "portrait-transfer", "upscaler", "ai-remover"].includes(normalized)) {
    const id = modelId.toLowerCase();
    return ["/video", "video-", "-video", "/t2v", "/i2v", "/v2v", "/mocha", "pixverse/swap"]
      .some((marker) => id.includes(marker)) ? "video" : "image";
  }
  return null;
}

export function areWaveSpeedModelsFallbackCompatible(
  primary: { modelId: string; type: string; requestSchema?: WaveSpeedRequestSchema },
  fallback: { modelId: string; type: string; requestSchema?: WaveSpeedRequestSchema },
): boolean {
  if (waveSpeedOutputFamily(primary.type, primary.modelId) !== waveSpeedOutputFamily(fallback.type, fallback.modelId)) return false;
  const primaryKinds = new Set(orderedWaveSpeedProperties(primary.requestSchema).map(([name, property]) => waveSpeedInputKind(name, property)));
  return (fallback.requestSchema?.required ?? []).every((name) => {
    const property = fallback.requestSchema?.properties?.[name];
    return primaryKinds.has(waveSpeedInputKind(name, property));
  });
}

/**
 * Re-map an input prepared for one WaveSpeed schema to another compatible
 * schema. Exact parameter names win; otherwise media/prompt parameters are
 * matched by semantic kind (for example `image` -> `first_frame_image`).
 */
export function remapWaveSpeedInput(
  sourceSchema: WaveSpeedRequestSchema | undefined,
  targetSchema: WaveSpeedRequestSchema | undefined,
  input: Record<string, unknown>,
): Record<string, unknown> {
  const sourceProperties = sourceSchema?.properties ?? {};
  const sourceByKind = new Map<WaveSpeedInputKind, unknown[]>();
  for (const [name, value] of Object.entries(input)) {
    const kind = waveSpeedInputKind(name, sourceProperties[name]);
    const values = sourceByKind.get(kind) ?? [];
    values.push(value);
    sourceByKind.set(kind, values);
  }

  const output = defaultWaveSpeedParameters(targetSchema);
  for (const [name, property] of orderedWaveSpeedProperties(targetSchema)) {
    if (input[name] !== undefined) {
      output[name] = input[name];
      continue;
    }
    const kind = waveSpeedInputKind(name, property);
    if (kind === "value") continue;
    const candidates = sourceByKind.get(kind) ?? [];
    if (candidates.length === 0) continue;
    const value = candidates[0];
    if (property.type === "array" && !Array.isArray(value)) output[name] = [value];
    else if (property.type !== "array" && Array.isArray(value)) output[name] = value[0];
    else output[name] = value;
  }
  return buildWaveSpeedInput(targetSchema, output, {});
}
