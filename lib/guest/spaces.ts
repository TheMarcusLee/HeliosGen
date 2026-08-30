import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { DATA_DIR } from "./paths";

/**
 * Guest-mode persistence for workflow "spaces" (node canvases).
 *
 * The hosted app keeps these in the browser + a Supabase `spaces` table. The
 * desktop app has no login, and its webview localStorage is not a safe home
 * (cleared if the loopback port ever changes), so guest mode syncs them to a
 * JSON file in the app-data dir instead — same idea as guest-db.json.
 */
const FILE = join(DATA_DIR, "guest-spaces.json");

// Shape mirrors the `Space` interface in lib/store.ts (kept loose on purpose —
// this layer just stores whatever the client round-trips).
export interface GuestSpace {
  id: string;
  name: string;
  nodes: unknown[];
  edges: unknown[];
  nodeCounters: Record<string, number>;
  createdAt: number;
  updatedAt?: number;
  viewport?: { x: number; y: number; zoom: number };
  isPublic?: boolean;
}

export function getSpaces(): GuestSpace[] {
  if (!existsSync(FILE)) return [];
  try {
    const parsed = JSON.parse(readFileSync(FILE, "utf8"));
    return Array.isArray(parsed) ? parsed : (parsed.spaces ?? []);
  } catch {
    return [];
  }
}

export function saveSpaces(spaces: GuestSpace[]): void {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(FILE, JSON.stringify(spaces, null, 2), "utf8");
}
