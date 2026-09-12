import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest } from "next/server";
process.env.HELIOS_DATA_DIR ??= mkdtempSync(join(tmpdir(), "ugc-captures-test-"));
process.env.HELIOS_MEDIA_DIR ??= mkdtempSync(join(tmpdir(), "ugc-captures-media-"));
const route = import("../app/api/campaigns/captures/route");
const request = (init: { method?: string; body?: BodyInit; origin?: string; headers?: Record<string, string> } = {}) => new NextRequest("http://localhost/api/campaigns/captures", { method: init.method ?? "GET", body: init.body, headers: { ...(init.origin ? { origin: init.origin } : {}), ...(init.headers ?? {}) } });
import { readFile } from "node:fs/promises";
let clip: Blob | undefined;
/** A real one-second mp4: the upload path runs ffmpeg to strip metadata and rejects fake bytes. */
async function bytes() {
  if (!clip) {
    const { processOutput } = await import("../lib/campaigns/director/media");
    const file = join(process.env.HELIOS_MEDIA_DIR!, "capture-fixture.mp4");
    await processOutput("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=160x160:rate=12", "-t", "1", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-y", file]);
    clip = new Blob([new Uint8Array(await readFile(file))], { type: "video/mp4" });
  }
  return clip;
}
test("capture preflight is granted to browser-extension origins only", async () => {
  const { OPTIONS } = await route;
  const allowed = await OPTIONS(request({ method: "OPTIONS", origin: "chrome-extension://abcdefghijklmnop" }));
  assert.equal(allowed.status, 204); assert.equal(allowed.headers.get("access-control-allow-origin"), "chrome-extension://abcdefghijklmnop"); assert.match(allowed.headers.get("access-control-allow-headers")!, /X-Capture-Source-Url/);
  const refused = await OPTIONS(request({ method: "OPTIONS", origin: "https://evil.example" }));
  assert.equal(refused.status, 403); assert.equal(refused.headers.get("access-control-allow-origin"), null);
});
test("captures store raw media bytes with source metadata and refuse web origins", async () => {
  const { POST, GET, DELETE } = await route;
  const headers = { "content-type": "video/mp4", "x-capture-source-url": encodeURIComponent("https://www.instagram.com/reel/ABC123/?utm=1"), "x-capture-author": "creator", "x-capture-caption": encodeURIComponent("Outfit transition ✨"), "x-capture-posted-at": "2026-09-01T00:00:00.000Z" };
  const refused = await POST(request({ method: "POST", origin: "https://evil.example", headers, body: await bytes() }));
  assert.equal(refused.status, 403);
  const created = await POST(request({ method: "POST", origin: "chrome-extension://abcdefghijklmnop", headers, body: await bytes() }));
  assert.equal(created.status, 201); const { capture } = await created.json();
  assert.match(capture.url, /^\/generated\/captures\/.+\.mp4$/); assert.equal(capture.author, "creator"); assert.equal(capture.caption, "Outfit transition ✨"); assert.equal(capture.sourceUrl, "https://www.instagram.com/reel/ABC123/?utm=1"); assert.equal(capture.mediaType, "video");
  const again = await POST(request({ method: "POST", origin: "chrome-extension://abcdefghijklmnop", headers, body: await bytes() }));
  assert.equal((await again.json()).capture.id, capture.id);
  const bad = await POST(request({ method: "POST", origin: "chrome-extension://abcdefghijklmnop", headers: { "content-type": "text/html" }, body: "<b>" }));
  assert.equal(bad.status, 400);
  const list = await (await GET(request({ origin: "chrome-extension://abcdefghijklmnop" }))).json();
  assert.equal(list.captures.length, 1);
  await DELETE(new NextRequest(`http://localhost/api/campaigns/captures?id=${capture.id}`, { method: "DELETE" }));
  assert.equal((await (await GET(request())).json()).captures.length, 0);
});
