(() => {
  "use strict";
  const $ = (selector) => document.querySelector(selector);

  async function message(type) {
    const result = await chrome.runtime.sendMessage({ type });
    if (!result?.ok) throw new Error(result?.error || "Request failed");
    return result;
  }

  async function activeInstagramTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab.url?.startsWith("https://www.instagram.com/")) throw new Error("Open Instagram in the active tab first.");
    return tab;
  }

  async function refresh() {
    const [library, queue] = await Promise.all([message("GET_LIBRARY"), message("GET_QUEUE")]);
    $("#library-count").textContent = library.items.length;
    $("#queue-status").textContent = (queue.queue.state || "idle").replaceAll("_", " ");
  }

  $("#open-library").addEventListener("click", async () => {
    try {
      const tab = await activeInstagramTab();
      await chrome.sidePanel.open({ tabId: tab.id });
      window.close();
    } catch (error) { $("#status").textContent = error.message; }
  });
  $("#scan-page").addEventListener("click", async () => {
    try {
      const tab = await activeInstagramTab();
      await chrome.tabs.sendMessage(tab.id, { type: "START_SCAN" });
      $("#status").textContent = "Scan started. Open the library to follow progress.";
    } catch (error) { $("#status").textContent = error.message; }
  });
  $("#collect-visible").addEventListener("click", async () => {
    try {
      const tab = await activeInstagramTab();
      const result = await chrome.tabs.sendMessage(tab.id, { type: "DETECT_NOW" });
      $("#status").textContent = `Collected ${result.count} newly visible item(s).`;
      await refresh();
    } catch (error) { $("#status").textContent = error.message; }
  });

  void refresh().catch((error) => { $("#status").textContent = error.message; });
})();
