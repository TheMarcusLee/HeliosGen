"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { DEFAULT_WORKFLOW_METADATA, normalizeWorkflowMetadata, type WorkflowMetadata, type WorkflowProvider } from "@/lib/cloneMe";
import { useWorkflowStore } from "@/lib/store";
import { ShieldCheck } from "lucide-react";

interface Props { open: boolean; onOpenChange: (open: boolean) => void }

export default function WorkflowPolicyDialog({ open, onOpenChange }: Props) {
  const activeSpaceId = useWorkflowStore((state) => state.activeSpaceId);
  const activeMetadata = useWorkflowStore((state) => state.spaces.find((space) => space.id === state.activeSpaceId)?.metadata);
  if (!open) return null;
  return <WorkflowPolicyDialogBody key={activeSpaceId} open={open} onOpenChange={onOpenChange} initial={normalizeWorkflowMetadata(activeMetadata ?? DEFAULT_WORKFLOW_METADATA)} />;
}

function WorkflowPolicyDialogBody({ open, onOpenChange, initial }: Props & { initial: WorkflowMetadata }) {
  const updateWorkflowMetadata = useWorkflowStore((state) => state.updateWorkflowMetadata);
  const [draft, setDraft] = useState<WorkflowMetadata>(initial);

  const rating = draft.contentClass;
  const route = draft.routes[rating];
  const routeMissing = !route?.modelId;
  const updateRoute = (patch: Partial<{ provider: WorkflowProvider; modelId: string }>) => {
    const current = draft.routes[rating] ?? { provider: rating === "adult" ? "wavespeed" : "kie", modelId: "" };
    setDraft((value) => ({ ...value, routes: { ...value.routes, [rating]: { ...current, ...patch } } }));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><ShieldCheck />Workflow routing & safety</DialogTitle>
          <DialogDescription>Content class and provider routing are saved with this workflow and written to each generation ledger entry.</DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel>Content class</FieldLabel>
            <Select value={rating} onValueChange={(value) => setDraft((current) => ({ ...current, contentClass: value === "adult" ? "adult" : "sfw", ...(value === "adult" ? { adultAssurances: current.adultAssurances ?? { allSubjectsAdults: false, consentVerified: false } } : {}) }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectGroup><SelectItem value="sfw">SFW / general</SelectItem><SelectItem value="adult">Adult</SelectItem></SelectGroup></SelectContent>
            </Select>
            <FieldDescription>HeliosGen never guesses adult capability from a model name.</FieldDescription>
          </Field>
          <Field>
            <FieldLabel>{rating === "adult" ? "Adult" : "SFW"} provider route</FieldLabel>
            <Select value={route?.provider ?? (rating === "adult" ? "wavespeed" : "kie")} onValueChange={(value) => updateRoute({ provider: value as WorkflowProvider })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectGroup><SelectItem value="wavespeed">WaveSpeed</SelectItem><SelectItem value="kie">Kie.ai</SelectItem><SelectItem value="comfyui">ComfyUI</SelectItem><SelectItem value="azure">Azure Foundry</SelectItem><SelectItem value="codex">Codex CLI</SelectItem></SelectGroup></SelectContent>
            </Select>
          </Field>
          <Field data-invalid={routeMissing || undefined}>
            <FieldLabel>Exact model ID</FieldLabel>
            <Input value={route?.modelId ?? ""} aria-invalid={routeMissing || undefined} onChange={(event) => updateRoute({ modelId: event.target.value })} placeholder="provider/model or HeliosGen model ID" />
            <FieldDescription>Generation is locked to this exact provider/model pair for auditable routing.</FieldDescription>
          </Field>
          {rating === "adult" && <>
            <Field orientation="horizontal"><FieldLabel htmlFor="all-adults">Every depicted subject is an adult</FieldLabel><Switch id="all-adults" checked={draft.adultAssurances?.allSubjectsAdults ?? false} onCheckedChange={(checked) => setDraft((value) => ({ ...value, adultAssurances: { allSubjectsAdults: checked, consentVerified: value.adultAssurances?.consentVerified ?? false } }))} /></Field>
            <Field orientation="horizontal"><FieldLabel htmlFor="consent">Each real person has consented to this intimate depiction</FieldLabel><Switch id="consent" checked={draft.adultAssurances?.consentVerified ?? false} onCheckedChange={(checked) => setDraft((value) => ({ ...value, adultAssurances: { allSubjectsAdults: value.adultAssurances?.allSubjectsAdults ?? false, consentVerified: checked } }))} /></Field>
            <FieldDescription>Sexual content involving minors and non-consensual intimate imagery is always rejected, regardless of provider.</FieldDescription>
          </>}
        </FieldGroup>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="button" disabled={routeMissing || rating === "adult" && (!draft.adultAssurances?.allSubjectsAdults || !draft.adultAssurances?.consentVerified)} onClick={() => { updateWorkflowMetadata({ ...draft, routingRequired: true }); onOpenChange(false); }}>Save routing</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
