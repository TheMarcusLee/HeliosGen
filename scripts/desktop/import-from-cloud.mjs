/**
 * One-shot import of a user's web-app data (Supabase + R2) into the local
 * desktop app's guest store.
 *
 *   node scripts/desktop/import-from-cloud.mjs [--email you@example.com] [--data-dir PATH] [--dry]
 *
 * Reads credentials from .env.local (NEXT_PUBLIC_SUPABASE_URL,
 * SUPABASE_SERVICE_ROLE_KEY, R2_PUBLIC_URL). Merges into existing
 * guest-db.json / guest-spaces.json rather than overwriting; media downloads
 * are resumable (existing files are skipped).
 */
import { createClient } from "@supabase/supabase-js";
import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
process.loadEnvFile(join(ROOT, ".env.local"));

const args = process.argv.slice(2);
const arg = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const DRY = args.includes("--dry");
const EMAIL = arg("email", "ramzi90000@gmail.com");
const DATA_DIR = arg(
  "data-dir",
  join(homedir(), "Library", "Application Support", "cash.sdd.helios.desktop"),
);
const MEDIA_DIR = join(DATA_DIR, "generated");
const DB_FILE = join(DATA_DIR, "guest-db.json");
const SPACES_FILE = join(DATA_DIR, "guest-spaces.json");
const CONCURRENCY = 10;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const R2_BASE = (process.env.R2_PUBLIC_URL ?? "").replace(/\/$/, "");
if (!SUPABASE_URL || !SERVICE_KEY || !R2_BASE) {
  throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / R2_PUBLIC_URL in .env.local");
}

const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

// ── helpers ─────────────────────────────────────────────────────────────────

function asArray(v) {
  if (Array.isArray(v)) return v;
  if (v == null) return [];
  if (typeof v === "string") {
    try {
      const p = JSON.parse(v);
      return Array.isArray(p) ? p : [v];
    } catch {
      return [v];
    }
  }
  return [];
}

/** R2 public URL → local `/generated/...` path (and remember it needs downloading). */
const toFetch = new Map(); // localRelPath -> remoteUrl
function localize(url) {
  if (typeof url !== "string" || !url.startsWith(R2_BASE + "/")) return url;
  const rel = url.slice(R2_BASE.length + 1).split("?")[0]; // e.g. "images/abc.jpg"
  toFetch.set(rel, url);
  return `/generated/${rel}`;
}

/** Rewrite every R2 URL anywhere inside a JSON-serialisable value. */
function localizeDeep(value) {
  const json = JSON.stringify(value);
  const re = new RegExp(escapeRe(R2_BASE) + "/[^\"'\\s\\\\)]+", "g");
  const fixed = json.replace(re, (m) => localize(m.replace(/[.,;]+$/, "")));
  return JSON.parse(fixed);
}
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

async function fileExists(p) {
  try {
    return (await stat(p)).size > 0;
  } catch {
    return false;
  }
}

async function download(rel, url, attempt = 1) {
  const dest = join(MEDIA_DIR, rel);
  if (await fileExists(dest)) return "skip";
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await mkdir(dirname(dest), { recursive: true });
    await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
    return "ok";
  } catch (e) {
    if (attempt < 4) {
      await new Promise((r) => setTimeout(r, 400 * attempt));
      return download(rel, url, attempt + 1);
    }
    console.warn(`  ✗ ${rel}: ${e.message}`);
    return "fail";
  }
}

async function runPool(items, worker) {
  let i = 0;
  const counts = { ok: 0, skip: 0, fail: 0 };
  const next = async () => {
    while (i < items.length) {
      const idx = i++;
      const r = await worker(items[idx]);
      counts[r] = (counts[r] ?? 0) + 1;
      const done = counts.ok + counts.skip + counts.fail;
      if (done % 50 === 0 || done === items.length) {
        process.stdout.write(`\r  ${done}/${items.length}  (new ${counts.ok}, skipped ${counts.skip}, failed ${counts.fail})`);
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, next));
  process.stdout.write("\n");
  return counts;
}

async function pageAll(table, select, userId) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from(table)
      .select(select)
      .eq("user_id", userId)
      .range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...data);
    if (data.length < 1000) break;
  }
  return rows;
}

// ── main ────────────────────────────────────────────────────────────────────

const { data: userList, error: uErr } = await sb.auth.admin.listUsers({ perPage: 1000 });
if (uErr) throw uErr;
const user = userList.users.find((u) => u.email === EMAIL);
if (!user) throw new Error(`No Supabase user with email ${EMAIL}`);
console.log(`user: ${EMAIL}  (${user.id})`);
console.log(`target: ${DATA_DIR}${DRY ? "  [DRY RUN]" : ""}\n`);

console.log("fetching rows…");
const [gens, uploads, folders, folderItems, spaceRows, settingsRows] = await Promise.all([
  pageAll("generations", "*", user.id),
  pageAll("user_uploads", "*", user.id),
  pageAll("folders", "*", user.id),
  pageAll("folder_items", "*", user.id),
  pageAll("spaces", "id, name, data, is_public, created_at", user.id),
  sb.from("user_settings").select("*").eq("user_id", user.id).maybeSingle().then((r) => r.data),
]);
console.log(`  generations ${gens.length}, uploads ${uploads.length}, folders ${folders.length}, folder_items ${folderItems.length}, spaces ${spaceRows.length}`);

// existing db (merge target)
let db = { generations: [], uploads: [], assetCache: {}, folders: [], folder_items: [], settings: {} };
try {
  db = { ...db, ...JSON.parse(await readFile(DB_FILE, "utf8")) };
} catch {
  /* fresh */
}

const haveTask = new Set(db.generations.map((g) => g.task_id));
const haveUpload = new Set(db.uploads.map((u) => u.id));
const haveFolder = new Set(db.folders.map((f) => f.id));
const haveFI = new Set(db.folder_items.map((fi) => `${fi.folder_id}:${fi.item_id}`));

let addedG = 0;
for (const g of gens) {
  if (haveTask.has(g.task_id)) continue;
  db.generations.push({
    id: g.id,
    user_id: "guest",
    task_id: g.task_id,
    generation_type: g.generation_type,
    status: g.status,
    prompt: g.prompt ?? undefined,
    model: g.model ?? undefined,
    aspect_ratio: g.aspect_ratio ?? undefined,
    quality: g.quality ?? undefined,
    azure_resolution: g.azure_resolution ?? undefined,
    duration: g.duration ?? undefined,
    kling_mode: g.kling_mode ?? undefined,
    sound: g.sound ?? undefined,
    reference_image_urls: asArray(g.reference_image_urls).map(localize),
    image_url: localize(g.image_url) ?? undefined,
    image_urls: asArray(g.image_urls).map(localize),
    video_url: localize(g.video_url) ?? undefined,
    error_msg: g.error_msg ?? undefined,
    created_at: g.created_at,
    updated_at: g.updated_at,
  });
  addedG++;
}

let addedU = 0;
for (const u of uploads) {
  if (haveUpload.has(u.id)) continue;
  db.uploads.push({
    id: u.id,
    user_id: "guest",
    r2_url: localize(u.r2_url),
    mime_type: u.mime_type ?? null,
    source: u.source ?? "user_upload",
    created_at: u.created_at,
  });
  addedU++;
}

let addedF = 0;
for (const f of folders) {
  if (haveFolder.has(f.id)) continue;
  db.folders.push({
    id: f.id,
    user_id: "guest",
    name: f.name,
    parent_id: f.parent_id ?? null,
    order_index: f.order_index ?? 0,
    created_at: f.created_at,
    updated_at: f.updated_at,
    color: f.color ?? null,
  });
  addedF++;
}

let addedFI = 0;
for (const fi of folderItems) {
  const k = `${fi.folder_id}:${fi.item_id}`;
  if (haveFI.has(k)) continue;
  db.folder_items.push({
    folder_id: fi.folder_id,
    item_id: fi.item_id,
    user_id: "guest",
    created_at: fi.created_at,
  });
  addedFI++;
}

db.settings = db.settings ?? {};
if (settingsRows?.kie_api_token && !db.settings.kie_api_token) db.settings.kie_api_token = settingsRows.kie_api_token;
if (settingsRows?.azure_api_key && !db.settings.azure_api_key) db.settings.azure_api_key = settingsRows.azure_api_key;

// ── spaces (workflows) → guest-spaces.json ──────────────────────────────────
let spaces = [];
try {
  spaces = JSON.parse(await readFile(SPACES_FILE, "utf8"));
  if (!Array.isArray(spaces)) spaces = [];
} catch {
  /* none yet */
}
const haveSpace = new Set(spaces.map((s) => s.id));
let addedS = 0;
for (const row of spaceRows) {
  if (haveSpace.has(row.id)) continue;
  const data = localizeDeep(row.data ?? {});
  spaces.push({
    id: row.id,
    name: row.name,
    nodes: data.nodes ?? [],
    edges: data.edges ?? [],
    nodeCounters: data.nodeCounters ?? {},
    viewport: data.viewport,
    createdAt: data.createdAt ?? Date.parse(row.created_at),
    updatedAt: data.updatedAt ?? data.createdAt ?? Date.parse(row.created_at),
    isPublic: row.is_public ?? false,
  });
  addedS++;
}

console.log(`\nto add: ${addedG} generations, ${addedU} uploads, ${addedF} folders, ${addedFI} folder-items, ${addedS} spaces`);
console.log(`media files referenced: ${toFetch.size}`);

if (DRY) {
  console.log("\n[dry run] nothing written.");
  process.exit(0);
}

console.log("\ndownloading media…");
await mkdir(MEDIA_DIR, { recursive: true });
const counts = await runPool([...toFetch.entries()], ([rel, url]) => download(rel, url));

await writeFile(DB_FILE, JSON.stringify(db, null, 2));
await writeFile(SPACES_FILE, JSON.stringify(spaces, null, 2));
console.log(`\n✓ wrote ${DB_FILE}`);
console.log(`  generations ${db.generations.length}, uploads ${db.uploads.length}, folders ${db.folders.length}`);
console.log(`✓ wrote ${SPACES_FILE}  (${spaces.length} spaces)`);
console.log(`  media: ${counts.ok} downloaded, ${counts.skip} already present, ${counts.fail} failed`);
if (counts.fail) console.log("  (re-run to retry failed downloads)");
