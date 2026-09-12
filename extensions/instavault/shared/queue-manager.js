(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.InstaVaultQueue = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const STORE = Object.freeze({ library: "mediaLibrary", queue: "downloadQueue", settings: "settings" });
  const TERMINAL = new Set(["complete", "failed", "cancelled"]);

  function createQueueCoordinator(chromeApi, utils, options = {}) {
    const maxLibraryItems = options.maxLibraryItems || 2500;
    const maxTerminalHistory = options.maxTerminalHistory || 500;
    const startingGraceMs = options.startingGraceMs || 5000;
    let mutationChain = Promise.resolve();
    let libraryMutationChain = Promise.resolve();
    let processingPromise = null;

    function emptyQueue() {
      return { items: [], state: "idle", activeDownloadId: null, sequenceCursor: null, updatedAt: Date.now() };
    }

    function normalizeQueue(queue) {
      return { ...emptyQueue(), ...(queue || {}), items: Array.isArray(queue?.items) ? queue.items : [] };
    }

    function prune(queue) {
      const terminal = queue.items.filter((item) => TERMINAL.has(item.status));
      if (terminal.length <= maxTerminalHistory) return queue;
      const keep = new Set(terminal.slice(-maxTerminalHistory).map((item) => item.queueId));
      queue.items = queue.items.filter((item) => !TERMINAL.has(item.status) || keep.has(item.queueId));
      return queue;
    }

    function locked(operation) {
      const run = mutationChain.then(operation, operation);
      mutationChain = run.catch(() => {});
      return run;
    }

    function libraryLocked(operation) {
      const run = libraryMutationChain.then(operation, operation);
      libraryMutationChain = run.catch(() => {});
      return run;
    }

    async function storageGet(keys) {
      return chromeApi.storage.local.get(keys);
    }

    async function commitQueue(queue) {
      prune(queue);
      queue.updatedAt = Date.now();
      await chromeApi.storage.local.set({ [STORE.queue]: queue });
      void chromeApi.runtime.sendMessage({ type: "QUEUE_UPDATED", queue }).catch(() => {});
      return queue;
    }

    async function mutateQueue(operation) {
      return locked(async () => {
        const stored = await storageGet(STORE.queue);
        const queue = normalizeQueue(stored[STORE.queue]);
        const value = await operation(queue);
        await commitQueue(queue);
        return value === undefined ? queue : value;
      });
    }

    function startDownload(downloadOptions) {
      return new Promise((resolve, reject) => {
        chromeApi.downloads.download(downloadOptions, (id) => {
          const error = chromeApi.runtime.lastError;
          if (error || !id) reject(new Error(error?.message || "Chrome did not start the download."));
          else resolve(id);
        });
      });
    }

    async function getSettings() {
      const stored = (await storageGet(STORE.settings))[STORE.settings] || {};
      return { ...utils.DEFAULT_SETTINGS, ...stored };
    }

    async function saveSettings(incoming) {
      const settings = { ...(await getSettings()), ...(incoming || {}) };
      settings.delayMs = utils.clampInteger(settings.delayMs, 250, 60000, 1200);
      settings.sequenceStart = utils.clampInteger(settings.sequenceStart, 0, 99999999, 1);
      settings.sequencePadding = utils.clampInteger(settings.sequencePadding, 1, 8, 3);
      settings.filenameTemplate = String(settings.filenameTemplate || utils.DEFAULT_SETTINGS.filenameTemplate).slice(0, 160);
      settings.ugcGenEndpoint = String(settings.ugcGenEndpoint || utils.DEFAULT_SETTINGS.ugcGenEndpoint).trim().slice(0, 1000);
      await chromeApi.storage.local.set({ [STORE.settings]: settings });
      return settings;
    }

    function mediaFreshness(item) {
      const discovered = Number(item?.discoveredAt);
      if (Number.isFinite(discovered)) return discovered;
      const timestamp = item?.timestamp ? new Date(item.timestamp).getTime() : 0;
      return Number.isFinite(timestamp) ? timestamp : 0;
    }

    function normalizeLibrary(items) {
      const byStableId = new Map();
      for (const [index, source] of (items || []).entries()) {
        if (!source?.url) continue;
        const id = utils.stableId(source);
        const candidate = { item: { ...source, id }, freshness: mediaFreshness(source), index };
        const existing = byStableId.get(id);
        if (!existing || candidate.freshness > existing.freshness) byStableId.set(id, candidate);
      }
      const normalized = [...byStableId.values()]
        .sort((a, b) => b.freshness - a.freshness || a.index - b.index)
        .map((entry) => entry.item);
      const videoShortcodes = new Set(normalized.filter((item) => item.mediaType === "video").map(utils.reelShortcode).filter(Boolean));
      return normalized
        .filter((item) => {
          const shortcode = utils.reelShortcode(item);
          return !shortcode || item.mediaType === "video" || !videoShortcodes.has(shortcode);
        })
        .slice(0, maxLibraryItems);
    }

    async function getLibrary() {
      return libraryLocked(async () => {
        const stored = (await storageGet(STORE.library))[STORE.library] || [];
        const normalized = normalizeLibrary(stored);
        await chromeApi.storage.local.set({ [STORE.library]: normalized });
        return normalized;
      });
    }

    async function upsertLibrary(incoming) {
      return libraryLocked(async () => {
        const stored = (await storageGet(STORE.library))[STORE.library] || [];
        // Incoming DOM observations are first so equal timestamps prefer the
        // freshly observed signed URL over an older stored representation.
        const merged = normalizeLibrary([...(incoming || []), ...stored]);
        await chromeApi.storage.local.set({ [STORE.library]: merged });
        return merged;
      });
    }

    async function clearLibrary() {
      await libraryLocked(() => chromeApi.storage.local.set({ [STORE.library]: [] }));
    }

    async function getQueue() {
      await mutationChain;
      return normalizeQueue((await storageGet(STORE.queue))[STORE.queue]);
    }

    async function scheduleAt(when) {
      await chromeApi.alarms.create("queue-next", { when: Math.max(Date.now() + 250, when) });
    }

    async function scheduleNext() {
      const settings = await getSettings();
      await scheduleAt(Date.now() + Math.max(250, Number(settings.delayMs) || utils.DEFAULT_SETTINGS.delayMs));
    }

    function filenameMatches(actual, planned) {
      const actualPath = String(actual || "").replaceAll("\\", "/");
      const expectedPath = String(planned || "").replaceAll("\\", "/");
      if (actualPath.endsWith(expectedPath)) return true;
      const actualName = actualPath.split("/").pop() || "";
      const expectedName = expectedPath.split("/").pop() || "";
      const dot = expectedName.lastIndexOf(".");
      if (dot < 0) return actualName === expectedName;
      const stem = expectedName.slice(0, dot);
      const extension = expectedName.slice(dot);
      return actualName === expectedName || (actualName.startsWith(`${stem} (`) && actualName.endsWith(extension));
    }

    function findStartedRecord(item, records, usedIds) {
      return records.find((record) => {
        if (usedIds.has(record.id)) return false;
        if (record.byExtensionId !== chromeApi.runtime.id) return false;
        const recordStartedAt = Date.parse(record.startTime);
        const requestedAt = Number(item.startRequestedAt);
        if (!Number.isFinite(recordStartedAt) || !Number.isFinite(requestedAt)) return false;
        if (recordStartedAt < requestedAt) return false;
        const sameUrl = record.url === item.startUrl || record.finalUrl === item.startUrl;
        return sameUrl && filenameMatches(record.filename, item.startFilename || item.filename);
      });
    }

    async function cancelTrackedDownload(downloadId) {
      try {
        await chromeApi.downloads.cancel(downloadId);
      } catch (error) {
        await mutateQueue((queue) => {
          const item = queue.items.find((entry) => entry.downloadId === downloadId);
          if (item && ["cancelling", "cancel_requested"].includes(item.status)) {
            item.status = "cancelling";
            item.error = `Cancellation will be retried: ${error.message}`;
          }
        });
        await scheduleAt(Date.now() + startingGraceMs);
        return false;
      }

      let shouldContinue = false;
      await mutateQueue((queue) => {
        const item = queue.items.find((entry) => entry.downloadId === downloadId);
        if (item && ["cancelling", "cancel_requested"].includes(item.status)) {
          item.status = "cancelled";
          delete item.error;
        }
        if (queue.activeDownloadId === downloadId) queue.activeDownloadId = null;
        shouldContinue = queue.state === "running";
      });
      if (shouldContinue) await scheduleNext();
      return true;
    }

    async function reconcileStarting() {
      const snapshot = await locked(async () => {
        const queue = normalizeQueue((await storageGet(STORE.queue))[STORE.queue]);
        return queue.items.filter((item) => ["starting", "cancel_requested"].includes(item.status)).map((item) => ({ ...item }));
      });
      if (!snapshot.length) return { found: false, waiting: false };

      const earliest = Math.min(...snapshot.map((item) => item.startRequestedAt || Date.now())) - 60000;
      const records = await chromeApi.downloads.search({ startedAfter: new Date(earliest).toISOString(), orderBy: ["-startTime"], limit: 100 });
      const usedIds = new Set();
      const matches = new Map();
      for (const item of snapshot) {
        const record = findStartedRecord(item, records, usedIds);
        if (record) {
          matches.set(item.queueId, record);
          usedIds.add(record.id);
        }
      }

      const cancelIds = [];
      let waitingUntil = 0;
      let adopted = false;
      await mutateQueue((queue) => {
        for (const item of queue.items) {
          if (!["starting", "cancel_requested"].includes(item.status)) continue;
          const record = matches.get(item.queueId);
          if (record) {
            adopted = true;
            item.downloadId = record.id;
            if (record.state === "complete") item.status = "complete";
            else if (record.state === "interrupted") item.status = item.status === "cancel_requested" ? "cancelled" : "failed";
            else if (item.status === "cancel_requested") {
              item.status = "cancelling";
              queue.activeDownloadId = record.id;
              cancelIds.push(record.id);
            } else {
              item.status = "downloading";
              queue.activeDownloadId = record.id;
            }
            continue;
          }
          const retryAt = (item.startRequestedAt || 0) + startingGraceMs;
          if (Date.now() >= retryAt) item.status = item.status === "cancel_requested" ? "cancelled" : "pending";
          else waitingUntil = Math.max(waitingUntil, retryAt);
        }
      });

      for (const id of cancelIds) await cancelTrackedDownload(id);
      if (waitingUntil) await scheduleAt(waitingUntil);
      return { found: adopted, waiting: Boolean(waitingUntil) };
    }

    async function reconcileActive() {
      const snapshot = await locked(async () => {
        const queue = normalizeQueue((await storageGet(STORE.queue))[STORE.queue]);
        if (!queue.activeDownloadId) return null;
        const item = queue.items.find((entry) => entry.downloadId === queue.activeDownloadId);
        return { id: queue.activeDownloadId, status: item?.status };
      });
      if (!snapshot) return { wasActive: false, terminal: false };
      const [record] = await chromeApi.downloads.search({ id: snapshot.id });
      if (record?.state === "in_progress" && snapshot.status === "cancelling") {
        const cancelled = await cancelTrackedDownload(snapshot.id);
        return { wasActive: true, terminal: cancelled };
      }
      let terminal = false;
      await mutateQueue((queue) => {
        if (queue.activeDownloadId !== snapshot.id) return;
        const item = queue.items.find((entry) => entry.downloadId === snapshot.id);
        if (record?.state === "in_progress") return;
        terminal = true;
        if (item) {
          if (!record) {
            item.status = "failed";
            item.error = "Chrome no longer has a record of this download. Reload the source page and retry.";
          } else if (record.state === "complete") item.status = "complete";
          else item.status = item.status === "cancelling" ? "cancelled" : "failed";
        }
        queue.activeDownloadId = null;
      });
      return { wasActive: true, terminal };
    }

    async function runProcessQueue() {
      const activeResult = await reconcileActive();
      if (activeResult.wasActive) {
        if (activeResult.terminal) await scheduleNext();
        return;
      }
      const startingResult = await reconcileStarting();
      if (startingResult.found || startingResult.waiting) return;

      const claim = await mutateQueue((queue) => {
        if (["paused", "cancelled"].includes(queue.state)) return null;
        if (queue.activeDownloadId || queue.items.some((item) => ["starting", "cancel_requested", "downloading", "cancelling"].includes(item.status))) return null;
        const next = queue.items.find((item) => item.status === "pending");
        if (!next) {
          if (!queue.items.length) queue.state = "idle";
          else queue.state = queue.items.some((item) => item.status === "failed") ? "finished_with_errors" : "complete";
          return null;
        }
        queue.state = "running";
        next.status = "starting";
        next.attempts = (next.attempts || 0) + 1;
        next.startRequestedAt = Date.now();
        next.startUrl = next.media.url;
        next.startFilename = next.filename;
        return { queueId: next.queueId, url: next.media.url, filename: next.filename };
      });
      if (!claim) return;

      let downloadId;
      try {
        downloadId = await startDownload({ url: claim.url, filename: claim.filename, conflictAction: "uniquify", saveAs: false });
      } catch (error) {
        await mutateQueue((queue) => {
          const item = queue.items.find((entry) => entry.queueId === claim.queueId);
          if (!item || !["starting", "cancel_requested"].includes(item.status)) return;
          item.status = item.status === "cancel_requested" ? "cancelled" : "failed";
          item.error = item.status === "failed" ? `${error.message} The Instagram CDN link may have expired; reload the page and collect it again.` : undefined;
        });
        await scheduleNext();
        return;
      }

      let cancelNow = false;
      await mutateQueue((queue) => {
        const item = queue.items.find((entry) => entry.queueId === claim.queueId);
        if (!item) {
          cancelNow = true;
          return;
        }
        if (item.status === "cancelled" && item.downloadId === downloadId) {
          if (queue.activeDownloadId === downloadId) queue.activeDownloadId = null;
          return;
        }
        item.downloadId = downloadId;
        if (["cancel_requested", "cancelled", "cancelling"].includes(item.status) || queue.state === "cancelled") {
          item.status = "cancelling";
          cancelNow = true;
        } else item.status = "downloading";
        queue.activeDownloadId = downloadId;
      });
      if (cancelNow) {
        await cancelTrackedDownload(downloadId);
      }
    }

    function processQueue() {
      if (processingPromise) return processingPromise;
      processingPromise = runProcessQueue().finally(() => { processingPromise = null; });
      return processingPromise;
    }

    async function initialize() {
      // Normalize/prune the latest stored queue under the same mutation lock;
      // never write an initialization snapshot captured before another event.
      await mutateQueue(() => {});
    }

    async function enqueue(items, settingsOverride) {
      const settings = { ...(await getSettings()), ...(settingsOverride || {}) };
      let added = 0;
      await mutateQueue((queue) => {
        const requestedStart = utils.clampInteger(settings.sequenceStart, 0, 99999999, 1);
        const cursor = Number.isInteger(queue.sequenceCursor)
          ? Math.max(queue.sequenceCursor, requestedStart)
          : requestedStart + queue.items.length;
        const planned = utils.planQueue(Array.isArray(items) ? items.slice(0, 1000) : [], { ...settings, sequenceStart: cursor });
        queue.items.push(...planned);
        queue.sequenceCursor = cursor + planned.length;
        if (planned.length) queue.state = "running";
        added = planned.length;
      });
      // The durable pending item is the acknowledgement boundary. Never keep
      // an MV3 runtime message open while Chrome resolves an external download
      // callback; the alarm guarantees another worker can resume if suspended.
      if (added) {
        void scheduleAt(Date.now() + 250).catch(() => {});
        void processQueue().catch(() => {});
      }
      return added;
    }

    async function pause() {
      await mutateQueue((queue) => { queue.state = "paused"; });
    }

    async function resume() {
      await mutateQueue((queue) => { queue.state = "running"; });
      await processQueue();
    }

    async function cancelPending() {
      await mutateQueue((queue) => {
        queue.state = "cancelled";
        for (const item of queue.items) {
          if (item.status === "pending") item.status = "cancelled";
          else if (item.status === "starting") item.status = "cancel_requested";
        }
      });
      // A service worker may have been suspended after Chrome created the
      // download but before its callback returned. Search and cancel now.
      await reconcileStarting();
    }

    async function retryFailed({ process = true } = {}) {
      const libraryById = new Map((await getLibrary()).map((item) => [utils.stableId(item), item]));
      let retried = 0;
      await mutateQueue((queue) => {
        for (const item of queue.items) if (item.status === "failed") {
          const fresh = libraryById.get(utils.stableId(item.media));
          if (fresh) item.media = { ...item.media, ...fresh };
          item.status = "pending";
          delete item.error;
          delete item.downloadId;
          delete item.startRequestedAt;
          delete item.startUrl;
          delete item.startFilename;
          retried += 1;
        }
        if (retried) queue.state = "running";
      });
      if (process && retried) await processQueue();
      return retried;
    }

    async function clearHistory() {
      await mutateQueue((queue) => { queue.items = queue.items.filter((item) => !TERMINAL.has(item.status)); });
    }

    async function handleDownloadChanged(delta) {
      if (!delta?.state || !["complete", "interrupted"].includes(delta.state.current)) return;
      let shouldContinue = false;
      await mutateQueue((queue) => {
        const item = queue.items.find((entry) => entry.downloadId === delta.id);
        if (!item) return;
        if (delta.state.current === "complete") item.status = "complete";
        else item.status = ["cancelling", "cancel_requested", "cancelled"].includes(item.status) ? "cancelled" : "failed";
        if (delta.error?.current && item.status === "failed") item.error = delta.error.current;
        if (queue.activeDownloadId === delta.id) queue.activeDownloadId = null;
        shouldContinue = queue.state === "running";
      });
      if (shouldContinue) await scheduleNext();
    }

    return {
      STORE,
      cancelPending,
      clearHistory,
      clearLibrary,
      enqueue,
      getLibrary,
      getQueue,
      getSettings,
      handleDownloadChanged,
      initialize,
      pause,
      processQueue,
      retryFailed,
      resume,
      saveSettings,
      scheduleNext,
      upsertLibrary
    };
  }

  return { createQueueCoordinator };
});
