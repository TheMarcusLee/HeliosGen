import { NextResponse } from "next/server";

const URL = "https://nodebananapro.com/api/public/community-workflows";

export async function GET() {
  const response = await fetch(URL, { headers: { Accept: "application/json" }, next: { revalidate: 300 } });
  if (!response.ok) return NextResponse.json({ success: false, error: "Unable to load the Node Banana community catalog." }, { status: response.status });
  return NextResponse.json(await response.json());
}
