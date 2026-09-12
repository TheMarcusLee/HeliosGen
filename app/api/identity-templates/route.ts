import { NextRequest, NextResponse } from "next/server";
import { deleteTemplate, importTemplates, listTemplates, templateCategories, materializeTemplate } from "@/lib/identityTemplates";

/** Starter influencer templates: list, upload (JSON), use one as an identity, delete. */
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  return NextResponse.json({ templates: listTemplates({ category: p.get("category") ?? undefined, gender: p.get("gender") ?? undefined, query: p.get("q") ?? undefined }), categories: templateCategories() });
}
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (body && typeof body === "object" && "import" in body) return NextResponse.json({ ...importTemplates(body.import), categories: templateCategories() });
    if (body && typeof body.use === "string") return NextResponse.json({ identity: await materializeTemplate(body.use) });
    return NextResponse.json({ error: "Send { import: [...] } or { use: id }." }, { status: 400 });
  } catch (error) { return NextResponse.json({ error: (error as Error).message }, { status: 400 }); }
}
export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  deleteTemplate(id);
  return NextResponse.json({ ok: true });
}
