import { useWorkflowStore } from "./store";

export function duplicateWorkflowNode(nodeId: string): void {
  const state = useWorkflowStore.getState();
  const source = state.nodes.find((node) => node.id === nodeId);
  if (!source) return;
  const newId = `${source.type ?? "node"}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  state.onNodesChange([{ type: "select", id: nodeId, selected: false }]);
  state.addNode({
    ...source,
    id: newId,
    position: { x: source.position.x + 20, y: source.position.y + 20 },
    selected: true,
    data: { ...source.data, status: "idle", taskId: undefined, hasError: false },
  });
  state.edges
    .filter((edge) => (edge.source === nodeId || edge.target === nodeId) && edge.deletable !== false)
    .forEach((edge) => state.insertEdge({
      ...edge,
      id: `edge-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      source: edge.source === nodeId ? newId : edge.source,
      target: edge.target === nodeId ? newId : edge.target,
    }));
}
