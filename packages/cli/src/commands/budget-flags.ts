/**
 * Shared budget-flag wiring for `factory build` and `factory resume`.
 *
 * ADR 0032 §3 pins {@link BUDGET_DEFAULTS} as the single source of truth for
 * operator-facing budgets. This helper:
 *
 *   - Adds the six budget flags to a Commander command, using each axis's
 *     `explainer` from BUDGET_DEFAULTS verbatim as the option description.
 *   - Provides a {@link collectBudgetFlags} that splits Commander's parsed
 *     options into the on-the-wire shape: `maxUsd` / `maxSteps` keep flowing
 *     to `directive.limits` for ADR 0020 pre-call enforcement; the four
 *     Tier-12 axes flow to `directive.payload.budgets` per ADR 0032 §6.
 *
 * No new flags are wired here outside the BUDGET_AXES set; if a future tier
 * adds a budget axis, extend BUDGET_DEFAULTS and {@link AXIS_FLAG} below.
 *
 * @packageDocumentation
 */

import { BUDGET_AXES, BUDGET_DEFAULTS, type BudgetAxis } from '@factory5/core/budgets';
import type { Command } from 'commander';

/**
 * Kebab-case CLI flag name for each axis. Names mirror Commander's automatic
 * camelCase derivation (`--max-turns-scaffolder` → `maxTurnsScaffolder`) so
 * the option-bag key matches the BUDGET_AXES name without a separate mapping.
 *
 * Plan-deviation from §12.5: the plan listed `--ask-deadline-ms` for the
 * deadline axis. That would Commander-derive to `askDeadlineMs` (missing
 * "User"), creating a binding gap with `askUserDeadlineMs` everywhere else.
 * Renamed to `--ask-user-deadline-ms` here so the flag's camelCase derivation
 * matches the axis name exactly.
 */
const AXIS_FLAG: Record<BudgetAxis, string> = {
  maxUsd: '--max-usd',
  maxSteps: '--max-steps',
  askUserDeadlineMs: '--ask-user-deadline-ms',
  maxTurnsScaffolder: '--max-turns-scaffolder',
  maxTurnsBuilder: '--max-turns-builder',
  maxTurnsFixer: '--max-turns-fixer',
  maxUsdPerTask: '--max-usd-per-task',
  maxWikiReadinessAttempts: '--max-wiki-readiness-attempts',
};

/** Per-axis CLI value type — `usd` permits fractional dollars; everything else is integer. */
const AXIS_KIND: Record<BudgetAxis, 'usd' | 'int'> = {
  maxUsd: 'usd',
  maxSteps: 'int',
  askUserDeadlineMs: 'int',
  maxTurnsScaffolder: 'int',
  maxTurnsBuilder: 'int',
  maxTurnsFixer: 'int',
  maxUsdPerTask: 'usd',
  maxWikiReadinessAttempts: 'int',
};

function parsePositiveFloat(flag: string, raw: string): number {
  const n = Number.parseFloat(raw);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`${flag} must be a positive number, got: ${raw}`);
  }
  return n;
}

function parsePositiveInt(flag: string, raw: string): number {
  // parseInt silently truncates "120.5" → 120 which is a footgun for budget
  // flags (operator's typo becomes a different cap). Reject anything that
  // isn't a bare positive-integer string.
  if (!/^\d+$/.test(raw.trim())) {
    throw new Error(`${flag} must be a positive integer, got: ${raw}`);
  }
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) {
    throw new Error(`${flag} must be a positive integer, got: ${raw}`);
  }
  return n;
}

/**
 * Add the six Tier-12 budget flags to a Commander command. Each flag's
 * description is the matching {@link BUDGET_DEFAULTS} explainer verbatim
 * — single source of truth per ADR 0032 §3.
 *
 * Returns the same command for chaining.
 */
export function addBudgetFlags(cmd: Command): Command {
  for (const axis of BUDGET_AXES) {
    const flag = AXIS_FLAG[axis];
    const kind = AXIS_KIND[axis];
    const placeholder = kind === 'usd' ? '<n>' : axis === 'askUserDeadlineMs' ? '<ms>' : '<n>';
    const parser =
      kind === 'usd'
        ? (v: string): number => parsePositiveFloat(flag, v)
        : (v: string): number => parsePositiveInt(flag, v);
    cmd.option(`${flag} ${placeholder}`, BUDGET_DEFAULTS[axis].explainer, parser);
  }
  return cmd;
}

/**
 * Shape returned by {@link collectBudgetFlags} — splits operator-supplied
 * values into the directive-limits / directive-payload-budgets pair the
 * downstream insert paths expect.
 *
 * The split is a Tier-12 transitional: ADR 0020 `limits` already flows
 * through the pre-call enforcement chain (resolveDirectiveLimits + three-
 * tier merge). The four Tier-12 axes ride on `payload.budgets` until
 * step 12.6 wires the brain to consume them and step 12.7 unifies the
 * shape on resume inheritance.
 */
export interface CollectedBudgets {
  limits: { maxUsd?: number; maxSteps?: number };
  budgets: Partial<Record<BudgetAxis, number>>;
}

/** Type of the partial options bag Commander populates from {@link addBudgetFlags}. */
export type BudgetOptions = Partial<Record<BudgetAxis, number>>;

/**
 * Map Commander's parsed option bag onto the {@link CollectedBudgets} shape.
 * Caller passes the same options object Commander handed to its action.
 */
export function collectBudgetFlags(options: BudgetOptions): CollectedBudgets {
  const limits: CollectedBudgets['limits'] = {};
  if (options.maxUsd !== undefined) limits.maxUsd = options.maxUsd;
  if (options.maxSteps !== undefined) limits.maxSteps = options.maxSteps;

  const budgets: CollectedBudgets['budgets'] = {};
  if (options.askUserDeadlineMs !== undefined)
    budgets.askUserDeadlineMs = options.askUserDeadlineMs;
  if (options.maxTurnsScaffolder !== undefined)
    budgets.maxTurnsScaffolder = options.maxTurnsScaffolder;
  if (options.maxTurnsBuilder !== undefined) budgets.maxTurnsBuilder = options.maxTurnsBuilder;
  if (options.maxTurnsFixer !== undefined) budgets.maxTurnsFixer = options.maxTurnsFixer;
  if (options.maxUsdPerTask !== undefined) budgets.maxUsdPerTask = options.maxUsdPerTask;
  if (options.maxWikiReadinessAttempts !== undefined)
    budgets.maxWikiReadinessAttempts = options.maxWikiReadinessAttempts;

  return { limits, budgets };
}
