import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AccountCapabilities } from "./campaigns/providers";

/**
 * Antigravity (Gemini) as a second account-backed agent.
 *
 * The Antigravity CLI (`agy`) is Google's supported headless Gemini surface for
 * AI Pro / Ultra subscribers. Its auth is a Google login cached by the CLI in the
 * OS keyring; this app never reads or forwards that credential. It only spawns
 * the CLI, and the child environment deliberately omits every API-key variable
 * so a run can never drift onto metered Gemini API billing.
 *
 * Verified 2026-09-11 against agy 1.2.1: print mode returns JSON, `view_file`
 * gives real vision input, `search_web` is native, and `generate_image` (Prompt,
 * AspectRatio, ImageName, ImagePaths) writes a JPEG under the CLI's brain folder
 * for that conversation. There is no video generation tool.
 */
export const ANTIGRAVITY_DEFAULT_MODEL = "gemini-3.1-pro-high";
export const ANTIGRAVITY_INSTALL_CMD = "curl -fsSL https://antigravity.google/cli/install.sh | bash";
const CLI_DIRS = [join(homedir(), ".local", "bin"), "/opt/homebrew/bin", "/usr/local/bin"];
export const ANTIGRAVITY_BRAIN_DIR = join(homedir(), ".gemini", "antigravity-cli", "brain");

/** Allowlisted environment only. GEMINI_API_KEY, GOOGLE_API_KEY and Vertex switches never reach the CLI. */
export function antigravityEnv(): NodeJS.ProcessEnv {
  const keep = ["HOME", "TMPDIR", "USER", "LANG", "SystemRoot", "XDG_CONFIG_HOME"];
  const env: NodeJS.ProcessEnv = { NODE_ENV: process.env.NODE_ENV, ...Object.fromEntries(keep.flatMap(key => process.env[key] ? [[key, process.env[key]!]] : [])) };
  env.PATH = [...CLI_DIRS, process.env.PATH ?? ""].join(":");
  return env;
}
export function antigravityModel() { return process.env.HELIOS_ANTIGRAVITY_MODEL || ANTIGRAVITY_DEFAULT_MODEL; }
export function agyBinary(): string | undefined {
  const override = process.env.HELIOS_ANTIGRAVITY_BIN;
  if (override) return existsSync(override) ? override : undefined;
  return CLI_DIRS.map(dir => join(dir, "agy")).find(p => existsSync(p));
}
export interface AgyResult { stdout: string; stderr: string; code: number | null }
export type AgySpawner = (bin: string, args: string[], options: { cwd?: string; timeoutMs: number }) => Promise<AgyResult>;
export const spawnAgy: AgySpawner = (bin, args, options) => new Promise(resolve => {
  const proc = spawn(bin, args, { cwd: options.cwd, env: antigravityEnv(), stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "", stderr = "";
  const timer = setTimeout(() => { proc.kill("SIGKILL"); resolve({ stdout, stderr: `${stderr}\nTimed out.`, code: null }); }, options.timeoutMs);
  proc.stdout.on("data", d => { stdout = (stdout + d).slice(-2_000_000); });
  proc.stderr.on("data", d => { stderr = (stderr + d).slice(-20_000); });
  proc.on("error", error => { clearTimeout(timer); resolve({ stdout, stderr: `${stderr}\n${error.message}`, code: -1 }); });
  proc.on("close", code => { clearTimeout(timer); resolve({ stdout, stderr, code }); });
});

export interface AntigravityStatus extends AccountCapabilities { models: string[]; note?: string }
const cache = globalThis as typeof globalThis & { antigravityStatus?: { at: number; value: AntigravityStatus } };
/** `agy models` succeeds only with a valid login. Cached briefly: it hits the network. */
export async function getAntigravityStatus(force = false, spawner: AgySpawner = spawnAgy): Promise<AntigravityStatus> {
  if (!force && cache.antigravityStatus && Date.now() - cache.antigravityStatus.at < 5 * 60_000) return cache.antigravityStatus.value;
  const bin = agyBinary();
  let value: AntigravityStatus;
  if (!bin) value = { installed: false, authFound: false, chatReady: false, imageReady: false, ready: false, models: [], note: `Antigravity CLI not installed. Install with: ${ANTIGRAVITY_INSTALL_CMD}` };
  else {
    const r = await spawner(bin, ["models"], { timeoutMs: 90_000 });
    const models = r.stdout.split("\n").map(l => l.trim().split(/\s+/)[0]).filter(m => /^[a-z0-9.-]+$/.test(m) && m.includes("-"));
    const ok = r.code === 0 && models.length > 0;
    const note = ok ? undefined : (`${r.stdout}\n${r.stderr}`.split("\n").filter(Boolean).slice(-3).join(" ").slice(0, 300) || "Sign in once by running `agy` in a terminal with your Google account.");
    // Image generation is a native tool on the same login, so it is ready whenever chat is.
    value = { installed: true, authFound: ok, chatReady: ok, imageReady: ok, ready: ok, models, note };
  }
  cache.antigravityStatus = { at: Date.now(), value };
  return value;
}

export interface AgyRunOptions { prompt: string; workspace: string; model?: string; timeoutMs?: number; spawner?: AgySpawner }
export interface AgyRun { response: string; conversationId?: string; denied: string[]; status: string }
/**
 * One print-mode turn in a sandboxed workspace. Permission-gated tools (shell
 * commands, file writes) are auto-denied in headless mode and never approved
 * blanket-wise; prompts must tell the model not to use them.
 */
export async function runAgy(options: AgyRunOptions): Promise<AgyRun> {
  const bin = agyBinary();
  if (!bin) throw new Error(`Antigravity CLI not installed. Install with: ${ANTIGRAVITY_INSTALL_CMD}`);
  const args = agyArgs(options.prompt, options.workspace, options.model ?? antigravityModel(), options.timeoutMs ?? 240_000);
  const r = await (options.spawner ?? spawnAgy)(bin, args, { cwd: options.workspace, timeoutMs: (options.timeoutMs ?? 240_000) + 15_000 });
  if (/not signed in|unauthenticated|authentication/i.test(r.stderr)) throw new Error("Google account not signed in. Run `agy` once in a terminal and sign in.");
  const json = parseAgyJson(r.stdout);
  if (!json) throw new Error(r.code === null ? "Antigravity timed out." : `Antigravity returned no result${r.stderr ? `: ${r.stderr.trim().split("\n").at(-1)}` : ""}.`);
  const denied = (json.denied_actions ?? []).map(d => d.display_name || d.action || "tool");
  if (/quota|rate limit|capacity/i.test(json.error ?? "")) throw new Error("Google AI subscription usage limit reached. Retry later or choose another provider.");
  if (json.status && json.status !== "SUCCESS") throw new Error(`Antigravity run ended with status ${json.status}${json.error ? `: ${json.error}` : ""}.`);
  return { response: json.response ?? "", conversationId: json.conversation_id, denied, status: json.status ?? "SUCCESS" };
}
export function agyArgs(prompt: string, workspace: string, model: string, timeoutMs: number) {
  return ["-p", prompt, "--output-format", "json", "--model", model, "--add-dir", workspace, "--sandbox", "--disable-slash-commands", "--print-timeout", `${Math.max(1, Math.ceil(timeoutMs / 60_000))}m`];
}
interface AgyJson { conversation_id?: string; status?: string; response?: string; error?: string; denied_actions?: Array<{ action?: string; display_name?: string }> }
export function parseAgyJson(stdout: string): AgyJson | undefined {
  // The CLI prints housekeeping lines before the single JSON result object.
  const lines = stdout.trim().split("\n").reverse();
  for (const line of lines) {
    const t = line.trim();
    if (!t.startsWith("{")) continue;
    try { return JSON.parse(t) as AgyJson; } catch { /* keep looking */ }
  }
  const start = stdout.indexOf('{"conversation_id"');
  if (start >= 0) { try { return JSON.parse(stdout.slice(start)) as AgyJson; } catch { /* fall through */ } }
  return undefined;
}
/** The image files a conversation's native generate_image tool wrote, newest first. */
export async function conversationImages(conversationId: string): Promise<string[]> {
  const dir = join(ANTIGRAVITY_BRAIN_DIR, conversationId);
  if (!existsSync(dir)) return [];
  const names = (await readdir(dir)).filter(n => /\.(jpe?g|png|webp)$/i.test(n));
  const files = await Promise.all(names.map(async n => ({ path: join(dir, n), mtime: (await stat(join(dir, n))).mtimeMs })));
  return files.sort((a, b) => b.mtime - a.mtime).map(f => f.path);
}
export interface AntigravityImageRequest { prompt: string; aspectRatio?: string; references: Array<{ buffer: Buffer; ext: string }>; workspace: string; spawner?: AgySpawner }
/** Native image generation through the subscription login. Returns the image bytes and their content type. */
export async function generateImageWithAntigravity(input: AntigravityImageRequest): Promise<{ buffer: Buffer; contentType: string }> {
  await mkdir(input.workspace, { recursive: true });
  const paths: string[] = [];
  for (const [i, ref] of input.references.slice(0, 8).entries()) {
    const p = join(input.workspace, `reference-${i + 1}.${ref.ext}`);
    await (await import("node:fs/promises")).writeFile(p, ref.buffer); paths.push(p);
  }
  const ratio = input.aspectRatio && input.aspectRatio !== "auto" ? input.aspectRatio : "1:1";
  const prompt = [
    "Do NOT run commands, do NOT write files yourself, and do NOT ask questions.",
    `Call the generate_image tool exactly once with AspectRatio "${ratio}" and ImageName "ugcgen" to create this image:`,
    input.prompt,
    paths.length ? `Pass these reference image files in ImagePaths, in this order, and preserve the identity, styling and framing they establish: ${paths.join(", ")}` : "",
    'After the tool returns, reply with ONLY the JSON {"outputPath":"<the exact path the tool reported>"}.',
  ].filter(Boolean).join("\n\n");
  const run = await runAgy({ prompt, workspace: input.workspace, spawner: input.spawner, timeoutMs: 300_000, model: process.env.HELIOS_ANTIGRAVITY_IMAGE_MODEL || antigravityModel() });
  const candidates = [...(run.response.match(/\/[^\s"']+\.(?:jpe?g|png|webp)/gi) ?? []), ...(run.conversationId ? await conversationImages(run.conversationId) : [])];
  const path = candidates.find(p => p.startsWith(ANTIGRAVITY_BRAIN_DIR) && existsSync(p));
  if (!path) throw new Error(run.denied.length ? `Antigravity image generation was denied a tool (${run.denied.join(", ")}). Retry; the model must call generate_image only.` : "Antigravity did not produce an image file.");
  const buffer = await readFile(path);
  const contentType = /\.png$/i.test(path) ? "image/png" : /\.webp$/i.test(path) ? "image/webp" : "image/jpeg";
  return { buffer, contentType };
}
