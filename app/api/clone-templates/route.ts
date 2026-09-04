import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getSpaces, saveSpaces, type GuestSpace } from "@/lib/guest/spaces";
import { makePoseOutfitBatchTemplate, makeSceneReplacementTemplate } from "@/lib/templates";
import { DEFAULT_WORKFLOW_METADATA } from "@/lib/cloneMe";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ templates: [
    { id: "scene-replacement", name: "Identity Scene Replacement", description: "Target scene → vision analysis → identity prompt → generation → gallery" },
    { id: "pose-outfit-batch", name: "Identity Pose × Outfit Batch", description: "Analyze once, then generate every selected pose/outfit combination" },
  ] });
}

export async function POST(req: NextRequest) {
  const body = await req.json() as { templateId?: string; name?: string };
  const template = body.templateId === "scene-replacement"
    ? makeSceneReplacementTemplate()
    : body.templateId === "pose-outfit-batch"
      ? makePoseOutfitBatchTemplate()
      : null;
  if (!template) return NextResponse.json({ error: "templateId must be scene-replacement or pose-outfit-batch." }, { status: 400 });
  const timestamp = Date.now();
  const workflow: GuestSpace = {
    id: randomUUID(),
    name: body.name?.trim().slice(0, 120) || (body.templateId === "scene-replacement" ? "Identity Scene Replacement" : "Identity Pose × Outfit Batch"),
    ...template,
    metadata: structuredClone(template.metadata ?? DEFAULT_WORKFLOW_METADATA),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  saveSpaces([...getSpaces(), workflow]);
  return NextResponse.json({ workflow }, { status: 201 });
}
