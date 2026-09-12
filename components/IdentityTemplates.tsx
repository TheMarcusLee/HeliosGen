"use client";
/* eslint-disable @next/next/no-img-element */
import { useCallback, useEffect, useRef, useState } from "react";
import { FileJson, ScanFace, Trash2, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { NativeSelect } from "@/components/ui/native-select";
import { cn } from "@/lib/utils";
import type { IdentityTemplate } from "@/lib/identityTemplates";
import type { IdentityAsset } from "@/lib/cloneMe";

/** Starter personas that become identities in one click. Shown inside the identity library. */
export function IdentityTemplates({ onCreated }: { onCreated?: (identity: IdentityAsset) => void }) {
  const [templates, setTemplates] = useState<IdentityTemplate[]>([]), [categories, setCategories] = useState<{ name: string; count: number }[]>([]);
  const [category, setCategory] = useState(""), [gender, setGender] = useState(""), [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string>(), [notice, setNotice] = useState(""), [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const refresh = useCallback(async () => {
    const p = new URLSearchParams(); if (category) p.set("category", category); if (gender) p.set("gender", gender);
    const r = await fetch(`/api/identity-templates?${p}`); const data = await r.json();
    setTemplates(data.templates ?? []); setCategories(data.categories ?? []);
  }, [category, gender]);
  useEffect(() => { const t = setTimeout(() => { void refresh().catch(() => {}); }, 0); return () => clearTimeout(t); }, [refresh]);
  async function upload(file: File) {
    setBusy("upload"); setError(""); setNotice("");
    try { const r = await fetch("/api/identity-templates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ import: JSON.parse(await file.text()) }) }); const data = await r.json(); if (!r.ok) throw new Error(data.error); setNotice(`Imported ${data.added} template${data.added === 1 ? "" : "s"}${data.updated ? `, updated ${data.updated}` : ""}.`); setOpen(true); await refresh(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(undefined); }
  }
  async function use(t: IdentityTemplate) {
    setBusy(t.id); setError(""); setNotice("");
    try { const r = await fetch("/api/identity-templates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ use: t.id }) }); const data = await r.json(); if (!r.ok) throw new Error(data.error); setNotice(`${t.name} is now an identity.`); onCreated?.(data.identity); }
    catch (e) { setError((e as Error).message); } finally { setBusy(undefined); }
  }
  async function remove(t: IdentityTemplate) {
    if (!confirm(`Remove the ${t.name} template?`)) return;
    await fetch(`/api/identity-templates?id=${t.id}`, { method: "DELETE" }); await refresh();
  }
  const total = categories.reduce((n, c) => n + c.count, 0);
  return <section className="mt-8 rounded-xl border border-border" aria-label="Starter templates">
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      <button type="button" className="flex items-center gap-2 text-left" onClick={() => setOpen(v => !v)}><ScanFace size={16} className="text-primary" /><span className="text-sm font-medium">Starter templates</span><span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{total} personas · {open ? "hide" : "show"}</span></button>
      <div className="flex flex-wrap items-center gap-2">
        {open && <><NativeSelect className="w-auto" value={category} onChange={e => setCategory(e.target.value)} aria-label="Template category"><option value="">All categories</option>{categories.map(c => <option key={c.name} value={c.name}>{c.name} · {c.count}</option>)}</NativeSelect><NativeSelect className="w-auto" value={gender} onChange={e => setGender(e.target.value)} aria-label="Template gender"><option value="">Any gender</option><option value="female">Female</option><option value="male">Male</option></NativeSelect></>}
        <input ref={input} type="file" accept="application/json,.json" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ""; }} />
        <Button variant="outline" size="sm" disabled={busy === "upload"} onClick={() => input.current?.click()}><FileJson />Upload templates (JSON)</Button>
      </div>
    </div>
    {(notice || error) && <p role={error ? "alert" : "status"} className={cn("px-4 pb-3 text-sm", error ? "text-destructive" : "text-muted-foreground")}>{error || notice}</p>}
    {open && <div className="border-t border-border p-4">
      <p className="mb-4 text-xs text-muted-foreground">Described personas with a reference image. Using one mirrors the image locally and creates an identity with the description as its base prompt, ready for campaigns. Upload your own as JSON: an array of {"{ name, prompt, imageUrl?, category? }"}, or an App Promo Factory export unchanged.</p>
      {!templates.length ? <p className="text-sm text-muted-foreground">No templates yet.</p> : <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{templates.map(t => <div key={t.id} className="flex gap-3 rounded-xl border border-border bg-card p-3">
        {t.imageUrl ? <img src={t.imageUrl} alt="" loading="lazy" className="h-28 w-20 shrink-0 rounded-md object-cover" /> : <div className="flex h-28 w-20 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground"><ScanFace size={18} /></div>}
        <div className="flex min-w-0 flex-1 flex-col"><p className="truncate text-sm font-medium">{t.name}</p>{t.subtitle && <p className="truncate text-xs text-muted-foreground">{t.subtitle}</p>}<div className="mt-1 flex flex-wrap gap-1">{t.category && <Badge variant="outline" className="text-[10px]">{t.category}</Badge>}{t.ethnicity && <Badge variant="outline" className="text-[10px]">{t.ethnicity}</Badge>}{t.ageRange && <Badge variant="outline" className="text-[10px]">{t.ageRange}</Badge>}</div><p className="mt-1 line-clamp-2 text-[11px] leading-4 text-muted-foreground">{t.prompt}</p>
          <div className="mt-auto flex items-center gap-1 pt-2"><Button size="xs" disabled={!!busy} onClick={() => void use(t)}><UserPlus data-icon="inline-start" />{busy === t.id ? "Creating…" : "Use as identity"}</Button><Button size="icon-xs" variant="ghost" aria-label={`Remove ${t.name}`} disabled={!!busy} onClick={() => void remove(t)}><Trash2 /></Button></div></div>
      </div>)}</div>}
    </div>}
  </section>;
}
