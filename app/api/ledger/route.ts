import { NextRequest, NextResponse } from "next/server";
import { listLedger } from "@/lib/guest/generationLedger";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const workflowId = req.nextUrl.searchParams.get("workflowId") || undefined;
  const nodeId = req.nextUrl.searchParams.get("nodeId") || undefined;
  const identityAssetId = req.nextUrl.searchParams.get("identityAssetId") || undefined;
  const limit = Number.parseInt(req.nextUrl.searchParams.get("limit") ?? "100", 10);
  return NextResponse.json(listLedger({ workflowId, nodeId, identityAssetId, limit }));
}
