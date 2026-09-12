(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.InstaVaultUGCGen = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const DEFAULT_ENDPOINT = "http://localhost:3000";

  /** The local UGC{Gen} server. Localhost over http, or your own https deployment. */
  function configuration(settings = {}) {
    const raw = String(settings.ugcGenEndpoint || DEFAULT_ENDPOINT).trim().replace(/\/+$/, "");
    let url;
    try { url = new URL(raw); } catch (_) { throw new Error("Enter the UGC{Gen} address, for example http://localhost:3000."); }
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) throw new Error("UGC{Gen} must be reached over https, or http on localhost.");
    return { endpoint: `${url.origin}/api/campaigns/captures` };
  }

  function fallbackContentType(media) {
    return media.mediaType === "video" ? "video/mp4" : "image/jpeg";
  }

  async function readJson(response) {
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `UGC{Gen} request failed (${response.status}).`);
    return body;
  }

  /** Does the configured server answer? Also tells the panel how many clips are already captured. */
  async function status(fetchFn, settings) {
    const config = configuration(settings);
    const response = await fetchFn(config.endpoint, { method: "GET", cache: "no-store" });
    const body = await readJson(response);
    return { captured: Array.isArray(body.captures) ? body.captures.length : 0 };
  }

  /** Reads the media that is already rendered in the page and hands the bytes to the local server. */
  async function captureMedia(fetchFn, config, media) {
    if (!media?.url) throw new Error("The selected media has no source link.");
    const source = await fetchFn(media.url, { credentials: "omit", cache: "no-store" });
    if (!source.ok) throw new Error(`Instagram media could not be read (${source.status}). Reload the post and try again.`);
    const blob = await source.blob();
    const contentType = blob.type && blob.type !== "application/octet-stream" ? blob.type : fallbackContentType(media);
    const response = await fetchFn(config.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": contentType,
        "X-Capture-Source-Url": encodeURIComponent(media.permalink || media.pageUrl || ""),
        "X-Capture-Author": encodeURIComponent(media.username || "instagram"),
        "X-Capture-Caption": encodeURIComponent(String(media.caption || "").slice(0, 2000)),
        "X-Capture-Posted-At": encodeURIComponent(media.timestamp || "")
      },
      body: blob
    });
    return (await readJson(response)).capture;
  }

  async function sendToUGCGen(fetchFn, settings, items) {
    const config = configuration(settings);
    const media = (items || []).filter((item) => item?.url);
    if (!media.length) throw new Error("Select at least one Instagram image or video.");
    const results = [];
    for (const item of media) results.push(await captureMedia(fetchFn, config, item));
    return results;
  }

  return { DEFAULT_ENDPOINT, configuration, sendToUGCGen, status };
});
