const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildFilename,
  dedupeMedia,
  inDateRange,
  normalizeMediaUrl,
  planQueue,
  sanitizeSegment
} = require("../shared/utils.js");

test("sanitizeSegment removes reserved filename characters", () => {
  assert.equal(sanitizeSegment('  user:<bad>/name.  '), "user__bad__name");
});

test("buildFilename expands template and pads sequence", () => {
  const name = buildFilename(
    { id: "abc", username: "fixture_user", contentType: "reel", mediaType: "video", timestamp: "2026-08-30T10:00:00Z", url: "https://cdn.test/a.mp4" },
    { filenameTemplate: "{username}-{type}-{date}-{sequence}", sequencePadding: 4 },
    7
  );
  assert.equal(name, "InstaVault/fixture_user-reel-2026-08-30-0007.mp4");
});

test("inDateRange applies inclusive local date boundaries", () => {
  assert.equal(inDateRange("2026-08-30T12:00:00Z", "2026-08-30", "2026-08-30"), true);
  assert.equal(inDateRange("2026-08-29T12:00:00Z", "2026-08-30", ""), false);
  assert.equal(inDateRange(null, "2026-08-30", ""), false);
});

test("dedupeMedia keeps the newest representation of an id", () => {
  const source = { id: "same", url: "https://cdn.test/a.jpg", mediaType: "image" };
  const result = dedupeMedia([source, { ...source, username: "updated" }]);
  assert.equal(result.length, 1);
  assert.equal(result[0].username, "updated");
});

test("dedupeMedia suppresses a Reel cover once its video is available", () => {
  const result = dedupeMedia([
    { id: "cover", shortcode: "REEL1", url: "https://cdn.test/cover.jpg", mediaType: "image", contentType: "reel" },
    { id: "video", shortcode: "REEL1", url: "https://cdn.test/reel.mp4?sig=fresh", mediaType: "video", contentType: "reel" },
    { id: "post", url: "https://cdn.test/post.jpg", mediaType: "image", contentType: "post" }
  ]);
  assert.deepEqual(result.map((item) => item.mediaType), ["video", "image"]);
  assert.equal(result[0].id, require("../shared/utils.js").stableId(result[0]));
});

test("stable media URL identity strips transient signed query and hash", () => {
  assert.equal(normalizeMediaUrl("https://cdn.test/media.jpg?sig=old#frame"), "https://cdn.test/media.jpg");
  const first = { url: "https://cdn.test/media.jpg?sig=old", mediaType: "image", permalink: "https://www.instagram.com/p/ABC/" };
  const second = { ...first, url: "https://cdn.test/media.jpg?sig=fresh" };
  assert.equal(require("../shared/utils.js").stableId(first), require("../shared/utils.js").stableId(second));
  assert.equal(dedupeMedia([{ ...first, id: "same" }, { ...second, id: "same" }])[0].url, second.url);
});

test("Reel video identity survives CDN host and path rotation", () => {
  const first = { shortcode: "REEL_CODE", contentType: "reel", mediaType: "video", permalink: "https://www.instagram.com/reel/REEL_CODE/", url: "https://cdn-a.test/old/path.mp4?sig=one" };
  const second = { ...first, url: "https://cdn-b.test/new/path.mp4?sig=two" };
  assert.equal(require("../shared/utils.js").stableId(first), require("../shared/utils.js").stableId(second));
  const deduped = dedupeMedia([{ ...first, id: "legacy-one" }, { ...second, id: "legacy-two" }]);
  assert.equal(deduped.length, 1);
  assert.equal(deduped[0].url, second.url);

  const imageA = { mediaType: "image", contentType: "post", permalink: "https://www.instagram.com/p/POST/", url: "https://cdn-a.test/image.jpg" };
  const imageB = { ...imageA, url: "https://cdn-b.test/image.jpg" };
  assert.notEqual(require("../shared/utils.js").stableId(imageA), require("../shared/utils.js").stableId(imageB));
});

test("planQueue dedupes and generates a deterministic sequence", () => {
  const items = [
    { id: "a", url: "https://cdn.test/a.jpg", mediaType: "image" },
    { id: "a", url: "https://cdn.test/a.jpg", mediaType: "image" },
    { id: "b", url: "https://cdn.test/b.mp4", mediaType: "video" }
  ];
  const plan = planQueue(items, { filenameTemplate: "{sequence}_{id}", sequenceStart: 9, sequencePadding: 2 });
  assert.equal(plan.length, 2);
  assert.deepEqual(plan.map((item) => item.filename), ["InstaVault/09_a.jpg", "InstaVault/10_b.mp4"]);
});
