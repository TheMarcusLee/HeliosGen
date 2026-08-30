/**
 * GET /generated/<folder>/<file>
 *
 * Serves guest-mode media. In web/dev these files live under `public/generated/`
 * and Next's static handler answers first — this route never runs. In the
 * packaged desktop app the bytes live in a per-user app-data dir (MEDIA_DIR),
 * outside `public/`, so this fallback streams them with the right content type.
 */
import { NextRequest, NextResponse } from "next/server";
import { createReadStream, existsSync, statSync } from "fs";
import { join, normalize, extname } from "path";
import { Readable } from "stream";
import { MEDIA_DIR } from "@/lib/guest/paths";

export const runtime = "nodejs";

const CONTENT_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
};

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path: segments } = await params;

  // Reject traversal — the joined path must stay inside MEDIA_DIR.
  const rel = normalize(segments.join("/"));
  if (rel.startsWith("..") || rel.includes("\0")) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const filePath = join(MEDIA_DIR, rel);
  if (!filePath.startsWith(normalize(MEDIA_DIR)) || !existsSync(filePath)) {
    return new NextResponse("Not found", { status: 404 });
  }

  const { size } = statSync(filePath);
  const type = CONTENT_TYPES[extname(filePath).toLowerCase()] ?? "application/octet-stream";
  const stream = Readable.toWeb(createReadStream(filePath)) as unknown as ReadableStream;

  return new NextResponse(stream, {
    headers: {
      "Content-Type": type,
      "Content-Length": String(size),
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
