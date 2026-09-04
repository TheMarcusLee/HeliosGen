import assert from "node:assert/strict";
import test from "node:test";
import type { Edge, Node } from "@xyflow/react";
import { annotationBounds, annotationPath } from "../lib/annotations";
import { applyComfyBindings, deriveComfyBindings, extractComfyOutputFiles, validateComfyApiWorkflow } from "../lib/comfyWorkflow";
import { convertNodeBananaWorkflow } from "../lib/nodeBananaConverter";
import { renderPromptTemplate } from "../lib/templateVariables";
import { buildPoseOutfitMatrix, normalizeIdentityDefaults, validateContentRoute } from "../lib/cloneMe";
import { resolveIdentityAssetId } from "../lib/executor";
import type { NodeData } from "../lib/store";
import { makePoseOutfitBatchTemplate, makeSceneReplacementTemplate } from "../lib/templates";

const comfyWorkflow = {
  "1": { class_type: "CLIPTextEncode", inputs: { text: "portrait", clip: ["3", 0] }, _meta: { title: "Positive prompt" } },
  "2": { class_type: "LoadImage", inputs: { image: "source.png", upload: "image" } },
  "3": { class_type: "KSampler", inputs: { steps: 20, cfg: 7.5, seed: 1, model: ["4", 0] } },
};

test("derives and applies typed primitive ComfyUI bindings", () => {
  validateComfyApiWorkflow(comfyWorkflow);
  const bindings = deriveComfyBindings(comfyWorkflow);
  assert.equal(bindings.find((binding) => binding.id === "1:text")?.kind, "prompt");
  assert.equal(bindings.find((binding) => binding.id === "2:image")?.kind, "image");
  assert.equal(bindings.find((binding) => binding.id === "3:steps")?.valueType, "number");
  assert.equal(bindings.some((binding) => binding.inputName === "clip"), false);
  const updated = applyComfyBindings(comfyWorkflow, [{ ...bindings[0], value: "editorial portrait" }]);
  assert.equal((updated["1"] as { inputs: { text: string } }).inputs.text, "editorial portrait");
  assert.equal(comfyWorkflow["1"].inputs.text, "portrait");
});

test("rejects UI-format ComfyUI workflow JSON", () => {
  assert.throws(() => validateComfyApiWorkflow({ nodes: [], links: [] }), /API format/);
});

test("extracts unique media outputs from ComfyUI history", () => {
  const files = extractComfyOutputFiles({ run: { outputs: { "8": { images: [
    { filename: "result.png", subfolder: "", type: "output" },
    { filename: "result.png", subfolder: "", type: "output" },
  ], gifs: [{ filename: "clip.webp", subfolder: "video", type: "output" }] } } } });
  assert.deepEqual(files.map((file) => file.filename), ["result.png", "clip.webp"]);
});

test("converts supported Node Banana nodes, handles, and unsupported notes", () => {
  const converted = convertNodeBananaWorkflow({
    name: "Imported campaign",
    nodes: [
      { id: "p", type: "prompt", position: { x: 0, y: 0 }, data: { prompt: "studio portrait" } },
      { id: "i", type: "imageInput", position: { x: 0, y: 100 }, data: { imageUrl: "/reference.png" } },
      { id: "g", type: "generateImage", position: { x: 300, y: 0 }, data: { selectedModel: { modelId: "vendor/image", displayName: "Image" } } },
      { id: "x", type: "mystery", position: { x: 600, y: 0 }, data: {} },
    ],
    edges: [
      { id: "e1", source: "p", target: "g", sourceHandle: "text-0", targetHandle: "text-0" },
      { id: "e2", source: "i", target: "g", sourceHandle: "image-0", targetHandle: "image-0" },
    ],
  });
  assert.equal(converted.name, "Imported campaign");
  assert.deepEqual(converted.nodes.map((node) => node.type), ["promptNode", "imageInputNode", "waveSpeedNode", "commentNode"]);
  assert.equal(converted.edges[0].sourceHandle, undefined);
  assert.equal(converted.edges[0].targetHandle, "ws:prompt");
  assert.equal(converted.edges[1].targetHandle, "ws:image");
  assert.deepEqual(converted.unsupportedNodeTypes, ["mystery"]);
});

test("renders prompt variables and preserves unresolved placeholders", () => {
  assert.deepEqual(renderPromptTemplate("@person in @place with @missing", { person: "Ava", place: "Paris" }), {
    output: "Ava in Paris with @missing",
    unresolved: ["missing"],
  });
});

test("computes stable annotation geometry", () => {
  assert.deepEqual(annotationBounds([]), { x: 0, y: 0, width: 0, height: 0 });
  assert.deepEqual(annotationBounds([{ x: 7, y: 9 }, { x: 2, y: 4 }]), { x: 2, y: 4, width: 5, height: 5 });
  assert.equal(annotationPath([{ x: 1.04, y: 2.06 }, { x: 3, y: 4 }]), "M1.0,2.1 L3.0,4.0");
});

test("builds a pose/outfit cross-product from one shared analysis", () => {
  const items = buildPoseOutfitMatrix({
    identity: { triggerWord: "AVA_PERSON", basePrompts: ["Editorial realism"] },
    poses: ["standing", "seated"],
    outfits: ["black dress", "linen suit", "streetwear"],
    analysis: "Soft window light, 50mm portrait",
  });
  assert.equal(items.length, 6);
  assert.equal(items.every((item) => item.prompt.includes("Soft window light, 50mm portrait")), true);
  assert.equal(new Set(items.map((item) => `${item.pose}/${item.outfit}`)).size, 6);
});

test("normalizes identity production defaults", () => {
  assert.deepEqual(normalizeIdentityDefaults(undefined), { contentClass: "sfw", aspectRatio: "9:16" });
  assert.deepEqual(normalizeIdentityDefaults({ contentClass: "adult", provider: "wavespeed", modelId: "vendor/model", aspectRatio: "4:5" }), {
    contentClass: "adult", provider: "wavespeed", modelId: "vendor/model", aspectRatio: "4:5",
  });
  assert.deepEqual(normalizeIdentityDefaults({ provider: "unknown", modelId: "" }), { contentClass: "sfw" });
});

test("resolves identity provenance through intermediate workflow nodes", () => {
  const nodes: Node<NodeData>[] = [
    { id: "identity", type: "identityMatrixNode", position: { x: 0, y: 0 }, data: { label: "Identity", status: "idle", identityAssetId: "person-1" } },
    { id: "template", type: "templateNode", position: { x: 1, y: 0 }, data: { label: "Template", status: "idle" } },
    { id: "generate", type: "generateNode", position: { x: 2, y: 0 }, data: { label: "Generate", status: "idle" } },
  ];
  const edges: Edge[] = [
    { id: "one", source: "identity", target: "template" },
    { id: "two", source: "template", target: "generate" },
  ];
  assert.equal(resolveIdentityAssetId("generate", nodes, edges), "person-1");
});

test("requires exact audited routing and adult consent assurances", () => {
  const metadata = { contentClass: "adult" as const, routes: { adult: { provider: "wavespeed" as const, modelId: "vendor/model" } }, adultAssurances: { allSubjectsAdults: true, consentVerified: true } };
  assert.equal(validateContentRoute({ prompt: "adult editorial portrait", metadata, provider: "wavespeed", modelId: "vendor/model" }).contentClass, "adult");
  assert.throws(() => validateContentRoute({ prompt: "adult editorial portrait", metadata, provider: "kie", modelId: "vendor/model" }), /locked/);
  assert.throws(() => validateContentRoute({ prompt: "deepfake nude without her consent", metadata, provider: "wavespeed", modelId: "vendor/model" }), /non-consensual/);
  assert.throws(() => validateContentRoute({ prompt: "rape fantasy portrait", metadata, provider: "wavespeed", modelId: "vendor/model" }), /non-consensual/);
  assert.throws(() => validateContentRoute({ prompt: "explicit nude minor", metadata, provider: "wavespeed", modelId: "vendor/model" }), /minors/);
  assert.throws(() => validateContentRoute({ prompt: "nude 16-year-old", metadata, provider: "wavespeed", modelId: "vendor/model" }), /minors/);
  assert.throws(() => validateContentRoute({ prompt: "general portrait", metadata: { contentClass: "sfw", routingRequired: true, routes: {} }, provider: "kie", modelId: "nano-banana-2" }), /explicit provider/);
});

test("ships executable CloneMe scene and batch workflow templates", () => {
  const scene = makeSceneReplacementTemplate();
  assert.deepEqual(scene.nodes.map((node) => node.type), ["identityMatrixNode", "imageInputNode", "promptNode", "assistantNode", "templateNode", "generateNode", "commentNode"]);
  assert.equal(scene.edges.some((edge) => edge.target === "clone-analysis" && edge.targetHandle === "image"), true);
  assert.equal(scene.edges.some((edge) => edge.source === "clone-identity" && edge.sourceHandle === "referencesOut" && edge.target === "clone-generate"), true);
  assert.deepEqual(scene.metadata.routes.sfw, { provider: "kie", modelId: "nano-banana-2" });
  const batch = makePoseOutfitBatchTemplate();
  assert.equal(batch.nodes.some((node) => node.type === "batchQueueNode"), true);
  assert.equal(batch.edges.some((edge) => edge.targetHandle === "identity"), true);
  assert.equal(batch.edges.some((edge) => edge.targetHandle === "analysis"), true);
});
