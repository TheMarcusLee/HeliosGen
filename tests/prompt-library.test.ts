import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.HELIOS_DATA_DIR ??= mkdtempSync(join(tmpdir(), "ugc-prompts-test-"));
process.env.HELIOS_MEDIA_DIR ??= mkdtempSync(join(tmpdir(), "ugc-prompts-media-"));
import type { Ask } from "../lib/promptEngineering";
// Dynamic imports: a static import would evaluate DATA_DIR before the env above is set and touch the real database.
const library = import("../lib/promptLibrary");
const engineering = import("../lib/promptEngineering");

const supabaseExport = { rows: [
  { id: "a1", prompt_text: "Subject: A young woman in her mid-20s in cream ribbed cotton pajamas on a beige sofa, warm 2700K lamp light, 26mm selfie.", categories: ["female", "selfie", "Interior Setting"], is_favorite: true, image_urls: ["https://example.com/a.png"], analysis_json: { meta: { image_style: "Selfie" } }, created_at: "2026-02-03T22:52:40.552091+00:00" },
  { id: "a2", prompt_text: "Constraints: 3:4 aspect ratio, cobalt bikini at a Mediterranean hotel pool, hard 5500K sun, 35mm full body.", categories: ["female", "outdoor setting", "summer aesthetic"] },
]};

test("imports the Supabase export shape and plain prompts, deduplicating bodies", async () => {
  const { importPrompts, listPrompts, normalizeImport, libraryStats } = await library;
  const first = importPrompts(supabaseExport);
  assert.deepEqual(first, { added: 2, updated: 0, skipped: 0 });
  const again = importPrompts([{ prompt: "Subject: A young woman in her mid-20s in cream ribbed cotton pajamas on a beige sofa, warm 2700K lamp light, 26mm selfie." }, { prompt: "Golden hour rooftop portrait, 85mm, backlit hair." }]);
  assert.deepEqual(again, { added: 1, updated: 0, skipped: 1 });
  const seeded = libraryStats().total - 3; // whatever the shipped starter set contributes
  const stats = libraryStats();
  assert.equal(stats.total - seeded, 3); assert.equal(stats.favorites, 1);
  assert.ok(stats.categories.some(c => c.name === "interior setting"), "categories are normalised to lowercase tags");
  assert.deepEqual(importPrompts({ prompts: [{ id: "a1", prompt: "Updated body", categories: ["female"], is_favorite: true }] }), { added: 0, updated: 1, skipped: 0 });
  assert.equal(libraryStats().total - seeded, 3, "an update by id does not add a row");
  assert.equal(normalizeImport("nonsense").length, 0);
  assert.equal(listPrompts({ query: "cobalt bikini" }).total, 1);
  const female = listPrompts({ category: "Female", limit: 500 }).items.map(i => i.id); assert.ok(female.includes("a1") && female.includes("a2"), "category filter is case-insensitive");
});

test("relevance scoring prefers keyword and category overlap, and style references are truncated", async () => {
  const { relevantPrompts, styleReferences, savePrompt } = await library;
  savePrompt({ prompt: "x".repeat(900) + " pool", categories: ["outdoor setting"] });
  const hits = relevantPrompts("A bikini shoot by the hotel pool in hard sun", 2, ["summer aesthetic"]);
  assert.equal(hits[0].id, "a2");
  const refs = styleReferences("hotel pool", 3, 100);
  assert.ok(refs.every(r => r.excerpt.length <= 101));
  assert.equal(relevantPrompts("zzzz qqqq", 3).length, 0, "no hits means no references, never random ones");
});

test("the builder pipeline runs analysis, structured and prose passes through one Ask, in the form the image model reads best", async () => {
  const { buildPrompt, enhanceForModel, flattenStructured, negativesOf, promptFormatFor } = await engineering;
  const calls: string[] = [];
  const ask: Ask = async (prompt, images = []) => {
    calls.push(images.length ? "image" : prompt.startsWith("You are PromptAnalyzer") ? "analyze" : prompt.includes("Nano Banana Pro") ? "structured" : prompt.includes("narrative prose") ? "prose" : prompt.includes("Create a variation") ? "remix" : "describe");
    if (calls.at(-1) === "analyze" || calls.at(-1) === "image") return "```json\n{\"global\":{\"scene_description\":\"couch\"}}\n```";
    if (calls.at(-1) === "structured") return JSON.stringify({ subject: "A woman in her mid-20s with realistic skin texture with visible pores", pose: "Reclining", camera: "26mm selfie", controlnet: { x: 1 }, negative_prompt: { forbidden_elements: ["plastic skin", "skin smoothing"] } });
    if (calls.at(-1) === "prose") return JSON.stringify({ prompt: "A woman in her mid-20s reclines on a couch, visible pores and an unretouched complexion under warm 2700K light." });
    if (calls.at(-1) === "remix") return JSON.stringify({ prompt: "Same shot in a black slip dress.", categories: ["female", "evening"] });
    return "A detailed prompt about a pool.\nCATEGORIES: outdoor setting, summer";
  };
  const enhanced = await buildPrompt({ mode: "enhance", text: "woman on a couch" }, ask);
  assert.deepEqual(calls, ["analyze", "structured", "prose"]);
  assert.match(enhanced.prompt, /^Subject: A woman in her mid-20s/); assert.match(enhanced.prompt, /\n\nPose: Reclining/);
  assert.equal(enhanced.negatives, "plastic skin, skin smoothing"); assert.ok(enhanced.categories.includes("female")); assert.equal(enhanced.prose?.startsWith("A woman"), true);
  const forNano = await enhanceForModel("woman on a couch", "nano-banana-pro", ask);
  assert.equal(forNano.format, "structured"); assert.doesNotMatch(forNano.prompt, /controlnet/); assert.match(forNano.prompt, /"subject"/);
  const forGpt = await enhanceForModel("woman on a couch", "gpt-image-2.5-flare", ask);
  assert.equal(forGpt.format, "prose"); assert.match(forGpt.prompt, /^A woman in her mid-20s reclines/);
  const described = await buildPrompt({ mode: "describe", description: "bikini by the hotel pool" }, ask);
  assert.equal(described.prompt, "A detailed prompt about a pool."); assert.deepEqual(described.categories, ["outdoor setting", "summer"]); assert.ok(described.exampleIds.includes("a2"), "library examples are used as few-shot references");
  const remixed = await buildPrompt({ mode: "remix", basePromptId: "a2", variation: "black slip dress" }, ask);
  assert.equal(remixed.basePromptId, "a2"); assert.equal(remixed.prompt, "Same shot in a black slip dress."); assert.ok(remixed.categories.includes("evening") && remixed.categories.includes("summer aesthetic"), "JSON-wrapped answers and the base prompt's tags both count");
  await assert.rejects(buildPrompt({ mode: "image" }, ask), /Attach an image/);
  assert.equal(promptFormatFor("grok-imagine-image-2"), "prose");
  assert.equal(flattenStructured({ subject: "a", environment: "b", junk: "c" }), "Subject: a\n\nEnvironment: b");
  assert.match(negativesOf(null), /plastic skin/);
});

test("the shipped starter prompts seed once and a removed one stays removed", async () => {
  const { listPrompts, deletePrompt, ensureSeeded, getPrompt } = await library;
  const seeds = listPrompts({ limit: 500 }).items.filter(p => p.origin === "seed");
  assert.ok(seeds.length >= 18, `starter set present (${seeds.length})`);
  assert.ok(seeds.every(p => p.prose && p.structured && p.categories.includes("photorealism") && !p.source), "every seed is a full builder output with no third-party source");
  deletePrompt(seeds[0].id); ensureSeeded();
  assert.equal(getPrompt(seeds[0].id), undefined);
});
