import { randomUUID } from "node:crypto";
import { db } from "./sqlite";
import type { IdentityAsset, IdentityReference } from "../cloneMe";

type IdentityInput = Pick<IdentityAsset, "name" | "triggerWord" | "basePrompts" | "references">;

function parseArray<T>(value: unknown): T[] {
  if (typeof value !== "string") return [];
  try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed as T[] : []; } catch { return []; }
}

function fromRow(row: Record<string, unknown>): IdentityAsset {
  return {
    id: String(row.id),
    name: String(row.name),
    version: Number(row.version),
    triggerWord: String(row.trigger_word ?? ""),
    basePrompts: parseArray<string>(row.base_prompts),
    references: parseArray<IdentityReference>(row.references_json),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function clean(input: IdentityInput): IdentityInput {
  const name = input.name.trim().slice(0, 120);
  if (!name) throw new Error("Identity name is required.");
  const references = input.references.filter((item) => item && typeof item.url === "string" && item.url.trim()).slice(0, 24).map((item) => ({
    url: item.url.trim(), kind: item.kind === "body" ? "body" as const : "face" as const,
    ...(item.label?.trim() ? { label: item.label.trim().slice(0, 80) } : {}),
  }));
  return {
    name,
    triggerWord: input.triggerWord.trim().slice(0, 120),
    basePrompts: input.basePrompts.map((value) => value.trim()).filter(Boolean).slice(0, 20),
    references,
  };
}

function saveVersion(asset: IdentityAsset): void {
  db().prepare(`INSERT INTO identity_asset_versions
    (asset_id, version, snapshot_json, created_at) VALUES (?, ?, ?, ?)`)
    .run(asset.id, asset.version, JSON.stringify(asset), asset.updatedAt);
}

export function listIdentityAssets(): IdentityAsset[] {
  return (db().prepare("SELECT * FROM identity_assets ORDER BY updated_at DESC").all() as Record<string, unknown>[]).map(fromRow);
}

export function getIdentityAsset(id: string): IdentityAsset | null {
  const row = db().prepare("SELECT * FROM identity_assets WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  return row ? fromRow(row) : null;
}

export function listIdentityVersions(id: string): IdentityAsset[] {
  const rows = db().prepare("SELECT snapshot_json FROM identity_asset_versions WHERE asset_id = ? ORDER BY version DESC").all(id) as { snapshot_json: string }[];
  return rows.flatMap((row) => { try { return [JSON.parse(row.snapshot_json) as IdentityAsset]; } catch { return []; } });
}

export function createIdentityAsset(input: IdentityInput): IdentityAsset {
  const value = clean(input);
  const id = randomUUID();
  const timestamp = new Date().toISOString();
  db().prepare(`INSERT INTO identity_assets
    (id, name, version, trigger_word, base_prompts, references_json, created_at, updated_at)
    VALUES (?, ?, 1, ?, ?, ?, ?, ?)`)
    .run(id, value.name, value.triggerWord, JSON.stringify(value.basePrompts), JSON.stringify(value.references), timestamp, timestamp);
  const asset = getIdentityAsset(id)!;
  saveVersion(asset);
  return asset;
}

export function updateIdentityAsset(id: string, input: IdentityInput): IdentityAsset {
  const current = getIdentityAsset(id);
  if (!current) throw new Error(`Identity asset not found: ${id}`);
  const value = clean(input);
  const timestamp = new Date().toISOString();
  db().prepare(`UPDATE identity_assets SET name = ?, version = ?, trigger_word = ?, base_prompts = ?, references_json = ?, updated_at = ? WHERE id = ?`)
    .run(value.name, current.version + 1, value.triggerWord, JSON.stringify(value.basePrompts), JSON.stringify(value.references), timestamp, id);
  const asset = getIdentityAsset(id)!;
  saveVersion(asset);
  return asset;
}

export function deleteIdentityAsset(id: string): boolean {
  return db().prepare("DELETE FROM identity_assets WHERE id = ?").run(id).changes > 0;
}
