import { NextRequest, NextResponse } from "next/server";
import { deleteComfyApiKey, getComfyApiKey, getComfyBaseUrl, setComfyApiKey, setComfyBaseUrl } from "@/lib/guest/db";

export async function GET() {
  return NextResponse.json({ hasApiKey: !!getComfyApiKey(), baseUrl: getComfyBaseUrl() ?? "http://127.0.0.1:8188" });
}

export async function POST(req: NextRequest) {
  const body = await req.json() as { apiKey?: string; baseUrl?: string };
  if (typeof body.baseUrl === "string" && body.baseUrl.trim()) {
    const url = new URL(body.baseUrl.trim());
    if (!(["http:", "https:"] as string[]).includes(url.protocol)) return NextResponse.json({ error: "Invalid ComfyUI URL." }, { status: 400 });
    setComfyBaseUrl(url.toString().replace(/\/$/, ""));
  }
  if (typeof body.apiKey === "string" && body.apiKey.trim()) setComfyApiKey(body.apiKey.trim());
  return GET();
}

export async function DELETE() {
  deleteComfyApiKey();
  return GET();
}
