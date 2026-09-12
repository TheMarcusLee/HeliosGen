importScripts("shared/utils.js", "shared/queue-manager.js", "shared/ugcgen-client.js");

"use strict";

const queue = InstaVaultQueue.createQueueCoordinator(chrome, InstaVaultUtils, {
  maxLibraryItems: 2500,
  maxTerminalHistory: 500
});

async function ensureRecoveryAlarm() {
  await chrome.alarms.create("queue-recover", { periodInMinutes: 1 });
}

chrome.runtime.onInstalled.addListener(async () => {
  await queue.initialize();
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
  await ensureRecoveryAlarm();
  void queue.processQueue();
});

chrome.runtime.onStartup.addListener(() => {
  void queue.initialize().then(() => queue.processQueue());
  void ensureRecoveryAlarm();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "queue-next" || alarm.name === "queue-recover") void queue.processQueue();
});

chrome.downloads.onChanged.addListener((delta) => void queue.handleDownloadChanged(delta));

const ALLOWED_MESSAGES = new Set([
  "DISCOVER_MEDIA", "GET_LIBRARY", "CLEAR_LIBRARY", "GET_SETTINGS", "SAVE_SETTINGS",
  "QUEUE_DOWNLOADS", "GET_QUEUE", "PAUSE_QUEUE", "RESUME_QUEUE", "CANCEL_QUEUE",
  "RETRY_FAILED", "CLEAR_QUEUE_HISTORY", "GET_UGCGEN_STATUS", "SEND_TO_UGCGEN"
]);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !ALLOWED_MESSAGES.has(message.type)) return false;
  if (sender.tab?.url && !sender.tab.url.startsWith("https://www.instagram.com/")) return false;

  (async () => {
    switch (message.type) {
      case "DISCOVER_MEDIA": {
        const library = await queue.upsertLibrary(Array.isArray(message.items) ? message.items.slice(0, 100) : []);
        return { ok: true, count: library.length };
      }
      case "GET_LIBRARY":
        return { ok: true, items: await queue.getLibrary() };
      case "CLEAR_LIBRARY":
        await queue.clearLibrary();
        return { ok: true };
      case "GET_SETTINGS":
        return { ok: true, settings: await queue.getSettings() };
      case "SAVE_SETTINGS":
        return { ok: true, settings: await queue.saveSettings(message.settings) };
      case "QUEUE_DOWNLOADS":
        return { ok: true, added: await queue.enqueue(Array.isArray(message.items) ? message.items : [], message.settings) };
      case "GET_QUEUE":
        return { ok: true, queue: await queue.getQueue() };
      case "PAUSE_QUEUE":
        await queue.pause();
        return { ok: true };
      case "RESUME_QUEUE":
        await queue.resume();
        return { ok: true };
      case "CANCEL_QUEUE":
        await queue.cancelPending();
        return { ok: true };
      case "RETRY_FAILED":
        return { ok: true, retried: await queue.retryFailed() };
      case "CLEAR_QUEUE_HISTORY":
        await queue.clearHistory();
        return { ok: true };
      case "GET_UGCGEN_STATUS":
        return { ok: true, status: await InstaVaultUGCGen.status(fetch, await queue.getSettings()) };
      case "SEND_TO_UGCGEN": {
        const items = Array.isArray(message.items) ? message.items.slice(0, 100) : [];
        return { ok: true, results: await InstaVaultUGCGen.sendToUGCGen(fetch, await queue.getSettings(), items) };
      }
      default:
        return { ok: false };
    }
  })().then(sendResponse).catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
});
