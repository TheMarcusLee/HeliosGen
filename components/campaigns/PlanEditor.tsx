"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldLabel } from "@/components/ui/field";
import type { CreativePlan } from "@/lib/campaigns/types";

/** Edit the brief of a plan before generating: the identity draft and each step's prompt and look. */
export function PlanEditor({ plan, busy, onSave }: { plan: CreativePlan; busy: boolean; onSave: (patch: { identityDraft?: CreativePlan["identityDraft"]; steps: { title: string; prompt: string; look: string }[] }) => Promise<unknown> }) {
  const [open, setOpen] = useState(false);
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
        <Field><FieldLabel htmlFor={`plan-step-prompt-${i}`}>{plan.steps[i].kind === "text" ? "Caption" : "Prompt"}</FieldLabel><Textarea id={`plan-step-prompt-${i}`} rows={3} value={s.prompt} maxLength={8000} required onChange={e => update(i, { prompt: e.target.value })} /></Field>
        {plan.steps[i].kind !== "text" && <Field><FieldLabel htmlFor={`plan-step-look-${i}`}>Wardrobe, styling and setting</FieldLabel><Textarea id={`plan-step-look-${i}`} rows={2} value={s.look} maxLength={2000} onChange={e => update(i, { look: e.target.value })} /></Field>}
      </div>)}
    </div>
    <div className="flex gap-2"><Button type="submit" size="sm" disabled={busy}>Save brief</Button><Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => { setDraft(plan.identityDraft); setSteps(plan.steps.map(s => ({ title: s.title, prompt: s.prompt, look: s.look }))); setOpen(false); }}>Cancel</Button></div>
  </form>;
}
