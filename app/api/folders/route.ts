import { NextRequest, NextResponse } from "next/server";
import { GUEST_USER_ID } from "@/lib/guestMode";
import * as guestDb from "@/lib/guest/db";
import { randomUUID } from "crypto";

export async function GET() {
  const folders = guestDb.getFolders(GUEST_USER_ID);
  const folderItems = guestDb.getFolderItems(GUEST_USER_ID);
  return NextResponse.json({ folders, folderItems });
}

export async function POST(req: NextRequest) {
  const body = await req.json() as { name: string; parentId?: string | null; orderIndex?: number };
  const { name, parentId = null, orderIndex = 0 } = body;
  if (!name || typeof name !== "string") {
    return NextResponse.json({ error: "Missing name" }, { status: 400 });
  }

  const folder = guestDb.insertFolder({
    id: randomUUID(),
    user_id: GUEST_USER_ID,
    name,
    parent_id: parentId ?? null,
    order_index: orderIndex,
  });
  return NextResponse.json({ folder });
}
