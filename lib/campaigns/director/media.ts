import { storeMedia } from "./download";
// Runtime-only media I/O. These paths contain user data, never application dependencies.
const runtimeFiles = () => process.getBuiltinModule("fs/promises") as typeof import("node:fs/promises");
import { join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { MEDIA_DIR } from "../../guest/paths";
import type { MediaEvidence } from "./types";
import type { ClipLimits } from "./motionModels";
export function sourceUrl(input: string) {
  if (/^\/generated\/[\w./%-]+\.(mp4|mov|webm)$/i.test(input)) return input;
  const u = new URL(input);
  if (u.protocol !== "https:" || u.username || u.password || u.port) throw new Error("Use a public TikTok/Reel link or an uploaded video.");
  const tik = /^(www\.|m\.|vm\.|vt\.)?tiktok\.com$/.test(u.hostname) && (/^\/@[\w.-]+\/video\/\d+\/?$/.test(u.pathname) || (/^(vm|vt)\./.test(u.hostname) && /^\/[A-Za-z0-9]+\/?$/.test(u.pathname)));
  const ig = /^(www\.)?instagram\.com$/.test(u.hostname) && /^\/reels?\/[\w-]+\/?$/.test(u.pathname);
  if (!tik && !ig) throw new Error("Use a direct TikTok video or Instagram Reel URL.");
  u.search = ""; u.hash = ""; return u.toString();
}
export async function localPath(url: string) {
  const { realpath } = await runtimeFiles();
  if (!url.startsWith("/generated/")) throw new Error("Expected a local media reference.");
  // Keep the runtime lookup statically scoped to generated media for Next's file tracer.
  // Resolve symlinks before the containment check so aliases cannot escape that directory.
  const root = await realpath(MEDIA_DIR), path = await realpath(resolve(MEDIA_DIR, decodeURIComponent(url.slice(11))));
  if (!path.startsWith(root + sep)) throw new Error("Invalid media path.");
  return path;
}
export async function processOutput(command: "ffmpeg" | "ffprobe" | "yt-dlp", args: string[], timeout = 120000) {
  const { spawn } = process.getBuiltinModule("child_process") as typeof import("node:child_process");
  return new Promise<{ stdout: string; stderr: string }>((resolvePromise, reject) => {
    const options = { stdio: ["ignore", "pipe", "pipe"] as ["ignore", "pipe", "pipe"], env: { NODE_ENV: process.env.NODE_ENV, PATH: process.env.PATH, HOME: process.env.HOME, LANG: process.env.LANG } };
    const proc = command === "ffmpeg" ? spawn("ffmpeg", args, options) : command === "ffprobe" ? spawn("ffprobe", args, options) : spawn("yt-dlp", args, options);
    let stdout = "", stderr = "", settled = false;
    const fail = (message: string) => { if (!settled) { settled = true; proc.kill("SIGKILL"); reject(new Error(message)); } };
    const timer = setTimeout(() => fail(`${command} timed out.`), timeout);
    proc.stdout.on("data", d => { stdout += d; if (stdout.length > 8000000) fail(`${command} response exceeded its limit.`); });
    proc.stderr.on("data", d => { stderr = (stderr + d).slice(-100000); });
    proc.on("error", () => { clearTimeout(timer); fail(`${command} is unavailable. Install it on the app server.`); });
    proc.on("close", code => { clearTimeout(timer); if (settled) return; settled = true; if (code !== 0) reject(new Error(command === "yt-dlp" ? "The public video could not be retrieved. It may require login, be unavailable, or be blocked by the platform. No browser credentials were used." : `${command} could not process this media.`)); else resolvePromise({ stdout, stderr }); });
  });
}
export async function probe(path: string) {
  const { stdout } = await processOutput("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=codec_type,width,height", "-of", "json", path], 20000);
  const data = JSON.parse(stdout), stream = data.streams?.find((s: { codec_type: string }) => s.codec_type === "video");
  const duration = Number(data.format?.duration), width = Number(stream?.width), height = Number(stream?.height);
  if (!Number.isFinite(duration) || duration <= 0 || !width || !height) throw new Error("No decodable video stream.");
  return { duration, width, height };
}
function publicUrl(path: string) { return `/generated/${path.slice(resolve(MEDIA_DIR).length + 1).split(sep).join("/")}`; }
/** Temporal evidence: ordered 2fps frames (up to 60), timestamped, plus full-rate scene cuts. */
export async function evidence(localUrl: string): Promise<MediaEvidence> {
  const { mkdtemp, mkdir, stat, rm, readFile } = await runtimeFiles();
  const path = await localPath(localUrl), info = await probe(path);
  if (info.duration > 60.1) throw new Error("Reference inspection supports videos up to 60 seconds.");
  const temp = await mkdtemp(join(tmpdir(), "ugc-frames-"));
  try {
    const interval = Math.max(0.5, info.duration / 60);
    await processOutput("ffmpeg", ["-hide_banner", "-loglevel", "error", "-nostdin", "-i", path, "-vf", `fps=1/${interval},scale=320:320:force_original_aspect_ratio=decrease,pad=320:344:(ow-iw)/2:(320-ih)/2`, "-frames:v", "60", join(temp, "frame-%03d.png")]);
    const frameNames = Array.from({ length: 60 }, (_, i) => `frame-${String(i + 1).padStart(3, "0")}.png`);
    const names = (await Promise.all(frameNames.map(async name => { try { await stat(join(temp, name)); return name; } catch { return undefined; } }))).filter((name): name is string => !!name);
    const sheets: string[] = [], sampleTimes: number[] = [];
    const folder = resolve(MEDIA_DIR, "director", "evidence"); await mkdir(folder, { recursive: true });
    for (let offset = 0; offset < names.length; offset += 15) {
      const cells = await Promise.all(names.slice(offset, offset + 15).map(async (name, i) => {
        const second = Math.min(info.duration, (offset + i) * interval); sampleTimes.push(second);
        const label = Buffer.from(`<svg width="320" height="344"><text x="10" y="336" fill="white" font-family="sans-serif" font-size="17">${second.toFixed(2)}s</text></svg>`);
        return { input: await sharp(await readFile(join(temp, name))).composite([{ input: label }]).png().toBuffer(), left: (i % 5) * 320, top: Math.floor(i / 5) * 344 };
      }));
      const output = join(folder, `${randomUUID()}.jpg`);
      await sharp({ create: { width: 1600, height: Math.ceil(cells.length / 5) * 344, channels: 3, background: "#151515" } }).composite(cells).jpeg({ quality: 87 }).toFile(output);
      sheets.push(publicUrl(output));
    }
    const cuts = await processOutput("ffmpeg", ["-hide_banner", "-nostdin", "-i", path, "-vf", "select='gt(scene,0.35)',showinfo", "-an", "-f", "null", "-"], 60000);
    const cutTimes = [...cuts.stderr.matchAll(/pts_time:([\d.]+)/g)].map(m => Number(m[1]));
    if (!sheets.length) throw new Error("No frames could be extracted.");
    return { localUrl, ...info, sheets, sampleTimes, cutTimes };
  } finally { await rm(temp, { recursive: true, force: true }); }
}
export async function retrieveVideo(input: string, downloadUrl?: string) {
  const { mkdtemp, mkdir, writeFile, stat, rm } = await runtimeFiles();
  const url = sourceUrl(input), temp = await mkdtemp(join(tmpdir(), "ugc-source-"));
  try {
    let inputPath: string, metadata: Record<string, unknown> = {};
    if (url.startsWith("/generated/")) inputPath = await localPath(url);
    else {
      // A live-search result carries a CDN URL that only the discovery browser session can read.
      // Try it first; the public page through yt-dlp remains the fallback for every source.
      const { isTikTokMedia } = await import("./searchProvider");
      const direct = downloadUrl && isTikTokMedia(downloadUrl) ? await (await import("../discovery/tiktokSession")).sharedTikTokSession().getBytes(downloadUrl).catch(() => undefined) : undefined;
      if (direct && direct.contentType.startsWith("video/") && direct.buffer.length) { inputPath = join(temp, "source.mp4"); await writeFile(inputPath, direct.buffer); }
      else {
      const flags = ["--ignore-config", "--no-playlist", "--no-warnings", "--socket-timeout", "15", "--retries", "1", "--fragment-retries", "1"];
      const info = await processOutput("yt-dlp", [...flags, "--dump-single-json", "--skip-download", "--", url], 60000);
      metadata = JSON.parse(info.stdout);
      if (Number(metadata.duration) > 60) throw new Error("Choose a source of 60 seconds or less.");
      await processOutput("yt-dlp", [...flags, "--no-progress", "--no-part", "--max-filesize", "100M", "-f", "b[height<=1080]/b", "--merge-output-format", "mp4", "-o", join(temp, "source.%(ext)s"), "--", url], 120000);
      const files = (await Promise.all(["mp4", "webm", "mov", "mkv"].map(async extension => { const name = `source.${extension}`; try { await stat(join(temp, name)); return name; } catch { return undefined; } }))).filter((name): name is string => !!name);
      if (files.length !== 1) throw new Error("The source did not produce one supported video file.");
      inputPath = join(temp, files[0]);
      }
    }
    if ((await stat(inputPath)).size > 100 * 1024 * 1024) throw new Error("Source exceeds 100 MB.");
    const info = await probe(inputPath); if (info.duration > 60 || info.duration < 3) throw new Error("Use a reference between 3 and 60 seconds.");
    const folder = resolve(MEDIA_DIR, "director", "sources"); await mkdir(folder, { recursive: true });
    const output = join(folder, `${randomUUID()}.mp4`);
    await processOutput("ffmpeg", ["-hide_banner", "-loglevel", "error", "-nostdin", "-i", inputPath, "-map", "0:v:0", "-an", "-vf", "scale='min(1080,iw)':-2", "-c:v", "libx264", "-preset", "fast", "-crf", "20", "-movflags", "+faststart", output]);
    const media = await evidence(publicUrl(output));
    return { media, title: typeof metadata.title === "string" ? metadata.title.slice(0, 200) : undefined, metrics: { views: typeof metadata.view_count === "number" ? metadata.view_count : undefined, likes: typeof metadata.like_count === "number" ? metadata.like_count : undefined, publishedAt: typeof metadata.timestamp === "number" ? new Date(metadata.timestamp * 1000).toISOString() : undefined, checkedAt: Date.now() } };
  } finally { await rm(temp, { recursive: true, force: true }); }
}
export const DEFAULT_CLIP_LIMITS: ClipLimits = { minSeconds: 3, maxSeconds: 10, minSide: 341, minRatio: 0.4, maxRatio: 2.5 };
function checkDimensions(width: number, height: number, limits: ClipLimits, what: string) {
  if (limits.minSide && (width < limits.minSide || height < limits.minSide)) throw new Error(`${what} must be at least ${limits.minSide}px on each side for the selected video model.`);
  const ratio = width / height;
  if ((limits.minRatio && ratio < limits.minRatio) || (limits.maxRatio && ratio > limits.maxRatio)) throw new Error(`${what} aspect ratio is outside the selected video model's supported range.`);
}
export async function clipVideo(media: MediaEvidence, start: number, end: number, limits: ClipLimits = DEFAULT_CLIP_LIMITS) {
  if (start < 0 || end > media.duration + 0.05 || end - start < limits.minSeconds || end - start > limits.maxSeconds) throw new Error(`Motion clip must be ${limits.minSeconds}–${limits.maxSeconds} seconds within the inspected source.`);
  checkDimensions(media.width, media.height, limits, "Motion source");
  if (media.cutTimes.some(t => t > start + 0.1 && t < end - 0.1)) throw new Error("Choose a continuous segment with no detected scene cut.");
  const input = await localPath(media.localUrl), output = resolve(MEDIA_DIR, "director", "sources", `${randomUUID()}-clip.mp4`);
  await processOutput("ffmpeg", ["-hide_banner", "-loglevel", "error", "-nostdin", "-ss", String(start), "-i", input, "-t", String(end - start), "-an", "-c:v", "libx264", "-preset", "fast", "-crf", "19", "-movflags", "+faststart", output]);
  return evidence(publicUrl(output));
}
export async function localImage(url: string) { const { readFile } = await runtimeFiles(); const path = await localPath(url); const data = await sharp(await readFile(path)).metadata(); if (!data.width || !data.height) throw new Error("Invalid image reference."); return url; }

export async function motionImage(url: string, limits: ClipLimits = DEFAULT_CLIP_LIMITS) {
  const { mkdir, stat, readFile } = await runtimeFiles();
  const path = await localPath(await storeMedia(url, "director/outputs", "image"));
  const bytes = await readFile(path);
  const meta = await sharp(bytes).metadata();
  if (!meta.width || !meta.height) throw new Error("Anchor image could not be read.");
  checkDimensions(meta.width, meta.height, limits, "Anchor image");
  const folder = resolve(MEDIA_DIR, "director", "anchors"); await mkdir(folder, { recursive: true });
  const output = join(folder, `${randomUUID()}.jpg`);
  await sharp(bytes).rotate().resize({ width: 2048, height: 2048, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 92 }).toFile(output);
  if ((await stat(output)).size > 10 * 1024 * 1024) throw new Error("Motion anchor exceeds 10 MB.");
  return publicUrl(output);
}
