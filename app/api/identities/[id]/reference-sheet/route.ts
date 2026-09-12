import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { POST as generateImage } from "@/app/api/generate/route";
import { getIdentityAsset } from "@/lib/guest/identityAssets";
import { referenceSheetPrompt, referenceStyle } from "@/lib/referenceSheets";
import { IMAGE_MODELS } from "@/lib/modelConfig";
import { ACCOUNT_IMAGE_MODEL } from "@/lib/campaigns/providers";
import { accountStatus } from "@/lib/campaigns/agents";

const schema = z.object({ style: z.string(), provider: z.enum(["kie", "codex", "antigravity"]).default("kie"), model: z.string().optional() });
/** Submit a reference-sheet generation for an identity; the client polls the job and files the result as a reference. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const identity = getIdentityAsset(id);
    if (!identity) return NextResponse.json({ error: "Identity not found." }, { status: 404 });
    const input = schema.parse(await req.json());
    const style = referenceStyle(input.style);
    if (!style) return NextResponse.json({ error: "Unknown reference style." }, { status: 400 });
    const modelId = input.provider === "kie" ? input.model ?? identity.defaults.modelId ?? "nano-banana-pro" : ACCOUNT_IMAGE_MODEL[input.provider];
    const model = IMAGE_MODELS.find(m => m.id === modelId && m.supportsImages);
    if (!model) return NextResponse.json({ error: "Choose a reference-capable image model." }, { status: 400 });
    if (input.provider !== "kie" && !(await accountStatus(input.provider)).imageReady) return NextResponse.json({ error: `${input.provider === "codex" ? "OpenAI" : "Google"} account image generation is unavailable.` }, { status: 400 });
    const aspectRatio = model.ratios.includes(style.aspectRatio) ? style.aspectRatio : ["3:4", "9:16", "1:1", "4:3", "16:9"].find(r => model.ratios.includes(r)) ?? model.ratios[0];
    const prompt = referenceSheetPrompt(identity, style);
    const body = { model: model.id, prompt, aspectRatio, imageUrls: identity.references.map(r => r.url).slice(0, model.maxImages ?? 3), codexProvider: input.provider === "codex", antigravityProvider: input.provider === "antigravity", identityAssetId: identity.id, workflowId: `identity-${identity.id}`, nodeId: randomUUID(), workflowMetadata: { contentClass: identity.defaults.contentClass ?? "sfw", routes: {} } };
    const response = await generateImage(new NextRequest("http://localhost/api/generate", { method: "POST", body: JSON.stringify(body) }));
    const result = await response.json();
    if (!response.ok || !result.taskId) return NextResponse.json({ error: result.error || "The provider returned no job ID." }, { status: 502 });
    return NextResponse.json({ taskId: result.taskId, prompt, kind: style.kind, label: style.label, model: model.id, aspectRatio });
  } catch (error) { return NextResponse.json({ error: error instanceof z.ZodError ? "Invalid request." : (error as Error).message }, { status: 400 }); }
}
