import type { Node, Edge } from "@xyflow/react";
import type { NodeData } from "../store";
import type { GuestSpace } from "../guest/spaces";
import { effectivePrompt, type Campaign, type CampaignRun } from "./types";

/** The plan and canvas share stable step IDs and the exact execution prompts. */
export function compileCampaignWorkflow(campaign: Campaign, run: CampaignRun): GuestSpace {
  const nodes: Node<NodeData>[] = [];
  const edges: Edge[] = [];
  run.steps.forEach((step, index) => {
    const asset = campaign.assets.find(a => a.stepId === step.id);
    const x = index * 440;
    const prompt = step.kind === "text" ? step.prompt : effectivePrompt(step, run.identity);
    nodes.push({ id: `${step.id}-prompt`, type: "promptNode", position: { x, y: 0 }, data: { label: step.title, prompt }, style: { width: 360, height: 220 } });
    if (step.kind === "text") return;
    nodes.push({ id: step.id, type: step.kind === "image" ? "generateNode" : "videoGeneratorNode", position: { x, y: 340 }, style: { width: 360, height: 480 }, data: {
      label: step.title, prompt, generationProvider: run.imageProvider ?? "kie", model: run.imageModel, videoModel: run.videoModel, aspectRatio: step.aspectRatio, duration: 5,
      status: step.status === "done" ? "done" : step.status === "error" ? "error" : "idle",
      ...(asset?.url ? step.kind === "image" ? { imageUrl: asset.url } : { videoUrl: asset.url } : {}),
      ...(run.identity ? { identityAssetId: run.identity.id, identitySnapshot: run.identity } : {}),
    } });
    edges.push({ id: `${step.id}-text-edge`, source: `${step.id}-prompt`, target: step.id, targetHandle: "prompt" });
    if (step.referenceStep !== null) {
      edges.push({ id: `${step.id}-reference-edge`, source: run.steps[step.referenceStep].id, target: step.id, targetHandle: step.kind === "image" ? "image" : "startFrame" });
    } else {
      const urls = [...(run.referenceUrls ?? campaign.referenceUrls), ...(run.identity?.references.map(r => r.url) ?? [])];
      urls.slice(0, step.kind === "video" ? 1 : 8).forEach((url, r) => {
        const refId = `${step.id}-ref-${r}`;
        nodes.push({ id: refId, type: "imageInputNode", position: { x, y: 900 + r * 260 }, data: { label: `Reference ${r + 1}`, imageUrl: url, r2Url: url }, style: { width: 220, height: 220 } });
        edges.push({ id: `${refId}-edge`, source: refId, target: step.id, targetHandle: step.kind === "image" ? "image" : "startFrame" });
      });
    }
  });
  return { id: run.workflowId, name: campaign.title, nodes, edges, nodeCounters: {}, createdAt: campaign.createdAt, updatedAt: Date.now(), metadata: { contentClass: "sfw", routes: {} } };
}
