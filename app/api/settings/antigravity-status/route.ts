import { getAntigravityStatus } from "@/lib/antigravityAccount";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(req: Request) { return Response.json(await getAntigravityStatus(new URL(req.url).searchParams.has("refresh"))); }
