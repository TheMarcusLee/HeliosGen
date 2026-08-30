/**
 * Guest-mode workflow storage. Enabled only when GUEST_MODE is on; the hosted
 * app uses the Supabase `spaces` table via lib/useSpaceSync instead.
 *
 *   GET  → { spaces: GuestSpace[] }
 *   PUT  { spaces: GuestSpace[] } → { ok: true }
 */
import { NextRequest, NextResponse } from "next/server";
import { GUEST_MODE } from "@/lib/guestMode";
import { getSpaces, saveSpaces, type GuestSpace } from "@/lib/guest/spaces";

export const runtime = "nodejs";

export async function GET() {
  if (!GUEST_MODE) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ spaces: getSpaces() });
}

export async function PUT(req: NextRequest) {
  if (!GUEST_MODE) return NextResponse.json({ error: "not found" }, { status: 404 });

  let body: { spaces?: GuestSpace[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  if (!Array.isArray(body.spaces)) {
    return NextResponse.json({ error: "spaces[] required" }, { status: 400 });
  }

  saveSpaces(body.spaces);
  return NextResponse.json({ ok: true });
}
