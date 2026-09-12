(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.InstaVaultInstagramMetadata = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const DEFAULT_LIMITS = Object.freeze({
    maxScriptChars: 2000000,
    maxTotalChars: 4000000,
    maxScripts: 8,
    maxVisitedValues: 50000
  });

  function positiveLimit(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
  }

  function relevantScriptText(text) {
    return text.includes("video_versions") && (text.includes('"code"') || text.includes('"shortcode"'));
  }

  function unescapeUrl(value) {
    let result = String(value || "");
    for (let pass = 0; pass < 2; pass += 1) {
      result = result
        .replace(/\\u0026/gi, "&")
        .replace(/\\u003d/gi, "=")
        .replace(/\\u002f/gi, "/")
        .replace(/\\\//g, "/")
        .replace(/&amp;/gi, "&");
    }
    return result;
  }

  function safeHttpsUrl(value) {
    const unescaped = unescapeUrl(value);
    try {
      const url = new URL(unescaped);
      return url.protocol === "https:" ? url.toString() : null;
    } catch (_) {
      return null;
    }
  }

  function selectBestVideoVersion(versions) {
    const unique = new Map();
    for (const version of Array.isArray(versions) ? versions : []) {
      const url = safeHttpsUrl(version?.url);
      if (!url || unique.has(url)) continue;
      const width = Math.max(0, Number(version.width) || 0);
      const height = Math.max(0, Number(version.height) || 0);
      unique.set(url, { url, width, height, area: width * height });
    }
    const [best] = [...unique.values()].sort((a, b) => b.area - a.area || b.width - a.width || b.height - a.height);
    return best ? { url: best.url, width: best.width, height: best.height } : null;
  }

  function normalizeTimestamp(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) return null;
    const milliseconds = numeric > 100000000000 ? numeric : numeric * 1000;
    const date = new Date(milliseconds);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  function normalizeRecord(source) {
    const shortcode = String(source?.code || source?.shortcode || "");
    if (!/^[A-Za-z0-9_-]+$/.test(shortcode)) return null;
    const video = selectBestVideoVersion(source.video_versions);
    if (!video) return null;
    const username = String(source.user?.username || source.owner?.username || source.username || "instagram");
    return {
      shortcode,
      url: video.url,
      width: video.width,
      height: video.height,
      username,
      timestamp: normalizeTimestamp(source.taken_at ?? source.taken_at_timestamp),
      mediaType: "video",
      contentType: "reel",
      permalink: `https://www.instagram.com/reel/${shortcode}/`
    };
  }

  function extractMediaRecords(scriptTexts, options = {}) {
    const maxScriptChars = positiveLimit(options.maxScriptChars, DEFAULT_LIMITS.maxScriptChars);
    const maxTotalChars = positiveLimit(options.maxTotalChars, DEFAULT_LIMITS.maxTotalChars);
    const maxScripts = positiveLimit(options.maxScripts, DEFAULT_LIMITS.maxScripts);
    const maxVisitedValues = positiveLimit(options.maxVisitedValues, DEFAULT_LIMITS.maxVisitedValues);
    const byShortcode = new Map();
    let totalChars = 0;
    let scriptCount = 0;
    for (const text of scriptTexts || []) {
      if (scriptCount >= maxScripts) break;
      scriptCount += 1;
      const source = String(text || "");
      if (!source || source.length > maxScriptChars) continue;
      if (totalChars + source.length > maxTotalChars) break;
      totalChars += source.length;
      if (!relevantScriptText(source)) continue;
      let parsed;
      try { parsed = JSON.parse(source); } catch (_) { continue; }
      const stack = [parsed];
      let visited = 0;
      while (stack.length && visited < maxVisitedValues) {
        const value = stack.pop();
        visited += 1;
        if (!value || typeof value !== "object") continue;
        if (!Array.isArray(value)) {
          const record = normalizeRecord(value);
          if (record) {
            const existing = byShortcode.get(record.shortcode);
            const area = record.width * record.height;
            const existingArea = existing ? existing.width * existing.height : -1;
            if (!existing || area >= existingArea) byShortcode.set(record.shortcode, record);
          }
        }
        const children = Array.isArray(value) ? value : Object.values(value);
        for (let index = children.length - 1; index >= 0; index -= 1) stack.push(children[index]);
      }
    }
    return [...byShortcode.values()];
  }

  function shortcodeFromPath(value) {
    const source = String(value || "");
    let url;
    try { url = new URL(source, "https://www.instagram.com/"); } catch (_) { return null; }
    const instagramHost = url.hostname === "instagram.com" || url.hostname.endsWith(".instagram.com");
    if (url.protocol !== "https:" || !instagramHost || source.includes("\\")) return null;
    const match = url.pathname.match(/^\/(?:[A-Za-z0-9._]+\/)?reel\/([A-Za-z0-9_-]+)\/?$/);
    return match ? match[1] : null;
  }

  function createIncrementalScriptProcessor(options = {}) {
    const maxScriptsPerBatch = positiveLimit(options.maxScriptsPerBatch, 3);
    const maxScriptChars = positiveLimit(options.maxScriptChars, DEFAULT_LIMITS.maxScriptChars);
    const maxTotalCharsPerBatch = positiveLimit(options.maxTotalCharsPerBatch, DEFAULT_LIMITS.maxTotalChars);
    const maxVisitedValues = positiveLimit(options.maxVisitedValues, DEFAULT_LIMITS.maxVisitedValues);
    const yieldFn = typeof options.yieldFn === "function"
      ? options.yieldFn
      : () => new Promise((resolve) => setTimeout(resolve, 0));
    const known = new WeakSet();
    const queued = new WeakSet();
    const lastText = new WeakMap();
    const pending = [];

    function add(entry, allowKnown) {
      if (!entry || (typeof entry !== "object" && typeof entry !== "function")) return;
      if (!allowKnown && known.has(entry)) return;
      known.add(entry);
      if (queued.has(entry)) return;
      queued.add(entry);
      pending.push(entry);
    }

    function enqueue(entries) {
      for (const entry of entries || []) add(entry, false);
    }

    function markChanged(entry) {
      add(entry, true);
    }

    async function processNextBatch(readText = (entry) => entry.textContent || "") {
      const byShortcode = new Map();
      let totalChars = 0;
      let processed = 0;
      while (pending.length && processed < maxScriptsPerBatch) {
        const entry = pending.shift();
        queued.delete(entry);
        const text = String(readText(entry) || "");
        processed += 1;
        if (lastText.get(entry) === text) continue;
        if (text.length > maxScriptChars || text.length > maxTotalCharsPerBatch) {
          lastText.set(entry, text);
          if (pending.length) await yieldFn();
          continue;
        }
        if (totalChars + text.length > maxTotalCharsPerBatch) {
          queued.add(entry);
          pending.unshift(entry);
          break;
        }
        totalChars += text.length;
        lastText.set(entry, text);
        if (relevantScriptText(text)) {
          const records = extractMediaRecords([text], {
            maxScriptChars,
            maxTotalChars: maxTotalCharsPerBatch,
            maxScripts: 1,
            maxVisitedValues
          });
          for (const record of records) byShortcode.set(record.shortcode, record);
        }
        if (pending.length) await yieldFn();
      }
      return { records: [...byShortcode.values()], remaining: pending.length, processed, totalChars };
    }

    return { enqueue, markChanged, processNextBatch };
  }

  function preferVideoCandidates(candidates) {
    const videoShortcodes = new Set(
      (candidates || []).filter((item) => item?.shortcode && item.mediaType === "video").map((item) => item.shortcode)
    );
    const seen = new Set();
    const result = [];
    for (const item of candidates || []) {
      if (!item?.url) continue;
      if (item.shortcode && videoShortcodes.has(item.shortcode) && item.mediaType !== "video") continue;
      const key = item.shortcode && item.mediaType === "video"
        ? `reel:${item.shortcode}:video`
        : `${item.mediaType || "media"}:${item.url}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(item);
    }
    return result;
  }

  return {
    createIncrementalScriptProcessor,
    extractMediaRecords,
    preferVideoCandidates,
    safeHttpsUrl,
    selectBestVideoVersion,
    shortcodeFromPath,
    unescapeUrl,
    relevantScriptText
  };
});
