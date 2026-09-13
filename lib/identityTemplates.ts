import { randomUUID } from "node:crypto";
import { db } from "./guest/sqlite";
import { createIdentityAsset } from "./guest/identityAssets";
import { storeMedia } from "./campaigns/director/download";
import { uploadBuffer } from "./guest/localStorage";
import { readFile } from "node:fs/promises";
import { join, normalize } from "node:path";
import type { IdentityAsset } from "./cloneMe";
import seed from "./seed/identity-templates.json";

/**
 * Starter influencer templates: a described persona with a reference image,
 * ready to become an identity in one click. Templates live in the local
 * database. The repo ships 96 seed personas (lib/seed/identity-templates.json
 * with images under public/persona-templates) so a fresh install does not
 * start empty; more arrive as JSON uploads (an App Promo Factory / Viral Reel
 * Creator export, or plain rows). Images stay where they are until a template
 * is used, when the image is mirrored into local media and an identity asset
 * is created. Deleting a seed template sticks: it is not re-seeded.
 */
const SEED_VERSION = 2; // 2: outfit-named lifestyle personas given real names, ethnicity spellings normalised
export interface IdentityTemplate {
  id: string;
  name: string;
  subtitle: string | null;
  category: string | null;
  gender: string | null;
  ageRange: string | null;
  ethnicity: string | null;
  /** Discrete trait fields (eye color, face shape, hair, body…) as exported. */
  traits: Record<string, string>;
  prompt: string;
  imageUrl: string | null;
  sortOrder: number;
  createdAt: number;
}
type Row = { id: string; name: string; subtitle: string | null; category: string | null; gender: string | null; age_range: string | null; ethnicity: string | null; traits: string; prompt: string; image_url: string | null; sort_order: number; created_at: number };
const TRAIT_KEYS = ["eye_color", "eye_shape", "face_shape", "nose_type", "lip_type", "eyebrow_shape", "jawline", "skin_tone", "skin_undertone", "hair_color", "hair_highlight_color", "hair_length", "hair_style", "hair_texture", "height_category", "body_shape", "bust_volume", "shoulder_width", "waist_definition", "hip_width", "muscle_definition", "character_style", "appearance_details"];

function table() {
  const d = db();
  d.exec("CREATE TABLE IF NOT EXISTS identity_templates (id TEXT PRIMARY KEY, name TEXT NOT NULL, subtitle TEXT, category TEXT, gender TEXT, age_range TEXT, ethnicity TEXT, traits TEXT NOT NULL, prompt TEXT NOT NULL, image_url TEXT, sort_order INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL)");
  d.exec("CREATE TABLE IF NOT EXISTS identity_template_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  d.exec("CREATE TABLE IF NOT EXISTS identity_template_removed (id TEXT PRIMARY KEY)");
  return d;
}
/** Load the shipped personas once per seed version, skipping any the user removed. */
export function ensureSeeded() {
  const d = table();
  const row = d.prepare("SELECT value FROM identity_template_meta WHERE key = 'seed_version'").get() as { value: string } | undefined;
  if (Number(row?.value ?? 0) >= SEED_VERSION) return;
  const removed = new Set((d.prepare("SELECT id FROM identity_template_removed").all() as { id: string }[]).map(r => r.id));
  importTemplates((seed as unknown[]).filter(t => !removed.has(String((t as { id?: unknown }).id))));
  d.prepare("INSERT INTO identity_template_meta (key, value) VALUES ('seed_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(String(SEED_VERSION));
}
const fromRow = (r: Row): IdentityTemplate => ({ id: r.id, name: r.name, subtitle: r.subtitle, category: r.category, gender: r.gender, ageRange: r.age_range, ethnicity: r.ethnicity, traits: JSON.parse(r.traits), prompt: r.prompt, imageUrl: r.image_url, sortOrder: r.sort_order, createdAt: r.created_at });
const str = (v: unknown) => typeof v === "string" && v.trim() ? v.trim() : null;

/** Accepts this app's export, an App Promo Factory / Viral Reel Creator `influencer_templates` export, or plain `{ name, prompt, imageUrl? }` rows. */
export function normalizeTemplates(payload: unknown): Omit<IdentityTemplate, "createdAt">[] {
  let list: unknown = payload;
  if (list && typeof list === "object" && !Array.isArray(list)) { const o = list as Record<string, unknown>; list = o.templates ?? o.rows ?? o.data ?? []; }
  if (!Array.isArray(list)) return [];
  return list.flatMap((item, index) => {
    if (!item || typeof item !== "object") return [];
    const o = item as Record<string, unknown>;
    const prompt = str(o.prompt) ?? str(o.prompt_value) ?? str(o.description);
    const name = str(o.name);
    if (!prompt || !name) return [];
    const traits: Record<string, string> = {};
    for (const key of TRAIT_KEYS) { const v = str(o[key]) ?? str(o[key.replace(/_([a-z])/g, (_, c) => c.toUpperCase())]); if (v) traits[key] = v; }
    if (o.traits && typeof o.traits === "object") for (const [k, v] of Object.entries(o.traits as Record<string, unknown>)) { const s = str(v); if (s) traits[k] = s; }
    const image = str(o.imageUrl) ?? str(o.image_url) ?? str(o.reference_image_url);
    return [{ id: str(o.id) ?? randomUUID(), name: name.slice(0, 120), subtitle: str(o.subtitle), category: str(o.category), gender: str(o.gender), ageRange: str(o.ageRange) ?? str(o.age_range), ethnicity: str(o.ethnicity), traits, prompt, imageUrl: image && /^(https:\/\/|\/generated\/|\/persona-templates\/)/.test(image) ? image : null, sortOrder: typeof o.sortOrder === "number" ? o.sortOrder : typeof o.sort_order === "number" ? o.sort_order : index }];
  });
}
export function importTemplates(payload: unknown): { added: number; updated: number } {
  let added = 0, updated = 0;
  for (const t of normalizeTemplates(payload)) {
    const exists = table().prepare("SELECT 1 FROM identity_templates WHERE id = ?").get(t.id);
    table().prepare(`INSERT INTO identity_templates (id, name, subtitle, category, gender, age_range, ethnicity, traits, prompt, image_url, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET name = excluded.name, subtitle = excluded.subtitle, category = excluded.category, gender = excluded.gender, age_range = excluded.age_range, ethnicity = excluded.ethnicity, traits = excluded.traits, prompt = excluded.prompt, image_url = excluded.image_url, sort_order = excluded.sort_order`)
      .run(t.id, t.name, t.subtitle, t.category, t.gender, t.ageRange, t.ethnicity, JSON.stringify(t.traits), t.prompt, t.imageUrl, t.sortOrder, Date.now());
    if (exists) updated++; else added++;
  }
  return { added, updated };
}
export function listTemplates(options: { category?: string; gender?: string; query?: string } = {}): IdentityTemplate[] {
  ensureSeeded();
  const where: string[] = [], params: string[] = [];
  if (options.category) { where.push("category = ?"); params.push(options.category); }
  if (options.gender) { where.push("gender = ?"); params.push(options.gender); }
  if (options.query?.trim()) { where.push("(name LIKE ? OR subtitle LIKE ? OR prompt LIKE ?)"); const q = `%${options.query.trim()}%`; params.push(q, q, q); }
  return (table().prepare(`SELECT * FROM identity_templates${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY sort_order, name`).all(...params) as Row[]).map(fromRow);
}
export function getTemplate(id: string): IdentityTemplate | undefined {
  ensureSeeded();
  const row = table().prepare("SELECT * FROM identity_templates WHERE id = ?").get(id) as Row | undefined;
  return row ? fromRow(row) : undefined;
}
export function deleteTemplate(id: string) { table().prepare("DELETE FROM identity_templates WHERE id = ?").run(id); table().prepare("INSERT OR IGNORE INTO identity_template_removed (id) VALUES (?)").run(id); }
export function templateCategories(): { name: string; count: number }[] {
  ensureSeeded();
  return (table().prepare("SELECT category AS name, count(*) AS count FROM identity_templates WHERE category IS NOT NULL GROUP BY category ORDER BY count DESC, name").all() as { name: string; count: number }[]);
}

/** A stable trigger word from the name: "Olivia Rose" → "olivia_rose". */
export const triggerWordFor = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40) || "persona";

/**
 * Turn a template into an identity: mirror its image into local media (the
 * account planners only read local references) and create the identity
 * asset with the template prompt as its base prompt.
 */
/** Shipped images live under public/; everything else is fetched. Either way the copy lands in local media. */
export async function mirrorTemplateImage(url: string): Promise<string> {
  if (url.startsWith("/persona-templates/")) {
    const file = normalize(url).replace(/^\/+/, "");
    if (file.includes("..")) throw new Error("Invalid template image path.");
    return uploadBuffer(await readFile(join(process.cwd(), "public", file)), "image/webp", "identity-templates");
  }
  return storeMedia(url, "identity-templates", "image");
}
export async function materializeTemplate(id: string, mirror: (url: string) => Promise<string> = mirrorTemplateImage): Promise<IdentityAsset> {
  const t = getTemplate(id);
  if (!t) throw new Error("Template not found.");
  const references = t.imageUrl ? [{ url: await mirror(t.imageUrl), kind: "face" as const, label: `${t.name} template` }] : [];
  const traitLine = Object.entries(t.traits).filter(([k]) => k !== "appearance_details").map(([k, v]) => `${k.replaceAll("_", " ")}: ${v}`).join(", ");
  return createIdentityAsset({ name: t.name, triggerWord: triggerWordFor(t.name), basePrompts: [t.prompt, ...(traitLine ? [`Locked features. ${traitLine}.`] : [])], references, defaults: { contentClass: "sfw" } });
}
