import { NextRequest, NextResponse } from "next/server";
import { deleteIdentityAsset, getIdentityAsset, listIdentityVersions, updateIdentityAsset } from "@/lib/guest/identityAssets";
import { normalizeIdentityDefaults, type IdentityReference } from "@/lib/cloneMe";

export const runtime = "nodejs";

function clean(body: Record<string, unknown>) {
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

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const identity = getIdentityAsset(id);
  if (!identity) return NextResponse.json({ error: "Identity asset not found." }, { status: 404 });
  return NextResponse.json({ identity, versions: listIdentityVersions(id) });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    return NextResponse.json({ identity: updateIdentityAsset(id, clean(await req.json() as Record<string, unknown>)) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to update identity asset.";
    return NextResponse.json({ error: message }, { status: message.includes("not found") ? 404 : 400 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!deleteIdentityAsset(id)) return NextResponse.json({ error: "Identity asset not found." }, { status: 404 });
  return NextResponse.json({ deleted: true, id });
}
