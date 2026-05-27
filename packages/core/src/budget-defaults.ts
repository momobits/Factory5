/**
 * Operator-facing budget defaults — ADR 0035 canonical table (single source of truth).
 *
 * Every operator-facing budget exposes a `value` (the default), an `explainer`
 * (one-line prose), a `type` (enforcement granularity), and an
 * `autoIncreaseEligible` flag. The CLI's `--help` text, the Web Build form's
 * accordion hints, the project-metadata parser, and the directive-payload
 * validator all read from this module so the surfaces can't drift.
 *
 * Adding a new operator-facing axis: extend {@link BUDGET_AXES}, add a
 * {@link BudgetAxisDefinition} entry to {@link BUDGET_DEFAULTS}, add a matching
 * field to {@link budgetsSchema}, and update ADR 0035's closed-set table.
 * Internal pacing constants do NOT belong here (ADR 0035 §2).
 *
 * @packageDocumentation
 */

import { z } from 'zod';

/**
 * The closed set of operator-facing budget axes — ADR 0035 canonical table.
 *
 * Order matches the table in the ADR so iteration produces a stable surface
 * (e.g. CLI `--help` post-text renders in this order).
 */
export const BUDGET_AXES = [
  'maxUsd',
  'maxSteps',
  'maxTurnsScaffolder',
  'maxTurnsBuilder',
  'maxTurnsFixer',
  'maxTotalTurns',
  'maxUsdPerTask',
  'maxRetriesPerTask',
  'askUserDeadlineMs',
  'maxWikiReadinessAttempts',
  'maxWallClockMinutes',
  'maxConcurrentTasks',
] as const;

export type BudgetAxis = (typeof BUDGET_AXES)[number];

/**
 * Enforcement type for a budget axis — ADR 0035.
 *
 * - `pool` — enforced at the directive level; all tasks share one pool.
 * - `per-task` — enforced independently for each task.
 * - `per-question` — enforced per pending-question instance.
 * - `per-directive` — enforced once for the entire directive lifecycle.
 */
export type AxisType = 'pool' | 'per-task' | 'per-question' | 'per-directive';

/**
 * Shape of a single axis entry in {@link BUDGET_DEFAULTS} — ADR 0035.
 */
export interface BudgetAxisDefinition {
  /** Seed default the resolver fills when a tier leaves the axis unset. */
  value: number;
  /** Reader-facing single-line prose (CLI --help, Web form hint). */
  explainer: string;
  /** Enforcement granularity classification (ADR 0035). */
  type: AxisType;
  /** Whether the auto-increase toggle (ADR 0034) applies to this axis. */
  autoIncreaseEligible: boolean;
}

/**
 * Default value + explainer + type + auto-increase eligibility for every
 * operator-facing budget — ADR 0035 canonical table.
 *
 *   - **Values** are the seed defaults the resolver fills in when a tier
 *     (CLI / web form / project metadata / instance config) leaves the axis
 *     unset.
 *   - **Explainers** are reader-facing single-line prose. The CLI prints them
 *     verbatim in `--help` post-text; the Web Build form renders them as the
 *     accordion field's hint text; project-metadata documentation references
 *     them. Do not duplicate the prose elsewhere — grep `explainer` to confirm
 *     a value lives at exactly one site.
 *   - **Type** classifies the enforcement granularity (pool / per-task /
 *     per-question / per-directive).
 *   - **autoIncreaseEligible** marks whether the axis participates in the
 *     auto-increase bumping flow (ADR 0034 §5).
 *
 * `0` means "no ceiling" for pool and per-directive axes — matches the
 * pre-Tier-12 directive-limits convention where the field was absent.
 */
export const BUDGET_DEFAULTS: Readonly<Record<BudgetAxis, BudgetAxisDefinition>> = {
  maxUsd: {
    value: 0,
    explainer: 'Total USD spend for the entire build across all agent calls. 0 = unlimited.',
    type: 'pool',
    autoIncreaseEligible: true,
  },
  maxSteps: {
    value: 0,
    explainer: 'Total LLM calls for the entire build across all agents. 0 = unlimited.',
    type: 'pool',
    autoIncreaseEligible: true,
  },
  maxTurnsScaffolder: {
    value: 120,
    explainer: 'Total tool-use turns across all scaffolder tasks.',
    type: 'pool',
    autoIncreaseEligible: true,
  },
  maxTurnsBuilder: {
    value: 80,
    explainer: 'Total tool-use turns across all builder tasks.',
    type: 'pool',
    autoIncreaseEligible: true,
  },
  maxTurnsFixer: {
    value: 80,
    explainer: 'Total tool-use turns across all fixer tasks.',
    type: 'pool',
    autoIncreaseEligible: true,
  },
  maxTotalTurns: {
    value: 0,
    explainer: 'Total tool-use turns across ALL agent classes combined. 0 = unlimited.',
    type: 'pool',
    autoIncreaseEligible: true,
  },
  maxUsdPerTask: {
    value: 0,
    explainer: 'Maximum USD a single task may spend before it fails. 0 = unlimited.',
    type: 'per-task',
    autoIncreaseEligible: false,
  },
  maxRetriesPerTask: {
    value: 3,
    explainer: 'Maximum times a single task is retried (including auto-bumps).',
    type: 'per-task',
    autoIncreaseEligible: false,
  },
  askUserDeadlineMs: {
    value: 300_000,
    explainer: 'Time before auto-answer fires on a pending question. Default 5 min.',
    type: 'per-question',
    autoIncreaseEligible: false,
  },
  maxWikiReadinessAttempts: {
    value: 3,
    explainer: 'Architect-critic retry cycles before escalation. 0 = unlimited.',
    type: 'per-directive',
    autoIncreaseEligible: true,
  },
  maxWallClockMinutes: {
    value: 0,
    explainer: 'Total wall-clock time for the build before directive parks. 0 = unlimited.',
    type: 'per-directive',
    autoIncreaseEligible: true,
  },
  maxConcurrentTasks: {
    value: 4,
    explainer: 'Concurrent task slots in the pool dispatcher.',
    type: 'per-directive',
    autoIncreaseEligible: false,
  },
};

/**
 * Input shape — partial budget payload. Every axis optional; the resolver
 * fills missing values from {@link BUDGET_DEFAULTS}. Used by CLI / web form /
 * project-metadata / directive-payload parsers (ADR 0035).
 *
 * Validation semantics:
 *
 *   - `maxUsd` — nonnegative number (`0` = unlimited; decimals allowed for USD).
 *   - `maxSteps` — nonnegative integer (`0` = unlimited).
 *   - `maxTurnsScaffolder|Builder|Fixer` — positive integer (pool cap; `0`
 *     would skip the agent class entirely).
 *   - `maxTotalTurns` — nonnegative integer (`0` = unlimited).
 *   - `maxUsdPerTask` — nonnegative number (`0` = unlimited; decimals allowed).
 *   - `maxRetriesPerTask` — nonnegative integer (`0` = unlimited retries).
 *   - `askUserDeadlineMs` — positive integer (`0` would mean instant auto-answer,
 *     which is nonsensical; matches the pre-existing
 *     {@link factoryConfigFileSchema} constraint).
 *   - `maxWikiReadinessAttempts` — nonnegative integer (`0` = unlimited).
 *   - `maxWallClockMinutes` — nonnegative integer (`0` = unlimited).
 *   - `maxConcurrentTasks` — positive integer (at least 1 slot needed).
 *
 * No upper bound — operator-facing budgets are operator-trust-bounded.
 */
export const budgetsSchema = z
  .object({
    maxUsd: z.number().nonnegative(),
    maxSteps: z.number().int().nonnegative(),
    maxTurnsScaffolder: z.number().int().positive(),
    maxTurnsBuilder: z.number().int().positive(),
    maxTurnsFixer: z.number().int().positive(),
    maxTotalTurns: z.number().int().nonnegative(),
    maxUsdPerTask: z.number().nonnegative(),
    maxRetriesPerTask: z.number().int().nonnegative(),
    askUserDeadlineMs: z.number().int().positive(),
    maxWikiReadinessAttempts: z.number().int().nonnegative(),
    maxWallClockMinutes: z.number().int().nonnegative(),
    maxConcurrentTasks: z.number().int().positive(),
    /**
     * Per-project stream-read timeout, milliseconds. When set, the brain's
     * claude-cli provider aborts the task's event stream after this many ms
     * of inactivity. Optional — absent means the provider's built-in default
     * applies. Not a budget axis (not in {@link BUDGET_AXES}); lives here for
     * discoverability alongside the other per-project runtime knobs that share
     * the `metadata.budgetDefaults` object in `project.json`.
     */
    taskStreamTimeoutMs: z.number().int().positive().optional(),
    /**
     * Per-project transcript log level. Controls what NDJSON lines get written
     * to the task transcript file. `full` = all events, `tools` = tool_use /
     * tool_result / result only, `off` = no transcript. Optional — absent means
     * `full` is applied at runtime. Not a budget axis (not in {@link BUDGET_AXES});
     * lives here for discoverability alongside the other per-project runtime knobs
     * that share the `metadata.budgetDefaults` object in `project.json`.
     */
    transcriptLevel: z.enum(['full', 'tools', 'off']).optional(),
  })
  .partial();

/** Partial input shape — every field optional. Mirrors the on-disk / on-wire layout. */
export type Budgets = z.infer<typeof budgetsSchema>;

/**
 * Resolved shape — every field present, defaults applied. Distinct from
 * {@link Budgets} so consumers (planner, pool, worker) can rely on a complete
 * object without re-walking the resolution chain (ADR 0032 §6).
 */
export type ResolvedBudgets = { [K in BudgetAxis]: number };

// -----------------------------------------------------------------------------
// Tier 15 / ADR 0034 — per-agent turn-pool axis helpers
// -----------------------------------------------------------------------------

/**
 * The three `maxTurns*` pool axes that tool-using agents draw against
 * (ADR 0034). Defined in `@factory5/core` so both `pool-usage.ts` (aggregation)
 * and `pool.ts` (dispatcher) can import without a brain-internal cycle.
 *
 * Non-tool-using agents (critic, planner, architect) do not have a pool axis
 * and return `undefined` from {@link axisForAgent}.
 */
export type MaxTurnsAxis = 'maxTurnsScaffolder' | 'maxTurnsBuilder' | 'maxTurnsFixer';

/** @internal Mapping from agent role string to its pool axis. */
const AGENT_TO_AXIS: Record<string, MaxTurnsAxis | undefined> = {
  scaffolder: 'maxTurnsScaffolder',
  builder: 'maxTurnsBuilder',
  fixer: 'maxTurnsFixer',
};

/**
 * Resolve the `maxTurns*` pool axis for a given tool-using agent class.
 * Returns `undefined` for non-tool-using agents (critic, planner, architect)
 * that do not draw against a turn pool (ADR 0034 §1).
 *
 * Co-exists with the identical helper in `packages/brain/src/budget-escalation.ts`
 * until Tier 15.8 deletes that file. Tier 15.5+ consumers (`pool-usage.ts`,
 * `pool.ts`) import from `@factory5/core` exclusively.
 */
export function axisForAgent(agent: string): MaxTurnsAxis | undefined {
  return AGENT_TO_AXIS[agent];
}

/**
 * Collapse a partial budget input against {@link BUDGET_DEFAULTS} and return
 * a fully-populated object. The resolver is the boundary between the
 * optional-everywhere wire shape and the always-complete in-memory shape the
 * brain works with.
 *
 * No four-tier merge happens here — caller is responsible for layering
 * `instance config` → `project metadata` → `directive payload` → `CLI override`
 * before passing the merged partial into this function (ADR 0032 §1).
 */
export function resolveBudgets(partial?: Budgets): ResolvedBudgets {
  const input = partial ?? {};
  return {
    maxUsd: input.maxUsd ?? BUDGET_DEFAULTS.maxUsd.value,
    maxSteps: input.maxSteps ?? BUDGET_DEFAULTS.maxSteps.value,
    maxTurnsScaffolder: input.maxTurnsScaffolder ?? BUDGET_DEFAULTS.maxTurnsScaffolder.value,
    maxTurnsBuilder: input.maxTurnsBuilder ?? BUDGET_DEFAULTS.maxTurnsBuilder.value,
    maxTurnsFixer: input.maxTurnsFixer ?? BUDGET_DEFAULTS.maxTurnsFixer.value,
    maxTotalTurns: input.maxTotalTurns ?? BUDGET_DEFAULTS.maxTotalTurns.value,
    maxUsdPerTask: input.maxUsdPerTask ?? BUDGET_DEFAULTS.maxUsdPerTask.value,
    maxRetriesPerTask: input.maxRetriesPerTask ?? BUDGET_DEFAULTS.maxRetriesPerTask.value,
    askUserDeadlineMs: input.askUserDeadlineMs ?? BUDGET_DEFAULTS.askUserDeadlineMs.value,
    maxWikiReadinessAttempts:
      input.maxWikiReadinessAttempts ?? BUDGET_DEFAULTS.maxWikiReadinessAttempts.value,
    maxWallClockMinutes: input.maxWallClockMinutes ?? BUDGET_DEFAULTS.maxWallClockMinutes.value,
    maxConcurrentTasks: input.maxConcurrentTasks ?? BUDGET_DEFAULTS.maxConcurrentTasks.value,
  };
}
