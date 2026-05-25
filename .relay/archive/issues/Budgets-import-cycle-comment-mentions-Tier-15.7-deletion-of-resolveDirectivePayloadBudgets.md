*Created: 2026-05-24*

# `projectBudgetDefaultsSchema` JSDoc still references Tier 15.4 `resolveDirectivePayloadBudgets` that Tier 15.7 deleted

**Severity:** P3 low — JSDoc-only drift on a heavily-read schema. No runtime impact.

## Problem statement

`packages/core/src/schemas.ts:105-130` includes:

```
 * For `maxUsd`/`maxSteps` the resolution lands on `directive.limits` via
 * {@link wiki.resolveDirectiveLimits}; for the other axes it lands on
 * `directive.payload.budgets` via a per-axis merge in the daemon (Tier 15.4:
 * `resolveDirectivePayloadBudgets` deleted; Tier 15.7 replaces with live
 * re-resolve via `computePoolUsage`). Same source key on disk; two consumers
 * because the legacy ADR 0020 path and the new ADR 0032 path persist to
 * different directive fields.
```

The parenthetical phrasing is confusingly written. Verified via grep:

```
$ grep -rn "resolveDirectivePayloadBudgets" packages --include="*.ts"
(no results in source files; only matches in docs/specs/plans)
```

So the function is in fact deleted. The JSDoc's statement is just confusingly worded — "Tier 15.4: `resolveDirectivePayloadBudgets` deleted" reads like an event happening in Tier 15.4, which is technically what happened per ROADMAP. The rest of the paragraph then says "Tier 15.7 replaces with live re-resolve via `computePoolUsage`" — but the replacement was actually 15.5/15.6/15.7 (the pool-usage module + dispatcher), and 15.9 retired the inline-fallback in server.ts.

The paragraph mixes two related but distinct changes:
1. Tier 15.4 — function deletion (wiki package)
2. Tier 15.5-15.7 — pool-usage live re-resolve (brain package)
3. Tier 15.9 — daemon server.ts inline fallback retirement (daemon package)

…and reads as if all of this is one event in Tier 15.4/15.7. Confusing for future readers.

## Current state

Per STATE.md and ROADMAP:
- Phase 13.5: `resolveDirectivePayloadBudgets` added to wiki package
- Phase 14.9: bug-fix replaced the hardcoded axis list with `BUDGET_AXES` iteration
- Phase 15.4: `resolveDirectivePayloadBudgets` deleted from wiki package (ROADMAP: "delete `resolveDirectivePayloadBudgets`")
- Phase 15.5-15.7: pool-usage + dispatcher live-resolve replacement
- Phase 15.9: daemon inline-fallback retirement

Function grep returns no matches in `packages/**/*.ts`. The schema JSDoc above is the only stale reference.

## Impact

Doc-debt only. Future contributors trying to understand the on-disk → directive flow get a confusing breadcrumb trail referencing Tier 15.4 (which is structural prep, not the merge change), Tier 15.7 (which is the pool rewrite), and a function name they can't trust to be findable.

## Proposed fix

Rewrite the JSDoc paragraph for accuracy:

```
 * For `maxUsd`/`maxSteps` the resolution lands on `directive.limits` via
 * {@link wiki.resolveDirectiveLimits} (mint-time-static; see ADR 0020). For the
 * other axes, Tier 15.9 retired the daemon-side per-axis merge — the
 * daemon now writes operator-supplied `payload.budgets` verbatim, and the
 * brain's `computePoolUsage` does live `max(project.json, payload.budgets,
 * BUDGET_DEFAULTS)` resolution on every consumption tick (ADR 0034 §1).
 * Same source key on disk; two consumers because the ADR 0020 pre-call
 * path and the ADR 0034 pool path persist to different directive fields.
```

Also verify whether `resolveDirectivePayloadBudgets` still exists. If not used anywhere, delete the function and update the wiki package's index/exports.

## Affected files

- `packages/core/src/schemas.ts:105-130` — JSDoc rewrite
- `packages/wiki/src/project-metadata.ts` — if `resolveDirectivePayloadBudgets` is dead, delete it
- `packages/wiki/src/index.ts` — drop export if function deleted
- `packages/wiki/src/project-metadata.test.ts` — test cleanup if function deleted
