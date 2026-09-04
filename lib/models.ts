export type ModelTransport = "claude-messages" | "chat-completions" | "responses" | "azure";

export interface Model {
  id: string;
  label: string;
  desc: string;
  transport: ModelTransport;
  endpoint?: string;
}

export interface ModelGroup {
  label: string;
  models: Model[];
}

const KIE = "https://api.kie.ai";

export const DEFAULT_TEXT_MODEL_ID = "claude-sonnet-4-6";

export const MODEL_GROUPS: ModelGroup[] = [
  {
    label: "Anthropic",
    models: [
      { id: "claude-opus-5", label: "Opus 5", desc: "Flagship", transport: "claude-messages" },
      { id: "claude-sonnet-5", label: "Sonnet 5", desc: "Balanced", transport: "claude-messages" },
      // Retained so existing chats and imported workflows remain executable.
      { id: "claude-opus-4-7", label: "Opus 4.7", desc: "Legacy", transport: "claude-messages" },
      { id: "claude-sonnet-4-6", label: "Sonnet 4.6", desc: "Legacy", transport: "claude-messages" },
      { id: "claude-haiku-4-5", label: "Haiku 4.5", desc: "Fast", transport: "claude-messages" },
    ],
  },
  {
    label: "OpenAI",
    models: [
      { id: "gpt-5-6-sol", label: "GPT 5.6 Sol", desc: "Reliable", transport: "responses", endpoint: `${KIE}/codex/v1/responses` },
      { id: "gpt-5-6-terra", label: "GPT 5.6 Terra", desc: "Balanced", transport: "responses", endpoint: `${KIE}/codex/v1/responses` },
      { id: "gpt-5-6-luna", label: "GPT 5.6 Luna", desc: "Fast", transport: "responses", endpoint: `${KIE}/codex/v1/responses` },
      { id: "gpt-5-5", label: "GPT 5.5", desc: "Proven", transport: "responses", endpoint: `${KIE}/codex/v1/responses` },
      { id: "gpt-5-4", label: "GPT 5.4", desc: "Strong", transport: "responses", endpoint: `${KIE}/codex/v1/responses` },
      { id: "gpt-5-2", label: "GPT 5.2", desc: "Legacy", transport: "chat-completions", endpoint: `${KIE}/gpt-5-2/v1/chat/completions` },
    ],
  },
  {
    label: "Google",
    models: [
      { id: "gemini-3-8-flash", label: "Gemini 3.8 Flash", desc: "Newest", transport: "chat-completions", endpoint: `${KIE}/gemini-3-8-flash-openai/v1/chat/completions` },
      { id: "gemini-3-7-flash", label: "Gemini 3.7 Flash", desc: "Fast", transport: "chat-completions", endpoint: `${KIE}/gemini-3-7-flash-openai/v1/chat/completions` },
      { id: "gemini-3-6-flash", label: "Gemini 3.6 Flash", desc: "Fast", transport: "chat-completions", endpoint: `${KIE}/gemini-3-6-flash-openai/v1/chat/completions` },
      { id: "gemini-3-5-flash", label: "Gemini 3.5 Flash", desc: "Fast", transport: "chat-completions", endpoint: `${KIE}/gemini-3-5-flash-openai/v1/chat/completions` },
      { id: "gemini-3.1-pro", label: "Gemini 3.1 Pro", desc: "Pro", transport: "chat-completions", endpoint: `${KIE}/gemini-3.1-pro/v1/chat/completions` },
      { id: "gemini-3-flash", label: "Gemini 3 Flash", desc: "Legacy", transport: "chat-completions", endpoint: `${KIE}/gemini-3-flash/v1/chat/completions` },
    ],
  },
  {
    label: "Azure",
    models: [
      { id: "azure-auto", label: "Azure Auto", desc: "Router", transport: "azure" },
    ],
  },
];

export const MODELS: Model[] = MODEL_GROUPS.flatMap((group) => group.models);
export type ModelId = string;

export function getTextModel(id: string): Model | undefined {
  return MODELS.find((model) => model.id === id);
}
