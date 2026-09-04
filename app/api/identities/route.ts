import { NextRequest, NextResponse } from "next/server";
import { createIdentityAsset, listIdentityAssets } from "@/lib/guest/identityAssets";
import { normalizeIdentityDefaults, type IdentityReference } from "@/lib/cloneMe";

export const runtime = "nodejs";

function input(body: Record<string, unknown>) {
  return {
    name: typeof body.name === "string" ? body.name : "",
    triggerWord: typeof body.triggerWord === "string" ? body.triggerWord : "",
    basePrompts: Array.isArray(body.basePrompts) ? body.basePrompts.filter((value): value is string => typeof value === "string") : [],
    references: Array.isArray(body.references) ? body.references.filter((value): value is IdentityReference => {
      if (!value || typeof value !== "object") return false;
      const item = value as Partial<IdentityReference>;
      return typeof item.url === "string" && (item.kind === "face" || item.kind === "body");
    }) : [],
    defaults: normalizeIdentityDefaults(body.defaults),
  };
}

export async function GET() {
  return NextResponse.json({ identities: listIdentityAssets() });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as Record<string, unknown>;
    return NextResponse.json({ identity: createIdentityAsset(input(body)) }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to create identity asset." }, { status: 400 });
  }
}
