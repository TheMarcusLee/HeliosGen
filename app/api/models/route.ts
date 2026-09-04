import { NextResponse } from "next/server";
import { IMAGE_MODELS, VIDEO_MODELS } from "@/lib/modelConfig";
import { MODEL_GROUPS } from "@/lib/models";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    text: MODEL_GROUPS.map((group) => ({
      provider: group.label,
      models: group.models.map(({ id, label, desc, transport }) => ({ id, label, desc, transport })),
    })),
    image: IMAGE_MODELS,
    video: VIDEO_MODELS,
  });
}
