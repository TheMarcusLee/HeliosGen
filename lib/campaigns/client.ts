"use client";
import { create } from "zustand";
import type { Campaign, CampaignSummary } from "./types";

export async function campaignRequest(path: string, body?: unknown) {
  const response = await fetch(`/api/campaigns${path}`, body === undefined ? { cache: "no-store" } : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Unable to load campaign.");
  return data;
}
export type CreativeMode = "plan" | "director";
interface CampaignState {
  drafts: Record<string, string>;
  setDraft: (id: string, text: string) => void;
  /** Composer mode per campaign ("" is the unsaved new campaign). Survives remounts and navigation. */
  modes: Record<string, CreativeMode>;
  setMode: (id: string, mode: CreativeMode) => void;
  campaigns: CampaignSummary[];
  records: Record<string, Campaign>;
  setCampaign: (c: Campaign) => void;
  refresh: () => Promise<void>;
}
export const useCampaignStore = create<CampaignState>((set) => ({
  campaigns: [], records: {}, drafts: {}, modes: {},
  setDraft: (id, text) => set(s => ({ drafts: { ...s.drafts, [id]: text } })),
  setMode: (id, mode) => set(s => ({ modes: { ...s.modes, [id]: mode } })),
  setCampaign: c => set(s => {
    if (s.records[c.id]?.updatedAt > c.updatedAt) return s;
    const summary: CampaignSummary = { id: c.id, title: c.title, updatedAt: c.updatedAt, assetCount: c.assets.length, running: !!c.directors?.some(d => d.status === "running" || d.jobs.some(j => j.status === "running")) || !!c.planning || c.runs.some(r => r.status === "running" || (r.status === "paused" && r.steps.some(s => s.status === "running" || s.status === "submitting"))) };
    return { records: { ...s.records, [c.id]: c }, campaigns: [summary, ...s.campaigns.filter(item => item.id !== c.id)].sort((a, b) => b.updatedAt - a.updatedAt) };
  }),
  refresh: async () => {
    const { campaigns } = await campaignRequest("");
    set({ campaigns });
  },
}));
