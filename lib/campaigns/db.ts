import { budgetSchema, memorySchema } from "./operations";
import { randomUUID } from "node:crypto";
import { db } from "../guest/sqlite";
import { DEFAULT_TEXT_MODEL_ID } from "../models";
import type { Campaign, CampaignSummary } from "./types";

function database() {
  const d = db();
  d.exec("CREATE TABLE IF NOT EXISTS campaigns (id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at INTEGER NOT NULL)");
  return d;
}
export function getCampaign(id: string): Campaign {
  const row = database().prepare("SELECT data FROM campaigns WHERE id = ?").get(id) as { data: string } | undefined;
  if (!row) throw new Error("Campaign not found.");
  const c = JSON.parse(row.data) as Campaign;
  c.memory ??= memorySchema.parse({}); c.budget ??= budgetSchema.parse({});
  c.memoryHistory ??= []; c.trends ??= []; c.posts ??= []; c.directors ??= [];
  return c;
}
export function saveCampaign(campaign: Campaign): Campaign {
  campaign.updatedAt = Date.now();
  database().prepare("INSERT INTO campaigns (id, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at")
    .run(campaign.id, JSON.stringify(campaign), campaign.updatedAt);
  return campaign;
}
export function createCampaign(defaults?: Pick<Campaign, "model" | "imageModel" | "imageProvider">): Campaign {
  return saveCampaign({ id: randomUUID(), title: "Untitled campaign", createdAt: Date.now(), updatedAt: Date.now(), messages: [], assets: [], runs: [], referenceUrls: [], model: DEFAULT_TEXT_MODEL_ID, imageModel: "nano-banana-2", videoModel: "kling-3.0", imageProvider: "kie", ...defaults });
}
export function listCampaigns(): CampaignSummary[] {
  const rows = database().prepare("SELECT data FROM campaigns ORDER BY updated_at DESC").all() as { data: string }[];
  return rows.map(({ data }) => {
    const c: Campaign = JSON.parse(data);
    return { id: c.id, title: c.title, updatedAt: c.updatedAt, assetCount: c.assets.length, running: !!c.directors?.some(d => d.status === "running" || d.jobs.some(j => j.status === "running")) || !!c.planning || c.runs.some(r => r.status === "running" || (r.status === "paused" && r.steps.some(s => s.status === "running" || s.status === "submitting"))) };
  });
}
