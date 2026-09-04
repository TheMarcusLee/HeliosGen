import assert from "node:assert/strict";
import test from "node:test";
import { annotationBounds, annotationPath } from "../lib/annotations";
import { applyComfyBindings, deriveComfyBindings, extractComfyOutputFiles, validateComfyApiWorkflow } from "../lib/comfyWorkflow";
import { convertNodeBananaWorkflow } from "../lib/nodeBananaConverter";
import { renderPromptTemplate } from "../lib/templateVariables";

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
