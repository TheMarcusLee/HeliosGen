(() => {
  "use strict";
  const $ = (selector) => document.querySelector(selector);

  async function load() {
    const result = await chrome.runtime.sendMessage({ type: "GET_SETTINGS" });
    if (!result?.ok) throw new Error(result?.error || "Could not load settings");
    $("#delay-ms").value = result.settings.delayMs;
    $("#filename-template").value = result.settings.filenameTemplate;
    $("#sequence-start").value = result.settings.sequenceStart;
    $("#sequence-padding").value = result.settings.sequencePadding;
    $("#ugcgen-endpoint").value = result.settings.ugcGenEndpoint;
  }

  async function save() {
    const status = $("#save-status");
    const targetStatus = $("#ugcgen-save-status");
    try {
      const result = await chrome.runtime.sendMessage({
        type: "SAVE_SETTINGS",
        settings: {
          delayMs: $("#delay-ms").value,
          filenameTemplate: $("#filename-template").value,
          sequenceStart: $("#sequence-start").value,
          sequencePadding: $("#sequence-padding").value,
          ugcGenEndpoint: $("#ugcgen-endpoint").value
        }
      });
      if (!result?.ok) throw new Error(result?.error || "Save failed");
      status.textContent = "Saved.";
      targetStatus.textContent = "Saved.";
      setTimeout(() => { status.textContent = ""; targetStatus.textContent = ""; }, 1800);
    } catch (error) { status.textContent = error.message; targetStatus.textContent = error.message; }
  }

  $("#save").addEventListener("click", () => void save());
  $("#save-ugcgen").addEventListener("click", () => void save());

  void load().catch((error) => { $("#save-status").textContent = error.message; });
})();
