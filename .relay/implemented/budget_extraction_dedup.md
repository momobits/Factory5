# Issue: pool/pool-resume budget-extraction dedup (S2)

*Created: 2026-05-25*
*Source: [projectBudgetsFromMetadata-duplicated-between-pool-and-pool-resume.md](../archive/projectBudgetsFromMetadata-duplicated-between-pool-and-pool-resume.md)*
*Status: IMPLEMENTED*
*Commit: `4d96ed8`*

## Summary

Extracted the duplicated `projectBudgetsFromMetadata` helper (and its `isRecord` type-guard) from three brain modules into a single exported function in `pool-usage.ts`, co-located with the `ProjectBudgetsLike` type it returns.

## Changes

| File | Change |
|------|--------|
| `packages/brain/src/pool-usage.ts` | Added exported `projectBudgetsFromMetadata` function |
| `packages/brain/src/pool.ts` | Removed local `projectBudgetsFromMetadata`; import from pool-usage |
| `packages/brain/src/pool-resume.ts` | Replaced 20-line inline extraction with one-line call; removed local `isRecord` |
| `packages/brain/src/loop.ts` | Replaced 15-line inline extraction in `loadProjectBudgetsForDirective` with one-line call; removed unused `BudgetAxis` import |
| `packages/brain/src/pool-usage.test.ts` | Added 8 unit tests for the shared helper |

## Design Rationale

Option 3 from the issue spec (brain-internal helper in pool-usage.ts) was chosen over option 2 (wiki) because `ProjectBudgetsLike` is defined in pool-usage.ts and placing the transform next to the type it returns avoids cross-package coupling. All three consumers already imported from `./pool-usage.js`.
