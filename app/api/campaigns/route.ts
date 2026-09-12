import { getCodexAccountStatus } from "@/lib/codexAccount";
import { getAntigravityStatus } from "@/lib/antigravityAccount";
import { campaignDefaults } from "@/lib/campaigns/providers";
import { createCampaign, listCampaigns } from "@/lib/campaigns/db";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() { return Response.json({ campaigns: listCampaigns() }); }
export async function POST() { return Response.json({ campaign: createCampaign(campaignDefaults(...await Promise.all([getCodexAccountStatus(), getAntigravityStatus()]))) }, { status: 201 }); }
