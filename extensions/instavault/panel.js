(() => {
  "use strict";

  const { DEFAULT_SETTINGS, inDateRange } = InstaVaultUtils;
  const $ = (selector) => document.querySelector(selector);
  const selected = new Set();
  let library = [];
  let settings = { ...DEFAULT_SETTINGS };

  async function message(payload) {
    const result = await chrome.runtime.sendMessage(payload);
    if (!result?.ok) throw new Error(result?.error || "Extension request failed");
    return result;
  }

  async function instagramTab() {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    return tabs.find((tab) => tab.url?.startsWith("https://www.instagram.com/")) || null;
  }

  async function tabMessage(payload) {
    const tab = await instagramTab();
    if (!tab?.id) throw new Error("Open Instagram in the active tab first.");
    return chrome.tabs.sendMessage(tab.id, payload);
  }

  function filteredItems() {
    const type = $("#type-filter").value;
    const username = $("#username-filter").value.trim().toLowerCase();
    return library.filter((item) => {
      const typeMatch = type === "all" || item.contentType === type || item.mediaType === type;
      const userMatch = !username || String(item.username || "").toLowerCase().includes(username);
      return typeMatch && userMatch && inDateRange(item.timestamp, $("#date-from").value, $("#date-to").value);
    });
  }

  function createPreview(item) {
    if (item.mediaType === "image") {
      const image = document.createElement("img");
      image.src = item.url;
      image.alt = "Instagram media preview";
      image.loading = "lazy";
      image.referrerPolicy = "no-referrer";
      image.addEventListener("error", () => image.replaceWith(Object.assign(document.createElement("div"), { className: "mark", textContent: "IMG" })));
      return image;
    }
    const placeholder = document.createElement("div");
    placeholder.className = "mark";
    placeholder.textContent = "VID";
    return placeholder;
  }

  function render() {
    const items = filteredItems();
    const list = $("#media-list");
    list.replaceChildren();
    if (!items.length) {
      const empty = document.createElement("div");
      empty.className = "empty card";
      empty.textContent = "No matching media yet. Open an Instagram page and choose Scan page.";
      list.append(empty);
    }
    for (const item of items) {
      const row = document.createElement("label");
      row.className = `media-item${selected.has(item.id) ? " selected" : ""}`;
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = selected.has(item.id);
      checkbox.setAttribute("aria-label", `Select ${item.contentType || item.mediaType}`);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) selected.add(item.id); else selected.delete(item.id);
        render();
      });
      const meta = document.createElement("div");
      meta.className = "media-meta";
      const title = document.createElement("strong");
      title.textContent = `@${item.username || "instagram"} · ${item.contentType || item.mediaType}`;
      const date = document.createElement("span");
      date.textContent = item.timestamp ? new Date(item.timestamp).toLocaleString() : "Date unavailable";
      const link = document.createElement("a");
      link.href = item.permalink || item.pageUrl;
      link.target = "_blank";
      link.rel = "noreferrer";
      link.textContent = "Open source";
      link.addEventListener("click", (event) => event.stopPropagation());
      meta.append(title, date, link);
      row.append(checkbox, createPreview(item), meta);
      list.append(row);
    }
    $("#summary").firstElementChild.textContent = `${items.length} shown / ${library.length} collected`;
    $("#summary").lastElementChild.textContent = `${selected.size} selected`;
    $("#download-selected").disabled = selected.size === 0;
    $("#ugcgen-send").disabled = selected.size === 0;
  }

  async function loadUGCGenStatus() {
    try {
      const result = await message({ type: "GET_UGCGEN_STATUS" });
      $("#ugcgen-status").textContent = `UGC{Gen} connected · ${result.status.captured} captured`;
    } catch (error) {
      $("#ugcgen-status").textContent = `UGC{Gen} unreachable: ${error.message}`;
    }
  }

  async function sendToUGCGen() {
    const items = library.filter((item) => selected.has(item.id));
    if (!items.length) return;
    $("#ugcgen-send").disabled = true;
    $("#ugcgen-status").textContent = "Sending media…";
    try {
      const result = await message({ type: "SEND_TO_UGCGEN", items });
      const count = result.results.length;
      $("#ugcgen-status").textContent = `${count} ${count === 1 ? "clip" : "clips"} added to UGC{Gen} source clips.`;
      selected.clear();
    } catch (error) {
      $("#ugcgen-status").textContent = error.message;
    }
    render();
  }

  async function refresh() {
    const [libraryResult, settingsResult, queueResult] = await Promise.all([
      message({ type: "GET_LIBRARY" }),
      message({ type: "GET_SETTINGS" }),
      message({ type: "GET_QUEUE" })
    ]);
    library = libraryResult.items;
    settings = settingsResult.settings;
    $("#filename-template").value = settings.filenameTemplate;
    $("#sequence-start").value = settings.sequenceStart;
    $("#sequence-padding").value = settings.sequencePadding;
    updateQueue(queueResult.queue);
    render();
    void loadUGCGenStatus();
  }

  function updateQueue(queue) {
    const counts = (queue?.items || []).reduce((all, item) => {
      all[item.status] = (all[item.status] || 0) + 1;
      return all;
    }, {});
    const state = queue?.state || "idle";
    $("#queue-state").textContent = `Queue ${state.replaceAll("_", " ")}`;
    $("#queue-detail").textContent = `${counts.complete || 0} complete · ${counts.failed || 0} failed · ${(counts.pending || 0) + (counts.starting || 0) + (counts.downloading || 0)} remaining`;
    $("#queue-dot").classList.toggle("running", state === "running");
  }

  async function saveSettings() {
    const result = await message({
      type: "SAVE_SETTINGS",
      settings: {
        filenameTemplate: $("#filename-template").value,
        sequenceStart: $("#sequence-start").value,
        sequencePadding: $("#sequence-padding").value
      }
    });
    settings = result.settings;
    return settings;
  }

  $("#refresh").addEventListener("click", () => void refresh());
  for (const id of ["#type-filter", "#username-filter", "#date-from", "#date-to"]) $(id).addEventListener("input", render);
  $("#select-all").addEventListener("click", () => { for (const item of filteredItems()) selected.add(item.id); render(); });
  $("#clear-selection").addEventListener("click", () => { selected.clear(); render(); });
  $("#clear-library").addEventListener("click", async () => {
    if (!confirm("Clear the locally collected media library? Downloaded files are not affected.")) return;
    await message({ type: "CLEAR_LIBRARY" });
    library = [];
    selected.clear();
    render();
  });
  $("#scan").addEventListener("click", async () => {
    try {
      const result = await tabMessage({ type: "START_SCAN" });
      $("#scan-status").textContent = `Scanning · ${result.scan.found} found`;
      $("#scan").disabled = true;
      $("#stop-scan").disabled = false;
    } catch (error) { $("#scan-status").textContent = error.message; }
  });
  $("#stop-scan").addEventListener("click", async () => {
    await tabMessage({ type: "STOP_SCAN" }).catch(() => {});
    $("#scan-status").textContent = "Stopping…";
  });
  $("#download-selected").addEventListener("click", async () => {
    const items = library.filter((item) => selected.has(item.id));
    if (!items.length) return;
    const currentSettings = await saveSettings();
    const result = await message({ type: "QUEUE_DOWNLOADS", items, settings: currentSettings });
    $("#download-selected").textContent = `${result.added} queued`;
    selected.clear();
    setTimeout(() => { $("#download-selected").textContent = "Download selected"; render(); }, 1200);
    render();
  });
  $("#ugcgen-send").addEventListener("click", () => void sendToUGCGen());
  for (const [id, type] of [["#pause-queue", "PAUSE_QUEUE"], ["#resume-queue", "RESUME_QUEUE"], ["#retry-failed", "RETRY_FAILED"], ["#clear-history", "CLEAR_QUEUE_HISTORY"], ["#cancel-queue", "CANCEL_QUEUE"]]) {
    $(id).addEventListener("click", async () => { await message({ type }); updateQueue((await message({ type: "GET_QUEUE" })).queue); });
  }
  for (const id of ["#filename-template", "#sequence-start", "#sequence-padding"]) $(id).addEventListener("change", () => void saveSettings());

  chrome.runtime.onMessage.addListener((event) => {
    if (event.type === "QUEUE_UPDATED") updateQueue(event.queue);
    if (event.type === "SCAN_PROGRESS") {
      const state = event.scan;
      $("#scan-status").textContent = `${state.running ? "Scanning" : "Scan complete"} · ${state.found} found · round ${state.rounds}`;
      $("#scan").disabled = state.running;
      $("#stop-scan").disabled = !state.running;
      if (!state.running || state.rounds % 2 === 0) void refresh();
    }
  });

  void refresh().catch((error) => { $("#scan-status").textContent = error.message; });
})();
