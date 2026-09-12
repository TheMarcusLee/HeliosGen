import { getCodexAccountStatus } from "@/lib/codexAccount";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() { return Response.json(await getCodexAccountStatus()); }
