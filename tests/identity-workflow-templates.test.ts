import assert from "node:assert/strict";
import test from "node:test";
import { IDENTITY_TEMPLATES, makeIdentityTemplate } from "../lib/templates";

test("every identity template is a connected graph that starts from the identity node", () => {
  assert.equal(IDENTITY_TEMPLATES.length, 6);
  for (const info of IDENTITY_TEMPLATES) {
    const t = makeIdentityTemplate(info.id)!;
    assert.ok(t, info.id);
    const ids = new Set(t.nodes.map(n => n.id));
    assert.ok(ids.has("clone-identity"), `${info.id} has the identity node`);
    assert.ok(t.edges.every(e => ids.has(e.source) && ids.has(e.target)), `${info.id} edges point at real nodes`);
    assert.ok(t.edges.some(e => e.source === "clone-identity"), `${info.id} uses the identity`);
    const generators = t.nodes.filter(n => n.type === "generateNode" || n.type === "batchQueueNode" || n.type === "videoGeneratorNode");
    assert.ok(generators.length >= 1, `${info.id} generates something`);
    for (const g of t.nodes.filter(n => n.type === "generateNode")) {
      assert.ok(t.edges.some(e => e.target === g.id && e.targetHandle === "prompt"), `${g.id} has a prompt`);
      assert.ok(t.edges.some(e => e.target === g.id && e.sourceHandle === "referencesOut"), `${g.id} receives identity references`);
    }
    for (const p of t.nodes.filter(n => n.type === "templateNode")) assert.match(String(p.data.template), /@identity/, `${p.id} splices the identity DNA`);
    assert.equal(t.metadata.contentClass, "sfw");
  }
  assert.equal(makeIdentityTemplate("nope"), null);
  const reel = makeIdentityTemplate("selfie-to-reel")!;
  assert.ok(reel.edges.some(e => e.source === "reel-generate" && e.target === "reel-video" && e.targetHandle === "startFrame"), "the selfie becomes the Reel's start frame");
  const pack = makeIdentityTemplate("reference-sheet-pack")!;
  assert.deepEqual(pack.nodes.filter(n => n.type === "generateNode").map(n => n.data.aspectRatio), ["3:4", "3:4", "16:9"]);
});
