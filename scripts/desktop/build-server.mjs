// Stages a self-contained Next.js server + a Node runtime for the Tauri bundle.
//
//   node scripts/desktop/build-server.mjs          # full production build + stage
//   node scripts/desktop/build-server.mjs --dev     # no-op (tauri dev uses `next dev`)
//
// Invoked automatically by `tauri build` via `beforeBuildCommand`.

import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  rmSync,
  chmodSync,
  copyFileSync,
  readFileSync,
  writeFileSync,
  readdirSync,
} from "node:fs";
import { join, dirname, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SRC_TAURI = join(ROOT, "src-tauri");
const STAGE = join(SRC_TAURI, "server");
const BIN_DIR = join(SRC_TAURI, "binaries");

if (process.argv.includes("--dev")) {
  console.log("[desktop] dev mode — run `next dev` yourself (pnpm desktop:dev does both)");
  process.exit(0);
}

function run(cmd, args, env = {}, cwd = ROOT) {
  execFileSync(cmd, args, {
    cwd,
    stdio: "inherit",
    env: { ...process.env, ...env },
    shell: process.platform === "win32",
  });
}

/** Rust target triple used to name the sidecar binary (Tauri convention). */
function targetTriple() {
  try {
    const out = execFileSync("rustc", ["-Vv"], { encoding: "utf8" });
    const m = out.match(/host:\s*(\S+)/);
    if (m) return m[1];
  } catch {
    /* rustc not on PATH — fall back to a platform guess */
  }
  const map = {
    "darwin-arm64": "aarch64-apple-darwin",
    "darwin-x64": "x86_64-apple-darwin",
    "linux-x64": "x86_64-unknown-linux-gnu",
    "linux-arm64": "aarch64-unknown-linux-gnu",
    "win32-x64": "x86_64-pc-windows-msvc",
  };
  const key = `${process.platform}-${process.arch}`;
  if (!map[key]) throw new Error(`unsupported platform for desktop build: ${key}`);
  return map[key];
}

// Clear last run's staging *before* the build — otherwise the file tracer sweeps
// the previous ~900 MB server tree into .next/standalone/src-tauri and each build
// compounds. (next.config.ts also excludes src-tauri from tracing.)
rmSync(STAGE, { recursive: true, force: true });
rmSync(BIN_DIR, { recursive: true, force: true });
rmSync(join(ROOT, ".next", "standalone"), { recursive: true, force: true });

console.log("[desktop] next build (standalone)…");
run("node", [join(ROOT, "node_modules", "next", "dist", "bin", "next"), "build"], {
  DESKTOP_BUILD: "1",
});

const STANDALONE = join(ROOT, ".next", "standalone");
if (!existsSync(join(STANDALONE, "server.js"))) {
  throw new Error(".next/standalone/server.js missing — is `output: \"standalone\"` active?");
}

console.log("[desktop] staging server →", STAGE);
cpSync(STANDALONE, STAGE, { recursive: true });
rmSync(join(STAGE, "src-tauri"), { recursive: true, force: true }); // never nest ourselves
cpSync(join(ROOT, ".next", "static"), join(STAGE, ".next", "static"), { recursive: true });
if (existsSync(join(ROOT, "public"))) {
  cpSync(join(ROOT, "public"), join(STAGE, "public"), {
    recursive: true,
    filter: (src) => !src.includes(`${sep}public${sep}generated`), // runtime data, not an asset
  });
}

// The Next.js file tracer (nft) is unreliable with pnpm's symlinked store — it
// leaves many packages as a bare package.json. Rather than chase truncations,
// throw away the traced node_modules and do a clean production install from the
// app's own manifest, giving a flat, symlink-free, self-contained tree.
// nft is unreliable with pnpm (leaves packages truncated), so install the prod
// tree cleanly with npm instead. The repo is pnpm-managed with a stale
// package-lock.json, and `next build` output is tied to the EXACT `next` version
// that produced it — so pin every prod dep to the version actually installed in
// the repo before installing, rather than letting npm re-resolve `^` ranges.
console.log("[desktop] clean production install into stage…");
rmSync(join(STAGE, "node_modules"), { recursive: true, force: true });

const rootPkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const pinned = {};
for (const name of Object.keys(rootPkg.dependencies ?? {})) {
  try {
    const v = JSON.parse(
      readFileSync(join(ROOT, "node_modules", ...name.split("/"), "package.json"), "utf8"),
    ).version;
    pinned[name] = v;
  } catch {
    pinned[name] = rootPkg.dependencies[name]; // fall back to the range
  }
}
writeFileSync(
  join(STAGE, "package.json"),
  JSON.stringify({ ...rootPkg, dependencies: pinned, devDependencies: {} }, null, 2),
);
run("npm", ["install", "--omit=dev", "--no-audit", "--no-fund", "--no-package-lock"], {}, STAGE);

// Sanity check: the standalone server's own entry deps must be intact.
for (const probe of ["next/package.json", "@next/env/package.json", "react/package.json"]) {
  if (!existsSync(join(STAGE, "node_modules", ...probe.split("/")))) {
    throw new Error(`staged install is missing ${probe}`);
  }
}

// Prune what a prebuilt standalone server never loads at runtime:
//  - @next/swc-* : the SWC compiler, build-time only (~95 MB)
//  - sharp/@img native packages for other platforms (~15 MB)
const platformTriple = `${process.platform}-${process.arch}`; // e.g. darwin-arm64
const nmScoped = (scope) => join(STAGE, "node_modules", scope);
for (const [dir, keepIf] of [
  [nmScoped("@next"), (n) => !n.startsWith("swc-")],
  [nmScoped("@img"), (n) => n.includes(platformTriple) || !/-(darwin|linux|linuxmusl|win32|wasm32)/.test(n)],
]) {
  if (!existsSync(dir)) continue;
  for (const name of readdirSync(dir)) {
    if (!keepIf(name)) rmSync(join(dir, name), { recursive: true, force: true });
  }
}

const triple = targetTriple();
const ext = process.platform === "win32" ? ".exe" : "";
const dest = join(BIN_DIR, `node-${triple}${ext}`);
mkdirSync(BIN_DIR, { recursive: true });
console.log(`[desktop] bundling node runtime → ${dest}`);
copyFileSync(process.execPath, dest);
if (process.platform !== "win32") chmodSync(dest, 0o755);

console.log("[desktop] done.");
