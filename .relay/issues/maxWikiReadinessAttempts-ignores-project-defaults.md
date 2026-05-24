*Created: 2026-05-24*

# maxWikiReadinessAttempts axis ignores project.json defaults; only payload.budgets is consulted

**Severity:** P2 medium — same shape as the askUserDeadlineMs issue (non-pool axis only consulted from one tier), but lower impact: most operators don't tune this axis frequently, and `BUDGET_DEFAULTS.maxWikiReadinessAttempts.value = 3` is sensible. Still violates the ADR 0034 §1 three-way max-resolution rule that pool axes follow.

## Problem statement

ADR 0034 §1 says every budget axis cap should be resolved as:

```
effectiveCap[axis] = max(
  project.json.budgetDefaults[axis],
  directive.payload.budgets[axis],
  BUDGET_DEFAULTS[axis].value
)
```

For pool axes (`maxTurns*`, `maxUsd`, `maxSteps`) this is enforced in `computePoolUsage` (`packages/brain/src/pool-usage.ts:191-200`).

For `maxWikiReadinessAttempts`, the resolution at `packages/brain/src/loop.ts:301-307` consults ONLY `directive.payload.budgets` through `resolveBudgets`, which only fills missing axes from `BUDGET_DEFAULTS`:

```ts
// loop.ts:301-307
const directiveBudgets =
  typeof directive.payload === 'object' && directive.payload !== null
    ? ((directive.payload as Record<string, unknown>)['budgets'] as Budgets | undefined)
    : undefined;
const resolvedBudgets = resolveBudgets(directiveBudgets);
const maxAttempts = resolvedBudgets.maxWikiReadinessAttempts;
```

Project-level `metadata.budgetDefaults.maxWikiReadinessAttempts` is never read here. An operator who sets the project default to `5` on the Web UI Defaults tab still gets `3` (the BUDGET_DEFAULTS value) on every new build unless they also override at directive mint time.

Same pattern as the `askUserDeadlineMs` issue, but a separate filing because the fix site is different (loop.ts vs ask-user.ts).

## Current state

**Surfaces accept and persist the value:**
- CLI `--max-wiki-readiness-attempts` flag (`packages/cli/src/commands/budget-flags.ts:42`)
- Web Build form accordion (Phase 14.11 — `apps/factory-web/src/pages/build.astro`)
- Web Project page Defaults tab (Tier 15 — persists to project.json `metadata.budgetDefaults.maxWikiReadinessAttempts`)
- Discord `/budget max-wiki-readiness-attempts` (`packages/channels/src/discord-commands.ts:238`)
- Telegram `/budget --max-wiki-readiness-attempts` (`packages/channels/src/telegram.ts:1414-1417`)
- Per-directive override: `directive.payload.budgets.maxWikiReadinessAttempts` (Phase 14.9 — verified in `packages/daemon/src/server.test.ts:2384`)
- Per-project default: `project.json` `metadata.budgetDefaults.maxWikiReadinessAttempts` (Phase 13.5 widening + verified via `budgetDefaultsFromProjectMeta`)

**Brain consumer ignores the project-level default:**
- `packages/brain/src/loop.ts:301-307` — only `directive.payload.budgets` is read

## Impact

1. **Project-level "this project needs 5 attempts" config is silently inert.** Operator sets a non-default value on the Project page Defaults tab; subsequent `factory build` invocations (no per-build override) still cap at 3.
2. **Surface contract violation.** Operators can SET the value; the brain doesn't READ it. Same placebo problem as `askUserDeadlineMs`.
3. **Inconsistent with pool axes.** Pool axes (maxTurns*) follow ADR 0034's three-way max rule live. Non-pool axes don't. Operators have no way to predict which axes honor which tiers.

## Proposed fix

Extend `loop.ts:301-307` to consult `project.json` too:

```ts
const projectMeta = await loadOrCreateProjectMetadata(projectPath, /* projectName already in scope */);
const projectBudgets = budgetDefaultsFromProjectMeta(projectMeta) ?? {};
const directiveBudgets = /* existing extract */;
const maxAttempts = Math.max(
  projectBudgets.maxWikiReadinessAttempts ?? 0,
  directiveBudgets?.maxWikiReadinessAttempts ?? 0,
  BUDGET_DEFAULTS.maxWikiReadinessAttempts.value,
);
// Preserve the 0 = unlimited sentinel handling that runArchitectWithCritique already implements
```

Alternatively (cleaner): introduce a generic `resolveNonPoolAxis` helper that mirrors `pool-usage.ts:191-200`'s `resolveEffectiveCap` but for the three non-pool axes (`askUserDeadlineMs`, `maxUsdPerTask`, `maxWikiReadinessAttempts`). Move it to `@factory5/core/budgets` so brain, daemon, and ask-user can all share it.

## Affected files

- `packages/brain/src/loop.ts` — extend resolution to read project.json
- `packages/wiki/src/project-metadata.ts` — possible re-export of resolution helper
- `packages/core/src/budget-defaults.ts` — possible new `resolveAxisCap(axis, project, payload)` helper
- Tests in `packages/brain/src/loop.test.ts` and `packages/wiki/src/project-metadata.test.ts` for the new resolution

This issue + the askUserDeadlineMs sibling could be fixed in a single tier ("non-pool axis resolution unification") if the cost of one helper is acceptable. Separately filed because they're structurally independent and the operator-impact is different.
