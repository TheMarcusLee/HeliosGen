import { randomUUID } from "node:crypto";
import { db } from "./sqlite";

export type BatchItemState = "idle" | "analysis" | "generation" | "completed" | "error";
export type BatchRunState = "idle" | "analysis" | "generation" | "paused" | "completed" | "error";

export interface BatchItem {
  id: string;
  pose: string;
  outfit: string;
  prompt: string;
  status: BatchItemState;
  attempts: number;
  taskId?: string;
  outputUrl?: string;
  error?: string;
}

export interface BatchRun {
  id: string;
  workflowId?: string;
  nodeId?: string;
  identityAssetId: string;
  provider: string;
  modelId: string;
  concurrency: number;
  status: BatchRunState;
  analysis?: string;
  items: BatchItem[];
  createdAt: string;
  updatedAt: string;
}

function fromRow(row: Record<string, unknown>): BatchRun {
  return {
    id: String(row.id), workflowId: row.workflow_id ? String(row.workflow_id) : undefined,
    nodeId: row.node_id ? String(row.node_id) : undefined, identityAssetId: String(row.identity_asset_id),
    provider: String(row.provider), modelId: String(row.model_id), concurrency: Number(row.concurrency),
    status: String(row.status) as BatchRunState, analysis: row.analysis ? String(row.analysis) : undefined,
    items: JSON.parse(String(row.items_json)) as BatchItem[], createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}

export function createBatchRun(input: Omit<BatchRun, "id" | "createdAt" | "updatedAt">): BatchRun {
  const id = randomUUID();
  const timestamp = new Date().toISOString();
  db().prepare(`INSERT INTO batch_runs
    (id, workflow_id, node_id, identity_asset_id, provider, model_id, concurrency, status, analysis, items_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, input.workflowId ?? null, input.nodeId ?? null, input.identityAssetId, input.provider, input.modelId,
      Math.min(8, Math.max(1, input.concurrency)), input.status, input.analysis ?? null, JSON.stringify(input.items), timestamp, timestamp);
  return getBatchRun(id)!;
}

export function getBatchRun(id: string): BatchRun | null {
  const row = db().prepare("SELECT * FROM batch_runs WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  return row ? fromRow(row) : null;
}

export function listBatchRuns(workflowId?: string): BatchRun[] {
  const rows = workflowId
    ? db().prepare("SELECT * FROM batch_runs WHERE workflow_id = ? ORDER BY created_at DESC").all(workflowId)
    : db().prepare("SELECT * FROM batch_runs ORDER BY created_at DESC").all();
  return (rows as Record<string, unknown>[]).map(fromRow);
}

export function updateBatchRun(id: string, patch: Partial<Pick<BatchRun, "status" | "analysis" | "items" | "concurrency">>): BatchRun {
  const current = getBatchRun(id);
  if (!current) throw new Error(`Batch run not found: ${id}`);
  const next = { ...current, ...patch, concurrency: Math.min(8, Math.max(1, patch.concurrency ?? current.concurrency)), updatedAt: new Date().toISOString() };
  db().prepare("UPDATE batch_runs SET concurrency = ?, status = ?, analysis = ?, items_json = ?, updated_at = ? WHERE id = ?")
    .run(next.concurrency, next.status, next.analysis ?? null, JSON.stringify(next.items), next.updatedAt, id);
  return next;
}

export function updateBatchItem(id: string, itemId: string, patch: Partial<BatchItem>): BatchRun {
  const current = getBatchRun(id);
  if (!current) throw new Error(`Batch run not found: ${id}`);
  if (!current.items.some((item) => item.id === itemId)) throw new Error(`Batch item not found: ${itemId}`);
  return updateBatchRun(id, { items: current.items.map((item) => item.id === itemId ? { ...item, ...patch, id: item.id } : item) });
}
