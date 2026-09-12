# InstaVault for UGC{Gen}

InstaVault is an **unofficial**, clean-room Chrome extension bundled with UGC{Gen} for saving Instagram media that you own or are authorized to use, and for sending Reels straight into UGC{Gen} as source clips for Research & adapt. It uses only browser APIs, the Instagram pages visible in your normal signed-in session, and media URLs already rendered into those pages.

It is not affiliated with Instagram or Meta. This project does not contain or derive from the source code, branding, private endpoints, or implementation of any other extension.

## Capabilities

- Detects visible images and videos in posts, reels, stories, highlights, profiles, Explore, tagged, and saved-page layouts.
- Resolves blob-backed Reels from signed HTTPS `video_versions` already embedded in Instagram's local page-state JSON; no private endpoint is called.
- Parses page-state incrementally with strict script-count, text-size, aggregate-byte, and traversal budgets so mutation-heavy pages remain responsive.
- Adds a low-profile per-media **Save** button that becomes prominent on hover or keyboard focus.
- Collects discovered media into a side-panel library with type, username, and inclusive date-range filters.
- Supports manual selection, select-all for the filtered view, and clear-selection actions.
- Scans long profile/page feeds by scrolling, collecting newly loaded media, reporting progress, and supporting stop/cancel.
- Plans numbered downloads using configurable filename tokens, starting number, and padding.
- Runs downloads sequentially with a configurable delay and persisted MV3 queue state.
- Supports pause, resume, retry-failed, and cancel-pending queue controls.
- Handles stale Instagram CDN URLs as recoverable failures and recommends reloading/recollecting.
- Sends selected Reels and images to your local UGC{Gen} server as source clips, where the Research & adapt agent can inspect and adapt them without any public retrieval.

## Install locally

1. In UGC{Gen}, open Campaign controls → Discover → **Instagram Reels · browser extension** (or the Captured clips section in Research & adapt) and choose **Get the browser extension**. The app copies this folder to its data directory and reveals it. From a source checkout you can also use `extensions/instavault` directly.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Choose **Load unpacked** and select the revealed folder.
5. Open `https://www.instagram.com/` and sign in normally.

Chrome 116 or newer is required. This baseline provides the Side Panel API and the Promise-based extension APIs used by the resilient queue coordinator.

## Use

1. Navigate to media you are allowed to save. InstaVault automatically collects visible qualifying images/videos.
2. Use an on-page **Save** button for one item, or click the extension icon and choose **Open media library**.
3. For feeds or profiles, choose **Scan page**. The scanner scrolls in bounded rounds and stops after repeated rounds find nothing new; choose **Stop scan** at any time.
4. Filter and select items, configure the filename template and sequence, then choose **Download selected**.
5. Monitor or control the persistent queue at the bottom of the side panel.

Filename tokens are `{username}`, `{type}`, `{date}`, `{id}`, and `{sequence}`. Files are placed under an `InstaVault` folder in Chrome's configured downloads directory.

The sequence cursor is persisted and continues across batches and service-worker restarts. Raising the configured sequence start can jump the cursor forward; lowering it does not reuse prior sequence numbers.

### Send to UGC{Gen}

1. Keep UGC{Gen} running. The extension talks to `http://localhost:3000` by default; change the address in Settings if your server runs elsewhere (https is required off localhost).
2. Collect media normally, select one or more Reels or images, and choose **Send selected to UGC{Gen}**.
3. In UGC{Gen}, open Research & adapt → Sources & output settings → **Captured clips** and attach a clip as a source.

No key is needed. The UGC{Gen} capture endpoint answers cross-origin requests only from a browser extension origin, so an ordinary web page cannot push media into your library. Bytes are read from the media URLs already rendered in the page you are viewing and stored under UGC{Gen}'s local media directory.

## Privacy and security

- No analytics, telemetry, advertising, or remote code. The only outbound destination besides Instagram is the UGC{Gen} address you configure.
- No credentials, private cookies, authentication storage, or Instagram session data are inspected.
- Page access is limited to Instagram, Instagram media delivery hosts, and your UGC{Gen} address.
- Settings, collected media metadata, and queue state remain in `chrome.storage.local` on the device unless you explicitly send selected media to UGC{Gen}.
- Downloads go through `chrome.downloads` directly from media URLs already exposed in the rendered page.
- Runtime message types are allowlisted, Instagram content-script messages are origin-checked, filenames are sanitized, and no `eval`-style execution is used.

## Responsible use

Download only media you created, own, or have explicit permission to save. You are responsible for copyright, privacy, applicable law, and Instagram's Terms of Use. InstaVault is not intended to bypass access controls, reveal unavailable content, scrape private APIs, or redistribute other people's work.

## Limitations

- Instagram is a frequently changing single-page application. DOM changes can require detector updates.
- Only media loaded and exposed in the currently viewed page can be collected. The extension does not use private Instagram endpoints.
- A blob-backed Reel is available only when its rendered page also embeds a valid HTTPS `video_versions` record for the matching shortcode. Reel covers are intentionally never offered as JPEG substitutes.
- Some responsive image URLs may expire. Reload the source page, collect again, and retry with the refreshed item.
- Dates are available only when Instagram renders a machine-readable timestamp near the media. Date filters intentionally exclude undated items when a range is active.
- Story/highlight controls can be replaced as Instagram advances frames; the mutation observer re-detects current media.
- The extension does not decrypt protected streams, merge segmented video/audio, or bypass view/download restrictions.

## Development and verification

There is no build step, package installation, or runtime dependency. Node.js 18 or newer is required only to run the repository checks after a fresh checkout.

```sh
npm test
npm run check
```

Tests use Node's built-in test runner and cover filename sanitization/templating, inclusive date filtering, stable media identity, deduplication, queue planning, concurrent queue and two-tab library mutations, pause/cancel races, timestamp/extension-scoped service-worker recovery, cancellation retry, legacy-ID migration, retry URL refresh, history pruning, and sequence continuity. `npm run check` parses the JSON metadata and performs `node --check` on every JavaScript file.

## Project structure

- `manifest.json` — MV3 permissions, Instagram-only content injection, side panel, popup, and options page.
- `background.js` — storage-backed media library and sequential download queue.
- `shared/queue-manager.js` — serialized queue state machine, suspension recovery, and bounded terminal history.
- `content.js` / `content.css` — DOM detector, mutation observer, scan loop, and per-item controls.
- `panel.*` — media library, filters, selection, scan and queue controls.
- `popup.*` — quick actions and status.
- `options.*` — persisted settings, privacy details, responsible-use guidance, and help.
- `shared/utils.js` — pure filename, date, dedupe, ID, and queue-planning utilities.
- `shared/instagram-metadata.js` — safe recursive page-state parsing, Reel shortcode matching, MP4 quality selection, and cover suppression.
- `shared/ugcgen-client.js` — sends selected media to the local UGC{Gen} capture endpoint.
- `tests/` and `scripts/validate.js` — dependency-free checks.

The queue retains at most the 500 most recent terminal entries (`complete`, `failed`, or `cancelled`) while preserving every active/pending item. Use **Clear history** in the side panel to remove terminal entries immediately; this never deletes downloaded files or resets the monotonic sequence cursor.
