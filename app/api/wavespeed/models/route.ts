import { NextRequest, NextResponse } from "next/server";
import { listWaveSpeedModels, WaveSpeedApiError } from "@/lib/wavespeed";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const query = (req.nextUrl.searchParams.get("query") ?? "").trim().toLowerCase();
    const modelId = (req.nextUrl.searchParams.get("modelId") ?? "").trim();
    const type = (req.nextUrl.searchParams.get("type") ?? "").trim().toLowerCase();
    const includeSchema = req.nextUrl.searchParams.get("includeSchema") === "true";
    const offset = Math.max(0, Number.parseInt(req.nextUrl.searchParams.get("offset") ?? "0", 10) || 0);
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.nextUrl.searchParams.get("limit") ?? "25", 10) || 25));
    const all = await listWaveSpeedModels({ forceRefresh: req.nextUrl.searchParams.get("refresh") === "true" });

    if (modelId) {
      const model = all.find((candidate) => candidate.modelId === modelId);
      if (!model) return NextResponse.json({ error: `WaveSpeed model not found: ${modelId}` }, { status: 404 });
      return NextResponse.json({ model });
    }

    const filtered = all.filter((model) => {
      if (type && model.type.toLowerCase() !== type) return false;
      if (!query) return true;
      return `${model.modelId} ${model.name} ${model.description} ${model.type}`.toLowerCase().includes(query);
    });
    const models = filtered.slice(offset, offset + limit).map((model) => includeSchema
      ? model
      : { modelId: model.modelId, name: model.name, description: model.description, type: model.type, basePrice: model.basePrice });
    const nextOffset = offset + models.length;
    return NextResponse.json({
      total: filtered.length,
      count: models.length,
      offset,
      limit,
      models,
      hasMore: nextOffset < filtered.length,
      ...(nextOffset < filtered.length ? { nextOffset } : {}),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to list WaveSpeed models.";
    const status = error instanceof WaveSpeedApiError && error.httpStatus === 401
      ? 401
      : message.includes("not configured") ? 401 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
