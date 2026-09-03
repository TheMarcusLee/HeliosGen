import { NextRequest, NextResponse } from "next/server";
import {
  getAzureApiKey,
  setAzureApiKey,
  deleteAzureApiKey,
} from "@/lib/guest/db";

export async function GET() {
  return NextResponse.json({ hasToken: !!getAzureApiKey() });
}

export async function POST(req: NextRequest) {
  const { azureApiKey } = await req.json();
  if (typeof azureApiKey !== "string" || !azureApiKey.trim()) {
    return NextResponse.json({ error: "azureApiKey is required" }, { status: 400 });
  }
  setAzureApiKey(azureApiKey.trim());
  return NextResponse.json({ ok: true });
}

export async function DELETE() {
  deleteAzureApiKey();
  return NextResponse.json({ ok: true });
}
