/**
 * Import a workflow ("space") from a `.zip` produced by `lib/exportWorkflow.ts`:
 *
 *   workflow.json      — nodes, edges, counters, viewport (asset URLs point at
 *                        the bundled files)
 *   assets/<hash>.<ext> — every referenced image/video
 *
 * Each bundled asset is re-uploaded to local storage via `/api/upload-asset`
 * and its `assets/…` reference in the workflow is rewritten to the fresh URL.
 * Assets that fail to upload are left as their original bundled path.
 */
import type { Edge, Node } from "@xyflow/react";
import type { NodeData } from "./store";
import { WORKFLOW_FORMAT } from "./exportWorkflow";

const ASSET_PREFIX = "assets/";

// ── Minimal ZIP reader ────────────────────────────────────────────────────────
// Handles STORE (0) entries directly and DEFLATE (8) via DecompressionStream,
// scanning local file headers sequentially. Enough for our own exports and for
// zips produced by standard tools.

interface UnzipEntry {
  name: string;
  data: Uint8Array;
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(
    new DecompressionStream("deflate-raw"),
  );
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function unzip(buf: ArrayBuffer): Promise<UnzipEntry[]> {
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);
  const decoder = new TextDecoder();
  const entries: UnzipEntry[] = [];
  let off = 0;

  while (off + 30 <= bytes.length && view.getUint32(off, true) === 0x04034b50) {
    const flags = view.getUint16(off + 6, true);
    const compression = view.getUint16(off + 8, true);
    const compSize = view.getUint32(off + 18, true);
    const nameLen = view.getUint16(off + 26, true);
    const extraLen = view.getUint16(off + 28, true);
    const nameStart = off + 30;
    const name = decoder.decode(bytes.subarray(nameStart, nameStart + nameLen));
    const dataStart = nameStart + nameLen + extraLen;

    if (flags & 0x08 && compSize === 0) {
      throw new Error("zip uses streaming data descriptors — re-export the workflow");
    }

    const raw = bytes.slice(dataStart, dataStart + compSize);
    let data: Uint8Array;
    if (compression === 0) data = raw;
    else if (compression === 8) data = await inflateRaw(raw);
    else throw new Error(`unsupported zip compression method ${compression}`);

    entries.push({ name, data });
    off = dataStart + compSize;
  }

  return entries;
}

// ── Asset content types ───────────────────────────────────────────────────────

function contentTypeFromName(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  switch (ext) {
    case "mp4": return "video/mp4";
    case "webm": return "video/webm";
    case "png": return "image/png";
    case "gif": return "image/gif";
    case "webp": return "image/webp";
    case "jpg":
    case "jpeg": return "image/jpeg";
    default: return "application/octet-stream";
  }
}

// ── Rewrite bundled asset paths back to real URLs ─────────────────────────────

type Json = unknown;

function rewrite(value: Json, pathToUrl: Map<string, string>): Json {
  if (Array.isArray(value)) return value.map((v) => rewrite(v, pathToUrl));
  if (value && typeof value === "object") {
    const out: Record<string, Json> = {};
    for (const [k, v] of Object.entries(value)) out[k] = rewrite(v, pathToUrl);
    return out;
  }
  if (typeof value === "string" && value.startsWith(ASSET_PREFIX) && pathToUrl.has(value)) {
    return pathToUrl.get(value)!;
  }
  return value;
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface ImportedWorkflow {
  name: string;
  nodes: Node<NodeData>[];
  edges: Edge[];
  nodeCounters: Record<string, number>;
  viewport?: { x: number; y: number; zoom: number };
  assetCount: number;
  skipped: number;
}

export async function importWorkflowZip(file: File): Promise<ImportedWorkflow> {
  const entries = await unzip(await file.arrayBuffer());

  const manifestEntry = entries.find((e) => e.name === "workflow.json");
  if (!manifestEntry) throw new Error("workflow.json not found in zip");

  let manifest: {
    format?: string;
    name?: string;
    workflow?: {
      name?: string;
      nodes?: Node<NodeData>[];
      edges?: Edge[];
      nodeCounters?: Record<string, number>;
      viewport?: { x: number; y: number; zoom: number };
    };
  };
  try {
    manifest = JSON.parse(new TextDecoder().decode(manifestEntry.data));
  } catch {
    throw new Error("workflow.json is not valid JSON");
  }

  if (manifest.format !== WORKFLOW_FORMAT) {
    throw new Error("this zip is not a HeliosGen workflow export");
  }

  const wf = manifest.workflow ?? {};
  const rawNodes = Array.isArray(wf.nodes) ? wf.nodes : [];
  if (rawNodes.length === 0) throw new Error("workflow has no nodes");

  // Re-upload every bundled asset, mapping its path → fresh URL.
  const pathToUrl = new Map<string, string>();
  let skipped = 0;
  for (const entry of entries) {
    if (!entry.name.startsWith(ASSET_PREFIX)) continue;
    try {
      const res = await fetch("/api/upload-asset", {
        method: "POST",
        headers: { "Content-Type": contentTypeFromName(entry.name) },
        body: entry.data as BodyInit,
      });
      if (!res.ok) throw new Error(`upload ${entry.name} → ${res.status}`);
      const { cdnUrl } = (await res.json()) as { cdnUrl: string };
      pathToUrl.set(entry.name, cdnUrl);
    } catch {
      skipped++;
    }
  }

  const nodes = rawNodes.map((n) => ({
    ...n,
    data: rewrite(n.data, pathToUrl) as NodeData,
  }));

  return {
    name: wf.name || manifest.name || "Imported workflow",
    nodes,
    edges: Array.isArray(wf.edges) ? wf.edges : [],
    nodeCounters: wf.nodeCounters ?? {},
    viewport: wf.viewport,
    assetCount: pathToUrl.size,
    skipped,
  };
}
