"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { Handle, Node, NodeProps, Position, useUpdateNodeInternals } from "@xyflow/react";
import { ChevronRight, Film, ImageIcon, Plus, Search, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { useWorkflowStore, type NodeData } from "@/lib/store";
import type { WaveSpeedMediaFamily, WaveSpeedModel, WaveSpeedRequestProperty } from "@/lib/wavespeedTypes";
import { coerceWaveSpeedValue, defaultWaveSpeedParameters, orderedWaveSpeedProperties, waveSpeedInputKind } from "@/lib/wavespeedSchema";
import { runWaveSpeedCanvasNode } from "@/lib/wavespeedClient";
import CornerResizer from "./CornerResizer";
import NodeActionBar from "./NodeActionBar";
import GenerateButton from "./GenerateButton";
import { useReadOnly } from "@/lib/readOnlyContext";

type WaveSpeedNodeType = Node<NodeData, "waveSpeedNode">;

interface CatalogResponse { models?: WaveSpeedModel[]; error?: string; }

function displayValue(value: unknown): string {
  if (value === undefined || value === null) return "";
  return typeof value === "string" ? value : JSON.stringify(value);
}

export default function WaveSpeedNode({ id, data, selected }: NodeProps<WaveSpeedNodeType>) {
  const readOnly = useReadOnly();
  const updateNodeData = useWorkflowStore((state) => state.updateNodeData);
  const remapTargetHandle = useWorkflowStore((state) => state.remapTargetHandle);
  const onNodesChange = useWorkflowStore((state) => state.onNodesChange);
  const addNode = useWorkflowStore((state) => state.addNode);
  const insertEdge = useWorkflowStore((state) => state.insertEdge);
  const addToast = useWorkflowStore((state) => state.addToast);
  const updateNodeInternals = useUpdateNodeInternals();
  const cardRef = useRef<HTMLDivElement>(null);
  const [catalogOpen, setCatalogOpen] = useState(!data.waveSpeedModelId);
  const [query, setQuery] = useState("");
  const [models, setModels] = useState<WaveSpeedModel[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [running, setRunning] = useState(false);

  const family = (data.waveSpeedFamily === "video" ? "video" : "image") as WaveSpeedMediaFamily;
  const schema = data.waveSpeedSchema;
  const parameters = useMemo(() => (data.waveSpeedParameters ?? {}) as Record<string, unknown>, [data.waveSpeedParameters]);
  const fallbacks = useMemo(() => (data.waveSpeedFallbacks ?? []) as string[], [data.waveSpeedFallbacks]);
  const modelId = String(data.waveSpeedModelId ?? "");
  const properties = useMemo(() => orderedWaveSpeedProperties(schema), [schema]);
  const dynamicInputs = useMemo(
    () => properties.filter(([name, property]) => waveSpeedInputKind(name, property) !== "value"),
    [properties],
  );
  const valueInputs = useMemo(
    () => properties.filter(([name, property]) => waveSpeedInputKind(name, property) === "value"),
    [properties],
  );

  useEffect(() => { updateNodeInternals(id); }, [id, dynamicInputs.length, updateNodeInternals]);

  useEffect(() => {
    if (!modelId || schema) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(`/api/wavespeed/models?modelId=${encodeURIComponent(modelId)}`, { signal: controller.signal });
        const body = await response.json() as { model?: WaveSpeedModel; error?: string };
        if (!response.ok || !body.model) throw new Error(body.error ?? `WaveSpeed model not found: ${modelId}`);
        const model = body.model;
        updateNodeData(id, {
          waveSpeedModelName: model.name,
          waveSpeedModelType: model.type,
          waveSpeedSchema: model.requestSchema,
          waveSpeedBasePrice: model.basePrice,
          waveSpeedParameters: { ...defaultWaveSpeedParameters(model.requestSchema), ...parameters },
        });
        for (const kind of ["prompt", "image", "video", "audio"] as const) {
          const target = orderedWaveSpeedProperties(model.requestSchema).find(([name, property]) => waveSpeedInputKind(name, property) === kind);
          if (target) remapTargetHandle(id, `ws:${kind}`, `ws:${target[0]}`);
        }
      } catch (error) {
        if ((error as Error).name !== "AbortError") updateNodeData(id, { errorMsg: (error as Error).message });
      }
    })();
    return () => controller.abort();
  }, [id, modelId, parameters, remapTargetHandle, schema, updateNodeData]);

  useEffect(() => {
    if (!catalogOpen) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoadingModels(true);
      try {
        const params = new URLSearchParams({ family, limit: "40", includeSchema: "true" });
        if (query.trim()) params.set("query", query.trim());
        const response = await fetch(`/api/wavespeed/models?${params}`, { signal: controller.signal });
        const body = await response.json() as CatalogResponse;
        if (!response.ok) throw new Error(body.error ?? "Unable to load WaveSpeed models.");
        setModels(body.models ?? []);
      } catch (error) {
        if ((error as Error).name !== "AbortError") addToast((error as Error).message, "error");
      } finally {
        setLoadingModels(false);
      }
    }, 180);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [catalogOpen, family, query, addToast]);

  const selectModel = useCallback((model: WaveSpeedModel) => {
    updateNodeData(id, {
      waveSpeedModelId: model.modelId,
      waveSpeedModelName: model.name,
      waveSpeedModelType: model.type,
      waveSpeedSchema: model.requestSchema,
      waveSpeedBasePrice: model.basePrice,
      waveSpeedParameters: defaultWaveSpeedParameters(model.requestSchema),
      waveSpeedFallbacks: [],
      errorMsg: undefined,
    });
    setCatalogOpen(false);
  }, [id, updateNodeData]);

  const setParameter = useCallback((name: string, value: unknown) => {
    updateNodeData(id, { waveSpeedParameters: { ...parameters, [name]: value } });
  }, [id, parameters, updateNodeData]);

  const addFallback = useCallback((model: WaveSpeedModel) => {
    if (model.modelId === modelId || fallbacks.includes(model.modelId)) return;
    updateNodeData(id, { waveSpeedFallbacks: [...fallbacks, model.modelId] });
  }, [fallbacks, id, modelId, updateNodeData]);

  const generate = useCallback(async () => {
    if (running) return;
    const state = useWorkflowStore.getState();
    const node = state.nodes.find((candidate) => candidate.id === id);
    if (!node) return;
    setRunning(true);
    updateNodeData(id, { status: "running", errorMsg: undefined, imageUrl: undefined, videoUrl: undefined });
    try {
      const result = await runWaveSpeedCanvasNode({
        node,
        nodes: state.nodes,
        edges: state.edges,
        workflowId: state.activeSpaceId,
      });
      updateNodeData(id, {
        status: "done",
        taskId: result.taskId,
        imageUrl: result.imageUrl,
        videoUrl: result.videoUrl,
        waveSpeedLastEstimatedCost: result.estimatedCost,
      });
    } catch (error) {
      updateNodeData(id, { status: "error", errorMsg: (error as Error).message });
    } finally {
      setRunning(false);
    }
  }, [id, running, updateNodeData]);

  const duplicate = useCallback(() => {
    const state = useWorkflowStore.getState();
    const source = state.nodes.find((node) => node.id === id);
    if (!source) return;
    const newId = `waveSpeedNode-${Date.now().toString(36)}`;
    addNode({ ...source, id: newId, position: { x: source.position.x + 30, y: source.position.y + 30 }, selected: true, data: { ...source.data, status: "idle", imageUrl: undefined, videoUrl: undefined } });
    state.edges.filter((edge) => edge.source === id || edge.target === id).forEach((edge) => insertEdge({
      ...edge,
      id: `edge-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      source: edge.source === id ? newId : edge.source,
      target: edge.target === id ? newId : edge.target,
    }));
  }, [addNode, id, insertEdge]);

  const outputUrl = family === "video" ? data.videoUrl as string | undefined : data.imageUrl as string | undefined;
  const required = new Set(schema?.required ?? []);

  return (
    <div ref={cardRef} className={`node-card flex h-full w-full flex-col overflow-hidden${running ? " node-generating" : ""}`} style={{ minWidth: 340 }}>
      <CornerResizer minWidth={320} minHeight={320} />
      <span className="node-above-label">{String(data.label ?? "WAVESPEED")}</span>
      <NodeActionBar
        visible={selected && !readOnly}
        hasContent={!!outputUrl}
        onDelete={() => onNodesChange([{ type: "remove", id }])}
        onDuplicate={duplicate}
      />

      <div className="flex items-center gap-2 border-b border-white/8 px-3 py-2">
        <div className="flex size-7 items-center justify-center rounded-lg bg-cyan-400/10 text-cyan-300">
          {family === "video" ? <Film size={15} /> : <ImageIcon size={15} />}
        </div>
        <button className="nodrag min-w-0 flex-1 text-left" onClick={() => !readOnly && setCatalogOpen((open) => !open)}>
          <div className="truncate text-xs font-semibold text-white">{String(data.waveSpeedModelName ?? "Choose a WaveSpeed model")}</div>
          <div className="truncate text-[10px] text-white/40">{modelId || "Live provider catalog"}</div>
        </button>
        <Select value={family} onValueChange={(value) => updateNodeData(id, { waveSpeedFamily: value === "video" ? "video" : "image", waveSpeedModelId: undefined, waveSpeedModelName: undefined, waveSpeedSchema: undefined, waveSpeedParameters: {}, waveSpeedFallbacks: [] })} disabled={readOnly}>
          <SelectTrigger size="sm" className="nodrag w-24 border-white/10 bg-white/5 text-[11px]"><SelectValue /></SelectTrigger>
          <SelectContent><SelectGroup><SelectItem value="image">Image</SelectItem><SelectItem value="video">Video</SelectItem></SelectGroup></SelectContent>
        </Select>
      </div>

      {catalogOpen && !readOnly && (
        <div className="nodrag border-b border-white/8 bg-black/30 p-2">
          <div className="relative"><Search className="absolute left-2 top-2 size-3.5 text-white/35" /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search 1,000+ models" className="h-8 border-white/10 bg-white/5 pl-7 text-xs" /></div>
          <ScrollArea className="mt-2 h-44">
            <div className="space-y-1 pr-2">
              {loadingModels && <div className="p-3 text-center text-xs text-white/40">Loading live catalog…</div>}
              {!loadingModels && models.map((model) => (
                <div key={model.modelId} className="group flex items-center gap-2 rounded-lg border border-transparent p-2 hover:border-cyan-300/20 hover:bg-cyan-300/5">
                  <button className="min-w-0 flex-1 text-left" onClick={() => selectModel(model)}>
                    <div className="truncate text-xs font-medium text-white/85">{model.name}</div>
                    <div className="truncate text-[10px] text-white/35">{model.type} · {model.basePrice == null ? "price varies" : `$${model.basePrice.toFixed(4)}`}</div>
                  </button>
                  {modelId && model.modelId !== modelId && <Button size="icon-sm" variant="ghost" title="Add as fallback" onClick={() => addFallback(model)}><Plus size={13} /></Button>}
                  <ChevronRight size={13} className="text-white/20" />
                </div>
              ))}
              {!loadingModels && models.length === 0 && <div className="p-3 text-center text-xs text-white/40">No matching models.</div>}
            </div>
          </ScrollArea>
        </div>
      )}

      <ScrollArea className="nodrag nowheel min-h-0 flex-1">
        <div className="space-y-3 p-3">
          {outputUrl && (
            <div className="overflow-hidden rounded-xl border border-white/10 bg-black/40">
              {family === "video" ? <video src={outputUrl} controls className="max-h-64 w-full" /> : <Image src={outputUrl} alt="WaveSpeed output" width={512} height={512} unoptimized className="max-h-64 w-full object-contain" />}
            </div>
          )}

          {dynamicInputs.map(([name, property], index) => (
            <div key={name} className="relative flex min-h-10 items-center rounded-lg border border-dashed border-white/10 px-3 py-2">
              <Handle id={`ws:${name}`} type="target" position={Position.Left} style={{ top: 20 + index * 0 }} />
              <div className="min-w-0"><div className="flex items-center gap-1.5 text-xs text-white/75">{name}{required.has(name) && <Badge variant="outline" className="h-4 px-1 text-[8px] text-amber-300">required</Badge>}</div><div className="truncate text-[10px] text-white/35">Connect {waveSpeedInputKind(name, property)}</div></div>
            </div>
          ))}

          <FieldGroup className="gap-3">
            {valueInputs.map(([name, property]) => (
              <ParameterControl key={name} name={name} property={property} value={parameters[name]} required={required.has(name)} disabled={readOnly} onChange={(value) => setParameter(name, value)} />
            ))}
          </FieldGroup>

          {modelId && (
            <div className="space-y-2 rounded-lg border border-white/8 bg-white/[0.025] p-2.5">
              <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-white/40"><span>Cost guardrail</span><span>{data.waveSpeedBasePrice == null ? "Variable" : `~$${Number(data.waveSpeedBasePrice).toFixed(4)} / attempt`}</span></div>
              <Input type="number" min="0" step="0.01" value={displayValue(data.waveSpeedMaxCost)} placeholder="No max cost" disabled={readOnly} onChange={(event) => updateNodeData(id, { waveSpeedMaxCost: event.target.value === "" ? undefined : Number(event.target.value) })} className="h-8 border-white/10 bg-white/5 text-xs" />
            </div>
          )}

          {fallbacks.length > 0 && (
            <div className="space-y-1.5"><div className="text-[10px] uppercase tracking-wider text-white/40">Fallback order</div>{fallbacks.map((fallback, index) => <div key={fallback} className="flex items-center gap-2 rounded-lg bg-white/[0.035] px-2 py-1.5 text-[10px] text-white/60"><span className="text-cyan-300">{index + 1}</span><span className="min-w-0 flex-1 truncate">{fallback}</span>{!readOnly && <button onClick={() => updateNodeData(id, { waveSpeedFallbacks: fallbacks.filter((value) => value !== fallback) })}><X size={12} /></button>}</div>)}</div>
          )}

          {data.errorMsg && <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-2 text-[11px] text-red-300">{String(data.errorMsg)}</div>}
        </div>
      </ScrollArea>

      <div className="nodrag border-t border-white/8 p-2.5"><GenerateButton onClick={generate} busy={running} disabled={!modelId || readOnly} /></div>
      <Handle id="media" type="source" position={Position.Right} />
    </div>
  );
}

function ParameterControl({ name, property, value, required, disabled, onChange }: {
  name: string;
  property: WaveSpeedRequestProperty;
  value: unknown;
  required: boolean;
  disabled: boolean;
  onChange: (value: unknown) => void;
}) {
  const label = <>{name}{required && <span className="text-amber-300">*</span>}</>;
  if (property.enum?.length) {
    return <Field><FieldLabel className="text-[11px] text-white/60">{label}</FieldLabel><Select value={displayValue(value)} onValueChange={onChange} disabled={disabled}><SelectTrigger className="w-full border-white/10 bg-white/5 text-xs"><SelectValue placeholder="Choose…" /></SelectTrigger><SelectContent><SelectGroup>{property.enum.map((option) => <SelectItem key={displayValue(option)} value={displayValue(option)}>{displayValue(option)}</SelectItem>)}</SelectGroup></SelectContent></Select></Field>;
  }
  if (property.type === "boolean") {
    return <Field orientation="horizontal"><FieldLabel className="text-[11px] text-white/60">{label}</FieldLabel><Switch checked={Boolean(value)} onCheckedChange={onChange} disabled={disabled} /></Field>;
  }
  if (property.type === "array" || property.type === "object") {
    return <Field><FieldLabel className="text-[11px] text-white/60">{label}</FieldLabel><Textarea value={displayValue(value)} disabled={disabled} placeholder={property.type === "array" ? "[]" : "{}"} onChange={(event) => onChange(coerceWaveSpeedValue(event.target.value, property))} className="min-h-16 border-white/10 bg-white/5 font-mono text-[10px]" /></Field>;
  }
  return <Field><FieldLabel className="text-[11px] text-white/60">{label}</FieldLabel><Input type={property.type === "number" || property.type === "integer" ? "number" : "text"} min={property.minimum} max={property.maximum} value={displayValue(value)} disabled={disabled} placeholder={property.description} onChange={(event) => onChange(coerceWaveSpeedValue(event.target.value, property))} className="h-8 border-white/10 bg-white/5 text-xs" /></Field>;
}
