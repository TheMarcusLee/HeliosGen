import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { mkdir, writeFile } from "node:fs/promises";
import { isIP } from "node:net";
import { extname, join } from "node:path";
import { applyComfyBindings, extractComfyOutputFiles, type ComfyBinding } from "@/lib/comfyWorkflow";
import { getComfyApiKey, getComfyBaseUrl } from "@/lib/guest/db";
import { MEDIA_DIR } from "@/lib/guest/paths";

function normalizedBaseUrl(): { base: string; prefix: string; cloud: boolean } {
  const configured = getComfyBaseUrl() || "http://127.0.0.1:8188";
  const url = new URL(configured);
  const local = url.hostname === "127.0.0.1" || url.hostname === "localhost";
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) throw new Error("ComfyUI must use HTTPS, except for localhost.");
  const cloud = url.hostname === "cloud.comfy.org";
  return { base: `${url.protocol}//${url.host}`, prefix: cloud ? "/api" : "", cloud };
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function isPrivateAddress(address: string): boolean {
  const normalized = address.toLowerCase().split("%")[0];
  if (normalized === "::" || normalized === "::1") return true;
  if (normalized.startsWith("fc") || normalized.startsWith("fd") || /^fe[89ab]/.test(normalized)) return true;
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  const ipv4 = mapped ?? (isIP(normalized) === 4 ? normalized : null);
  if (!ipv4) return false;
  const [a, b] = ipv4.split(".").map(Number);
  return a === 0 || a === 10 || a === 127 || a >= 224
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 198 && (b === 18 || b === 19));
}

async function safeMediaSourceUrl(raw: string, requestOrigin: string): Promise<string> {
  const source = new URL(raw, requestOrigin);
  if (!(source.protocol === "http:" || source.protocol === "https:")) throw new Error("Connected ComfyUI media must use HTTP or HTTPS.");
  // Relative HeliosGen media is intentionally served by this app. Arbitrary
  // absolute URLs must resolve only to public addresses to avoid SSRF.
  if (raw.startsWith("/") && source.origin === requestOrigin) return source.toString();
  if (["localhost", "localhost.localdomain"].includes(source.hostname.toLowerCase())) throw new Error("External ComfyUI media URLs cannot target localhost.");
  const addresses = await lookup(source.hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) throw new Error("External ComfyUI media URLs must resolve to a public address.");
  return source.toString();
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { workflow?: unknown; bindings?: ComfyBinding[] };
    const { base, prefix, cloud } = normalizedBaseUrl();
    const apiKey = getComfyApiKey();
    if (cloud && !apiKey) return NextResponse.json({ error: "Add a Comfy Cloud API key in Settings or configure COMFY_API_KEY." }, { status: 401 });
    const bindings = Array.isArray(body.bindings) ? body.bindings.map((binding) => ({ ...binding })) : [];
    for (const binding of bindings) {
      if (!(["image", "video", "audio"] as string[]).includes(binding.kind) || typeof binding.value !== "string") continue;
      const sourceUrl = await safeMediaSourceUrl(binding.value, req.nextUrl.origin);
      const source = await fetch(sourceUrl, { signal: AbortSignal.timeout(60_000) });
      if (!source.ok) throw new Error(`Unable to read connected ${binding.kind} input.`);
      const declaredSize = Number(source.headers.get("content-length") ?? 0);
      if (declaredSize > 100 * 1024 * 1024) throw new Error("ComfyUI media inputs are limited to 100 MB.");
      const bytes = await source.arrayBuffer();
      if (bytes.byteLength > 100 * 1024 * 1024) throw new Error("ComfyUI media inputs are limited to 100 MB.");
      const filename = `${randomUUID()}${extname(new URL(sourceUrl).pathname) || ".bin"}`;
      const form = new FormData();
      form.set("image", new File([bytes], filename, { type: source.headers.get("content-type") ?? "application/octet-stream" }));
      form.set("type", "input");
      form.set("overwrite", "true");
      const uploaded = await fetch(`${base}${prefix}/upload/image`, { method: "POST", headers: apiKey ? { "X-API-Key": apiKey } : {}, body: form });
      const uploadBody = await uploaded.json() as { name?: string; filename?: string };
      if (!uploaded.ok) throw new Error(`ComfyUI rejected the connected ${binding.kind} input.`);
      binding.value = uploadBody.name ?? uploadBody.filename ?? filename;
    }
    const workflow = applyComfyBindings(body.workflow, bindings);
    const headers: HeadersInit = { "Content-Type": "application/json", ...(apiKey ? { "X-API-Key": apiKey } : {}) };
    const submit = await fetch(`${base}${prefix}/prompt`, {
      method: "POST",
      headers,
      body: JSON.stringify({ prompt: workflow, ...(apiKey ? { extra_data: { api_key_comfy_org: apiKey } } : {}) }),
      signal: AbortSignal.timeout(60_000),
    });
    const submitted = await submit.json() as { prompt_id?: string; error?: string; node_errors?: unknown };
    if (!submit.ok || !submitted.prompt_id) throw new Error(submitted.error ?? `ComfyUI rejected the workflow (${submit.status}).`);

    let history: unknown = null;
    for (let attempt = 0; attempt < 300; attempt++) {
      await delay(2_000);
      const response = await fetch(`${base}${prefix}/history/${encodeURIComponent(submitted.prompt_id)}`, { headers: apiKey ? { "X-API-Key": apiKey } : {}, cache: "no-store" });
      if (!response.ok) continue;
      history = await response.json();
      const files = extractComfyOutputFiles(history);
      if (files.length) break;
      const serialized = JSON.stringify(history);
      if (serialized.includes("execution_error") || serialized.includes("exception_message")) throw new Error("ComfyUI execution failed. Check the ComfyUI server logs for the failing node.");
    }
    const files = extractComfyOutputFiles(history);
    if (!files.length) throw new Error("ComfyUI finished without a downloadable media output.");

    const outputDir = join(MEDIA_DIR, "comfyui");
    await mkdir(outputDir, { recursive: true });
    const urls: string[] = [];
    for (const file of files.slice(0, 20)) {
      const params = new URLSearchParams(file);
      const response = await fetch(`${base}${prefix}/view?${params}`, { headers: apiKey ? { "X-API-Key": apiKey } : {}, redirect: "follow" });
      if (!response.ok) continue;
      const extension = extname(file.filename).slice(0, 12) || ".bin";
      const localName = `${randomUUID()}${extension}`;
      await writeFile(join(outputDir, localName), Buffer.from(await response.arrayBuffer()));
      urls.push(`/generated/comfyui/${localName}`);
    }
    if (!urls.length) throw new Error("ComfyUI output files could not be downloaded.");
    const first = urls[0];
    const video = /\.(mp4|webm|mov)$/i.test(first);
    const audio = /\.(mp3|wav|m4a|ogg)$/i.test(first);
    return NextResponse.json({ promptId: submitted.prompt_id, urls, ...(video ? { videoUrl: first } : audio ? { audioUrl: first } : { imageUrl: first }) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "ComfyUI execution failed." }, { status: 502 });
  }
}
