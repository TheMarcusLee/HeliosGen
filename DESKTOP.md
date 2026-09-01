# HeliosGen Desktop (Tauri)

A fully local, self-contained desktop build. No Supabase, no R2, no ngrok — it
runs the Next.js app in guest mode as a bundled sidecar and stores everything in
a per-user app-data directory.

## Architecture

```
┌─ HeliosGen.app ─────────────────────────────────────┐
│  Tauri shell (Rust)                                 │
│    ├─ picks a free localhost port                   │
│    ├─ spawns the `helios-node` sidecar shim, which  │
│    │    hides itself from the Dock, then exec's     │
│    │    node  server/server.js                      │
│    │      GUEST_MODE=true                           │
│    │      HELIOS_DATA_DIR  = <appData>              │
│    │      HELIOS_MEDIA_DIR = <appData>/generated    │
│    └─ navigates the webview to 127.0.0.1:<port>     │
└─────────────────────────────────────────────────────┘
```

- The Node runtime is a **resource** (`Contents/Resources/server/node-bin/node`),
  not the sidecar. A binary launched from a bundle's `Contents/MacOS/` gets its
  own macOS Dock tile ([tauri#14014]); the sidecar is a ~20-line Rust shim
  (`src-tauri/loader/`) that calls `TransformProcessType` to drop its Dock tile,
  then `exec`s the real node (path passed in `HELIOS_NODE_BIN`).

[tauri#14014]: https://github.com/tauri-apps/tauri/issues/14014

- `next.config.ts` emits `output: "standalone"` when `DESKTOP_BUILD=1`.
- `scripts/desktop/build-server.mjs` builds it, then **discards the traced
  `node_modules`** (nft is unreliable with pnpm and leaves packages truncated)
  and runs a clean `npm install --omit=dev` into `src-tauri/server/` for a flat,
  symlink-free tree. It also copies `.next/static` + `public` in, copies the
  current `node` binary to `src-tauri/server/node-bin/node` (bundled as a
  resource), and `cargo build`s the `src-tauri/loader` shim to
  `src-tauri/binaries/helios-node-<target-triple>` as the Tauri sidecar.
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
- Data lives in `~/Library/Application Support/cash.sdd.helios.desktop/`:
  `guest.db` (SQLite — generations, uploads, folders, workflows, settings) and
  `generated/` (media). Delete that folder to reset. Any `guest-db.json` /
  `guest-spaces.json` there is an import source, imported once into `guest.db`
  (mtime-guarded) and then dormant.

To just run the compiled binary without bundling:
`./src-tauri/target/release/heliosgen-desktop`

## Signed & notarized release build

Needs a **Developer ID Application** certificate (not "Apple Development") in the
login keychain + notarization credentials.

1. `cp scripts/desktop/sign.env.example scripts/desktop/sign.env` and fill it in
   (identity string from `security find-identity -v -p codesigning`; an App Store
   Connect API key or Apple-ID app-specific password).
2. ```bash
   set -a; source scripts/desktop/sign.env; set +a
   pnpm desktop:build
   ```

With `APPLE_SIGNING_IDENTITY` set, `build-server.mjs` codesigns the Mach-O in
the staged server — the bundled `node` runtime plus sharp's `.node`/`.dylib` —
with hardened runtime + entitlements; Tauri then signs the app shell + the
`helios-node` sidecar shim, notarizes, and staples. Entitlements are in
`src-tauri/entitlements.plist` (JIT + unsigned-exec-memory +
disable-library-validation — the bundled Node/V8 needs them).

Verify the result:
```bash
spctl -a -vvv "src-tauri/target/release/bundle/macos/HeliosGen.app"   # → accepted, source=Notarized Developer ID
xcrun stapler validate "src-tauri/target/release/bundle/dmg/HeliosGen_0.1.0_aarch64.dmg"
```

## Importing web-app data (Supabase + R2 → local)

```bash
nvm use 22
node scripts/desktop/import-from-cloud.mjs --email you@example.com   # --dry to preview
```

Pulls one user's `generations`, `user_uploads`, `folders`, `folder_items`,
`user_settings`, and `spaces` from Supabase and downloads every referenced R2
media file into the app data dir. Writes/merges `guest-db.json` +
`guest-spaces.json`; media downloads are resumable. Creds come from `.env.local`.
Media can be several GB. **Re-run then relaunch the app** — it re-imports the
changed JSON into `guest.db` idempotently (`INSERT OR IGNORE`, so app edits win).

Guest-mode store: `lib/guest/sqlite.ts` (SQLite via `node:sqlite`) backs
`lib/guest/db.ts` and `lib/guest/spaces.ts`. Workflow persistence via
`app/api/guest-spaces`
back `useSpaceSync` with `guest-spaces.json`. The loopback port is fixed
(`41730`) so the webview's `localStorage` also survives across launches.

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
- [x] Phase 3 — reference/uploaded images reach kie.ai without a tunnel.
      `lib/kieUpload.ts` pushes local `/generated` + `data:` media to kie's temp
      store (`kieai.redpandaai.co/api/file-base64-upload`, 3-day retention) and
      swaps in the returned URL. `/api/generate` does it for image inputs;
      `/api/generate-video` deep-walks the payload (its shape varies by model).
      Verified end-to-end (nano-banana-2-lite image-to-image, no tunnel).
      **Gap:** video *file* inputs >10 MB should use kie's stream-upload API
      instead of base64.
- [x] Local-only — no accounts. `NEXT_PUBLIC_GUEST_MODE` is baked at build,
      `setAuthModalOpen` is a no-op, `AuthModal`/`ResetPasswordModal` aren't
      mounted, `getAccessToken` returns "guest". Fixed loopback port (41730) so
      `localStorage` survives launches; sidecar is killed on app exit.
- [x] External CLIs — the shell resolves the login-shell `$PATH` for the sidecar
      so `ffmpeg`/`ffprobe` (video trim, frame extract) and `codex`/
      `codex-imagegen` (optional Codex provider) are found. They're not bundled;
      if absent the feature degrades cleanly (Codex badge shows NOT CONFIGURED,
      video-trim errors). Codex still needs a one-time `codex login` in Settings.
- [x] Cloud import — `scripts/desktop/import-from-cloud.mjs` (see section above).
- [~] Phase 4 — signing/notarization wired up (config + entitlements +
      native-module signing in `build-server.mjs`); needs a Developer ID cert to
      actually run.
- [x] Update check — `app/api/update-check/route.ts` asks the GitHub Releases
      API (`repos/SegFault42/WorkflowAI/releases/latest`, cached ~1 h) whether
      `tag_name` is newer than `NEXT_PUBLIC_APP_VERSION` (baked from
      `tauri.conf.json` by `build-server.mjs` / `dev.mjs`). When it is,
      `components/UpdateBanner.tsx` shows a yellow "Update available" bar under
      the Kie banner; tapping it opens a modal with the release notes and a
      **Download** button (opens the release page via the external-link handler).
      Guest/desktop only, no self-install. Cut a release by tagging `vX.Y.Z` on
      GitHub with `version` bumped in `tauri.conf.json` to match.
      `NEXT_PUBLIC_UPDATE_CHECK_FORCE=1` (dev) forces the banner on for eyeballing.
- [ ] Bundle size — down to ~330 MB stage / ~440 MB `.app` after moving `shadcn`
      to devDeps and pruning `@next/swc` + off-platform sharp binaries. The
      remaining bulk is the bundled Node runtime (~108 MB) and the prod
      `node_modules` (~310 MB, mostly `@aws-sdk`, `@supabase`, `@base-ui`).
      Further trimming needs code changes (lazy-load `@aws-sdk` in `lib/r2.ts`).

Image and video generation — including from uploaded/reference images — work
with no tunnel. Still needing work: Google Veo (needs a callback URL) and large
video-file inputs (base64 upload is capped ~10 MB).
