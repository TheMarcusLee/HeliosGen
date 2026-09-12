import { NextRequest } from "next/server";
import { uploadBuffer } from "@/lib/storage";
import { deleteCapture, listCaptures, saveCapture } from "@/lib/campaigns/captures";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Capture endpoint for the bundled InstaVault browser extension.
 *
 * Cross-origin access is granted only to browser-extension origins. A web page
 * cannot send the custom capture headers without a preflight, and that
 * preflight is refused for any other origin, so a drive-by site on the same
 * machine cannot push media into the library. No key is needed.
 */
const CAPTURE_HEADERS = "Content-Type, X-Capture-Source-Url, X-Capture-Author, X-Capture-Caption, X-Capture-Posted-At";
function extensionOrigin(req: Request) {
  const origin = req.headers.get("origin") ?? "";
  return /^(chrome|moz|safari-web)-extension:\/\/[\w-]+$/.test(origin) ? origin : undefined;
}
function cors(req: Request, response: Response) {
  const origin = extensionOrigin(req);
  if (origin) {
    response.headers.set("Access-Control-Allow-Origin", origin);
    response.headers.set("Access-Control-Allow-Headers", CAPTURE_HEADERS);
    response.headers.set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    response.headers.set("Vary", "Origin");
  }
  return response;
}
const header = (req: Request, name: string, max: number) => { try { return decodeURIComponent(req.headers.get(name) ?? "").slice(0, max); } catch { return (req.headers.get(name) ?? "").slice(0, max); } };
export async function OPTIONS(req: NextRequest) {
  return cors(req, new Response(null, { status: extensionOrigin(req) ? 204 : 403 }));
}
export async function GET(req: NextRequest) {
  return cors(req, Response.json({ ok: true, captures: listCaptures() }));
}
export async function POST(req: NextRequest) {
  try {
    if (req.headers.get("origin") && !extensionOrigin(req)) return Response.json({ error: "Captures are accepted only from the bundled browser extension." }, { status: 403 });
    const mimeType = req.headers.get("content-type") || "";
    const mediaType = mimeType.startsWith("video/") ? "video" : mimeType.startsWith("image/") ? "image" : undefined;
    if (!mediaType) return cors(req, Response.json({ error: "Send raw image or video bytes with a media Content-Type." }, { status: 400 }));
    const limit = (mediaType === "video" ? 100 : 15) * 1024 * 1024;
    if (Number(req.headers.get("content-length") ?? 0) > limit) return cors(req, Response.json({ error: "Media exceeds the size limit." }, { status: 413 }));
    const buffer = Buffer.from(await req.arrayBuffer());
    if (!buffer.byteLength || buffer.byteLength > limit) return cors(req, Response.json({ error: "Media is empty or exceeds the size limit." }, { status: 413 }));
    let sourceUrl = header(req, "x-capture-source-url", 2000);
    try { const u = new URL(sourceUrl); if (u.protocol !== "https:") throw new Error(); sourceUrl = u.toString(); } catch { sourceUrl = ""; }
    const url = await uploadBuffer(buffer, mimeType, "captures");
    const capture = saveCapture({ url, sourceUrl, author: header(req, "x-capture-author", 120), caption: header(req, "x-capture-caption", 2000), mediaType, postedAt: header(req, "x-capture-posted-at", 40) || undefined });
    return cors(req, Response.json({ ok: true, capture }, { status: 201 }));
  } catch (error) {
    return cors(req, Response.json({ error: (error as Error).message }, { status: 500 }));
  }
}
export async function DELETE(req: NextRequest) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return Response.json({ error: "Missing id." }, { status: 400 });
  deleteCapture(id);
  return Response.json({ ok: true });
}
