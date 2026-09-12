import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest } from "next/server";
process.env.HELIOS_DATA_DIR ??= mkdtempSync(join(tmpdir(), "ugc-agy-test-"));
process.env.HELIOS_MEDIA_DIR ??= mkdtempSync(join(tmpdir(), "ugc-agy-media-"));
const result = (json: unknown, prefix = "ERROR: logging before google.Init\n") => ({ stdout: `${prefix}${JSON.stringify(json)}\n`, stderr: "", code: 0 });

test("antigravity child environment never carries Gemini or Google API keys and prefers the CLI install dir", async () => {
  const { antigravityEnv, agyArgs } = await import("../lib/antigravityAccount");
  const before = { g: process.env.GEMINI_API_KEY, k: process.env.GOOGLE_API_KEY, v: process.env.GOOGLE_GENAI_USE_VERTEXAI };
  try {
    process.env.GEMINI_API_KEY = "test"; process.env.GOOGLE_API_KEY = "test"; process.env.GOOGLE_GENAI_USE_VERTEXAI = "1";
    const env = antigravityEnv();
    for (const key of ["GEMINI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_GENAI_USE_VERTEXAI", "OPENAI_API_KEY", "KIE_API_TOKEN"]) assert.equal(key in env, false, key);
    assert.match(env.PATH!, /\.local\/bin/);
  } finally { for (const [k, v] of [["GEMINI_API_KEY", before.g], ["GOOGLE_API_KEY", before.k], ["GOOGLE_GENAI_USE_VERTEXAI", before.v]] as const) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
  const args = agyArgs("prompt", "/tmp/ws", "gemini-3.8-flash-high", 240_000);
  assert.ok(args.includes("--sandbox") && args.includes("--disable-slash-commands") && !args.includes("--dangerously-skip-permissions"));
  assert.deepEqual(args.slice(0, 2), ["-p", "prompt"]); assert.equal(args[args.indexOf("--print-timeout") + 1], "4m");
});

test("account status parses the models list and reports image generation as native", async () => {
  const { getAntigravityStatus } = await import("../lib/antigravityAccount");
  process.env.HELIOS_ANTIGRAVITY_BIN = process.execPath; // any existing file stands in for the CLI
  const ok = await getAntigravityStatus(true, async () => ({ stdout: "Fetching available models...\ngemini-3.1-pro-high\tGemini 3.1 Pro (High)\ngemini-3.8-flash-low\tGemini 3.8 Flash (Low)\n", stderr: "", code: 0 }));
  assert.equal(ok.chatReady, true); assert.equal(ok.imageReady, true); assert.deepEqual(ok.models, ["gemini-3.1-pro-high", "gemini-3.8-flash-low"]);
  const signedOut = await getAntigravityStatus(true, async () => ({ stdout: "", stderr: "not signed in", code: 1 }));
  assert.equal(signedOut.chatReady, false); assert.match(signedOut.note!, /not signed in/);
});

test("runAgy reads the JSON result after housekeeping lines and surfaces denials, limits and auth failures", async () => {
  const { runAgy, parseAgyJson } = await import("../lib/antigravityAccount");
  process.env.HELIOS_ANTIGRAVITY_BIN = process.execPath;
  assert.equal(parseAgyJson("noise\n{\"conversation_id\":\"c1\",\"status\":\"SUCCESS\",\"response\":\"{}\"}\n")?.conversation_id, "c1");
  const run = await runAgy({ prompt: "p", workspace: "/tmp", spawner: async () => result({ conversation_id: "c2", status: "SUCCESS", response: "```json\n{\"a\":1}\n```", denied_actions: [{ action: "command", display_name: "RunCommand" }] }) });
  assert.equal(run.conversationId, "c2"); assert.deepEqual(run.denied, ["RunCommand"]);
  await assert.rejects(() => runAgy({ prompt: "p", workspace: "/tmp", spawner: async () => ({ stdout: "", stderr: "ERROR: not signed in", code: 1 }) }), /not signed in/);
  await assert.rejects(() => runAgy({ prompt: "p", workspace: "/tmp", spawner: async () => result({ status: "ERROR", error: "quota exceeded" }) }), /usage limit/);
  await assert.rejects(() => runAgy({ prompt: "p", workspace: "/tmp", spawner: async () => ({ stdout: "", stderr: "", code: null }) }), /timed out/);
});

test("the Antigravity planner mirrors the Codex planner: local images become view_file targets and the answer streams as one delta", async () => {
  const { agyPlanner, agyPrompt } = await import("../lib/campaigns/agyPlanner");
  const { parseJSON } = await import("../lib/campaigns/director/types");
  const { readText } = await import("../lib/campaigns/service");
  const { getAntigravityStatus } = await import("../lib/antigravityAccount");
  process.env.HELIOS_ANTIGRAVITY_BIN = process.execPath;
  await getAntigravityStatus(true, async () => ({ stdout: "gemini-3.1-pro-high\tGemini\n", stderr: "", code: 0 }));
  const prompt = agyPrompt([{ role: "user", content: "Rate this" }], ["/tmp/ws/reference-0.png"], true);
  assert.match(prompt, /view_file/); assert.match(prompt, /search_web/); assert.match(prompt, /Do NOT run commands/);
  let seen = "";
  const response = await agyPlanner(new NextRequest("http://localhost/api/assistant", { method: "POST", body: JSON.stringify({ messages: [{ role: "user", content: "Return {\"ok\":true}" }], imageUrls: ["https://remote.example/x.png"] }) }), { spawner: async (_bin, args) => { seen = args[1]; return result({ conversation_id: "c3", status: "SUCCESS", response: "```json\n{\"ok\":true}\n```" }); } });
  assert.match(seen, /Do not use web search/); assert.ok(!/view_file/.test(seen), "remote URLs are never fetched or attached");
  assert.deepEqual(parseJSON(await readText(response)), { ok: true });
});

test("campaign defaults, settings and director runs recognise the Google account", async () => {
  const { campaignDefaults, ANTIGRAVITY_CHAT_MODEL, CODEX_CHAT_MODEL } = await import("../lib/campaigns/providers");
  const { agentProviderOf, isAccountChatModel } = await import("../lib/campaigns/agents");
  assert.deepEqual(campaignDefaults({ chatReady: false, imageReady: false }, { chatReady: true, imageReady: true }), { model: ANTIGRAVITY_CHAT_MODEL, imageModel: "nano-banana-pro", imageProvider: "antigravity" });
  assert.equal(campaignDefaults({ chatReady: true, imageReady: false }, { chatReady: true, imageReady: true }).model, CODEX_CHAT_MODEL);
  assert.equal(campaignDefaults({ chatReady: true, imageReady: false }, { chatReady: true, imageReady: true }).imageProvider, "antigravity");
  assert.equal(agentProviderOf({ model: ANTIGRAVITY_CHAT_MODEL }), "antigravity"); assert.equal(agentProviderOf({ model: "gpt-5" }), "codex"); assert.ok(isAccountChatModel(ANTIGRAVITY_CHAT_MODEL));
  const db = await import("../lib/campaigns/db"), e = await import("../lib/campaigns/director/engine");
  const c = db.createCampaign({ model: ANTIGRAVITY_CHAT_MODEL, imageModel: "nano-banana-pro", imageProvider: "antigravity" });
  const started = e.startDirector(c.id, { objective: "Adapt a Reel using the Google account for reasoning", sourceUrls: ["https://www.tiktok.com/@test/video/1"] });
  assert.equal(started.directors![0].agentProvider, "antigravity"); assert.equal(started.directors![0].imageProvider, "antigravity");
  const { POST } = await import("../app/api/campaigns/[id]/route");
  const idle = db.createCampaign({ model: ANTIGRAVITY_CHAT_MODEL, imageModel: "nano-banana-pro", imageProvider: "antigravity" });
  const bad = await POST(new NextRequest("http://localhost/api/campaigns/x", { method: "POST", body: JSON.stringify({ action: "settings", imageProvider: "antigravity", imageModel: "gpt-image-2" }) }), { params: Promise.resolve({ id: idle.id }) });
  assert.equal(bad.status, 400); assert.match((await bad.json()).error, /Nano Banana Pro/);
});
