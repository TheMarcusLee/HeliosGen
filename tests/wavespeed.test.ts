import assert from "node:assert/strict";
import test from "node:test";
import { isWaveSpeedMediaModel } from "../lib/wavespeed";
import {
  areWaveSpeedModelsFallbackCompatible,
  buildWaveSpeedInput,
  remapWaveSpeedInput,
  defaultWaveSpeedParameters,
  validateWaveSpeedInput,
  waveSpeedInputKind,
} from "../lib/wavespeedSchema";

test("classifies WaveSpeed models by generated media rather than input media", () => {
  assert.equal(isWaveSpeedMediaModel({ type: "text-to-image" }, "image"), true);
  assert.equal(isWaveSpeedMediaModel({ type: "image-to-image" }, "image"), true);
  assert.equal(isWaveSpeedMediaModel({ type: "image-to-video" }, "image"), false);
  assert.equal(isWaveSpeedMediaModel({ type: "image-to-video" }, "video"), true);
  assert.equal(isWaveSpeedMediaModel({ type: "video-to-text" }, "video"), false);
  assert.equal(isWaveSpeedMediaModel({ type: "lora-support", modelId: "wavespeed-ai/wan-2.2/i2v-720p-lora" }, "video"), true);
  assert.equal(isWaveSpeedMediaModel({ type: "lora-support", modelId: "wavespeed-ai/flux-dev-lora" }, "image"), true);
  assert.equal(isWaveSpeedMediaModel({ type: "portrait-transfer", modelId: "wavespeed-ai/video-face-swap" }, "image"), false);
  assert.equal(isWaveSpeedMediaModel({ type: "portrait-transfer", modelId: "wavespeed-ai/image-face-swap" }, "image"), true);
});

test("builds schema-driven inputs with connected values taking precedence", () => {
  const schema = {
    properties: {
      prompt: { type: "string" },
      image: { type: "string" },
      duration: { type: "integer", default: 5 },
      enable_sync_mode: { type: "boolean", default: true },
    },
    required: ["image"],
    "x-order-properties": ["image", "prompt", "duration", "enable_sync_mode"],
  };
  assert.deepEqual(defaultWaveSpeedParameters(schema), { duration: 5 });
  const input = buildWaveSpeedInput(schema, { prompt: "typed", duration: 7 }, { prompt: "connected", image: "https://example.com/a.jpg" });
  assert.deepEqual(input, { prompt: "connected", duration: 7, image: "https://example.com/a.jpg" });
  assert.deepEqual(validateWaveSpeedInput(schema, input), []);
  assert.equal(waveSpeedInputKind("last_image", schema.properties.image), "image");
});

test("rejects fallback models that require an unavailable media kind", () => {
  const primary = { modelId: "vendor/text-to-image", type: "text-to-image", requestSchema: { properties: { prompt: { type: "string" } }, required: ["prompt"] } };
  const compatible = { modelId: "vendor/other-image", type: "text-to-image", requestSchema: { properties: { prompt: { type: "string" } }, required: ["prompt"] } };
  const incompatible = { modelId: "vendor/video", type: "image-to-video", requestSchema: { properties: { image: { type: "string" } }, required: ["image"] } };
  assert.equal(areWaveSpeedModelsFallbackCompatible(primary, compatible), true);
  assert.equal(areWaveSpeedModelsFallbackCompatible(primary, incompatible), false);
});

test("remaps semantic inputs across fallback schemas", () => {
  const mapped = remapWaveSpeedInput(
    { properties: { prompt: { type: "string" }, image: { type: "string" } } },
    {
      properties: {
        prompt_text: { type: "string" },
        first_frame_image: { type: "string" },
        duration: { type: "integer", default: 5 },
      },
    },
    { prompt: "hello", image: "https://example.com/a.png" },
  );
  assert.deepEqual(mapped, {
    prompt_text: "hello",
    first_frame_image: "https://example.com/a.png",
    duration: 5,
  });
});
