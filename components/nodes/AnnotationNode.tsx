"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import { Handle, Node, NodeProps, Position } from "@xyflow/react";
import { ArrowUpRight, Circle, MousePointer2, Pencil, Square, Type, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { AnnotationShape, AnnotationTool } from "@/lib/annotations";
import { annotationBounds, annotationPath } from "@/lib/annotations";
import { duplicateWorkflowNode } from "@/lib/duplicateWorkflowNode";
import { useWorkflowStore, type NodeData } from "@/lib/store";
import CornerResizer from "./CornerResizer";
import NodeActionBar from "./NodeActionBar";
import { useReadOnly } from "@/lib/readOnlyContext";

type AnnotationNodeType = Node<NodeData, "annotationNode">;

function sourceImage(id: string): string | undefined {
  const state = useWorkflowStore.getState();
  const edge = state.edges.find((candidate) => candidate.target === id && candidate.targetHandle === "image");
  const source = state.nodes.find((candidate) => candidate.id === edge?.source);
  return (source?.data.r2Url ?? source?.data.inputImage ?? source?.data.imageUrl ?? source?.data.capturedFrameUrl) as string | undefined;
}

function Shapes({ shapes }: { shapes: AnnotationShape[] }) {
  return <svg viewBox="0 0 1000 1000" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 size-full">
    <defs><marker id="annotation-arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L0,6 L7,3 z" fill="context-stroke" /></marker></defs>
    {shapes.map((shape) => {
      const bounds = annotationBounds(shape.points);
      const common = { stroke: shape.color, strokeWidth: shape.width, fill: "none", vectorEffect: "non-scaling-stroke" as const };
      if (shape.tool === "rectangle") return <rect key={shape.id} {...bounds} {...common} />;
      if (shape.tool === "ellipse") return <ellipse key={shape.id} cx={bounds.x + bounds.width / 2} cy={bounds.y + bounds.height / 2} rx={bounds.width / 2} ry={bounds.height / 2} {...common} />;
      if (shape.tool === "arrow") return <line key={shape.id} x1={shape.points[0]?.x} y1={shape.points[0]?.y} x2={shape.points.at(-1)?.x} y2={shape.points.at(-1)?.y} {...common} markerEnd="url(#annotation-arrow)" />;
      if (shape.tool === "text") return <text key={shape.id} x={shape.points[0]?.x} y={shape.points[0]?.y} fill={shape.color} fontSize={Math.max(24, shape.width * 8)}>{shape.text}</text>;
      return <path key={shape.id} d={annotationPath(shape.points)} {...common} strokeLinecap="round" strokeLinejoin="round" />;
    })}
  </svg>;
}

export default function AnnotationNode({ id, data, selected }: NodeProps<AnnotationNodeType>) {
  const readOnly = useReadOnly();
  const updateNodeData = useWorkflowStore((state) => state.updateNodeData);
  const onNodesChange = useWorkflowStore((state) => state.onNodesChange);
  useWorkflowStore((state) => state.nodes);
  useWorkflowStore((state) => state.edges);
  const [open, setOpen] = useState(false);
  const inputUrl = sourceImage(id);
  const outputUrl = (data.imageUrl as string | undefined) ?? inputUrl;
  const shapes = (data.annotations ?? []) as AnnotationShape[];
  return <>
    <div className="node-card flex h-full w-full flex-col overflow-hidden" style={{ minWidth: 300 }}>
      <CornerResizer minWidth={260} minHeight={240} />
      <span className="node-above-label">{String(data.label ?? "ANNOTATION")}</span>
      <NodeActionBar visible={selected && !readOnly} hasContent={!!outputUrl} onDelete={() => onNodesChange([{ type: "remove", id }])} onDuplicate={() => duplicateWorkflowNode(id)} />
      <button className="nodrag relative m-2 min-h-0 flex-1 overflow-hidden rounded-xl bg-black/40" onClick={() => inputUrl && setOpen(true)}>
        {outputUrl ? <Image src={outputUrl} alt="Annotated media" fill unoptimized className="object-contain" /> : <span className="absolute inset-0 grid place-items-center text-xs text-white/35">Connect an image</span>}
        {!data.imageUrl && <Shapes shapes={shapes} />}
      </button>
      <div className="border-t border-white/8 p-2.5 text-[10px] text-white/40">{shapes.length} annotation{shapes.length === 1 ? "" : "s"} · non-destructive source</div>
      <Handle id="image" type="target" position={Position.Left} />
      <Handle id="media" type="source" position={Position.Right} />
    </div>
    {inputUrl && <AnnotationEditor open={open} onOpenChange={setOpen} source={inputUrl} initial={shapes} onSave={(annotations, imageUrl) => updateNodeData(id, { annotations, imageUrl, status: "done" })} />}
  </>;
}

function AnnotationEditor({ open, onOpenChange, source, initial, onSave }: { open: boolean; onOpenChange: (open: boolean) => void; source: string; initial: AnnotationShape[]; onSave: (shapes: AnnotationShape[], imageUrl: string) => void }) {
  const [tool, setTool] = useState<AnnotationTool>("freehand");
  const [color, setColor] = useState("#ff3b5c");
  const [width, setWidth] = useState(5);
  const [shapes, setShapes] = useState(initial);
  const [drawing, setDrawing] = useState<AnnotationShape | null>(null);
  const [saving, setSaving] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const allShapes = drawing ? [...shapes, drawing] : shapes;
  const point = (event: React.PointerEvent) => { const rect = stageRef.current!.getBoundingClientRect(); return { x: ((event.clientX - rect.left) / rect.width) * 1000, y: ((event.clientY - rect.top) / rect.height) * 1000 }; };
  const start = (event: React.PointerEvent) => { if (tool === "text") { const text = window.prompt("Annotation text"); if (text) setShapes((current) => [...current, { id: crypto.randomUUID(), tool, color, width, points: [point(event)], text }]); return; } (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId); const p = point(event); setDrawing({ id: crypto.randomUUID(), tool, color, width, points: [p, p] }); };
  const move = (event: React.PointerEvent) => { if (!drawing) return; const p = point(event); setDrawing((current) => current ? { ...current, points: current.tool === "freehand" ? [...current.points, p] : [current.points[0], p] } : null); };
  const end = () => { if (drawing) setShapes((current) => [...current, drawing]); setDrawing(null); };

  const flatten = async () => {
    setSaving(true);
    try {
      const proxied = source.startsWith("/") ? source : `/api/download?url=${encodeURIComponent(source)}&filename=annotation-source`;
      const response = await fetch(proxied);
      if (!response.ok) throw new Error("Unable to load the source image for export.");
      const bitmap = await createImageBitmap(await response.blob());
      const canvas = document.createElement("canvas"); canvas.width = bitmap.width; canvas.height = bitmap.height;
      const ctx = canvas.getContext("2d")!; ctx.drawImage(bitmap, 0, 0);
      const sx = canvas.width / 1000, sy = canvas.height / 1000;
      for (const shape of shapes) {
        const bounds = annotationBounds(shape.points); ctx.strokeStyle = shape.color; ctx.fillStyle = shape.color; ctx.lineWidth = shape.width * ((sx + sy) / 2); ctx.lineCap = "round"; ctx.lineJoin = "round";
        if (shape.tool === "rectangle") ctx.strokeRect(bounds.x * sx, bounds.y * sy, bounds.width * sx, bounds.height * sy);
        else if (shape.tool === "ellipse") { ctx.beginPath(); ctx.ellipse((bounds.x + bounds.width / 2) * sx, (bounds.y + bounds.height / 2) * sy, bounds.width * sx / 2, bounds.height * sy / 2, 0, 0, Math.PI * 2); ctx.stroke(); }
        else if (shape.tool === "text") { ctx.font = `${Math.max(24, shape.width * 8) * sy}px sans-serif`; ctx.fillText(shape.text ?? "", shape.points[0].x * sx, shape.points[0].y * sy); }
        else { ctx.beginPath(); shape.points.forEach((p, index) => index ? ctx.lineTo(p.x * sx, p.y * sy) : ctx.moveTo(p.x * sx, p.y * sy)); ctx.stroke(); if (shape.tool === "arrow" && shape.points.length > 1) { const a = shape.points.at(-2)!, b = shape.points.at(-1)!; const angle = Math.atan2((b.y - a.y) * sy, (b.x - a.x) * sx); const size = ctx.lineWidth * 4; ctx.beginPath(); ctx.moveTo(b.x * sx, b.y * sy); ctx.lineTo(b.x * sx - size * Math.cos(angle - Math.PI / 6), b.y * sy - size * Math.sin(angle - Math.PI / 6)); ctx.lineTo(b.x * sx - size * Math.cos(angle + Math.PI / 6), b.y * sy - size * Math.sin(angle + Math.PI / 6)); ctx.closePath(); ctx.fill(); } }
      }
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("Unable to render annotations.")), "image/png"));
      const upload = await fetch("/api/upload-asset", { method: "POST", headers: { "Content-Type": "image/png" }, body: blob });
      const body = await upload.json() as { cdnUrl?: string; error?: string }; if (!upload.ok || !body.cdnUrl) throw new Error(body.error ?? "Unable to save annotation output.");
      onSave(shapes, body.cdnUrl); onOpenChange(false);
    } finally { setSaving(false); }
  };

  const tools: Array<[AnnotationTool, React.ReactNode]> = [["freehand", <Pencil key="p" size={15} />], ["rectangle", <Square key="s" size={15} />], ["ellipse", <Circle key="c" size={15} />], ["arrow", <ArrowUpRight key="a" size={15} />], ["text", <Type key="t" size={15} />]];
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-w-6xl border-white/10 bg-[#080a0f] text-white"><DialogHeader><DialogTitle>Annotate image</DialogTitle></DialogHeader><div className="flex items-center gap-2">{tools.map(([name, icon]) => <Button key={name} size="icon" variant={tool === name ? "default" : "outline"} onClick={() => setTool(name)} title={name}>{icon}</Button>)}<Input type="color" value={color} onChange={(event) => setColor(event.target.value)} className="h-9 w-12 p-1" /><Input type="range" min="1" max="20" value={width} onChange={(event) => setWidth(Number(event.target.value))} className="w-32" /><Button variant="outline" onClick={() => setShapes((current) => current.slice(0, -1))}><Undo2 size={14} />Undo</Button><div className="flex-1" /><Button onClick={() => void flatten()} disabled={saving}>{saving ? "Rendering…" : "Save flattened copy"}</Button></div><div ref={stageRef} className="relative h-[65vh] touch-none overflow-hidden rounded-xl bg-black select-none" onPointerDown={start} onPointerMove={move} onPointerUp={end}><Image src={source} alt="Annotation source" fill unoptimized className="pointer-events-none object-contain" /><Shapes shapes={allShapes} /><MousePointer2 className="pointer-events-none absolute bottom-3 right-3 text-white/20" /></div></DialogContent></Dialog>;
}
