*Created: 2026-05-24*

# Eight budget axes have four different semantic models; no single doc explains which axis follows which rule

**Severity:** P2 medium — operator-confusion source. Each axis behaves differently and ADRs are scattered across 0020, 0030, 0032 (superseded), 0033, 0034. New tier scaffolders introducing a 9th axis have no clear pattern doc to follow.

## Problem statement

The closed set of eight axes from `BUDGET_DEFAULTS` (per ADR 0032 §1 + amendments) has four distinct semantic patterns:

| Axis | Semantic | Cap-resolve rule | Live edits visible? | When trips, what happens? |
| --- | --- | --- | --- | --- |
| `maxUsd` | Directive-wide pool | Tier 15 max-rule (pool-usage.ts) for the pool VIEW; ADR 0020 static-at-mint for `directive.limits` PRE-CALL ENFORCEMENT | Partly — pool view yes, pre-call enforcement no (filed separately) | Pre-call `BudgetExceededError` thrown by `assertBudget`; directive flips to `blocked` with free-text `blocked_reason` |
| `maxSteps` | Directive-wide pool | Same as maxUsd | Partly (same) | Same as maxUsd |
| `maxTurnsScaffolder` | Directive-wide pool per agent class | ADR 0034 max-rule (live, every 250ms) | Yes — `pool-resume` watcher flips parked → running on cap raise | Pool watchdog parks directive with structured `blockedReason.kind='pool-exhausted'`; project-page CTA raises cap |
| `maxTurnsBuilder` | Same pool, builder agent | Same | Yes | Same |
| `maxTurnsFixer` | Same pool, fixer agent | Same | Yes | Same |
| `askUserDeadlineMs` | Per-question scalar (NOT a pool, NOT a per-task cap) | Daemon-config-only (project + payload tiers ignored — see sibling issue) | No (until sibling issue is fixed) | After deadline, auto-answer dispatcher fires; question marked `answered_by='agent'` |
| `maxUsdPerTask` | (Was) per-task safety net | None — silently dead per `maxUsdPerTask-silently-dead-code.md` | No | Nothing happens; documented behavior doesn't exist |
| `maxWikiReadinessAttempts` | Single-shot bound on architect+critic retry loop | Payload-only (project default ignored — see sibling issue) | No (until sibling issue is fixed) | After N failed attempts, askUser with `[CRITIC]` marker; auto-answer policy = `continue` |

## Current state

Nowhere in `docs/` does a single document tabulate these eight axes with their semantics. The information is scattered:

- `docs/decisions/0020-pre-call-budget-enforcement.md` — maxUsd/maxSteps directive-level pool, pre-call enforcement
- `docs/decisions/0030-pending-question-auto-answer.md` — askUserDeadlineMs daemon-wide config
- `docs/decisions/0032-budget-ux-paradigm.md` — superseded for the pool model, still authoritative for §3 BUDGET_DEFAULTS single-source contract; amendment block describes maxWikiReadinessAttempts
- `docs/decisions/0033-wiki-readiness-critique-loop.md` — maxWikiReadinessAttempts single-shot semantic
- `docs/decisions/0034-budget-pool-paradigm.md` — maxTurns* pool model; §1 explicitly carries maxUsdPerTask "as a per-task safety net" — but the code retired the enforcement (separate issue)

`packages/core/src/budget-defaults.ts` is the schema/values single source — but the explainers (operator-facing) don't say which semantic model applies to each.

`docs/ARCHITECTURE.md` doesn't have a budget section that maps axes to semantics.

## Impact

1. **Operators get the wrong mental model.** Reading the Build form, an operator sees eight knobs and reasonably assumes they all behave the same way (all pool, all per-task, etc.). They behave four different ways.
2. **Future tier scaffolders mint a 9th axis without a clear pattern.** "Is it a pool axis? per-task? per-question? single-shot?" — no canonical answer exists.
3. **Debugging operator-felt regressions is hard.** "Why didn't my `maxUsdPerTask=$0.50` cap stop the task?" requires reading three ADRs + the budget-escalation deletion log to discover the field is silently dead.
4. **Tests are fragmented.** Pool-axis tests live in `pool-usage.test.ts` / `pool.test.ts`; single-shot tests live in `loop.test.ts` / `architect-loop.test.ts`; ADR 0020 tests live in `budget.test.ts`. No integration test asserts the operator-visible behavior of an axis end-to-end (knob → setting → live behavior on each surface).

## Proposed fix

Author a single coherent doc — `docs/BUDGETS.md` or a new ARCHITECTURE.md section — that tabulates:

- Each axis's semantic class (pool / per-task / per-question / single-shot)
- Resolution rule (which tiers contribute, what's the merge operator)
- Live-edit visibility (does the brain re-resolve on every check, or is the value mint-time-static)
- Trip behavior (askUser, park, abort, retry)
- Where the consumer lives in code
- The originating ADR

This forces a structured audit: writing the doc will surface inconsistencies (like the issues filed in this pass) without needing a separate code-review.

The doc should be linked from:
- `docs/ARCHITECTURE.md` operator surface section
- `packages/core/src/budget-defaults.ts` module-level JSDoc
- Each ADR (0020, 0030, 0032, 0033, 0034) — cross-ref the unified doc

Also adopt a convention: when a future tier adds a new axis, the spec/plan MUST update `docs/BUDGETS.md` in the same commit that adds the axis.

## Affected files

- New file: `docs/BUDGETS.md` (or new section in ARCHITECTURE.md)
- `docs/ARCHITECTURE.md` — link the new doc
- `packages/core/src/budget-defaults.ts` — module JSDoc reference
- Possibly each ADR file — cross-ref updates

(Operator notes: this is mostly documentation work; no code changes required. But the structural value of having ONE doc is high — it's the audit-trail that catches the kind of drift the surrounding issues describe.)
