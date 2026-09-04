"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { Handle, Node, NodeProps, Position } from "@xyflow/react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useWorkflowStore, type NodeData } from "@/lib/store";
import { DEFAULT_IDENTITY_DEFAULTS, type IdentityAsset, type IdentityReference, type IdentityReferenceKind } from "@/lib/cloneMe";
import { duplicateWorkflowNode } from "@/lib/duplicateWorkflowNode";
import { useReadOnly } from "@/lib/readOnlyContext";
import CornerResizer from "./CornerResizer";
import NodeActionBar from "./NodeActionBar";
import { Plus, Upload, X } from "lucide-react";

type IdentityNodeType = Node<NodeData, "identityMatrixNode">;

const emptyDraft = { name: "", triggerWord: "", basePrompts: [] as string[], references: [] as IdentityReference[], defaults: DEFAULT_IDENTITY_DEFAULTS };

export default function IdentityMatrixNode({ id, data, selected }: NodeProps<IdentityNodeType>) {
  const readOnly = useReadOnly();
  const updateNodeData = useWorkflowStore((state) => state.updateNodeData);
  const onNodesChange = useWorkflowStore((state) => state.onNodesChange);
  const addToast = useWorkflowStore((state) => state.addToast);
  const [identities, setIdentities] = useState<IdentityAsset[]>([]);
  const [draft, setDraft] = useState(() => data.identitySnapshot ? {
    name: data.identitySnapshot.name, triggerWord: data.identitySnapshot.triggerWord,
    basePrompts: data.identitySnapshot.basePrompts, references: data.identitySnapshot.references, defaults: data.identitySnapshot.defaults ?? DEFAULT_IDENTITY_DEFAULTS,
  } : emptyDraft);
  const [saving, setSaving] = useState(false);
  const [referenceKind, setReferenceKind] = useState<IdentityReferenceKind>("face");
  const fileRef = useRef<HTMLInputElement>(null);

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

  const selectIdentity = useCallback((identityId: string | null) => {
    if (!identityId) return;
    const identity = identities.find((item) => item.id === identityId);
    if (!identity) return;
    setDraft({ name: identity.name, triggerWord: identity.triggerWord, basePrompts: identity.basePrompts, references: identity.references, defaults: identity.defaults ?? DEFAULT_IDENTITY_DEFAULTS });
    updateNodeData(id, { identityAssetId: identity.id, identitySnapshot: identity, outputText: [identity.triggerWord, ...identity.basePrompts].filter(Boolean).join("\n") });
  }, [id, identities, updateNodeData]);

  const save = useCallback(async () => {
    setSaving(true);
    try {
      const identityId = String(data.identityAssetId ?? "");
      const response = await fetch(identityId ? `/api/identities/${encodeURIComponent(identityId)}` : "/api/identities", {
        method: identityId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const body = await response.json() as { identity?: IdentityAsset; error?: string };
      if (!response.ok || !body.identity) throw new Error(body.error ?? "Unable to save identity.");
      updateNodeData(id, { identityAssetId: body.identity.id, identitySnapshot: body.identity, outputText: [body.identity.triggerWord, ...body.identity.basePrompts].filter(Boolean).join("\n") });
      setIdentities((items) => [body.identity!, ...items.filter((item) => item.id !== body.identity!.id)]);
      addToast(`${body.identity.name} saved as version ${body.identity.version}`, "success");
    } catch (error) { addToast((error as Error).message, "error"); }
    finally { setSaving(false); }
  }, [addToast, data.identityAssetId, draft, id, updateNodeData]);

  const upload = useCallback(async (file: File) => {
    const response = await fetch("/api/upload-asset", { method: "POST", headers: { "Content-Type": file.type || "image/jpeg" }, body: await file.arrayBuffer() });
    const body = await response.json() as { cdnUrl?: string; error?: string };
    if (!response.ok || !body.cdnUrl) throw new Error(body.error ?? "Reference upload failed.");
    setDraft((value) => ({ ...value, references: [...value.references, { url: body.cdnUrl!, kind: referenceKind, label: file.name }] }));
  }, [referenceKind]);

  const snapshot = data.identitySnapshot;
  const referenceCount = draft.references.length;
  const promptPreview = useMemo(() => [draft.triggerWord, ...draft.basePrompts].filter(Boolean).join("\n"), [draft]);

  return (
    <div className="node-card flex h-full w-full flex-col overflow-hidden" style={{ minWidth: 360 }}>
      <CornerResizer minWidth={340} minHeight={420} />
      <span className="node-above-label">{String(data.label ?? "IDENTITY MATRIX")}</span>
      <NodeActionBar visible={selected && !readOnly} hasContent={referenceCount > 0} isSaving={saving} onDelete={() => onNodesChange([{ type: "remove", id }])} onDuplicate={() => duplicateWorkflowNode(id)} onSave={save} />
      <div className="flex items-center justify-between border-b border-white/8 px-3 py-2">
        <div><div className="text-xs font-semibold text-white/85">Identity matrix</div><div className="text-[10px] text-white/40">Reusable, versioned references and prompts</div></div>
        <Badge variant="secondary">v{snapshot?.version ?? "new"}</Badge>
      </div>
      <div className="nodrag nowheel min-h-0 flex-1 overflow-y-auto p-3">
        <FieldGroup>
          <Field><FieldLabel>Saved identity</FieldLabel><Select value={String(data.identityAssetId ?? "")} onValueChange={selectIdentity} disabled={readOnly}><SelectTrigger><SelectValue placeholder="Create or choose…" /></SelectTrigger><SelectContent><SelectGroup>{identities.map((identity) => <SelectItem key={identity.id} value={identity.id}>{identity.name} · v{identity.version}</SelectItem>)}</SelectGroup></SelectContent></Select></Field>
          <Field><FieldLabel>Name</FieldLabel><Input value={draft.name} disabled={readOnly} onChange={(event) => setDraft((value) => ({ ...value, name: event.target.value }))} placeholder="Ava — campaign identity" /></Field>
          <Field><FieldLabel>Trigger word</FieldLabel><Input value={draft.triggerWord} disabled={readOnly} onChange={(event) => setDraft((value) => ({ ...value, triggerWord: event.target.value }))} placeholder="AVA_PERSON" /></Field>
          <Field><FieldLabel>Reusable base prompts</FieldLabel><Textarea value={draft.basePrompts.join("\n")} disabled={readOnly} onChange={(event) => setDraft((value) => ({ ...value, basePrompts: event.target.value.split("\n") }))} placeholder="One reusable instruction per line" /></Field>
          <Field><FieldLabel>References</FieldLabel><div className="flex gap-2"><Select value={referenceKind} onValueChange={(value) => setReferenceKind(value === "body" ? "body" : "face")} disabled={readOnly}><SelectTrigger className="w-28"><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectItem value="face">Face</SelectItem><SelectItem value="body">Body</SelectItem></SelectGroup></SelectContent></Select><Button type="button" variant="outline" className="flex-1" disabled={readOnly} onClick={() => fileRef.current?.click()}><Upload data-icon="inline-start" />Upload reference</Button></div><input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file).catch((error) => addToast(error.message, "error")); event.target.value = ""; }} /></Field>
        </FieldGroup>
        <div className="mt-3 grid grid-cols-3 gap-2">{draft.references.map((reference, index) => <div key={`${reference.url}-${index}`} className="relative overflow-hidden rounded-lg border border-white/10 bg-black/30"><Image src={reference.url} alt={reference.label ?? `${reference.kind} reference`} width={120} height={120} unoptimized className="aspect-square w-full object-cover" /><Badge variant="secondary" className="absolute bottom-1 left-1">{reference.kind}</Badge>{!readOnly && <Button type="button" variant="destructive" size="icon-sm" className="absolute right-1 top-1" onClick={() => setDraft((value) => ({ ...value, references: value.references.filter((_, candidate) => candidate !== index) }))}><X /></Button>}<Handle id={`identity:${index}`} type="source" position={Position.Right} style={{ top: `${((index + 1) / (referenceCount + 1)) * 100}%` }} /></div>)}</div>
        {!referenceCount && <button type="button" className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-white/15 p-5 text-xs text-white/40" onClick={() => fileRef.current?.click()} disabled={readOnly}><Plus />Add face and body references</button>}
        {promptPreview && <div className="mt-3 rounded-lg bg-black/30 p-2 text-[10px] text-white/45">{promptPreview}</div>}
      </div>
      <Handle id="promptOut" type="source" position={Position.Right} style={{ top: 48 }} title="Identity prompt" />
      <Handle id="referencesOut" type="source" position={Position.Right} style={{ top: 92 }} title="All identity references" />
    </div>
  );
}
