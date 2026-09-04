import type { Edge, Node } from "@xyflow/react";
import type { NodeData, Space } from "./store";

export const NODE_BANANA_CONVERTER_VERSION = 1;

type JsonRecord = Record<string, unknown>;

export interface NodeBananaConversion {
  version: number;
  name: string;
  nodes: Node<NodeData>[];
  edges: Edge[];
  nodeCounters: Record<string, number>;
  warnings: string[];
  unsupportedNodeTypes: string[];
}

const TYPE_MAP: Record<string, string> = {
  prompt: "promptNode",
  imageInput: "imageInputNode",
  videoInput: "videoInputNode",
  llmGenerate: "assistantNode",
  promptConstructor: "templateNode",
  generateImage: "waveSpeedNode",
  generateVideo: "waveSpeedNode",
  annotation: "annotationNode",
};

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function convertData(type: string, source: JsonRecord, index: number): NodeData {
  const mapped = TYPE_MAP[type];
  const selectedModel = record(source.selectedModel);
  const modelId = String(selectedModel.modelId ?? source.modelId ?? "");
  const label = String(source.label ?? `${type} #${index + 1}`);
  if (mapped === "promptNode") return { label, prompt: String(source.prompt ?? ""), variableName: source.variableName as string | undefined };
  if (mapped === "imageInputNode") return { label, inputImage: (source.imageUrl ?? source.image) as string | undefined, r2Url: source.imageUrl as string | undefined };
  if (mapped === "videoInputNode") return { label, videoUrl: source.videoUrl as string | undefined };
  if (mapped === "assistantNode") return { label, localPrompt: String(source.prompt ?? ""), model: String(source.model ?? "claude-opus-5"), status: "idle" };
  if (mapped === "templateNode") return { label, template: String(source.template ?? ""), status: "idle" };
  if (mapped === "waveSpeedNode") return {
    label,
    status: "idle",
    waveSpeedFamily: type === "generateVideo" ? "video" : "image",
    waveSpeedModelId: modelId || undefined,
    waveSpeedModelName: String(selectedModel.displayName ?? modelId) || undefined,
    waveSpeedParameters: record(source.parameters),
  };
  if (mapped === "annotationNode") return { label, annotations: Array.isArray(source.annotations) ? source.annotations : [], status: "idle" };
  return { label, comment: `Unsupported Node Banana node: ${type}`, status: "idle" };
}

function mapHandle(type: string, handle: unknown, direction: "source" | "target"): string | undefined {
  const value = String(handle ?? "");
  if (direction === "source") {
    if (type === "assistantNode" || type === "templateNode") return "textOut";
    if (type === "waveSpeedNode" || type === "annotationNode" || type === "comfyWorkflowNode") return "media";
    // Prompt, image-input, and video-input nodes use their default (unnamed)
    // output handle in HeliosGen.
    return undefined;
  }
  if (type === "templateNode") return "text";
  if (type === "assistantNode") return value.includes("image") ? "image" : "prompt";
  if (type === "waveSpeedNode") {
    if (value.includes("text")) return "ws:prompt";
    if (value.includes("image")) return "ws:image";
    if (value.includes("video")) return "ws:video";
  }
  if (type === "annotationNode") return "image";
  return value || undefined;
}

export function convertNodeBananaWorkflow(value: unknown): NodeBananaConversion {
  const root = record(value);
  if (!Array.isArray(root.nodes) || !Array.isArray(root.edges)) throw new Error("This is not a valid Node Banana workflow.");
  const warnings: string[] = [];
  const unsupported = new Set<string>();
  const nodeTypeById = new Map<string, string>();
  const nodes = root.nodes.map((raw, index) => {
    const source = record(raw);
    const oldType = String(source.type ?? "unknown");
    const type = TYPE_MAP[oldType] ?? "commentNode";
    if (!TYPE_MAP[oldType]) unsupported.add(oldType);
    const id = String(source.id ?? `node-banana-${index}`);
    nodeTypeById.set(id, type);
    const position = record(source.position);
    return {
      id,
      type,
      position: { x: Number(position.x ?? 0), y: Number(position.y ?? 0) },
      data: convertData(oldType, record(source.data), index),
      style: { width: type === "waveSpeedNode" ? 380 : type === "templateNode" ? 340 : 280, height: type === "waveSpeedNode" ? 560 : type === "templateNode" ? 300 : 220 },
    } satisfies Node<NodeData>;
  });
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = root.edges.flatMap((raw, index) => {
    const source = record(raw);
    const sourceId = String(source.source ?? "");
    const targetId = String(source.target ?? "");
    if (!nodeIds.has(sourceId) || !nodeIds.has(targetId)) return [];
    const sourceType = nodeTypeById.get(sourceId) ?? "";
    const targetType = nodeTypeById.get(targetId) ?? "";
    return [{
      id: String(source.id ?? `nb-edge-${index}`),
      source: sourceId,
      target: targetId,
      sourceHandle: mapHandle(sourceType, source.sourceHandle, "source"),
      targetHandle: mapHandle(targetType, source.targetHandle, "target"),
    } satisfies Edge];
  });
  if (unsupported.size) warnings.push(`Converted unsupported node types to comments: ${[...unsupported].join(", ")}`);
  warnings.push("Provider model settings are preserved where possible; review each generated provider node before running.");
  const nodeCounters = nodes.reduce<Record<string, number>>((counts, node) => ({ ...counts, [node.type!]: (counts[node.type!] ?? 0) + 1 }), {});
  return {
    version: NODE_BANANA_CONVERTER_VERSION,
    name: String(root.name ?? "Node Banana workflow"),
    nodes,
    edges,
    nodeCounters,
    warnings,
    unsupportedNodeTypes: [...unsupported],
  };
}

export function conversionToSpace(conversion: NodeBananaConversion): Pick<Space, "nodes" | "edges" | "nodeCounters"> {
  return { nodes: conversion.nodes, edges: conversion.edges, nodeCounters: conversion.nodeCounters };
}
