"use client";
import { useEffect } from "react";

/**
 * In the desktop build the webview would open external links inside the app (or
 * not at all). Intercept `window.open` and clicks on external / `target="_blank"`
 * anchors and hand the URL to the OS default browser via `/api/open-external`.
 */
export default function DesktopLinkHandler() {
  useEffect(() => {
    const isExternal = (raw: string | null | undefined): boolean => {
      if (!raw) return false;
      try {
        const u = new URL(raw, location.href);
        return (u.protocol === "http:" || u.protocol === "https:") && u.host !== location.host;
      } catch {
        return false;
      }
    };

    const openExternal = (url: string) => {
      fetch("/api/open-external", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      }).catch(() => {});
    };

    const nativeOpen = window.open.bind(window);
    window.open = ((url?: string | URL, ...rest: unknown[]) => {
      const s = typeof url === "string" ? url : url?.toString();
      if (s && isExternal(s)) {
        openExternal(s);
        return null;
      }
      // @ts-expect-error passthrough
      return nativeOpen(url, ...rest);
    }) as typeof window.open;

    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a) return;
      const href = a.getAttribute("href");
      if (isExternal(href) || (a.target === "_blank" && href)) {
        e.preventDefault();
        openExternal(a.href);
      }
    };
    document.addEventListener("click", onClick, true);

    return () => {
      document.removeEventListener("click", onClick, true);
      window.open = nativeOpen;
    };
  }, []);

  return null;
}
