import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile, realpath } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { NextRequest } from "next/server";
import { codexAccountEnv, getCodexAccountStatus } from "../codexAccount";
import { MEDIA_DIR } from "../guest/paths";

export function plannerArgs(directory: string, imagePaths: string[], webSearch = false) {
  return ["exec", "--ignore-user-config", "--ephemeral", "--skip-git-repo-check", "--sandbox", "read-only", "--cd", directory,
    "-c", 'model_provider="openai"', "-c", 'forced_login_method="chatgpt"',
    "-c", "features.shell_tool=false", "-c", "features.unified_exec=false", "-c", webSearch ? 'web_search="live"' : 'web_search="disabled"',
    "--output-last-message", join(directory, "response.txt"), ...imagePaths.flatMap(path => ["--image", path]), "-"];
}

/** Uses the supported CLI auth flow, with no API tokens exposed to the browser. */
export async function codexPlanner(req: NextRequest, options: { webSearch?: boolean; maxImages?: number } = {}): Promise<Response> {
  if (!(await getCodexAccountStatus()).chatReady) throw new Error("OpenAI account disconnected. Reconnect Codex in Settings, or explicitly choose another chat provider.");
  const { messages, imageUrls = [] } = await req.json() as { messages: { role: string; content: string }[]; imageUrls?: string[] };
  const directory = await mkdtemp(join(tmpdir(), "ugc-producer-"));
  try {
    const imagePaths: string[] = [];
    for (const url of imageUrls.slice(0, Math.min(options.maxImages ?? 3, 8))) {
      // Uploaded references are local. Remote URLs remain textual context; they
      // are never fetched with account credentials or opened by an agent tool.
      if (!url.startsWith("/generated/")) continue;
      const path = await realpath(resolve(MEDIA_DIR, decodeURIComponent(url.slice("/generated/".length))));
      if (!path.startsWith((await realpath(MEDIA_DIR)) + sep)) throw new Error("Invalid reference path.");
      const data = await readFile(path);
      if (data.length > 15 * 1024 * 1024) throw new Error("Reference image exceeds 15 MB.");
      const copied = join(directory, `reference-${imagePaths.length}${/\.(png|jpe?g|webp)$/i.exec(path)?.[0] ?? ".png"}`);
      await writeFile(copied, data); imagePaths.push(copied);
    }
    await new Promise<void>((resolvePromise, reject) => {
      const proc = spawn("codex", plannerArgs(directory, imagePaths, options.webSearch), { env: codexAccountEnv(), stdio: ["pipe", "ignore", "pipe"] });
      let stderr = "";
      const timer = setTimeout(() => { proc.kill("SIGKILL"); reject(new Error("OpenAI planning timed out. Your brief is saved; try again.")); }, 240_000);
      proc.stderr.on("data", data => { stderr = (stderr + data).slice(-4000); });
      proc.stdin.on("error", () => {});
      proc.on("error", () => { clearTimeout(timer); reject(new Error("Codex CLI could not start. Check the OpenAI connection in Settings.")); });
      proc.on("close", code => {
        clearTimeout(timer);
        if (code !== 0) reject(new Error(/usage|rate.limit|quota/i.test(stderr) ? "OpenAI account usage limit reached. Retry later or explicitly choose another provider." : "OpenAI planning failed. Check your Codex account connection and try again."));
        else resolvePromise();
      });
      proc.stdin.end(`You are a creative production service. Return only the requested JSON. ${options.webSearch ? "Use web search to verify sources. Do not use shell or filesystem tools." : "Inspect the attached images when provided. Do not run tools or inspect other files."}\n\n${messages.map(m => `${m.role.toUpperCase()}:\n${m.content}`).join("\n\n")}`);
    });
    const content = await readFile(join(directory, "response.txt"), "utf8");
    if (!content.trim()) throw new Error("OpenAI returned no plan. Try again.");
    return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\ndata: [DONE]\n\n`, { headers: { "Content-Type": "text/event-stream" } });
  } finally { await rm(directory, { recursive: true, force: true }); }
}
