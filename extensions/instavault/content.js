(() => {
  "use strict";

  const { stableId } = InstaVaultUtils;
  const {
    createIncrementalScriptProcessor,
    preferVideoCandidates,
    shortcodeFromPath
  } = InstaVaultInstagramMetadata;
  const known = new Map();
  const embeddedReels = new Map();
  const scriptProcessor = createIncrementalScriptProcessor({
    maxScriptsPerBatch: 3,
    maxScriptChars: 1500000,
    maxTotalCharsPerBatch: 2500000,
    maxVisitedValues: 40000
  });
  let initialScriptsQueued = false;
  let scan = { running: false, stopRequested: false, rounds: 0, found: 0, stableRounds: 0 };
  let detectTimer = null;

  function validMediaUrl(value) {
    if (!value || /^(blob:|data:)/i.test(value)) return false;
    try { return new URL(value).protocol === "https:"; } catch (_) { return false; }
  }

  function contentType(permalink = location.pathname) {
    let path;
    try { path = new URL(permalink, location.origin).pathname; } catch (_) { path = location.pathname; }
    if (/^\/stories\/highlights\//.test(path)) return "highlight";
    if (/^\/stories\//.test(path)) return "story";
    if (/^\/(?:[^/]+\/)?reels?\//.test(path)) return "reel";
    if (/^\/p\//.test(path)) return "post";
    return "post";
  }

  function inferPermalink(node) {
    const nearby = node.closest("a[href*='/p/'], a[href*='/reel/'], a[href*='/tv/'], a[href*='/stories/']");
    if (nearby?.href) return nearby.href.split("?")[0];
    const container = node.closest("article") || node.parentElement;
    const link = container?.querySelector("a[href*='/p/'], a[href*='/reel/'], a[href*='/tv/']");
    if (link?.href) return link.href.split("?")[0];
    return location.href.split("?")[0];
  }

  function inferUsername(node, permalink) {
    const story = location.pathname.match(/^\/stories\/(?!highlights\/)([^/]+)/);
    if (story) return story[1];
    const article = node.closest("article");
    const profile = article?.querySelector("header a[href^='/']") || article?.querySelector("a[href^='/']");
    const path = profile?.getAttribute("href") || "";
    const match = path.match(/^\/([^/?#]+)\/?$/);
    if (match && !["explore", "reels", "stories", "direct"].includes(match[1])) return match[1];
    const pageProfile = location.pathname.match(/^\/([^/?#]+)(?:\/(?:tagged|saved))?\/?$/);
    if (pageProfile && !["explore", "reels", "stories", "direct", "accounts"].includes(pageProfile[1])) return pageProfile[1];
    const canonical = permalink.match(/instagram\.com\/([^/]+)\/?$/);
    return canonical ? canonical[1] : "instagram";
  }

  function inferTimestamp(node) {
    const container = node.closest("article, [role='dialog']");
    const time = container?.querySelector("time[datetime]");
    const value = time?.dateTime;
    return value && !Number.isNaN(new Date(value).getTime()) ? value : null;
  }

  function queueJsonScriptsFrom(node) {
    if (!(node instanceof Element)) return;
    if (node.matches("script[type='application/json']")) scriptProcessor.enqueue([node]);
    scriptProcessor.enqueue(node.querySelectorAll("script[type='application/json']"));
  }

  async function refreshEmbeddedReels() {
    if (!initialScriptsQueued) {
      scriptProcessor.enqueue(document.querySelectorAll("script[type='application/json']"));
      initialScriptsQueued = true;
    }
    const batch = await scriptProcessor.processNextBatch();
    for (const record of batch.records) embeddedReels.set(record.shortcode, record);
    if (batch.remaining) scheduleDetect();
  }

  function reelShortcodeForNode(node, permalink) {
    const linked = node.closest("a[href]");
    const linkedShortcode = linked ? shortcodeFromPath(linked.href) : null;
    if (linkedShortcode) return linkedShortcode;
    const inferred = shortcodeFromPath(permalink);
    if (inferred) return inferred;
    if (node.tagName === "VIDEO") return shortcodeFromPath(location.pathname);
    return null;
  }

  function qualifiesAsMedia(node) {
    const rect = node.getBoundingClientRect();
    return Boolean(node.closest("article, main, [role='dialog']")) && rect.width >= 160 && rect.height >= 160;
  }

  function mediaFromEmbeddedReel(record) {
    const item = {
      ...record,
      discoveredAt: Date.now(),
      pageUrl: location.href.split("#")[0]
    };
    item.id = stableId(item);
    return item;
  }

  function mediaFromElement(node) {
    const mediaType = node.tagName === "VIDEO" ? "video" : "image";
    const url = mediaType === "video"
      ? node.currentSrc || node.src || node.querySelector("source")?.src
      : node.currentSrc || node.src;
    if (!validMediaUrl(url)) return null;
    if (!qualifiesAsMedia(node)) return null;
    if (mediaType === "image" && /profile_pic|s150x150/i.test(url)) return null;

    const permalink = inferPermalink(node);
    const shortcode = reelShortcodeForNode(node, permalink);
    const item = {
      url,
      mediaType,
      contentType: contentType(permalink),
      permalink,
      username: inferUsername(node, permalink),
      timestamp: inferTimestamp(node),
      discoveredAt: Date.now(),
      pageUrl: location.href.split("#")[0]
    };
    if (shortcode) item.shortcode = shortcode;
    item.id = stableId(item);
    return item;
  }

  function installButton(node, item) {
    if (node.dataset.instaVaultControl === item.id) return;
    node.dataset.instaVaultControl = item.id;
    const host = node.parentElement;
    if (!host) return;
    if (getComputedStyle(host).position === "static") host.classList.add("iv-positioned");
    const old = host.querySelector(":scope > .iv-download-button");
    if (old) old.remove();
    const button = document.createElement("button");
    button.type = "button";
    button.className = "iv-download-button";
    button.textContent = "Save";
    button.title = "Queue this media in InstaVault Downloader";
    button.setAttribute("aria-label", "Download this Instagram media with InstaVault");
    button.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      button.disabled = true;
      const original = button.textContent;
      button.textContent = "Queued";
      try {
        const result = await chrome.runtime.sendMessage({ type: "QUEUE_DOWNLOADS", items: [item] });
        if (!result?.ok) throw new Error(result?.error || "Unable to queue download");
      } catch (_) {
        button.textContent = "Retry";
      } finally {
        setTimeout(() => { button.disabled = false; button.textContent = original; }, 1400);
      }
    });
    host.append(button);
  }

  function clearInstalledButton(node) {
    const host = node.parentElement;
    host?.querySelector(":scope > .iv-download-button")?.remove();
    delete node.dataset.instaVaultControl;
  }

  async function detect(forceReport = false) {
    await refreshEmbeddedReels();
    const candidates = [];
    const selector = "main img, main video, article img, article video, [role='dialog'] img, [role='dialog'] video";
    const nodes = [...document.querySelectorAll(selector)].sort((a, b) => {
      if (a.tagName === b.tagName) return 0;
      return a.tagName === "VIDEO" ? -1 : 1;
    });
    for (const node of nodes) {
      if (!qualifiesAsMedia(node)) continue;
      const permalink = inferPermalink(node);
      const shortcode = reelShortcodeForNode(node, permalink);
      const embedded = shortcode ? embeddedReels.get(shortcode) : null;
      if (shortcode && node.tagName === "IMG" && !embedded) {
        clearInstalledButton(node);
        continue;
      }
      const item = embedded ? mediaFromEmbeddedReel(embedded) : mediaFromElement(node);
      if (item) candidates.push({ ...item, node, shortcode: item.shortcode || shortcode || undefined });
    }

    const preferred = preferVideoCandidates(candidates);
    const preferredNodes = new Set(preferred.map((candidate) => candidate.node));
    for (const candidate of candidates) {
      if (candidate.shortcode && embeddedReels.has(candidate.shortcode) && !preferredNodes.has(candidate.node)) {
        clearInstalledButton(candidate.node);
      }
    }

    const discovered = [];
    for (const candidate of preferred) {
      const { node, ...item } = candidate;
      installButton(node, item);
      const previous = known.get(item.id);
      known.set(item.id, item);
      if (forceReport || !previous || previous.url !== item.url) discovered.push(item);
    }
    if (discovered.length) {
      await chrome.runtime.sendMessage({ type: "DISCOVER_MEDIA", items: discovered }).catch(() => {});
    }
    return discovered.length;
  }

  function scheduleDetect() {
    clearTimeout(detectTimer);
    detectTimer = setTimeout(() => void detect(), 300);
  }

  async function runScan() {
    if (scan.running) return;
    scan = { running: true, stopRequested: false, rounds: 0, found: known.size, stableRounds: 0 };
    let lastSize = known.size;
    while (!scan.stopRequested && scan.rounds < 100 && scan.stableRounds < 7) {
      await detect(scan.rounds === 0);
      scan.rounds += 1;
      scan.found = known.size;
      scan.stableRounds = known.size === lastSize ? scan.stableRounds + 1 : 0;
      lastSize = known.size;
      void chrome.runtime.sendMessage({ type: "SCAN_PROGRESS", scan: { ...scan } }).catch(() => {});
      window.scrollBy({ top: Math.max(500, window.innerHeight * 0.82), behavior: "smooth" });
      await new Promise((resolve) => setTimeout(resolve, 1200));
    }
    scan.running = false;
    void chrome.runtime.sendMessage({ type: "SCAN_PROGRESS", scan: { ...scan } }).catch(() => {});
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || !["START_SCAN", "STOP_SCAN", "GET_SCAN_STATUS", "DETECT_NOW"].includes(message.type)) return false;
    if (message.type === "START_SCAN") {
      void runScan();
      sendResponse({ ok: true, scan });
    } else if (message.type === "STOP_SCAN") {
      scan.stopRequested = true;
      sendResponse({ ok: true, scan });
    } else if (message.type === "GET_SCAN_STATUS") {
      sendResponse({ ok: true, scan });
    } else {
      void detect(true).then((count) => sendResponse({ ok: true, count }));
      return true;
    }
    return false;
  });

  new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === "childList") {
        if (mutation.target instanceof Element && mutation.target.matches("script[type='application/json']")) {
          scriptProcessor.markChanged(mutation.target);
        }
        for (const node of mutation.addedNodes) queueJsonScriptsFrom(node);
      } else if (mutation.type === "characterData") {
        const script = mutation.target.parentElement?.closest("script[type='application/json']");
        if (script) scriptProcessor.markChanged(script);
      }
    }
    scheduleDetect();
  }).observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["src"] });
  window.addEventListener("scroll", scheduleDetect, { passive: true });
  void detect();
})();
