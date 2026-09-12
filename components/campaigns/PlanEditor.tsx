"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldLabel } from "@/components/ui/field";
import type { CreativePlan } from "@/lib/campaigns/types";

/** Edit the brief of a plan before generating: the identity draft and each step's prompt and look. */
export function PlanEditor({ plan, busy, onSave, imageModel }: { plan: CreativePlan; busy: boolean; imageModel?: string; onSave: (patch: { identityDraft?: CreativePlan["identityDraft"]; steps: { title: string; prompt: string; look: string }[] }) => Promise<unknown> }) {
  const [open, setOpen] = useState(false);
  const [enhancing, setEnhancing] = useState<number>(), [enhanceError, setEnhanceError] = useState("");
  /** Rewrite one step through the Reality-First builder in the form the campaign's image model reads best. */
  async function enhance(i: number) {
    setEnhancing(i); setEnhanceError("");
    try {
      const response = await fetch("/api/prompt-library/build", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "enhance", text: steps[i].prompt, model: imageModel ?? "" }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      update(i, { prompt: data.prompt });
    } catch (e) { setEnhanceError((e as Error).message); } finally { setEnhancing(undefined); }
  }
  const [draft, setDraft] = useState(plan.identityDraft);
  const [steps, setSteps] = useState(plan.steps.map(s => ({ title: s.title, prompt: s.prompt, look: s.look })));
  const update = (i: number, patch: Partial<{ title: string; prompt: string; look: string }>) => setSteps(list => list.map((s, j) => j === i ? { ...s, ...patch } : s));
  if (!open) return <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setOpen(true)}>Edit brief before generating</Button>;
  return <form className="space-y-4 rounded-xl border border-border p-4" onSubmit={e => { e.preventDefault(); void onSave({ ...(draft ? { identityDraft: draft } : {}), steps }).then(() => setOpen(false)); }}>
    {draft && <div className="space-y-3"><p className="text-xs font-medium">Influencer</p>
      <Field><FieldLabel htmlFor="plan-identity-name">Name</FieldLabel><Input id="plan-identity-name" value={draft.name} maxLength={120} required onChange={e => setDraft({ ...draft, name: e.target.value })} /></Field>
      <Field><FieldLabel htmlFor="plan-identity-dna">Look and features</FieldLabel><Textarea id="plan-identity-dna" rows={5} value={draft.dna} maxLength={4000} required onChange={e => setDraft({ ...draft, dna: e.target.value })} /><p className="text-xs text-muted-foreground">Skin tone, face, eyes, hair, age range, body. Every direction is generated from this.</p></Field>
      <Field><FieldLabel htmlFor="plan-identity-personality">Personality</FieldLabel><Input id="plan-identity-personality" value={draft.personality} maxLength={2000} onChange={e => setDraft({ ...draft, personality: e.target.value })} /></Field>
    </div>}
    <div className="space-y-3"><p className="text-xs font-medium">Steps</p>
      {steps.map((s, i) => <div key={i} className="space-y-2 rounded-lg bg-muted/40 p-3"><Field><FieldLabel htmlFor={`plan-step-title-${i}`}>{i + 1} · {plan.steps[i].kind}</FieldLabel><Input id={`plan-step-title-${i}`} value={s.title} maxLength={120} required onChange={e => update(i, { title: e.target.value })} /></Field>
        <Field><FieldLabel htmlFor={`plan-step-prompt-${i}`}>{plan.steps[i].kind === "text" ? "Caption" : "Prompt"}</FieldLabel><Textarea id={`plan-step-prompt-${i}`} rows={3} value={s.prompt} maxLength={8000} required onChange={e => update(i, { prompt: e.target.value })} />{plan.steps[i].kind !== "text" && <div className="flex items-center gap-2"><Button type="button" size="xs" variant="ghost" disabled={busy || enhancing !== undefined} onClick={() => void enhance(i)}>{enhancing === i ? "Enhancing…" : "Enhance with Reality-First"}</Button><span className="text-xs text-muted-foreground">Adds skin realism, camera, lighting and fabric detail through your connected account.</span></div>}</Field>
        {plan.steps[i].kind !== "text" && <Field><FieldLabel htmlFor={`plan-step-look-${i}`}>Wardrobe, styling and setting</FieldLabel><Textarea id={`plan-step-look-${i}`} rows={2} value={s.look} maxLength={2000} onChange={e => update(i, { look: e.target.value })} /></Field>}
      </div>)}
    </div>
    {enhanceError && <p role="alert" className="text-xs text-destructive">{enhanceError}</p>}
    <div className="flex gap-2"><Button type="submit" size="sm" disabled={busy}>Save brief</Button><Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => { setDraft(plan.identityDraft); setSteps(plan.steps.map(s => ({ title: s.title, prompt: s.prompt, look: s.look }))); setOpen(false); }}>Cancel</Button></div>
  </form>;
}
