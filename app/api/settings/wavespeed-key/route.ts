import { NextRequest, NextResponse } from "next/server";
import {
  deleteWaveSpeedApiKey,
  getWaveSpeedApiKey,
  setWaveSpeedApiKey,
} from "@/lib/guest/db";
import { clearWaveSpeedModelCache } from "@/lib/wavespeed";

export async function GET() {
  return NextResponse.json({ hasToken: !!getWaveSpeedApiKey() });
}

export async function POST(req: NextRequest) {
  const { waveSpeedApiKey } = await req.json();
  if (typeof waveSpeedApiKey !== "string" || !waveSpeedApiKey.trim()) {
    return NextResponse.json({ error: "waveSpeedApiKey is required" }, { status: 400 });
  }
  setWaveSpeedApiKey(waveSpeedApiKey.trim());
  clearWaveSpeedModelCache();
  return NextResponse.json({ ok: true });
}

export async function DELETE() {
  deleteWaveSpeedApiKey();
  clearWaveSpeedModelCache();
  return NextResponse.json({ ok: true });
}
