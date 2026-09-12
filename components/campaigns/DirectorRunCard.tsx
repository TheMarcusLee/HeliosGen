"use client";
/* eslint-disable @next/next/no-img-element */
import { useEffect, useState } from "react";
import { Film, ScanEye, Search, Pause, Play, Square, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { DirectorRun, DirectorSource } from "@/lib/campaigns/director/types";
import { motionModel, motionModelSummary } from "@/lib/campaigns/director/motionModels";
import type { Campaign } from "@/lib/campaigns/types";
import { IMAGE_MODELS } from "@/lib/modelConfig";

export function SourceCard({ source, compact = false }: { source: DirectorSource; compact?: boolean }) {
  return <div className="rounded-xl border border-border bg-background/60 p-3">
    <div className="mb-2 flex flex-wrap items-start justify-between gap-2"><a href={source.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 text-sm font-medium underline-offset-4 hover:underline">{source.title}</a><Badge variant={source.selection ? "secondary" : "outline"}>{source.selection ? "Selected" : source.inspection ? source.inspection.suitable ? "Suitable" : "Rejected" : source.status}</Badge></div>
    {source.media && <video src={source.selection?.clip.localUrl ?? source.media.localUrl} controls playsInline preload="metadata" className="max-h-72 w-full rounded-lg bg-black" aria-label={`Source: ${source.title}`} />}
    <p className="mt-2 text-xs text-muted-foreground">{source.metrics?.views != null ? `${source.metrics.views.toLocaleString()} views` : "Views unavailable"}{source.metrics?.likes != null ? ` · ${source.metrics.likes.toLocaleString()} likes` : ""}{source.metrics?.publishedAt ? ` · Published ${new Date(source.metrics.publishedAt).toLocaleDateString()}` : ""}</p>
    {source.metrics && <p className="text-[10px] text-muted-foreground">Retrieved {new Date(source.metrics.checkedAt).toLocaleString()} · Platform metadata</p>}
    {source.error && <p className="mt-2 text-xs text-destructive">{source.error}</p>}
    {source.inspection && <div className="mt-3 space-y-2 text-xs"><div className="flex items-center gap-2"><ScanEye size={14} /><strong>Source fit · {source.inspection.score}/100</strong></div><p>{source.inspection.summary}</p>{!compact && <><p className="text-muted-foreground">{source.inspection.aestheticFit}</p>{source.inspection.issues.map((issue, i) => <p key={i} className="text-muted-foreground">• {issue}</p>)}</>}
      <details><summary className="cursor-pointer text-muted-foreground">Inspect frame evidence</summary><p className="my-2 text-muted-foreground">Sampled visual review; audio and unsampled frames are not evaluated.</p>{source.inspection.observations.map((o, i) => <p key={i} className="mb-1"><strong>{o.second.toFixed(1)}s</strong> · {o.observation}</p>)}{source.media?.sheets.map(url => <a key={url} href={url} target="_blank" rel="noreferrer"><img src={url} alt="Timestamped source frames" className="mt-2 w-full rounded-md" loading="lazy" /></a>)}</details>
    </div>}
    {source.selection && <p className="mt-3 border-t pt-2 text-xs"><strong>{source.selection.start.toFixed(1)}–{source.selection.end.toFixed(1)}s</strong> · {source.selection.direction}</p>}
  </div>;
}
export function DirectorRunCard({ run, campaign, busy, action }: { run: DirectorRun; campaign: Campaign; busy: boolean; action: (body: unknown) => Promise<unknown> }) {
  const needsCandidates = !campaign.identity?.references.length && !!run.identityProposal;
  const [allowance, setAllowance] = useState(Math.min(30, run.reels * (2 + run.stillsPerReel) + 2 + (needsCandidates ? run.identityProposal!.count : 0)));
  const modelName = (id: string) => IMAGE_MODELS.find(m => m.id === id)?.name ?? id;
  const [resolvedMotion, setResolvedMotion] = useState<{ usd: number; basis: string; detail: string }>();
  const clipSeconds = Math.max(5, ...run.sources.filter(s => s.selection).map(s => s.selection!.end - s.selection!.start));
  useEffect(() => {
    if (run.status !== "awaiting_approval") return;
    let cancelled = false;
    fetch(`/api/campaigns/${campaign.id}/estimates?motionModel=${encodeURIComponent(run.videoModel ?? "")}&seconds=${clipSeconds}`, { cache: "no-store" }).then(r => r.json()).then(d => { if (!cancelled && d.motion) setResolvedMotion(d.motion); }).catch(() => {});
    return () => { cancelled = true; };
  }, [run.status, run.videoModel, campaign.id, clipSeconds]);
  const candidates = campaign.assets.filter(a => a.directorId === run.id && a.productionKind === "identity" && a.url);
  const [motionEstimate, setMotionEstimate] = useState("");
  const [reuse, setReuse] = useState(false);
  const last = run.events.at(-1);
  const icon = run.status === "done" ? <Check size={18} /> : <Search size={18} />;
  return <Card className="my-5 border-primary/25 bg-card/70">
    <CardHeader><div className="flex flex-wrap items-center justify-between gap-3"><CardTitle className="flex items-center gap-2">{icon} Research & adapt</CardTitle><Badge variant="outline">{run.status.replaceAll("_", " ")}</Badge></div><CardDescription>{run.reels} Reel{run.reels > 1 ? "s" : ""} · {run.stillsPerReel} matching still{run.stillsPerReel !== 1 ? "s" : ""} per Reel · captions</CardDescription></CardHeader>
    <CardContent className="space-y-4">
      {last && <div role="status" className="rounded-lg bg-muted/40 p-3 text-sm"><p>{last.summary}</p>{last.outcome && <p className="mt-1 text-xs text-muted-foreground">{last.outcome}</p>}</div>}
      {run.error && <p role="alert" className="text-sm text-destructive">{run.error}</p>}
      {!!run.sources.length && <details open={run.status === "awaiting_approval" || run.sources.length <= 2}><summary className="cursor-pointer text-sm font-medium">{run.sources.length} sources · {run.sources.filter(s => s.media).length} retrieved · {run.sources.filter(s => s.selection).length} selected</summary><div className="mt-3 grid gap-3 sm:grid-cols-2">{run.sources.map(s => <SourceCard key={s.id} source={s} />)}</div></details>}
      {run.status === "awaiting_approval" && <div className="space-y-4 rounded-xl border border-primary/20 p-4"><h4 className="flex items-center gap-2 text-sm font-medium"><Film size={16} />Ready for production</h4><p className="text-xs leading-relaxed text-muted-foreground">{{ codex: "OpenAI account images", antigravity: "Google account images", kie: "Kie.ai images" }[campaign.imageProvider ?? "kie"]} → {motionModelSummary(motionModel(run.videoModel))}. The selected clips supply the motion reference. The allowance includes anchors, videos, stills, and corrective generations.</p>
        {run.identityProposal && !campaign.identity?.references.length && <div className="rounded-lg bg-muted/40 p-3 text-xs"><p><strong>Proposed influencer · {run.identityProposal.name}</strong></p><p className="mt-1">{run.identityProposal.dna}</p><p className="mt-1 text-muted-foreground">{run.identityProposal.direction}</p><p className="mt-1 text-muted-foreground">{run.identityProposal.count} reference candidates will be generated first, split across {run.identityProposal.routes.map(r => modelName(r.model)).join(" and ")}; you choose one before any adaptation is produced, and images continue on the winning model.</p></div>}
        {!campaign.identity && !run.identityProposal && <p className="text-xs text-destructive">Select an identity above, or switch to Plan & create to build and save one. Sources will be reassessed against the saved identity.</p>}
        <Field><FieldLabel htmlFor={`allowance-${run.id}`}>Maximum media generations</FieldLabel><Input id={`allowance-${run.id}`} type="number" min={2} max={30} value={allowance} onChange={e => setAllowance(Number(e.target.value))} /></Field>
        <Field><FieldLabel htmlFor={`motion-estimate-${run.id}`}>Estimated cost per motion video, USD</FieldLabel><Input id={`motion-estimate-${run.id}`} type="number" min="0.01" step="0.01" placeholder={resolvedMotion && resolvedMotion.basis !== "unknown" ? `${resolvedMotion.usd.toFixed(3)} · ${resolvedMotion.basis === "actual" ? "observed" : "published"}` : campaign.budget?.maxEstimatedUsd != null ? "Required for your dollar planning limit" : "Optional · based on the selected clip length"} value={motionEstimate} onChange={e => setMotionEstimate(e.target.value)} /></Field>
        <p className="text-xs text-muted-foreground">{resolvedMotion && resolvedMotion.basis !== "unknown" ? `Leave empty to use $${resolvedMotion.usd.toFixed(3)} per motion video (${resolvedMotion.detail}). ` : ""}Estimates reserve the allowance conservatively at the higher image/video cost. Account images use account limits; $0 denotes no separate API estimate. Provider charges may differ.</p>
        <label className="flex items-start gap-2 text-xs leading-relaxed"><input type="checkbox" checked={reuse} onChange={e => setReuse(e.target.checked)} className="mt-0.5" />I can reuse the selected source footage, including its background, for these adaptations.</label>
        <Button disabled={busy || !reuse || (!campaign.identity && !run.identityProposal)} onClick={() => action({ action: "director-approve", runId: run.id, maxGenerations: allowance, ...(motionEstimate ? { motionEstimateUsd: Number(motionEstimate) } : {}), referenceReuseConfirmed: true })}><Play data-icon="inline-start" />Approve bounded production</Button>
      </div>}
      {run.status === "awaiting_identity" && run.identityProposal && <div className="space-y-3 rounded-xl border border-primary/20 p-4"><h4 className="text-sm font-medium">Choose the influencer · {run.identityProposal.name}</h4><p className="text-xs text-muted-foreground">{run.identityProposal.dna}</p><div className="grid grid-cols-2 gap-3 md:grid-cols-4">{candidates.map((a, i) => <figure key={a.id} className="space-y-2"><img src={a.url} alt={a.title} className="aspect-[9/16] w-full rounded-lg object-cover" loading="lazy" /><figcaption className="text-xs text-muted-foreground">{modelName(run.jobs.find(j => j.assetId === a.id)?.route?.model ?? run.imageModel)}</figcaption><Button size="sm" disabled={busy} onClick={() => action({ action: "director-identity", runId: run.id, assetId: a.id })}><Check data-icon="inline-start" />Use candidate {i + 1}</Button></figure>)}</div><p className="text-xs text-muted-foreground">The chosen candidate is saved to Identities and anchors every adaptation in this run. Stop the run if none fit and adjust the brief.</p></div>}
      {["blocked", "paused"].includes(run.status) && !run.jobs.some(j => ["submitting", "running"].includes(j.status)) && <details><summary className="cursor-pointer text-sm">Add guidance and continue</summary><form className="mt-3 space-y-3" onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); void action({ action: "director-reply", runId: run.id, text: String(f.get("guidance")), sourceUrls: String(f.get("links") ?? "").split(/\s+/).filter(Boolean) }); }}><Field><FieldLabel htmlFor={`guidance-${run.id}`}>Your reply</FieldLabel><Textarea id={`guidance-${run.id}`} name="guidance" required maxLength={4000} placeholder="Clarify the direction or explain the new reference…" /></Field>{!run.approval && <Field><FieldLabel htmlFor={`more-sources-${run.id}`}>Additional source links (optional)</FieldLabel><Textarea id={`more-sources-${run.id}`} name="links" placeholder="Direct TikTok/Reel links or uploaded /generated/ video paths" /></Field>}<p className="text-xs text-muted-foreground">Continues with the existing search and production allowances.</p><Button type="submit" size="sm" disabled={busy}>Send guidance & resume</Button></form></details>}
      {run.approval && <p className="text-xs text-muted-foreground">{run.jobs.length}/{run.approval.maxGenerations} authorized generations submitted. {run.status === "done" ? "Visual QA complete. Review the finished assets below before publishing." : "Visual QA and revisions run within this allowance."}</p>}
      <div className="flex flex-wrap gap-2">{run.status === "running" && <Button size="sm" variant="outline" disabled={busy} onClick={() => action({ action: "director-control", runId: run.id, operation: "pause" })}><Pause data-icon="inline-start" />Pause</Button>}{["paused", "blocked"].includes(run.status) && <Button size="sm" variant="outline" disabled={busy || run.jobs.some(j => j.status === "submitting")} onClick={() => action({ action: "director-control", runId: run.id, operation: "resume" })}><Play data-icon="inline-start" />Resume</Button>}{!["done", "stopped"].includes(run.status) && <Button size="sm" variant="ghost" disabled={busy} onClick={() => action({ action: "director-control", runId: run.id, operation: "stop" })}><Square data-icon="inline-start" />Stop</Button>}</div>
      <details className="text-xs"><summary className="cursor-pointer text-muted-foreground">Activity & decisions · {run.events.length}</summary><ol className="mt-3 space-y-3 border-l pl-3">{run.events.map(e => <li key={e.id}><p className="text-[10px] uppercase tracking-wide text-muted-foreground">{new Date(e.at).toLocaleTimeString()} · {e.tool.replaceAll("_", " ")}</p><p className="mt-1">{e.summary}</p>{e.outcome && <p className="mt-1 text-muted-foreground">{e.outcome}</p>}</li>)}</ol></details>
    </CardContent>
  </Card>;
}
