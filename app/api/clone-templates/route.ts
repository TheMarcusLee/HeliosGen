import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getSpaces, saveSpaces, type GuestSpace } from "@/lib/guest/spaces";
import { IDENTITY_TEMPLATES, makeIdentityTemplate } from "@/lib/templates";
import { DEFAULT_WORKFLOW_METADATA, type WorkflowMetadata } from "@/lib/cloneMe";
import { getIdentityAsset } from "@/lib/guest/identityAssets";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ templates: IDENTITY_TEMPLATES.map(({ id, name, description }) => ({ id, name, description })) });
}

export async function POST(req: NextRequest) {
  const body = await req.json() as { templateId?: string; name?: string; identityAssetId?: string };
  const info = IDENTITY_TEMPLATES.find((t) => t.id === body.templateId);
  const template = body.templateId ? makeIdentityTemplate(body.templateId) : null;
  if (!template || !info) return NextResponse.json({ error: `templateId must be one of ${IDENTITY_TEMPLATES.map((t) => t.id).join(", ")}.` }, { status: 400 });
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
      if (node.type === "generateNode") {
        if (provider === "wavespeed" && modelId) {
          return {
            ...node,
            type: "waveSpeedNode",
            style: { width: 380, height: 560 },
            data: { label: node.data.label ?? "GALLERY OUTPUT", status: "idle", waveSpeedFamily: "image", waveSpeedModelId: modelId },
          };
        }
        return { ...node, data: { ...node.data, ...(aspectRatio ? { aspectRatio } : {}), ...(provider === "kie" && modelId ? { model: modelId } : {}) } };
      }
      if (node.id === "clone-batch") {
        return { ...node, data: { ...node.data, ...((provider === "wavespeed" || provider === "kie") ? { batchProvider: provider } : {}), ...(modelId ? { batchModelId: modelId } : {}) } };
      }
      return node;
    });
    if (provider === "wavespeed" && modelId) {
      const converted = new Set(template.nodes.filter((node) => node.type === "waveSpeedNode").map((node) => node.id));
      template.edges = template.edges.map((edge) => converted.has(edge.target)
        ? { ...edge, targetHandle: edge.targetHandle === "prompt" ? "ws:prompt" : edge.targetHandle === "image" ? "ws:image" : edge.targetHandle }
        : edge);
      if (converted.size) template.nodeCounters = { ...template.nodeCounters, generateNode: 0, waveSpeedNode: converted.size };
    }
  }
  const timestamp = Date.now();
  const workflow: GuestSpace = {
    id: randomUUID(),
    name: body.name?.trim().slice(0, 120) || info.name,
    ...template,
    metadata,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  saveSpaces([...getSpaces(), workflow]);
  return NextResponse.json({ workflow }, { status: 201 });
}
