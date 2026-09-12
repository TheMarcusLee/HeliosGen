import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { parseCreativePlan, effectivePrompt } from "../lib/campaigns/types";
import { compileCampaignWorkflow } from "../lib/campaigns/workflow";

// Dynamic imports keep every database write in a disposable test directory.
process.env.HELIOS_DATA_DIR = mkdtempSync(join(tmpdir(), "ugc-campaign-test-"));
const database = import("../lib/campaigns/db");
const services = import("../lib/campaigns/service");
const plan = {
  reply: "Here are two directions for Maya.", title: "Maya / Outdoor launch", assumptions: ["Natural daylight"],
  identityDraft: { name: "Maya", dna: "Adult, brown eyes, curly dark hair", personality: "Warm and thoughtful" },
  steps: [
    { kind: "image", title: "Trail portrait", pack: "Trail morning", prompt: "An adult outdoors creator on a trail", look: "Sage jacket, forest trail", referenceStep: null, aspectRatio: "9:16" },
    { kind: "video", title: "Trail Reel", pack: "Trail morning", prompt: "A slow turn toward camera", look: "Sage jacket, forest trail", referenceStep: 0, aspectRatio: "9:16" },
    { kind: "text", title: "Caption", pack: "Trail morning", prompt: "A little fresh air goes a long way.", look: "", referenceStep: null, aspectRatio: "9:16" },
  ],
};
async function fixture() {
  const { createCampaign, saveCampaign } = await database;
  const c = createCampaign();
  c.messages = [{ id: "brief", role: "assistant", content: plan.reply, createdAt: Date.now(), plan: parseCreativePlan(JSON.stringify(plan)) }];
  return saveCampaign(c);
}

test("planner rejects future, self and non-image references and oversized batches", () => {
  assert.equal(parseCreativePlan(`\`\`\`json\n${JSON.stringify(plan)}\n\`\`\``).steps.length, 3);
  for (const referenceStep of [1, 2, 9]) assert.throws(() => parseCreativePlan(JSON.stringify({ ...plan, steps: [{ ...plan.steps[0], referenceStep }] })));
  assert.throws(() => parseCreativePlan(JSON.stringify({ ...plan, steps: Array(13).fill(plan.steps[0]) })));
});

test("approved plan is durable, idempotent, and compiles the exact reference graph", async () => {
  const { startCampaignRun } = await services;
  const { getCampaign } = await database;
  const c = await fixture();
  const first = startCampaignRun(c.id, "brief");
  const second = startCampaignRun(c.id, "brief");
  assert.equal(second.runs.length, 1);
  assert.equal(second.runs[0].workflowId, first.runs[0].workflowId);
  assert.equal(getCampaign(c.id).runs[0].steps[0].status, "queued");
  const graph = compileCampaignWorkflow(first, first.runs[0]);
  assert.ok(graph.edges.some((e: unknown) => {
    const edge = e as { source: string; target: string; targetHandle: string };
    return edge.source === first.runs[0].steps[0].id && edge.target === first.runs[0].steps[1].id && edge.targetHandle === "startFrame";
  }));
});

test("execution submits once, recovers by job ID, passes the anchor to video, and packages captions", async () => {
  const { startCampaignRun, advanceCampaign } = await services;
  const c = await fixture(); startCampaignRun(c.id, "brief");
  const calls: Record<string, unknown>[] = [];
  const providers = {
    generateImage: async (req: NextRequest) => { calls.push(await req.json()); return NextResponse.json({ taskId: "image-job" }); },
    generateVideo: async (req: NextRequest) => { calls.push(await req.json()); return NextResponse.json({ taskId: "video-job" }); },
    jobStatus: async (req: NextRequest) => NextResponse.json(req.nextUrl.searchParams.get("taskId") === "image-job" ? { status: "done", imageUrl: "/generated/test/portrait.png" } : { status: "done", videoUrl: "/generated/test/reel.mp4" }),
  };
  await Promise.all([advanceCampaign(c.id, providers), advanceCampaign(c.id, providers)]);
  assert.equal(calls.length, 1, "parallel polls must not duplicate paid submissions");
  await advanceCampaign(c.id, providers);
  await advanceCampaign(c.id, providers);
  assert.equal(calls[1].startFrameUrl, "/generated/test/portrait.png");
  await advanceCampaign(c.id, providers);
  await advanceCampaign(c.id, providers);
  const done = await advanceCampaign(c.id, providers);
  assert.equal(done.runs[0].status, "done");
  assert.deepEqual(done.assets.map(a => a.kind), ["image", "video", "text"]);
  assert.equal(new Set(done.assets.map(a => a.messageId)).size, 1);
  assert.equal(done.assets[2].text, plan.steps[2].prompt);
  assert.ok(done.assets.every(a => a.review === "pending"));
  await advanceCampaign(c.id, providers);
  assert.equal(calls.length, 2);
});

test("interrupted submission fails closed without contacting the provider", async () => {
  const { startCampaignRun, advanceCampaign } = await services;
  const { saveCampaign } = await database;
  const c = startCampaignRun((await fixture()).id, "brief");
  c.runs[0].steps[0].status = "submitting"; saveCampaign(c);
  const never = async () => { assert.fail("A submitting job cannot be safely retried"); return NextResponse.json({}); };
  const result = await advanceCampaign(c.id, { generateImage: never, generateVideo: never, jobStatus: never });
  assert.equal(result.runs[0].status, "error");
  assert.match(result.runs[0].steps[0].error!, /may have been charged/);
});

test("a run freezes reference selection and stops downstream jobs when its anchor fails", async () => {
  const { startCampaignRun, advanceCampaign } = await services;
  const { saveCampaign } = await database;
  const draft = await fixture();
  draft.referenceUrls = ["/generated/chosen-variation.png"];
  saveCampaign(draft);
  const running = startCampaignRun(draft.id, "brief");
  running.referenceUrls = ["/generated/later-reference.png"];
  saveCampaign(running);
  let calls = 0;
  const provider = async (req: NextRequest) => {
    calls++;
    assert.deepEqual((await req.json()).imageUrls, ["/generated/chosen-variation.png"]);
    return NextResponse.json({ taskId: "failed-anchor" });
  };
  const providers = { generateImage: provider, generateVideo: provider, jobStatus: async () => NextResponse.json({ status: "error", error: "Provider rejected the reference" }) };
  await advanceCampaign(draft.id, providers);
  const failed = await advanceCampaign(draft.id, providers);
  await advanceCampaign(draft.id, providers);
  assert.equal(failed.runs[0].status, "error");
  assert.equal(calls, 1);
  assert.equal(failed.assets.length, 0);
});

test("paused run settles the current job but does not start the next step", async () => {
  const { startCampaignRun, advanceCampaign } = await services;
  const { saveCampaign, listCampaigns } = await database;
  const c = startCampaignRun((await fixture()).id, "brief");
  c.runs[0].status = "paused"; c.runs[0].steps[0].status = "running"; c.runs[0].steps[0].taskId = "recover-me"; saveCampaign(c);
  assert.equal(listCampaigns().find(item => item.id === c.id)?.running, true);
  let submitted = 0;
  const provider = async () => { submitted++; return NextResponse.json({ taskId: "unexpected" }); };
  const providers = { generateImage: provider, generateVideo: provider, jobStatus: async () => NextResponse.json({ status: "done", imageUrl: "/generated/portrait.png" }) };
  await advanceCampaign(c.id, providers);
  const paused = await advanceCampaign(c.id, providers);
  assert.equal(submitted, 0);
  assert.equal(paused.runs[0].steps[1].status, "queued");
});

test("influencer approval creates one reusable identity and leaves other campaigns isolated", async () => {
  const { saveInfluencer, selectIdentity } = await services;
  const { saveCampaign, getCampaign } = await database;
  const c = await fixture();
  c.assets.push({ id: "portrait", stepId: "step", messageId: "brief", kind: "image", url: "/generated/test/portrait.png", title: "Maya", pack: "Identity", prompt: "Portrait", look: "", review: "pending" });
  saveCampaign(c);
  const approved = saveInfluencer(c.id, "portrait");
  assert.ok(approved.identity?.id);
  assert.equal(saveInfluencer(c.id, "portrait").identity?.id, approved.identity!.id);
  const other = await fixture();
  selectIdentity(other.id, approved.identity!.id);
  assert.equal(getCampaign(other.id).assets.length, 0);
  assert.equal(getCampaign(other.id).identity?.version, 1);
  assert.match(effectivePrompt({ prompt: "City walk", look: "Black jacket" }, approved.identity), /Black jacket/);
  assert.ok(!approved.identity!.basePrompts.some(p => p.includes("Black jacket")));
});

test("planner persists conversation and validated plan from streamed provider output", async () => {
  const { planCampaign } = await services;
  const { createCampaign } = await database;
  const c = createCampaign();
  const result = await planCampaign(c.id, "Build Maya", {}, async () => new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: JSON.stringify(plan) } }] })}\n\ndata: [DONE]\n\n`));
  assert.equal(result.messages.length, 2);
  assert.equal(result.messages[1].plan?.identityDraft?.name, "Maya");
  assert.equal(result.planning, false);
  assert.equal(result.runs.length, 0, "planning never generates media before approval");
});

test("invalid planner output leaves a recoverable error and preserves the user's message", async () => {
  const { planCampaign } = await services;
  const { createCampaign, getCampaign } = await database;
  const c = createCampaign();
  await assert.rejects(planCampaign(c.id, "Build Maya", {}, async () => new Response('data: {"choices":[{"delta":{"content":"not JSON"}}]}\n\n')));
  const result = getCampaign(c.id);
  assert.equal(result.planning, false);
  assert.equal(result.messages[0].content, "Build Maya");
  assert.ok(result.error);
});


test("connected account defaults distinguish chat and image capabilities", async () => {
  const { campaignDefaults, CODEX_CHAT_MODEL } = await import("../lib/campaigns/providers");
  assert.deepEqual(campaignDefaults({ chatReady: true, imageReady: true }), { model: CODEX_CHAT_MODEL, imageModel: "gpt-image-2", imageProvider: "codex" });
  assert.equal(campaignDefaults({ chatReady: true, imageReady: false }, { chatReady: false, imageReady: false }).imageProvider, "kie");
  assert.equal(campaignDefaults({ chatReady: true, imageReady: false }).imageProvider, "kie");
  assert.notEqual(campaignDefaults({ chatReady: false, imageReady: false }).model, CODEX_CHAT_MODEL);
  const { createCampaign, saveCampaign } = await database;
  const { startCampaignRun } = await services;
  const c = createCampaign(campaignDefaults({ chatReady: true, imageReady: true }));
  c.messages = [{ id: "brief", role: "assistant", content: plan.reply, createdAt: Date.now(), plan: parseCreativePlan(JSON.stringify(plan)) }];
  saveCampaign(c);
  const started = startCampaignRun(c.id, "brief");
  assert.equal(started.runs[0].imageProvider, "codex");
  const workflow = compileCampaignWorkflow(started, started.runs[0]);
  assert.equal((workflow.nodes as { type: string; data: { generationProvider?: string } }[]).find(n => n.type === "generateNode")?.data.generationProvider, "codex");
});

test("account planner excludes API-key overrides and user tool configuration", async () => {
  const { codexAccountEnv } = await import("../lib/codexAccount");
  const { plannerArgs } = await import("../lib/campaigns/codexPlanner");
  assert.equal("OPENAI_API_KEY" in codexAccountEnv(), false);
  assert.equal("CODEX_API_KEY" in codexAccountEnv(), false);
  const args = plannerArgs("/tmp/example", []);
  for (const expected of ["--ignore-user-config", "--ephemeral", "read-only", "features.shell_tool=false", "features.unified_exec=false"]) assert.ok(args.includes(expected));
});

test("upstream image model override reaches only the account image helper without API keys", async () => {
  const { codexAccountEnv } = await import("../lib/codexAccount");
  const keys = ["CODEX_IMAGEGEN_MODEL", "OPENAI_API_KEY", "CODEX_API_KEY"] as const;
  const before = keys.map(key => process.env[key]);
  try {
    process.env.CODEX_IMAGEGEN_MODEL = "test-image-model";
    process.env.OPENAI_API_KEY = "test-api-key"; process.env.CODEX_API_KEY = "test-codex-key";
    assert.equal(codexAccountEnv().CODEX_IMAGEGEN_MODEL, undefined);
    const imageEnv = codexAccountEnv({ imageGeneration: true });
    assert.equal(imageEnv.CODEX_IMAGEGEN_MODEL, "test-image-model");
    assert.equal(imageEnv.OPENAI_API_KEY, undefined); assert.equal(imageEnv.CODEX_API_KEY, undefined);
  } finally { keys.forEach((key, index) => { if (before[index] === undefined) delete process.env[key]; else process.env[key] = before[index]; }); }
});
