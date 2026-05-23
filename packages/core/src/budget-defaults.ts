/**
 * Operator-facing budget defaults — ADR 0032 §3 single source of truth.
 *
 * Every operator-facing budget exposes a `value` (the default) and an
 * `explainer` (one-line prose). The CLI's `--help` text, the Web Build form's
 * accordion hints, the project-metadata parser, and the directive-payload
 * validator all read from this module so the surfaces can't drift.
 *
 * Adding a new operator-facing axis: extend {@link BUDGET_AXES}, add a
 * `{value, explainer}` entry to {@link BUDGET_DEFAULTS}, add a matching
 * field to {@link budgetsSchema}, and update ADR 0032 §1's closed-set table.
 * Internal pacing constants do NOT belong here (ADR 0032 §2).
 *
 * @packageDocumentation
 */

import { z } from 'zod';

/**
 * The closed set of operator-facing budget axes — ADR 0032 §1.
 *
 * Order matches the table in the ADR so iteration produces a stable surface
 * (e.g. CLI `--help` post-text renders in this order).
 */
export const BUDGET_AXES = [
  'maxUsd',
  'maxSteps',
  'askUserDeadlineMs',
  'maxTurnsScaffolder',
  'maxTurnsBuilder',
  'maxTurnsFixer',
  'maxUsdPerTask',
  'maxWikiReadinessAttempts',
] as const;

export type BudgetAxis = (typeof BUDGET_AXES)[number];

/**
 * Default value + explainer for every operator-facing budget — ADR 0032 §3.
 *
 *   - **Values** are the seed defaults the resolver fills in when a tier
 *     (CLI / web form / project metadata / instance config) leaves the axis
 *     unset.
 *   - **Explainers** are reader-facing single-line prose. The CLI prints them
 *     verbatim in `--help` post-text; the Web Build form renders them as the
 *     accordion field's hint text; project-metadata documentation references
 *     them. Do not duplicate the prose elsewhere — grep `explainer` to confirm
 *     a value lives at exactly one site.
 *
 * `maxUsd` / `maxSteps` use `0` to mean "no ceiling" — matches the
 * pre-Tier-12 directive-limits convention where the field was absent.
 */
export const BUDGET_DEFAULTS: Readonly<Record<BudgetAxis, { value: number; explainer: string }>> = {
  maxUsd: {
    value: 0,
    explainer: 'Hard ceiling in USD across the whole build. 0 = unlimited (default).',
  },
  maxSteps: {
    value: 0,
    explainer: 'Hard ceiling on LLM call count across the build. 0 = unlimited (default).',
  },
  askUserDeadlineMs: {
    value: 300_000,
    explainer:
      'How long the brain waits on an askUser before falling back to LLM auto-answer (ADR 0030). 5 min default.',
  },
  maxTurnsScaffolder: {
    value: 120,
    explainer:
      'Per-task tool-conversation cap for the scaffolder. Higher for projects with >10 modules; default 120 covers most cases.',
  },
  maxTurnsBuilder: {
    value: 80,
    explainer:
      'Per-task tool-conversation cap for builders. Defaults to 80; broad cross-cutting builders may want 120–160.',
  },
  maxTurnsFixer: {
    value: 80,
    explainer: 'Per-task tool-conversation cap for fixers. Defaults to 80.',
  },
  maxUsdPerTask: {
    value: 0,
    explainer:
      'Per-task USD ceiling. 0 = unlimited (default). When the planner estimates a single task above this cap, the brain escalates via askUser before launching the worker (Phase 13.6).',
  },
  maxWikiReadinessAttempts: {
    value: 3,
    explainer:
      'Architect+critic cycles per build before escalating to operator (ADR 0033). 0 = unlimited.',
  },
};

/**
 * Input shape — partial budget payload. Every axis optional; the resolver
 * fills missing values from {@link BUDGET_DEFAULTS}. Used by CLI / web form /
 * project-metadata / directive-payload parsers (ADR 0032 §3).
 *
 * Validation semantics:
 *
 *   - `maxUsd` — nonnegative number (`0` = unlimited; decimals allowed for USD).
 *   - `maxSteps` — nonnegative integer (`0` = unlimited).
 *   - `askUserDeadlineMs` — positive integer (`0` would mean instant auto-answer,
 *     which is nonsensical; matches the pre-existing
 *     {@link factoryConfigFileSchema} constraint).
 *   - `maxTurns*` — positive integer (per-task cap; `0` would skip the task entirely).
 *
 * No upper bound — operator-facing budgets are operator-trust-bounded. The brain's
 * escalation path clamps custom-bump answers to `[10, 160]` per ADR 0032 §4 at
 * the answer-handling site, not at schema parse time.
 */
export const budgetsSchema = z
  .object({
    maxUsd: z.number().nonnegative(),
    maxSteps: z.number().int().nonnegative(),
    askUserDeadlineMs: z.number().int().positive(),
    maxTurnsScaffolder: z.number().int().positive(),
    maxTurnsBuilder: z.number().int().positive(),
    maxTurnsFixer: z.number().int().positive(),
    maxUsdPerTask: z.number().nonnegative(),
    maxWikiReadinessAttempts: z.number().int().nonnegative(),
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
    askUserDeadlineMs: input.askUserDeadlineMs ?? BUDGET_DEFAULTS.askUserDeadlineMs.value,
    maxTurnsScaffolder: input.maxTurnsScaffolder ?? BUDGET_DEFAULTS.maxTurnsScaffolder.value,
    maxTurnsBuilder: input.maxTurnsBuilder ?? BUDGET_DEFAULTS.maxTurnsBuilder.value,
    maxTurnsFixer: input.maxTurnsFixer ?? BUDGET_DEFAULTS.maxTurnsFixer.value,
    maxUsdPerTask: input.maxUsdPerTask ?? BUDGET_DEFAULTS.maxUsdPerTask.value,
    maxWikiReadinessAttempts:
      input.maxWikiReadinessAttempts ?? BUDGET_DEFAULTS.maxWikiReadinessAttempts.value,
  };
}
