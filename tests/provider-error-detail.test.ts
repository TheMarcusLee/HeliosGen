import assert from "node:assert/strict";
import test from "node:test";
import { explainProviderError, providerErrorDetail, scrubPaths } from "../lib/providerErrorDetail";

test("known failure signatures get a plain-language reading", () => {
  assert.match(explainProviderError("Responses stream ended without an image result") ?? "", /silent refusal|policy/);
  assert.match(explainProviderError("HTTP 429: too many requests") ?? "", /rate limited/);
  assert.equal(explainProviderError("something novel"), undefined);
});

test("detail lists context, the reading, and scrubbed raw output", () => {
  const detail = providerErrorDetail({ provider: "OpenAI account · codex-imagegen", model: "gpt-image-2", size: "1024x1536", references: 2, exitCode: 1, message: "Responses stream ended without an image result", raw: "codex-imagegen exited with code 1: /private/var/folders/ab/T/codex-in-1.png Error: Responses stream ended without an image result; last status was failed." });
  assert.match(detail, /^Provider: OpenAI account · codex-imagegen\nModel: gpt-image-2\nSize: 1024x1536\nReference images: 2\nExit code: 1\n/);
  assert.match(detail, /silent refusal/);
  assert.match(detail, /Provider output:\n[\s\S]*<tmp> Error: [\s\S]*last status was failed/);
  assert.doesNotMatch(detail, /var\/folders/);
});

test("raw output identical to the message is not repeated", () => {
  const detail = providerErrorDetail({ provider: "Kie.ai", message: "Generation failed", raw: "Generation failed" });
  assert.equal(detail, "Provider: Kie.ai");
  assert.equal(scrubPaths("/Users/someone/x and /home/other/y"), "~/x and ~/y");
});
