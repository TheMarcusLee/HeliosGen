"use client";
import { useEffect } from "react";
import { campaignRequest, useCampaignStore } from "@/lib/campaigns/client";

/** Read-only UI synchronization. Production is driven by the server worker. */
export function CampaignMonitor() {
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    async function tick() {
      try {
        await useCampaignStore.getState().refresh();
        const { campaigns, records } = useCampaignStore.getState();
        const ids = new Set([...campaigns.filter(c => c.running || (records[c.id] && c.updatedAt > records[c.id].updatedAt)).map(c => c.id), ...Object.values(records).filter(c => c.runs.some(r => r.status === "paused" && r.steps.some(s => s.status === "running"))).map(c => c.id)]);
        await Promise.allSettled([...ids].map(async id => {
          const { campaign } = await campaignRequest(`/${id}`);
          if (!disposed) useCampaignStore.getState().setCampaign(campaign);
        }));
      } catch { /* A disconnected server is retried; no paid job is resubmitted. */ }
      if (!disposed) timer = setTimeout(tick, 3000);
    }
    void tick();
    return () => { disposed = true; clearTimeout(timer); };
  }, []);
  return null;
}
