import { getKieApiToken } from "./guest/db";

/**
 * The user's kie.ai API key, saved locally via Settings → API Keys.
 * Arguments are ignored — kept so existing call sites don't need to change.
 */
export async function getKieTokenForUser(..._args: unknown[]): Promise<string | null> {
  return getKieApiToken();
}

export async function getKieToken(..._args: unknown[]): Promise<string | null> {
  return getKieApiToken();
}
