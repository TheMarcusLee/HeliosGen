import { NextRequest, NextResponse } from "next/server";
import { deletePrompt, importPrompts, libraryStats, listPrompts, savePrompt, setFavorite } from "@/lib/promptLibrary";

/** The local prompt library: list/search, upload (JSON), save, favorite, delete. */
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const result = listPrompts({ query: p.get("q") ?? undefined, category: p.get("category") ?? undefined, favorites: p.get("favorites") === "1", limit: Number(p.get("limit") ?? 60), offset: Number(p.get("offset") ?? 0) });
  return NextResponse.json({ ...result, stats: libraryStats() });
}
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (body && typeof body === "object" && "import" in body) return NextResponse.json({ ...importPrompts(body.import), stats: libraryStats() });
    if (!body || typeof body.prompt !== "string" || !body.prompt.trim()) return NextResponse.json({ error: "prompt is required" }, { status: 400 });
    if (body.prompt.length > 20000) return NextResponse.json({ error: "Prompt is too long (20,000 characters max)." }, { status: 400 });
    const saved = savePrompt({ id: typeof body.id === "string" ? body.id : undefined, title: typeof body.title === "string" ? body.title.slice(0, 200) : null, prompt: body.prompt, categories: Array.isArray(body.categories) ? body.categories.filter((c: unknown) => typeof c === "string").slice(0, 20) : [], imageUrls: Array.isArray(body.imageUrls) ? body.imageUrls.filter((u: unknown) => typeof u === "string").slice(0, 8) : [], source: typeof body.source === "string" ? body.source : null, favorite: body.favorite === true, analysis: body.analysis ?? null, structured: body.structured ?? null, prose: typeof body.prose === "string" ? body.prose : null, negatives: typeof body.negatives === "string" ? body.negatives : null, origin: body.origin === "built" ? "built" : "user" });
    return NextResponse.json({ prompt: saved });
  } catch (error) { return NextResponse.json({ error: (error as Error).message }, { status: 400 }); }
}
export async function PATCH(req: NextRequest) {
  const body = await req.json();
  if (typeof body?.id !== "string") return NextResponse.json({ error: "id is required" }, { status: 400 });
  if (typeof body.favorite === "boolean") setFavorite(body.id, body.favorite);
  return NextResponse.json({ ok: true });
}
export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  deletePrompt(id);
  return NextResponse.json({ ok: true });
}
