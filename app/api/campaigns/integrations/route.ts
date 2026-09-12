import { z } from "zod";
import { integrationKey, saveIntegrationKey, socialAccounts } from "@/lib/campaigns/integrations";
import { db } from "@/lib/guest/sqlite";
import { tiktokBrowserStatus } from "@/lib/campaigns/discovery/tiktokSession";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  try {
    const row = db().prepare("SELECT value FROM settings WHERE key='campaign_worker_heartbeat'").get() as { value: string } | undefined;
    return Response.json({ tiktok: tiktokBrowserStatus(), youtube: !!integrationKey("youtube"), postbridge: !!integrationKey("postbridge"), workerHeartbeat: Number(row?.value ?? 0), workerActive: Date.now() - Number(row?.value ?? 0) < 30000, ...(new URL(req.url).searchParams.has("accounts") ? { accounts: await socialAccounts() } : {}) });
  } catch (e) { return Response.json({ error: (e as Error).message }, { status: 400 }); }
}
export async function POST(req: Request) {
  try {
    const { name, key } = z.object({ name: z.enum(["youtube", "postbridge"]), key: z.string().trim().max(2000) }).parse(await req.json());
    saveIntegrationKey(name, key); return Response.json({ ok: true });
  } catch (e) { return Response.json({ error: (e as Error).message }, { status: 400 }); }
}
