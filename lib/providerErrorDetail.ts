/**
 * Diagnostic detail for a failed generation, shown behind a "More info" toggle.
 *
 * Every provider settles a failed job with a short `error` line meant for the
 * step list. That line is deliberately terse (cleanCodexError trims
 * "Responses stream ended without an image result; last status was failed." to
 * its first clause), which leaves the user with no way to tell a policy
 * refusal from a rate limit from a dropped connection. `detail` keeps the full
 * context: which provider and model ran, how many references were attached,
 * a plain-language reading of the known failure signatures, and the raw
 * provider output with local paths scrubbed.
 */
export interface ProviderErrorContext {
  provider: string; model?: string; size?: string; references?: number; exitCode?: number; taskId?: string;
  /** The short error line the user sees. */
  message: string;
  /** Raw stderr / provider payload. */
  raw?: string;
}

const explanations: [RegExp, string][] = [
  [/stream ended without an image result/i, "OpenAI's Responses stream closed before the image tool returned an image; the final item status was \"failed\" with no reason attached. This is how the account image path reports a silent refusal or an upstream drop: the prompt or a reference image tripped OpenAI's image policy, or the connection was cut mid-generation. A retry often succeeds. If the same brief fails repeatedly, soften wardrobe, pose or body language in the prompt, or switch this campaign's image provider to Kie.ai."],
  [/429|rate limit|too many requests/i, "The account is being rate limited. Wait a minute and retry. Parallel steps count against the same limit, so a busy plan can trip it on its own."],
  [/safety|moderation|content policy|flagged|rejected/i, "The provider's content filter rejected the request. Adjust the prompt or references, or use a model with a more permissive filter."],
  [/not installed|spawn failed|ENOENT|not on PATH/i, "The provider's command-line tool is not installed, or not on the server's PATH. Install it and restart the app."],
  [/not signed in|unauthenticated|authentication|login/i, "The account session has expired. Sign in again from a terminal and retry."],
  [/timed out|timeout|exceeded one hour/i, "The provider did not finish in time. The job may still complete on the provider's side, so check its ledger before resubmitting."],
  [/usage limit|quota|capacity/i, "The account's subscription usage limit was reached. Retry later or choose another provider."],
];

/** Plain-language reading of a known failure signature, if there is one. */
export function explainProviderError(message: string): string | undefined {
  return explanations.find(([pattern]) => pattern.test(message))?.[1];
}

/** Replace temp and home paths so the detail is readable and does not leak the server's layout. */
export function scrubPaths(text: string): string {
  return text
    .replace(/\/(?:private\/)?(?:var\/folders|tmp)\/[^\s'"`]+/g, "<tmp>")
    .replace(/\/(?:Users|home)\/[^/\s]+/g, "~");
}

export function providerErrorDetail(input: ProviderErrorContext): string {
  const lines = [`Provider: ${input.provider}`];
  if (input.model) lines.push(`Model: ${input.model}`);
  if (input.size) lines.push(`Size: ${input.size}`);
  if (input.references !== undefined) lines.push(`Reference images: ${input.references}`);
  if (input.taskId) lines.push(`Task: ${input.taskId}`);
  if (input.exitCode !== undefined) lines.push(`Exit code: ${input.exitCode}`);
  const hint = explainProviderError(input.message);
  if (hint) lines.push("", hint);
  const raw = input.raw ? scrubPaths(input.raw).trim() : "";
  if (raw && raw !== input.message.trim()) lines.push("", "Provider output:", raw.slice(-2500));
  return lines.join("\n");
}
