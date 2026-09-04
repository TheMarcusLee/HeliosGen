/**
 * Export a workflow ("space") to a self-contained `.zip`:
 *
 *   workflow.json      — nodes, edges, counters, viewport (asset URLs rewritten
 *                        to point at the bundled files)
 *   assets/<hash>.<ext> — every referenced image/video, fetched to bytes
 *
 * The zip is portable — it carries its own media instead of pointing at local
 * disk paths — and round-trips through `lib/importWorkflow.ts`.
 */
import { makeZip, type ZipEntry } from "./makeZip";
import type { Space } from "./store";

export const WORKFLOW_FORMAT = "heliosgen-workflow";
export const WORKFLOW_FORMAT_VERSION = 1;

const ASSET_PREFIX = "assets/";

function looksLikeAssetUrl(v: unknown): v is string {
  if (typeof v !== "string" || !v) return false;
  return (
    v.startsWith("/generated/") ||
    v.startsWith("http://") ||
    v.startsWith("https://") ||
    v.startsWith("data:image/") ||
    v.startsWith("data:video/")
  );
}

function extFromUrl(url: string, contentType?: string): string {
  const ct = contentType ?? "";
  if (ct.includes("mp4")) return "mp4";
  if (ct.includes("webm")) return "webm";
  if (ct.includes("png")) return "png";
  if (ct.includes("gif")) return "gif";
  if (ct.includes("webp")) return "webp";
  if (ct.includes("jpeg") || ct.includes("jpg")) return "jpg";
  const clean = url.split(/[?#]/)[0];
  const m = clean.match(/\.([a-z0-9]{2,4})$/i);
  if (m) return m[1].toLowerCase() === "jpeg" ? "jpg" : m[1].toLowerCase();
  return "bin";
}

async function sha16(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest).slice(0, 8))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function dataUrlToBytes(dataUrl: string): { bytes: Uint8Array; contentType: string } {
  const m = dataUrl.match(/^data:([^;]+);base64,([\s\S]+)$/);
  if (!m) throw new Error("bad data URL");
  const bin = atob(m[2]);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return { bytes: out, contentType: m[1] };
}

async function fetchAsset(url: string): Promise<{ bytes: Uint8Array; contentType: string }> {
  if (url.startsWith("data:")) {
    const { bytes, contentType } = dataUrlToBytes(url);
    return { bytes, contentType };
  }
  const res = await fetch(`/api/download?url=${encodeURIComponent(url)}&filename=asset`);
  if (!res.ok) throw new Error(`fetch ${url} → ${res.status}`);
  const buf = await res.arrayBuffer();
  return { bytes: new Uint8Array(buf), contentType: res.headers.get("content-type") ?? "" };
}

type Json = unknown;

/** Deep-clone `value`, replacing any asset URL string with its `assets/…` path,
 *  recording each unique fetch in `jobs`. */
function rewrite(
  value: Json,
  urlToPath: Map<string, string>,
): Json {
  if (Array.isArray(value)) return value.map((v) => rewrite(v, urlToPath));
  if (value && typeof value === "object") {
    const out: Record<string, Json> = {};
    for (const [k, v] of Object.entries(value)) out[k] = rewrite(v, urlToPath);
    return out;
  }
  if (looksLikeAssetUrl(value) && urlToPath.has(value)) return urlToPath.get(value)!;
  return value;
}

/** Collect every unique asset URL referenced anywhere in `value`. */
function collect(value: Json, into: Set<string>): void {
  if (Array.isArray(value)) { value.forEach((v) => collect(v, into)); return; }
  if (value && typeof value === "object") {
    Object.values(value).forEach((v) => collect(v, into));
    return;
  }
  if (looksLikeAssetUrl(value)) into.add(value);
}

function safeName(name: string): string {
  return (name || "workflow").replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60) || "workflow";
}

export interface ExportResult {
  filename: string;
  assetCount: number;
  skipped: number;
}

/** Build the zip Blob for a space. Fetches are best-effort — an asset that
 *  can't be retrieved is left as its original URL in the JSON. */
export async function buildWorkflowZip(space: Space): Promise<{ blob: Blob; result: ExportResult }> {
  const urls = new Set<string>();
  space.nodes.forEach((n) => collect(n.data, urls));

  const urlToPath = new Map<string, string>();
  const entries: ZipEntry[] = [];
  let skipped = 0;

  for (const url of urls) {
    try {
      const { bytes, contentType } = await fetchAsset(url);
      const hash = await sha16(bytes.buffer as ArrayBuffer);
      const path = `${ASSET_PREFIX}${hash}.${extFromUrl(url, contentType)}`;
      if (!urlToPath.has(url)) {
        urlToPath.set(url, path);
        if (!entries.some((e) => e.name === path)) entries.push({ name: path, data: bytes });
      }
    } catch {
      skipped++;
    }
  }

  const nodes = space.nodes.map((n) => ({
    ...n,
    data: rewrite(n.data, urlToPath) as typeof n.data,
  }));

  const manifest = {
    format: WORKFLOW_FORMAT,
    version: WORKFLOW_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    name: space.name,
    workflow: {
      name: space.name,
      nodes,
      edges: space.edges,
      nodeCounters: space.nodeCounters,
      viewport: space.viewport,
      createdAt: space.createdAt,
      metadata: space.metadata,
    },
  };

  entries.unshift({
    name: "workflow.json",
    data: new TextEncoder().encode(JSON.stringify(manifest, null, 2)),
  });

  return {
    blob: makeZip(entries),
    result: { filename: `${safeName(space.name)}.zip`, assetCount: urlToPath.size, skipped },
  };
}

/** Build the zip and trigger a browser download. */
export async function exportWorkflow(space: Space): Promise<ExportResult> {
  const { blob, result } = await buildWorkflowZip(space);
  const objUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objUrl;
  a.download = result.filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(objUrl), 10_000);
  return result;
}
