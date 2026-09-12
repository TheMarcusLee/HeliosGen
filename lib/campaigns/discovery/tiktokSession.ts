import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * One browser, one TikTok visitor cookie, shared by every discovery call.
 *
 * TikTok's public JSON endpoints answer only to a request carrying a visitor
 * cookie that page JavaScript sets, so a plain fetch gets an empty body no
 * matter what headers it carries. One headless page load mints the cookie and
 * every request after rides the same context. The video CDN behaves the same
 * way, which is why media bytes are fetched through the page too.
 *
 * No account, login, or personal cookies are involved. The session is a fresh
 * anonymous profile every time it is created.
 *
 * The browser is whatever is already on the machine: Google Chrome by default,
 * or an explicit executable through HELIOS_TIKTOK_BROWSER. Nothing is downloaded.
 */
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
/** Any tiktok.com page mints the cookie. Explore is the cheapest one. */
const HOME = "https://www.tiktok.com/explore";
export const TIKTOK_ORIGIN = "https://www.tiktok.com";
const CHROME_PATHS = process.platform === "darwin"
  ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", join(homedir(), "Applications/Google Chrome.app/Contents/MacOS/Google Chrome"), "/Applications/Chromium.app/Contents/MacOS/Chromium", "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"]
  : process.platform === "win32"
    ? [join(process.env["PROGRAMFILES"] ?? "C:\\Program Files", "Google/Chrome/Application/chrome.exe"), join(process.env["PROGRAMFILES(X86)"] ?? "C:\\Program Files (x86)", "Google/Chrome/Application/chrome.exe"), join(process.env["LOCALAPPDATA"] ?? "", "Google/Chrome/Application/chrome.exe"), join(process.env["PROGRAMFILES"] ?? "C:\\Program Files", "Microsoft/Edge/Application/msedge.exe")]
    : ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/snap/bin/chromium", "/usr/bin/microsoft-edge"];

export interface BrowserStatus { available: boolean; executable?: string; note: string }
/** Which local browser live discovery would launch. Cheap; touches only the filesystem. */
export function tiktokBrowserStatus(): BrowserStatus {
  const override = process.env.HELIOS_TIKTOK_BROWSER;
  if (override) return existsSync(override) ? { available: true, executable: override, note: `Using HELIOS_TIKTOK_BROWSER (${override}).` } : { available: false, note: `HELIOS_TIKTOK_BROWSER points to a missing file: ${override}.` };
  const found = CHROME_PATHS.find(p => p && existsSync(p));
  if (found) return { available: true, executable: found, note: `Using the installed browser at ${found}.` };
  return { available: false, note: "Install Google Chrome (or set HELIOS_TIKTOK_BROWSER to a Chromium executable) to enable live TikTok discovery." };
}

export interface TikTokSession {
  getJson(path: string): Promise<unknown>;
  /** Media bytes for a CDN URL fetched inside the page, so the visitor cookie is attached. */
  getBytes(url: string, maxBytes?: number): Promise<{ buffer: Buffer; contentType: string } | undefined>;
  close(): Promise<void>;
}
/** Runs one call at a time, in order. Two evaluations on one page would tear it out from under each other. */
function createSerialQueue() {
  let chain: Promise<unknown> = Promise.resolve();
  return <T>(fn: () => Promise<T>): Promise<T> => {
    const next = chain.then(fn, fn);
    chain = next.then(() => undefined, () => undefined);
    return next;
  };
}
type Page = import("playwright-core").Page;
export function createTikTokSession(options: { sessionTtlMs?: number } = {}): TikTokSession {
  let browser: import("playwright-core").Browser | undefined;
  let context: import("playwright-core").BrowserContext | undefined;
  let page: Page | undefined;
  let mintedAt = 0;
  const ttl = options.sessionTtlMs ?? 30 * 60 * 1000;
  const fresh = () => !!context && Date.now() - mintedAt < ttl;
  async function ensure(): Promise<Page> {
    if (fresh() && page && !page.isClosed()) return page;
    const status = tiktokBrowserStatus();
    if (!status.available) throw new Error(status.note);
    const { chromium } = await import("playwright-core");
    if (!browser) browser = await chromium.launch({ headless: true, executablePath: status.executable });
    if (!fresh()) {
      if (context) await context.close().catch(() => {});
      context = await browser.newContext({ userAgent: UA, locale: "en-US" });
      page = undefined;
    }
    if (!page || page.isClosed()) {
      page = await context!.newPage();
      // The visit is the point; nothing on the rendered page is read.
      await page.goto(HOME, { waitUntil: "domcontentloaded", timeout: 45_000 });
      await page.waitForTimeout(3_000);
    }
    mintedAt = Date.now();
    return page;
  }
  const serial = createSerialQueue();
  return {
    getJson(path) {
      return serial(async () => {
        const p = await ensure();
        return p.evaluate(async (target: string) => {
          const res = await fetch(target, { credentials: "include" });
          return res.json().catch(() => null);
        }, `${TIKTOK_ORIGIN}${path}`);
      });
    },
    getBytes(url, maxBytes = 100 * 1024 * 1024) {
      return serial(async () => {
        const p = await ensure();
        const result = await p.evaluate(async ([target, cap]: [string, number]) => {
          const res = await fetch(target, { credentials: "include" });
          if (!res.ok) return undefined;
          const buf = await res.arrayBuffer();
          if (buf.byteLength > cap) return undefined;
          const bytes = new Uint8Array(buf);
          let binary = "";
          for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
          return { base64: btoa(binary), contentType: res.headers.get("content-type") ?? "video/mp4" };
        }, [url, maxBytes] as [string, number]);
        return result ? { buffer: Buffer.from(result.base64, "base64"), contentType: result.contentType } : undefined;
      });
    },
    async close() {
      await context?.close().catch(() => {});
      await browser?.close().catch(() => {});
      browser = context = page = undefined;
    },
  };
}
/** One browser per server process, including across hot module reloads. */
const state = globalThis as typeof globalThis & { tiktokSession?: TikTokSession };
export function sharedTikTokSession(): TikTokSession {
  return state.tiktokSession ??= createTikTokSession();
}
export async function closeTikTokSession() {
  const session = state.tiktokSession; state.tiktokSession = undefined;
  await session?.close();
}
