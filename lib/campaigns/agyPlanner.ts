import { mkdtemp, readFile, rm, writeFile, realpath } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { NextRequest } from "next/server";
import { antigravityModel, getAntigravityStatus, runAgy, type AgySpawner } from "../antigravityAccount";
import { MEDIA_DIR } from "../guest/paths";

/**
 * Antigravity counterpart of codexPlanner: same request shape, same
 * event-stream response, so the campaign planner and the director's
 * reasoning/inspection/review calls can switch providers without changes.
 */
export function agyPrompt(messages: { role: string; content: string }[], imagePaths: string[], webSearch: boolean) {
  return [
    "You are a creative production service. Return only the requested JSON, with no prose before or after it.",
    "Do NOT run commands, do NOT write or edit files, and do NOT ask questions. Do not generate images.",
    imagePaths.length ? `Open each of these files with your view_file tool and inspect it visually before answering:\n${imagePaths.map(p => `- ${p}`).join("\n")}` : "",
    webSearch ? "Use your search_web and read_url_content tools to find and verify real public sources. Never invent URLs." : "Do not use web search.",
    ...messages.map(m => `${m.role.toUpperCase()}:\n${m.content}`),
  ].filter(Boolean).join("\n\n");
}
export async function agyPlanner(req: NextRequest, options: { webSearch?: boolean; maxImages?: number; tier?: "reasoning" | "inspection"; spawner?: AgySpawner } = {}): Promise<Response> {
  if (!(await getAntigravityStatus()).chatReady) throw new Error("Google account disconnected. Sign in to the Antigravity CLI, or explicitly choose another chat provider.");
  const { messages, imageUrls = [] } = await req.json() as { messages: { role: string; content: string }[]; imageUrls?: string[] };
  const directory = await mkdtemp(join(tmpdir(), "ugc-antigravity-"));
  try {
    const imagePaths: string[] = [];
    for (const url of imageUrls.slice(0, Math.min(options.maxImages ?? 3, 8))) {
      // Uploaded references are local. Remote URLs remain textual context and are never fetched with account credentials.
      if (!url.startsWith("/generated/")) continue;
      const path = await realpath(resolve(MEDIA_DIR, decodeURIComponent(url.slice("/generated/".length))));
      if (!path.startsWith((await realpath(MEDIA_DIR)) + sep)) throw new Error("Invalid reference path.");
      const data = await readFile(path);
      if (data.length > 15 * 1024 * 1024) throw new Error("Reference image exceeds 15 MB.");
      const copied = join(directory, `reference-${imagePaths.length}${/\.(png|jpe?g|webp)$/i.exec(path)?.[0] ?? ".png"}`);
      await writeFile(copied, data); imagePaths.push(copied);
    }
    const run = await runAgy({ prompt: agyPrompt(messages, imagePaths, !!options.webSearch), workspace: directory, spawner: options.spawner, model: antigravityModel(options.tier ?? "reasoning") });
    const content = run.response.trim();
    if (!content) throw new Error(run.denied.length ? `Antigravity needed a tool that headless mode denies (${run.denied.join(", ")}). Try again.` : "Antigravity returned no plan. Try again.");
    return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\ndata: [DONE]\n\n`, { headers: { "Content-Type": "text/event-stream" } });
  } finally { await rm(directory, { recursive: true, force: true }); }
}
