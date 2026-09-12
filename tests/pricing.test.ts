import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.HELIOS_DATA_DIR ??= mkdtempSync(join(tmpdir(), "ugc-pricing-test-"));
process.env.HELIOS_MEDIA_DIR ??= mkdtempSync(join(tmpdir(), "ugc-pricing-media-"));
import { KIE_PRICES, creditsToUsd, estimateKieImage, estimateKieVideo, resolveEstimate } from "../lib/pricing";
import { IMAGE_MODELS, VIDEO_MODELS } from "../lib/modelConfig";

test("published Kie.ai prices convert credits at $0.005 and follow quality, resolution, duration, audio and video input", () => {
  assert.equal(creditsToUsd(18), 0.09);
  assert.equal(estimateKieImage("nano-banana-pro")?.usd, 0.09); assert.equal(estimateKieImage("nano-banana-pro", "4k")?.usd, 0.12);
  assert.equal(estimateKieImage("gpt-image-2", "2k")?.usd, 0.05); assert.equal(estimateKieImage("z-image")?.usd, 0.004);
  assert.equal(estimateKieImage("seedream-5-pro"), undefined, "no published price on file");
  assert.equal(estimateKieVideo("kling-3.0-motion-control", { seconds: 5 })?.usd, 0.5);
  assert.equal(estimateKieVideo("kling-3.0-motion-control", { seconds: 8, resolution: "1080p" })?.credits, 216);
  assert.equal(estimateKieVideo("kling-3.0", { seconds: 5, resolution: "std" })?.usd, 0.35); assert.equal(estimateKieVideo("kling-3.0", { seconds: 5, resolution: "pro", sound: true })?.usd, 0.675);
  assert.equal(estimateKieVideo("seedance-2", { seconds: 5, resolution: "720p" })?.credits, 205, "no video input: rate × output");
  assert.equal(estimateKieVideo("seedance-2", { seconds: 5, resolution: "720p", inputSeconds: 5 })?.credits, 250, "with video input: lower rate × (input + output)");
  assert.equal(estimateKieVideo("veo3_fast", { resolution: "4k" })?.usd, 0.9);
  assert.equal(estimateKieVideo("gemini-omni-video", { seconds: 7, resolution: "720p" })?.credits, 84, "nearest published duration");
  assert.equal(estimateKieVideo("gemini-omni-video", { seconds: 5, resolution: "4k", inputSeconds: 5 })?.credits, 252);
  const known = Object.keys(KIE_PRICES), configured = [...IMAGE_MODELS, ...VIDEO_MODELS].map(m => m.id);
  for (const id of known) assert.ok(configured.includes(id), `${id} is priced but not configured`);
  for (const rule of Object.values(KIE_PRICES)) assert.match(rule.source, /^https:\/\/docs\.kie\.ai\//);
});

test("estimates resolve manual, then observed charges, then published, then unknown; accounts cost nothing", () => {
  assert.equal(resolveEstimate({ provider: "kie", modelId: "nano-banana-2", kind: "image", manualUsd: 0.2 }).basis, "manual");
  const learned = resolveEstimate({ provider: "kie", modelId: "nano-banana-2", kind: "image", actualCosts: [0.05, 0.03, 0.041] });
  assert.equal(learned.basis, "actual"); assert.equal(learned.usd, 0.041);
  assert.equal(resolveEstimate({ provider: "kie", modelId: "nano-banana-2", kind: "image" }).basis, "published");
  assert.equal(resolveEstimate({ provider: "kie", modelId: "seedream-5-pro", kind: "image" }).basis, "unknown");
  assert.deepEqual(resolveEstimate({ provider: "antigravity", modelId: "nano-banana-pro", kind: "image" }).usd, 0);
});

test("completed Kie.ai jobs record the credits actually charged, and later estimates use them", async () => {
  const { actualCostFromRecord } = await import("../lib/kieJobPoller");
  assert.equal(actualCostFromRecord({ creditsConsumed: 50 }), 0.25); assert.equal(actualCostFromRecord({}), undefined);
  const { insertProviderLedgerAttempt, settleProviderLedgerTask, recentActualCosts } = await import("../lib/guest/generationLedger");
  const { serverEstimate } = await import("../lib/campaigns/estimates");
  assert.equal(serverEstimate({ provider: "kie", modelId: "grok-imagine-image", kind: "image" }).basis, "published");
  for (const [task, credits] of [["t1", 4], ["t2", 4], ["t3", 6]] as const) {
    insertProviderLedgerAttempt({ taskId: task, provider: "kie", modelId: "grok-imagine-image", quotedCost: 0.02 });
    settleProviderLedgerTask(task, "done", undefined, actualCostFromRecord({ creditsConsumed: credits }), "/generated/x.png");
  }
  assert.deepEqual(recentActualCosts("kie", "grok-imagine-image").sort(), [0.02, 0.02, 0.03]);
  const learned = serverEstimate({ provider: "kie", modelId: "grok-imagine-image", kind: "image" });
  assert.equal(learned.basis, "actual"); assert.equal(learned.usd, 0.02);
});
