*Created: 2026-05-24*

# BUDGET_DEFAULTS explainers describe pre-Tier-15 semantics that no longer match the code

**Severity:** P1 high — operator-facing help text in CLI / Web / Discord lies about how four of eight budget axes behave. Operators tune budgets based on these explainers (ADR 0032 §3 makes them the single source of truth for surface render).

## Problem statement

ADR 0032 §3 mandates that every operator-facing surface render `BUDGET_DEFAULTS[axis].explainer` verbatim:

> The CLI's `--help` text, the Web Build form's accordion hints, the project-metadata parser, and the directive-payload validator all read from this module so the surfaces can't drift.

But the explainers in `packages/core/src/budget-defaults.ts` describe the pre-Tier-15 per-task / per-axis-escalation model that ADR 0034 superseded on 2026-05-24:

1. **`maxTurnsScaffolder`** (line 67-71): _"Per-task tool-conversation cap for the scaffolder."_ Wrong. Per ADR 0034 §1 these axes are now **directive-wide pools per agent class**, not per-task caps. Each scaffolder task draws from the shared scaffolder pool.

2. **`maxTurnsBuilder`** (line 72-76): _"Per-task tool-conversation cap for builders."_ Same.

3. **`maxTurnsFixer`** (line 77-79): _"Per-task tool-conversation cap for fixers."_ Same.

4. **`maxUsdPerTask`** (line 81-85): _"When the planner estimates a single task above this cap, the brain escalates via askUser before launching the worker (Phase 13.6)."_ Wrong on two counts:
   - The `[BUDGET]` askUser path was deleted entirely in Tier 15.8 (`89b4e85`).
   - The pre-launch escalation helper (`escalateMaxUsdPerTaskTrip`) was deleted with `budget-escalation.ts`. No escalation happens.

Additionally, two stale doc comments reference the deleted clamp:

- `packages/core/src/budget-defaults.ts:107-109`:
  > _"The brain's escalation path clamps custom-bump answers to `[10, 160]` per ADR 0032 §4 at the answer-handling site, not at schema parse time."_
  ADR 0032 is superseded; the escalation path is deleted; the clamp doesn't exist.

- `packages/core/src/schemas.ts:240-243` (taskResultSchema.errorSubtype JSDoc):
  > _"The pool reads this to trigger the budget-escalation askUser flow instead of hard-failing the task."_
  The budget-escalation flow is deleted; the pool now parks-or-bumps via `parkOrAutoIncrease`, not via askUser.

## Current state

**Explainers (operator-visible):**

```ts
// packages/core/src/budget-defaults.ts:67-91
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
```

**Surface renders that show stale text to operators:**

- `packages/cli/src/commands/budget-flags.ts:119` — `cmd.option(..., BUDGET_DEFAULTS[axis].explainer, parser)`
- `packages/channels/src/discord-commands.ts:208,214,220,226,232,238` — `setDescription(budgetExplainer('maxTurnsScaffolder'))` etc.
- Web Build form (`apps/factory-web/src/pages/build.astro`) — renders the explainer as accordion hint text per Phase 12.4
- Project page Defaults tab — same render

**Discord JSDoc also stale** at `packages/channels/src/command-handlers.ts:524-529`:
> _"/** Per-task tool-conversation cap for the scaffolder (ADR 0032). */"_
> _"/** Per-task tool-conversation cap for builders (ADR 0032). */"_
> _"/** Per-task tool-conversation cap for fixers (ADR 0032). */"_

ADR 0032 is superseded; these are pool-class caps per ADR 0034.

## Impact

1. **Operators tune the wrong knob.** An operator reading "per-task cap" sets `maxTurnsScaffolder=200` thinking they're giving each scaffolder task more room. Actually they're sizing the pool that ALL scaffolder tasks share. A 5-scaffolder build averaging 60 turns each can exhaust a pool of 200 mid-build with the operator believing they configured 200-per-task headroom.
2. **maxUsdPerTask explainer lies about behavior.** The operator believes a safety net exists; it doesn't (filed separately as `maxUsdPerTask-silently-dead-code.md`).
3. **Single-source-of-truth contract from ADR 0032 §3 is broken.** The contract says no operator-facing string lives outside `BUDGET_DEFAULTS`. The explainers ARE that single source — but they describe deleted behavior, so surface accuracy is impossible.
4. **Discord JSDoc cross-references ADR 0032 (superseded).** Auto-extracted help (if any tooling reads JSDoc) would point operators at the wrong ADR.

## Proposed fix

Rewrite explainers to match Tier 15 reality:

```ts
maxTurnsScaffolder: {
  value: 120,
  explainer:
    'Directive-wide turn pool for ALL scaffolder tasks combined (ADR 0034). Pool exhaustion parks the directive; raise the cap from the project page to resume. Default 120 covers most builds.',
},
maxTurnsBuilder: {
  value: 80,
  explainer:
    'Directive-wide turn pool for ALL builder tasks combined (ADR 0034). Default 80; large cross-cutting builds may want 240+.',
},
maxTurnsFixer: {
  value: 80,
  explainer: 'Directive-wide turn pool for ALL fixer tasks combined (ADR 0034). Default 80.',
},
maxUsdPerTask: {
  value: 0,
  explainer:
    /* if kept per the sibling maxUsdPerTask issue */
    'Per-task USD safety net. 0 = unlimited (default). Currently advisory-only; enforcement path was deleted in Tier 15.8 and pending restoration.',
    /* OR if axis is being retired, mark @deprecated */
},
```

Also:
- Delete or update `packages/core/src/budget-defaults.ts:107-109` `[10, 160]` clamp reference
- Update `packages/core/src/schemas.ts:240-243` (taskResultSchema.errorSubtype JSDoc) to describe the pool watchdog path
- Update `packages/channels/src/command-handlers.ts:524-529` JSDoc to drop "Per-task" and update ADR cross-ref
- Update `packages/core/src/schemas.ts:283-288` (taskSchema.maxTurns JSDoc) to clarify the field is read-back-only post-Tier-15

## Affected files

- `packages/core/src/budget-defaults.ts` — 4 explainers + 1 module JSDoc + clamp reference
- `packages/core/src/schemas.ts` — taskResultSchema.errorSubtype JSDoc + taskSchema.maxTurns JSDoc
- `packages/channels/src/command-handlers.ts` — BudgetInput JSDoc comments
- (Implicit, no edit needed): CLI / Web / Discord auto-render from the new strings

No tests need updating (the test file at `packages/core/src/budget-defaults.test.ts` asserts the value numbers, not the explainer prose).
