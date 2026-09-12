import { randomUUID } from "node:crypto";
import { db } from "./guest/sqlite";

/**
 * A local library of proven image prompts.
 *
 * Prompts live in the app's SQLite database, never in the repo: the seed
 * library is personal, and another user brings their own through the JSON
 * upload. The planner and the prompt builder pull the closest matches as
 * style references, the way prompt-palette-pro's build-prompt function did.
 */
export interface LibraryPrompt {
  id: string;
  title: string | null;
  prompt: string;
  categories: string[];
  folders: string[];
  source: string | null;
  attribution: string | null;
  imageUrls: string[];
  favorite: boolean;
  /** VisionStruct analysis when the prompt was built from an image or enhanced. */
  analysis: Record<string, unknown> | null;
  /** Reality-First structured prompt (for Nano Banana Pro) when one was built. */
  structured: Record<string, unknown> | null;
  /** Narrative prose version (for GPT Image / Grok) when one was built. */
  prose: string | null;
  negatives: string | null;
  origin: "import" | "user" | "built";
  createdAt: number;
  updatedAt: number;
}
type Row = { id: string; title: string | null; prompt: string; categories: string; folders: string; source: string | null; attribution: string | null; image_urls: string; favorite: number; analysis: string | null; structured: string | null; prose: string | null; negatives: string | null; origin: LibraryPrompt["origin"]; created_at: number; updated_at: number };

function table() {
  const d = db();
  d.exec("CREATE TABLE IF NOT EXISTS prompt_library (id TEXT PRIMARY KEY, title TEXT, prompt TEXT NOT NULL, categories TEXT NOT NULL, folders TEXT NOT NULL, source TEXT, attribution TEXT, image_urls TEXT NOT NULL, favorite INTEGER NOT NULL DEFAULT 0, analysis TEXT, structured TEXT, prose TEXT, negatives TEXT, origin TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)");
  return d;
}
const json = <T,>(text: string | null, fallback: T): T => { if (!text) return fallback; try { return JSON.parse(text) as T; } catch { return fallback; } };
const fromRow = (r: Row): LibraryPrompt => ({ id: r.id, title: r.title, prompt: r.prompt, categories: json(r.categories, []), folders: json(r.folders, []), source: r.source, attribution: r.attribution, imageUrls: json(r.image_urls, []), favorite: !!r.favorite, analysis: json(r.analysis, null), structured: json(r.structured, null), prose: r.prose, negatives: r.negatives, origin: r.origin, createdAt: r.created_at, updatedAt: r.updated_at });

export type PromptInput = Partial<Omit<LibraryPrompt, "prompt" | "createdAt" | "updatedAt">> & { prompt: string };
const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && v.trim().length > 0).map(v => v.trim()) : [];
const tag = (c: string) => c.toLowerCase().trim().slice(0, 40);

/**
 * Accept the shapes people actually have: this app's export, a prompt-palette-pro
 * Supabase export (`prompt_text`, `image_urls`, `is_favorite`, `analysis_json`), or a
 * plain `{ prompt, title?, categories? }`. Wrapping objects (`prompts`, `rows`, `data`) are unwrapped.
 */
export function normalizeImport(payload: unknown): PromptInput[] {
  let list: unknown = payload;
  if (list && typeof list === "object" && !Array.isArray(list)) {
    const o = list as Record<string, unknown>;
    list = o.prompts ?? o.rows ?? o.data ?? (typeof o.prompt === "string" || typeof o.prompt_text === "string" ? [o] : []);
  }
  if (!Array.isArray(list)) return [];
  return list.flatMap(item => {
    if (!item || typeof item !== "object") return [];
    const o = item as Record<string, unknown>;
    const prompt = typeof o.prompt === "string" ? o.prompt : typeof o.prompt_text === "string" ? o.prompt_text : typeof o.text === "string" ? o.text : "";
    if (!prompt.trim()) return [];
    const created = typeof o.createdAt === "number" ? o.createdAt : typeof o.created_at === "string" ? Date.parse(o.created_at) : undefined;
    return [{
      id: typeof o.id === "string" && o.id ? o.id : undefined,
      title: typeof o.title === "string" ? o.title : null,
      prompt: prompt.trim(),
      categories: strings(o.categories).map(tag),
      folders: strings(o.folders),
      source: typeof o.source === "string" ? o.source : null,
      attribution: typeof o.attribution === "string" ? o.attribution : null,
      imageUrls: strings(o.imageUrls ?? o.image_urls),
      favorite: o.favorite === true || o.is_favorite === true,
      analysis: o.analysis && typeof o.analysis === "object" ? o.analysis as Record<string, unknown> : o.analysis_json && typeof o.analysis_json === "object" ? o.analysis_json as Record<string, unknown> : null,
      structured: o.structured && typeof o.structured === "object" ? o.structured as Record<string, unknown> : null,
      prose: typeof o.prose === "string" ? o.prose : typeof o.narrative_prose === "string" ? o.narrative_prose : null,
      negatives: typeof o.negatives === "string" ? o.negatives : typeof o.strict_negatives === "string" ? o.strict_negatives : null,
      origin: "import" as const,
      ...(created && Number.isFinite(created) ? { createdAtHint: created } : {}),
    } as PromptInput & { createdAtHint?: number }];
  });
}

export function savePrompt(input: PromptInput & { createdAtHint?: number }): LibraryPrompt {
  const now = Date.now();
  const existing = input.id ? (table().prepare("SELECT * FROM prompt_library WHERE id = ?").get(input.id) as Row | undefined) : undefined;
  const id = existing?.id ?? input.id ?? randomUUID();
  const createdAt = existing?.created_at ?? input.createdAtHint ?? now;
  table().prepare(`INSERT INTO prompt_library (id, title, prompt, categories, folders, source, attribution, image_urls, favorite, analysis, structured, prose, negatives, origin, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET title = excluded.title, prompt = excluded.prompt, categories = excluded.categories, folders = excluded.folders, source = excluded.source, attribution = excluded.attribution, image_urls = excluded.image_urls, favorite = excluded.favorite, analysis = excluded.analysis, structured = excluded.structured, prose = excluded.prose, negatives = excluded.negatives, origin = excluded.origin, updated_at = excluded.updated_at`)
    .run(id, input.title ?? null, input.prompt.trim(), JSON.stringify((input.categories ?? []).map(tag)), JSON.stringify(input.folders ?? []), input.source ?? null, input.attribution ?? null, JSON.stringify(input.imageUrls ?? []), input.favorite ? 1 : 0,
      input.analysis ? JSON.stringify(input.analysis) : null, input.structured ? JSON.stringify(input.structured) : null, input.prose ?? null, input.negatives ?? null, input.origin ?? "user", createdAt, now);
  return getPrompt(id)!;
}

/** Same id updates; an identical prompt body under another id is skipped rather than duplicated. */
export function importPrompts(payload: unknown): { added: number; updated: number; skipped: number } {
  const items = normalizeImport(payload);
  const bodies = new Set((table().prepare("SELECT prompt FROM prompt_library").all() as { prompt: string }[]).map(r => r.prompt.trim()));
  let added = 0, updated = 0, skipped = 0;
  for (const item of items) {
    const exists = item.id && table().prepare("SELECT 1 FROM prompt_library WHERE id = ?").get(item.id);
    if (exists) { savePrompt(item); updated++; continue; }
    if (bodies.has(item.prompt.trim())) { skipped++; continue; }
    savePrompt(item); bodies.add(item.prompt.trim()); added++;
  }
  return { added, updated, skipped };
}

export function getPrompt(id: string): LibraryPrompt | undefined {
  const row = table().prepare("SELECT * FROM prompt_library WHERE id = ?").get(id) as Row | undefined;
  return row ? fromRow(row) : undefined;
}
export function deletePrompt(id: string) { table().prepare("DELETE FROM prompt_library WHERE id = ?").run(id); }
export function setFavorite(id: string, favorite: boolean) { table().prepare("UPDATE prompt_library SET favorite = ?, updated_at = ? WHERE id = ?").run(favorite ? 1 : 0, Date.now(), id); }

export function listPrompts(options: { query?: string; category?: string; favorites?: boolean; limit?: number; offset?: number } = {}): { items: LibraryPrompt[]; total: number } {
  const where: string[] = [], params: (string | number)[] = [];
  if (options.query?.trim()) { where.push("(prompt LIKE ? OR title LIKE ? OR categories LIKE ?)"); const q = `%${options.query.trim()}%`; params.push(q, q, q); }
  if (options.category) { where.push("categories LIKE ?"); params.push(`%${JSON.stringify(tag(options.category))}%`); }
  if (options.favorites) where.push("favorite = 1");
  const clause = where.length ? ` WHERE ${where.join(" AND ")}` : "";
  const total = (table().prepare(`SELECT count(*) AS n FROM prompt_library${clause}`).get(...params) as { n: number }).n;
  const items = (table().prepare(`SELECT * FROM prompt_library${clause} ORDER BY favorite DESC, created_at DESC LIMIT ? OFFSET ?`).all(...params, Math.min(options.limit ?? 60, 500), options.offset ?? 0) as Row[]).map(fromRow);
  return { items, total };
}

export function libraryStats(): { total: number; favorites: number; categories: { name: string; count: number }[] } {
  const rows = table().prepare("SELECT categories, favorite FROM prompt_library").all() as { categories: string; favorite: number }[];
  const counts = new Map<string, number>();
  for (const r of rows) for (const c of json<string[]>(r.categories, [])) counts.set(c, (counts.get(c) ?? 0) + 1);
  return { total: rows.length, favorites: rows.filter(r => r.favorite).length, categories: [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count) };
}

const STOP = new Set(["with", "that", "this", "from", "have", "them", "their", "there", "into", "about", "just", "like", "look", "very", "make", "create", "image", "photo", "prompt", "want", "please", "some", "also", "then", "than", "what", "when", "which", "will", "would", "should", "could"]);
export const keywords = (text: string) => [...new Set(text.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 3 && !STOP.has(w)))];

/**
 * The closest library prompts to a brief: keyword hits in the prompt body,
 * doubled for category matches, plus a nudge for favorites. Mirrors the
 * scoring prompt-palette-pro used to choose few-shot examples.
 */
export function relevantPrompts(text: string, k = 5, categories: string[] = []): LibraryPrompt[] {
  const words = keywords(text), wanted = new Set(categories.map(tag));
  const rows = (table().prepare("SELECT * FROM prompt_library").all() as Row[]).map(fromRow);
  const scored = rows.map(p => {
    const body = `${p.prompt} ${p.title ?? ""} ${p.categories.join(" ")}`.toLowerCase();
    let score = words.reduce((n, w) => n + (body.includes(w) ? 1 : 0), 0);
    score += p.categories.filter(c => wanted.has(c)).length * 2;
    if (score > 0 && p.favorite) score += 0.5; // a favorite breaks ties, never appears on its own
    return { p, score };
  }).filter(s => s.score > 0).sort((a, b) => b.score - a.score || b.p.createdAt - a.p.createdAt);
  return scored.slice(0, k).map(s => s.p);
}

/** Truncated few-shot style references for a planner or builder prompt. */
export function styleReferences(text: string, k = 3, maxChars = 700): { id: string; title: string | null; excerpt: string }[] {
  return relevantPrompts(text, k).map(p => ({ id: p.id, title: p.title, excerpt: p.prompt.length > maxChars ? `${p.prompt.slice(0, maxChars)}…` : p.prompt }));
}
