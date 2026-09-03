/**
 * POST /api/upload-asset
 *
 * Unified raw-binary upload for images and videos.
 * Body  : raw file bytes
 * Headers:
 *   Content-Type : MIME type of the file (image/jpeg, video/mp4, …)
 *
 * Flow:
 *   1. Read body as Buffer
 *   2. Deduplication happens inside uploadBuffer (lib/storage.ts)
 *   3. Record in uploads
 *   4. Return stored URL
 */
import { NextRequest, NextResponse } from "next/server";
import { uploadBuffer } from "@/lib/storage";
import { GUEST_USER_ID } from "@/lib/guestMode";
import * as guestDb from "@/lib/guest/db";

export const maxDuration = 60;

const MAX_BYTES = 100 * 1024 * 1024; // 100 MB

export async function POST(req: NextRequest) {
  try {
    const mimeType = req.headers.get("content-type") ?? "application/octet-stream";

    const contentLength = Number(req.headers.get("content-length") ?? 0);
    if (contentLength > MAX_BYTES) {
      return NextResponse.json({ error: "File exceeds 100 MB limit" }, { status: 413 });
    }

    const bytes  = await req.arrayBuffer();
    const buffer = Buffer.from(bytes);

    if (buffer.byteLength > MAX_BYTES) {
      return NextResponse.json({ error: "File exceeds 100 MB limit" }, { status: 413 });
    }

    // ── Store on local disk (dedupe happens inside uploadBuffer) ─────────────
    const folder  = mimeType.startsWith("video/") ? "references" : "uploads";
    const cdnUrl  = await uploadBuffer(buffer, mimeType, folder);

    guestDb.insertUpload({ user_id: GUEST_USER_ID, r2_url: cdnUrl, mime_type: mimeType, source: "user_upload" });

    return NextResponse.json({ cdnUrl });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
