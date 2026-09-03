import { NextRequest, NextResponse } from "next/server";
import { GUEST_USER_ID } from "@/lib/guestMode";
import * as guestDb from "@/lib/guest/db";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await req.json() as { name?: string; parentId?: string | null; orderIndex?: number; color?: string | null };

  guestDb.updateFolder(id, GUEST_USER_ID, {
    ...(body.name !== undefined ? { name: body.name } : {}),
    ...(body.parentId !== undefined ? { parent_id: body.parentId ?? null } : {}),
    ...(body.orderIndex !== undefined ? { order_index: body.orderIndex } : {}),
    ...(body.color !== undefined ? { color: body.color } : {}),
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  guestDb.deleteFolder(id, GUEST_USER_ID);
  return NextResponse.json({ ok: true });
}
