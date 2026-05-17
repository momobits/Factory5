/**
 * Tier 12 / ADR 0032 §4 — budget-trip askUser escalation.
 *
 * When a worker reports `error_max_turns`, the brain's pool calls
 * {@link escalateBudgetTrip}, which:
 *
 *   1. Builds a structured prompt naming the failing task, the axis that
 *      tripped, the current cap, and the suggested next-bucket bump.
 *   2. Calls {@link askUser} with that prompt + the canonical option list
 *      `[accept, custom <n>, abort]`. The question text is prefixed with
 *      {@link BUDGET_ESCALATION_MARKER} so the Tier-8 auto-answer dispatcher
 *      can pattern-match the question type and apply its deterministic
 *      bump-then-abort policy (no LLM call).
 *   3. Parses the operator's (or auto-answer's) reply via
 *      {@link parseBudgetEscalationAnswer}.
 *   4. Returns a {@link BudgetEscalationOutcome} discriminated by the
 *      chosen action, so the pool can either retry with the bumped value
 *      or fall through to the failed-task path.
 *
 * The clamps + bucket schedule live in this module so they have a single
 * test surface; the brain's pool stays a pure orchestrator.
 *
 * @packageDocumentation
 */

import type { Directive, Task } from '@factory5/core';
import { BUDGET_DEFAULTS } from '@factory5/core/budgets';
import { createLogger } from '@factory5/logger';
import type { Database } from '@factory5/state';

import { askUser } from './ask-user.js';

const log = createLogger('brain.budget-escalation');

/**
 * Hard clamp range for any operator-supplied or auto-bumped `maxTurns` value.
 * ADR 0032 §4 — `custom <n>` is clamped to `[10, 160]` so a typo can't ship
 * 50000-turn budgets or zero-turn caps.
 */
export const MAX_TURNS_CLAMP_MIN = 10;
export const MAX_TURNS_CLAMP_MAX = 160;

/**
 * Prefix the brain stamps on every budget-escalation question. The auto-
 * answer dispatcher recognises this marker and runs its deterministic
 * policy instead of dispatching to an LLM. Operators see the marker too;
 * it doubles as a visual classifier in the dashboard.
 *
 * Kept short + bracketed so it's pattern-matchable without being noisy.
 */
export const BUDGET_ESCALATION_MARKER = '[BUDGET]';

/** Per-axis bump schedule for the auto-answer policy + the "suggested next" hint. */
const BUMP_BUCKETS: Record<MaxTurnsAxis, readonly number[]> = {
  maxTurnsScaffolder: [80, 120, 160],
  maxTurnsBuilder: [80, 160],
  maxTurnsFixer: [80, 160],
};

export type MaxTurnsAxis = 'maxTurnsScaffolder' | 'maxTurnsBuilder' | 'maxTurnsFixer';

/** Worker classes that map onto a `maxTurns*` budget axis. */
const AGENT_TO_AXIS: Record<string, MaxTurnsAxis | undefined> = {
  scaffolder: 'maxTurnsScaffolder',
  builder: 'maxTurnsBuilder',
  fixer: 'maxTurnsFixer',
};

/** Resolve the `maxTurns*` axis for a given tool-using agent role. */
export function axisForAgent(agent: string): MaxTurnsAxis | undefined {
  return AGENT_TO_AXIS[agent];
}

/**
 * Safely extract `payload.budgets` from a directive. Returns an empty object
 * (not undefined) when the directive lacks the field or has an unexpected
 * shape, so callers can treat the result as a partial Budgets bag.
 */
export function budgetsFromDirective(directive: Directive): Record<string, number> {
  if (typeof directive.payload !== 'object' || directive.payload === null) return {};
  const payload = directive.payload as Record<string, unknown>;
  const raw = payload['budgets'];
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
  }
  return out;
}

/**
 * Compute the effective `maxTurns` cap for a given task. Phase 13.3 / U033
 * semantic: the operator's `directive.payload.budgets[axis]` is a CEILING;
 * the planner's per-task emit is refined downward within it.
 *
 * Resolution:
 *
 *   1. If the planner emitted `task.maxTurns` AND the operator set a
 *      positive ceiling on this axis, return `min(task.maxTurns, ceiling)`.
 *   2. If the planner emitted `task.maxTurns` and the operator did NOT
 *      set the axis (or set it to 0 — the "no ceiling" sentinel), return
 *      `task.maxTurns` unchanged.
 *   3. If the planner did NOT emit and the operator set a positive value,
 *      return the operator value.
 *   4. Otherwise return `BUDGET_DEFAULTS[axis].value`.
 *
 * Returns `undefined` for read-only agents (no maxTurns axis). Tool-using
 * agents always get a concrete number.
 *
 * Pre-fix (Phase 12.7) the order was `task.maxTurns > payload.budgets >
 * default`, which meant the planner's per-task emit always shadowed the
 * operator's directive budget — Phase 12's deferred smoke surfaced this
 * as U033 (operator-set `maxTurnsScaffolder=10` had no observable effect;
 * scaffolder ran at the planner's 40). The fix flips the relationship to
 * ceiling-and-refine so the documented Phase 12 promise — "set a low
 * maxTurns in the UI → [BUDGET] askUser fires before the build burns
 * past the cap" — materialises from the operator surface.
 *
 * The `payload.budgets` semantic this builds on is overrides-only (see
 * ADR 0032 §6 + the Phase 12 retro note in STATE.md): the field carries
 * only axes the operator explicitly set; absent axes mean "no operator
 * override". The 0-sentinel handling matches the `maxUsd`/`maxSteps`
 * pattern from ADR 0020 where `0 = unlimited`.
 */
export function resolveTaskMaxTurns(task: Task, directive: Directive): number | undefined {
  const axis = axisForAgent(task.agent);
  if (axis === undefined) return undefined;
  const fromPayload = budgetsFromDirective(directive)[axis];
  const operatorCeiling = fromPayload !== undefined && fromPayload > 0 ? fromPayload : undefined;
  if (task.maxTurns !== undefined) {
    if (operatorCeiling !== undefined) return Math.min(task.maxTurns, operatorCeiling);
    return task.maxTurns;
  }
  if (operatorCeiling !== undefined) return operatorCeiling;
  return BUDGET_DEFAULTS[axis].value;
}

/**
 * Compute the next-bucket bump for an axis given the current cap. Returns
 * the smallest bucket strictly greater than `currentValue`, or `undefined`
 * if the axis is already at or above the maximum bucket (no further bump
 * makes sense; caller should treat as abort-default).
 */
export function suggestedNextBucket(axis: MaxTurnsAxis, currentValue: number): number | undefined {
  for (const bucket of BUMP_BUCKETS[axis]) {
    if (bucket > currentValue) return bucket;
  }
  return undefined;
}

export interface EscalateBudgetTripOptions {
  db: Database;
  directiveId: string;
  taskId: string;
  taskTitle: string;
  axis: MaxTurnsAxis;
  currentValue: number;
  signal?: AbortSignal;
  /** Test-only — passed straight through to {@link askUser}. */
  pollIntervalMs?: number;
}

export type BudgetEscalationOutcome =
  | { kind: 'accept'; newValue: number }
  | { kind: 'custom'; newValue: number }
  | { kind: 'abort'; reason: 'operator' | 'timeout' | 'aborted' | 'parse-failed' };

/**
 * Format the prompt the operator + auto-answer see. Includes the budget
 * context inline (axis, current, suggested) so the operator's reply
 * doesn't need to know the context separately.
 */
export function renderBudgetEscalationQuestion(opts: {
  taskTitle: string;
  axis: MaxTurnsAxis;
  currentValue: number;
  suggestedNext: number | undefined;
}): string {
  const bumpHint =
    opts.suggestedNext !== undefined
      ? `accept = bump to ${String(opts.suggestedNext)}`
      : `no next bucket — type 'abort' or 'custom <n>' to override`;
  return [
    `${BUDGET_ESCALATION_MARKER} Task "${opts.taskTitle}" ran out of turns.`,
    `Axis: ${opts.axis}. Current cap: ${String(opts.currentValue)}.`,
    `Choose: '${bumpHint}', 'custom <n>' to set a value in [${String(MAX_TURNS_CLAMP_MIN)}, ${String(MAX_TURNS_CLAMP_MAX)}], or 'abort' to fail the task.`,
  ].join('\n');
}

/**
 * Parse the operator's (or auto-answer's) reply into a typed action.
 *
 * Recognises:
 *   - `accept` (case-insensitive) — return suggestedNext if it exists; else abort.
 *   - `custom <n>` — parse the integer tail; clamp to `[10, 160]`.
 *   - `abort` — abort.
 *   - anything else — parse-failed → abort (defensive default).
 */
export function parseBudgetEscalationAnswer(
  answer: string,
  suggestedNext: number | undefined,
): BudgetEscalationOutcome {
  const trimmed = answer.trim().toLowerCase();
  if (trimmed === 'accept') {
    if (suggestedNext === undefined) {
      return { kind: 'abort', reason: 'parse-failed' };
    }
    return { kind: 'accept', newValue: suggestedNext };
  }
  if (trimmed === 'abort') {
    return { kind: 'abort', reason: 'operator' };
  }
  const customMatch = /^custom\s+(\d+)$/.exec(trimmed);
  if (customMatch !== null) {
    const raw = Number.parseInt(customMatch[1] ?? '', 10);
    if (!Number.isFinite(raw)) return { kind: 'abort', reason: 'parse-failed' };
    const clamped = Math.max(MAX_TURNS_CLAMP_MIN, Math.min(MAX_TURNS_CLAMP_MAX, raw));
    return { kind: 'custom', newValue: clamped };
  }
  return { kind: 'abort', reason: 'parse-failed' };
}

/**
 * Park the failing task on a {@link BUDGET_ESCALATION_MARKER}-stamped
 * askUser. Resolves once a reply (human or auto-answer) lands, the
 * deadline passes, or the signal aborts.
 *
 * The pool should treat `kind === 'accept' | 'custom'` as a retry signal
 * (re-run the worker with `maxTurns = newValue`) and `kind === 'abort'`
 * as the failed-task path.
 */
export async function escalateBudgetTrip(
  opts: EscalateBudgetTripOptions,
): Promise<BudgetEscalationOutcome> {
  const suggestedNext = suggestedNextBucket(opts.axis, opts.currentValue);
  const question = renderBudgetEscalationQuestion({
    taskTitle: opts.taskTitle,
    axis: opts.axis,
    currentValue: opts.currentValue,
    suggestedNext,
  });
  const options =
    suggestedNext !== undefined
      ? [
          'accept',
          `custom <n> in [${String(MAX_TURNS_CLAMP_MIN)}, ${String(MAX_TURNS_CLAMP_MAX)}]`,
          'abort',
        ]
      : [`custom <n> in [${String(MAX_TURNS_CLAMP_MIN)}, ${String(MAX_TURNS_CLAMP_MAX)}]`, 'abort'];

  log.info(
    {
      directiveId: opts.directiveId,
      taskId: opts.taskId,
      taskTitle: opts.taskTitle,
      axis: opts.axis,
      currentValue: opts.currentValue,
      suggestedNext,
    },
    'budget-escalation: raising askUser',
  );

  const result = await askUser({
    db: opts.db,
    directiveId: opts.directiveId,
    taskId: opts.taskId,
    question,
    options,
    ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
    ...(opts.pollIntervalMs !== undefined ? { pollIntervalMs: opts.pollIntervalMs } : {}),
  });

  if (result.aborted) {
    return { kind: 'abort', reason: 'aborted' };
  }
  if (result.timedOut || result.answer === undefined) {
    return { kind: 'abort', reason: 'timeout' };
  }
  return parseBudgetEscalationAnswer(result.answer, suggestedNext);
}
