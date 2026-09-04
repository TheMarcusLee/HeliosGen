"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Handle, Node, NodeProps, Position } from "@xyflow/react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useWorkflowStore, type NodeData } from "@/lib/store";
import type { IdentityAsset } from "@/lib/cloneMe";
import type { BatchItem, BatchRun } from "@/lib/guest/batchRuns";
import type { WaveSpeedModel, WaveSpeedRequestProperty } from "@/lib/wavespeedTypes";
import { waveSpeedInputKind } from "@/lib/wavespeedSchema";
import { duplicateWorkflowNode } from "@/lib/duplicateWorkflowNode";
import { useReadOnly } from "@/lib/readOnlyContext";
import CornerResizer from "./CornerResizer";
import NodeActionBar from "./NodeActionBar";
import { Pause, Play, RotateCcw } from "lucide-react";

type BatchNodeType = Node<NodeData, "batchQueueNode">;

function lines(value: unknown, fallback: string[]): string[] {
  return Array.isArray(value) ? value.map(String) : fallback;
}

export default function BatchQueueNode({ id, data, selected }: NodeProps<BatchNodeType>) {
  const readOnly = useReadOnly();
  const updateNodeData = useWorkflowStore((state) => state.updateNodeData);
  const onNodesChange = useWorkflowStore((state) => state.onNodesChange);
  const addToast = useWorkflowStore((state) => state.addToast);
  const edges = useWorkflowStore((state) => state.edges);
  const nodes = useWorkflowStore((state) => state.nodes);
  const [identities, setIdentities] = useState<IdentityAsset[]>([]);
  const [running, setRunning] = useState(false);
  const pausedRef = useRef(Boolean(data.batchPaused));
  const items = (data.batchItems ?? []) as BatchItem[];

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const response = await fetch("/api/identities");
        if (!response.ok) throw new Error("Unable to load saved identities.");
        const body = await response.json() as { identities?: IdentityAsset[] };
        if (active) setIdentities(body.identities ?? []);
      } catch (error) {
        if (active) addToast((error as Error).message, "error");
      }
    })();
    return () => { active = false; };
  }, [addToast]);
  useEffect(() => { pausedRef.current = Boolean(data.batchPaused); }, [data.batchPaused]);

  const connectedIdentityId = (() => {
    const edge = edges.find((candidate) => candidate.target === id && candidate.targetHandle === "identity");
    return nodes.find((node) => node.id === edge?.source)?.data.identityAssetId as string | undefined;
  })();
  const connectedAnalysis = (() => {
    const edge = edges.find((candidate) => candidate.target === id && candidate.targetHandle === "analysis");
    const source = nodes.find((node) => node.id === edge?.source);
    return String(source?.data.outputText ?? source?.data.prompt ?? "");
  })();
  const identityAssetId = connectedIdentityId ?? String(data.identityAssetId ?? "");

  const persist = useCallback(async (batch: BatchRun) => {
    const response = await fetch("/api/batches", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: batch.id, status: batch.status, items: batch.items, analysis: batch.analysis, concurrency: batch.concurrency }) });
    const body = await response.json() as { batch?: BatchRun; error?: string };
    if (!response.ok || !body.batch) throw new Error(body.error ?? "Unable to update batch.");
    updateNodeData(id, { batchRunId: body.batch.id, batchItems: body.batch.items, status: body.batch.status === "completed" ? "done" : body.batch.status === "error" ? "error" : "running" });
    return body.batch;
  }, [id, updateNodeData]);

  const providerInput = useCallback(async (prompt: string, identity: IdentityAsset, modelId: string) => {
    const response = await fetch(`/api/wavespeed/models?modelId=${encodeURIComponent(modelId)}&includeSchema=true`);
    const body = await response.json() as { model?: WaveSpeedModel; error?: string };
    if (!response.ok || !body.model) throw new Error(body.error ?? "WaveSpeed model not found.");
    const input: Record<string, unknown> = {};
    for (const [name, property] of Object.entries(body.model.requestSchema?.properties ?? {}) as [string, WaveSpeedRequestProperty][]) {
      const kind = waveSpeedInputKind(name, property);
      if (kind === "prompt" && input[name] === undefined) input[name] = prompt;
      if (kind === "image" && input[name] === undefined && identity.references.length) input[name] = property.type === "array" ? identity.references.map((reference) => reference.url) : identity.references[0].url;
      if (kind === "value" && property.default !== undefined) input[name] = property.default;
    }
    return input;
  }, []);

  const persistItem = useCallback(async (batchId: string, itemId: string, itemPatch: Partial<BatchItem>) => {
    const response = await fetch("/api/batches", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: batchId, itemId, itemPatch }) });
    const body = await response.json() as { batch?: BatchRun; error?: string };
    if (!response.ok || !body.batch) throw new Error(body.error ?? "Unable to update batch item.");
    updateNodeData(id, { batchItems: body.batch.items });
    return body.batch;
  }, [id, updateNodeData]);

  const execute = useCallback(async (existing?: BatchRun, retryErrors = false) => {
    if (running || pausedRef.current) return;
    setRunning(true);
    try {
      const identity = identities.find((item) => item.id === identityAssetId);
      if (!identity) throw new Error("Choose or connect a saved identity matrix.");
      const workflowState = useWorkflowStore.getState();
      const workflow = workflowState.spaces.find((space) => space.id === workflowState.activeSpaceId);
      let batch = existing;
      if (!batch) {
        const response = await fetch("/api/batches", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
          workflowId: workflowState.activeSpaceId, nodeId: id, identityAssetId, provider: data.batchProvider ?? "wavespeed",
          modelId: String(data.batchModelId ?? ""), poses: lines(data.batchPoses, []), outfits: lines(data.batchOutfits, []),
          scene: data.batchScene, analysis: connectedAnalysis || data.batchAnalysis, concurrency: data.batchConcurrency ?? 2, workflowMetadata: workflow?.metadata,
        }) });
        const body = await response.json() as { batch?: BatchRun; error?: string };
        if (!response.ok || !body.batch) throw new Error(body.error ?? "Unable to start batch.");
        batch = body.batch;
      }
      let current: BatchRun = { ...batch, status: "generation", items: batch.items.map((item) => retryErrors && item.status === "error" ? { ...item, status: "idle" as const, error: undefined } : item) };
      current = await persist(current);
      const queue = current.items.filter((item) => item.status === "idle");
      let cursor = 0;
      const worker = async () => {
        while (!pausedRef.current) {
          const item = queue[cursor++];
          if (!item) return;
          current = await persistItem(current.id, item.id, { status: "generation", attempts: item.attempts + 1 });
          try {
            const requestInput = await providerInput(item.prompt, identity, current.modelId);
            const response = await fetch("/api/wavespeed/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ modelId: current.modelId, mediaType: "image", input: requestInput, workflowId: current.workflowId, nodeId: current.nodeId, workflowMetadata: workflow?.metadata }) });
            const submitted = await response.json() as { taskId?: string; error?: string };
            if (!response.ok || !submitted.taskId) throw new Error(submitted.error ?? "Generation failed.");
            const outputUrl = await new Promise<string>((resolve, reject) => {
              const stream = new EventSource(`/api/job-stream?taskId=${encodeURIComponent(submitted.taskId!)}`);
              stream.onmessage = (event) => {
                stream.close();
                const result = JSON.parse(event.data) as { status: string; imageUrl?: string; error?: string };
                if (result.status === "done" && result.imageUrl) resolve(result.imageUrl);
                else reject(new Error(result.error ?? "Generation failed."));
              };
              stream.onerror = () => { stream.close(); reject(new Error("Lost connection while waiting for the batch item.")); };
            });
            current = await persistItem(current.id, item.id, { status: "completed", taskId: submitted.taskId, outputUrl, error: undefined });
          } catch (error) {
            current = await persistItem(current.id, item.id, { status: "error", error: (error as Error).message });
          }
        }
      };
      await Promise.all(Array.from({ length: current.concurrency }, () => worker()));
      const latestResponse = await fetch(`/api/batches?id=${encodeURIComponent(current.id)}`);
      const latestBody = await latestResponse.json() as { batch?: BatchRun };
      if (latestBody.batch) current = latestBody.batch;
      const status = pausedRef.current ? "paused" : current.items.some((item) => item.status === "error") ? "error" : "completed";
      current = await persist({ ...current, status });
      updateNodeData(id, { batchItems: current.items, batchRunId: current.id, batchPaused: status === "paused", status: status === "completed" ? "done" : status === "error" ? "error" : "idle" });
    } catch (error) { updateNodeData(id, { status: "error", errorMsg: (error as Error).message }); addToast((error as Error).message, "error"); }
    finally { setRunning(false); }
  }, [addToast, connectedAnalysis, data.batchAnalysis, data.batchConcurrency, data.batchModelId, data.batchOutfits, data.batchPoses, data.batchProvider, data.batchScene, id, identities, identityAssetId, persist, persistItem, providerInput, running, updateNodeData]);

  const pause = useCallback(() => { pausedRef.current = true; updateNodeData(id, { batchPaused: true }); }, [id, updateNodeData]);
  const resumeOrStart = useCallback(async (retryErrors = false) => {
    pausedRef.current = false;
    updateNodeData(id, { batchPaused: false });
    const batchRunId = String(data.batchRunId ?? "");
    if (!batchRunId) { await execute(undefined, retryErrors); return; }
    const response = await fetch(`/api/batches?id=${encodeURIComponent(batchRunId)}`);
    const body = await response.json() as { batch?: BatchRun };
    await execute(body.batch, retryErrors);
  }, [data.batchRunId, execute, id, updateNodeData]);
  const completed = items.filter((item) => item.status === "completed").length;
  const errors = items.filter((item) => item.status === "error").length;

  return (
    <div className={`node-card flex h-full w-full flex-col overflow-hidden${running ? " node-generating" : ""}`} style={{ minWidth: 380 }}>
      <CornerResizer minWidth={360} minHeight={440} />
      <span className="node-above-label">{String(data.label ?? "POSE × OUTFIT QUEUE")}</span>
      <NodeActionBar visible={selected && !readOnly} hasContent={completed > 0} onDelete={() => onNodesChange([{ type: "remove", id }])} onDuplicate={() => duplicateWorkflowNode(id)} />
      <div className="flex items-center justify-between border-b border-white/8 px-3 py-2"><div><div className="text-xs font-semibold text-white/85">Pose × outfit queue</div><div className="text-[10px] text-white/40">One analysis, every selected combination</div></div><Badge variant={errors ? "destructive" : "secondary"}>{completed}/{items.length || "—"}</Badge></div>
      <div className="nodrag nowheel min-h-0 flex-1 overflow-y-auto p-3">
        <FieldGroup>
          <Field><FieldLabel>Identity</FieldLabel><Select value={identityAssetId} onValueChange={(value) => updateNodeData(id, { identityAssetId: value ?? undefined })} disabled={readOnly || !!connectedIdentityId}><SelectTrigger><SelectValue placeholder="Choose identity…" /></SelectTrigger><SelectContent><SelectGroup>{identities.map((identity) => <SelectItem key={identity.id} value={identity.id}>{identity.name} · v{identity.version}</SelectItem>)}</SelectGroup></SelectContent></Select></Field>
          <Field><FieldLabel>WaveSpeed model ID</FieldLabel><Input value={String(data.batchModelId ?? "")} disabled={readOnly} onChange={(event) => updateNodeData(id, { batchModelId: event.target.value, batchProvider: "wavespeed" })} placeholder="provider/model" /></Field>
          <Field><FieldLabel>Scene</FieldLabel><Textarea value={String(data.batchScene ?? "")} disabled={readOnly} onChange={(event) => updateNodeData(id, { batchScene: event.target.value })} placeholder="Shared scene or campaign setup" /></Field>
          <Field><FieldLabel>Poses · one per line</FieldLabel><Textarea value={lines(data.batchPoses, []).join("\n")} disabled={readOnly} onChange={(event) => updateNodeData(id, { batchPoses: event.target.value.split("\n") })} placeholder="Standing, three-quarter view\nSeated, looking at camera" /></Field>
          <Field><FieldLabel>Outfits · one per line</FieldLabel><Textarea value={lines(data.batchOutfits, []).join("\n")} disabled={readOnly} onChange={(event) => updateNodeData(id, { batchOutfits: event.target.value.split("\n") })} placeholder="Black evening dress\nWhite linen suit" /></Field>
          <Field><FieldLabel>Concurrency</FieldLabel><Input type="number" min={1} max={8} value={Number(data.batchConcurrency ?? 2)} disabled={readOnly} onChange={(event) => updateNodeData(id, { batchConcurrency: Math.min(8, Math.max(1, Number(event.target.value))) })} /></Field>
        </FieldGroup>
        {items.length > 0 && <div className="mt-3 flex flex-col gap-1.5">{items.map((item) => <div key={item.id} className="flex items-center gap-2 rounded-lg bg-white/[0.035] px-2 py-1.5 text-[10px]"><Badge variant={item.status === "error" ? "destructive" : "outline"}>{item.status}</Badge><span className="min-w-0 flex-1 truncate">{item.pose} × {item.outfit}</span><span className="text-white/30">{item.attempts}×</span></div>)}</div>}
      </div>
      <div className="flex gap-2 border-t border-white/8 p-3">{running ? <Button type="button" variant="outline" className="flex-1" onClick={pause}><Pause data-icon="inline-start" />Pause</Button> : <Button type="button" className="flex-1" disabled={readOnly} onClick={() => void resumeOrStart()}><Play data-icon="inline-start" />{data.batchPaused ? "Resume" : "Run batch"}</Button>}{errors > 0 && <Button type="button" variant="outline" onClick={() => void resumeOrStart(true)}><RotateCcw data-icon="inline-start" />Retry errors</Button>}</div>
      <Handle id="identity" type="target" position={Position.Left} style={{ top: 56 }} title="Identity matrix" />
      <Handle id="analysis" type="target" position={Position.Left} style={{ top: 92 }} title="Shared scene analysis" />
      <Handle id="imageOut" type="source" position={Position.Right} title="Completed image collection" />
    </div>
  );
}
