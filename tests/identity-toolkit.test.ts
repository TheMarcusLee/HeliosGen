import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.HELIOS_DATA_DIR ??= mkdtempSync(join(tmpdir(), "ugc-toolkit-test-"));
process.env.HELIOS_MEDIA_DIR ??= mkdtempSync(join(tmpdir(), "ugc-toolkit-media-"));
import { closestOption, normalizeTraits, parseTraits, traitsToPrompt, TRAIT_FIELDS } from "../lib/identityTraits";
import { REFERENCE_STYLES, referenceSheetPrompt, referenceStyle } from "../lib/referenceSheets";
const templates = import("../lib/identityTemplates");

test("a fresh install is seeded with the shipped personas, and removing one sticks", async () => {
  const { listTemplates, templateCategories, deleteTemplate, ensureSeeded, getTemplate } = await templates;
  const all = listTemplates();
  assert.equal(all.length, 96); assert.ok(all.every(t => t.imageUrl?.startsWith("/persona-templates/") && t.prompt.length > 40));
  assert.ok(templateCategories().length >= 19);
  const first = all[0]; deleteTemplate(first.id); ensureSeeded();
  assert.equal(getTemplate(first.id), undefined); assert.equal(listTemplates().length, 95);
});

test("traits snap to the vocabulary and compose one locked-features prompt", async () => {
  const field = (key: string) => TRAIT_FIELDS.find(f => f.key === key)!;
  assert.equal(closestOption(field("hair_color"), "dark chocolate brown"), "dark-brown");
  assert.equal(closestOption(field("age_range"), "approx 23"), "22-25");
  assert.equal(closestOption(field("age_range"), "early 30s"), "28-32");
  assert.equal(closestOption(field("ethnicity"), "White / Caucasian"), "white-caucasian");
  assert.equal(closestOption(field("eye_shape"), "purple"), undefined);
  assert.equal(closestOption(field("skin_tone"), "light olive"), "light olive");
  const traits = normalizeTraits({ gender: "female", ageRange: "22-25", ethnicity: "east-asian", eyeColor: "dark brown", faceShape: "heart", hairColor: "black", hairLength: "short", hairStyle: "straight", bodyShape: "slim", skinTone: "fair", skinUndertone: "cool", nonsense: "x", appearanceDetails: "small mole under the left eye" });
  assert.equal(traits.eye_color, "dark-brown"); assert.equal(traits.nonsense, undefined);
  const prompt = traitsToPrompt(traits);
  assert.match(prompt, /^An east asian woman in her early 20s with dark brown eyes, heart face\./); assert.match(prompt, /Small mole under the left eye\.$/);
  assert.match(prompt, /Fair skin with cool undertones, natural skin texture with visible pores\./); assert.match(prompt, /Black, short, straight hair\./); assert.match(prompt, /Slim build\./);
  const parsed = await parseTraits("A striking Nordic woman around 27 with platinum blonde waves", async p => { assert.match(p, /"platinum-blonde"/); return "```json\n{\"gender\":\"female\",\"age_range\":\"25-27\",\"hairColor\":\"platinum-blonde\",\"hair_style\":\"wavy\",\"suggested_name\":\"Astrid\"}\n```"; });
  assert.deepEqual(parsed, { traits: { gender: "female", age_range: "25-27", hair_color: "platinum-blonde", hair_style: "wavy" }, suggestedName: "Astrid" });
});

test("reference sheet prompts place the identity's locked description into a studio format", () => {
  assert.ok(REFERENCE_STYLES.length >= 8);
  const comp = referenceStyle("comp-card")!;
  const withRefs = referenceSheetPrompt({ basePrompts: ["A 27-year-old Nordic woman with platinum blonde waves.", "Locked features. eye color: blue."], references: [{ url: "/generated/a.png" }] }, comp);
  assert.match(withRefs, /^Create a photo of the same person from the reference images, keeping their exact face, features and proportions: A 27-year-old Nordic woman/);
  assert.match(withRefs, /model comp card layout/); assert.match(withRefs, /white_cyclorama\.fx/); assert.match(withRefs, /No text, no watermarks/);
  const noRefs = referenceSheetPrompt({ basePrompts: [], references: [] }, referenceStyle("headshots")!);
  assert.match(noRefs, /^Create a photo of the person described by the reference images/);
  assert.equal(comp.kind, "body"); assert.equal(referenceStyle("headshots")!.kind, "face");
});
