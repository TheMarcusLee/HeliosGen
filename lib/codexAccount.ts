import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import type { AccountCapabilities } from "./campaigns/providers";

/** Never pass API-key environment overrides to an account-backed invocation. */
export function codexAccountEnv(options: { imageGeneration?: boolean } = {}): NodeJS.ProcessEnv {
  return { NODE_ENV: process.env.NODE_ENV, ...Object.fromEntries(["PATH", "HOME", "CODEX_HOME", "TMPDIR", "SystemRoot", "USER", "LANG", ...(options.imageGeneration ? ["CODEX_IMAGEGEN_MODEL"] : [])].flatMap(key => process.env[key] ? [[key, process.env[key]!]] : [])) };
}

async function probe(command: string, args: string[]) {
  return new Promise<{ installed: boolean; ok: boolean; output: string }>(resolve => {
    let output = "";
    const proc = spawn(command, args, { env: codexAccountEnv(), stdio: ["ignore", "pipe", "pipe"] });
    const timer = setTimeout(() => { proc.kill("SIGKILL"); resolve({ installed: true, ok: false, output: "" }); }, 5000);
    proc.stdout.on("data", data => { output = (output + data).slice(-2000); });
    proc.stderr.on("data", data => { output = (output + data).slice(-2000); });
    proc.on("error", () => { clearTimeout(timer); resolve({ installed: false, ok: false, output: "" }); });
    proc.on("close", code => { clearTimeout(timer); resolve({ installed: true, ok: code === 0, output }); });
  });
}
export async function getCodexAccountStatus(): Promise<AccountCapabilities> {
  const [login, images] = await Promise.all([probe("codex", ["login", "status"]), probe("codex-imagegen", ["--help"])]);
  const chatReady = login.ok && /logged in using chatgpt/i.test(login.output);
  // This image adapter uses file-backed credentials; CLI chat also supports the OS keychain.
  const imageReady = chatReady && images.ok && existsSync(join(process.env.CODEX_HOME ?? join(homedir(), ".codex"), "auth.json"));
  return { chatReady, imageReady, installed: images.ok, authFound: chatReady, ready: imageReady };
}
