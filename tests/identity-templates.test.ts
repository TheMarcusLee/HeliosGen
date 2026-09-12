import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.HELIOS_DATA_DIR ??= mkdtempSync(join(tmpdir(), "ugc-templates-test-"));
process.env.HELIOS_MEDIA_DIR ??= mkdtempSync(join(tmpdir(), "ugc-templates-media-"));
const templates = import("../lib/identityTemplates");
const formats = import("../lib/campaigns/formats");
const identities = import("../lib/guest/identityAssets");

test("templates import from an App Promo Factory export and become identities with a mirrored reference", async () => {
  const { importTemplates, listTemplates, templateCategories, materializeTemplate, normalizeTemplates, getTemplate } = await templates;
  const { getIdentityAsset } = await identities;
  const exported = [
    { id: "t1", name: "Olivia Rose", subtitle: "Soft Girl Aesthetic", category: "plus-size", gender: "female", age_range: "22-25", ethnicity: "white-caucasian", eye_color: "blue", hair_color: "dyed-custom", body_shape: "plus-size", prompt_value: "A beautiful 24-year-old plus-size woman with pastel pink waves.", image_url: "https://example.com/olivia.png", sort_order: 34 },
    { name: "Marcus", category: "streetwear", gender: "male", prompt: "A confident 25-year-old man with a fade.", imageUrl: "/generated/templates/marcus.png" },
    { name: "No prompt" },
    { name: "Bad image", prompt: "x", image_url: "javascript:alert(1)" },
  ];
  assert.equal(normalizeTemplates("junk").length, 0);
  assert.deepEqual(importTemplates(exported), { added: 3, updated: 0 });
  assert.deepEqual(importTemplates({ templates: [exported[0]] }), { added: 0, updated: 1 });
  assert.equal(getTemplate("t1")?.traits.eye_color, "blue"); assert.equal(getTemplate("t1")?.ageRange, "22-25");
  assert.equal(listTemplates({ gender: "male" }).length, 1); assert.equal(listTemplates({ query: "pink" })[0].id, "t1");
  assert.ok(templateCategories().some(c => c.name === "plus-size" && c.count === 1));
  assert.equal(listTemplates().find(t => t.name === "Bad image")?.imageUrl, null, "unsafe image URLs are dropped");
  const mirrored: string[] = [];
  const identity = await materializeTemplate("t1", async url => { mirrored.push(url); return "/generated/identity-templates/olivia.png"; });
  assert.deepEqual(mirrored, ["https://example.com/olivia.png"]);
  assert.equal(identity.name, "Olivia Rose"); assert.equal(identity.triggerWord, "olivia_rose");
  assert.deepEqual(identity.references, [{ url: "/generated/identity-templates/olivia.png", kind: "face", label: "Olivia Rose template" }]);
  assert.match(identity.basePrompts[0], /pastel pink/); assert.match(identity.basePrompts[1], /eye color: blue/);
  assert.equal(getIdentityAsset(identity.id)?.name, "Olivia Rose", "the identity is persisted");
  await assert.rejects(materializeTemplate("missing", async u => u), /not found/);
});

test("the format playbook exposes beat skeletons for the planner", async () => {
  const { CAMPAIGN_FORMATS, getFormat, formatBrief } = await formats;
  assert.ok(CAMPAIGN_FORMATS.length >= 17);
  const brief = formatBrief(getFormat("friction-to-relief"))!;
  assert.equal(brief.beats[0], "Name the friction precisely"); assert.equal(brief.category, "Problem first"); assert.ok(brief.channels.includes("TikTok"));
  assert.equal(formatBrief(getFormat("nope")), undefined);
});
