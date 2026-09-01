import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { DATA_DIR } from "./guest/paths";

// File-based (not in-memory) so state survives Next.js dev's module reloads —
// same pattern as lib/jobStore.ts.
export type CodexLoginState =
  | { status: "idle" }
  | { status: "pending"; url: string; code: string; startedAt: number }
  | { status: "success" }
  | { status: "error"; error: string };

const FILE = join(DATA_DIR, ".codex-login-store.json");

function read(): CodexLoginState {
  if (!existsSync(FILE)) return { status: "idle" };
  try { return JSON.parse(readFileSync(FILE, "utf8")); }
  catch { return { status: "idle" }; }
}

function write(state: CodexLoginState): void {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(FILE, JSON.stringify(state), "utf8");
}

export const codexLoginStore = {
  get: read,
  set: write,
};
