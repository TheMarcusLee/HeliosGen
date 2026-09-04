type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord | undefined {
  return value !== null && typeof value === "object" ? value as UnknownRecord : undefined;
}

/** Extract one visible text delta from any assistant transport used by HeliosGen. */
export function extractAssistantTextDelta(event: unknown): string | null {
  const root = record(event);
  if (!root) return null;

  const delta = record(root.delta);
  if (root.type === "content_block_delta" && typeof delta?.text === "string") return delta.text;
  if (root.type === "response.output_text.delta" && typeof root.delta === "string") return root.delta;

  const choices = Array.isArray(root.choices) ? root.choices : [];
  const firstChoice = record(choices[0]);
  const choiceDelta = record(firstChoice?.delta);
  if (typeof choiceDelta?.content === "string") return choiceDelta.content;

  // Native Gemini chunks are accepted as a defensive fallback.
  const candidates = Array.isArray(root.candidates) ? root.candidates : [];
  const candidate = record(candidates[0]);
  const content = record(candidate?.content);
  const parts = Array.isArray(content?.parts) ? content.parts : [];
  const text = parts.map((part) => record(part)?.text).find((part): part is string => typeof part === "string");
  return text ?? null;
}
