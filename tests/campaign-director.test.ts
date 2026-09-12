import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DirectorTools } from "../lib/campaigns/director/engine";
import type { MediaEvidence } from "../lib/campaigns/director/types";
import { budgetUsage } from "../lib/campaigns/operations";
process.env.HELIOS_DATA_DIR = mkdtempSync(join(tmpdir(), "ugc-director-test-"));
process.env.HELIOS_MEDIA_DIR = mkdtempSync(join(tmpdir(), "ugc-director-media-"));
const engine = import("../lib/campaigns/director/engine"), database = import("../lib/campaigns/db");
const media: MediaEvidence = { localUrl: "/generated/fixture.mp4", duration: 8, width: 720, height: 1280, sheets: ["/generated/evidence.jpg"], sampleTimes: [0, 0.5, 1, 2, 3, 4, 5, 6, 7], cutTimes: [] };
const review = { pass: true, identityScore: 92, motionScore: 88, issues: [], observations: ["Target identity matches the supplied references."], correction: "", summary: "Passed." };
const inspection = { suitable: true, score: 85, subjectCount: 1, faceVisibility: "clear" as const, occlusion: "low" as const, motion: "Single subject turn", aestheticFit: "Lifestyle fit", issues: [], observations: [{second:0,observation:"Head visible"},{second:3,observation:"Torso clear"}], suggestedStart: 0, suggestedEnd: 5, summary: "Good source." };
async function fixture(urls = ["https://www.tiktok.com/@test/video/123"]) {
  const db = await database, e = await engine;
  const c = db.createCampaign({ model: "codex-account", imageModel: "gpt-image-2", imageProvider: "codex" });
  c.identity = { id: "test-persona", name: "Test persona", version: 1, triggerWord: "test", basePrompts: ["Adult test persona"], references: [{ url: "/generated/identity.png", kind: "face" }], defaults: { contentClass: "sfw" } } as NonNullable<typeof c.identity>;
  db.saveCampaign(c);
  return e.startDirector(c.id, { objective: "Find and adapt a lifestyle Reel for the target influencer.", sourceUrls: urls, reels: 1, stillsPerReel: 1 });
}
function fakeTools(): DirectorTools {
  return {
    mediaReady: () => true,
    accountStatus: async () => ({ chatReady:true,imageReady:true,installed:true,authFound:true,ready:true }),
    decideNext: async () => ({ tool: "need_input", question: "Test requires a decision." }),
    searchSocial: async () => ({ sources:[], summary:"No sources." }),
    searchTikTok: async () => ({ sources:[], summary:"No sources." }),
    retrieveVideo: async () => ({media:structuredClone(media),title:"Test source",metrics:{checkedAt:Date.now(),views:20000,likes:500,publishedAt:undefined}}),
    inspectSource: async () => structuredClone(inspection), clipVideo: async () => ({...media,localUrl:"/generated/selected-clip.mp4",duration:5}),
    motionImage: async () => "/generated/motion-anchor.jpg",
    generateImage: async () => Response.json({taskId:"image-task"}), generateVideo: async () => Response.json({taskId:"video-task"}),
    jobStatus: async req => Response.json(req.url.includes("video-task") ? { status:"done",videoUrl:"/generated/output.mp4" } : {status:"done",imageUrls:["/generated/output.jpg"]}),
    reviewOutput: async (_run, asset) => ({review:structuredClone(review),localUrl:asset.url!,evidence:undefined}),
  };
}
async function ready() {
  const c = await fixture(), tools = fakeTools(), db = await database;
  const run = c.directors![0], source = run.sources[0]; source.media=structuredClone(media);source.status="inspected";source.inspection=structuredClone(inspection);source.selection={start:0,end:5,direction:"Casual outfit against the source background",clip:structuredClone(media)};
  run.status="awaiting_approval";run.proposal={tool:"generate",sourceId:source.id,kind:"anchor",title:"Anchor",prompt:"Create the target influencer anchor image",reason:"Selected source is suitable"};
  db.saveCampaign(c);return {c,tools,run,source};
}
test("director retrieves alternatives, rejects poor footage, produces and revises real tool outputs", async () => {
  const c=await fixture(["https://www.tiktok.com/@test/video/123","https://www.instagram.com/reel/fixture/"]), e=await engine, db=await database, tools=fakeTools();
  let submissions=0, videoBody: Record<string,unknown> | undefined;
  tools.inspectSource=async(_r,s)=>({...inspection,suitable:s.url.includes("instagram"),score:s.url.includes("instagram")?85:20,summary:s.url.includes("instagram")?"Clear adult single subject":"Face obscured"});
  tools.generateImage=async()=>{submissions++;return Response.json({taskId:`image-task-${submissions}`})};
  tools.generateVideo=async req=>{submissions++;videoBody=await req.json();return Response.json({taskId:"video-task"})};
  tools.reviewOutput=async(run,asset)=>({review:asset.productionKind==="anchor" && run.jobs.filter(j=>j.kind==="anchor").length===1?{...review,pass:false,identityScore:40,correction:"Preserve face shape and hair baseline",summary:"Face drift"}:review,localUrl:asset.url!,evidence:undefined});
  tools.decideNext=async(run,assets)=>{
    const found=run.sources.find(s=>s.status==="found");if(found)return {tool:"retrieve",sourceId:found.id,reason:"Get actual source"};
    const raw=run.sources.find(s=>s.media&&!s.inspection);if(raw)return {tool:"inspect_source",sourceId:raw.id,reason:"Evaluate visible motion"};
    const source=run.sources.find(s=>s.inspection?.suitable)!;
    if(!source.selection)return {tool:"select_source",sourceId:source.id,start:0,end:5,direction:"Cream outfit with the source studio background",reason:"Better fit than occluded candidate"};
    const unreviewed=assets.find(a=>a.kind!=="text"&&!a.automatedReview);if(unreviewed)return {tool:"review_output",assetId:unreviewed.id,reason:"Check generated output"};
    for(const kind of ["anchor","motion","still"] as const)if(!assets.some(a=>a.productionKind===kind&&a.automatedReview?.pass))return {tool:"generate",sourceId:source.id,kind,title:kind,prompt:`Produce ${kind} preserving target face and hair revision ${run.jobs.length}`,reason:"Complete or correct output"};
    if(!assets.some(a=>a.kind==="text"))return {tool:"caption",sourceId:source.id,text:"An easy moment in the studio.",reason:"Match the completed visual"};
    return {tool:"finish",summary:"Reviewed Reel, matching still, and caption delivered."};
  };
  for(let i=0;i<10;i++){await e.advanceDirector(c.id,tools);if(db.getCampaign(c.id).directors![0].status==="awaiting_approval")break;}
  const waiting=db.getCampaign(c.id).directors![0];assert.equal(waiting.status,"awaiting_approval");assert.equal(submissions,0);assert.equal(waiting.sources.filter(s=>s.selection).length,1);assert.equal(waiting.sources[0].inspection?.suitable,false);
  e.approveDirector(c.id,waiting.id,{maxGenerations:5,motionEstimateUsd:1,referenceReuseConfirmed:true});
  for(let i=0;i<25;i++){await e.advanceDirector(c.id,tools);if(db.getCampaign(c.id).directors![0].status==="done")break;}
  const result=db.getCampaign(c.id);assert.equal(result.directors![0].status,"done",JSON.stringify(result.directors![0].events.slice(-4)));assert.equal(submissions,4);assert.equal(result.assets.length,5);
  assert.equal(videoBody?.videoRefUrl,"/generated/selected-clip.mp4");assert.equal(videoBody?.startFrameUrl,"/generated/motion-anchor.jpg");assert.equal(videoBody?.videoModel,"kling-3.0-motion-control");
  const anchors=result.assets.filter(a=>a.productionKind==="anchor");assert.equal(anchors[1].parentAssetId,anchors[0].id);assert.equal(anchors[1].version,2);assert.ok(result.assets.every(a=>a.review==="pending"));assert.equal(budgetUsage(result).generations,4);
});
test("approval enforces campaign budgets and cannot be duplicated", async()=>{
 const {c,run}=await ready(),e=await engine,db=await database;c.budget!.maxEstimatedUsd=1;db.saveCampaign(c);
 // No manual motion estimate: the published Kling 3.0 Motion Control rate prices the 5s clip at $0.50, so 4 generations exceed a $1 limit.
 assert.throws(()=>e.approveDirector(c.id,run.id,{maxGenerations:4,referenceReuseConfirmed:true}),/estimated-cost/);
 c.budget!.maxEstimatedUsd=2;db.saveCampaign(c);
 assert.throws(()=>e.approveDirector(c.id,run.id,{maxGenerations:4,motionEstimateUsd:1,referenceReuseConfirmed:true}),/estimated-cost/);
 const result=e.approveDirector(c.id,run.id,{maxGenerations:4,motionEstimateUsd:.4,referenceReuseConfirmed:true});assert.equal(budgetUsage(result).generations,4);assert.equal(budgetUsage(result).estimatedUsd,1.6);
 assert.throws(()=>e.approveDirector(c.id,run.id,{maxGenerations:4,motionEstimateUsd:.4,referenceReuseConfirmed:true}),/not awaiting/);
 e.controlDirector(c.id,run.id,"stop");assert.equal(budgetUsage(db.getCampaign(c.id)).generations,0);
 const priced=await ready();priced.c.budget!.maxEstimatedUsd=2;db.saveCampaign(priced.c);
 const approved=e.approveDirector(priced.c.id,priced.run.id,{maxGenerations:4,referenceReuseConfirmed:true});
 assert.equal(approved.directors![0].approval?.motionEstimateUsd,0.5);assert.equal(approved.directors![0].approval?.maxReservedUsd,2);assert.match(approved.directors![0].events.at(-1)!.summary,/motion published/);
});
test("uncertain submissions are never retried and submitted work survives stop",async()=>{
 const {c,run,tools}=await ready(),e=await engine,db=await database;let calls=0;
 e.approveDirector(c.id,run.id,{maxGenerations:4,referenceReuseConfirmed:true});tools.generateImage=async()=>{calls++;throw new Error("Connection lost after submit")};
 await e.advanceDirector(c.id,tools);await e.advanceDirector(c.id,tools);assert.equal(calls,1);assert.equal(db.getCampaign(c.id).directors![0].status,"blocked");assert.throws(()=>e.controlDirector(c.id,run.id,"resume"),/no saved job ID/);
 const next=await ready();e.approveDirector(next.c.id,next.run.id,{maxGenerations:4,referenceReuseConfirmed:true});await e.advanceDirector(next.c.id,next.tools);e.controlDirector(next.c.id,next.run.id,"stop");await e.advanceDirector(next.c.id,next.tools);assert.equal(db.getCampaign(next.c.id).assets.length,1);assert.equal(db.getCampaign(next.c.id).directors![0].status,"stopped");assert.equal(budgetUsage(db.getCampaign(next.c.id)).generations,1);
});
test("pause during reasoning prevents the next provider call; worker lease prevents duplicates",async()=>{
 const {c,run,tools}=await ready(),e=await engine,db=await database;e.approveDirector(c.id,run.id,{maxGenerations:4,referenceReuseConfirmed:true});
 let done!:()=>void;const held=new Promise<void>(resolve=>{done=resolve});let calls=0;
 tools.generateImage=async()=>{calls++;await held;return Response.json({taskId:"image-task"})};
 const first=e.advanceDirector(c.id,tools);while(calls===0)await new Promise(r=>setTimeout(r,5));await e.advanceDirector(c.id,tools);e.controlDirector(c.id,run.id,"pause");done();await first;assert.equal(calls,1);assert.equal(db.getCampaign(c.id).directors![0].status,"paused");
 await e.advanceDirector(c.id,tools);assert.equal(db.getCampaign(c.id).assets.length,1);
 const next=await fixture();const t=fakeTools();t.decideNext=async r=>{e.controlDirector(next.id,r.id,"pause");return {tool:"retrieve",sourceId:r.sources[0].id,reason:"Pause race"}};t.retrieveVideo=async()=>{throw new Error("Should not execute after pause")};await e.advanceDirector(next.id,t);assert.equal(db.getCampaign(next.id).directors![0].status,"paused");assert.equal(db.getCampaign(next.id).directors![0].sources[0].status,"found");
});
test("source validation and real FFmpeg evidence/clip extraction reject unsupported inputs and scene cuts",async()=>{
 const m=await import("../lib/campaigns/director/media");
 for(const url of ["http://localhost/video.mp4","https://evil.tiktok.com/@a/video/1","https://www.tiktok.com/profile","https://www.instagram.com/"])assert.throws(()=>m.sourceUrl(url));
 assert.equal(m.sourceUrl("https://www.tiktok.com/@user/video/123?tracking=1"),"https://www.tiktok.com/@user/video/123");
 const file=join(process.env.HELIOS_MEDIA_DIR!,"fixture.mp4");
 await m.processOutput("ffmpeg",["-hide_banner","-loglevel","error","-f","lavfi","-i","testsrc2=size=360x640:rate=24","-t","4","-c:v","libx264","-pix_fmt","yuv420p",file]);
 const output=await m.retrieveVideo("/generated/fixture.mp4");assert.ok(output.media.sampleTimes.length>=7);assert.ok(output.media.sheets.length);const clip=await m.clipVideo(output.media,0,3);assert.ok(Math.abs(clip.duration-3)<.1);assert.equal(clip.width,360);
 await assert.rejects(()=>m.clipVideo({...output.media,cutTimes:[1]},0,3),/scene cut/);await assert.rejects(()=>m.localPath("/generated/../../etc/passwd"));
 const other=await mkdtemp(join(tmpdir(),"ugc-other-"));await rm(other,{recursive:true,force:true});
});

test("live TikTok search parses real item shapes, ranks candidates, and derives trends without any vendor", async () => {
  const { searchTikTokItems, searchPath } = await import("../lib/campaigns/discovery/tiktokSearch");
  const { rankVideos } = await import("../lib/campaigns/discovery/rank");
  const { deriveTrends, toVideo } = await import("../lib/campaigns/discovery/tiktokItems");
  const { searchTikTok } = await import("../lib/campaigns/director/searchProvider");
  const day = 86400, nowSec = Math.floor(Date.now() / 1000);
  const item = (id: string, playCount: number, ageDays: number, duration = 7) => ({ id, desc: `Outfit transition #ootd #${id === "1" ? "fyp" : "streetstyle"}`, createTime: nowSec - ageDays * day, author: { uniqueId: "creator" }, music: { id: "m1", title: "Espresso (sped up)" }, stats: { playCount, diggCount: Math.round(playCount / 20), commentCount: 10 }, video: { duration, playAddr: "https://v19.tiktokcdn.com/public.mp4" }, textExtra: [{ hashtagName: "ootd" }, { hashtagName: id === "1" ? "fyp" : "streetstyle" }] });
  const pages: Record<string, unknown> = {
    [searchPath("outfit transition", 0)]: { status_code: 203, has_more: 1, cursor: 20, extra: { logid: "search-1" }, data: [{ item: item("1", 900000, 2) }, { user: {} }, { item: item("2", 50000, 40, 45) }] },
    [searchPath("outfit transition", 20, "search-1")]: { has_more: 0, data: [{ item: item("3", 300000, 1, 12) }, { item: item("1", 900000, 2) }] },
  };
  const calls: string[] = [];
  const session = { getJson: async (path: string) => { calls.push(path); return pages[path] ?? null; }, getBytes: async () => undefined, close: async () => {} };
  const items = await searchTikTokItems("outfit transition", { session, pages: 3 });
  assert.equal(items.length, 3); assert.equal(calls.length, 2); assert.match(calls[1], /search_id=search-1/);
  const videos = items.map(toVideo).filter(v => !!v);
  assert.equal(videos[0]!.url, "https://www.tiktok.com/@creator/video/1"); assert.equal(videos[0]!.mediaUrl, "https://v19.tiktokcdn.com/public.mp4");
  const { ranked, dropped } = rankVideos(videos, { maxAgeDays: 30, clipSeconds: { min: 3, max: 10 } });
  assert.equal(ranked.length, 2); assert.deepEqual(dropped, { age: 1 }); assert.equal(ranked[0].id, "1"); assert.ok(ranked[0].reasons.some(r => /fits the clip window/.test(r)));
  const trends = deriveTrends(items); assert.equal(trends[0].label, "#ootd"); assert.ok(!trends.some(t => t.label === "#fyp")); assert.ok(trends.some(t => t.kind === "sound" && t.label === "Espresso (sped up)"));
  const found = await searchTikTok("outfit transition", ["https://www.tiktok.com/@creator/video/3"], { session, pages: 3, maxAgeDays: 30 } as never);
  assert.equal(found.sources.length, 1); assert.equal(found.sources[0].downloadUrl, "https://v19.tiktokcdn.com/public.mp4"); assert.equal(found.sources[0].metrics?.views, 900000); assert.ok(found.sources[0].ranking!.score > 0); assert.match(found.summary, /#ootd/);
});
test("director defaults to built-in live search and older ScrapeCreators runs no longer reserve budget", async () => {
  const { budgetUsage } = await import("../lib/campaigns/operations");
  const c = (await database).createCampaign(); const e = await engine;
  const started = e.startDirector(c.id, { objective: "Search for lifestyle source footage" });
  assert.equal(started.directors![0].searchProvider, "tiktok"); assert.equal(budgetUsage(started).estimatedUsd, 0);
});
test("public media downloader rejects private addresses before network access",async()=>{
 const {downloadPublic}=await import("../lib/campaigns/director/download");
 for(const url of ["http://example.com/a", "https://127.0.0.1/a", "https://[::1]/a", "https://user:password@example.com/a"])await assert.rejects(()=>downloadPublic(url),/public HTTPS/);
});
test("a rejected source assessment can report no usable motion segment", async()=>{
 const {inspectionSchema}=await import("../lib/campaigns/director/types");
 const result=inspectionSchema.parse({...inspection,suitable:false,subjectCount:0,score:0,suggestedStart:0,suggestedEnd:0,summary:"No human subject and no usable segment."});
 assert.equal(result.suitable,false);assert.equal(result.suggestedEnd,0);
});

test("user guidance resumes blocked research without changing the production allowance", async()=>{
 const c=await fixture(),e=await engine,db=await database;const run=c.directors![0];run.status="blocked";run.error="Need another reference";run.searchRequests=4;db.saveCampaign(c);
 const result=e.replyDirector(c.id,run.id,{text:"Use this clearer source and retain the same visual direction.",sourceUrls:["https://www.instagram.com/reel/new-reference/"]});
 assert.equal(result.directors![0].status,"running");assert.equal(result.directors![0].sources.length,2);assert.equal(result.directors![0].searchRequests,4);assert.equal(result.directors![0].approval,undefined);assert.equal(result.messages.at(-1)?.role,"user");
});

test("a director variation keeps its original motion asset as revision parent",async()=>{
 const db=await database,e=await engine,c=await fixture();const old=c.directors![0];old.status="done";
 c.assets.push({id:"original-motion",directorId:old.id,sourceId:old.sources[0].id,productionKind:"motion",messageId:old.messageId,stepId:"old",title:"Original",pack:"Original",kind:"video",url:"/generated/old.mp4",prompt:"Original motion",look:"Original look",review:"approved",version:2} as typeof c.assets[number]);db.saveCampaign(c);
 const next=e.startDirector(c.id,{objective:"Revise the selected adaptation and preserve its source motion",revisionOf:"original-motion",sourceUrls:["https://www.tiktok.com/@test/video/123"]});const run=next.directors!.at(-1)!;
 run.sources[0].selection={start:0,end:5,direction:"Original look",clip:media};run.jobs.push({id:"new-job",sourceId:run.sources[0].id,kind:"motion",title:"Revised",prompt:"Corrected motion",status:"running",taskId:"video-task",startedAt:Date.now()});db.saveCampaign(next);
 await e.advanceDirector(c.id,fakeTools());const asset=db.getCampaign(c.id).assets.at(-1)!;assert.equal(asset.parentAssetId,"original-motion");assert.equal(asset.version,3);
});

test("motion model is selectable per run and shapes the video request for reference-video models", async () => {
  const { MOTION_MODELS, clipLimits, motionModel, motionRequestBody } = await import("../lib/campaigns/director/motionModels");
  assert.ok(MOTION_MODELS.some(m => m.id === "kling-3.0-motion-control") && MOTION_MODELS.some(m => m.id === "seedance-2") && MOTION_MODELS.some(m => m.id === "minimax-h3"));
  assert.throws(() => motionModel("kling-3.0"), /reference video/);
  assert.deepEqual(clipLimits(motionModel("kling-3.0-motion-control")).maxSeconds, 10); assert.equal(clipLimits(motionModel("seedance-2")).maxSeconds, 15); assert.equal(clipLimits(motionModel("seedance-2")).minSide, undefined);
  const seedance = motionRequestBody(motionModel("seedance-2"), { prompt: "p", anchorUrl: "/generated/a.jpg", clipUrl: "/generated/c.mp4", clipDuration: 5.4, identityUrls: ["/generated/i.png"] });
  assert.deepEqual(seedance, { videoModel: "seedance-2", prompt: "p", resolution: "720p", startFrameUrl: "/generated/a.jpg", referenceVideoUrls: ["/generated/c.mp4"], aspectRatio: "9:16", duration: 5 });
  const minimax = motionRequestBody(motionModel("minimax-h3"), { prompt: "p", anchorUrl: "/generated/a.jpg", clipUrl: "/generated/c.mp4", clipDuration: 8, identityUrls: ["/generated/i.png"] });
  assert.equal(minimax.startFrameUrl, undefined); assert.deepEqual(minimax.referenceImageUrls, ["/generated/a.jpg", "/generated/i.png"]); assert.deepEqual(minimax.referenceVideoUrls, ["/generated/c.mp4"]);
  const db = await database, e = await engine;
  const c = db.createCampaign({ model: "codex-account", imageModel: "gpt-image-2", imageProvider: "codex" });
  c.identity = { id: "p", name: "P", version: 1, triggerWord: "p", basePrompts: ["Adult"], references: [{ url: "/generated/identity.png", kind: "face" }], defaults: { contentClass: "sfw" } } as NonNullable<typeof c.identity>;
  c.motionModel = "seedance-2"; db.saveCampaign(c);
  assert.throws(() => e.startDirector(c.id, { objective: "Adapt a Reel with an unsupported model", videoModel: "kling-3.0", sourceUrls: ["https://www.tiktok.com/@test/video/1"] }), /reference video/);
  const started = e.startDirector(c.id, { objective: "Adapt a Reel using the campaign default model", sourceUrls: ["https://www.tiktok.com/@test/video/1"] });
  const run = started.directors![0]; assert.equal(run.videoModel, "seedance-2");
  const source = run.sources[0]; source.media = structuredClone(media); source.status = "inspected"; source.inspection = structuredClone(inspection); source.selection = { start: 0, end: 5, direction: "Studio look", clip: { ...structuredClone(media), localUrl: "/generated/selected-clip.mp4", duration: 5 } };
  run.status = "awaiting_approval"; run.proposal = { tool: "generate", sourceId: source.id, kind: "anchor", title: "Anchor", prompt: "Anchor of the influencer", reason: "ready" }; db.saveCampaign(started);
  e.approveDirector(c.id, run.id, { maxGenerations: 4, referenceReuseConfirmed: true });
  assert.match(db.getCampaign(c.id).directors![0].events.at(-1)!.summary, /Seedance 2.0/);
  const tools = fakeTools(); let videoBody: Record<string, unknown> | undefined;
  tools.generateVideo = async req => { videoBody = await req.json(); return Response.json({ taskId: "video-task" }); };
  tools.decideNext = async (r, assets) => { const unreviewed = assets.find(a => a.kind !== "text" && !a.automatedReview); if (unreviewed) return { tool: "review_output", assetId: unreviewed.id, reason: "check" }; if (!assets.some(a => a.productionKind === "anchor")) return { tool: "generate", sourceId: source.id, kind: "anchor", title: "Anchor", prompt: "Anchor of the influencer", reason: "start" }; if (!assets.some(a => a.productionKind === "motion")) return { tool: "generate", sourceId: source.id, kind: "motion", title: "Motion", prompt: "Follow the clip", reason: "next" }; return { tool: "need_input", question: "done for test" }; };
  for (let i = 0; i < 8 && !videoBody; i++) await e.advanceDirector(c.id, tools);
  assert.equal(videoBody?.videoModel, "seedance-2"); assert.deepEqual(videoBody?.referenceVideoUrls, ["/generated/selected-clip.mp4"]); assert.equal(videoBody?.startFrameUrl, "/generated/motion-anchor.jpg"); assert.equal(videoBody?.videoRefUrl, undefined); assert.equal(videoBody?.duration, 5);
});

test("a run without a saved identity designs one to fit the footage, generates candidates after approval, and continues once the user picks", async () => {
  const db = await database, e = await engine;
  const c = db.createCampaign({ model: "codex-account", imageModel: "gpt-image-2", imageProvider: "codex" });
  const started = e.startDirector(c.id, { objective: "Find a trending dance video and create an Instagram-ready influencer to recreate it", sourceUrls: ["https://www.tiktok.com/@test/video/123"] });
  const run = started.directors![0], source = run.sources[0];
  source.media = structuredClone(media); source.status = "inspected"; source.inspection = structuredClone(inspection); source.selection = { start: 0, end: 5, direction: "Streetwear, studio backdrop", clip: { ...structuredClone(media), localUrl: "/generated/selected-clip.mp4", duration: 5 } };
  db.saveCampaign(started);
  const tools = fakeTools(); let images = 0; const candidateBodies: Record<string, unknown>[] = [];
  tools.generateImage = async req => { images++; const body = await req.json(); candidateBodies.push(body); assert.equal(body.aspectRatio, "9:16"); return Response.json({ taskId: `image-task-${images}` }); };
  tools.jobStatus = async req => Response.json(req.url.includes("video-task") ? { status: "done", videoUrl: "/generated/output.mp4" } : { status: "done", imageUrls: [`/generated/candidate-${images}.jpg`] });
  tools.decideNext = async (r, assets) => {
    if (!r.identityProposal) return { tool: "propose_identity", name: "Nova", dna: "Adult creator, early twenties, long dark hair, athletic build, warm skin tone, small nose stud", personality: "Playful and confident", direction: "Streetwear that matches the studio backdrop of the selected clip", reason: "Fit the footage" };
    const unreviewed = assets.find(a => a.kind !== "text" && a.productionKind !== "identity" && !a.automatedReview); if (unreviewed) return { tool: "review_output", assetId: unreviewed.id, reason: "check" };
    if (!assets.some(a => a.productionKind === "anchor")) return { tool: "generate", sourceId: source.id, kind: "anchor", title: "Anchor", prompt: "Anchor of Nova matching the clip framing", reason: "start" };
    return { tool: "need_input", question: "enough for the test" };
  };
  // Anchor generation is refused until an influencer exists; the agent must propose one.
  await e.advanceDirector(c.id, tools);
  let current = db.getCampaign(c.id).directors![0];
  assert.equal(current.status, "awaiting_approval"); assert.equal(current.identityProposal?.name, "Nova"); assert.equal(current.proposal?.tool, "propose_identity");
  // Both accounts report image generation ready, so the split test runs GPT Image against Nano Banana, two candidates each.
  assert.deepEqual(current.identityProposal!.routes, [{ provider: "codex", model: "gpt-image-2" }, { provider: "antigravity", model: "nano-banana-pro" }]); assert.equal(current.identityProposal!.count, 4);
  assert.throws(() => e.approveDirector(c.id, run.id, { maxGenerations: 6, referenceReuseConfirmed: true }), /4 influencer candidates/);
  e.approveDirector(c.id, run.id, { maxGenerations: 8, referenceReuseConfirmed: true });
  for (let i = 0; i < 10; i++) { await e.advanceDirector(c.id, tools); if (db.getCampaign(c.id).directors![0].status === "awaiting_identity") break; }
  current = db.getCampaign(c.id).directors![0];
  assert.equal(current.status, "awaiting_identity", JSON.stringify(current.events.slice(-3)));
  assert.equal(images, 4); assert.equal(current.identityProposal!.candidates.length, 4);
  assert.deepEqual(candidateBodies.map(b => [b.model, !!b.codexProvider, !!b.antigravityProvider]), [["gpt-image-2", true, false], ["nano-banana-pro", false, true], ["gpt-image-2", true, false], ["nano-banana-pro", false, true]]);
  const candidates = db.getCampaign(c.id).assets.filter(a => a.productionKind === "identity");
  assert.equal(candidates.length, 4); assert.ok(candidates.every(a => a.pack === "Influencer candidates" && a.kind === "image")); assert.match(candidates[1].title, /Nano Banana Pro/);
  assert.throws(() => e.chooseIdentity(c.id, run.id, "not-a-candidate"), /candidates/);
  const chosen = e.chooseIdentity(c.id, run.id, candidates[1].id);
  assert.equal(chosen.identity?.name, "Nova"); assert.equal(chosen.identity?.references[0].url, candidates[1].url); assert.equal(chosen.directors![0].status, "running"); assert.equal(chosen.directors![0].identity?.id, chosen.identity?.id);
  assert.equal(chosen.assets.find(a => a.id === candidates[1].id)?.identityId, chosen.identity?.id);
  // The winning family (Nano Banana via the Google account) becomes the run's and campaign's image route.
  assert.equal(chosen.directors![0].imageProvider, "antigravity"); assert.equal(chosen.imageModel, "nano-banana-pro"); assert.equal(chosen.identity?.defaults.modelId, "nano-banana-pro");
  // Production now proceeds with the saved influencer as the anchor's reference.
  let anchorBody: Record<string, unknown> | undefined;
  tools.generateImage = async req => { anchorBody = await req.json(); images++; return Response.json({ taskId: `image-task-${images}` }); };
  for (let i = 0; i < 4 && !anchorBody; i++) await e.advanceDirector(c.id, tools);
  assert.ok(anchorBody, "anchor was submitted"); assert.deepEqual(anchorBody!.imageUrls, [candidates[1].url]); assert.equal(anchorBody!.identityAssetId, chosen.identity?.id); assert.equal(anchorBody!.antigravityProvider, true); assert.equal(anchorBody!.model, "nano-banana-pro");
});

test("candidate routes fall back to Kie.ai per family and to the run's own route when nothing else is available", async () => {
  const { candidateRoutes, candidateCount } = await engine;
  const status = (ready: Record<string, boolean>) => async (p: string) => ({ chatReady: !!ready[p], imageReady: !!ready[p], installed: true, authFound: true, ready: true });
  const run = { imageProvider: "kie" as const, imageModel: "seedream-5-pro" };
  const both = await candidateRoutes(run, { accountStatus: status({ codex: true, antigravity: true }), mediaReady: () => true });
  assert.deepEqual(both.map(r => r.provider), ["codex", "antigravity"]); assert.equal(candidateCount(both), 4);
  const kieOnly = await candidateRoutes(run, { accountStatus: status({}), mediaReady: () => true });
  assert.deepEqual(kieOnly, [{ provider: "kie", model: "gpt-image-2" }, { provider: "kie", model: "nano-banana-pro" }]);
  const codexNoKie = await candidateRoutes(run, { accountStatus: status({ codex: true }), mediaReady: (_k, p) => p !== "kie" });
  assert.deepEqual(codexNoKie, [{ provider: "codex", model: "gpt-image-2" }]); assert.equal(candidateCount(codexNoKie), 3);
  const none = await candidateRoutes(run, { accountStatus: status({}), mediaReady: () => false });
  assert.deepEqual(none, [{ provider: "kie", model: "seedream-5-pro" }]);
});

test("dance objectives favour clips that read as routines and drop obvious non-dance formats", async () => {
  const { rankVideos, isDanceQuery, danceTextScore } = await import("../lib/campaigns/discovery");
  assert.ok(isDanceQuery("trending dance challenge")); assert.ok(!isDanceQuery("outfit transition"));
  assert.ok(danceTextScore({ caption: "dc @choreo_king #dancechallenge" }) > 0.6); assert.equal(danceTextScore({ caption: "my skincare routine grwm" }) < 0.2, true);
  const base = { platform: "tiktok" as const, url: "", authorHandle: "a", hashtags: [], collectedAt: new Date().toISOString(), views: 100000, likes: 5000, durationSec: 8, postedAt: new Date().toISOString() };
  const videos = [...Array.from({ length: 6 }, (_, i) => ({ ...base, id: `n${i}`, caption: "cooking recipe haul" })), { ...base, id: "d1", caption: "new dance challenge dc @me", hashtags: ["dancechallenge"] }];
  const { ranked, dropped } = rankVideos(videos, { dance: true });
  assert.equal(ranked[0].id, "d1"); assert.equal(dropped["not dance"], 6); assert.ok(ranked[0].reasons.includes("reads as a dance routine"));
  assert.equal(rankVideos(videos, {}).ranked.length, 7);
});

test("a source is never retrieved or inspected twice: later runs reuse cached evidence and assessments", async () => {
  const db = await database, e = await engine;
  const { setCachedMedia, getCachedInspection } = await import("../lib/campaigns/director/cache");
  const m = await import("../lib/campaigns/director/media");
  const file = join(process.env.HELIOS_MEDIA_DIR!, "cache-fixture.mp4");
  await m.processOutput("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=360x640:rate=24", "-t", "3", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-y", file]);
  const url = "https://www.tiktok.com/@cache/video/777";
  const tools = fakeTools(); let retrievals = 0, inspections = 0;
  tools.retrieveVideo = async () => { retrievals++; return { media: { ...structuredClone(media), localUrl: "/generated/cache-fixture.mp4" }, title: "Cached source", metrics: { checkedAt: Date.now(), views: 10, likes: 1, publishedAt: undefined } }; };
  tools.inspectSource = async () => { inspections++; return structuredClone(inspection); };
  const runTo = async (id: string) => { for (let i = 0; i < 3; i++) await e.advanceDirector(id, tools); return db.getCampaign(id).directors![0]; };
  const decide = (r: { sources: { id: string; status: string; media?: unknown; inspection?: unknown }[] }) => { const s = r.sources[0]; if (s.status === "found") return { tool: "retrieve" as const, sourceId: s.id, reason: "get" }; if (s.media && !s.inspection) return { tool: "inspect_source" as const, sourceId: s.id, reason: "look" }; return { tool: "need_input" as const, question: "stop" }; };
  tools.decideNext = async r => decide(r);
  const first = db.createCampaign(); e.startDirector(first.id, { objective: "Adapt a clip, first pass with no identity", sourceUrls: [url] });
  const one = await runTo(first.id);
  assert.equal(one.sources[0].status, "inspected"); assert.equal(retrievals, 1); assert.equal(inspections, 1);
  const second = db.createCampaign(); e.startDirector(second.id, { objective: "Adapt the same clip again in another campaign", sourceUrls: [url] });
  const two = await runTo(second.id);
  assert.equal(two.sources[0].status, "inspected"); assert.equal(retrievals, 1, "media evidence reused"); assert.equal(inspections, 1, "assessment reused");
  assert.match(two.events.find(ev => ev.tool === "retrieved")!.outcome!, /Reused evidence/); assert.match(two.events.find(ev => ev.tool === "inspected")!.outcome!, /reused assessment/);
  // A different influencer changes aesthetic fit, so the assessment is redone while the media is still reused.
  const third = db.createCampaign(); third.identity = { id: "other-persona", name: "Other", version: 1, triggerWord: "other", basePrompts: ["Adult"], references: [{ url: "/generated/identity.png", kind: "face" }], defaults: { contentClass: "sfw" } } as NonNullable<typeof third.identity>; db.saveCampaign(third);
  e.startDirector(third.id, { objective: "Adapt the same clip for a different influencer", sourceUrls: [url] });
  await runTo(third.id);
  assert.equal(retrievals, 1); assert.equal(inspections, 2); assert.ok(getCachedInspection(url, "other-persona"));
  // Cached media whose file is gone is dropped and retrieved afresh.
  setCachedMedia("https://www.tiktok.com/@cache/video/778", { media: { ...structuredClone(media), localUrl: "/generated/missing.mp4" } });
  const fourth = db.createCampaign(); e.startDirector(fourth.id, { objective: "Adapt a clip whose cached media vanished", sourceUrls: ["https://www.tiktok.com/@cache/video/778"] });
  await runTo(fourth.id); assert.equal(retrievals, 2);
});

test("frame inspection and review use the inspection model tier while decisions stay on the reasoning tier", async () => {
  const { antigravityModel } = await import("../lib/antigravityAccount");
  const { codexModel, plannerArgs } = await import("../lib/campaigns/codexPlanner");
  const { agyPlanner } = await import("../lib/campaigns/agyPlanner");
  const { getAntigravityStatus } = await import("../lib/antigravityAccount");
  assert.equal(antigravityModel("reasoning"), "gemini-3.8-flash-high"); assert.equal(antigravityModel("inspection"), "gemini-3.8-flash-medium");
  assert.equal(codexModel("inspection"), undefined); assert.ok(!plannerArgs("/tmp/x", []).includes("-m"));
  const before = process.env.HELIOS_CODEX_INSPECTION_MODEL; process.env.HELIOS_CODEX_INSPECTION_MODEL = "gpt-5-mini";
  try { assert.deepEqual(plannerArgs("/tmp/x", [], false, codexModel("inspection")).slice(8, 10), ["-m", "gpt-5-mini"]); assert.equal(codexModel("reasoning"), undefined); }
  finally { if (before === undefined) delete process.env.HELIOS_CODEX_INSPECTION_MODEL; else process.env.HELIOS_CODEX_INSPECTION_MODEL = before; }
  process.env.HELIOS_ANTIGRAVITY_BIN = process.execPath;
  await getAntigravityStatus(true, async () => ({ stdout: "gemini-3.1-pro-high\tGemini\n", stderr: "", code: 0 }));
  const models: string[] = [];
  const spawner = async (_bin: string, args: string[]) => { models.push(args[args.indexOf("--model") + 1]); return { stdout: JSON.stringify({ conversation_id: "c", status: "SUCCESS", response: "{}" }), stderr: "", code: 0 }; };
  const { NextRequest } = await import("next/server");
  const req = () => new NextRequest("http://localhost/api/assistant", { method: "POST", body: JSON.stringify({ messages: [{ role: "user", content: "{}" }] }) });
  await agyPlanner(req(), { spawner }); await agyPlanner(req(), { spawner, tier: "inspection" });
  assert.deepEqual(models, ["gemini-3.8-flash-high", "gemini-3.8-flash-medium"]);
});

test("a run that reached approval without an influencer can hand the decision back so the agent designs one", async () => {
  const { c, run } = await ready(), e = await engine, db = await database;
  c.identity = undefined; run.identity = undefined; db.saveCampaign(c);
  assert.throws(() => e.approveDirector(c.id, run.id, { maxGenerations: 5, referenceReuseConfirmed: true }), /influencer/);
  const resumed = e.controlDirector(c.id, run.id, "resume");
  assert.equal(resumed.directors![0].status, "running"); assert.equal(resumed.directors![0].proposal, undefined); assert.equal(resumed.directors![0].events.at(-1)!.tool, "identity_needed");
  const tools = fakeTools(); tools.decideNext = async () => ({ tool: "generate", sourceId: run.sources[0].id, kind: "anchor", title: "Anchor", prompt: "Anchor without an influencer", reason: "should be refused" });
  await e.advanceDirector(c.id, tools);
  assert.match(db.getCampaign(c.id).directors![0].events.find(ev => ev.tool === "tool_error")!.summary, /propose_identity/);
});
