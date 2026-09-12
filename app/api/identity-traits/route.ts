import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { parseTraits, traitsToPrompt, normalizeTraits } from "@/lib/identityTraits";
import { accountAsk, resolveProvider } from "@/lib/promptEngineering";

export const maxDuration = 300;
const schema = z.object({ description: z.string().trim().min(1).max(12000).optional(), traits: z.record(z.string(), z.string()).optional(), provider: z.enum(["codex", "antigravity"]).optional() });
/** Parse a description into discrete traits through the connected account, or compose a base prompt from traits. */
export async function POST(req: NextRequest) {
  try {
    const input = schema.parse(await req.json());
    if (input.description) {
      const provider = await resolveProvider(input.provider);
      const result = await parseTraits(input.description, (p) => accountAsk(provider)(p));
      return NextResponse.json({ ...result, prompt: traitsToPrompt(result.traits), provider });
    }
    const traits = normalizeTraits(input.traits ?? {});
    return NextResponse.json({ traits, prompt: traitsToPrompt(traits) });
  } catch (error) { return NextResponse.json({ error: error instanceof z.ZodError ? "Invalid request." : (error as Error).message }, { status: 400 }); }
}
