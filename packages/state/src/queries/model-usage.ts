/**
 * Typed CRUD for the `model_usage` table — token + cost tracking per LLM call.
 */

import type { ModelCategory } from '@factory5/core';

import type { Database } from '../db.js';

export interface UsageRecord {
  id: string;
  directiveId?: string;
  taskId?: string;
  provider: string;
  model: string;
  category: ModelCategory;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  durationMs: number;
  calledAt: string;
  error?: string;
}

interface Row {
  id: string;
  directive_id: string | null;
  task_id: string | null;
  provider: string;
  model: string;
  category: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  duration_ms: number;
  called_at: string;
  error: string | null;
}

function rowToUsage(row: Row): UsageRecord {
  const u: UsageRecord = {
    id: row.id,
    provider: row.provider,
    model: row.model,
    category: row.category as ModelCategory,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    costUsd: row.cost_usd,
    durationMs: row.duration_ms,
    calledAt: row.called_at,
  };
  if (row.directive_id !== null) u.directiveId = row.directive_id;
  if (row.task_id !== null) u.taskId = row.task_id;
  if (row.error !== null) u.error = row.error;
  return u;
}

/** Record a single LLM call's usage. */
export function record(db: Database, u: UsageRecord): void {
  db.prepare(
    `INSERT INTO model_usage
       (id, directive_id, task_id, provider, model, category,
        input_tokens, output_tokens, cost_usd, duration_ms, called_at, error)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    u.id,
    u.directiveId ?? null,
    u.taskId ?? null,
    u.provider,
    u.model,
    u.category,
    u.inputTokens,
    u.outputTokens,
    u.costUsd,
    u.durationMs,
    u.calledAt,
    u.error ?? null,
  );
}

/** Total spend (USD) for a directive. */
export function totalCostForDirective(db: Database, directiveId: string): number {
  const row = db
    .prepare('SELECT COALESCE(SUM(cost_usd), 0) AS total FROM model_usage WHERE directive_id = ?')
    .get(directiveId) as { total: number };
  return row.total;
}

/** All usage records for a directive (chronological). */
export function listForDirective(db: Database, directiveId: string): UsageRecord[] {
  const rows = db
    .prepare('SELECT * FROM model_usage WHERE directive_id = ? ORDER BY called_at')
    .all(directiveId) as Row[];
  return rows.map(rowToUsage);
}
