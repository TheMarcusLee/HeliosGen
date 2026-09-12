const test = require("node:test");
const assert = require("node:assert/strict");
const utils = require("../shared/utils.js");
const { createQueueCoordinator } = require("../shared/queue-manager.js");

function tick() { return new Promise((resolve) => setImmediate(resolve)); }

function createMockChrome({ delayedDownloads = false, cancelFailures = 0, downloadError = null } = {}) {
  const localData = {};
  const records = [];
  const pendingCallbacks = [];
  const cancelled = [];
  let nextId = 1;
  const chrome = {
    runtime: {
      id: "test-extension-id",
      lastError: null,
      sendMessage: async () => undefined
    },
    storage: {
      local: {
        async get(keys) {
          const names = Array.isArray(keys) ? keys : [keys];
          return Object.fromEntries(names.filter((key) => key in localData).map((key) => [key, structuredClone(localData[key])]));
        },
        async set(values) { Object.assign(localData, structuredClone(values)); }
      }
    },
    alarms: {
      created: [],
      async create(name, info) { this.created.push({ name, info }); }
    },
    downloads: {
      downloadCalls: [],
      download(options, callback) {
        const id = nextId++;
        this.downloadCalls.push({ id, options: structuredClone(options) });
        if (!downloadError) records.push({ id, url: options.url, finalUrl: options.url, filename: `/Downloads/${options.filename}`, state: "in_progress", startTime: new Date().toISOString(), byExtensionId: chrome.runtime.id });
        const respond = () => {
          if (downloadError) chrome.runtime.lastError = { message: downloadError };
          callback(downloadError ? undefined : id);
          chrome.runtime.lastError = null;
        };
        if (delayedDownloads) pendingCallbacks.push(respond);
        else queueMicrotask(respond);
      },
      resolveNext() {
        const resolve = pendingCallbacks.shift();
        if (resolve) resolve();
      },
      async search(query) {
        if (query.id != null) return records.filter((record) => record.id === query.id).map((record) => structuredClone(record));
        return records.map((record) => structuredClone(record));
      },
      async cancel(id) {
        if (cancelFailures > 0) {
          cancelFailures -= 1;
          throw new Error("temporary cancel failure");
        }
        cancelled.push(id);
        const record = records.find((item) => item.id === id);
        if (record) record.state = "interrupted";
      }
    },
    __data: localData,
    __records: records,
    __cancelled: cancelled,
    __addRecord(record) {
      const item = { id: nextId++, state: "in_progress", byExtensionId: chrome.runtime.id, ...record };
      records.push(item);
      return item;
    }
  };
  return chrome;
}

function media(id, query = "old") {
  return { id, url: `https://scontent.test/${id}.jpg?sig=${query}`, mediaType: "image", contentType: "post", username: "owner", discoveredAt: 1 };
}

test("durable enqueue resolves before the external downloads callback", async () => {
  const chrome = createMockChrome({ delayedDownloads: true });
  const queue = createQueueCoordinator(chrome, utils);
  const enqueuePromise = queue.enqueue([media("a")]);
  const result = await Promise.race([
    enqueuePromise,
    new Promise((resolve) => setTimeout(() => resolve("timed-out"), 25))
  ]);
  assert.equal(result, 1);
  await tick();
  const running = queue.processQueue();
  assert.equal(chrome.downloads.downloadCalls[0].options.url, media("a").url);
  assert.match(chrome.downloads.downloadCalls[0].options.filename, /^InstaVault\/.+\.jpg$/);
  chrome.downloads.resolveNext();
  await running;
});

test("downloads callback errors become visible failed queue entries", async () => {
  const chrome = createMockChrome({ downloadError: "Invalid URL" });
  const queue = createQueueCoordinator(chrome, utils);
  assert.equal(await queue.enqueue([media("a")]), 1);
  await tick();
  await tick();
  const result = await queue.getQueue();
  assert.equal(result.items[0].status, "failed");
  assert.match(result.items[0].error, /Invalid URL/);
});

test("serializes enqueue and download completion without losing either mutation", async () => {
  const chrome = createMockChrome();
  const queue = createQueueCoordinator(chrome, utils);
  await queue.initialize();
  await queue.enqueue([media("a")]);
  await tick();
  const active = await queue.getQueue();
  await Promise.all([
    queue.handleDownloadChanged({ id: active.activeDownloadId, state: { current: "complete" } }),
    queue.enqueue([media("b")])
  ]);
  const result = await queue.getQueue();
  assert.equal(result.items.find((item) => item.media.id === "a").status, "complete");
  assert.ok(result.items.some((item) => item.media.id === "b"));
});

test("pause during download-start await is preserved after callback resolves", async () => {
  const chrome = createMockChrome({ delayedDownloads: true });
  const queue = createQueueCoordinator(chrome, utils);
  await queue.initialize();
  await queue.enqueue([media("a")]);
  await tick();
  const running = queue.processQueue();
  await queue.pause();
  chrome.downloads.resolveNext();
  await running;
  const result = await queue.getQueue();
  assert.equal(result.state, "paused");
  assert.equal(result.items[0].status, "downloading");
});

test("cancel during download-start await cancels the newly returned download", async () => {
  const chrome = createMockChrome({ delayedDownloads: true });
  const queue = createQueueCoordinator(chrome, utils);
  await queue.initialize();
  await queue.enqueue([media("a")]);
  await tick();
  const running = queue.processQueue();
  await queue.cancelPending();
  chrome.downloads.resolveNext();
  await running;
  assert.deepEqual(chrome.__cancelled, [1]);
  await queue.handleDownloadChanged({ id: 1, state: { current: "interrupted" } });
  const result = await queue.getQueue();
  assert.equal(result.state, "cancelled");
  assert.equal(result.items[0].status, "cancelled");
});

test("new service worker adopts a started download record instead of duplicating it", async () => {
  const chrome = createMockChrome({ delayedDownloads: true });
  const firstWorker = createQueueCoordinator(chrome, utils);
  await firstWorker.initialize();
  void firstWorker.enqueue([media("a")]);
  await tick();
  assert.equal(chrome.downloads.downloadCalls.length, 1);

  const recoveredWorker = createQueueCoordinator(chrome, utils);
  await recoveredWorker.initialize();
  await recoveredWorker.processQueue();
  const result = await recoveredWorker.getQueue();
  assert.equal(chrome.downloads.downloadCalls.length, 1);
  assert.equal(result.activeDownloadId, 1);
  assert.equal(result.items[0].status, "downloading");
  assert.equal(chrome.__records[0].byExtensionId, chrome.runtime.id);
});

test("recovery never adopts an older matching URL and filename", async () => {
  const chrome = createMockChrome({ delayedDownloads: true });
  const item = media("a");
  const filename = "InstaVault/001_a.jpg";
  chrome.__addRecord({ url: item.url, finalUrl: item.url, filename: `/Downloads/${filename}`, startTime: new Date(Date.now() - 10_000).toISOString() });
  chrome.__data.downloadQueue = {
    items: [{ queueId: "starting-a", media: item, filename, status: "starting", startUrl: item.url, startFilename: filename, startRequestedAt: Date.now() }],
    state: "running",
    activeDownloadId: null,
    sequenceCursor: 2
  };
  const queue = createQueueCoordinator(chrome, utils);
  await queue.processQueue();
  const result = await queue.getQueue();
  assert.equal(result.activeDownloadId, null);
  assert.equal(result.items[0].status, "starting");
});

test("recovery ignores matching records owned by another extension", async () => {
  const chrome = createMockChrome({ delayedDownloads: true });
  const item = media("a");
  const filename = "InstaVault/001_a.jpg";
  chrome.__addRecord({ url: item.url, finalUrl: item.url, filename: `/Downloads/${filename}`, startTime: new Date(Date.now() + 1000).toISOString(), byExtensionId: "another-extension" });
  chrome.__data.downloadQueue = {
    items: [{ queueId: "starting-a", media: item, filename, status: "starting", startUrl: item.url, startFilename: filename, startRequestedAt: Date.now() }],
    state: "running",
    activeDownloadId: null,
    sequenceCursor: 2
  };
  const queue = createQueueCoordinator(chrome, utils);
  await queue.processQueue();
  const result = await queue.getQueue();
  assert.equal(result.activeDownloadId, null);
  assert.equal(result.items[0].status, "starting");
});

test("recovery never adopts or cancels an ownerless matching record", async () => {
  const chrome = createMockChrome();
  const item = media("a");
  const filename = "InstaVault/001_a.jpg";
  chrome.__addRecord({ url: item.url, finalUrl: item.url, filename: `/Downloads/${filename}`, startTime: new Date().toISOString(), byExtensionId: undefined });
  chrome.__data.downloadQueue = {
    items: [{ queueId: "starting-a", media: item, filename, status: "starting", startUrl: item.url, startFilename: filename, startRequestedAt: Date.now() - 10 }],
    state: "running",
    activeDownloadId: null,
    sequenceCursor: 2
  };
  const queue = createQueueCoordinator(chrome, utils);
  await queue.cancelPending();
  const result = await queue.getQueue();
  assert.deepEqual(chrome.__cancelled, []);
  assert.equal(result.activeDownloadId, null);
  assert.equal(result.items[0].status, "cancel_requested");
});

test("recovery selects the newer matching record owned by this extension", async () => {
  const chrome = createMockChrome({ delayedDownloads: true });
  const item = media("a");
  const filename = "InstaVault/001_a.jpg";
  const requestedAt = Date.now() - 20;
  chrome.__addRecord({ url: item.url, finalUrl: item.url, filename: `/Downloads/${filename}`, startTime: new Date(requestedAt - 5000).toISOString() });
  chrome.__addRecord({ url: item.url, finalUrl: item.url, filename: `/Downloads/${filename}`, startTime: new Date(requestedAt + 5).toISOString(), byExtensionId: "another-extension" });
  const correct = chrome.__addRecord({ url: item.url, finalUrl: item.url, filename: `/Downloads/${filename}`, startTime: new Date(requestedAt + 10).toISOString() });
  chrome.__data.downloadQueue = {
    items: [{ queueId: "starting-a", media: item, filename, status: "starting", startUrl: item.url, startFilename: filename, startRequestedAt: requestedAt }],
    state: "running",
    activeDownloadId: null,
    sequenceCursor: 2
  };
  const queue = createQueueCoordinator(chrome, utils);
  await queue.processQueue();
  const result = await queue.getQueue();
  assert.equal(result.activeDownloadId, correct.id);
  assert.equal(result.items[0].status, "downloading");
});

test("concurrent two-tab discovery retains both library updates", async () => {
  const chrome = createMockChrome();
  const queue = createQueueCoordinator(chrome, utils);
  await Promise.all([queue.upsertLibrary([media("tab-a")]), queue.upsertLibrary([media("tab-b")])]);
  const library = await queue.getLibrary();
  assert.deepEqual(new Set(library.map((item) => item.id)), new Set([utils.stableId(media("tab-a")), utils.stableId(media("tab-b"))]));
});

test("terminal queue history is pruned to the configured limit", async () => {
  const chrome = createMockChrome();
  chrome.__data.downloadQueue = {
    items: [0, 1, 2, 3].map((number) => ({ queueId: `old-${number}`, media: media(`old-${number}`), status: "complete" })),
    state: "complete",
    activeDownloadId: null,
    sequenceCursor: 5
  };
  const queue = createQueueCoordinator(chrome, utils, { maxTerminalHistory: 2 });
  await queue.enqueue([media("new")]);
  const result = await queue.getQueue();
  assert.equal(result.items.filter((item) => item.status === "complete").length, 2);
  assert.ok(result.items.some((item) => item.media.id === "new"));
});

test("retry failed refreshes transient URL from library using stable identity", async () => {
  const chrome = createMockChrome();
  const queue = createQueueCoordinator(chrome, utils);
  const oldMedia = media("a", "expired");
  oldMedia.id = utils.stableId(oldMedia);
  const freshMedia = media("a", "fresh");
  freshMedia.id = utils.stableId(freshMedia);
  assert.equal(oldMedia.id, freshMedia.id);
  chrome.__data.downloadQueue = { items: [{ queueId: "failed", media: oldMedia, filename: "InstaVault/001.jpg", status: "failed" }], state: "finished_with_errors", activeDownloadId: null, sequenceCursor: 2 };
  await queue.upsertLibrary([freshMedia]);
  await queue.retryFailed({ process: false });
  const result = await queue.getQueue();
  assert.equal(result.items[0].media.url, freshMedia.url);
  assert.equal(result.items[0].status, "pending");
});

test("legacy query-dependent library IDs migrate and newest refreshed URL wins retry", async () => {
  const chrome = createMockChrome();
  const stale = { ...media("a", "expired"), id: "legacy-expired", discoveredAt: 10 };
  const fresh = { ...media("a", "fresh"), id: "legacy-fresh", discoveredAt: 20 };
  chrome.__data.mediaLibrary = [fresh, stale];
  chrome.__data.downloadQueue = {
    items: [{ queueId: "failed", media: stale, filename: "InstaVault/001.jpg", status: "failed" }],
    state: "finished_with_errors",
    activeDownloadId: null,
    sequenceCursor: 2
  };
  const queue = createQueueCoordinator(chrome, utils);
  await queue.retryFailed({ process: false });
  const [library, result] = await Promise.all([queue.getLibrary(), queue.getQueue()]);
  assert.equal(library.length, 1);
  assert.equal(library[0].id, utils.stableId(fresh));
  assert.equal(library[0].url, fresh.url);
  assert.equal(result.items[0].media.url, fresh.url);
});

test("persisted legacy Reel cover is removed when its rotated-CDN video is known", async () => {
  const chrome = createMockChrome();
  chrome.__data.mediaLibrary = [
    { id: "legacy-cover", url: "https://old-cdn.test/cover.jpg", mediaType: "image", contentType: "reel", permalink: "https://www.instagram.com/reel/REEL_CODE/", discoveredAt: 10 },
    { id: "legacy-video", url: "https://new-cdn.test/completely/different.mp4?sig=fresh", mediaType: "video", contentType: "reel", shortcode: "REEL_CODE", permalink: "https://www.instagram.com/reel/REEL_CODE/", discoveredAt: 20 }
  ];
  const queue = createQueueCoordinator(chrome, utils);
  const library = await queue.getLibrary();
  assert.equal(library.length, 1);
  assert.equal(library[0].mediaType, "video");
  assert.equal(library[0].id, utils.stableId(library[0]));
});

test("Reel queue dedupe and retry use shortcode identity across CDN rotation", async () => {
  const chrome = createMockChrome({ delayedDownloads: true });
  const oldVideo = { id: "legacy-old", url: "https://old-cdn.test/old.mp4?sig=expired", mediaType: "video", contentType: "reel", shortcode: "REEL_CODE", permalink: "https://www.instagram.com/reel/REEL_CODE/", discoveredAt: 10 };
  const freshVideo = { ...oldVideo, id: "legacy-fresh", url: "https://fresh-cdn.test/new/location.mp4?sig=fresh", discoveredAt: 20 };
  const queue = createQueueCoordinator(chrome, utils);
  assert.equal(await queue.enqueue([oldVideo, freshVideo]), 1);
  let result = await queue.getQueue();
  assert.equal(result.items.length, 1);
  result.items[0].status = "failed";
  result.activeDownloadId = null;
  chrome.__data.downloadQueue = structuredClone(result);
  await queue.upsertLibrary([freshVideo]);
  await queue.retryFailed({ process: false });
  result = await queue.getQueue();
  assert.equal(result.items[0].media.url, freshVideo.url);
});

test("recovered cancelling download retries rejection and then releases active queue", async () => {
  const chrome = createMockChrome({ cancelFailures: 1 });
  const active = chrome.__addRecord({ url: media("a").url, finalUrl: media("a").url, filename: "/Downloads/InstaVault/001_a.jpg", startTime: new Date().toISOString() });
  chrome.__data.downloadQueue = {
    items: [
      { queueId: "cancel-a", media: media("a"), filename: "InstaVault/001_a.jpg", status: "cancelling", downloadId: active.id },
      { queueId: "pending-b", media: media("b"), filename: "InstaVault/002_b.jpg", status: "pending" }
    ],
    state: "running",
    activeDownloadId: active.id,
    sequenceCursor: 3
  };
  const queue = createQueueCoordinator(chrome, utils);
  await queue.processQueue();
  let result = await queue.getQueue();
  assert.equal(result.activeDownloadId, active.id);
  assert.equal(result.items[0].status, "cancelling");
  await queue.processQueue();
  result = await queue.getQueue();
  assert.equal(result.activeDownloadId, null);
  assert.equal(result.items[0].status, "cancelled");
  await queue.processQueue();
  result = await queue.getQueue();
  assert.equal(result.items[1].status, "downloading");
});

test("cancelPending immediately reconciles and cancels an orphaned starting record", async () => {
  const chrome = createMockChrome();
  const item = media("a");
  const filename = "InstaVault/001_a.jpg";
  const record = chrome.__addRecord({ url: item.url, finalUrl: item.url, filename: `/Downloads/${filename}`, startTime: new Date().toISOString() });
  chrome.__data.downloadQueue = {
    items: [{ queueId: "starting-a", media: item, filename, status: "starting", startUrl: item.url, startFilename: filename, startRequestedAt: Date.now() - 10 }],
    state: "running",
    activeDownloadId: null,
    sequenceCursor: 2
  };
  const queue = createQueueCoordinator(chrome, utils);
  await queue.cancelPending();
  const result = await queue.getQueue();
  assert.deepEqual(chrome.__cancelled, [record.id]);
  assert.equal(result.activeDownloadId, null);
  assert.equal(result.items[0].status, "cancelled");
});

test("sequence cursor continues across persisted batches", async () => {
  const chrome = createMockChrome({ delayedDownloads: true });
  const firstWorker = createQueueCoordinator(chrome, utils);
  void firstWorker.enqueue([media("a")], { filenameTemplate: "{sequence}_{id}", sequenceStart: 7, sequencePadding: 3 });
  await tick();
  const secondWorker = createQueueCoordinator(chrome, utils);
  await secondWorker.enqueue([media("b")], { filenameTemplate: "{sequence}_{id}", sequenceStart: 1, sequencePadding: 3 });
  const result = await secondWorker.getQueue();
  assert.deepEqual(result.items.map((item) => item.filename), ["InstaVault/007_a.jpg", "InstaVault/008_b.jpg"]);
  assert.equal(result.sequenceCursor, 9);
});
