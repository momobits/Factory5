*Created: 2026-05-24*

# `projectBudgetsFromMetadata` extraction logic duplicated between `pool.ts` and `pool-resume.ts`

**Severity:** P3 low — code-debt. Tier 15 introduced two readers of `<project>/.factory/project.json` metadata into `ProjectBudgetsLike` shape; both packages live inside `packages/brain/src/` and both duplicate the same five lines of `isRecord` + type-narrowing + spread for the Tier 15 scalars.

## Problem statement

`packages/brain/src/pool.ts:204-222` defines `projectBudgetsFromMetadata`:

```ts
function projectBudgetsFromMetadata(metadata: ProjectMetadata): ProjectBudgetsLike {
  const rawBudgetDefaults = metadata.metadata['budgetDefaults'];
  const budgetDefaults: Partial<Record<BudgetAxis, number>> = isRecord(rawBudgetDefaults)
    ? (rawBudgetDefaults as Partial<Record<BudgetAxis, number>>)
    : {};
  const autoIncreaseBudgets =
    typeof metadata.metadata['autoIncreaseBudgets'] === 'boolean'
      ? metadata.metadata['autoIncreaseBudgets']
      : undefined;
  const autoIncreaseCeilingMultiplier =
    typeof metadata.metadata['autoIncreaseCeilingMultiplier'] === 'number'
      ? metadata.metadata['autoIncreaseCeilingMultiplier']
      : undefined;
  return {
    budgetDefaults,
    ...(autoIncreaseBudgets !== undefined ? { autoIncreaseBudgets } : {}),
    ...(autoIncreaseCeilingMultiplier !== undefined ? { autoIncreaseCeilingMultiplier } : {}),
  };
}
```

`packages/brain/src/pool-resume.ts:188-212` repeats the same pattern inline (not factored into a helper):

```ts
const rawBudgetDefaults = metadata.metadata['budgetDefaults'];
const budgetDefaults: Partial<Record<BudgetAxis, number>> = isRecord(rawBudgetDefaults)
  ? (rawBudgetDefaults as Partial<Record<BudgetAxis, number>>)
  : {};
const autoIncreaseBudgets =
  typeof metadata.metadata['autoIncreaseBudgets'] === 'boolean'
    ? metadata.metadata['autoIncreaseBudgets']
    : undefined;
const autoIncreaseCeilingMultiplier =
  typeof metadata.metadata['autoIncreaseCeilingMultiplier'] === 'number'
    ? metadata.metadata['autoIncreaseCeilingMultiplier']
    : undefined;
projectBudgets = {
  budgetDefaults,
  ...(autoIncreaseBudgets !== undefined ? { autoIncreaseBudgets } : {}),
  ...(autoIncreaseCeilingMultiplier !== undefined ? { autoIncreaseCeilingMultiplier } : {}),
};
```

Two identical extractions in the same brain package. Both also redefine the same `isRecord` type-guard:
- `pool.ts:225-227`
- `pool-resume.ts:281-283`

## Current state

The two consumers both want a `ProjectBudgetsLike` from a `ProjectMetadata`. Tier 15 added the two scalars without extracting a shared helper. Daemon's server.ts also reads these scalars for the PUT response shape (`packages/daemon/src/server.ts:1349,1539`) but uses `budgetDefaultsFromProjectMeta` from `@factory5/wiki` for the budgetDefaults portion and inline reads for the scalars (a third extraction pattern).

## Impact

1. **Tier-16 axis-addition risk.** When the next tier adds a scalar (e.g., `defaultAgentCategory`), three call sites need updating. Easy to miss one. Phase 14.9 incident proved this: a hardcoded 6-axis list in `resolveDirectivePayloadBudgets` silently dropped Phase 13.6's `maxUsdPerTask` axis for 6 days before incidental discovery. The 2-scalar extraction is one step away from the same pattern.
2. **Test surface duplication.** Each extraction site has its own tests; a new scalar requires test changes in three places.
3. **`isRecord` helper duplicated.** Tiny but indicative — the file structure doesn't have a place for "tiny brain-internal utils" so a 3-line type-guard gets copy-pasted.

## Proposed fix

Hoist `projectBudgetsFromMetadata` (and `isRecord`) to a shared module. Options:

1. **Export from `@factory5/core/budgets`** — the shape `ProjectBudgetsLike` is already a brain-internal interface; could move to core alongside `BUDGET_AXES`. Best for cross-package consumers (wiki, daemon, brain).
2. **Export from `@factory5/wiki/project-metadata`** — the wiki package owns the on-disk format; adding a `projectBudgetsFromMetadata` reader keeps the I/O boundary clean. Brain imports from `@factory5/wiki`.
3. **Create a brain-internal helper file** — `packages/brain/src/project-budgets.ts` — and import from both pool.ts and pool-resume.ts. Minimal blast radius but doesn't help cross-package consumers.

Recommend option 2. The wiki package already owns `budgetDefaultsFromProjectMeta` (extracts only the `budgetDefaults` key); adding a fuller `projectBudgetsFromMetadata` that includes the two scalars is a natural extension. Brain becomes a one-line consumer.

## Affected files

- `packages/wiki/src/project-metadata.ts` — add `projectBudgetsFromMetadata` helper (or extend existing `budgetDefaultsFromProjectMeta`)
- `packages/wiki/src/index.ts` — export new helper
- `packages/brain/src/pool.ts` — replace local `projectBudgetsFromMetadata` + `isRecord` with imports
- `packages/brain/src/pool-resume.ts` — replace inline extraction + `isRecord` with imports
- `packages/daemon/src/server.ts:1349,1539` + `packages/daemon/src/index.ts:297,356` — possibly switch to new helper if shape matches
- Tests: add coverage in `packages/wiki/src/project-metadata.test.ts`; remove duplicates from brain tests
