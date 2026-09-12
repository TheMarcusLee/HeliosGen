import { DEFAULT_TEXT_MODEL_ID } from "../models";

export const CODEX_CHAT_MODEL = "codex-account";
export const ANTIGRAVITY_CHAT_MODEL = "antigravity-account";
/** Connected accounts that can reason, inspect images, search the web, and (natively) generate images. */
export type AccountProvider = "codex" | "antigravity";
export type CampaignImageProvider = "codex" | "antigravity" | "kie";
export const ACCOUNT_IMAGE_MODEL: Record<AccountProvider, string> = { codex: "gpt-image-2", antigravity: "nano-banana-pro" };
export interface AccountCapabilities {
  chatReady: boolean;
  imageReady: boolean;
  installed: boolean;
  authFound: boolean;
  ready: boolean;
}
export interface ConnectedAccounts { codex: Pick<AccountCapabilities, "chatReady" | "imageReady">; antigravity?: Pick<AccountCapabilities, "chatReady" | "imageReady"> }
const none = { chatReady: false, imageReady: false };
/** Prefer the OpenAI account when it is connected, then the Google account, then API routes. */
export function campaignDefaults(codex: Pick<AccountCapabilities, "chatReady" | "imageReady">, antigravity: Pick<AccountCapabilities, "chatReady" | "imageReady"> = none) {
  const chat = codex.chatReady ? CODEX_CHAT_MODEL : antigravity.chatReady ? ANTIGRAVITY_CHAT_MODEL : DEFAULT_TEXT_MODEL_ID;
  const imageProvider: CampaignImageProvider = codex.imageReady ? "codex" : antigravity.imageReady ? "antigravity" : "kie";
  return { model: chat, imageModel: imageProvider === "kie" ? "nano-banana-2" : ACCOUNT_IMAGE_MODEL[imageProvider], imageProvider };
}
