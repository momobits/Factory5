/**
 * Typed CRUD + budget-enforcement queries for the `model_usage` table.
 *
 * The table records one row per LLM call: input/output tokens, cost,
 * duration, the (category, mode) pair used, and the directive/task it
 * was part of. Per-call cost is the authoritative number — `claude-cli`
 * reports `total_cost_usd` directly in its result envelope, so factory
 * never multiplies tokens by a rate card (ADR 0020).
 *
 * Budget-enforcement queries (added for Phase 7a per ADR 0020):
 *
 *   - `totalCostForDirective`  — running USD total for `max_usd` check
 *   - `countForDirective`      — call count for `max_steps` check
 *   - `averageCostByCategory`  — rolling estimate for the pre-call check
 *
 * `mode` is `'call'` (one-shot `provider.call()`) or `'stream'` (tool-
 * using `provider.stream()` subprocess). Cost-per-invocation differs
 * by an order of magnitude between them, so the estimator must bucket
 * by mode — a shared average would be useless.
 */

import type { ModelCategory } from '@factory5/core';

import type { Database } from '../db.js';

export type UsageMode = 'call' | 'stream';

export interface UsageRecord {
  id: string;
  directiveId?: string;
  taskId?: string;
  provider: string;
  model: string;
  category: ModelCategory;
  /** ADR 0020: distinguishes one-shot `call()` from tool-using `stream()`. Optional for legacy rows. */
  mode?: UsageMode;
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
  mode: string | null;
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
  if (row.mode !== null) u.mode = row.mode as UsageMode;
  if (row.error !== null) u.error = row.error;
  return u;
}

/** Record a single LLM call's usage. */
export function record(db: Database, u: UsageRecord): void {
  db.prepare(
    `INSERT INTO model_usage
       (id, directive_id, task_id, provider, model, category, mode,
        input_tokens, output_tokens, cost_usd, duration_ms, called_at, error)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    u.id,
    u.directiveId ?? null,
    u.taskId ?? null,
    u.provider,
    u.model,
    u.category,
    u.mode ?? null,
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

/**
 * Count of recorded LLM calls for a directive. Feeds the `max_steps`
 * pre-call check (ADR 0020) — retry loops and stall-grind loops both
 * show up as unbounded growth in this count, and no other ceiling in
 * the system catches them.
 */
export function countForDirective(db: Database, directiveId: string): number {
  const row = db
    .prepare('SELECT COUNT(*) AS c FROM model_usage WHERE directive_id = ?')
    .get(directiveId) as { c: number };
  return row.c;
}

/**
 * Rolling-average cost over the last `sampleSize` successful
 * (non-error) calls for the given `(category, mode)`. Returns the
 * average in USD, or `undefined` when there are zero qualifying rows
 * (cold start — caller should fall back to a hard-coded default, see
 * `DEFAULT_CATEGORY_COST` in `packages/brain/src/budget.ts`).
 *
 * "Successful" = `error IS NULL`. An error row typically costs less
 * than a successful one (the subprocess died before a full tool-loop
 * ran), so including errors would bias the estimate low — exactly
 * the direction Phase 7a is trying to avoid.
 *
 * "Last N" means ordered by `called_at DESC`. Twenty is chosen as the
 * default sample size because it's large enough to smooth per-call
 * variance for tool-using streams and small enough to track drift if
 * the category's effective model changes within a session.
 */
export function averageCostByCategory(
  db: Database,
  category: ModelCategory,
  mode: UsageMode,
  sampleSize = 20,
): number | undefined {
  const rows = db
    .prepare(
      `SELECT cost_usd FROM model_usage
         WHERE category = ?
           AND mode = ?
           AND error IS NULL
         ORDER BY called_at DESC
         LIMIT ?`,
    )
    .all(category, mode, sampleSize) as { cost_usd: number }[];
  if (rows.length === 0) return undefined;
  const sum = rows.reduce((acc, r) => acc + r.cost_usd, 0);
  return sum / rows.length;
}

/** All usage records for a directive (chronological). */
export function listForDirective(db: Database, directiveId: string): UsageRecord[] {
  const rows = db
    .prepare('SELECT * FROM model_usage WHERE directive_id = ? ORDER BY called_at')
    .all(directiveId) as Row[];
  return rows.map(rowToUsage);
}
