import { DEFAULT_TEXT_MODEL_ID } from "../models";

export const CODEX_CHAT_MODEL = "codex-account";
export type CampaignImageProvider = "codex" | "kie";
export interface AccountCapabilities {
  chatReady: boolean;
  imageReady: boolean;
  installed: boolean;
  authFound: boolean;
  ready: boolean;
}
export function campaignDefaults(account: Pick<AccountCapabilities, "chatReady" | "imageReady">) {
  return {
    model: account.chatReady ? CODEX_CHAT_MODEL : DEFAULT_TEXT_MODEL_ID,
    imageModel: account.imageReady ? "gpt-image-2" : "nano-banana-2",
    imageProvider: (account.imageReady ? "codex" : "kie") as CampaignImageProvider,
  };
}
