"use client";
import { useEffect, useRef, useState } from "react";
import { LoaderCircle, ScanFace } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { REFERENCE_STYLES } from "@/lib/referenceSheets";
import { IMAGE_MODELS } from "@/lib/modelConfig";
import type { IdentityReference } from "@/lib/cloneMe";

type Provider = "kie" | "codex" | "antigravity";
/**
 * Generate a consistency reference (comp card, headshot, turnaround…) for a
 * saved identity through a chosen provider, poll the job, and hand the
 * finished image back as a reference the caller files on the draft.
 */
export function ReferenceSheetGenerator({ identityId, onReference }: { identityId: string; onReference: (reference: IdentityReference) => void }) {
  const [style, setStyle] = useState(REFERENCE_STYLES[0].id), [provider, setProvider] = useState<Provider>("kie"), [model, setModel] = useState("nano-banana-pro");
  const [accounts, setAccounts] = useState<{ codex: boolean; antigravity: boolean }>({ codex: false, antigravity: false });
  const [status, setStatus] = useState<"idle" | "submitting" | "running" | "done" | "error">("idle"), [message, setMessage] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    const t = setTimeout(() => { void Promise.all([fetch("/api/settings/codex-status").then(r => r.json()).catch(() => ({})), fetch("/api/settings/antigravity-status").then(r => r.json()).catch(() => ({}))]).then(([c, a]) => setAccounts({ codex: !!c?.imageReady, antigravity: !!a?.imageReady })); }, 0);
    return () => { clearTimeout(t); if (timer.current) clearTimeout(timer.current); };
  }, []);
  const chosen = REFERENCE_STYLES.find(s => s.id === style)!;
  async function generate() {
    setStatus("submitting"); setMessage("");
    try {
      const r = await fetch(`/api/identities/${identityId}/reference-sheet`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ style, provider, model }) });
      const data = await r.json(); if (!r.ok) throw new Error(data.error);
      setStatus("running"); setMessage(`${data.label} submitted to ${provider === "kie" ? IMAGE_MODELS.find(m => m.id === data.model)?.name ?? data.model : provider === "codex" ? "the OpenAI account" : "the Google account"}. This usually takes one to three minutes.`);
      const started = Date.now();
      const poll = async () => {
        try {
          const s = await fetch(`/api/job-status?taskId=${encodeURIComponent(data.taskId)}`).then(x => x.json());
          if (s.status === "done") { const url = s.imageUrl ?? s.imageUrls?.[0]; if (!url) throw new Error("The job finished without an image."); onReference({ url, kind: data.kind, label: data.label }); setStatus("done"); setMessage(`${data.label} added to the references below. Save the identity to keep it.`); return; }
          if (s.status === "error" || s.status === "not_found") throw new Error(s.error || "The job could not be recovered.");
          if (Date.now() - started > 15 * 60_000) throw new Error("Timed out waiting for the provider.");
          timer.current = setTimeout(poll, 4000);
        } catch (e) { setStatus("error"); setMessage((e as Error).message); }
      };
      timer.current = setTimeout(poll, 4000);
    } catch (e) { setStatus("error"); setMessage((e as Error).message); }
  }
  const busy = status === "submitting" || status === "running";
  return <div className="space-y-3 rounded-xl border border-border p-4">
    <div className="flex items-center gap-2"><ScanFace size={15} className="text-primary" /><span className="text-sm font-medium">Generate a reference sheet</span></div>
    <p className="text-xs text-muted-foreground">Place this identity, from its prompt DNA and existing references, into a studio format built for consistency. {chosen.description}</p>
    <div className="grid gap-2 sm:grid-cols-3">
      <NativeSelect value={style} disabled={busy} onChange={e => setStyle(e.target.value)} aria-label="Reference style">{REFERENCE_STYLES.map(s => <option key={s.id} value={s.id}>{s.label} · {s.aspectRatio}</option>)}</NativeSelect>
      <NativeSelect value={provider} disabled={busy} onChange={e => setProvider(e.target.value as Provider)} aria-label="Image provider"><option value="kie">Kie.ai</option><option value="codex" disabled={!accounts.codex}>OpenAI account{accounts.codex ? "" : " (unavailable)"}</option><option value="antigravity" disabled={!accounts.antigravity}>Google account · Antigravity{accounts.antigravity ? "" : " (unavailable)"}</option></NativeSelect>
      {provider === "kie" ? <NativeSelect value={model} disabled={busy} onChange={e => setModel(e.target.value)} aria-label="Image model">{IMAGE_MODELS.filter(m => m.supportsImages).map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</NativeSelect> : <span className="self-center text-xs text-muted-foreground">{provider === "codex" ? "GPT Image 2 through the account" : "Nano Banana Pro through the account"}</span>}
    </div>
    <div className="flex items-center gap-3"><Button type="button" size="sm" disabled={busy} onClick={() => void generate()}>{busy ? <><LoaderCircle className="animate-spin" data-icon="inline-start" />{status === "submitting" ? "Submitting…" : "Generating…"}</> : "Generate"}</Button>{message && <p role={status === "error" ? "alert" : "status"} className={status === "error" ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>{message}</p>}</div>
  </div>;
}
