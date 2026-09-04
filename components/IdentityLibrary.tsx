"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import {
  ArrowUpRight,
  Boxes,
  Copy,
  Download,
  FileJson,
  Fingerprint,
  GitBranch,
  History,
  Images,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Route,
  ScanFace,
  Search,
  SlidersHorizontal,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  UserRoundSearch,
  WandSparkles,
  X,
} from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { DEFAULT_IDENTITY_DEFAULTS, type IdentityAsset, type IdentityDefaults, type IdentityReference, type IdentityReferenceKind, type WorkflowProvider } from "@/lib/cloneMe";
import { useWorkflowStore, type Space } from "@/lib/store";
import { cn } from "@/lib/utils";

interface LedgerEntry {
  id: string;
  identityAssetId?: string;
  provider: string;
  modelId: string;
  status: "pending" | "done" | "error" | "skipped";
  outputUrl?: string;
  quotedCost?: number;
  actualCost?: number;
  createdAt: string;
}

interface IdentityDraft {
  name: string;
  triggerWord: string;
  basePrompts: string[];
  references: IdentityReference[];
  defaults: IdentityDefaults;
}

const PROVIDERS: Array<{ value: WorkflowProvider | "workflow-default"; label: string }> = [
  { value: "workflow-default", label: "Choose per workflow" },
  { value: "kie", label: "Kie.ai" },
  { value: "wavespeed", label: "WaveSpeed" },
  { value: "comfyui", label: "ComfyUI" },
  { value: "azure", label: "Azure Foundry" },
  { value: "codex", label: "Codex CLI" },
];

const ASPECT_RATIOS = ["9:16", "1:1", "4:5", "3:4", "16:9", "4:3"];
const CONTENT_CLASSES = [{ value: "sfw", label: "SFW production" }, { value: "adult", label: "Adult production" }];
const REFERENCE_KINDS = [{ value: "face", label: "Face" }, { value: "body", label: "Body" }];
const ASPECT_RATIO_ITEMS = ASPECT_RATIOS.map((value) => ({ value, label: value }));

const emptyDraft = (): IdentityDraft => ({
  name: "",
  triggerWord: "",
  basePrompts: [],
  references: [],
  defaults: { ...DEFAULT_IDENTITY_DEFAULTS },
});

function toDraft(identity: IdentityAsset): IdentityDraft {
  return {
    name: identity.name,
    triggerWord: identity.triggerWord,
    basePrompts: identity.basePrompts,
    references: identity.references,
    defaults: identity.defaults ?? { ...DEFAULT_IDENTITY_DEFAULTS },
  };
}

function formatDate(value: string | number | undefined) {
  if (!value) return "—";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}

function isVideoUrl(value: string) {
  return /\.(?:mp4|mov|webm|m4v)(?:$|[?#])/i.test(value);
}

function ReferenceMosaic({ identity, compact = false }: { identity: IdentityAsset; compact?: boolean }) {
  const refs = identity.references.slice(0, 4);
  return (
    <div className={cn("relative grid overflow-hidden bg-muted", compact ? "h-28 grid-cols-3" : "h-52 grid-cols-3")}>
      {refs.map((reference, index) => (
        <div key={`${reference.url}-${index}`} className={cn("relative min-w-0 overflow-hidden border-r border-background/80", index === 0 && refs.length > 1 && "col-span-2 row-span-2", refs.length === 1 && "col-span-3 row-span-2")}>
          <Image src={reference.url} alt={reference.label ?? `${identity.name} ${reference.kind} reference`} fill sizes={compact ? "240px" : "420px"} unoptimized className="object-cover transition duration-500 group-hover/card:scale-[1.025]" />
          <span className="absolute bottom-1.5 left-1.5 rounded bg-background/75 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-[0.14em] text-foreground/70 backdrop-blur-sm">{reference.kind}</span>
        </div>
      ))}
      {!refs.length && (
        <div className="col-span-3 flex h-full items-center justify-center bg-[radial-gradient(circle_at_center,var(--color-muted),transparent_70%)] text-muted-foreground">
          <ScanFace className={compact ? "size-8" : "size-12"} strokeWidth={1.1} />
        </div>
      )}
      <div className="pointer-events-none absolute inset-0 bg-linear-to-t from-background/70 via-transparent to-transparent" />
      <div className="absolute right-2 top-2 rounded bg-background/75 px-2 py-1 font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground backdrop-blur-sm">ID · v{identity.version}</div>
    </div>
  );
}

function EditorSectionHeading({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return (
    <div className="border-b border-border pb-5">
      <div className="font-mono text-[9px] uppercase tracking-[0.2em] text-primary/80">{eyebrow}</div>
      <h3 className="mt-2 text-lg font-medium tracking-tight">{title}</h3>
      <p className="mt-1 max-w-xl text-sm leading-6 text-muted-foreground">{description}</p>
    </div>
  );
}

export default function IdentityLibrary() {
  const router = useRouter();
  const addToast = useWorkflowStore((state) => state.addToast);
  const [identities, setIdentities] = useState<IdentityAsset[]>([]);
  const [workflows, setWorkflows] = useState<Space[]>([]);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [versions, setVersions] = useState<IdentityAsset[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadingCount, setUploadingCount] = useState(0);
  const [editorOpen, setEditorOpen] = useState(false);
  const [selected, setSelected] = useState<IdentityAsset | null>(null);
  const [draft, setDraft] = useState<IdentityDraft>(emptyDraft);
  const [deleteTarget, setDeleteTarget] = useState<IdentityAsset | null>(null);
  const referenceInput = useRef<HTMLInputElement>(null);
  const importInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true);
    try {
      const [identityResponse, workflowResponse, ledgerResponse] = await Promise.all([
        fetch("/api/identities", { cache: "no-store" }),
        fetch("/api/workflows", { cache: "no-store" }),
        fetch("/api/ledger?limit=500", { cache: "no-store" }),
      ]);
      const [identityBody, workflowBody, ledgerBody] = await Promise.all([identityResponse.json(), workflowResponse.json(), ledgerResponse.json()]) as [
        { identities?: IdentityAsset[]; error?: string },
        { spaces?: Space[]; error?: string },
        { entries?: LedgerEntry[]; error?: string },
      ];
      if (!identityResponse.ok) throw new Error(identityBody.error ?? "Unable to load identities.");
      if (!workflowResponse.ok) throw new Error(workflowBody.error ?? "Unable to load linked workflows.");
      if (!ledgerResponse.ok) throw new Error(ledgerBody.error ?? "Unable to load identity activity.");
      setIdentities(identityBody.identities ?? []);
      setWorkflows(workflowBody.spaces ?? []);
      setLedger(ledgerBody.entries ?? []);
    } catch (error) {
      addToast((error as Error).message, "error");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [addToast]);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return identities;
    return identities.filter((identity) => `${identity.name} ${identity.triggerWord} ${identity.basePrompts.join(" ")} ${identity.defaults.provider ?? ""} ${identity.defaults.modelId ?? ""}`.toLowerCase().includes(normalized));
  }, [identities, query]);

  const identityWorkflowIds = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const workflow of workflows) {
      for (const node of workflow.nodes) {
        const identityId = node.data.identityAssetId ?? node.data.identitySnapshot?.id;
        if (typeof identityId !== "string") continue;
        const current = map.get(identityId) ?? [];
        if (!current.includes(workflow.id)) current.push(workflow.id);
        map.set(identityId, current);
      }
    }
    return map;
  }, [workflows]);

  const activityFor = useCallback((identityId: string) => ledger.filter((entry) => entry.identityAssetId === identityId), [ledger]);

  const openCreate = () => {
    setSelected(null);
    setDraft(emptyDraft());
    setVersions([]);
    setEditorOpen(true);
  };

  const openEdit = async (identity: IdentityAsset) => {
    setSelected(identity);
    setDraft(toDraft(identity));
    setEditorOpen(true);
    try {
      const response = await fetch(`/api/identities/${encodeURIComponent(identity.id)}`, { cache: "no-store" });
      const body = await response.json() as { versions?: IdentityAsset[] };
      if (response.ok) setVersions(body.versions ?? []);
    } catch { setVersions([]); }
  };

  const save = async () => {
    if (!draft.name.trim()) { addToast("Give this identity a name.", "error"); return; }
    if (!!draft.defaults.provider !== !!draft.defaults.modelId) { addToast("Set both a default provider and model ID, or leave both blank.", "error"); return; }
    setSaving(true);
    try {
      const response = await fetch(selected ? `/api/identities/${encodeURIComponent(selected.id)}` : "/api/identities", {
        method: selected ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const body = await response.json() as { identity?: IdentityAsset; error?: string };
      if (!response.ok || !body.identity) throw new Error(body.error ?? "Unable to save identity.");
      setIdentities((current) => [body.identity!, ...current.filter((identity) => identity.id !== body.identity!.id)]);
      setSelected(body.identity);
      setDraft(toDraft(body.identity));
      setVersions((current) => [body.identity!, ...current.filter((version) => version.version !== body.identity!.version)]);
      addToast(`${body.identity.name} saved as version ${body.identity.version}.`, "success");
    } catch (error) {
      addToast((error as Error).message, "error");
    } finally { setSaving(false); }
  };

  const uploadReferences = async (files: File[]) => {
    const images = files.filter((file) => file.type.startsWith("image/"));
    if (!images.length) {
      addToast("Choose one or more image files.", "error");
      return;
    }

    setUploading(true);
    setUploadingCount(images.length);
    let completed = 0;
    let failed = 0;

    try {
      for (let offset = 0; offset < images.length; offset += 4) {
        const batch = images.slice(offset, offset + 4);
        const results = await Promise.allSettled(batch.map(async (file): Promise<IdentityReference> => {
          const response = await fetch("/api/upload-asset", { method: "POST", headers: { "Content-Type": file.type || "image/jpeg" }, body: await file.arrayBuffer() });
          const body = await response.json() as { cdnUrl?: string; error?: string };
          if (!response.ok || !body.cdnUrl) throw new Error(body.error ?? `Could not upload ${file.name}.`);
          return { url: body.cdnUrl, kind: "face", label: file.name };
        }));
        const uploaded = results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
        failed += results.length - uploaded.length;
        completed += results.length;
        if (uploaded.length) setDraft((current) => ({ ...current, references: [...current.references, ...uploaded] }));
        setUploadingCount(images.length - completed);
      }
      if (failed) addToast(`${failed} ${failed === 1 ? "image" : "images"} could not be uploaded.`, "error");
    } finally {
      setUploading(false);
      setUploadingCount(0);
    }
  };

  const setReferenceKind = (index: number, kind: IdentityReferenceKind) => {
    setDraft((current) => ({
      ...current,
      references: current.references.map((reference, candidate) => candidate === index ? { ...reference, kind } : reference),
    }));
  };

  const duplicate = async (identity: IdentityAsset) => {
    try {
      const response = await fetch("/api/identities", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...toDraft(identity), name: `${identity.name} copy` }) });
      const body = await response.json() as { identity?: IdentityAsset; error?: string };
      if (!response.ok || !body.identity) throw new Error(body.error ?? "Unable to duplicate identity.");
      setIdentities((current) => [body.identity!, ...current]);
      addToast(`Duplicated ${identity.name}.`, "success");
    } catch (error) { addToast((error as Error).message, "error"); }
  };

  const exportIdentity = (identity: IdentityAsset) => {
    const blob = new Blob([JSON.stringify({ format: "heliosgen-identity", version: 1, identity }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${identity.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "identity"}.helios.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const importIdentity = async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text()) as unknown;
      if (!parsed || typeof parsed !== "object") throw new Error("Identity JSON must contain an object.");
      const envelope = parsed as Record<string, unknown>;
      const source = (envelope.identity && typeof envelope.identity === "object" ? envelope.identity : envelope) as Partial<IdentityAsset>;
      const input: IdentityDraft = {
        name: String(source.name ?? "Imported identity"),
        triggerWord: String(source.triggerWord ?? ""),
        basePrompts: Array.isArray(source.basePrompts) ? source.basePrompts.filter((value): value is string => typeof value === "string") : [],
        references: Array.isArray(source.references) ? source.references.filter((value): value is IdentityReference => !!value && typeof value.url === "string" && (value.kind === "face" || value.kind === "body")) : [],
        defaults: source.defaults ?? { ...DEFAULT_IDENTITY_DEFAULTS },
      };
      const response = await fetch("/api/identities", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
      const body = await response.json() as { identity?: IdentityAsset; error?: string };
      if (!response.ok || !body.identity) throw new Error(body.error ?? "Unable to import identity.");
      setIdentities((current) => [body.identity!, ...current]);
      addToast(`Imported ${body.identity.name}.`, "success");
    } catch (error) { addToast(`Import failed: ${(error as Error).message}`, "error"); }
  };

  const createWorkflow = async (identity: IdentityAsset, templateId: "scene-replacement" | "pose-outfit-batch") => {
    try {
      const suffix = templateId === "scene-replacement" ? "Scene Replacement" : "Pose × Outfit Batch";
      const response = await fetch("/api/clone-templates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ templateId, identityAssetId: identity.id, name: `${identity.name} — ${suffix}` }) });
      const body = await response.json() as { workflow?: Space; error?: string };
      if (!response.ok || !body.workflow) throw new Error(body.error ?? "Unable to create workflow.");
      const refreshed = await fetch("/api/workflows", { cache: "no-store" }).then((result) => result.json()) as { spaces: Space[] };
      useWorkflowStore.getState().loadSpacesFromDB(refreshed.spaces);
      useWorkflowStore.getState().switchSpace(body.workflow.id);
      addToast(`Created ${suffix} with ${identity.name}.`, "success");
      router.push(`/workflow/${body.workflow.id}`);
    } catch (error) { addToast((error as Error).message, "error"); }
  };

  const deleteIdentity = async () => {
    if (!deleteTarget) return;
    try {
      const response = await fetch(`/api/identities/${encodeURIComponent(deleteTarget.id)}`, { method: "DELETE" });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Unable to delete identity.");
      setIdentities((current) => current.filter((identity) => identity.id !== deleteTarget.id));
      if (selected?.id === deleteTarget.id) setEditorOpen(false);
      addToast(`Deleted ${deleteTarget.name}. Existing workflows keep their embedded snapshot.`, "success");
    } catch (error) { addToast((error as Error).message, "error"); }
    finally { setDeleteTarget(null); }
  };

  const selectedWorkflows = selected ? workflows.filter((workflow) => identityWorkflowIds.get(selected.id)?.includes(workflow.id)) : [];
  const selectedActivity = selected ? activityFor(selected.id) : [];
  const totalReferences = identities.reduce((count, identity) => count + identity.references.length, 0);
  const linkedCount = new Set([...identityWorkflowIds.values()].flat()).size;

  return (
    <main className="relative flex-1 overflow-y-auto bg-background text-foreground">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-80 bg-[radial-gradient(ellipse_at_15%_0%,color-mix(in_oklab,var(--color-primary)_10%,transparent),transparent_55%),radial-gradient(ellipse_at_80%_0%,color-mix(in_oklab,var(--color-chart-2)_8%,transparent),transparent_52%)]" />
      <div className="relative mx-auto w-full max-w-[1500px] px-5 py-8 md:px-9 md:py-10">
        <header className="grid gap-7 border-b border-border pb-8 lg:grid-cols-[1fr_auto] lg:items-end">
          <div>
            <div className="mb-3 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground"><span className="h-px w-8 bg-primary/60" />Production assets / identity layer</div>
            <h1 className="max-w-3xl text-3xl font-medium tracking-[-0.035em] sm:text-4xl">Keep the person consistent.<br /><span className="text-muted-foreground">Change everything around them.</span></h1>
            <p className="mt-4 max-w-2xl text-sm leading-6 text-muted-foreground">Version face and body references, reusable prompt DNA, content routing, and model defaults—then launch identity-aware workflows with a traceable production history.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <input ref={importInput} type="file" accept="application/json,.json" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importIdentity(file); event.target.value = ""; }} />
            <Button variant="outline" onClick={() => importInput.current?.click()}><FileJson />Import JSON</Button>
            <Button onClick={openCreate}><Plus />New identity</Button>
          </div>
        </header>

        <section className="grid border-x border-b border-border sm:grid-cols-3" aria-label="Identity library summary">
          {[
            { value: String(identities.length).padStart(2, "0"), label: "Identity dossiers", Icon: ScanFace },
            { value: String(totalReferences).padStart(2, "0"), label: "Reference frames", Icon: Images },
            { value: String(linkedCount).padStart(2, "0"), label: "Linked workflows", Icon: Boxes },
          ].map(({ value, label, Icon }, index) => (
            <div key={label} className={cn("flex items-center gap-4 px-5 py-4", index > 0 && "border-t border-border sm:border-l sm:border-t-0")}>
              <Icon className="size-4 text-muted-foreground" strokeWidth={1.4} />
              <strong className="font-mono text-xl font-medium tracking-tight">{value}</strong>
              <span className="text-xs text-muted-foreground">{label}</span>
            </div>
          ))}
        </section>

        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative w-full max-w-md"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name, trigger, model, or prompt…" className="pl-9" /></div>
          <div className="flex items-center gap-2"><span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{filtered.length} shown</span><Button variant="ghost" size="icon" aria-label="Refresh identities" disabled={refreshing} onClick={() => void load(true)}><RefreshCw className={cn(refreshing && "animate-spin")} /></Button></div>
        </div>

        {loading ? (
          <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">{[0, 1, 2].map((item) => <Skeleton key={item} className="h-[390px] rounded-xl" />)}</div>
        ) : filtered.length ? (
          <section className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {filtered.map((identity) => {
              const linked = identityWorkflowIds.get(identity.id)?.length ?? 0;
              const runs = activityFor(identity.id);
              return (
                <Card key={identity.id} className="group/card cursor-pointer gap-0 py-0 transition hover:-translate-y-0.5 hover:ring-foreground/20" onClick={() => void openEdit(identity)}>
                  <ReferenceMosaic identity={identity} />
                  <CardHeader className="border-b border-border py-4">
                    <CardTitle className="truncate pr-8 text-lg tracking-tight">{identity.name}</CardTitle>
                    <CardDescription className="font-mono text-[10px] uppercase tracking-[0.13em]">Updated {formatDate(identity.updatedAt)}</CardDescription>
                    <CardAction onClick={(event) => event.stopPropagation()}>
                      <DropdownMenu>
                        <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={`Actions for ${identity.name}`} />}><MoreHorizontal /></DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-52">
                          <DropdownMenuItem onClick={() => void createWorkflow(identity, "scene-replacement")}><WandSparkles />Create scene workflow</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => void createWorkflow(identity, "pose-outfit-batch")}><Boxes />Create batch workflow</DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={() => void duplicate(identity)}><Copy />Duplicate</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => exportIdentity(identity)}><Download />Export JSON</DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem variant="destructive" onClick={() => setDeleteTarget(identity)}><Trash2 />Delete identity</DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </CardAction>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-4 py-4">
                    <div className="flex flex-wrap gap-1.5"><Badge variant={identity.defaults.contentClass === "adult" ? "destructive" : "secondary"}>{identity.defaults.contentClass.toUpperCase()}</Badge><Badge variant="outline">{identity.references.length} refs</Badge>{identity.defaults.provider && <Badge variant="outline">{identity.defaults.provider}</Badge>}</div>
                    <div className="min-h-10 text-xs leading-5 text-muted-foreground">{identity.triggerWord ? <><span className="font-mono text-foreground">{identity.triggerWord}</span> · </> : null}{identity.basePrompts[0] ?? "No reusable base prompt yet."}</div>
                  </CardContent>
                  <CardFooter className="grid grid-cols-2 gap-0 p-0">
                    <div className="border-r border-border px-4 py-3"><div className="font-mono text-sm">{linked}</div><div className="text-[10px] uppercase tracking-wider text-muted-foreground">Workflows</div></div>
                    <div className="px-4 py-3"><div className="font-mono text-sm">{runs.length}</div><div className="text-[10px] uppercase tracking-wider text-muted-foreground">Runs logged</div></div>
                  </CardFooter>
                </Card>
              );
            })}
          </section>
        ) : (
          <Empty className="mt-8 min-h-[430px] border border-dashed border-border bg-card/25 px-5 py-10">
            <EmptyHeader className="max-w-lg">
              <EmptyMedia variant="icon"><UserRoundSearch /></EmptyMedia>
              <EmptyTitle className="text-base">{identities.length ? "No identities match" : "Create your first identity dossier"}</EmptyTitle>
              <EmptyDescription>{identities.length ? "Try another name, trigger, provider, or prompt." : "Give every recurring person one durable source of truth for references, prompt DNA, and generation defaults."}</EmptyDescription>
            </EmptyHeader>
            <EmptyContent className="max-w-3xl">
              {!identities.length && (
                <div className="my-3 grid w-full gap-px overflow-hidden rounded-xl border border-border bg-border text-left sm:grid-cols-3">
                  {[
                    { icon: Fingerprint, label: "01 · Define", text: "Name the identity and capture reusable prompt instructions." },
                    { icon: Images, label: "02 · Reference", text: "Collect clear face and body frames in one versioned matrix." },
                    { icon: Route, label: "03 · Route", text: "Set auditable content, provider, model, and framing defaults." },
                  ].map(({ icon: Icon, label, text }) => (
                    <div key={label} className="bg-background/80 p-4">
                      <Icon className="size-4 text-primary" strokeWidth={1.5} />
                      <div className="mt-3 font-mono text-[9px] uppercase tracking-[0.16em] text-foreground">{label}</div>
                      <p className="mt-1.5 text-xs leading-5 text-muted-foreground">{text}</p>
                    </div>
                  ))}
                </div>
              )}
              {identities.length ? <Button variant="outline" onClick={() => setQuery("")}>Clear search</Button> : <Button onClick={openCreate}><Plus />Build an identity</Button>}
            </EmptyContent>
          </Empty>
        )}
      </div>

      <Sheet open={editorOpen} onOpenChange={setEditorOpen}>
        <SheetContent size="wide" className="gap-0 overflow-hidden bg-popover p-0">
          <SheetHeader className="border-b border-border px-5 py-5 sm:px-7 sm:py-6">
            <div className="flex items-start gap-4 pr-10">
              <div className="relative flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border bg-muted text-muted-foreground">
                {draft.references[0] ? <Image src={draft.references[0].url} alt="Identity cover reference" fill sizes="48px" unoptimized className="object-cover" /> : <Fingerprint className="size-5" strokeWidth={1.4} />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="mb-2 flex flex-wrap items-center gap-2 font-mono text-[9px] uppercase tracking-[0.18em] text-muted-foreground">
                  <span>{selected ? `Identity ${selected.id.slice(0, 8)}` : "New identity dossier"}</span>
                  <span aria-hidden="true">/</span>
                  <span>{selected ? `Version ${selected.version}` : "Draft"}</span>
                </div>
                <SheetTitle className="truncate text-xl tracking-tight sm:text-2xl">{selected ? selected.name : "Define a reusable identity"}</SheetTitle>
                <SheetDescription className="mt-1 max-w-2xl leading-5">Store the source material once, then reuse a stable snapshot across every production workflow. Saved edits create a new immutable version.</SheetDescription>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  <Badge variant="outline">{draft.references.length} references</Badge>
                  <Badge variant={draft.defaults.contentClass === "adult" ? "destructive" : "secondary"}>{draft.defaults.contentClass.toUpperCase()}</Badge>
                  <Badge variant="outline">{draft.defaults.provider ?? "Workflow routing"}</Badge>
                </div>
              </div>
            </div>
          </SheetHeader>
          <ScrollArea className="min-h-0 flex-1">
            <Tabs defaultValue="profile" className="min-h-full gap-0">
              <TabsList variant="line" aria-label="Identity editor sections" className="sticky top-0 z-10 flex min-h-12 w-full justify-start overflow-x-auto border-b border-border bg-popover/95 px-4 py-2 backdrop-blur-sm sm:px-7">
                <TabsTrigger value="profile" className="flex-none px-3"><Fingerprint />Profile</TabsTrigger>
                <TabsTrigger value="references" className="flex-none px-3"><Images />References <Badge variant="secondary">{draft.references.length}</Badge></TabsTrigger>
                <TabsTrigger value="defaults" className="flex-none px-3"><SlidersHorizontal />Defaults</TabsTrigger>
                {selected && <TabsTrigger value="activity" className="flex-none px-3"><History />Activity <Badge variant="secondary">{selectedActivity.length}</Badge></TabsTrigger>}
                {selected && <TabsTrigger value="versions" className="flex-none px-3"><GitBranch />Versions <Badge variant="secondary">{versions.length}</Badge></TabsTrigger>}
              </TabsList>

              <TabsContent value="profile" className="mx-auto flex w-full max-w-3xl flex-col gap-7 p-5 sm:p-7">
                <EditorSectionHeading eyebrow="01 / Profile" title="The identity contract" description="Name the person and define the prompt fragments that should travel with every identity-aware generation." />
                <FieldGroup>
                  <div className="grid gap-5 sm:grid-cols-2">
                    <Field>
                      <FieldLabel htmlFor="identity-name">Identity name</FieldLabel>
                      <Input id="identity-name" autoFocus value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} placeholder="Ava — lifestyle creator" />
                      <FieldDescription>Use a recognizable production name. This stays internal.</FieldDescription>
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="identity-trigger">Trigger word</FieldLabel>
                      <Input id="identity-trigger" value={draft.triggerWord} onChange={(event) => setDraft((current) => ({ ...current, triggerWord: event.target.value }))} placeholder="AVA_PERSON" />
                      <FieldDescription>A stable token for providers or trained models that recognize one.</FieldDescription>
                    </Field>
                  </div>
                  <Field>
                    <div className="flex items-end justify-between gap-3">
                      <FieldLabel htmlFor="identity-prompts">Reusable prompt DNA</FieldLabel>
                      <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">{draft.basePrompts.filter((prompt) => prompt.trim()).length} fragments</span>
                    </div>
                    <Textarea id="identity-prompts" className="min-h-52 resize-y leading-6" value={draft.basePrompts.join("\n")} onChange={(event) => setDraft((current) => ({ ...current, basePrompts: event.target.value.split("\n") }))} placeholder={"One reusable instruction per line\nPreserve facial geometry and natural skin texture\nKeep body proportions consistent across scenes"} />
                    <FieldDescription>Write one instruction per line. Workflows can combine these fragments without duplicating prompt work.</FieldDescription>
                  </Field>
                </FieldGroup>
              </TabsContent>

              <TabsContent value="references" className="mx-auto flex w-full max-w-3xl flex-col gap-7 p-5 sm:p-7">
                <EditorSectionHeading eyebrow="02 / Reference matrix" title="Show the system who this is" description="Use varied, high-quality source frames. Close face images carry facial detail; full-body references reinforce proportions and silhouette." />
                <input ref={referenceInput} type="file" accept="image/*" multiple className="hidden" onChange={(event) => { const files = Array.from(event.target.files ?? []); if (files.length) void uploadReferences(files); event.target.value = ""; }} />
                <div className="grid gap-4 rounded-xl border border-dashed border-border bg-card/35 p-4 transition-colors hover:border-primary/40 sm:grid-cols-[1fr_auto] sm:items-center sm:p-5" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const files = Array.from(event.dataTransfer.files); if (files.length) void uploadReferences(files); }}>
                  <div className="flex items-center gap-3">
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"><Upload className="size-4" /></div>
                    <div><div className="text-sm font-medium">Add source frames</div><p className="mt-0.5 text-xs leading-5 text-muted-foreground">Drop several images here or choose files. New frames start as Face; classify each one below.</p></div>
                  </div>
                  <Button variant="outline" disabled={uploading} onClick={() => referenceInput.current?.click()}><Upload />{uploading ? `Uploading ${uploadingCount || "…"}` : "Choose images"}</Button>
                </div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{draft.references.map((reference, index) => <div key={`${reference.url}-${index}`} className="group overflow-hidden rounded-xl border border-border bg-card"><div className="relative aspect-3/4 overflow-hidden bg-muted"><Image src={reference.url} alt={reference.label ?? `${reference.kind} reference`} fill sizes="240px" unoptimized className="object-cover transition duration-300 group-hover:scale-[1.02]" /><Button variant="destructive" size="icon-xs" className="absolute right-2 top-2" aria-label={`Remove reference ${index + 1}`} onClick={() => setDraft((current) => ({ ...current, references: current.references.filter((_, candidate) => candidate !== index) }))}><X /></Button></div><div className="flex flex-col gap-2 p-3"><div className="truncate text-xs text-muted-foreground" title={reference.label}>{reference.label ?? `Reference ${index + 1}`}</div><Field><FieldLabel htmlFor={`identity-reference-${index}`}>Reference role</FieldLabel><Select items={REFERENCE_KINDS} value={reference.kind} onValueChange={(value) => setReferenceKind(index, value === "body" ? "body" : "face")}><SelectTrigger id={`identity-reference-${index}`} aria-label={`Reference ${index + 1} role`} className="w-full"><SelectValue /></SelectTrigger><SelectContent alignItemWithTrigger={false}><SelectGroup><SelectItem value="face">Face reference</SelectItem><SelectItem value="body">Body reference</SelectItem></SelectGroup></SelectContent></Select></Field></div></div>)}</div>
                {!draft.references.length && <Empty className="min-h-64 border border-dashed border-border"><EmptyHeader><EmptyMedia variant="icon"><Images /></EmptyMedia><EmptyTitle>No reference frames</EmptyTitle><EmptyDescription>Add several images at once, then mark each one as a face or body reference.</EmptyDescription></EmptyHeader><EmptyContent><Button variant="outline" onClick={() => referenceInput.current?.click()}><Upload />Choose images</Button></EmptyContent></Empty>}
              </TabsContent>

              <TabsContent value="defaults" className="mx-auto flex w-full max-w-3xl flex-col gap-7 p-5 sm:p-7">
                <EditorSectionHeading eyebrow="03 / Production defaults" title="Make routing intentional" description="Set the starting provider, model, framing, and content class. A workflow can override these choices while preserving the identity snapshot." />
                <div className="rounded-xl border border-border bg-card p-4 sm:p-5">
                  <div className="flex gap-3"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" /><div><h3 className="text-sm font-medium">Explicit, auditable content routing</h3><p className="mt-1 text-xs leading-5 text-muted-foreground">Capability is never inferred from a model name. Adult workflows still require explicit adult-age and consent confirmations before a run, and provider rules always apply.</p></div></div>
                </div>
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="identity-content-class">Content class</FieldLabel>
                    <Select items={CONTENT_CLASSES} value={draft.defaults.contentClass} onValueChange={(value) => setDraft((current) => ({ ...current, defaults: { ...current.defaults, contentClass: value === "adult" ? "adult" : "sfw" } }))}><SelectTrigger id="identity-content-class" className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectItem value="sfw">SFW production</SelectItem><SelectItem value="adult">Adult production</SelectItem></SelectGroup></SelectContent></Select>
                    <FieldDescription>This travels with the identity as workflow metadata and is visible in run provenance.</FieldDescription>
                  </Field>
                  <div className="grid gap-5 sm:grid-cols-2">
                    <Field>
                      <FieldLabel htmlFor="identity-provider">Default provider</FieldLabel>
                      <Select items={PROVIDERS} value={draft.defaults.provider ?? "workflow-default"} onValueChange={(value) => setDraft((current) => ({ ...current, defaults: { ...current.defaults, provider: value === "workflow-default" ? undefined : value as WorkflowProvider, ...(value === "workflow-default" ? { modelId: undefined } : {}) } }))}><SelectTrigger id="identity-provider" className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{PROVIDERS.map((provider) => <SelectItem key={provider.value} value={provider.value}>{provider.label}</SelectItem>)}</SelectGroup></SelectContent></Select>
                      <FieldDescription>Leave routing to each workflow or pin a provider here.</FieldDescription>
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="identity-model">Default model ID</FieldLabel>
                      <Input id="identity-model" value={draft.defaults.modelId ?? ""} disabled={!draft.defaults.provider} onChange={(event) => setDraft((current) => ({ ...current, defaults: { ...current.defaults, modelId: event.target.value || undefined } }))} placeholder="provider/model-name" />
                      <FieldDescription>{draft.defaults.provider ? "Use the provider's exact model identifier." : "Choose a provider before pinning a model."}</FieldDescription>
                    </Field>
                  </div>
                  <Field>
                    <FieldLabel htmlFor="identity-aspect-ratio">Default aspect ratio</FieldLabel>
                    <Select items={ASPECT_RATIO_ITEMS} value={draft.defaults.aspectRatio ?? "9:16"} onValueChange={(value) => setDraft((current) => ({ ...current, defaults: { ...current.defaults, aspectRatio: value ?? "9:16" } }))}><SelectTrigger id="identity-aspect-ratio" className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{ASPECT_RATIOS.map((ratio) => <SelectItem key={ratio} value={ratio}>{ratio}</SelectItem>)}</SelectGroup></SelectContent></Select>
                  </Field>
                </FieldGroup>
                <div className="grid gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-3" aria-label="Current production defaults">
                  {[{ label: "Content", value: draft.defaults.contentClass.toUpperCase() }, { label: "Route", value: draft.defaults.provider ?? "Per workflow" }, { label: "Frame", value: draft.defaults.aspectRatio ?? "9:16" }].map((item) => <div key={item.label} className="bg-background px-4 py-3"><div className="font-mono text-[9px] uppercase tracking-[0.15em] text-muted-foreground">{item.label}</div><div className="mt-1 truncate text-sm">{item.value}</div></div>)}
                </div>
              </TabsContent>

              {selected && <TabsContent value="activity" className="mx-auto flex w-full max-w-3xl flex-col gap-7 p-5 sm:p-7">
                <EditorSectionHeading eyebrow="04 / Activity" title="Trace where this identity travels" description="Open linked workflows and review provider outputs with model, status, and cost provenance." />
                <section><div className="mb-3 flex items-center justify-between"><h3 className="text-sm font-medium">Linked workflows</h3><Badge variant="outline">{selectedWorkflows.length}</Badge></div>{selectedWorkflows.length ? <div className="divide-y divide-border rounded-lg border border-border">{selectedWorkflows.map((workflow) => <button key={workflow.id} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-muted/50" onClick={() => router.push(`/workflow/${workflow.id}`)}><div><div className="text-sm">{workflow.name}</div><div className="mt-0.5 text-[10px] text-muted-foreground">Updated {formatDate(workflow.updatedAt ?? workflow.createdAt)}</div></div><ArrowUpRight className="size-4 text-muted-foreground" /></button>)}</div> : <p className="text-xs text-muted-foreground">No workflow currently embeds this identity.</p>}</section>
                <section><div className="mb-3 flex items-center justify-between"><h3 className="text-sm font-medium">Provider ledger</h3><Badge variant="outline">{selectedActivity.length}</Badge></div>{selectedActivity.length ? <div className="grid grid-cols-2 gap-3">{selectedActivity.slice(0, 12).map((entry) => <div key={entry.id} className="overflow-hidden rounded-lg border border-border bg-card">{entry.outputUrl ? <div className="relative aspect-square">{isVideoUrl(entry.outputUrl) ? <video src={entry.outputUrl} muted playsInline controls className="size-full object-cover" /> : <Image src={entry.outputUrl} alt="Generated identity output" fill sizes="240px" unoptimized className="object-cover" />}</div> : <div className="flex aspect-square items-center justify-center bg-muted"><Sparkles className="size-6 text-muted-foreground" /></div>}<div className="flex flex-col gap-1 p-3"><div className="flex items-center justify-between gap-2"><span className="truncate text-xs">{entry.modelId}</span><Badge variant={entry.status === "error" ? "destructive" : "secondary"}>{entry.status}</Badge></div><div className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">{entry.provider} · {formatDate(entry.createdAt)}</div></div></div>)}</div> : <p className="text-xs text-muted-foreground">Runs created from this identity will appear here with provider and model provenance.</p>}</section>
              </TabsContent>}

              {selected && <TabsContent value="versions" className="mx-auto flex w-full max-w-3xl flex-col gap-3 p-5 sm:p-7"><EditorSectionHeading eyebrow="05 / Version history" title="Immutable identity snapshots" description="Every saved revision stays available for provenance while existing workflows keep the version they embedded." />{versions.map((version) => <div key={version.version} className="grid grid-cols-[72px_1fr] items-center gap-4 border-b border-border py-3 sm:grid-cols-[72px_1fr_auto]"><ReferenceMosaic identity={version} compact /><div className="min-w-0"><div className="text-sm font-medium">Version {version.version}</div><div className="mt-1 truncate text-xs text-muted-foreground">{version.triggerWord || "No trigger"} · {version.references.length} references · {version.basePrompts.length} prompts</div></div><time className="col-start-2 font-mono text-[9px] uppercase tracking-wider text-muted-foreground sm:col-auto">{formatDate(version.updatedAt)}</time></div>)}</TabsContent>}
            </Tabs>
          </ScrollArea>
          <SheetFooter className="flex-row items-center justify-between gap-3 border-t border-border bg-popover px-5 py-4 sm:px-7"><div>{selected && <Button type="button" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setDeleteTarget(selected)}><Trash2 />Delete</Button>}</div><div className="ml-auto flex gap-2"><Button type="button" variant="outline" onClick={() => setEditorOpen(false)}>Cancel</Button><Button type="button" disabled={saving || uploading || !draft.name.trim()} onClick={(event) => { event.preventDefault(); event.stopPropagation(); void save(); }}>{saving ? "Saving…" : selected ? "Save new version" : "Create identity"}</Button></div></SheetFooter>
        </SheetContent>
      </Sheet>

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Delete {deleteTarget?.name}?</AlertDialogTitle><AlertDialogDescription>This permanently removes the identity and version history. Existing workflows keep their embedded snapshot, but cannot refresh from this identity.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={() => void deleteIdentity()}>Delete identity</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}
