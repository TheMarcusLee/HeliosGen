/**
 * Desktop update check. Asks the GitHub Releases API whether a newer tag than
 * the running build exists and hands the frontend (`components/UpdateBanner.tsx`)
 * everything it needs to show the "Update available" bar + changelog modal.
 *
 * Guest/desktop only. No self-install — the banner just links to the release
 * page. The running version is `NEXT_PUBLIC_APP_VERSION`, baked from
 * `src-tauri/tauri.conf.json` by `scripts/desktop/build-server.mjs` / `dev.mjs`.
 */
import { NextResponse } from "next/server";
import { GUEST_MODE } from "@/lib/guestMode";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REPO = "SegFault42/WorkflowAI";
const RELEASES_API = `https://api.github.com/repos/${REPO}/releases/latest`;
const RELEASES_PAGE = `https://github.com/${REPO}/releases/latest`;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1h — GitHub unauthenticated limit is 60/h
const CURRENT_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || "0.0.0";
const FORCE = process.env.NEXT_PUBLIC_UPDATE_CHECK_FORCE === "1";

type UpdatePayload = {
  updateAvailable: boolean;
  currentVersion: string;
  latestVersion?: string;
  name?: string;
  notes?: string;
  url?: string;
  publishedAt?: string;
};

let cache: { at: number; data: UpdatePayload } | null = null;

/** "v1.2.3", "1.2.3-beta.1", "app-v1.2" → [1, 2, 3]. Unparseable slots → 0. */
function parseVersion(raw: string): [number, number, number] {
  const m = raw.match(/(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  return m ? [Number(m[1] || 0), Number(m[2] || 0), Number(m[3] || 0)] : [0, 0, 0];
}

function isNewer(candidate: string, base: string): boolean {
  const a = parseVersion(candidate);
  const b = parseVersion(base);
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
}

async function check(): Promise<UpdatePayload> {
  const notCurrent: UpdatePayload = {
    updateAvailable: false,
    currentVersion: CURRENT_VERSION,
  };

  let release: {
    tag_name?: string;
    name?: string;
    body?: string;
    html_url?: string;
    published_at?: string;
    draft?: boolean;
    prerelease?: boolean;
  };
  try {
    const res = await fetch(RELEASES_API, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": `HeliosGen-Desktop/${CURRENT_VERSION}`,
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      // 404 = repo has no releases yet — that's "up to date", not an error.
      if (FORCE) {
        return {
          updateAvailable: true,
          currentVersion: CURRENT_VERSION,
          latestVersion: "v0.0.0-preview",
          name: "Preview (forced)",
          notes:
            "This is a preview of the update banner and changelog modal.\n\n" +
            "- Shown because NEXT_PUBLIC_UPDATE_CHECK_FORCE=1.\n" +
            "- The real check compares the GitHub latest release against the\n" +
            "  bundled version and stays hidden when you're current.",
          url: RELEASES_PAGE,
        };
      }
      return notCurrent;
    }
    release = await res.json();
  } catch {
    return notCurrent;
  }

  const tag = release.tag_name?.trim();
  if (!tag || release.draft) return notCurrent;
  if (!FORCE && release.prerelease) return notCurrent;
  if (!FORCE && !isNewer(tag, CURRENT_VERSION)) return notCurrent;

  return {
    updateAvailable: true,
    currentVersion: CURRENT_VERSION,
    latestVersion: tag,
    name: release.name?.trim() || tag,
    notes: release.body?.trim() || "",
    url: release.html_url || RELEASES_PAGE,
    publishedAt: release.published_at,
  };
}

export async function GET() {
  if (!GUEST_MODE) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  if (cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return NextResponse.json(cache.data);
  }

  const data = await check();
  cache = { at: Date.now(), data };
  return NextResponse.json(data);
}
