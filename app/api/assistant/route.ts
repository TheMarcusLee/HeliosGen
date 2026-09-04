export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { getKieToken } from "@/lib/getKieToken";
import { getAzureToken } from "@/lib/getAzureKey";
import { DEFAULT_TEXT_MODEL_ID, getTextModel } from "@/lib/models";
import { ensureKieReachableImages, localMediaToDataUrl } from "@/lib/kieUpload";

interface Message {
  role: "user" | "assistant" | "system";
  content: string;
}

const AZURE_API_VERSION = "2024-04-01-preview";

export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    messages?: Message[];
    prompt?: string;
    systemPrompt?: string;
    model?: string;
    azureEndpoint?: string;
    azureDeployment?: string;
    azureModelName?: string;
    imageUrls?: string[];
  };

  const model = body.model ?? DEFAULT_TEXT_MODEL_ID;
  const imageUrls = Array.isArray(body.imageUrls)
    ? body.imageUrls.filter((url): url is string => typeof url === "string" && (
      /^https?:\/\//i.test(url) || url.startsWith("/generated/") || url.startsWith("data:image/")
    )).slice(0, 8)
    : [];
  const modelConfig = getTextModel(model);
  if (!modelConfig) {
    return Response.json({ error: `Unknown text model: ${model}` }, { status: 400 });
  }

  let messages: Message[];

  if (body.messages && body.messages.length > 0) {
    messages = body.messages;
  } else if (body.prompt?.trim()) {
    messages = [];
    if (body.systemPrompt?.trim()) {
      messages.push({ role: "user", content: body.systemPrompt.trim() });
      messages.push({ role: "assistant", content: "Understood." });
    }
    messages.push({ role: "user", content: body.prompt.trim() });
  } else {
    return new Response(JSON.stringify({ error: "messages or prompt is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const makeOpenAiMessages = (resolvedImageUrls: string[]) => messages.map((message, index) => ({
    role: message.role,
    content: index === messages.length - 1 && message.role === "user" && resolvedImageUrls.length
      ? [{ type: "text", text: message.content }, ...resolvedImageUrls.map((url) => ({ type: "image_url", image_url: { url } }))]
      : [{ type: "text", text: message.content }],
  }));

  // ── Azure Auto (model-router) ──────────────────────────────────────────────
  if (model === "azure-auto") {
    const azureKey = await getAzureToken(req);
    if (!azureKey) {
      return new Response(
        JSON.stringify({ error: "No Azure API key configured. Add one in Settings." }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    }
    // Normalise: strip trailing slashes and any /openai suffix users may have pasted
    const endpoint = (body.azureEndpoint ?? "")
      .trim()
      .replace(/\/+$/, "")
      .replace(/\/openai$/i, "");
    const deployment  = (body.azureDeployment || "auto-model").trim();
    const modelName   = (body.azureModelName  || "model-router").trim();
    if (!endpoint) {
      return new Response(
        JSON.stringify({ error: "Azure base URL not configured. Add it in Settings → API Keys." }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }
    let resolvedImageUrls: string[];
    try {
      resolvedImageUrls = await Promise.all(imageUrls.map((url) => (
        url.startsWith("/generated/") || url.startsWith("data:") ? localMediaToDataUrl(url) : url
      )));
    } catch (error) {
      return Response.json({ error: `Couldn't read a connected image: ${(error as Error).message}` }, { status: 400 });
    }
    const url = `${endpoint}/openai/deployments/${deployment}/chat/completions?api-version=${AZURE_API_VERSION}`;
    console.log("[azure-auto] POST", url.replace(/api-version=.*/, "api-version=…"));
    const upstream = await fetch(url, {
      method: "POST",
      cache: "no-store",
      headers: { "api-key": azureKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: modelName,
        messages: makeOpenAiMessages(resolvedImageUrls),
        stream: true,
        max_tokens: 8192,
        temperature: 0.7,
        top_p: 0.95,
        frequency_penalty: 0,
        presence_penalty: 0,
      }),
    });
    if (!upstream.ok) {
      const errText = await upstream.text();
      // Extract human-readable message from Azure error envelope
      let errorMsg = errText;
      try {
        const parsed = JSON.parse(errText);
        errorMsg = parsed?.error?.message ?? parsed?.message ?? errText;
      } catch { /* use raw text */ }
      console.error("[azure-auto] upstream error", upstream.status, errorMsg);
      return new Response(
        JSON.stringify({ error: `Azure ${upstream.status}: ${errorMsg}` }),
        { status: upstream.status, headers: { "Content-Type": "application/json" } }
      );
    }
    return new Response(upstream.body, {
      headers: {
        "Content-Type":      "text/event-stream",
        "Cache-Control":     "no-cache, no-transform",
        "Connection":        "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  }

  // ── Kie.ai models ─────────────────────────────────────────────────────────
  const apiKey = await getKieToken(req);
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: "No Kie.ai API key configured. Add one in Settings." }),
      { status: 401, headers: { "Content-Type": "application/json" } }
    );
  }

  let resolvedImageUrls: string[];
  try {
    resolvedImageUrls = await ensureKieReachableImages(imageUrls, apiKey);
  } catch (error) {
    return Response.json({ error: `Couldn't prepare a connected image for vision analysis: ${(error as Error).message}` }, { status: 400 });
  }
  const openAiMessages = makeOpenAiMessages(resolvedImageUrls);

  let upstream: Response;
  if (modelConfig.transport === "chat-completions") {
    upstream = await fetch(modelConfig.endpoint!, {
        method: "POST",
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages: openAiMessages,
          stream: true,
        }),
      });
  } else if (modelConfig.transport === "responses") {
    upstream = await fetch(modelConfig.endpoint!, {
      method: "POST",
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        stream: true,
          input: messages.map((message, index) => ({
          role: message.role === "system" ? "developer" : message.role,
          content: [{ type: "input_text", text: message.content }, ...(index === messages.length - 1 && message.role === "user" ? resolvedImageUrls.map((imageUrl) => ({ type: "input_image", image_url: imageUrl })) : [])],
        })),
        reasoning: { effort: "high" },
      }),
    });
  } else {
    upstream = await fetch("https://api.kie.ai/claude/v1/messages", {
        method: "POST",
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages: messages.map((message, index) => ({
            role: message.role,
            content: index === messages.length - 1 && message.role === "user" && resolvedImageUrls.length
              ? [{ type: "text", text: message.content }, ...resolvedImageUrls.map((url) => ({ type: "image", source: { type: "url", url } }))]
              : message.content,
          })),
          stream: true,
          thinkingFlag: true,
          max_tokens: 8192,
        }),
      });
  }

  if (!upstream.ok) {
    const errText = await upstream.text();
    return new Response(JSON.stringify({ error: errText }), {
      status: upstream.status,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(upstream.body, {
    headers: {
      "Content-Type":       "text/event-stream",
      "Cache-Control":      "no-cache, no-transform",
      "Connection":         "keep-alive",
      "X-Accel-Buffering":  "no",
    },
  });
}
