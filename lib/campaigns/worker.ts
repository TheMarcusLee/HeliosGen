import { advanceDirector } from "./director/engine";
import { listCampaigns } from "./db";
import { advanceCampaign } from "./service";
import { advancePublishing } from "./publishing";
import { db } from "../guest/sqlite";
const state = globalThis as typeof globalThis & { campaignWorkerTimer?: ReturnType<typeof setTimeout>; campaignHeartbeatTimer?: ReturnType<typeof setInterval> };
function heartbeat() {
  db().prepare("INSERT INTO settings(key,value) VALUES ('campaign_worker_heartbeat',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(String(Date.now()));
}
async function bounded(work: Promise<unknown>) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { await Promise.race([work, new Promise<void>(resolve => { timer = setTimeout(resolve, 30000); timer.unref(); })]); }
  finally { if (timer) clearTimeout(timer); }
  // A slow operation retains its own renewable lease. Other campaigns keep
  // advancing, and subsequent ticks cannot duplicate its provider submission.
}
export async function workerTick() {
  const campaigns = listCampaigns();
  for (let index = 0; index < campaigns.length; index += 4) {
    await Promise.allSettled(campaigns.slice(index, index + 4).map(async c => {
      if (c.running) { await bounded(advanceDirector(c.id)); await bounded(advanceCampaign(c.id)); }
      await bounded(advancePublishing(c.id));
    }));
  }
  heartbeat();
}
export function startCampaignWorker() {
  if (state.campaignWorkerTimer || process.env.HELIOS_DISABLE_CAMPAIGN_WORKER === "1") return;
  state.campaignHeartbeatTimer = setInterval(heartbeat, 10000);
  state.campaignHeartbeatTimer.unref();
  async function tick() {
    try { await workerTick(); } catch { console.error("[campaign-worker] Tick failed; retrying in 3 seconds."); }
    state.campaignWorkerTimer = setTimeout(tick, 3000);
    state.campaignWorkerTimer.unref();
  }
  state.campaignWorkerTimer = setTimeout(tick, 1000);
  state.campaignWorkerTimer.unref();
}
