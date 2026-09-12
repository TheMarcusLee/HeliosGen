import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { accountAsk, buildPrompt, enhanceForModel, resolveProvider } from "@/lib/promptEngineering";
import { storeMedia } from "@/lib/campaigns/director/download";

export const maxDuration = 600;
const schema = z.object({
  mode: z.enum(["describe", "image", "enhance", "remix"]),
  description: z.string().max(4000).optional(), imageUrl: z.string().max(2000).optional(), text: z.string().max(20000).optional(),
  basePromptId: z.string().optional(), variation: z.string().max(4000).optional(), categories: z.array(z.string()).max(20).optional(),
  provider: z.enum(["codex", "antigravity"]).optional(),
  /** When set with mode "enhance", the output is shaped for this image model (structured JSON or prose). */
  model: z.string().optional(),
});
/** Build a prompt through the connected account: describe, from an image, enhance a rough prompt, or remix a library prompt. */
export async function POST(req: NextRequest) {
  try {
    const input = schema.parse(await req.json());
    const provider = await resolveProvider(input.provider), ask = accountAsk(provider);
    if (input.mode === "image" && input.imageUrl && !input.imageUrl.startsWith("/generated/")) {
      if (!/^https:\/\//.test(input.imageUrl)) throw new Error("Use an uploaded image or an HTTPS image URL.");
      input.imageUrl = await storeMedia(input.imageUrl, "prompt-library", "image");
    }
    const result = input.mode === "enhance" && input.model ? await enhanceForModel(input.text ?? "", input.model, ask) : await buildPrompt(input, ask);
    return NextResponse.json({ ...result, provider });
  } catch (error) { return NextResponse.json({ error: error instanceof z.ZodError ? "Invalid request." : (error as Error).message }, { status: 400 }); }
}
