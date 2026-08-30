# HeliosGen Desktop (Tauri)

A fully local, self-contained desktop build. No Supabase, no R2, no ngrok — it
runs the Next.js app in guest mode as a bundled sidecar and stores everything in
a per-user app-data directory.

## Architecture

```
┌─ HeliosGen.app ────────────────────────────────┐
│  Tauri shell (Rust)                            │
│    ├─ picks a free localhost port              │
│    ├─ spawns  node  server/server.js  (sidecar)│
│    │     GUEST_MODE=true                       │
│    │     HELIOS_DATA_DIR  = <appData>          │
│    │     HELIOS_MEDIA_DIR = <appData>/generated│
│    └─ navigates the webview to 127.0.0.1:<port>│
└────────────────────────────────────────────────┘
```

- `next.config.ts` emits `output: "standalone"` when `DESKTOP_BUILD=1`.
- `scripts/desktop/build-server.mjs` builds it, then **discards the traced
  `node_modules`** (nft is unreliable with pnpm and leaves packages truncated)
  and runs a clean `npm install --omit=dev` into `src-tauri/server/` for a flat,
  symlink-free tree. It also copies `.next/static` + `public` in, and copies the
  current `node` binary to `src-tauri/binaries/node-<target-triple>` as the
  Tauri sidecar.
- `lib/guest/paths.ts` resolves `DATA_DIR` / `MEDIA_DIR` from the env vars the
  shell sets; `app/generated/[...path]/route.ts` serves media from outside
  `public/` in the packaged app.

## Prerequisites (one-time)

| Tool | Notes |
| --- | --- |
| **Rust** | `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \| sh` (installed: rustc 1.98). |
| **Node 22+** | Repo's `pnpm@9.15.9` needs Node ≥ 22.13. `nvm use 22 && corepack enable`. |
| **Tauri system deps** | macOS: Xcode CLT. Linux: webkit2gtk + build-essential. See <https://v2.tauri.app/start/prerequisites/>. |

App icons are already generated in `src-tauri/icons/` from `src-tauri/icon-source.png`
(a 1024² render of `public/HG.svg`). To regenerate after a logo change:
`npx @tauri-apps/cli@^2 icon src-tauri/icon-source.png`.

Install JS deps (adds `@tauri-apps/cli`): `pnpm install` (or `npm install`).

## Run it

**Development** (hot reload, two processes):

```bash
pnpm desktop:dev
```

Runs `next dev` on :3000 and `tauri dev` together; the shell reads
`HELIOS_DEV_URL` and points its window there (no sidecar in dev). First run
compiles the Rust shell (~1–2 min).

**Packaged build:**

```bash
pnpm desktop:build            # → src-tauri/target/release/bundle/
open "src-tauri/target/release/bundle/macos/HeliosGen.app"
```

- macOS: produces `HeliosGen.app` and (with `CI=true`, which the script sets)
  `HeliosGen_<ver>_aarch64.dmg`. The `.app` is ~440 MB (bundled Node runtime +
  prod `node_modules`).
- The app is **unsigned** — on first launch macOS Gatekeeper blocks it.
  Right-click → Open, or `xattr -cr "src-tauri/target/release/bundle/macos/HeliosGen.app"`.
- Data lives in `~/Library/Application Support/cash.sdd.helios.desktop/`
  (`guest-db.json` + `generated/`). Delete that folder to reset.

To just run the compiled binary without bundling:
`./src-tauri/target/release/heliosgen-desktop`

## Status / remaining work

- [x] Phase 0 — branch + Tauri scaffold
- [x] Phase 1 — standalone output + Node sidecar + writable data dir + icons.
      `HeliosGen.app` + `.dmg` build and launch; all routes serve, guest DB
      writes to `~/Library/Application Support/cash.sdd.helios.desktop/`.
- [x] Phase 2 — kie.ai webhook replaced with polling (`lib/kieJobPoller.ts`).
      In guest mode `/api/generate` + `/api/generate-video` start a background
      poller against `/api/v1/jobs/recordInfo`; `/api/job-status` +
      `/api/job-stream` restart it after a server restart. `CALLBACK_BASE_URL`
      is no longer required in guest mode. Verified end-to-end (z-image, no
      tunnel). **Gap:** Google Veo models (`/api/v1/veo/*`, different shape)
      still need a callback — poller is skipped for them.
- [ ] Phase 3 — send reference images to kie.ai without a tunnel (data URI /
      kie upload endpoint). Text-to-image/video works now; image *inputs* don't.
- [ ] Phase 4 — code signing, notarization, auto-update
- [ ] Bundle size — down to ~330 MB stage / ~440 MB `.app` after moving `shadcn`
      to devDeps and pruning `@next/swc` + off-platform sharp binaries. The
      remaining bulk is the bundled Node runtime (~108 MB) and the prod
      `node_modules` (~310 MB, mostly `@aws-sdk`, `@supabase`, `@base-ui`).
      Further trimming needs code changes (lazy-load `@aws-sdk` in `lib/r2.ts`).

Text-to-image and text-to-video generation work fully offline now. Generation
*from* an uploaded/reference image still needs Phase 3 (or a tunnel), and Veo
still needs a callback URL.
