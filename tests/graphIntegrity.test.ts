import test from "node:test";
import assert from "node:assert/strict";
import { createHistorySnapshot, sanitizeWorkflowGraph } from "../lib/graphIntegrity";

test("removes orphan, self-loop, and duplicate edges", () => {
  const nodes = [
    { id: "a", position: { x: 0, y: 0 }, data: { label: "A" } },
    { id: "b", position: { x: 0, y: 0 }, data: { label: "B" } },
  ];
  const edges = [
    { id: "1", source: "a", target: "b" },
    { id: "2", source: "a", target: "b" },
    { id: "3", source: "a", target: "missing" },
    { id: "4", source: "a", target: "a" },
  ];
  const result = sanitizeWorkflowGraph(nodes, edges);
  assert.equal(result.edges.length, 1);
  assert.equal(result.removedEdges, 3);
});

test("history snapshots exclude volatile blob payloads and running state", () => {
  const snapshot = createHistorySnapshot([
    { id: "a", position: { x: 0, y: 0 }, data: { label: "A", inputImage: "data:image/png;base64,abc", taskId: "task", status: "running" } },
  ], []);
  assert.equal(snapshot.nodes[0].data.inputImage, undefined);
  assert.equal(snapshot.nodes[0].data.taskId, undefined);
  assert.equal(snapshot.nodes[0].data.status, "idle");
});
