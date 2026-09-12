"use client";
import { useState } from "react";
import { Sparkles, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";
import { TRAIT_FIELDS, traitsToPrompt, type Traits } from "@/lib/identityTraits";

/**
 * Build an identity's locked features from dropdowns, or let the connected
 * account parse a paragraph (or a pasted JSON prompt) into them. Either way
 * the result is one composed base prompt the caller appends to the DNA.
 */
export function TraitBuilder({ onCompose }: { onCompose: (prompt: string, traits: Traits, suggestedName?: string) => void }) {
  const [open, setOpen] = useState(false), [traits, setTraits] = useState<Traits>({}), [description, setDescription] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const preview = traitsToPrompt(traits);
  async function parse() {
    setBusy(true); setError("");
    try {
      const r = await fetch("/api/identity-traits", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ description }) });
      const data = await r.json(); if (!r.ok) throw new Error(data.error);
      setTraits(data.traits); if (data.suggestedName) setTraits(t => ({ ...t, __name: data.suggestedName }));
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const { __name: suggestedName, ...clean } = traits;
  const groups = [["demographics", "Who"], ["face", "Face"], ["skin", "Skin"], ["hair", "Hair"], ["body", "Body"]] as const;
  return <div className="rounded-xl border border-border">
    <button type="button" className="flex w-full items-center gap-2 px-4 py-3 text-left" onClick={() => setOpen(v => !v)}><Wand2 size={15} className="text-primary" /><span className="text-sm font-medium">Build locked features</span><span className="ml-auto font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{open ? "hide" : "show"}</span></button>
    {open && <div className="space-y-4 border-t border-border p-4">
      <p className="text-xs text-muted-foreground">Pick traits from the vocabulary, or describe the person and let your connected account fill the fields. Compose writes one locked-features prompt into the DNA above.</p>
      <div className="flex flex-col gap-2 sm:flex-row"><Textarea rows={2} value={description} onChange={e => setDescription(e.target.value)} placeholder="A striking 27-year-old Nordic woman with platinum blonde waves and piercing blue eyes… or paste a JSON image prompt" /><Button type="button" variant="outline" size="sm" className="shrink-0" disabled={busy || !description.trim()} onClick={() => void parse()}><Sparkles data-icon="inline-start" />{busy ? "Parsing…" : "Parse into traits"}</Button></div>
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      {groups.map(([group, title]) => <div key={group}><p className="mb-2 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{title}</p><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{TRAIT_FIELDS.filter(f => f.group === group).map(f => <label key={f.key} className="flex flex-col gap-1 text-xs"><span className="text-muted-foreground">{f.label}</span>{f.options ? <NativeSelect value={clean[f.key] ?? ""} onChange={e => setTraits(t => { const next = { ...t }; if (e.target.value) next[f.key] = e.target.value; else delete next[f.key]; return next; })}><option value="">—</option>{f.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</NativeSelect> : <Input value={clean[f.key] ?? ""} onChange={e => setTraits(t => { const next = { ...t }; if (e.target.value) next[f.key] = e.target.value; else delete next[f.key]; return next; })} />}</label>)}</div></div>)}
      {preview && <pre className="campaign-error-detail max-h-40 text-[11px]">{preview}</pre>}
      <div className="flex flex-wrap items-center gap-2"><Button type="button" size="sm" disabled={!preview} onClick={() => onCompose(preview, clean, typeof suggestedName === "string" ? suggestedName : undefined)}>Compose into prompt DNA</Button>{suggestedName && <span className="text-xs text-muted-foreground">Suggested name: {suggestedName}</span>}<Button type="button" size="sm" variant="ghost" onClick={() => setTraits({})}>Clear</Button></div>
    </div>}
  </div>;
}
