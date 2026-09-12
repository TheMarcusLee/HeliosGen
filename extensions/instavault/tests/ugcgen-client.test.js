const test = require("node:test");
const assert = require("node:assert/strict");
const { configuration, sendToUGCGen, status } = require("../shared/ugcgen-client.js");

test("accepts localhost over http and any https origin, and rejects the rest", () => {
  assert.equal(configuration({}).endpoint, "http://localhost:3000/api/campaigns/captures");
  assert.equal(configuration({ ugcGenEndpoint: "https://studio.example.test/" }).endpoint, "https://studio.example.test/api/campaigns/captures");
  assert.throws(() => configuration({ ugcGenEndpoint: "http://studio.example.test" }), /https/);
  assert.throws(() => configuration({ ugcGenEndpoint: "not a url" }), /address/);
});

test("reads rendered media and posts the bytes with source metadata to the local capture endpoint", async () => {
  const calls = [];
  const fetchMock = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (url === "https://cdn.test/reel.mp4") return new Response(new Blob(["video"], { type: "video/mp4" }), { status: 200 });
    if (url === "http://localhost:3000/api/campaigns/captures") return Response.json({ ok: true, capture: { id: "cap-1", url: "/generated/captures/a.mp4" } }, { status: 201 });
    return Response.json({ error: "unexpected" }, { status: 400 });
  };
  const results = await sendToUGCGen(fetchMock, {}, [{ id: "reel", url: "https://cdn.test/reel.mp4", mediaType: "video", contentType: "reel", permalink: "https://www.instagram.com/reel/VIDEO/", username: "creator", timestamp: "2026-09-01T00:00:00.000Z" }]);
  assert.equal(results[0].url, "/generated/captures/a.mp4");
  assert.deepEqual(calls.map((c) => c.url), ["https://cdn.test/reel.mp4", "http://localhost:3000/api/campaigns/captures"]);
  const upload = calls[1].options;
  assert.equal(upload.method, "POST");
  assert.equal(upload.headers["Content-Type"], "video/mp4");
  assert.equal(decodeURIComponent(upload.headers["X-Capture-Source-Url"]), "https://www.instagram.com/reel/VIDEO/");
  assert.equal(decodeURIComponent(upload.headers["X-Capture-Author"]), "creator");
});

test("surfaces server errors and reports capture counts from status", async () => {
  const tooLarge = async (url) => url === "https://cdn.test/x.jpg" ? new Response(new Blob(["x"], { type: "image/jpeg" }), { status: 200 }) : Response.json({ error: "Media exceeds the size limit." }, { status: 413 });
  await assert.rejects(() => sendToUGCGen(tooLarge, {}, [{ url: "https://cdn.test/x.jpg", mediaType: "image" }]), /size limit/);
  await assert.rejects(() => sendToUGCGen(async () => new Response("", { status: 403 }), {}, [{ url: "https://cdn.test/x.jpg", mediaType: "image" }]), /could not be read/);
  const result = await status(async () => Response.json({ ok: true, captures: [{}, {}] }), {});
  assert.equal(result.captured, 2);
});
