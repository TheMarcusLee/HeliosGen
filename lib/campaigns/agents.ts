import type { NextRequest } from "next/server";
import { codexPlanner } from "./codexPlanner";
import { agyPlanner } from "./agyPlanner";
import { getCodexAccountStatus } from "../codexAccount";
import { getAntigravityStatus } from "../antigravityAccount";
import { ANTIGRAVITY_CHAT_MODEL, CODEX_CHAT_MODEL, type AccountCapabilities, type AccountProvider, type CampaignImageProvider } from "./providers";

/** Which connected account reasons for this campaign. API-key chat models still use the Codex account for director work. */
export function agentProviderOf(c: { model: string }): AccountProvider {
  return c.model === ANTIGRAVITY_CHAT_MODEL ? "antigravity" : "codex";
}
export const isAccountChatModel = (model: string) => model === CODEX_CHAT_MODEL || model === ANTIGRAVITY_CHAT_MODEL;
export function accountLabel(provider: AccountProvider | CampaignImageProvider) {
  return provider === "antigravity" ? "Google account" : provider === "codex" ? "OpenAI account" : "Kie.ai";
}
export async function accountStatus(provider: AccountProvider | CampaignImageProvider): Promise<AccountCapabilities> {
  if (provider === "antigravity") return getAntigravityStatus();
  if (provider === "codex") return getCodexAccountStatus();
  return { chatReady: false, imageReady: false, installed: false, authFound: false, ready: false };
}
export type AccountPlanner = (req: NextRequest, options?: { webSearch?: boolean; maxImages?: number }) => Promise<Response>;
export function accountPlanner(provider: AccountProvider): AccountPlanner {
  return provider === "antigravity" ? agyPlanner : codexPlanner;
}
