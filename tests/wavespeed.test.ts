import assert from "node:assert/strict";
import test from "node:test";
import { isWaveSpeedMediaModel } from "../lib/wavespeed";

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
