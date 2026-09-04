"use client";

import { useEffect, useMemo, useState } from "react";
import { Download, ExternalLink, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useWorkflowStore, type Space } from "@/lib/store";

interface CommunityWorkflow {
  id: string;
  name: string;
  author: string;
  size: number;
  description: string;
  nodeCount: number;
  tags: string[];
  previewImage?: string;
}

const formatSize = (bytes: number) => bytes >= 1024 * 1024
  ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
  : `${Math.ceil(bytes / 1024)} KB`;

export default function CommunityWorkflowBrowser({ open, onOpenChange, onImported }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: (spaceId: string) => void;
}) {
  const addToast = useWorkflowStore((state) => state.addToast);
  const [workflows, setWorkflows] = useState<CommunityWorkflow[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [importingId, setImportingId] = useState<string | null>(null);

  useEffect(() => {
    if (!open || workflows.length) return;
    fetch("/api/community-workflows")
      .then(async (response) => {
        const body = await response.json() as { workflows?: CommunityWorkflow[]; error?: string };
        if (!response.ok) throw new Error(body.error ?? "Unable to load workflows.");
        setWorkflows(body.workflows ?? []);
      })
      .catch((error) => addToast((error as Error).message, "error"))
      .finally(() => setLoading(false));
  }, [addToast, open, workflows.length]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return workflows;
    return workflows.filter((workflow) => `${workflow.name} ${workflow.description} ${workflow.author} ${workflow.tags.join(" ")}`.toLowerCase().includes(normalized));
  }, [query, workflows]);

  const importWorkflow = async (workflow: CommunityWorkflow) => {
    setImportingId(workflow.id);
    try {
      const response = await fetch(`/api/community-workflows/${encodeURIComponent(workflow.id)}/import`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ allowLarge: workflow.size > 25 * 1024 * 1024 }) });
      const imported = await response.json() as { workflow?: { id: string }; unsupportedNodeTypes?: string[]; error?: string };
      if (!response.ok || !imported.workflow) throw new Error(imported.error ?? "Unable to import workflow.");
      const refreshed = await fetch("/api/workflows").then((result) => result.json()) as { spaces: Space[] };
      useWorkflowStore.getState().loadSpacesFromDB(refreshed.spaces);
      const spaceId = imported.workflow.id;
      useWorkflowStore.getState().switchSpace(spaceId);
      addToast(
        imported.unsupportedNodeTypes?.length
          ? `Imported with ${imported.unsupportedNodeTypes.length} unsupported node type(s) converted to notes.`
          : `Imported ${workflow.name}. Review provider nodes before running.`,
        imported.unsupportedNodeTypes?.length ? "info" : "success",
      );
      onOpenChange(false);
      onImported(spaceId);
    } catch (error) {
      addToast(`Community import failed: ${(error as Error).message}`, "error");
    } finally {
      setImportingId(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl border-white/10 bg-[#0b0e14] text-white">
        <DialogHeader>
          <DialogTitle>Community workflow library</DialogTitle>
          <DialogDescription>Browse shared Node Banana workflows and convert them into editable HeliosGen canvases.</DialogDescription>
        </DialogHeader>
        <div className="relative"><Search className="absolute left-3 top-2.5 size-4 text-white/35" /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search workflows, tags, or authors" className="border-white/10 bg-white/5 pl-9" /></div>
        <ScrollArea className="h-[62vh]">
          <div className="grid grid-cols-1 gap-3 pr-3 md:grid-cols-2">
            {loading && <div className="col-span-full p-10 text-center text-sm text-white/40">Loading community catalog…</div>}
            {!loading && filtered.map((workflow) => (
              <article key={workflow.id} className="overflow-hidden rounded-2xl border border-white/8 bg-white/[0.025]">
                {workflow.previewImage && <div role="img" aria-label={`${workflow.name} preview`} className="h-40 w-full bg-cover bg-center" style={{ backgroundImage: `url(${workflow.previewImage})` }} />}
                <div className="space-y-3 p-4">
                  <div><div className="font-medium text-white">{workflow.name}</div><div className="mt-0.5 text-xs text-white/40">{workflow.author} · {workflow.nodeCount} nodes · {formatSize(workflow.size)}</div></div>
                  <p className="min-h-10 text-xs leading-relaxed text-white/55">{workflow.description}</p>
                  <div className="flex flex-wrap gap-1.5">{workflow.tags.map((tag) => <Badge key={tag} variant="outline" className="border-white/10 text-white/50">{tag}</Badge>)}</div>
                  {workflow.size > 25 * 1024 * 1024 && <div className="rounded-lg border border-amber-400/15 bg-amber-400/5 p-2 text-[10px] text-amber-200/70">Includes {formatSize(workflow.size)} of embedded media. Import downloads the full file.</div>}
                  <div className="flex items-center gap-2">
                    <Button onClick={() => importWorkflow(workflow)} disabled={!!importingId} className="flex-1"><Download size={14} />{importingId === workflow.id ? "Converting…" : "Import & convert"}</Button>
                    <Button nativeButton={false} variant="outline" size="icon" render={<a href="https://nodebananapro.com" target="_blank" rel="noreferrer" aria-label="Open Node Banana" />}><ExternalLink size={14} /></Button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
