"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { Handle, Node, NodeProps, Position, useUpdateNodeInternals } from "@xyflow/react";
import { FileJson, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { deriveComfyBindings, type ComfyBinding } from "@/lib/comfyWorkflow";
import { duplicateWorkflowNode } from "@/lib/duplicateWorkflowNode";
import { useWorkflowStore, type NodeData } from "@/lib/store";
import CornerResizer from "./CornerResizer";
import GenerateButton from "./GenerateButton";
import NodeActionBar from "./NodeActionBar";
import { useReadOnly } from "@/lib/readOnlyContext";

type ComfyNodeType = Node<NodeData, "comfyWorkflowNode">;

export async function runComfyCanvasNode(id: string): Promise<void> {
  const state = useWorkflowStore.getState();
  const node = state.nodes.find((candidate) => candidate.id === id);
  if (!node?.data.comfyWorkflow) throw new Error("Import a ComfyUI API workflow first.");
  const bindings = ((node.data.comfyBindings ?? []) as ComfyBinding[]).map((binding) => ({ ...binding }));
  for (const edge of state.edges.filter((candidate) => candidate.target === id && candidate.targetHandle?.startsWith("comfy:"))) {
    const bindingId = edge.targetHandle!.slice(6);
    const binding = bindings.find((candidate) => candidate.id === bindingId);
    const source = state.nodes.find((candidate) => candidate.id === edge.source);
    if (!binding || !source) continue;
    const value = binding.kind === "prompt"
      ? source.data.outputText ?? source.data.prompt ?? source.data.localPrompt
      : binding.kind === "image"
        ? source.data.r2Url ?? source.data.inputImage ?? source.data.imageUrl ?? source.data.capturedFrameUrl
        : binding.kind === "video"
          ? source.data.videoUrl ?? source.data.r2Url
          : binding.kind === "audio"
            ? source.data.audioUrl ?? source.data.r2Url
            : undefined;
    if (value !== undefined) binding.value = value;
  }
  const response = await fetch("/api/comfyui/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workflow: node.data.comfyWorkflow, bindings }) });
  const body = await response.json() as Record<string, unknown>;
  if (!response.ok) throw new Error(String(body.error ?? "ComfyUI execution failed."));
  state.updateNodeData(id, { status: "done", imageUrl: body.imageUrl as string | undefined, videoUrl: body.videoUrl as string | undefined, audioUrl: body.audioUrl as string | undefined, comfyOutputUrls: body.urls as string[] | undefined, comfyPromptId: body.promptId as string | undefined });
}

export default function ComfyWorkflowNode({ id, data, selected }: NodeProps<ComfyNodeType>) {
  const readOnly = useReadOnly();
  const updateNodeData = useWorkflowStore((state) => state.updateNodeData);
  const onNodesChange = useWorkflowStore((state) => state.onNodesChange);
  const updateNodeInternals = useUpdateNodeInternals();
  const inputRef = useRef<HTMLInputElement>(null);
  const [running, setRunning] = useState(false);
  const bindings = useMemo(() => (data.comfyBindings ?? []) as ComfyBinding[], [data.comfyBindings]);
  const mediaBindings = useMemo(() => bindings.filter((binding) => binding.kind !== "value"), [bindings]);
  const scalarBindings = useMemo(() => bindings.filter((binding) => binding.kind === "value"), [bindings]);

  const importWorkflow = async (file?: File) => {
    if (!file) return;
    try {
      const workflow = JSON.parse(await file.text()) as unknown;
      const nextBindings = deriveComfyBindings(workflow);
      updateNodeData(id, { comfyWorkflow: workflow, comfyBindings: nextBindings, comfyWorkflowName: file.name.replace(/\.json$/i, ""), status: "idle", errorMsg: undefined });
      queueMicrotask(() => updateNodeInternals(id));
    } catch (error) {
      updateNodeData(id, { status: "error", errorMsg: (error as Error).message });
    }
  };

  const updateBinding = (bindingId: string, value: unknown) => updateNodeData(id, { comfyBindings: bindings.map((binding) => binding.id === bindingId ? { ...binding, value } : binding) });
  const run = useCallback(async () => {
    setRunning(true);
    updateNodeData(id, { status: "running", errorMsg: undefined, imageUrl: undefined, videoUrl: undefined });
    try { await runComfyCanvasNode(id); }
    catch (error) { updateNodeData(id, { status: "error", errorMsg: (error as Error).message }); }
    finally { setRunning(false); }
  }, [id, updateNodeData]);

  return (
    <div className={`node-card flex h-full w-full flex-col overflow-hidden${running ? " node-generating" : ""}`} style={{ minWidth: 360 }}>
      <CornerResizer minWidth={340} minHeight={360} />
      <span className="node-above-label">{String(data.label ?? "COMFYUI")}</span>
      <NodeActionBar visible={selected && !readOnly} hasContent={!!(data.imageUrl || data.videoUrl)} onDelete={() => onNodesChange([{ type: "remove", id }])} onDuplicate={() => duplicateWorkflowNode(id)} />
      <div className="flex items-center gap-2 border-b border-white/8 p-3">
        <div className="flex size-8 items-center justify-center rounded-lg bg-violet-400/10 text-violet-300"><FileJson size={16} /></div>
        <div className="min-w-0 flex-1"><div className="truncate text-xs font-semibold text-white">{String(data.comfyWorkflowName ?? "ComfyUI workflow")}</div><div className="text-[10px] text-white/35">API format · {bindings.length} exposed inputs</div></div>
        <input ref={inputRef} type="file" accept=".json,application/json" className="hidden" onChange={(event) => { void importWorkflow(event.target.files?.[0]); event.target.value = ""; }} />
        <Button size="sm" variant="outline" disabled={readOnly} onClick={() => inputRef.current?.click()}><Upload size={13} />Import</Button>
      </div>
      <ScrollArea className="nodrag nowheel min-h-0 flex-1">
        <div className="space-y-3 p-3">
          {data.imageUrl && <Image src={String(data.imageUrl)} alt="ComfyUI output" width={512} height={512} unoptimized className="max-h-60 w-full rounded-xl object-contain" />}
          {data.videoUrl && <video src={String(data.videoUrl)} controls className="max-h-60 w-full rounded-xl" />}
          {mediaBindings.map((binding) => <div key={binding.id} className="relative rounded-lg border border-dashed border-white/10 px-3 py-2"><Handle id={`comfy:${binding.id}`} type="target" position={Position.Left} /><div className="text-xs text-white/70">{binding.nodeTitle} · {binding.inputName}</div><div className="text-[10px] text-violet-300/60">Connect {binding.kind}</div></div>)}
          {scalarBindings.map((binding) => <div key={binding.id} className="space-y-1"><label className="text-[10px] text-white/45">{binding.nodeTitle} · {binding.inputName}</label>{binding.valueType === "boolean" ? <Switch checked={Boolean(binding.value)} onCheckedChange={(value) => updateBinding(binding.id, value)} disabled={readOnly} /> : binding.valueType === "string" && String(binding.value).length > 80 ? <Textarea value={String(binding.value)} onChange={(event) => updateBinding(binding.id, event.target.value)} disabled={readOnly} className="min-h-20 border-white/10 bg-white/5 text-xs" /> : <Input type={binding.valueType === "number" ? "number" : "text"} value={String(binding.value)} onChange={(event) => updateBinding(binding.id, binding.valueType === "number" ? Number(event.target.value) : event.target.value)} disabled={readOnly} className="h-8 border-white/10 bg-white/5 text-xs" />}</div>)}
          {data.errorMsg && <div className="rounded-lg bg-red-500/10 p-2 text-[11px] text-red-300">{String(data.errorMsg)}</div>}
        </div>
      </ScrollArea>
      <div className="nodrag border-t border-white/8 p-2.5"><GenerateButton onClick={run} busy={running} disabled={!data.comfyWorkflow || readOnly} /></div>
      <Handle id="media" type="source" position={Position.Right} />
    </div>
  );
}
