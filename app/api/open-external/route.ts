/**
 * Opens a URL in the OS default browser. The desktop shell's webview traps
 * `window.open` / `target="_blank"`, so external links are routed here instead
 * (the Next.js server runs as a local child of the app and can shell out).
 *
 * Guest/desktop only. http(s) URLs only.
 */
import { NextRequest, NextResponse } from "next/server";
import { spawn } from "node:child_process";
import { GUEST_MODE } from "@/lib/guestMode";

export const runtime = "nodejs";

function opener(): { cmd: string; args: string[] } {
  if (process.platform === "darwin") return { cmd: "open", args: [] };
  if (process.platform === "win32") return { cmd: "cmd", args: ["/c", "start", ""] };
  return { cmd: "xdg-open", args: [] };
}

export async function POST(req: NextRequest) {
  if (!GUEST_MODE) return NextResponse.json({ error: "not found" }, { status: 404 });

  let url: string;
  try {
    url = (await req.json()).url;
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return NextResponse.json({ error: "unsupported protocol" }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: "invalid url" }, { status: 400 });
  }

  const { cmd, args } = opener();
  try {
    const child = spawn(cmd, [...args, url], { detached: true, stdio: "ignore" });
    child.unref();
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
