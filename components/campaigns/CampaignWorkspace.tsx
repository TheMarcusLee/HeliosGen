"use client";
/* eslint-disable @next/next/no-img-element */
import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowUp, Check, ChevronRight, Download, Film, Images, LoaderCircle, Paperclip, Pause, Play, Plus, ScanFace, Sparkles, Workflow, X } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription, EmptyMedia } from "@/components/ui/empty";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { campaignRequest, useCampaignStore } from "@/lib/campaigns/client";
import type { Campaign, CampaignAsset, CampaignMessage } from "@/lib/campaigns/types";
import type { IdentityAsset } from "@/lib/cloneMe";
import { MODELS } from "@/lib/models";
import { IMAGE_MODELS, VIDEO_MODELS } from "@/lib/modelConfig";
import { useChatSessionStore } from "@/lib/chatSessionStore";
import { loadAzureBaseUrl, loadAzureTextDeployment, loadAzureTextModelName } from "@/components/SettingsModal";
import LegacyChat from "./LegacyChat";
import { cn } from "@/lib/utils";

import { ANTIGRAVITY_CHAT_MODEL, CODEX_CHAT_MODEL, ACCOUNT_IMAGE_MODEL, campaignDefaults, type AccountCapabilities } from "@/lib/campaigns/providers";
import DotCanvasBackground from "@/components/ui/DotCanvasBackground";
import TypewriterHeading from "@/components/ui/TypewriterHeading";
import { BrandWordmark } from "@/components/Brand";

import { DirectorRunCard, SourceCard } from "./DirectorRunCard";
import { directorBusy } from "@/lib/campaigns/director/types";
import { DEFAULT_MOTION_MODEL, MOTION_MODELS, motionModelSummary } from "@/lib/campaigns/director/motionModels";
import type { Capture } from "@/lib/campaigns/captures";
import { ExtensionInstall } from "./ExtensionInstall";
import { CampaignControls } from "./CampaignControls";
import { quotePlan, budgetUsage } from "@/lib/campaigns/operations";

const starters = [
  { icon: ScanFace, title: "Build an influencer", description: "A new identity, from the first idea.", prompt: "Help me build a new influencer. Develop a distinctive adult lifestyle creator with a warm personality and an outdoorsy aesthetic. Propose reference directions so I can choose a favorite." },
  { icon: Film, title: "Dance trend, new influencer", description: "Find a trending dance and design a creator to fit it.", prompt: "Find a trending dance video to use as a reference, and create an Instagram-ready influencer to recreate the video with." },
  { icon: Film, title: "Research & adapt Reels", description: "Find real footage. Inspect it. Make it yours.", prompt: "Find currently performing TikToks or Reels that fit my influencer. Retrieve and compare the actual footage, choose a clear continuous motion reference, and create an adaptation with matching stills and a caption." },
  { icon: Sparkles, title: "Explore a campaign", description: "Turn a loose idea into a creative direction.", prompt: "Help me shape a new campaign. Let's develop the audience, creative direction, and content concepts before generating anything." },
];

function Media({ asset, compact = false }: { asset: CampaignAsset; compact?: boolean }) {
  if (asset.kind === "text") return <p className={cn("whitespace-pre-wrap text-sm leading-relaxed", compact && "line-clamp-5")}>{asset.text}</p>;
  if (asset.kind === "video") return <video src={asset.url} controls={!compact} muted={compact} playsInline preload="metadata" className="campaign-media" aria-label={asset.title} />;
  return <img src={asset.url} alt={asset.title} loading="lazy" className="campaign-media" />;
}

export function CampaignWorkspace() {
  const id = useSearchParams().get("id");
  return <CampaignSession key={id ?? "new"} id={id} />;
}

function CampaignSession({ id }: { id: string | null }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [controlsOpen, setControlsOpen] = useState(searchParams.get("controls") === "memory");
  const [controlsTab, setControlsTab] = useState("memory");
  const [directorMode, setDirectorMode] = useState(false);
  const [searchProvider, setSearchProvider] = useState("tiktok");
  const [motionModel, setMotionModel] = useState<string>();
  const [captures, setCaptures] = useState<Capture[]>([]);
  const [sourceLinks, setSourceLinks] = useState("");
  const [reelCount, setReelCount] = useState(1);
  const [stillCount, setStillCount] = useState(1);
  const sourceUpload = useRef<HTMLInputElement>(null);
  const [revisionOf, setRevisionOf] = useState<string>();
  const campaign = useCampaignStore(s => id ? s.records[id] : undefined);
  const setCampaign = useCampaignStore(s => s.setCampaign);
  const legacy = useChatSessionStore(s => s.sessions.some(session => session.id === id));
  const [input, setInput] = useState(() => useCampaignStore.getState().drafts[id ?? ""] ?? "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [identities, setIdentities] = useState<IdentityAsset[]>([]);
  const [identityId, setIdentityId] = useState("");
  const [model, setModel] = useState<string | undefined>();
  const [account, setAccount] = useState<AccountCapabilities>();
  const [google, setGoogle] = useState<AccountCapabilities>();
  const defaultModel = campaignDefaults(account ?? { chatReady: false, imageReady: false }, google).model;
  useEffect(() => {
    let cancelled = false;
    const refresh = () => { fetch("/api/settings/codex-status").then(r => r.json()).then(status => { if (!cancelled) setAccount(status); }).catch(() => {}); fetch("/api/settings/antigravity-status").then(r => r.json()).then(status => { if (!cancelled) setGoogle(status); }).catch(() => {}); };
    void refresh();
    window.addEventListener("focus", refresh);
    const timer = setInterval(refresh, 30000);
    return () => { cancelled = true; clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, []);
  const [selectedId, setSelectedId] = useState<string>();
  useEffect(() => {
    if (!directorMode) return;
    let cancelled = false;
    fetch("/api/campaigns/captures", { cache: "no-store" }).then(r => r.json()).then(data => { if (!cancelled) setCaptures((data.captures ?? []).filter((c: Capture) => c.mediaType === "video")); }).catch(() => {});
    return () => { cancelled = true; };
  }, [directorMode, campaign?.updatedAt]);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [references, setReferences] = useState<string[]>([]);
  const [filter, setFilter] = useState("all");
  const composer = useRef<HTMLTextAreaElement>(null);
  const upload = useRef<HTMLInputElement>(null);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    if (!id || legacy) return;
    campaignRequest(`/${id}`).then(({ campaign: c }) => { if (!cancelled) setCampaign(c); }).catch(e => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [id, legacy, setCampaign]);
  useEffect(() => {
    const media = window.matchMedia("(min-width: 1280px)");
    const update = () => setGalleryOpen(media.matches);
    const timer = setTimeout(update, 0);
    media.addEventListener("change", update);
    return () => { clearTimeout(timer); media.removeEventListener("change", update); };
  }, []);
  useEffect(() => {
    fetch("/api/identities").then(r => r.json()).then(data => setIdentities(data.identities ?? [])).catch(() => {});
  }, [campaign?.identity?.id]);
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [campaign?.messages.length]);

  const active = !!campaign && directorBusy(campaign) || !!campaign?.planning || !!campaign?.runs.some(r => r.status === "running" || r.status === "paused");
  const selected = campaign?.assets.find(a => a.id === selectedId);

  async function action(body: unknown, targetId = id) {
    if (!targetId) return;
    setBusy(true); setError("");
    try {
      const { campaign: c } = await campaignRequest(`/${targetId}`, body);
      setCampaign(c);
      return c as Campaign;
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  async function send() {
    if (!input.trim() || busy || active) return;
    const text = input.trim();
    setBusy(true); setError("");
    let targetId = id;
    try {
      if (!targetId) {
        const result = await campaignRequest("", {});
        let c: Campaign = result.campaign;
        targetId = c.id;
        c = (await campaignRequest(`/${targetId}`, { action: "settings", ...(model ? { model } : {}), referenceUrls: references })).campaign;
        if (identityId) c = (await campaignRequest(`/${targetId}`, { action: "identity", identityId })).campaign;
        setCampaign(c);
        router.replace(`/chat?id=${targetId}`);
      }
      setInput(""); setRevisionOf(undefined); useCampaignStore.getState().setDraft(targetId!, "");
      const promise = campaignRequest(`/${targetId}`, directorMode ? { action: "director-start", objective: text, revisionOf, searchProvider, videoModel: motionModel ?? campaign?.motionModel ?? DEFAULT_MOTION_MODEL, sourceUrls: sourceLinks.split(/\s+/).filter(Boolean), reels: reelCount, stillsPerReel: stillCount } : { action: "message", text, revisionOf, azureConfig: { azureEndpoint: loadAzureBaseUrl(), azureDeployment: loadAzureTextDeployment(), azureModelName: loadAzureTextModelName() } });
      // Show the user's turn immediately; the server is the durable source.
      const current = useCampaignStore.getState().records[targetId!];
      if (current) setCampaign({ ...current, planning: true, messages: [...current.messages, { id: `pending-${Date.now()}`, role: "user", content: text, createdAt: Date.now() }] });
      const { campaign: c } = await promise;
      setCampaign(c);
    } catch (e) {
      setError((e as Error).message);
      if (targetId) campaignRequest(`/${targetId}`).then(({ campaign: c }) => setCampaign(c)).catch(() => {});
    } finally { setBusy(false); }
  }

  async function attach(file?: File) {
    if (!file) return;
    if (!file.type.startsWith("image/")) { setError("Attach an image reference."); return; }
    if (file.size > 15 * 1024 * 1024) { setError("Choose an image smaller than 15 MB."); return; }
    const currentRefs = campaign?.referenceUrls ?? references;
    if (currentRefs.length >= 8) { setError("A campaign can use up to eight reference images."); return; }
    const originId = id;
    setBusy(true); setError("");
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(file); });
      const response = await fetch("/api/upload", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dataUrl, mimeType: file.type }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      const next = [...currentRefs, data.cdnUrl];
      if (originId) await action({ action: "settings", referenceUrls: next }, originId);
      else setReferences(next);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  async function reuseIdentity() {
    if (!campaign?.identity) return;
    setBusy(true);
    try {
      const { campaign: fresh } = await campaignRequest("", {});
      const { campaign: c } = await campaignRequest(`/${fresh.id}`, { action: "identity", identityId: campaign.identity.id });
      setCampaign(c); router.push(`/chat?id=${c.id}`);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  function chooseAsset(asset: CampaignAsset) { setSelectedId(asset.id); setGalleryOpen(true); }
  function jumpToAsset(asset: CampaignAsset) {
    document.getElementById(`asset-${asset.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    setSelectedId(asset.id);
  }

  function renderPlan(message: CampaignMessage) {
    const plan = message.plan;
    if (!plan?.steps.length || !campaign) return null;
    const run = campaign.runs.find(r => r.messageId === message.id);
    const latest = campaign.messages.filter(m => m.plan?.steps.length).at(-1)?.id === message.id;
    const quote = quotePlan(campaign, plan);
    const mediaCount = quote.mediaCount;
    return <Card className="mt-5">
      <CardHeader><CardDescription>{plan.identityDraft ? "IDENTITY EXPLORATION" : "PRODUCTION PLAN"}</CardDescription><CardTitle>{plan.title}</CardTitle></CardHeader>
      <CardContent className="flex flex-col gap-4">
        {plan.identityDraft && <div className="campaign-dna"><ScanFace size={18} /><div><strong>{plan.identityDraft.name}</strong><p>{plan.identityDraft.dna}</p></div></div>}
        {!!plan.assumptions.length && <details className="text-sm text-muted-foreground"><summary className="cursor-pointer">Creative assumptions</summary><ul className="mt-2 flex list-disc flex-col gap-1 pl-4">{plan.assumptions.map((a, i) => <li key={i}>{a}</li>)}</ul></details>}
        <ol className="flex flex-col gap-3">{plan.steps.map((step, index) => {
          const status = run?.steps[index];
          return <li key={index} className="campaign-step"><span className="campaign-step-number">{status?.status === "done" ? <Check size={14} /> : index + 1}</span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><strong>{step.title}</strong><Badge variant="outline">{status?.status ?? step.kind}</Badge></div><p className="text-xs text-muted-foreground">{step.pack} · {step.kind === "text" ? "Caption / copy" : `${step.aspectRatio} · ${step.kind === "video" ? "5 seconds" : "Image"}`}</p>{step.look && <p className="mt-1 text-xs text-muted-foreground">{step.look}</p>}<details className="mt-1 text-xs text-muted-foreground"><summary className="cursor-pointer">View brief</summary><p className="mt-2 whitespace-pre-wrap">{step.prompt}</p></details>{status?.error && <p role="alert" className="mt-2 text-sm text-destructive">{status.error}</p>}</div></li>;
        })}</ol>
      </CardContent>
      <CardFooter className="flex flex-col items-stretch gap-3">
        {!run ? <><p className="text-xs text-muted-foreground">{mediaCount} generation{mediaCount === 1 ? "" : "s"} using the providers shown below. {quote.unknown ? "Some costs are unpriced." : `Estimated API allocation: $${quote.estimatedUsd.toFixed(2)}.`} {quote.reason ?? "Review the plan before starting."}</p><Button disabled={busy || active || !latest || !!quote.reason} onClick={() => action({ action: "start", messageId: message.id })}><Play data-icon="inline-start" />{latest ? "Generate this plan" : "Superseded by a newer plan"}</Button></> : <div className="flex flex-wrap items-center gap-2"><Badge variant="secondary">{run.status === "done" ? "Ready for your review" : run.status}</Badge>{(run.status === "running" || run.status === "paused") && <><Button size="sm" variant="outline" disabled={busy} onClick={() => action({ action: "run", runId: run.id, operation: run.status === "running" ? "pause" : "resume" })}>{run.status === "running" ? <Pause data-icon="inline-start" /> : <Play data-icon="inline-start" />}{run.status === "running" ? "Pause after current job" : "Resume"}</Button><Button size="sm" variant="ghost" disabled={busy || run.steps.some(s => s.status === "running" || s.status === "submitting")} onClick={() => action({ action: "run", runId: run.id, operation: "stop" })}>Stop</Button></>}{(run.status === "done" || run.status === "error") && <Link href={`/workflow/${run.workflowId}`} className={buttonVariants({ variant: "outline", size: "sm" })}><Workflow data-icon="inline-start" />Open in canvas</Link>}</div>}
      </CardFooter>
    </Card>;
  }

  if (legacy) return <LegacyChat />;
  if (id && !campaign && !error) return <div className="flex flex-1 items-center justify-center gap-3 text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />Opening campaign…</div>;

  const visibleAssets = (campaign?.assets ?? []).filter(a => filter === "all" || a.kind === filter || (filter === "approved" && a.review === "approved"));
  const packs = [...new Set(visibleAssets.map(a => a.pack))];
  const refs = campaign?.referenceUrls ?? references;

  return <div className="campaign-workspace">
    {campaign && <CampaignControls campaign={campaign} open={controlsOpen} onOpenChange={setControlsOpen} initialTab={controlsTab} />}
    <header className="campaign-header">
      <div className="min-w-0"><p className="campaign-eyebrow">CREATIVE WORKSPACE</p>{campaign ? <input aria-label="Campaign title" key={`${campaign.id}-${campaign.title}`} defaultValue={campaign.title} disabled={active || busy} className="campaign-title-input" onBlur={e => { const title = e.target.value.trim(); if (title && title !== campaign.title) void action({ action: "settings", title }); }} onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); }} /> : <h1>New campaign</h1>}</div>
      <div className="flex items-center gap-2"><Button variant="outline" size="sm" disabled={busy} onClick={async () => { if (campaign) { setControlsTab("memory"); setControlsOpen(true); } else { setBusy(true); try { const { campaign: fresh } = await campaignRequest("", {}); let c = (await campaignRequest(`/${fresh.id}`, { action: "settings", referenceUrls: references, ...(model ? { model } : {}) })).campaign; if (identityId) c = (await campaignRequest(`/${c.id}`, { action: "identity", identityId })).campaign; useCampaignStore.getState().setDraft(c.id, input); setCampaign(c); router.push(`/chat?id=${c.id}&controls=memory`); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } } }}>Campaign controls</Button><Button variant="ghost" size="sm" onClick={() => router.push("/chat")}><Plus data-icon="inline-start" />New chat</Button><Button variant="outline" size="sm" aria-expanded={galleryOpen} onClick={() => setGalleryOpen(v => !v)}><Images data-icon="inline-start" />Session gallery <Badge variant="secondary">{campaign?.assets.length ?? 0}</Badge></Button></div>
    </header>
    <div className="campaign-body">
      <main className="campaign-conversation">
        <div className="campaign-context">
          <ScanFace size={16} className="shrink-0 text-muted-foreground" />
          <label className="sr-only" htmlFor="campaign-identity">Campaign identity</label>
          <select id="campaign-identity" value={campaign?.identity?.id ?? (campaign ? "" : identityId)} disabled={busy || active} onChange={e => campaign ? void action({ action: "identity", identityId: e.target.value || null }) : setIdentityId(e.target.value)}><option value="">Create an influencer in chat</option>{identities.map(identity => <option key={identity.id} value={identity.id}>{identity.name}</option>)}</select>
          {campaign?.identity && <><Badge variant="outline">v{campaign.identity.version} locked</Badge><Button size="xs" variant="ghost" disabled={busy} onClick={reuseIdentity}>Use in new campaign</Button></>}
        </div>
        <div className="campaign-thread">
          {!campaign?.messages.length ? <div className="campaign-welcome">
            <DotCanvasBackground /><div className="campaign-welcome-mark"><BrandWordmark /></div>
            <p className="campaign-eyebrow">FROM FIRST IDEA TO FINAL FRAME</p>
            <TypewriterHeading text="What are we creating today?" />
            <p className="campaign-intro">Build an influencer. Shape a campaign. Bring it to life.<br />Your ideas, references, and finished work stay together.</p>
            <div className="campaign-starters">{starters.map(({ icon: Icon, title, description, prompt }) => <button key={title} className="campaign-starter" onClick={() => { setDirectorMode(title === "Research & adapt Reels" || title === "Dance trend, new influencer"); setInput(prompt); composer.current?.focus(); }}><Icon size={20} /><strong>{title}</strong><span>{description}</span><ChevronRight size={14} className="campaign-starter-arrow" /></button>)}</div>
          </div> : <div className="campaign-messages">{campaign.messages.map(message => <article key={message.id} id={`message-${message.id}`} className={cn("campaign-message", message.role === "user" && "campaign-message-user")}>
            <p className="campaign-message-author">{message.role === "user" ? "YOU" : "CREATIVE PRODUCER"}</p>
            <div className="whitespace-pre-wrap text-sm leading-7">{message.content}</div>
            {renderPlan(message)}
            {campaign.directors?.filter(d => d.messageId === message.id).map(run => <DirectorRunCard key={run.id} run={run} campaign={campaign} busy={busy} action={action} />)}
            <div className="campaign-inline-assets">{campaign.assets.filter(a => a.messageId === message.id).map(asset => <div id={`asset-${asset.id}`} key={asset.id} className={cn("campaign-inline-asset", selectedId === asset.id && "campaign-asset-selected")}>
              <Media asset={asset} /><div className="flex items-center justify-between gap-2 p-3"><div className="min-w-0"><p className="truncate text-xs font-medium">{asset.title}</p><p className="text-xs text-muted-foreground">{asset.automatedReview ? asset.automatedReview.pass ? "Visual QA passed · " : "QA needs revision · " : ""}{asset.review === "pending" ? "Needs your review" : asset.review}</p></div><Button size="xs" variant="outline" onClick={() => chooseAsset(asset)}>Review</Button></div>
            </div>)}</div>
          </article>)}{campaign.planning && <div role="status" className="flex items-center gap-3 py-5 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />Developing your creative direction…</div>}<div ref={end} /></div>}
        </div>
        <div className="campaign-composer-wrap">
          {revisionOf && <div className="mb-2 flex items-center gap-2 text-xs"><Badge variant="outline">Revising: {campaign?.assets.find(a => a.id === revisionOf)?.title}</Badge><Button size="xs" variant="ghost" onClick={() => setRevisionOf(undefined)}>Clear revision</Button></div>}
          {(error || campaign?.error) && <p role="alert" className="mb-3 rounded-lg border border-destructive/30 p-3 text-sm text-destructive">{error || campaign?.error}</p>}
          {!!refs.length && <div className="mb-3 flex flex-wrap gap-2">{refs.map(url => <div key={url} className="relative"><img src={url} alt="Campaign reference" className="size-14 rounded-lg object-cover" /><Button size="icon-xs" variant="secondary" className="absolute -right-1 -top-1" aria-label="Remove reference" disabled={busy || active} onClick={() => campaign ? void action({ action: "settings", referenceUrls: refs.filter(r => r !== url) }) : setReferences(refs.filter(r => r !== url))}><X /></Button></div>)}</div>}
          <div className="mb-3 flex flex-wrap items-center gap-2"><label htmlFor="campaign-mode" className="sr-only">Creative mode</label><select id="campaign-mode" className="rounded-lg border border-input bg-background px-3 py-2 text-xs" value={directorMode ? "director" : "plan"} disabled={active || busy} onChange={e => setDirectorMode(e.target.value === "director")}><option value="plan">Plan & create</option><option value="director">Research & adapt · Agent</option></select>{directorMode && <span className="text-xs text-muted-foreground">{(campaign?.model ?? model ?? defaultModel) === ANTIGRAVITY_CHAT_MODEL ? "Google account · Antigravity" : "OpenAI account"} · web search + visual review</span>}</div>
          {directorMode && !active && <details className="mb-3 rounded-xl border border-border p-3"><summary className="cursor-pointer text-xs font-medium">Sources & output settings · {reelCount} Reel{reelCount !== 1 ? "s" : ""} · {sourceLinks.trim() ? "references attached" : searchProvider === "web" ? "OpenAI web discovery" : "Live TikTok search"}</summary><div className="mt-3 space-y-3"><p className="text-xs text-muted-foreground">Search public TikToks and Reels, retrieve video, compare frame evidence, then adapt the selected motion. Public retrieval can fail; supply your own clip when needed.</p><Field><FieldLabel htmlFor="source-provider">Discovery source</FieldLabel><select id="source-provider" value={searchProvider} disabled={busy || active} onChange={e => setSearchProvider(e.target.value)} className="h-9 rounded-md border border-input bg-background px-2 text-sm"><option value="tiktok">Live TikTok search · local browser (free)</option><option value="web">OpenAI account · web index</option></select><p className="text-xs text-muted-foreground">{searchProvider === "tiktok" ? "Runs TikTok keyword search in a headless local Chrome with an anonymous visitor session and ranks results by views per day, engagement, clip fit and recency." : "Asks the connected OpenAI account to find indexed TikTok/Reel links. Coverage is incomplete."}</p></Field><Field><FieldLabel htmlFor="motion-model">Motion video model · Kie.ai</FieldLabel><select id="motion-model" value={motionModel ?? campaign?.motionModel ?? DEFAULT_MOTION_MODEL} disabled={busy || active} onChange={e => { setMotionModel(e.target.value); if (campaign) void action({ action: "settings", motionModel: e.target.value }); }} className="h-9 rounded-md border border-input bg-background px-2 text-sm">{MOTION_MODELS.map(m => <option key={m.id} value={m.id}>{m.name} · {m.provider}</option>)}</select><p className="text-xs text-muted-foreground">{motionModelSummary(MOTION_MODELS.find(m => m.id === (motionModel ?? campaign?.motionModel ?? DEFAULT_MOTION_MODEL)) ?? MOTION_MODELS[0])}</p></Field><Field><FieldLabel htmlFor="source-links">Source links or uploaded clips (optional)</FieldLabel><Textarea id="source-links" rows={2} value={sourceLinks} disabled={active || busy} onChange={e => setSourceLinks(e.target.value)} placeholder="Paste direct TikTok/Reel links, one per line, or leave empty to search" /></Field><div className="flex flex-wrap items-end gap-3"><Field className="w-20"><FieldLabel htmlFor="reel-count">Reels</FieldLabel><input id="reel-count" type="number" min={1} max={3} value={reelCount} disabled={active || busy} onChange={e => setReelCount(Number(e.target.value))} className="h-8 rounded-md border border-input bg-background px-2 text-sm" /></Field><Field className="w-28"><FieldLabel htmlFor="still-count">Stills per Reel</FieldLabel><input id="still-count" type="number" min={0} max={3} value={stillCount} disabled={active || busy} onChange={e => setStillCount(Number(e.target.value))} className="h-8 rounded-md border border-input bg-background px-2 text-sm" /></Field><input ref={sourceUpload} type="file" accept="video/mp4,video/quicktime,video/webm" className="hidden" onChange={async e => { const file = e.target.files?.[0]; e.target.value = ""; if (!file) return; if (file.size > 100 * 1024 * 1024) { setError("Choose a video under 100 MB and 60 seconds."); return; } setBusy(true); try { const response = await fetch("/api/upload-video", { method: "POST", headers: { "Content-Type": file.type }, body: file }); const data = await response.json(); if (!response.ok) throw new Error(data.error); setSourceLinks(v => [v, data.cdnUrl].filter(Boolean).join("\n")); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }} /><Button type="button" variant="outline" size="sm" disabled={active || busy} onClick={() => sourceUpload.current?.click()}><Film data-icon="inline-start" />Upload source clip</Button></div><details><summary className="cursor-pointer text-xs font-medium">Captured clips · {captures.length}</summary><p className="mt-2 text-xs text-muted-foreground">Reels sent from the bundled InstaVault browser extension. Attach one to adapt it without any public retrieval.</p>{captures.length === 0 && <div className="mt-2"><ExtensionInstall compact /></div>}<div className="mt-2 space-y-2">{captures.slice(0, 12).map(c => <div key={c.id} className="flex items-center justify-between gap-2 rounded-md border border-border p-2 text-xs"><div className="min-w-0"><p className="truncate">@{c.author}{c.caption ? ` · ${c.caption}` : ""}</p><p className="truncate text-muted-foreground">{c.sourceUrl || c.url} · {new Date(c.createdAt).toLocaleString()}</p></div><Button type="button" size="sm" variant={sourceLinks.includes(c.url) ? "secondary" : "outline"} disabled={active || busy || sourceLinks.includes(c.url)} onClick={() => setSourceLinks(v => [v, c.url].filter(Boolean).join("\n"))}>{sourceLinks.includes(c.url) ? "Attached" : "Attach"}</Button></div>)}</div></details></div></details>}
          <form onSubmit={e => { e.preventDefault(); void send(); }} className="campaign-composer">
            <FieldGroup><Field><FieldLabel htmlFor="campaign-prompt" className="sr-only">Message your creative producer</FieldLabel><Textarea id="campaign-prompt" ref={composer} value={input} onChange={e => setInput(e.target.value)} placeholder={active ? "Production is underway. You can switch campaigns while it runs." : "Describe your influencer, your campaign, or your next idea…"} disabled={active || busy} rows={3} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }} /></Field></FieldGroup>
            <div className="campaign-composer-actions"><div className="flex min-w-0 items-center gap-2"><input ref={upload} type="file" accept="image/*" className="hidden" onChange={e => { void attach(e.target.files?.[0]); e.target.value = ""; }} /><Button type="button" variant="ghost" size="icon-sm" aria-label="Attach reference image" disabled={active || busy} onClick={() => upload.current?.click()}><Paperclip /></Button><label htmlFor="campaign-model" className="sr-only">Assistant model</label><select id="campaign-model" hidden={directorMode} value={campaign?.model ?? model ?? defaultModel} disabled={active || busy} onChange={e => campaign ? void action({ action: "settings", model: e.target.value }) : setModel(e.target.value)}><option value={CODEX_CHAT_MODEL} disabled={!account?.chatReady}>OpenAI account · Codex{account?.chatReady ? "" : " (disconnected)"}</option><option value={ANTIGRAVITY_CHAT_MODEL} disabled={!google?.chatReady}>Google account · Antigravity{google?.chatReady ? "" : " (disconnected)"}</option>{MODELS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}</select></div><Button type="submit" size="icon" aria-label="Send message" disabled={!input.trim() || active || busy}>{busy || campaign?.planning ? <LoaderCircle className="animate-spin" /> : <ArrowUp />}</Button></div>
          </form>
          <p className="campaign-provider-note">{!account ? "Checking connected account…" : <>Chat & planning: {(campaign?.model ?? model ?? defaultModel) === ANTIGRAVITY_CHAT_MODEL ? "Google account" : directorMode || (campaign?.model ?? model ?? defaultModel) === CODEX_CHAT_MODEL ? "OpenAI account" : "Selected model"} · Images: {{ codex: "OpenAI account", antigravity: "Google account", kie: "Kie.ai" }[campaign ? campaign.imageProvider ?? "kie" : campaignDefaults(account, google).imageProvider]} · Video: Kie.ai</>}</p>
          <p className="campaign-composer-note">Plans first. Generation starts when you approve. All outputs stay in this campaign.{campaign && ` ${budgetUsage(campaign).generations}/${campaign.budget?.maxGenerations ?? 24} generations allocated.`}</p>
        </div>
      </main>
      <aside aria-label="Session gallery" className={cn("campaign-gallery", galleryOpen && "campaign-gallery-open")}>
        <div className="campaign-gallery-heading"><div><p className="campaign-eyebrow">COLLECTED HERE</p><h2>Session gallery</h2></div><Button variant="ghost" size="icon-sm" aria-label="Close gallery" className="xl:hidden" onClick={() => setGalleryOpen(false)}><X /></Button></div>
        <div className="campaign-gallery-content">
          {selected ? <div className="flex flex-col gap-4"><Button variant="ghost" size="sm" onClick={() => setSelectedId(undefined)}>← All session assets</Button><Media asset={selected} /><div><h3 className="font-medium">{selected.title}</h3><p className="text-xs text-muted-foreground">{selected.pack}</p></div><Badge variant="outline">{selected.review === "pending" ? "Awaiting your review" : selected.review}</Badge>{selected.automatedReview && <div className="rounded-lg border border-border p-3 text-xs"><strong>{selected.automatedReview.pass ? "Visual QA passed" : "Visual QA: revision needed"}</strong><p className="mt-2">{selected.automatedReview.summary}</p><p className="mt-1 text-muted-foreground">Identity {selected.automatedReview.identityScore}/100{selected.kind === "video" ? ` · Motion ${selected.automatedReview.motionScore}/100` : ""}</p>{selected.automatedReview.issues.map((v, i) => <p key={i} className="mt-1">{v}</p>)}{selected.automatedReview.correction && <p className="mt-2">{selected.automatedReview.correction}</p>}<details className="mt-2"><summary>Review observations</summary>{selected.reviewEvidence?.sheets.map(url => <a key={url} href={url} target="_blank" rel="noreferrer"><img src={url} alt="Timestamped output review frames" loading="lazy" className="mt-2 w-full rounded-md" /></a>)}{selected.automatedReview.observations.map((v, i) => <p key={i} className="mt-1">{v}</p>)}</details></div>}{selected.look && <p className="text-sm text-muted-foreground">{selected.look}</p>}<div className="flex flex-wrap gap-2"><Button size="sm" disabled={busy} onClick={() => action({ action: "review", assetId: selected.id, review: "approved" })}><Check data-icon="inline-start" />Approve</Button><Button size="sm" variant="outline" disabled={busy} onClick={() => action({ action: "review", assetId: selected.id, review: "rejected" })}>Reject</Button>{selected.url && <a href={selected.url} download className={buttonVariants({ size: "sm", variant: "outline" })}><Download data-icon="inline-start" />Download</a>}</div>
            {campaign?.messages.find(m => m.id === selected.messageId)?.plan?.identityDraft && selected.kind === "image" && <Button disabled={busy || !!selected.identityId} onClick={() => action({ action: "save-identity", assetId: selected.id })}><ScanFace data-icon="inline-start" />{selected.identityId ? "Saved to Identities" : "Use as influencer identity"}</Button>}
            {selected.kind === "text" && <details><summary className="cursor-pointer text-sm">Revise caption</summary><form className="mt-3 flex flex-col gap-3" onSubmit={async e => { e.preventDefault(); const text = String(new FormData(e.currentTarget).get("text")); const c = await action({ action: "revise-text", assetId: selected.id, text }); if (c) setSelectedId(c.assets.at(-1)?.id); }}><Field><FieldLabel htmlFor="revision-text">Revised caption</FieldLabel><Textarea id="revision-text" name="text" defaultValue={selected.text} required maxLength={8000} /></Field><Button type="submit" disabled={busy}>Save as new version</Button></form></details>}
            {selected.kind !== "text" && <Button variant="outline" disabled={busy || active} onClick={async () => { if (selected.productionKind === "motion" && selected.directorId) { const sourceRun = campaign?.directors?.find(d => d.id === selected.directorId); const source = sourceRun?.sources.find(s => s.id === selected.sourceId); if (!source?.selection) { setError("The original motion reference is missing."); return; } setDirectorMode(true); setRevisionOf(selected.id); setSourceLinks(source.selection.clip.localUrl); setReelCount(1); setStillCount(sourceRun?.stillsPerReel ?? 1); setInput(`Revise the motion adaptation "${selected.title}" using the supplied source clip. Preserve the influencer and ${selected.look || "overall look"}. Requested changes: `); composer.current?.focus(); return; } const sourceRun = campaign?.runs.find(r => r.steps.some(s => s.id === selected.stepId)); const sourceStep = sourceRun?.steps.find(s => s.id === selected.stepId); const anchor = selected.kind === "image" ? selected.url : sourceStep?.referenceStep != null ? campaign?.assets.find(a => a.stepId === sourceRun?.steps[sourceStep.referenceStep!]?.id)?.url : sourceRun?.referenceUrls?.[0] ?? sourceRun?.identity?.references[0]?.url; if (!anchor) { setError("Attach an image anchor before revising this video."); return; } const c = await action({ action: "settings", referenceUrls: [anchor] }); if (c) { setDirectorMode(false); setRevisionOf(selected.id); setInput(`Create a variation of "${selected.title}". Keep the identity and ${selected.look || "overall look"}, but `); composer.current?.focus(); } }}>Create a variation</Button>}
            <p className="text-xs text-muted-foreground">Version {selected.version ?? 1}{selected.createdAt ? ` · ${new Date(selected.createdAt).toLocaleString()}` : ""}</p>{selected.parentAssetId && <Button variant="ghost" size="sm" onClick={() => setSelectedId(selected.parentAssetId)}>View source version</Button>}{campaign?.assets.filter(a => a.parentAssetId === selected.id).map(a => <Button key={a.id} variant="ghost" size="sm" onClick={() => setSelectedId(a.id)}>View revision {a.version} · {a.title}</Button>)}{selected.review === "approved" && selected.kind !== "text" && <Button variant="outline" onClick={() => { setControlsTab("publishing"); setControlsOpen(true); }}>Prepare a publishing draft</Button>}<Button variant="ghost" size="sm" onClick={() => jumpToAsset(selected)}>Find in conversation</Button><details className="text-xs text-muted-foreground"><summary>Generation prompt</summary><p className="mt-2 whitespace-pre-wrap">{selected.prompt}</p></details>
          </div> : <><label className="sr-only" htmlFor="asset-filter">Filter session assets</label><select id="asset-filter" className="campaign-gallery-filter" value={filter} onChange={e => setFilter(e.target.value)}><option value="all">All assets · {campaign?.assets.length ?? 0}</option><option value="image">Images</option><option value="video">Videos</option><option value="text">Captions</option><option value="approved">Approved</option></select>{!visibleAssets.length ? <Empty className="py-16"><EmptyHeader><EmptyMedia variant="icon"><Images /></EmptyMedia><EmptyTitle>{campaign?.assets.length ? "No matching assets" : "Your campaign, collected"}</EmptyTitle><EmptyDescription>{campaign?.assets.length ? "Choose another filter to see your work." : "Identity options, Reels, stills, and captions will appear here as you create."}</EmptyDescription></EmptyHeader></Empty> : packs.map(pack => <section key={pack} className="mt-6"><h3 className="mb-3 text-xs font-medium text-muted-foreground">{pack}</h3><div className="campaign-gallery-grid">{visibleAssets.filter(a => a.pack === pack).map(asset => <button key={asset.id} className="campaign-gallery-tile" onClick={() => chooseAsset(asset)}><Media asset={asset} compact /><span>{asset.title}</span>{asset.review === "approved" && <Check size={13} className="absolute right-2 top-2" />}</button>)}</div></section>)}</>}
        </div>
        {!!campaign?.directors?.some(d => d.sources.some(s => s.media)) && <details className="campaign-generation-settings"><summary>Retrieved source gallery · {campaign.directors.flatMap(d => d.sources.filter(s => s.media)).length}</summary><div className="mt-3 space-y-3">{campaign.directors.flatMap(d => d.sources.filter(s => s.media)).map(s => <SourceCard key={s.id} source={s} compact />)}</div></details>}
        {campaign && <details className="campaign-generation-settings"><summary>Generation providers & models</summary><FieldGroup className="mt-4"><Field><FieldLabel htmlFor="image-provider">Image provider</FieldLabel><select id="image-provider" disabled={active || busy} value={campaign.imageProvider ?? "kie"} onChange={e => action({ action: "settings", imageProvider: e.target.value, ...(e.target.value !== "kie" ? { imageModel: ACCOUNT_IMAGE_MODEL[e.target.value as "codex" | "antigravity"] } : {}) })}><option value="codex" disabled={!account?.imageReady}>OpenAI account{account?.imageReady ? "" : " (unavailable)"}</option><option value="antigravity" disabled={!google?.imageReady}>Google account · Antigravity{google?.imageReady ? "" : " (unavailable)"}</option><option value="kie">Kie.ai</option></select></Field><Field><FieldLabel htmlFor="image-model">Images</FieldLabel><select id="image-model" disabled={active || busy} value={campaign.imageModel} onChange={e => action({ action: "settings", imageModel: e.target.value })}>{IMAGE_MODELS.filter(m => m.supportsImages && ((campaign.imageProvider ?? "kie") === "kie" || m.id === ACCOUNT_IMAGE_MODEL[(campaign.imageProvider ?? "kie") as "codex" | "antigravity"])).map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></Field><Field><FieldLabel htmlFor="video-model">Plan mode video · Kie.ai</FieldLabel><select id="video-model" disabled={active || busy} value={campaign.videoModel} onChange={e => action({ action: "settings", videoModel: e.target.value })}>{VIDEO_MODELS.filter(m => m.handles.includes("startFrame") && m.durations.includes(5) && !m.apiInput.useMotionControl && !m.requiredHandles?.some(h => h !== "startFrame")).map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></Field></FieldGroup></details>}
      </aside>
    </div>
  </div>;
}
