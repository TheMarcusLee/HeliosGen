import { NextRequest } from "next/server";
import { cpSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR } from "@/lib/guest/paths";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const { spawn } = process.getBuiltinModule("child_process") as typeof import("node:child_process");

/**
 * The bundled InstaVault extension. In development it is the repo folder; in
 * the packaged app it is staged next to the server. "Install" copies it to a
 * stable, user-visible folder under the app data directory so Chrome's "Load
 * unpacked" has something that survives app updates, then reveals that folder.
 */
export function bundledExtensionDir() {
  const candidates = [join(process.cwd(), "extensions", "instavault"), join(process.cwd(), "..", "extensions", "instavault")];
  return candidates.find(dir => existsSync(join(dir, "manifest.json")));
}
export function installedExtensionDir() { return join(DATA_DIR, "extensions", "instavault"); }
function version(dir: string) { try { return JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")).version as string; } catch { return undefined; } }
export async function GET() {
  const bundled = bundledExtensionDir(), installed = installedExtensionDir();
  return Response.json({ available: !!bundled, bundledVersion: bundled ? version(bundled) : undefined, installedPath: existsSync(join(installed, "manifest.json")) ? installed : undefined, installedVersion: version(installed) });
}
export async function POST(req: NextRequest) {
  const bundled = bundledExtensionDir();
  if (!bundled) return Response.json({ error: "The browser extension is not bundled with this build." }, { status: 404 });
  const target = installedExtensionDir();
  cpSync(bundled, target, { recursive: true, filter: src => !/node_modules|\.DS_Store/.test(src) });
  const reveal = new URL(req.url).searchParams.get("reveal") !== "0";
  if (reveal) {
    const opener = process.platform === "darwin" ? { cmd: "open", args: [target] } : process.platform === "win32" ? { cmd: "explorer", args: [target] } : { cmd: "xdg-open", args: [target] };
    try { const child = spawn(opener.cmd, opener.args, { detached: true, stdio: "ignore" }); child.unref(); } catch { /* revealing is best effort */ }
  }
  return Response.json({ ok: true, path: target, version: version(target) });
}
