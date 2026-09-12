import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { DATA_DIR } from "./guest/paths";

/**
 * Task ids minted by local providers (no kie.ai job behind them). Polling kie.ai
 * for one of these returns "recordInfo is null" and would clobber the real result.
 */
export const LOCAL_TASK_PREFIXES = ["azure-", "codex-", "antigravity-"] as const;
export const isLocalTaskId = (taskId: string) => LOCAL_TASK_PREFIXES.some(prefix => taskId.startsWith(prefix));

export type JobResult =
  | { status: "pending"; type?: "image" | "video"; userId?: string }
  | { status: "done"; imageUrl?: string; imageUrls?: string[]; videoUrl?: string }
  | { status: "error"; error: string };

// DATA_DIR is the repo in dev and a writable per-user dir in the packaged
// desktop app (the install dir is read-only there).
const FILE = join(DATA_DIR, ".job-store.json");

function read(): Record<string, JobResult> {
  if (!existsSync(FILE)) return {};
  try { return JSON.parse(readFileSync(FILE, "utf8")); }
  catch { return {}; }
}

function write(data: Record<string, JobResult>): void {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(FILE, JSON.stringify(data), "utf8");
}

export const jobStore = {
  get(taskId: string): JobResult | undefined {
    return read()[taskId];
  },
  set(taskId: string, result: JobResult): void {
    const data = read();
    data[taskId] = result;
    write(data);
  },
};
