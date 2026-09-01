// Runs `next dev` and `tauri dev` together for desktop development.
// The Tauri shell reads HELIOS_DEV_URL and just points its window there.

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DEV_URL = process.env.HELIOS_DEV_URL || "http://localhost:3000";
const APP_VERSION = JSON.parse(
  readFileSync(join(ROOT, "src-tauri", "tauri.conf.json"), "utf8"),
).version;

const children = [];
function launch(name, cmd, args, extraEnv = {}) {
  const child = spawn(cmd, args, {
    cwd: ROOT,
    stdio: "inherit",
    env: { ...process.env, ...extraEnv },
    shell: process.platform === "win32",
  });
  child.on("exit", (code) => {
    console.log(`[desktop:dev] ${name} exited (${code})`);
    shutdown();
  });
  children.push(child);
}

function shutdown() {
  for (const c of children) {
    if (!c.killed) c.kill("SIGTERM");
  }
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

launch("next", "node", [join(ROOT, "node_modules", "next", "dist", "bin", "next"), "dev"], {
  GUEST_MODE: "true",
  NEXT_PUBLIC_GUEST_MODE: "true",
  NEXT_PUBLIC_APP_VERSION: APP_VERSION,
  NODE_OPTIONS: "--disable-warning=ExperimentalWarning", // node:sqlite
});

const tauriBin = join(
  ROOT,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "tauri.cmd" : "tauri",
);
launch("tauri", tauriBin, ["dev"], { HELIOS_DEV_URL: DEV_URL });
