# Issue: Doc hygiene sweep (S3)

*Created: 2026-05-25*
*Source: [apiV1UpdateProjectBudgetRequestSchema-deprecated-alias-not-backward-compatible.md](../archive/issues/apiV1UpdateProjectBudgetRequestSchema-deprecated-alias-not-backward-compatible.md) + 3 companion issues*
*Status: IMPLEMENTED*

## Summary

Resolved 4 stale documentation/dead-code references left over from the budget axis unification (Tiers 15.4-15.9):

1. **Deleted misleading deprecated alias** — `apiV1UpdateProjectBudgetRequestSchema` in `packages/ipc/src/schemas.ts` claimed backward compatibility but pointed at the new wrapped shape. Zero in-repo consumers; deletion gives external consumers a clear compile error instead of a silent runtime 400.

2. **Updated planner prompt wording** — `packages/brain/src/planner.ts:256-259` referenced the deleted "askUser" escalation flow. Updated to reference the current pool pre-launch check (`pool.ts:555-577`).

3. **Rewrote `errorSubtype` JSDoc** — `packages/core/src/schemas.ts` referenced ADR 0032 (superseded) and claimed only one subtype value. Updated to reference ADR 0034 and document all four known subtypes.

4. **Rewrote `projectBudgetDefaultsSchema` JSDoc** — `packages/core/src/schemas.ts` referenced the deleted `resolveDirectivePayloadBudgets` function with confusing tier-version phrasing. Updated to describe the current live-resolution via `computePoolUsage` (ADR 0034 §1).

## Changes

| File | Change |
|------|--------|
| `packages/ipc/src/schemas.ts` | Deleted lines 650-658 (deprecated alias + type) |
| `packages/brain/src/planner.ts` | Updated estimatedUsd prompt instruction (askUser -> pool pre-launch check) |
| `packages/core/src/schemas.ts` | Rewrote `errorSubtype` JSDoc (4 known subtypes, ADR 0034 ref) |
| `packages/core/src/schemas.ts` | Rewrote `projectBudgetDefaultsSchema` JSDoc (computePoolUsage, ADR 0034 ref) |

## Design Rationale

- ADR 0027 illustrative code (line 229) was NOT edited — accepted ADRs are superseded per project convention, and the historical illustration is accurate for the tier it documents.
- The planner `estimatedUsd` instruction was updated rather than removed because F2's pool.ts consumer exists (even though the field currently doesn't survive `plannerTaskSchema` parse — that's a separate structural gap beyond doc-hygiene scope).
