import type { Edge, Node } from "@xyflow/react";
import type { NodeData, Space } from "./store";

export interface GraphSanitization {
  nodes: Node<NodeData>[];
  edges: Edge[];
  removedEdges: number;
}

export function sanitizeWorkflowGraph(nodes: Node<NodeData>[], edges: Edge[]): GraphSanitization {
  const ids = new Set(nodes.map((node) => node.id));
  const seenEdges = new Set<string>();
  const cleanEdges = edges.filter((edge) => {
    if (!ids.has(edge.source) || !ids.has(edge.target) || edge.source === edge.target) return false;
    const key = [edge.source, edge.sourceHandle ?? "", edge.target, edge.targetHandle ?? ""].join("\u0000");
    if (seenEdges.has(key)) return false;
    seenEdges.add(key);
    return true;
  });
  const cleanNodes = nodes.map((node) => {
    if (node.type !== "groupNode" || !Array.isArray(node.data.memberIds)) return node;
    const memberIds = [...new Set((node.data.memberIds as string[]).filter((id) => id !== node.id && ids.has(id)))];
    return { ...node, data: { ...node.data, memberIds } };
  });
  return { nodes: cleanNodes, edges: cleanEdges, removedEdges: edges.length - cleanEdges.length };
}

export function sanitizeSpace(space: Space): Space {
  const graph = sanitizeWorkflowGraph(space.nodes, space.edges);
  return { ...space, nodes: graph.nodes, edges: graph.edges };
}

export function createHistorySnapshot(nodes: Node<NodeData>[], edges: Edge[]): { nodes: Node<NodeData>[]; edges: Edge[] } {
  const graph = sanitizeWorkflowGraph(nodes, edges);
  return {
    nodes: graph.nodes.map((node) => {
      const data = { ...node.data };
      if (typeof data.inputImage === "string" && (data.inputImage.startsWith("data:") || data.inputImage.startsWith("blob:"))) delete data.inputImage;
      delete data.taskId;
      if (data.status === "running" || data.status === "pending") data.status = "idle";
      return { ...node, data };
    }),
    edges: graph.edges.map((edge) => ({ ...edge, data: edge.data ? { ...edge.data } : undefined })),
  };
}
