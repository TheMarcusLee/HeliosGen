(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.InstaVaultUtils = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const DEFAULT_SETTINGS = Object.freeze({
    delayMs: 1200,
    filenameTemplate: "{username}_{type}_{date}_{sequence}",
    sequenceStart: 1,
    sequencePadding: 3,
    ugcGenEndpoint: "http://localhost:3000"
  });

  function clampInteger(value, min, max, fallback) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
  }

  function sanitizeSegment(value, fallback = "media") {
    const cleaned = String(value || "")
      .normalize("NFKC")
      .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_")
      .replace(/\s+/g, " ")
      .replace(/^[. ]+|[. ]+$/g, "")
      .slice(0, 100);
    return cleaned || fallback;
  }

  function extensionFor(media) {
    if (media.mediaType === "video") return "mp4";
    const path = safeUrl(media.url)?.pathname || "";
    const match = path.match(/\.([a-z0-9]{2,5})$/i);
    return match && /^(jpe?g|png|webp|gif)$/i.test(match[1]) ? match[1].toLowerCase().replace("jpeg", "jpg") : "jpg";
  }

  function safeUrl(value) {
    try { return new URL(value); } catch (_) { return null; }
  }

  function dateKey(value) {
    const date = value ? new Date(value) : new Date();
    return Number.isNaN(date.getTime()) ? "unknown-date" : date.toISOString().slice(0, 10);
  }

  function buildFilename(media, settings, sequence) {
    const template = String(settings.filenameTemplate || DEFAULT_SETTINGS.filenameTemplate);
    const padding = clampInteger(settings.sequencePadding, 1, 8, 3);
    const seq = String(sequence).padStart(padding, "0");
    const replacements = {
      username: media.username || "instagram",
      type: media.contentType || media.mediaType || "media",
      date: dateKey(media.timestamp || media.discoveredAt),
      id: media.id || "item",
      sequence: seq
    };
    const base = template.replace(/\{(username|type|date|id|sequence)\}/g, (_, key) => replacements[key]);
    return `InstaVault/${sanitizeSegment(base)}.${extensionFor(media)}`;
  }

  function normalizeMediaUrl(value) {
    const url = safeUrl(value);
    if (!url) return "";
    url.search = "";
    url.hash = "";
    return url.toString();
  }

  function reelShortcode(media) {
    const explicit = String(media?.shortcode || "");
    if (/^[A-Za-z0-9_-]+$/.test(explicit) && media?.contentType === "reel") return explicit;
    if (media?.contentType !== "reel" || !media?.permalink) return null;
    try {
      const url = new URL(media.permalink, "https://www.instagram.com");
      if (url.hostname !== "instagram.com" && !url.hostname.endsWith(".instagram.com")) return null;
      return url.pathname.match(/^\/(?:[A-Za-z0-9._]+\/)?reel\/([A-Za-z0-9_-]+)\/?$/)?.[1] || null;
    } catch (_) {
      return null;
    }
  }

  function stableId(media) {
    const shortcode = reelShortcode(media);
    const input = media.mediaType === "video" && shortcode
      ? `reel:${shortcode}:video`
      : `${media.permalink || ""}|${normalizeMediaUrl(media.url)}|${media.mediaType || ""}`;
    let hash = 2166136261;
    for (let index = 0; index < input.length; index += 1) {
      hash ^= input.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return `iv_${(hash >>> 0).toString(36)}`;
  }

  function dedupeMedia(items) {
    const byId = new Map();
    for (const item of items || []) {
      if (!item || !item.url) continue;
      const current = { ...item };
      current.id = current.mediaType === "video" && reelShortcode(current) ? stableId(current) : item.id || stableId(current);
      const previous = byId.get(current.id);
      byId.set(current.id, previous ? { ...previous, ...current } : current);
    }
    const deduped = [...byId.values()];
    const videoShortcodes = new Set(deduped.filter((item) => item.mediaType === "video").map(reelShortcode).filter(Boolean));
    return deduped.filter((item) => {
      const shortcode = reelShortcode(item);
      return !shortcode || item.mediaType === "video" || !videoShortcodes.has(shortcode);
    });
  }

  function inDateRange(timestamp, from, to) {
    if (!from && !to) return true;
    if (!timestamp) return false;
    const value = new Date(timestamp).getTime();
    if (Number.isNaN(value)) return false;
    if (from && value < new Date(`${from}T00:00:00`).getTime()) return false;
    if (to && value > new Date(`${to}T23:59:59.999`).getTime()) return false;
    return true;
  }

  function planQueue(items, settings) {
    const start = clampInteger(settings.sequenceStart, 0, 99999999, 1);
    return dedupeMedia(items).map((media, index) => ({
      queueId: `${media.id}_${start + index}_${Date.now()}_${index}`,
      media,
      filename: buildFilename(media, settings, start + index),
      status: "pending",
      attempts: 0
    }));
  }

  return {
    DEFAULT_SETTINGS,
    buildFilename,
    clampInteger,
    dateKey,
    dedupeMedia,
    inDateRange,
    normalizeMediaUrl,
    planQueue,
    reelShortcode,
    sanitizeSegment,
    stableId
  };
});
