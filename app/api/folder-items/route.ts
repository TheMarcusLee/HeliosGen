import { NextRequest, NextResponse } from "next/server";
import { GUEST_USER_ID } from "@/lib/guestMode";
import * as guestDb from "@/lib/guest/db";

export async function POST(req: NextRequest) {
  const body = await req.json() as { folderId: string; itemIds: string[] };
  const { folderId, itemIds } = body;
  if (!folderId || !Array.isArray(itemIds)) {
    return NextResponse.json({ error: "Missing folderId or itemIds" }, { status: 400 });
  }

  guestDb.insertFolderItems(folderId, itemIds, GUEST_USER_ID);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const body = await req.json() as { folderId: string; itemIds: string[] };
  const { folderId, itemIds } = body;
  if (!folderId || !Array.isArray(itemIds)) {
    return NextResponse.json({ error: "Missing folderId or itemIds" }, { status: 400 });
  }

  guestDb.deleteFolderItems(folderId, itemIds, GUEST_USER_ID);
  return NextResponse.json({ ok: true });
}
