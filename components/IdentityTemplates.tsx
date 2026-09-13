"use client";
/* eslint-disable @next/next/no-img-element */
import { useCallback, useEffect, useRef, useState } from "react";
import { FileJson, ScanFace, Trash2, UserPlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { NativeSelect } from "@/components/ui/native-select";
import { cn } from "@/lib/utils";
import type { IdentityTemplate } from "@/lib/identityTemplates";
import type { IdentityAsset } from "@/lib/cloneMe";
import { TRAIT_FIELDS } from "@/lib/identityTraits";

const traitLabel = (key: string) => TRAIT_FIELDS.find(f => f.key === key)?.label ?? key.replaceAll("_", " ");
const traitValue = (key: string, value: string) => TRAIT_FIELDS.find(f => f.key === key)?.options?.find(o => o.value === value)?.label.replace(/\s*\(.*\)$/, "") ?? value.replaceAll("-", " ");
const pretty = (value: string | null) => value ? traitValue("ethnicity", value) : null;

/** Starter personas that become identities in one click. Shown inside the identity library, with a reading pane for the selected one. */
export function IdentityTemplates({ onCreated }: { onCreated?: (identity: IdentityAsset) => void }) {
  const [templates, setTemplates] = useState<IdentityTemplate[]>([]), [categories, setCategories] = useState<{ name: string; count: number }[]>([]);
  const [category, setCategory] = useState(""), [gender, setGender] = useState(""), [open, setOpen] = useState(false), [selected, setSelected] = useState<IdentityTemplate>();
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
    try { const r = await fetch("/api/identity-templates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ use: t.id }) }); const data = await r.json(); if (!r.ok) throw new Error(data.error); setNotice(`${t.name} is now an identity. Find it in the library below.`); onCreated?.(data.identity); }
    catch (e) { setError((e as Error).message); } finally { setBusy(undefined); }
  }
  async function remove(t: IdentityTemplate) {
    if (!confirm(`Remove the ${t.name} template? It will not come back on the next start.`)) return;
    await fetch(`/api/identity-templates?id=${t.id}`, { method: "DELETE" }); if (selected?.id === t.id) setSelected(undefined); await refresh();
  }
  const total = categories.reduce((n, c) => n + c.count, 0);
  const facts = (t: IdentityTemplate) => [t.gender && traitValue("gender", t.gender), t.ageRange && traitValue("age_range", t.ageRange), pretty(t.ethnicity)].filter(Boolean) as string[];
  const traitEntries = (t: IdentityTemplate) => Object.entries(t.traits).filter(([k]) => k !== "appearance_details" && k !== "character_style");
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
      <p className="mb-4 text-xs text-muted-foreground">Described personas with a reference image. Select one to read it in full. Using one mirrors the image locally and creates an identity with the description as its base prompt, ready for campaigns. Upload your own as JSON: an array of {"{ name, prompt, imageUrl?, category? }"}, or an App Promo Factory export unchanged.</p>
      {!templates.length ? <p className="text-sm text-muted-foreground">No templates match.</p> : <div className={cn("grid gap-4", selected && "lg:grid-cols-[minmax(0,1fr)_380px]")}>
        <div className={cn("grid gap-3 sm:grid-cols-2", selected ? "lg:grid-cols-2 xl:grid-cols-3" : "lg:grid-cols-3 xl:grid-cols-4")}>{templates.map(t => <button key={t.id} type="button" onClick={() => setSelected(selected?.id === t.id ? undefined : t)} className={cn("flex gap-3 rounded-xl border border-border bg-card p-3 text-left transition-colors hover:border-primary/60", selected?.id === t.id && "border-primary")} aria-pressed={selected?.id === t.id}>
          {t.imageUrl ? <img src={t.imageUrl} alt="" loading="lazy" className="h-28 w-20 shrink-0 rounded-md object-cover" /> : <div className="flex h-28 w-20 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground"><ScanFace size={18} /></div>}
          <div className="flex min-w-0 flex-1 flex-col"><p className="truncate text-sm font-medium">{t.name}</p>{t.subtitle && <p className="truncate text-xs text-muted-foreground">{t.subtitle}</p>}<div className="mt-1 flex flex-wrap gap-1">{t.category && <Badge variant="outline" className="text-[10px]">{t.category}</Badge>}{facts(t).slice(1).map(f => <Badge key={f} variant="outline" className="text-[10px]">{f}</Badge>)}</div><p className="mt-1 line-clamp-2 text-[11px] leading-4 text-muted-foreground">{t.prompt}</p></div>
        </button>)}</div>
        {selected && <aside className="lg:sticky lg:top-6 lg:self-start" aria-label={`${selected.name} details`}>
          <div className="space-y-3 rounded-xl border border-border bg-card p-4">
            <div className="flex items-start justify-between gap-2"><div><h3 className="text-base font-medium">{selected.name}</h3>{selected.subtitle && <p className="text-xs text-muted-foreground">{selected.subtitle}</p>}</div><Button type="button" size="icon-xs" variant="ghost" aria-label="Close details" onClick={() => setSelected(undefined)}><X /></Button></div>
            {selected.imageUrl && <img src={selected.imageUrl} alt={`${selected.name} reference`} className="max-h-[520px] w-full rounded-lg bg-muted object-contain" />}
            <div className="flex flex-wrap gap-1">{selected.category && <Badge variant="outline">{selected.category}</Badge>}{facts(selected).map(f => <Badge key={f} variant="outline">{f}</Badge>)}</div>
            {traitEntries(selected).length > 0 && <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">{traitEntries(selected).map(([k, v]) => <div key={k} className="contents"><dt className="text-muted-foreground">{traitLabel(k)}</dt><dd className="truncate">{traitValue(k, v)}</dd></div>)}</dl>}
            {selected.traits.appearance_details && <p className="text-xs text-muted-foreground">{selected.traits.appearance_details}</p>}
            <div><p className="mb-1 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Persona description</p><pre className="campaign-error-detail max-h-72 text-[11px]">{selected.prompt}</pre></div>
            <div className="flex flex-wrap gap-2"><Button type="button" size="sm" disabled={!!busy} onClick={() => void use(selected)}><UserPlus data-icon="inline-start" />{busy === selected.id ? "Creating…" : "Use as identity"}</Button><Button type="button" size="sm" variant="ghost" disabled={!!busy} onClick={() => void remove(selected)}><Trash2 data-icon="inline-start" />Remove template</Button></div>
          </div>
        </aside>}
      </div>}
    </div>}
  </section>;
}
