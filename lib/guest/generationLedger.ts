import { randomUUID } from "node:crypto";
import { db } from "./sqlite";
import type { WaveSpeedModel } from "../wavespeedTypes";

export type LedgerStatus = "pending" | "done" | "error" | "skipped";

export interface GenerationLedgerEntry {
  id: string;
  taskId: string;
  workflowId?: string;
  nodeId?: string;
  identityAssetId?: string;
  provider: string;
  modelId: string;
  attemptIndex: number;
  status: LedgerStatus;
  quotedCost?: number;
  actualCost?: number;
  costKind: "estimate" | "actual";
  currency: string;
  errorMsg?: string;
  outputUrl?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface WaveSpeedRunPlan {
  taskId: string;
  mediaType: "image" | "video";
  workflowId?: string;
  nodeId?: string;
  identityAssetId?: string;
  models: WaveSpeedModel[];
  currentIndex: number;
  predictionId: string;
  input: Record<string, unknown>;
  maxCost?: number;
  estimatedSpend: number;
  createdAt: string;
  updatedAt: string;
}

const now = () => new Date().toISOString();

function rowToLedger(row: Record<string, unknown>): GenerationLedgerEntry {
  return {
    id: row.id as string,
    taskId: row.task_id as string,
    workflowId: (row.workflow_id as string) || undefined,
    nodeId: (row.node_id as string) || undefined,
    identityAssetId: (row.identity_asset_id as string) || undefined,
    provider: row.provider as string,
    modelId: row.model_id as string,
    attemptIndex: Number(row.attempt_index),
    status: row.status as LedgerStatus,
    quotedCost: row.quoted_cost == null ? undefined : Number(row.quoted_cost),
    actualCost: row.actual_cost == null ? undefined : Number(row.actual_cost),
    costKind: row.cost_kind as "estimate" | "actual",
    currency: row.currency as string,
    errorMsg: (row.error_msg as string) || undefined,
    outputUrl: (row.output_url as string) || undefined,
    metadata: typeof row.metadata === "string" && row.metadata ? JSON.parse(row.metadata) : undefined,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export function insertLedgerAttempt(input: {
  taskId: string;
  workflowId?: string;
  nodeId?: string;
  identityAssetId?: string;
  modelId: string;
  attemptIndex: number;
  quotedCost?: number;
  metadata?: Record<string, unknown>;
}): string {
  return insertProviderLedgerAttempt({ ...input, provider: "wavespeed" });
}

export function insertProviderLedgerAttempt(input: {
  taskId: string;
  workflowId?: string;
  nodeId?: string;
  identityAssetId?: string;
  provider: string;
  modelId: string;
  attemptIndex?: number;
  quotedCost?: number;
  actualCost?: number;
  metadata?: Record<string, unknown>;
}): string {
  const id = randomUUID();
  const timestamp = now();
  db().prepare(`
    INSERT INTO generation_ledger
      (id, task_id, workflow_id, node_id, identity_asset_id, provider, model_id, attempt_index, status,
       quoted_cost, cost_kind, currency, metadata, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, 'USD', ?, ?, ?)
  `).run(
    id, input.taskId, input.workflowId ?? null, input.nodeId ?? null, input.identityAssetId ?? null, input.provider, input.modelId,
    input.attemptIndex ?? 0, input.quotedCost ?? null, input.actualCost == null ? "estimate" : "actual",
    input.metadata ? JSON.stringify(input.metadata) : null, timestamp, timestamp,
  );
  return id;
}

export function settleProviderLedgerTask(taskId: string, status: "done" | "error", errorMsg?: string, actualCost?: number, outputUrl?: string): void {
  db().prepare(`
    UPDATE generation_ledger SET status = ?,
      actual_cost = COALESCE(?, CASE WHEN ? = 'done' THEN quoted_cost ELSE actual_cost END),
      cost_kind = CASE WHEN ? IS NULL THEN cost_kind ELSE 'actual' END,
      error_msg = ?, output_url = COALESCE(?, output_url), updated_at = ?
    WHERE task_id = ? AND status = 'pending'
  `).run(status, actualCost ?? null, status, actualCost ?? null, errorMsg ?? null, outputUrl ?? null, now(), taskId);
}

export function settleLedgerAttempt(
  taskId: string,
  attemptIndex: number,
  status: "done" | "error" | "skipped",
  errorMsg?: string,
  outputUrl?: string,
): void {
  db().prepare(`
    UPDATE generation_ledger
    SET status = ?, actual_cost = CASE WHEN ? = 'done' THEN quoted_cost ELSE actual_cost END,
        cost_kind = 'estimate', error_msg = ?, output_url = COALESCE(?, output_url), updated_at = ?
    WHERE task_id = ? AND attempt_index = ?
  `).run(status, status, errorMsg ?? null, outputUrl ?? null, now(), taskId, attemptIndex);
}

export function saveWaveSpeedRunPlan(plan: Omit<WaveSpeedRunPlan, "createdAt" | "updatedAt">): void {
  const timestamp = now();
  db().prepare(`
    INSERT INTO wavespeed_run_plans
      (task_id, media_type, workflow_id, node_id, identity_asset_id, models_json, current_index,
       prediction_id, input_json, max_cost, estimated_spend, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(task_id) DO UPDATE SET
      identity_asset_id = excluded.identity_asset_id, models_json = excluded.models_json, current_index = excluded.current_index,
      prediction_id = excluded.prediction_id, input_json = excluded.input_json,
      max_cost = excluded.max_cost, estimated_spend = excluded.estimated_spend,
      updated_at = excluded.updated_at
  `).run(
    plan.taskId, plan.mediaType, plan.workflowId ?? null, plan.nodeId ?? null, plan.identityAssetId ?? null,
    JSON.stringify(plan.models), plan.currentIndex, plan.predictionId,
    JSON.stringify(plan.input), plan.maxCost ?? null, plan.estimatedSpend,
    timestamp, timestamp,
  );
}

export function getWaveSpeedRunPlan(taskId: string): WaveSpeedRunPlan | null {
  const row = db().prepare("SELECT * FROM wavespeed_run_plans WHERE task_id = ?")
    .get(taskId) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    taskId: row.task_id as string,
    mediaType: row.media_type as "image" | "video",
    workflowId: (row.workflow_id as string) || undefined,
    nodeId: (row.node_id as string) || undefined,
    identityAssetId: (row.identity_asset_id as string) || undefined,
    models: JSON.parse(row.models_json as string) as WaveSpeedModel[],
    currentIndex: Number(row.current_index),
    predictionId: row.prediction_id as string,
    input: JSON.parse(row.input_json as string) as Record<string, unknown>,
    maxCost: row.max_cost == null ? undefined : Number(row.max_cost),
    estimatedSpend: Number(row.estimated_spend),
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export function listLedger(options?: { workflowId?: string; nodeId?: string; identityAssetId?: string; limit?: number }): {
  entries: GenerationLedgerEntry[];
  totals: { quoted: number; actual: number; attempts: number; completed: number };
} {
  const where: string[] = [];
  const params: unknown[] = [];
  if (options?.workflowId) { where.push("workflow_id = ?"); params.push(options.workflowId); }
  if (options?.nodeId) { where.push("node_id = ?"); params.push(options.nodeId); }
  if (options?.identityAssetId) { where.push("identity_asset_id = ?"); params.push(options.identityAssetId); }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const limit = Math.min(500, Math.max(1, options?.limit ?? 100));
  const rows = db().prepare(`SELECT * FROM generation_ledger ${clause} ORDER BY created_at DESC LIMIT ?`)
    .all(...(params as never[]), limit) as Record<string, unknown>[];
  const totals = db().prepare(`
    SELECT COALESCE(SUM(quoted_cost), 0) AS quoted,
           COALESCE(SUM(actual_cost), 0) AS actual,
           COUNT(*) AS attempts,
           SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS completed
    FROM generation_ledger ${clause}
  `).get(...(params as never[])) as Record<string, unknown>;
  return {
    entries: rows.map(rowToLedger),
    totals: {
      quoted: Number(totals.quoted),
      actual: Number(totals.actual),
      attempts: Number(totals.attempts),
      completed: Number(totals.completed),
    },
  };
}
