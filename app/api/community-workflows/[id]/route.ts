import { NextResponse } from "next/server";

const URL = "https://nodebananapro.com/api/public/community-workflows";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!id || id.length > 180) return NextResponse.json({ success: false, error: "Invalid workflow ID." }, { status: 400 });
  const response = await fetch(`${URL}/${encodeURIComponent(id)}`, { headers: { Accept: "application/json" }, next: { revalidate: 60 } });
  if (!response.ok) return NextResponse.json({ success: false, error: "Unable to get a workflow download URL." }, { status: response.status });
  return NextResponse.json(await response.json());
}
