/**
 * Pre-call budget enforcement (Phase 7a, ADR 0020).
 *
 * Every brain-side `provider.call()` / `provider.stream()` is preceded by
 * {@link assertBudget}. The check reads the directive's running total
 * from `model_usage`, estimates the imminent call via
 * {@link estimateCostFor}, and throws {@link BudgetExceededError} if
 * `spent + estimate > maxUsd` or `calls + 1 > maxSteps`. The pool and
 * inline loop catch the error at their outer boundary, flip the
 * directive to `blocked` with {@link formatBlockedReason} in
 * `directives.blocked_reason`, and queue an outbound escalation.
 *
 * The estimator is a rolling average over the last 20 successful rows
 * in `model_usage` filtered by `(category, mode)`. When fewer than two
 * samples exist (fresh install), a hand-tuned default from
 * {@link DEFAULT_CATEGORY_COST} is used instead. Those defaults were
 * seeded from Phase 6c live-run data and are conservative enough that
 * the first few builds on a fresh install favour early ceiling trips
 * over silent overshoots.
 */

import type { ModelCategory } from '@factory5/core';
import { modelUsage, type Database, type UsageMode } from '@factory5/state';

const COLD_START_MIN_SAMPLES = 2;

/**
 * Conservative per-`(category, mode)` cost defaults used when the rolling
 * average has fewer than {@link COLD_START_MIN_SAMPLES} rows. Values in
 * USD. Tuned for a fresh install:
 *
 *   - `stream` defaults are a little higher than typical observed
 *     spend so the first build is more likely to trip a low ceiling
 *     than to overshoot it silently.
 *   - `call` defaults are small (one-shot classifications) and line up
 *     with Phase 6c observed spend.
 *
 * Overridable at runtime via `~/.factory/config.toml`
 * `[budget.defaults]` once step 7a.6 lands; for now these hard-coded
 * values are the only cold-start source.
 */
export const DEFAULT_CATEGORY_COST: Readonly<
  Record<ModelCategory, Readonly<Record<UsageMode, number>>>
> = {
  quick: { call: 0.02, stream: 0.3 },
  documentation: { call: 0.02, stream: 0.3 },
  planning: { call: 0.1, stream: 0.6 },
  reasoning: { call: 0.1, stream: 1.5 },
  deep: { call: 0.15, stream: 2.0 },
};

/** Which ceiling tripped — differentiated for the blocked-reason prefix. */
export type BudgetExceededKind = 'budget_exceeded_usd' | 'budget_exceeded_steps';

export interface BudgetExceededDetail {
  kind: BudgetExceededKind;
  /** Ceiling the call would have breached. */
  ceiling: number;
  /** Total USD already charged to this directive, or call count if `kind = _steps`. */
  spentSoFar: number;
  /** Pre-call USD estimate (always 0 for `_steps`). */
  estimatedCost: number;
  /** Total LLM call count already recorded for this directive. */
  callsMadeSoFar: number;
  /** Category the refused call would have used. */
  category: ModelCategory;
  /** Invocation mode (`call` or `stream`) of the refused call. */
  mode: UsageMode;
  /** Agent role that owns the refused call (triage, architect, builder, …). */
  agent: string;
}

/**
 * Thrown by {@link assertBudget} before a provider call would exceed a
 * directive's `maxUsd` or `maxSteps` ceiling. The provider was never
 * touched — no in-flight subprocess to kill, no orphan state.
 */
export class BudgetExceededError extends Error {
  readonly detail: BudgetExceededDetail;

  constructor(detail: BudgetExceededDetail) {
    super(formatBlockedReason(detail));
    this.name = 'BudgetExceededError';
    this.detail = detail;
  }
}

/**
 * Rolling-average cost estimate for a `(category, mode)` call. Returns
 * the default from {@link DEFAULT_CATEGORY_COST} when the rolling
 * sample has fewer than {@link COLD_START_MIN_SAMPLES} rows — two
 * samples is the floor below which a single outlier dominates the mean.
 */
export function estimateCostFor(db: Database, category: ModelCategory, mode: UsageMode): number {
  const rolling = modelUsage.averageCostByCategory(db, category, mode);
  if (rolling !== undefined) {
    const count = countSamplesInWindow(db, category, mode);
    if (count >= COLD_START_MIN_SAMPLES) return rolling;
  }
  return DEFAULT_CATEGORY_COST[category][mode];
}

/** Used by {@link estimateCostFor} to tell a single-sample estimate from a real one. */
function countSamplesInWindow(db: Database, category: ModelCategory, mode: UsageMode): number {
  // Reuse the same filter as the average query so the sample shape matches.
  const rows = db
    .prepare(
      `SELECT 1 FROM model_usage
         WHERE category = ? AND mode = ? AND error IS NULL
         ORDER BY called_at DESC
         LIMIT 20`,
    )
    .all(category, mode);
  return rows.length;
}

export interface AssertBudgetInput {
  db: Database;
  directiveId: string;
  maxUsd?: number;
  maxSteps?: number;
  category: ModelCategory;
  mode: UsageMode;
  agent: string;
}

/**
 * Pre-call budget check. Throws {@link BudgetExceededError} when the
 * next call would push spend or call-count past the ceiling. No-op
 * when both ceilings are undefined (unlimited) or when the directive
 * has zero recorded calls and the estimate alone would not trip the
 * USD ceiling.
 */
export function assertBudget(args: AssertBudgetInput): void {
  const { db, directiveId, maxUsd, maxSteps, category, mode, agent } = args;

  const callsMadeSoFar = modelUsage.countForDirective(db, directiveId);

  if (maxSteps !== undefined && callsMadeSoFar + 1 > maxSteps) {
    throw new BudgetExceededError({
      kind: 'budget_exceeded_steps',
      ceiling: maxSteps,
      spentSoFar: callsMadeSoFar,
      estimatedCost: 0,
      callsMadeSoFar,
      category,
      mode,
      agent,
    });
  }

  if (maxUsd !== undefined) {
    const spentSoFar = modelUsage.totalCostForDirective(db, directiveId);
    const estimatedCost = estimateCostFor(db, category, mode);
    if (spentSoFar + estimatedCost > maxUsd) {
      throw new BudgetExceededError({
        kind: 'budget_exceeded_usd',
        ceiling: maxUsd,
        spentSoFar,
        estimatedCost,
        callsMadeSoFar,
        category,
        mode,
        agent,
      });
    }
  }
}

/**
 * Format a {@link BudgetExceededDetail} as a single-line, grep-friendly
 * `directives.blocked_reason`. The `budget_exceeded_*:` prefix lets
 * future tooling filter without re-parsing.
 */
export function formatBlockedReason(detail: BudgetExceededDetail): string {
  if (detail.kind === 'budget_exceeded_steps') {
    return `${detail.kind}: calls=${String(detail.callsMadeSoFar)}/${String(detail.ceiling)} agent=${detail.agent}`;
  }
  const spent = detail.spentSoFar.toFixed(4);
  const ceiling = detail.ceiling.toFixed(2);
  const est = detail.estimatedCost.toFixed(4);
  return `${detail.kind}: spent=$${spent} ceiling=$${ceiling} est=$${est} calls=${String(detail.callsMadeSoFar)} agent=${detail.agent}`;
}
