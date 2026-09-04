import type { Edge, Node } from "@xyflow/react";
import type { NodeData } from "./store";
import { buildWaveSpeedInput, validateWaveSpeedInput } from "./wavespeedSchema";
import { resolveIdentityAssetId, resolveWaveSpeedConnectedInputs } from "./executor";
import type { WorkflowMetadata } from "./cloneMe";

export interface WaveSpeedRunResult {
  taskId: string;
  imageUrl?: string;
  imageUrls?: string[];
  videoUrl?: string;
  estimatedCost?: number;
}

export async function runWaveSpeedCanvasNode(input: {
  node: Node<NodeData>;
  nodes: Node<NodeData>[];
  edges: Edge[];
  workflowId?: string;
  workflowMetadata?: WorkflowMetadata;
}): Promise<WaveSpeedRunResult> {
  const schema = input.node.data.waveSpeedSchema;
  const parameters = (input.node.data.waveSpeedParameters ?? {}) as Record<string, unknown>;
  const connected = resolveWaveSpeedConnectedInputs(input.node.id, schema, input.nodes, input.edges);
  const requestInput = buildWaveSpeedInput(schema, parameters, connected);
  const missing = validateWaveSpeedInput(schema, requestInput);
  if (missing.length) throw new Error(`Missing required input${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}`);

  const modelId = String(input.node.data.waveSpeedModelId ?? "");
  if (!modelId) throw new Error("Choose a WaveSpeed model first.");
  const mediaType = input.node.data.waveSpeedFamily === "video" ? "video" : "image";
  const response = await fetch("/api/wavespeed/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      modelId,
      mediaType,
      input: requestInput,
      fallbackModelIds: input.node.data.waveSpeedFallbacks ?? [],
      maxCost: input.node.data.waveSpeedMaxCost,
      workflowId: input.workflowId,
      nodeId: input.node.id,
      workflowMetadata: input.workflowMetadata,
      identityAssetId: resolveIdentityAssetId(input.node.id, input.nodes, input.edges),
    }),
  });
  const submitted = await response.json() as Record<string, unknown>;
  if (!response.ok) throw new Error(String(submitted.error ?? "WaveSpeed generation failed."));
  const taskId = String(submitted.taskId);

  return await new Promise<WaveSpeedRunResult>((resolve, reject) => {
    const stream = new EventSource(`/api/job-stream?taskId=${encodeURIComponent(taskId)}`);
    stream.onmessage = (event) => {
      const result = JSON.parse(event.data) as Record<string, unknown>;
      stream.close();
      if (result.status === "done") {
        resolve({
          taskId,
          imageUrl: result.imageUrl as string | undefined,
          imageUrls: result.imageUrls as string[] | undefined,
          videoUrl: result.videoUrl as string | undefined,
          estimatedCost: typeof submitted.estimatedCost === "number" ? submitted.estimatedCost : undefined,
        });
      } else {
        reject(new Error(String(result.error ?? "WaveSpeed generation failed.")));
      }
    };
    stream.onerror = () => {
      stream.close();
      reject(new Error("Lost connection while waiting for WaveSpeed."));
    };
  });
}
