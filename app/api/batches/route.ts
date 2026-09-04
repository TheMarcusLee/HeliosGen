import { NextRequest, NextResponse } from "next/server";
import { buildPoseOutfitMatrix, validateContentRoute } from "@/lib/cloneMe";
import { createBatchRun, getBatchRun, listBatchRuns, updateBatchItem, updateBatchRun, type BatchItem, type BatchRunState } from "@/lib/guest/batchRuns";
import { getIdentityAsset } from "@/lib/guest/identityAssets";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (id) {
    const batch = getBatchRun(id);
    return batch ? NextResponse.json({ batch }) : NextResponse.json({ error: "Batch not found." }, { status: 404 });
  }
  return NextResponse.json({ batches: listBatchRuns(req.nextUrl.searchParams.get("workflowId") ?? undefined) });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as Record<string, unknown>;
    const identityAssetId = String(body.identityAssetId ?? "");
    const identity = getIdentityAsset(identityAssetId);
    if (!identity) return NextResponse.json({ error: "Choose a saved identity asset." }, { status: 400 });
    const provider = body.provider === "kie" ? "kie" : "wavespeed";
    const modelId = String(body.modelId ?? "").trim();
    if (!modelId) return NextResponse.json({ error: "Choose a provider model." }, { status: 400 });
    const poses = Array.isArray(body.poses) ? body.poses.filter((v): v is string => typeof v === "string") : [];
    const outfits = Array.isArray(body.outfits) ? body.outfits.filter((v): v is string => typeof v === "string") : [];
    const combinations = buildPoseOutfitMatrix({
      identity, poses, outfits,
      analysis: typeof body.analysis === "string" ? body.analysis : undefined,
      scene: typeof body.scene === "string" ? body.scene : undefined,
      extra: typeof body.extra === "string" ? body.extra : undefined,
    });
    if (!combinations.length) return NextResponse.json({ error: "Add at least one pose and one outfit." }, { status: 400 });
    const metadata = validateContentRoute({
      prompt: combinations.map((item) => item.prompt).join("\n"), metadata: body.workflowMetadata,
      provider, modelId,
    });
    const items: BatchItem[] = combinations.map((item) => ({ ...item, status: "idle", attempts: 0 }));
    const batch = createBatchRun({
      workflowId: typeof body.workflowId === "string" ? body.workflowId : undefined,
      nodeId: typeof body.nodeId === "string" ? body.nodeId : undefined,
      identityAssetId, provider, modelId,
      concurrency: typeof body.concurrency === "number" ? body.concurrency : 2,
      status: "analysis", analysis: typeof body.analysis === "string" ? body.analysis : undefined, items,
    });
    return NextResponse.json({ batch, workflowMetadata: metadata }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to create batch." }, { status: 400 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json() as Record<string, unknown>;
    const id = String(body.id ?? "");
    if (typeof body.itemId === "string" && body.itemPatch && typeof body.itemPatch === "object") {
      return NextResponse.json({ batch: updateBatchItem(id, body.itemId, body.itemPatch as Partial<BatchItem>) });
    }
    const statusValues: BatchRunState[] = ["idle", "analysis", "generation", "paused", "completed", "error"];
    const status = statusValues.includes(body.status as BatchRunState) ? body.status as BatchRunState : undefined;
    const items = Array.isArray(body.items) ? body.items as BatchItem[] : undefined;
    const batch = updateBatchRun(id, {
      ...(status ? { status } : {}), ...(items ? { items } : {}),
      ...(typeof body.analysis === "string" ? { analysis: body.analysis } : {}),
      ...(typeof body.concurrency === "number" ? { concurrency: body.concurrency } : {}),
    });
    return NextResponse.json({ batch });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to update batch." }, { status: 400 });
  }
}
