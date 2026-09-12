import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { budgetSchema, memorySchema, quotePlan, budgetUsage } from "../lib/campaigns/operations";
import { parseCreativePlan } from "../lib/campaigns/types";
process.env.HELIOS_DATA_DIR = mkdtempSync(join(tmpdir(), "ugc-operations-test-"));
const database = import("../lib/campaigns/db");
const services = import("../lib/campaigns/service");
function plan(kind = "image") { return parseCreativePlan(JSON.stringify({ title: "Test campaign", reply: "Proposed", steps: [{ kind, title: "Asset", pack: "Pack", prompt: "Test caption", look: "", aspectRatio: "1:1", referenceStep: null }] })); }
async function fixture(kind = "image") { const { createCampaign, saveCampaign } = await database; const c = createCampaign(); c.messages.push({ id: "plan", role: "assistant", content: "Plan", plan: plan(kind), createdAt: Date.now() }); return saveCampaign(c); }

test("server worker advances a persisted text run without any browser calls", async () => {
  const c = await fixture("text");
  const { startCampaignRun } = await services;
  startCampaignRun(c.id, "plan");
  const { workerTick } = await import("../lib/campaigns/worker");
  await workerTick(); await workerTick();
  const result = (await database).getCampaign(c.id);
  assert.equal(result.runs[0].status, "done"); assert.equal(result.assets[0].text, "Test caption");
});
test("durable leases exclude another worker and recover expired ownership", async () => {
  const { claimLease } = await import("../lib/campaigns/lease");
  const first = claimLease("test"); assert.ok(first); assert.equal(claimLease("test"), null); first();
  const expired = claimLease("test", 1, 1); assert.ok(expired);
  const next = claimLease("test"); assert.ok(next); expired();
  assert.equal(claimLease("test"), null); next();
});
test("budgets reserve the full plan, retain failed submissions and release unstarted work", async () => {
  const c = await fixture(); c.budget = budgetSchema.parse({ maxGenerations: 0 });
  assert.match(quotePlan(c, plan()).reason!, /generation limit/);
  c.budget = budgetSchema.parse({ maxGenerations: 3, maxEstimatedUsd: 1 });
  assert.match(quotePlan(c, plan()).reason!, /cost estimates/);
  c.budget.imageEstimateUsd = 0.75;
  assert.equal(quotePlan(c, plan()).reason, undefined);
  (await database).saveCampaign(c);
  const started = (await services).startCampaignRun(c.id, "plan");
  assert.equal(budgetUsage(started).estimatedUsd, 0.75);
  assert.match(quotePlan(started, plan()).reason!, /estimated-cost limit/);
  started.runs[0].status = "error";
  assert.equal(budgetUsage(started).generations, 0);
  started.runs[0].steps[0].startedAt = Date.now(); started.runs[0].steps[0].status = "error";
  assert.equal(budgetUsage(started).generations, 1);
  (await database).saveCampaign(started);
});
test("brief history persists and planning sees saved memory and selected source evidence", async () => {
  const c = await fixture("text");
  const { POST } = await import("../app/api/campaigns/[id]/route");
  const memory = memorySchema.parse({ brand: "Test brand", brief: "Launch new travel kit", products: [{ name: "Travel kit", description: "Three small bottles", url: "https://example.com/kit" }] });
  const response = await POST(new NextRequest("http://localhost/api/campaigns/test", { method: "POST", body: JSON.stringify({ action: "memory", memory }) }), { params: Promise.resolve({ id: c.id }) });
  assert.equal(response.status, 200);
  assert.equal((await database).getCampaign(c.id).memoryHistory?.[0].memory.products[0].name, "Travel kit");
  await (await services).planCampaign(c.id, "Discuss this launch", {}, async req => {
    const body = await req.json(); assert.match(JSON.stringify(body.messages), /Launch new travel kit/);
    return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: JSON.stringify({ ...plan("text"), steps: [] }) } }] })}\n\n`);
  });
});
test("asset revisions preserve the original and link new outputs to their parent", async () => {
  const c = await fixture("text"); c.assets.push({ id: "source", messageId: "old", stepId: "old", kind: "text", title: "Caption", pack: "Pack", text: "Original", prompt: "Original", look: "", review: "approved", version: 1 });
  c.messages[0].revisionOf = "source"; (await database).saveCampaign(c);
  const service = await services; service.startCampaignRun(c.id, "plan"); await service.advanceCampaign(c.id);
  const result = (await database).getCampaign(c.id);
  assert.equal(result.assets[0].text, "Original"); assert.equal(result.assets[1].parentAssetId, "source"); assert.equal(result.assets[1].version, 2);
  result.runs[0].status = "done"; (await database).saveCampaign(result);
});
async function publishFixture() {
  const c = await fixture(); c.assets.push({ id: "approved", messageId: "old", stepId: "old", title: "Approved image", pack: "Pack", kind: "image", url: "https://example.com/image.png", prompt: "Test", look: "", review: "approved" });
  (await database).saveCampaign(c); return c;
}
test("publishing requires approved assets and explicit queue authorization, then submits once", async () => {
  const { draftPost, queuePost, advancePublishing } = await import("../lib/campaigns/publishing");
  const c = await publishFixture();
  const draft = { assetIds: ["approved"], caption: "Approved caption", accountIds: [7], scheduledAt: new Date(Date.now() + 3600000).toISOString() };
  assert.throws(() => draftPost(c.id, { ...draft, assetIds: ["missing"] }));
  const saved = draftPost(c.id, draft); let count = 0;
  const api = { accounts: async () => [{ id: 7, platform: "instagram", username: "test", needs_reconnect: false }], upload: async (url: string) => ({ url }), request: async (_path: string, body?: unknown) => { assert.ok(body); count++; return { id: "remote-1", status: "scheduled" }; } };
  await advancePublishing(c.id, api); assert.equal(count, 0);
  queuePost(c.id, saved.posts![0].id); queuePost(c.id, saved.posts![0].id);
  await Promise.all([advancePublishing(c.id, api), advancePublishing(c.id, api)]);
  assert.equal(count, 1); assert.equal((await database).getCampaign(c.id).posts![0].providerId, "remote-1");
});
test("uncertain publishing responses are never automatically resubmitted", async () => {
  const pub = await import("../lib/campaigns/publishing"); const c = await publishFixture();
  const saved = pub.draftPost(c.id, { assetIds: ["approved"], caption: "Test", accountIds: [7], scheduledAt: new Date(Date.now() + 3600000).toISOString() });
  pub.queuePost(c.id, saved.posts![0].id); let count = 0;
  const api = { accounts: async () => [{ id: 7, platform: "instagram", username: "test", needs_reconnect: false }], upload: async (url: string) => ({ url }), request: async () => { count++; throw new Error("Lost response after provider accepted"); } };
  await pub.advancePublishing(c.id, api); await pub.advancePublishing(c.id, api);
  assert.equal(count, 1); assert.equal((await database).getCampaign(c.id).posts![0].status, "uncertain");
});
test("trend discovery records measured metadata and preserves selected references", async () => {
  const c = await fixture(); const { saveIntegrationKey } = await import("../lib/campaigns/integrations"); saveIntegrationKey("youtube", "test-key");
  const { discoverTrends } = await import("../lib/campaigns/trends");
  const fake: typeof fetch = async input => {
    const url = new URL(String(input));
    return Response.json(url.pathname.endsWith("/search") ? { items: [{ id: { videoId: "source-video" } }] } : { items: [{ id: "source-video", snippet: { title: "Morning routine", channelTitle: "Creator", publishedAt: new Date(Date.now() - 86400000).toISOString() }, statistics: { viewCount: "1000", likeCount: "50" } }] });
  };
  const result = await discoverTrends(c.id, "morning routine", "US", fake);
  assert.equal(result.trends![0].views, 1000); assert.equal(result.trends![0].url, "https://www.youtube.com/watch?v=source-video");
  result.trends![0].selected = true; (await database).saveCampaign(result);
  const refreshed = await discoverTrends(c.id, "morning routine", "US", fake);
  assert.equal(refreshed.trends!.length, 1); assert.equal(refreshed.trends![0].selected, true);
});

test("revoking approval during upload prevents the scheduled post request", async () => {
  const pub = await import("../lib/campaigns/publishing"); const c = await publishFixture();
  const saved = pub.draftPost(c.id, { assetIds: ["approved"], caption: "Test", accountIds: [7], scheduledAt: new Date(Date.now() + 3600000).toISOString() }); pub.queuePost(c.id, saved.posts![0].id);
  let count = 0;
  await pub.advancePublishing(c.id, { accounts: async () => [{ id: 7, platform: "instagram", username: "test", needs_reconnect: false }], upload: async url => { const latest = (await database).getCampaign(c.id); latest.assets[0].review = "rejected"; (await database).saveCampaign(latest); return { url }; }, request: async () => { count++; return { id: "unexpected" }; } });
  assert.equal(count, 0); assert.equal((await database).getCampaign(c.id).posts![0].status, "failed");
});

test("editing a caption makes a new pending version without altering approved copy", async () => {
  const c = await publishFixture(); c.assets.push({ id: "caption", messageId: "old", stepId: "old", title: "Caption", pack: "Pack", kind: "text", text: "Original", prompt: "Original", look: "", review: "approved", version: 1 }); (await database).saveCampaign(c);
  const result = (await services).reviseText(c.id, "caption", "New copy");
  assert.equal(result.assets.find(a => a.id === "caption")?.text, "Original");
  assert.equal(result.assets.at(-1)?.parentAssetId, "caption"); assert.equal(result.assets.at(-1)?.review, "pending");
});
