export type JsonObject = Record<string, unknown>;

export interface Workflow {
  id: string;
  name: string;
  nodes: JsonObject[];
  edges: JsonObject[];
  nodeCounters: Record<string, number>;
  createdAt: number;
  updatedAt?: number;
  viewport?: { x: number; y: number; zoom: number };
  metadata?: JsonObject;
}

export class HeliosClient {
  readonly baseUrl: string;
  private writeTail: Promise<void> = Promise.resolve();

  constructor(baseUrl = process.env.HELIOSGEN_BASE_URL ?? "http://127.0.0.1:3000") {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  async json<T>(path: string, init?: RequestInit): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, init);
    } catch (error) {
      throw new Error(`Cannot reach HeliosGen at ${this.baseUrl}. Start the app first. ${error instanceof Error ? error.message : String(error)}`);
    }
    const text = await response.text();
    let body: unknown = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = text; }
    if (!response.ok) {
      const detail = typeof body === "object" && body && "error" in body ? String((body as JsonObject).error) : text;
      throw new Error(`HeliosGen ${response.status}: ${detail || response.statusText}`);
    }
    return body as T;
  }

  async getWorkflows(): Promise<Workflow[]> {
    return (await this.json<{ spaces: Workflow[] }>("/api/workflows")).spaces;
  }

  async saveWorkflows(spaces: Workflow[]): Promise<void> {
    await this.json("/api/workflows", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ spaces }),
    });
  }

  private async withWriteLock<T>(operation: () => Promise<T>): Promise<T> {
    let release!: () => void;
    const previous = this.writeTail;
    this.writeTail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }

  async appendWorkflow(workflow: Workflow): Promise<void> {
    await this.withWriteLock(async () => {
      const spaces = await this.getWorkflows();
      if (spaces.some((space) => space.id === workflow.id)) throw new Error(`Workflow already exists: ${workflow.id}`);
      await this.saveWorkflows([...spaces, workflow]);
    });
  }

  async mutateWorkflow(id: string, mutate: (workflow: Workflow) => Workflow | null): Promise<Workflow | null> {
    return this.withWriteLock(async () => {
      const spaces = await this.getWorkflows();
      const index = spaces.findIndex((space) => space.id === id);
      if (index < 0) throw new Error(`Workflow not found: ${id}`);
      const changed = mutate(structuredClone(spaces[index]));
      if (changed) {
        changed.updatedAt = Date.now();
        spaces[index] = changed;
      } else {
        spaces.splice(index, 1);
      }
      await this.saveWorkflows(spaces);
      return changed;
    });
  }

  async generateText(input: { model?: string; prompt: string; systemPrompt?: string }): Promise<string> {
    const response = await fetch(`${this.baseUrl}/api/assistant`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!response.ok || !response.body) {
      const text = await response.text();
      throw new Error(`HeliosGen ${response.status}: ${text || response.statusText}`);
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let output = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6).trim();
        if (!data || data === "[DONE]") continue;
        try {
          const event = JSON.parse(data);
          const providerError = extractError(event);
          if (providerError) throw new Error(`Provider stream failed: ${providerError}`);
          output += extractDelta(event);
        } catch (error) {
          if (error instanceof SyntaxError) continue;
          throw error;
        }
      }
    }
    return output;
  }
}

function object(value: unknown): JsonObject | undefined {
  return value !== null && typeof value === "object" ? value as JsonObject : undefined;
}

function extractDelta(value: unknown): string {
  const event = object(value);
  if (!event) return "";
  const delta = object(event.delta);
  if (event.type === "content_block_delta" && typeof delta?.text === "string") return delta.text;
  if (event.type === "response.output_text.delta" && typeof event.delta === "string") return event.delta;
  const choices = Array.isArray(event.choices) ? event.choices : [];
  const chatDelta = object(object(choices[0])?.delta);
  return typeof chatDelta?.content === "string" ? chatDelta.content : "";
}

function extractError(value: unknown): string | null {
  const event = object(value);
  if (!event) return null;
  const error = object(event.error);
  if (event.type === "error" && typeof error?.message === "string") return error.message;
  const response = object(event.response);
  const responseError = object(response?.error);
  if (event.type === "response.failed" && typeof responseError?.message === "string") return responseError.message;
  return null;
}
