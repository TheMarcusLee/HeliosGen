/**
 * SHA-256 → stored-URL index for uploaded/generated media, so re-uploading the
 * same bytes reuses the existing file. Backed by the local SQLite DB
 * (`lib/guest/db.ts`).
 */
import { createHash } from "crypto";
import * as guestDb from "./guest/db";

/** Compute SHA-256 hex from a Node.js Buffer (server-side). */
export function hashBuffer(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

/** Look up a previously-stored asset by its SHA-256 hash. */
export async function lookupAssetHash(hash: string): Promise<string | null> {
  return guestDb.lookupAssetHash(hash);
}

/** Store a hash → URL mapping (idempotent). */
export async function storeAssetHash(
  hash: string,
  cdnUrl: string,
  mimeType: string,
  byteSize: number,
): Promise<void> {
  guestDb.storeAssetHash(hash, cdnUrl, mimeType, byteSize);
}
