import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getSpaces, saveSpaces, type GuestSpace } from "@/lib/guest/spaces";
import { makePoseOutfitBatchTemplate, makeSceneReplacementTemplate } from "@/lib/templates";
import { DEFAULT_WORKFLOW_METADATA, type WorkflowMetadata } from "@/lib/cloneMe";
import { getIdentityAsset } from "@/lib/guest/identityAssets";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ templates: [
    { id: "scene-replacement", name: "Identity Scene Replacement", description: "Target scene → vision analysis → identity prompt → generation → gallery" },
    { id: "pose-outfit-batch", name: "Identity Pose × Outfit Batch", description: "Analyze once, then generate every selected pose/outfit combination" },
  ] });
}

export async function POST(req: NextRequest) {
  const body = await req.json() as { templateId?: string; name?: string; identityAssetId?: string };
  const template = body.templateId === "scene-replacement"
    ? makeSceneReplacementTemplate()
    : body.templateId === "pose-outfit-batch"
      ? makePoseOutfitBatchTemplate()
      : null;
  if (!template) return NextResponse.json({ error: "templateId must be scene-replacement or pose-outfit-batch." }, { status: 400 });
  const identity = body.identityAssetId ? getIdentityAsset(body.identityAssetId) : null;
  if (body.identityAssetId && !identity) return NextResponse.json({ error: "Identity asset not found." }, { status: 404 });

  let metadata = structuredClone(template.metadata ?? DEFAULT_WORKFLOW_METADATA);
  if (identity) {
    const { contentClass, provider, modelId, aspectRatio } = identity.defaults;
    if (provider && modelId) {
      metadata = {
        contentClass,
        routingRequired: true,
        routes: { [contentClass]: { provider, modelId } },
        ...(contentClass === "adult" ? { adultAssurances: { allSubjectsAdults: false, consentVerified: false } } : {}),
      } satisfies WorkflowMetadata;
    } else if (contentClass === "adult") {
      metadata = {
        contentClass: "adult",
        routingRequired: true,
        routes: {},
        adultAssurances: { allSubjectsAdults: false, consentVerified: false },
      };
    }

    template.nodes = template.nodes.map((node) => {
      if (node.id === "clone-identity") {
        return {
          ...node,
          data: {
            ...node.data,
            identityAssetId: identity.id,
            identitySnapshot: identity,
            outputText: [identity.triggerWord, ...identity.basePrompts].filter(Boolean).join("\n"),
          },
        };
      }
      if (node.id === "clone-generate") {
        if (provider === "wavespeed" && modelId) {
          return {
            ...node,
            type: "waveSpeedNode",
            style: { width: 380, height: 560 },
            data: { label: "GALLERY OUTPUT", status: "idle", waveSpeedFamily: "image", waveSpeedModelId: modelId },
          };
        }
        return { ...node, data: { ...node.data, ...(aspectRatio ? { aspectRatio } : {}), ...(provider === "kie" && modelId ? { model: modelId } : {}) } };
      }
      if (node.id === "clone-batch") {
        return { ...node, data: { ...node.data, ...((provider === "wavespeed" || provider === "kie") ? { batchProvider: provider } : {}), ...(modelId ? { batchModelId: modelId } : {}) } };
      }
      return node;
    });
    if (provider === "wavespeed" && modelId && body.templateId === "scene-replacement") {
      template.edges = template.edges.map((edge) => edge.target === "clone-generate"
        ? { ...edge, targetHandle: edge.targetHandle === "prompt" ? "ws:prompt" : edge.targetHandle === "image" ? "ws:image" : edge.targetHandle }
        : edge);
      template.nodeCounters = { ...template.nodeCounters, generateNode: 0, waveSpeedNode: 1 };
    }
  }
  const timestamp = Date.now();
  const workflow: GuestSpace = {
    id: randomUUID(),
    name: body.name?.trim().slice(0, 120) || (body.templateId === "scene-replacement" ? "Identity Scene Replacement" : "Identity Pose × Outfit Batch"),
    ...template,
    metadata,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  saveSpaces([...getSpaces(), workflow]);
  return NextResponse.json({ workflow }, { status: 201 });
}
