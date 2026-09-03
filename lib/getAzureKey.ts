import { getAzureApiKey } from "./guest/db";

/**
 * The user's Azure OpenAI API key, saved locally via Settings → API Keys.
 * Arguments are ignored — kept so existing call sites don't need to change.
 */
export async function getAzureKeyForUser(..._args: unknown[]): Promise<string | null> {
  return getAzureApiKey();
}

export async function getAzureToken(..._args: unknown[]): Promise<string | null> {
  return getAzureApiKey();
}
