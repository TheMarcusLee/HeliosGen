export type ComfyInputKind = "prompt" | "image" | "video" | "audio" | "value";

export interface ComfyBinding {
  id: string;
  nodeId: string;
  inputName: string;
  nodeTitle: string;
  kind: ComfyInputKind;
  value: unknown;
  valueType: "string" | "number" | "boolean";
}

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;
}

export function validateComfyApiWorkflow(value: unknown): asserts value is JsonRecord {
  const workflow = record(value);
  if (!workflow || Object.keys(workflow).length === 0) throw new Error("ComfyUI workflow must be a non-empty API-format JSON object.");
  for (const [nodeId, rawNode] of Object.entries(workflow)) {
    const node = record(rawNode);
    if (!node || typeof node.class_type !== "string" || !record(node.inputs)) {
      throw new Error(`ComfyUI node ${nodeId} is not in API format. Export with “Save (API Format)”.`);
    }
  }
}

function inputKind(classType: string, inputName: string): ComfyInputKind {
  const normalized = `${classType} ${inputName}`.toLowerCase();
  if (normalized.includes("loadimage") || /(^|_)(image|mask)(_|$)/.test(inputName.toLowerCase())) return "image";
  if (normalized.includes("loadvideo") || /(^|_)video(_|$)/.test(inputName.toLowerCase())) return "video";
  if (normalized.includes("loadaudio") || /(^|_)audio(_|$)/.test(inputName.toLowerCase())) return "audio";
  if (["text", "prompt", "positive", "negative"].some((name) => inputName.toLowerCase().includes(name))) return "prompt";
  return "value";
}

export function deriveComfyBindings(value: unknown): ComfyBinding[] {
  validateComfyApiWorkflow(value);
  const workflow = value as JsonRecord;
  const output: ComfyBinding[] = [];
  for (const [nodeId, rawNode] of Object.entries(workflow)) {
    const node = record(rawNode)!;
    const inputs = record(node.inputs)!;
    const meta = record(node._meta);
    const title = String(meta?.title ?? node.class_type);
    for (const [inputName, inputValue] of Object.entries(inputs)) {
      if (Array.isArray(inputValue) && inputValue.length === 2 && typeof inputValue[0] === "string") continue;
      const primitive = typeof inputValue;
      if (!(["string", "number", "boolean"] as string[]).includes(primitive)) continue;
      const kind = inputKind(String(node.class_type), inputName);
      output.push({
        id: `${nodeId}:${inputName}`,
        nodeId,
        inputName,
        nodeTitle: title,
        kind,
        value: inputValue,
        valueType: primitive as ComfyBinding["valueType"],
      });
    }
  }
  return output;
}

export function applyComfyBindings(workflowValue: unknown, bindings: ComfyBinding[]): JsonRecord {
  validateComfyApiWorkflow(workflowValue);
  const workflow = structuredClone(workflowValue as JsonRecord);
  for (const binding of bindings) {
    const node = record(workflow[binding.nodeId]);
    const inputs = record(node?.inputs);
    if (inputs && binding.inputName in inputs) inputs[binding.inputName] = binding.value;
  }
  return workflow;
}

export function extractComfyOutputFiles(historyValue: unknown): Array<{ filename: string; subfolder: string; type: string }> {
  const root = record(historyValue);
  if (!root) return [];
  const files: Array<{ filename: string; subfolder: string; type: string }> = [];
  const visit = (value: unknown, depth = 0) => {
    if (depth > 8) return;
    if (Array.isArray(value)) { value.forEach((item) => visit(item, depth + 1)); return; }
    const item = record(value);
    if (!item) return;
    if (typeof item.filename === "string") files.push({ filename: item.filename, subfolder: String(item.subfolder ?? ""), type: String(item.type ?? "output") });
    Object.values(item).forEach((candidate) => visit(candidate, depth + 1));
  };
  visit(root);
  return files.filter((file, index) => files.findIndex((candidate) => candidate.filename === file.filename && candidate.subfolder === file.subfolder) === index);
}
