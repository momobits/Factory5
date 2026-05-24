/**
 * Tier 15 / ADR 0034 — derive a directive's live budget pool usage.
 *
 * Aggregates `tasks_inflight` (turn counts grouped by `agent`) + `model_usage`
 * (USD summed; call-count for maxSteps across rows scoped to `directive_id`)
 * and resolves each axis cap via
 * `max(projectBudgets[axis], payload.budgets[axis], BUDGET_DEFAULTS[axis].value)`.
 *
 * The pool is NOT stored — it is derived on every call. Cheap enough for the
 * brain's 250 ms serve poll tick and the daemon's `GET /pool-usage` endpoint.
 *
 * @packageDocumentation
 */

import { BUDGET_DEFAULTS, type BudgetAxis } from '@factory5/core/budgets';
import { createLogger } from '@factory5/logger';
import type { Database } from '@factory5/state';

const log = createLogger('brain.pool-usage');

// -----------------------------------------------------------------------------
// Public types
// -----------------------------------------------------------------------------

/** Per-task contribution toward a turn-pool axis. */
export interface PoolTaskContribution {
  taskId: string;
  title: string;
  agent: string;
  /** Number of turns this task consumed (0 if result_json lacks turnsUsed). */
  contribution: number;
}

/** Usage snapshot for a single budget axis. */
export interface PoolAxisUsage {
  used: number;
  cap: number;
  /** Percentage consumed, clamped to [0, 100]. */
  pct: number;
  /**
   * Per-task breakdown for the three `maxTurns*` axes.
   * Empty array for `maxUsd` and `maxSteps` (no per-task attribution).
   */
  tasks: PoolTaskContribution[];
  status: 'ok' | 'warn' | 'exhausted';
}

/**
 * Structured park reason set when a directive is blocked with
 * `blocked_reason = JSON({ kind: 'pool-exhausted', ... })`.
 */
export interface ParkedReason {
  axis: string;
  usedAtPark: number;
  capAtPark: number;
  /** Linear bump target: `capAtPark + projectDefault[axis]` (ADR 0034 §4). */
  nextBumpTo: number;
}

/**
 * Full pool usage snapshot for a directive.
 * `parkedReason` is present only when the directive is `blocked` with a
 * structured pool-exhausted reason.
 */
export interface PoolUsage {
  directiveId: string;
  computedAt: string;
  perAxis: Record<BudgetAxis, PoolAxisUsage>;
  parkedReason?: ParkedReason;
}

/**
 * Minimal project-budget shape required by `computePoolUsage`.
 * Matches the subset of `ProjectMetadata.metadata` that is read for cap
 * resolution; callers pass the full metadata object, extras are ignored.
 */
export interface ProjectBudgetsLike {
  /**
   * Per-axis project-level defaults from `project.json`.
   * Missing keys fall back to `BUDGET_DEFAULTS[axis].value`.
   */
  budgetDefaults: Partial<Record<BudgetAxis, number>>;
  autoIncreaseBudgets?: boolean;
  autoIncreaseCeilingMultiplier?: number;
}

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

/**
 * The five operator-facing pool axes in stable iteration order.
 * `askUserDeadlineMs`, `maxUsdPerTask`, and `maxWikiReadinessAttempts` are
 * directive-level scalar limits, not pools, so they are excluded here.
 */
const POOL_AXES: ReadonlyArray<BudgetAxis> = [
  'maxUsd',
  'maxSteps',
  'maxTurnsScaffolder',
  'maxTurnsBuilder',
  'maxTurnsFixer',
] as const;

/** Percentage at which status transitions from 'ok' to 'warn'. */
const WARN_PCT = 80;

// -----------------------------------------------------------------------------
// Main export
// -----------------------------------------------------------------------------

/**
 * Derive a directive's live budget pool usage from the SQLite state DB.
 *
 * Reads three tables:
 *   - `directives` — the directive row (status, blocked_reason, payload_json)
 *   - `tasks_inflight` — per-agent turn aggregation (result_json.turnsUsed)
 *   - `model_usage` — USD total (SUM cost_usd) and step count (COUNT rows)
 *
 * Cap resolution rule (ADR 0034 §1):
 *   `effectiveCap = max(projectBudgets[axis] ?? 0, payload.budgets[axis] ?? 0, BUDGET_DEFAULTS[axis].value ?? 0)`
 *
 * @param db - Open better-sqlite3 database with all migrations applied.
 * @param directiveId - ULID of the directive to inspect.
 * @param projectBudgets - Project-level budget defaults from `project.json`.
 * @throws {Error} if the directive does not exist in the DB.
 */
export function computePoolUsage(
  db: Database,
  directiveId: string,
  projectBudgets: ProjectBudgetsLike,
): PoolUsage {
  log.debug({ directiveId }, 'computing pool usage');

  const directiveRow = db
    .prepare(`SELECT payload_json, status, blocked_reason FROM directives WHERE id = ?`)
    .get(directiveId) as
    | { payload_json: string; status: string; blocked_reason: string | null }
    | undefined;

  if (directiveRow === undefined) {
    throw new Error(`computePoolUsage: directive ${directiveId} not found`);
  }

  const parsedPayload = safeParseJson(directiveRow.payload_json);
  const payloadBudgets: Partial<Record<BudgetAxis, number>> =
    isRecord(parsedPayload) && isRecord(parsedPayload['budgets'])
      ? (parsedPayload['budgets'] as Partial<Record<BudgetAxis, number>>)
      : {};

  const perAxis = {} as Record<BudgetAxis, PoolAxisUsage>;
  for (const axis of POOL_AXES) {
    perAxis[axis] = computeAxis(db, directiveId, axis, projectBudgets, payloadBudgets);
  }

  const parkedReason =
    directiveRow.status === 'blocked'
      ? parseParkedReason(directiveRow.blocked_reason, projectBudgets)
      : undefined;

  return {
    directiveId,
    computedAt: new Date().toISOString(),
    perAxis,
    ...(parkedReason !== undefined ? { parkedReason } : {}),
  };
}

// -----------------------------------------------------------------------------
// Internals
// -----------------------------------------------------------------------------

function computeAxis(
  db: Database,
  directiveId: string,
  axis: BudgetAxis,
  projectBudgets: ProjectBudgetsLike,
  payloadBudgets: Partial<Record<BudgetAxis, number>>,
): PoolAxisUsage {
  const cap = resolveEffectiveCap(axis, projectBudgets, payloadBudgets);
  const { used, tasks } = aggregateUsed(db, directiveId, axis);
  const pct = cap === 0 ? 0 : Math.min(100, (used / cap) * 100);
  const status: PoolAxisUsage['status'] =
    used >= cap && cap > 0 ? 'exhausted' : pct >= WARN_PCT ? 'warn' : 'ok';
  return { used, cap, pct, tasks, status };
}

/**
 * Resolve the effective cap for an axis using the three-way max rule.
 * ADR 0034 §1 / Feature F2 unified resolution:
 *   `effectiveCap = max(project, payload.budgets, BUDGET_DEFAULTS)`.
 *
 * Exported so consumers that already hold projectBudgets + payloadBudgets
 * can call it directly (e.g. assertBudget live-resolve in triage/architect/
 * critic/planner). For consumers that only know a directiveId, use the
 * convenience wrapper {@link resolveAxisCap}.
 */
export function resolveEffectiveCap(
  axis: BudgetAxis,
  projectBudgets: ProjectBudgetsLike,
  payloadBudgets: Partial<Record<BudgetAxis, number>>,
): number {
  const project = projectBudgets.budgetDefaults[axis] ?? 0;
  const payload = payloadBudgets[axis] ?? 0;
  const fallback = BUDGET_DEFAULTS[axis]?.value ?? 0;
  return Math.max(project, payload, fallback);
}

/**
 * Convenience wrapper: resolve a single axis cap for a directive by reading
 * its payload budgets from the DB and combining with project-level defaults.
 *
 * Feature F2 (Relay issues #1, #3, #5, #6) — every non-pool consumer that
 * previously read caps from ad-hoc sources switches to this function.
 *
 * @param db - Open better-sqlite3 database.
 * @param directiveId - ULID of the directive.
 * @param axis - Which budget axis to resolve.
 * @param projectBudgets - Project-level budget defaults from `project.json`.
 * @returns The effective cap for the axis (never negative).
 */
export function resolveAxisCap(
  db: Database,
  directiveId: string,
  axis: BudgetAxis,
  projectBudgets: ProjectBudgetsLike,
): number {
  const directiveRow = db
    .prepare(`SELECT payload_json FROM directives WHERE id = ?`)
    .get(directiveId) as { payload_json: string } | undefined;

  const parsedPayload =
    directiveRow !== undefined ? safeParseJson(directiveRow.payload_json) : null;
  const payloadBudgets: Partial<Record<BudgetAxis, number>> =
    isRecord(parsedPayload) && isRecord(parsedPayload['budgets'])
      ? (parsedPayload['budgets'] as Partial<Record<BudgetAxis, number>>)
      : {};

  return resolveEffectiveCap(axis, projectBudgets, payloadBudgets);
}

interface AggregateResult {
  used: number;
  tasks: PoolTaskContribution[];
}

/**
 * Aggregate the `used` amount for one axis from the DB.
 *
 * `maxUsd`   — SUM(cost_usd) from model_usage
 * `maxSteps` — COUNT(*) from model_usage (one row per LLM call = one step)
 * `maxTurns*` — sum of result_json.turnsUsed across tasks_inflight for the axis's agent class
 */
function aggregateUsed(db: Database, directiveId: string, axis: BudgetAxis): AggregateResult {
  switch (axis) {
    case 'maxUsd': {
      const row = db
        .prepare(
          `SELECT COALESCE(SUM(cost_usd), 0) AS total FROM model_usage WHERE directive_id = ?`,
        )
        .get(directiveId) as { total: number };
      return { used: row.total, tasks: [] };
    }

    case 'maxSteps': {
      // maxSteps = LLM call count. model_usage has one row per call.
      // There is no `steps` column; the count IS the step count.
      const row = db
        .prepare(`SELECT COUNT(*) AS total FROM model_usage WHERE directive_id = ?`)
        .get(directiveId) as { total: number };
      return { used: row.total, tasks: [] };
    }

    case 'maxTurnsScaffolder':
    case 'maxTurnsBuilder':
    case 'maxTurnsFixer': {
      const agent =
        axis === 'maxTurnsScaffolder'
          ? 'scaffolder'
          : axis === 'maxTurnsBuilder'
            ? 'builder'
            : 'fixer';

      const rows = db
        .prepare(
          `SELECT id, title, agent, result_json
           FROM tasks_inflight
           WHERE directive_id = ? AND agent = ?`,
        )
        .all(directiveId, agent) as Array<{
        id: string;
        title: string;
        agent: string;
        result_json: string | null;
      }>;

      const contributions: PoolTaskContribution[] = [];
      let used = 0;

      for (const row of rows) {
        const result = row.result_json !== null ? safeParseJson(row.result_json) : null;
        // turnsUsed will be present once Tier 15 wires the worker callback.
        // For pre-Tier-15 rows it is absent; treat as 0 (no double-count).
        const turnsUsed =
          isRecord(result) && typeof result['turnsUsed'] === 'number' ? result['turnsUsed'] : 0;
        contributions.push({
          taskId: row.id,
          title: row.title,
          agent: row.agent,
          contribution: turnsUsed,
        });
        used += turnsUsed;
      }

      return { used, tasks: contributions };
    }

    default: {
      // Non-pool axes (askUserDeadlineMs, maxUsdPerTask, maxWikiReadinessAttempts)
      // are not tracked as pools; return 0.
      return { used: 0, tasks: [] };
    }
  }
}

/**
 * Parse the `blocked_reason` column into a structured {@link ParkedReason}.
 *
 * Returns `undefined` when:
 *   - `raw` is null
 *   - `raw` is not valid JSON (legacy free-text like `'cancelled-from-web-ui'`)
 *   - the parsed object does not have `kind === 'pool-exhausted'`
 *   - numeric fields are missing or non-finite
 */
function parseParkedReason(
  raw: string | null,
  projectBudgets: ProjectBudgetsLike,
): ParkedReason | undefined {
  if (raw === null) return undefined;

  const parsed = safeParseJson(raw);
  if (!isRecord(parsed)) return undefined;
  if (parsed['kind'] !== 'pool-exhausted') return undefined;

  const axis = parsed['axis'];
  const usedAtPark = parsed['usedAtPark'];
  const capAtPark = parsed['capAtPark'];

  if (typeof axis !== 'string') return undefined;
  if (typeof usedAtPark !== 'number' || !Number.isFinite(usedAtPark)) return undefined;
  if (typeof capAtPark !== 'number' || !Number.isFinite(capAtPark)) return undefined;

  const projectDefault =
    projectBudgets.budgetDefaults[axis as BudgetAxis] ??
    BUDGET_DEFAULTS[axis as BudgetAxis]?.value ??
    0;

  return {
    axis,
    usedAtPark,
    capAtPark,
    nextBumpTo: capAtPark + projectDefault,
  };
}

// -----------------------------------------------------------------------------
// Tiny helpers
// -----------------------------------------------------------------------------

/** Parse a JSON string, returning `null` on any failure. No `any`. */
function safeParseJson(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

/** Type-guard: `value` is a non-null `Record<string, unknown>`. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
