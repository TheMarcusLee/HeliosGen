/**
 * Local workflow ("space") storage, backed by the SQLite DB (lib/guest/spaces).
 *
 *   GET  → { spaces: GuestSpace[] }
 *   PUT  { spaces: GuestSpace[] } → { ok: true }
 */
import { NextRequest, NextResponse } from "next/server";
import { getSpaces, saveSpaces, type GuestSpace } from "@/lib/guest/spaces";
import { sanitizeWorkflowGraph } from "@/lib/graphIntegrity";
import type { NodeData } from "@/lib/store";
import type { Edge, Node } from "@xyflow/react";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ spaces: getSpaces() });
}

export async function PUT(req: NextRequest) {
  let body: { spaces?: GuestSpace[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  if (!Array.isArray(body.spaces)) {
    return NextResponse.json({ error: "spaces[] required" }, { status: 400 });
  }

  saveSpaces(body.spaces.map((space) => {
    const clean = sanitizeWorkflowGraph(space.nodes as Node<NodeData>[], space.edges as Edge[]);
    return { ...space, nodes: clean.nodes, edges: clean.edges };
  }));
  return NextResponse.json({ ok: true });
}
