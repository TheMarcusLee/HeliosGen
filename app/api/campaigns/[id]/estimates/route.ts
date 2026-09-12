import { NextRequest } from "next/server";
import { getCampaign } from "@/lib/campaigns/db";
import { serverCampaignEstimates } from "@/lib/campaigns/estimates";
import { PRICING_AS_OF } from "@/lib/pricing";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Resolved per-generation estimates for a campaign's current routes. Query params override the motion model and clip length. */
export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const c = getCampaign((await context.params).id), q = new URL(req.url).searchParams;
    const seconds = Number(q.get("seconds")); const motionModel = q.get("motionModel") || undefined;
    return Response.json({ ...serverCampaignEstimates({ ...c, motionModel: motionModel ?? c.motionModel }, Number.isFinite(seconds) && seconds > 0 ? { seconds, inputSeconds: seconds } : {}), asOf: PRICING_AS_OF });
  } catch { return Response.json({ error: "Campaign not found." }, { status: 404 }); }
}
