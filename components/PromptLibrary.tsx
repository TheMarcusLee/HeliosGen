"use client";
/* eslint-disable @next/next/no-img-element */
import { useCallback, useEffect, useRef, useState } from "react";
import { BookOpen, Copy, FileJson, ImagePlus, Plus, Sparkles, Star, Trash2, Wand2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldLabel } from "@/components/ui/field";
import { NativeSelect } from "@/components/ui/native-select";
import { cn } from "@/lib/utils";
import type { LibraryPrompt } from "@/lib/promptLibrary";
import type { BuildResult } from "@/lib/promptEngineering";

type Stats = { total: number; favorites: number; categories: { name: string; count: number }[] };
type Mode = "describe" | "image" | "enhance" | "remix";
const MODES: { value: Mode; label: string; hint: string }[] = [
  { value: "describe", label: "Describe", hint: "A short brief becomes a full prompt, written in the style of the closest prompts in your library." },
  { value: "image", label: "From image", hint: "A photo is analysed into a VisionStruct record, then written as a structured prompt and as narrative prose." },
  { value: "enhance", label: "Enhance", hint: "A rough prompt is upgraded with skin realism, camera, lighting and fabric language." },
  { value: "remix", label: "Remix", hint: "Change one thing about a library prompt and keep everything else." },
];

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data as T;
}
const excerpt = (p: LibraryPrompt, n = 160) => (p.title?.trim() || p.prompt.replace(/\s+/g, " ")).slice(0, n);

export default function PromptLibrary() {
  const [items, setItems] = useState<LibraryPrompt[]>([]), [total, setTotal] = useState(0), [stats, setStats] = useState<Stats>({ total: 0, favorites: 0, categories: [] });
  const [query, setQuery] = useState(""), [category, setCategory] = useState(""), [favorites, setFavorites] = useState(false);
  const [selected, setSelected] = useState<LibraryPrompt>();
  const [notice, setNotice] = useState(""), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [mode, setMode] = useState<Mode>("describe"), [description, setDescription] = useState(""), [text, setText] = useState(""), [variation, setVariation] = useState(""), [imageUrl, setImageUrl] = useState(""), [base, setBase] = useState<LibraryPrompt>();
  const [result, setResult] = useState<BuildResult & { provider?: string }>(), [view, setView] = useState<"prompt" | "structured" | "prose" | "analysis">("prompt"), [building, setBuilding] = useState(false);
  const importInput = useRef<HTMLInputElement>(null), imageInput = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    const p = new URLSearchParams(); if (query) p.set("q", query); if (category) p.set("category", category); if (favorites) p.set("favorites", "1"); p.set("limit", "120");
    const data = await api<{ items: LibraryPrompt[]; total: number; stats: Stats }>(`/api/prompt-library?${p}`);
    setItems(data.items); setTotal(data.total); setStats(data.stats);
  }, [query, category, favorites]);
  useEffect(() => { const t = setTimeout(() => { void refresh().catch(e => setError((e as Error).message)); }, 150); return () => clearTimeout(t); }, [refresh]);

  async function run<T>(work: () => Promise<T>, done?: string) { setBusy(true); setError(""); setNotice(""); try { const r = await work(); if (done) setNotice(done); await refresh(); return r; } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }
  async function importFile(file: File) {
    await run(async () => { const payload = JSON.parse(await file.text()); const r = await api<{ added: number; updated: number; skipped: number }>("/api/prompt-library", { method: "POST", body: JSON.stringify({ import: payload }) }); setNotice(`Imported ${r.added} prompt${r.added === 1 ? "" : "s"}${r.updated ? `, updated ${r.updated}` : ""}${r.skipped ? `, skipped ${r.skipped} duplicate${r.skipped === 1 ? "" : "s"}` : ""}.`); });
  }
  async function uploadImage(file: File) {
    const dataUrl = await new Promise<string>((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.onerror = () => reject(new Error("Could not read the image.")); r.readAsDataURL(file); });
    const r = await api<{ cdnUrl: string }>("/api/upload", { method: "POST", body: JSON.stringify({ dataUrl, mimeType: file.type, folder: "prompt-library" }) });
    setImageUrl(r.cdnUrl);
  }
  async function build() {
    setBuilding(true); setError(""); setResult(undefined);
    try {
      const body = mode === "describe" ? { mode, description, categories: category ? [category] : [] } : mode === "image" ? { mode, imageUrl } : mode === "enhance" ? { mode, text } : { mode, basePromptId: base?.id, variation };
      const r = await api<BuildResult & { provider: string }>("/api/prompt-library/build", { method: "POST", body: JSON.stringify(body) });
      setResult(r); setView("prompt");
    } catch (e) { setError((e as Error).message); } finally { setBuilding(false); }
  }
  async function saveResult() {
    if (!result) return;
    await run(() => api("/api/prompt-library", { method: "POST", body: JSON.stringify({ prompt: result.prompt, title: mode === "describe" ? description.slice(0, 120) : base?.title ?? null, categories: result.categories, imageUrls: mode === "image" && imageUrl ? [imageUrl] : [], structured: result.structured ?? null, prose: result.prose ?? null, negatives: result.negatives ?? null, analysis: result.analysis ?? null, origin: "built" }) }), "Saved to the library.");
  }
  const copy = (value: string) => { void navigator.clipboard?.writeText(value); setNotice("Copied."); };

  return <main className="relative flex-1 overflow-y-auto bg-background text-foreground">
    <div className="pointer-events-none absolute inset-x-0 top-0 h-80 bg-[radial-gradient(ellipse_at_15%_0%,color-mix(in_oklab,var(--color-primary)_10%,transparent),transparent_55%)]" />
    <div className="relative mx-auto w-full max-w-[1500px] px-5 py-8 md:px-9 md:py-10">
      <header className="grid gap-7 border-b border-border pb-8 lg:grid-cols-[1fr_auto] lg:items-end">
        <div>
          <div className="mb-3 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground"><span className="h-px w-8 bg-primary/60" />Production assets / prompt layer</div>
          <h1 className="max-w-3xl text-3xl font-medium tracking-[-0.035em] sm:text-4xl">Prompts that already look real.<br /><span className="text-muted-foreground">Build the next one from them.</span></h1>
          <p className="mt-4 max-w-2xl text-sm leading-6 text-muted-foreground">Your library of proven prompts stays on this machine. The planner borrows their specificity, and the builder turns a brief, a photo or a rough prompt into the same Reality-First form through your connected account.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <input ref={importInput} type="file" accept="application/json,.json" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) void importFile(f); e.target.value = ""; }} />
          <Button variant="outline" disabled={busy} onClick={() => importInput.current?.click()}><FileJson />Upload prompts (JSON)</Button>
          <Button disabled={busy} onClick={() => setAdding(true)}><Plus />Add prompt</Button>
        </div>
      </header>
      <section className="grid border-x border-b border-border sm:grid-cols-3" aria-label="Prompt library summary">
        {[{ value: stats.total, label: "Prompts in the library", Icon: BookOpen }, { value: stats.favorites, label: "Favorites", Icon: Star }, { value: stats.categories.length, label: "Categories", Icon: Sparkles }].map(({ value, label, Icon }, index) => <div key={label} className={cn("flex items-center gap-4 px-5 py-4", index > 0 && "border-t border-border sm:border-l sm:border-t-0")}><Icon className="size-4 text-muted-foreground" strokeWidth={1.4} /><strong className="font-mono text-xl font-medium tracking-tight">{String(value).padStart(2, "0")}</strong><span className="text-xs text-muted-foreground">{label}</span></div>)}
      </section>
      {(notice || error) && <p role={error ? "alert" : "status"} className={cn("mt-4 text-sm", error ? "text-destructive" : "text-muted-foreground")}>{error || notice}</p>}

      {adding && <form className="mt-6 space-y-3 rounded-xl border border-border p-4" onSubmit={async e => { e.preventDefault(); const f = new FormData(e.currentTarget); await run(() => api("/api/prompt-library", { method: "POST", body: JSON.stringify({ title: String(f.get("title") || "") || null, prompt: String(f.get("prompt") || ""), categories: String(f.get("categories") || "").split(",").map(s => s.trim()).filter(Boolean) }) }), "Prompt added."); setAdding(false); }}>
        <Field><FieldLabel htmlFor="new-title">Title (optional)</FieldLabel><Input id="new-title" name="title" maxLength={200} /></Field>
        <Field><FieldLabel htmlFor="new-prompt">Prompt</FieldLabel><Textarea id="new-prompt" name="prompt" rows={6} required maxLength={20000} /></Field>
        <Field><FieldLabel htmlFor="new-categories">Categories, comma separated</FieldLabel><Input id="new-categories" name="categories" placeholder="influencer, selfie, warm lighting" /></Field>
        <div className="flex gap-2"><Button type="submit" size="sm" disabled={busy}>Save</Button><Button type="button" size="sm" variant="ghost" onClick={() => setAdding(false)}>Cancel</Button></div>
      </form>}

      <section className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-4">
          <div className="rounded-xl border border-border p-4">
            <div className="flex flex-wrap items-center gap-2"><Wand2 size={16} className="text-primary" /><h2 className="text-sm font-medium">Prompt builder</h2><span className="text-xs text-muted-foreground">· runs on your connected Google or OpenAI account</span></div>
            <div className="mt-3 flex flex-wrap gap-1">{MODES.map(m => <button key={m.value} type="button" onClick={() => { setMode(m.value); setResult(undefined); }} className={cn("rounded-lg border px-3 py-1.5 text-xs transition-colors", mode === m.value ? "border-primary/60 bg-primary/10 text-foreground" : "border-border text-muted-foreground hover:text-foreground")}>{m.label}</button>)}</div>
            <p className="mt-2 text-xs text-muted-foreground">{MODES.find(m => m.value === mode)!.hint}</p>
            <div className="mt-3 space-y-3">
              {mode === "describe" && <Textarea rows={3} value={description} onChange={e => setDescription(e.target.value)} placeholder="Woman in cream pajamas on a couch, warm lamp light, phone selfie" />}
              {mode === "enhance" && <Textarea rows={5} value={text} onChange={e => setText(e.target.value)} placeholder="Paste a rough prompt" />}
              {mode === "image" && <div className="flex flex-wrap items-center gap-3"><input ref={imageInput} type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) void uploadImage(f).catch(err => setError((err as Error).message)); e.target.value = ""; }} /><Button type="button" variant="outline" size="sm" onClick={() => imageInput.current?.click()}><ImagePlus />Choose image</Button><Input className="max-w-md" value={imageUrl} onChange={e => setImageUrl(e.target.value)} placeholder="or paste an HTTPS image URL" />{imageUrl && <img src={imageUrl} alt="Reference" className="h-16 w-12 rounded object-cover" />}</div>}
              {mode === "remix" && <div className="space-y-2"><p className="text-xs text-muted-foreground">{base ? <>Base: <strong>{excerpt(base, 100)}</strong> <Button type="button" size="xs" variant="ghost" onClick={() => setBase(undefined)}>Change</Button></> : "Pick a prompt from the library below, then say what should change."}</p><Textarea rows={2} value={variation} onChange={e => setVariation(e.target.value)} placeholder="Same shot, but a black satin slip dress and a rooftop at dusk" /></div>}
              <Button type="button" size="sm" disabled={building || (mode === "describe" && !description.trim()) || (mode === "enhance" && !text.trim()) || (mode === "image" && !imageUrl) || (mode === "remix" && (!base || !variation.trim()))} onClick={() => void build()}><Sparkles data-icon="inline-start" />{building ? "Building…" : "Build prompt"}</Button>
            </div>
            {result && <div className="mt-4 space-y-3 border-t border-border pt-4">
              <div className="flex flex-wrap items-center gap-1">{(["prompt", "structured", "prose", "analysis"] as const).filter(v => v === "prompt" || result[v]).map(v => <button key={v} type="button" onClick={() => setView(v)} className={cn("rounded-md px-2.5 py-1 text-xs", view === v ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground")}>{{ prompt: "Prompt", structured: "Structured JSON", prose: "Narrative prose", analysis: "Analysis" }[v]}</button>)}<span className="ml-auto text-xs text-muted-foreground">{result.provider === "antigravity" ? "Google account" : "OpenAI account"}</span></div>
              <pre className="campaign-error-detail max-h-[420px] text-[11px]">{view === "prompt" ? result.prompt : view === "prose" ? result.prose : JSON.stringify(result[view], null, 2)}</pre>
              {result.negatives && view !== "analysis" && <p className="text-xs text-muted-foreground"><strong>Avoid:</strong> {result.negatives}</p>}
              {!!result.categories.length && <div className="flex flex-wrap gap-1">{result.categories.map(c => <Badge key={c} variant="outline">{c}</Badge>)}</div>}
              <div className="flex flex-wrap gap-2"><Button type="button" size="sm" disabled={busy} onClick={() => void saveResult()}><Plus data-icon="inline-start" />Save to library</Button><Button type="button" size="sm" variant="outline" onClick={() => copy(view === "prompt" ? result.prompt : view === "prose" ? result.prose ?? "" : JSON.stringify(result[view], null, 2))}><Copy data-icon="inline-start" />Copy</Button></div>
            </div>}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Input className="max-w-xs" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search prompts" aria-label="Search prompts" />
            <NativeSelect className="w-auto" value={category} onChange={e => setCategory(e.target.value)} aria-label="Category"><option value="">All categories</option>{stats.categories.slice(0, 40).map(c => <option key={c.name} value={c.name}>{c.name} · {c.count}</option>)}</NativeSelect>
            <Button type="button" size="sm" variant={favorites ? "secondary" : "outline"} onClick={() => setFavorites(v => !v)}><Star data-icon="inline-start" />Favorites</Button>
            <span className="text-xs text-muted-foreground">{total} shown</span>
          </div>
          {!items.length ? <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">{stats.total ? "No prompts match." : "Upload a JSON export or add your first prompt. Each entry needs a prompt; title, categories and image URLs are optional."}</div>
          : <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{items.map(p => <button key={p.id} type="button" onClick={() => setSelected(p)} className={cn("group flex gap-3 rounded-xl border border-border bg-card p-3 text-left transition-colors hover:border-primary/60", selected?.id === p.id && "border-primary")}>
            {p.imageUrls[0] ? <img src={p.imageUrls[0]} alt="" loading="lazy" className="h-24 w-[72px] shrink-0 rounded-md object-cover" /> : <div className="flex h-24 w-[72px] shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground"><BookOpen size={18} /></div>}
            <div className="min-w-0 flex-1"><p className="line-clamp-3 text-xs leading-5">{excerpt(p, 220)}</p><div className="mt-2 flex flex-wrap gap-1">{p.favorite && <Star size={12} className="text-primary" />}{p.categories.slice(0, 3).map(c => <Badge key={c} variant="outline" className="text-[10px]">{c}</Badge>)}</div></div>
          </button>)}</div>}
        </div>

        <aside className="lg:sticky lg:top-6 lg:self-start">{selected ? <div className="space-y-3 rounded-xl border border-border bg-card p-4">
          <div className="flex items-start justify-between gap-2"><h3 className="text-sm font-medium">{selected.title || "Untitled prompt"}</h3><Button type="button" size="icon-xs" variant="ghost" aria-label="Close" onClick={() => setSelected(undefined)}><X /></Button></div>
          {selected.imageUrls[0] && <img src={selected.imageUrls[0]} alt="" className="max-h-72 w-full rounded-lg object-contain bg-muted" />}
          <div className="flex flex-wrap gap-1">{selected.categories.map(c => <Badge key={c} variant="outline">{c}</Badge>)}</div>
          <pre className="campaign-error-detail max-h-80 text-[11px]">{selected.prompt}</pre>
          {selected.prose && <details className="text-xs"><summary className="cursor-pointer text-muted-foreground">Narrative prose</summary><pre className="campaign-error-detail max-h-60 text-[11px]">{selected.prose}</pre></details>}
          {selected.source && <p className="truncate text-xs text-muted-foreground">Source: {selected.source}</p>}
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => copy(selected.prompt)}><Copy data-icon="inline-start" />Copy</Button>
            <Button type="button" size="sm" variant="outline" onClick={() => { setMode("remix"); setBase(selected); setResult(undefined); window.scrollTo({ top: 0, behavior: "smooth" }); }}><Wand2 data-icon="inline-start" />Remix</Button>
            <Button type="button" size="sm" variant="outline" onClick={() => { setMode("enhance"); setText(selected.prompt); setResult(undefined); window.scrollTo({ top: 0, behavior: "smooth" }); }}><Sparkles data-icon="inline-start" />Enhance</Button>
            <Button type="button" size="sm" variant={selected.favorite ? "secondary" : "outline"} disabled={busy} onClick={() => void run(async () => { await api("/api/prompt-library", { method: "PATCH", body: JSON.stringify({ id: selected.id, favorite: !selected.favorite }) }); setSelected({ ...selected, favorite: !selected.favorite }); })}><Star data-icon="inline-start" />{selected.favorite ? "Favorited" : "Favorite"}</Button>
            <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => { if (confirm("Delete this prompt from the library?")) void run(async () => { await api(`/api/prompt-library?id=${selected.id}`, { method: "DELETE" }); setSelected(undefined); }, "Prompt deleted."); }}><Trash2 data-icon="inline-start" />Delete</Button>
          </div>
        </div> : <div className="rounded-xl border border-dashed border-border p-6 text-sm text-muted-foreground">Select a prompt to read it in full, copy it, favorite it, or send it to the builder.</div>}</aside>
      </section>
    </div>
  </main>;
}
