"use client";

import { Handle, Node, NodeProps, Position } from "@xyflow/react";
import { Textarea } from "@/components/ui/textarea";
import { useWorkflowStore, type NodeData } from "@/lib/store";
import { renderPromptTemplate } from "@/lib/templateVariables";
import { duplicateWorkflowNode } from "@/lib/duplicateWorkflowNode";
import CornerResizer from "./CornerResizer";
import NodeActionBar from "./NodeActionBar";
import { useReadOnly } from "@/lib/readOnlyContext";

type TemplateNodeType = Node<NodeData, "templateNode">;

export function resolveTemplateNode(id: string): { output: string; unresolved: string[] } {
  const state = useWorkflowStore.getState();
  const node = state.nodes.find((candidate) => candidate.id === id);
  if (!node) return { output: "", unresolved: [] };
  const variables: Record<string, string> = {};
  for (const edge of state.edges.filter((candidate) => candidate.target === id && candidate.targetHandle === "text")) {
    const source = state.nodes.find((candidate) => candidate.id === edge.source);
    if (!source) continue;
    const name = String(source.data.variableName ?? source.data.label ?? "input").replace(/[^A-Za-z0-9_]/g, "");
    const value = String(source.data.outputText ?? source.data.prompt ?? source.data.localPrompt ?? "");
    if (name && value) variables[name] = value;
  }
  return renderPromptTemplate(String(node.data.template ?? ""), variables);
}

export default function TemplateNode({ id, data, selected }: NodeProps<TemplateNodeType>) {
  const readOnly = useReadOnly();
  const updateNodeData = useWorkflowStore((state) => state.updateNodeData);
  const onNodesChange = useWorkflowStore((state) => state.onNodesChange);
  // Keep the preview reactive as connected nodes and edges change. The resolver
  // itself intentionally remains usable by the executor outside React.
  useWorkflowStore((state) => state.nodes);
  useWorkflowStore((state) => state.edges);
  const preview = resolveTemplateNode(id);
  return (
    <div className="node-card flex h-full w-full flex-col" style={{ minWidth: 300 }}>
      <CornerResizer minWidth={260} minHeight={220} />
      <span className="node-above-label">{String(data.label ?? "TEMPLATE")}</span>
      <NodeActionBar visible={selected && !readOnly} hasContent={!!preview.output} onDelete={() => onNodesChange([{ type: "remove", id }])} onDuplicate={() => duplicateWorkflowNode(id)} />
      <div className="border-b border-white/8 px-3 py-2 text-xs font-semibold text-white/80">Prompt template</div>
      <Textarea
        value={String(data.template ?? "")}
        onChange={(event) => updateNodeData(id, { template: event.target.value })}
        disabled={readOnly}
        placeholder="Hello @name…"
        className="nodrag nowheel m-3 min-h-28 flex-1 resize-none border-white/10 bg-white/5 font-mono text-xs"
      />
      <div className="mx-3 mb-3 max-h-24 overflow-auto rounded-lg bg-black/30 p-2 text-[10px] text-white/45">{preview.output || "Connect named text nodes to preview variables."}</div>
      <Handle id="text" type="target" position={Position.Left} />
      <Handle id="textOut" type="source" position={Position.Right} />
    </div>
  );
}
