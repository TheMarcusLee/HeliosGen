const test = require("node:test");
const assert = require("node:assert/strict");
const {
  extractMediaRecords,
  createIncrementalScriptProcessor,
  preferVideoCandidates,
  selectBestVideoVersion,
  shortcodeFromPath
} = require("../shared/instagram-metadata.js");

const FIXTURE_SHORTCODE = "TEST_REEL_01";
const FIXTURE_MEDIA_ID = "9000000000000000001";
const FIXTURE_TIMESTAMP_SECONDS = 1_700_000_000;
const FIXTURE_USERNAME = "fixture_creator";
const signed720 = "https://scontent.cdninstagram.com/o1/v/t16/f2/m86/reel.mp4?efg=abc&oe=6789";
const fixtureObject = {
  require: [["Polaris", "bootstrap", null, [{
    xdt_api__v1__media__shortcode__web_info: {
      items: [{
        code: FIXTURE_SHORTCODE,
        pk: FIXTURE_MEDIA_ID,
        taken_at: FIXTURE_TIMESTAMP_SECONDS,
        product_type: "clips",
        media_type: 2,
        user: { username: FIXTURE_USERNAME },
        image_versions2: { candidates: [{ width: 1080, height: 1350, url: "https://scontent.cdninstagram.com/cover.jpg?sig=cover" }] },
        video_versions: [
          { width: 480, height: 480, url: "https://scontent.cdninstagram.com/reel-480.mp4?sig=small" },
          { width: 4000, height: 4000, url: "javascript:alert(1)" },
          { width: 3000, height: 3000, url: "blob:https://www.instagram.com/not-downloadable" },
          { width: 2000, height: 2000, url: "http://insecure.test/reel.mp4" },
          { width: 720, height: 720, url: signed720 },
          { width: 720, height: 720, url: signed720 },
          { width: 720, height: 720, url: signed720 }
        ],
        video_dash_manifest: "<MPD>not used</MPD>"
      }]
    }
  }]]]
};

// Instagram's script text commonly JSON-escapes slashes and ampersands.
const fixtureText = JSON.stringify(fixtureObject)
  .replaceAll("https://", "https:\\/\\/")
  .replaceAll("&", "\\u0026");

test("recursively extracts and normalizes Reel metadata from nested application/json", () => {
  const records = extractMediaRecords([fixtureText]);
  assert.equal(records.length, 1);
  assert.deepEqual(records[0], {
    shortcode: FIXTURE_SHORTCODE,
    url: signed720,
    width: 720,
    height: 720,
    username: FIXTURE_USERNAME,
    timestamp: new Date(FIXTURE_TIMESTAMP_SECONDS * 1000).toISOString(),
    mediaType: "video",
    contentType: "reel",
    permalink: `https://www.instagram.com/reel/${FIXTURE_SHORTCODE}/`
  });
});

test("selects the largest unique valid HTTPS video version", () => {
  const selected = selectBestVideoVersion(fixtureObject.require[0][3][0].xdt_api__v1__media__shortcode__web_info.items[0].video_versions);
  assert.equal(selected.url, signed720);
  assert.equal(selected.width, 720);
  assert.equal(selected.height, 720);
});

test("rejects blob, data, javascript, and insecure video URLs", () => {
  assert.equal(selectBestVideoVersion([
    { width: 1, height: 1, url: "blob:https://www.instagram.com/a" },
    { width: 1, height: 1, url: "data:video/mp4;base64,AAAA" },
    { width: 1, height: 1, url: "javascript:alert(1)" },
    { width: 1, height: 1, url: "http://cdn.test/a.mp4" }
  ]), null);
});

test("matches canonical and username-prefixed Reel paths by shortcode", () => {
  assert.equal(shortcodeFromPath(`/reel/${FIXTURE_SHORTCODE}/`), FIXTURE_SHORTCODE);
  assert.equal(shortcodeFromPath(`/${FIXTURE_USERNAME}/reel/${FIXTURE_SHORTCODE}/?utm_source=test`), FIXTURE_SHORTCODE);
  assert.equal(shortcodeFromPath(`/p/${FIXTURE_SHORTCODE}/`), null);
});

test("strict shortcode matching rejects foreign origins and partial paths", () => {
  assert.equal(shortcodeFromPath(`https://www.instagram.com/reel/${FIXTURE_SHORTCODE}/`), FIXTURE_SHORTCODE);
  assert.equal(shortcodeFromPath(`https://m.instagram.com/${FIXTURE_USERNAME}/reel/${FIXTURE_SHORTCODE}?x=1`), FIXTURE_SHORTCODE);
  assert.equal(shortcodeFromPath(`reel/${FIXTURE_SHORTCODE}`), FIXTURE_SHORTCODE);
  for (const value of [
    `https://evil.test/reel/${FIXTURE_SHORTCODE}/`,
    `   https://evil.test/reel/${FIXTURE_SHORTCODE}/`,
    `https://instagram.com.evil.test/reel/${FIXTURE_SHORTCODE}/`,
    `//evil.test/reel/${FIXTURE_SHORTCODE}/`,
    `\\evil.test/reel/${FIXTURE_SHORTCODE}/`,
    `/\\evil.test/reel/${FIXTURE_SHORTCODE}/`,
    `http://instagram.com/reel/${FIXTURE_SHORTCODE}/`,
    `/reel/${FIXTURE_SHORTCODE}.json`,
    `/reel/${FIXTURE_SHORTCODE}/extra`,
    `/one/two/reel/${FIXTURE_SHORTCODE}/`,
    "/reel/bad%20code/"
  ]) assert.equal(shortcodeFromPath(value), null, value);
});

test("suppresses a Reel cover and dedupes its video while preserving post images", () => {
  const candidates = preferVideoCandidates([
    { shortcode: FIXTURE_SHORTCODE, mediaType: "image", url: "https://cdn.test/cover.jpg" },
    { shortcode: FIXTURE_SHORTCODE, mediaType: "video", url: signed720 },
    { shortcode: FIXTURE_SHORTCODE, mediaType: "video", url: signed720 },
    { mediaType: "image", url: "https://cdn.test/carousel-1.jpg", contentType: "post" },
    { mediaType: "image", url: "https://cdn.test/carousel-2.jpg", contentType: "post" }
  ]);
  assert.deepEqual(candidates.map((item) => item.url), [signed720, "https://cdn.test/carousel-1.jpg", "https://cdn.test/carousel-2.jpg"]);
});

test("skips malformed scripts and media objects without a valid MP4", () => {
  const records = extractMediaRecords(["{not-json", JSON.stringify({ items: [{ code: "NO_VIDEO", video_versions: [{ url: "blob:test" }] }] })]);
  assert.deepEqual(records, []);
});

test("enforces per-script, aggregate, script-count, and traversal budgets", () => {
  assert.deepEqual(extractMediaRecords([fixtureText], { maxScriptChars: 20 }), []);
  assert.deepEqual(extractMediaRecords(["{}", fixtureText], { maxScripts: 1 }), []);
  assert.deepEqual(extractMediaRecords([fixtureText, fixtureText.replaceAll(FIXTURE_SHORTCODE, "LATE_CODE")], { maxTotalChars: fixtureText.length + 10 }).map((item) => item.shortcode), [FIXTURE_SHORTCODE]);

  const traversalFixture = JSON.stringify({
    padding: Array.from({ length: 100 }, (_, index) => ({ index })),
    media: fixtureObject.require[0][3][0].xdt_api__v1__media__shortcode__web_info.items[0]
  });
  assert.deepEqual(extractMediaRecords([traversalFixture], { maxVisitedValues: 20 }), []);
  assert.equal(extractMediaRecords([traversalFixture], { maxVisitedValues: 1000 }).length, 1);
});

test("incremental processor eventually reaches late relevant scripts without rereading unchanged ones", async () => {
  let reads = 0;
  const entries = [
    { textContent: JSON.stringify({ irrelevant: 1 }) },
    { textContent: JSON.stringify({ also_irrelevant: true }) },
    { textContent: fixtureText }
  ];
  const processor = createIncrementalScriptProcessor({
    maxScriptsPerBatch: 1,
    maxScriptChars: fixtureText.length + 100,
    maxTotalCharsPerBatch: fixtureText.length + 100,
    yieldFn: async () => {}
  });
  processor.enqueue(entries);
  assert.equal((await processor.processNextBatch((entry) => { reads += 1; return entry.textContent; })).records.length, 0);
  assert.equal((await processor.processNextBatch((entry) => { reads += 1; return entry.textContent; })).records.length, 0);
  const last = await processor.processNextBatch((entry) => { reads += 1; return entry.textContent; });
  assert.equal(last.records[0].shortcode, FIXTURE_SHORTCODE);
  assert.equal(last.remaining, 0);
  processor.enqueue(entries);
  await processor.processNextBatch((entry) => { reads += 1; return entry.textContent; });
  assert.equal(reads, 3);
});

test("incremental aggregate budget defers work to a later batch instead of dropping it", async () => {
  const second = fixtureText.replaceAll(FIXTURE_SHORTCODE, "LATE_CODE");
  const processor = createIncrementalScriptProcessor({
    maxScriptsPerBatch: 4,
    maxScriptChars: fixtureText.length + 100,
    maxTotalCharsPerBatch: fixtureText.length + 10,
    yieldFn: async () => {}
  });
  processor.enqueue([{ textContent: fixtureText }, { textContent: second }]);
  const first = await processor.processNextBatch();
  assert.deepEqual(first.records.map((item) => item.shortcode), [FIXTURE_SHORTCODE]);
  assert.equal(first.remaining, 1);
  const later = await processor.processNextBatch();
  assert.deepEqual(later.records.map((item) => item.shortcode), ["LATE_CODE"]);
});
