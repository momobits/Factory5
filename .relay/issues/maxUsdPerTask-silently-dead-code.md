*Created: 2026-05-24*

# maxUsdPerTask axis is silently dead code post-Tier-15.8 deletion

**Severity:** P1 high — wrong-result risk; ADR 0034 §1 explicitly preserves this axis as a "per-task safety net", but the enforcement path was deleted in Tier 15.8 with the rest of `budget-escalation.ts`. Operators who set `--max-usd-per-task 0.50` (or set it in the Web UI / project metadata) think they have a safety net; they don't.

## Problem statement

ADR 0034 §1 says:

> `maxUsdPerTask` stays as a per-task safety net (ADR 0032 §4 carry-forward from Tier 13).

But Tier 15.8 (`89b4e85`, `refactor(15.8): delete budget-escalation.ts + [BUDGET] branch in auto-answer`) deleted the entire `packages/brain/src/budget-escalation.ts` file, which contained:

- `escalateMaxUsdPerTaskTrip` — the pre-launch escalation helper
- `parseBudgetEscalationAnswer` — answer parser
- `BUDGET_ESCALATION_MARKER` (`[BUDGET]`) — auto-answer marker

The Tier 15.7 pool dispatcher rewrite (`931ffcd`) also dropped the maxUsdPerTask pre-launch check. The pool's `executeTask` now only checks tool-using-agent maxTurns axes (`axisForAgent(task.agent)` returns `undefined` for non-maxTurns axes), so the `maxUsdPerTask` cap is never evaluated.

The planner is still instructed to emit `estimatedUsd` per task (`packages/brain/src/planner.ts:253-256`):
> `estimatedUsd` (optional) — your best-guess model spend in USD for this task. Emit when the directive carries a `maxUsdPerTask` cap so the brain can escalate via askUser BEFORE launching an expensive task.

Schema field `task.estimatedUsd` still exists (`packages/core/src/schemas.ts:298`), CLI flag `--max-usd-per-task` still works (`packages/cli/src/commands/budget-flags.ts:41,159`), Discord `/budget max-usd-per-task` still works, Web UI exposes the slider — but no code reads `task.estimatedUsd` to compare against any cap.

## Current state

**Schema (still alive):**
- `packages/core/src/schemas.ts:298` — `estimatedUsd: z.number().nonnegative().optional()` planner-emitted field on `taskSchema`
- `packages/core/src/budget-defaults.ts:32` — `maxUsdPerTask` in `BUDGET_AXES`
- `packages/core/src/budget-defaults.ts:81-85` — explainer claims escalation behavior:

  ```
  Per-task USD ceiling. 0 = unlimited (default). When the planner estimates a
  single task above this cap, the brain escalates via askUser before launching
  the worker (Phase 13.6).
  ```

**Operator-facing surfaces (still alive, still misleading):**
- `packages/cli/src/commands/budget-flags.ts:41,59,159` — CLI `--max-usd-per-task` flag
- `packages/channels/src/discord-commands.ts:226,501,515,700` — Discord `/budget max-usd-per-task`
- `packages/channels/src/telegram.ts:1406,1444-1446` — Telegram parse
- `packages/channels/src/command-handlers.ts:531,572` — channel handler
- Web Build form + Project Defaults accordion

**Planner instruction (still alive):**
- `packages/brain/src/planner.ts:253-256` — prompt tells the LLM to emit `estimatedUsd` "so the brain can escalate via askUser BEFORE launching an expensive task"

**Enforcement (DELETED):**
- `packages/brain/src/budget-escalation.ts` — deleted in `89b4e85`
- `packages/brain/src/pool.ts:511-590` — only `axisForAgent(task.agent)` (returns scaffolder/builder/fixer turns axis or `undefined`) is consulted before launch; no USD pre-flight

**Pool excludes maxUsdPerTask from POOL_AXES:**
- `packages/brain/src/pool-usage.ts:92-102` — `POOL_AXES` is `[maxUsd, maxSteps, maxTurnsScaffolder, maxTurnsBuilder, maxTurnsFixer]`; `maxUsdPerTask` lives in the "non-pool axes return 0" default branch (`pool-usage.ts:278-282`)

Grep confirms zero readers of `task.estimatedUsd` outside the planner emit site and tests:

```
$ grep -rn "estimatedUsd" packages --include="*.ts"
packages/brain/src/planner.ts:253-256  (prompt text only)
packages/core/src/schemas.ts:298       (schema definition)
(all other matches are in test files or doc/spec markdown)
```

## Impact

1. **Silent safety-net failure.** An operator sets `maxUsdPerTask=$0.50` thinking it bounds runaway-cost on a single task; no axis is enforced; a task spends $5+ before terminal directive maxUsd kicks in.
2. **Dishonest help text.** The CLI `--help` (which renders `BUDGET_DEFAULTS[axis].explainer` verbatim per ADR 0032 §3) tells operators "the brain escalates via askUser before launching" — but the escalation path doesn't exist.
3. **Wasted planner spend.** The planner is told to emit `estimatedUsd` on every task. That instruction adds tokens to every planner prompt across every directive for code that no one reads.
4. **ADR contract violation.** ADR 0034 §1 explicitly says `maxUsdPerTask` is preserved. Code disagrees with the accepted decision.

## Proposed fix

Two real options:

**Option A — Restore the safety net (matches ADR 0034 §1).** Add a pre-launch USD check to `executeTask` that reads `task.estimatedUsd` and compares against the resolved `maxUsdPerTask` cap (live-resolve via the same `max(project.json, payload.budgets, BUDGET_DEFAULTS)` rule from ADR 0034 §1 applied to `maxUsdPerTask`). On over-cap, either:
- Park the directive with structured `blockedReason.kind='task-usd-exceeded'` (matches the Tier 15 pool-exhausted shape), OR
- Skip the task with synthesized failure result `errorSubtype: 'task-usd-exceeded'` so the pool drains cleanly

This is the path that matches ADR 0034's stated decision. Requires ADR 0030 amendment update (the Tier 15 amendment block says `[CRITIC]` is the only marker; if the USD check produces a structured `blockedReason` rather than an askUser, no marker is needed — preferred per ADR 0034's "no askUser" stance for the pool model).

**Option B — Retire the axis explicitly.** Amend ADR 0034 to drop §1's `maxUsdPerTask` carry-forward statement. Then:
- Remove `maxUsdPerTask` from `BUDGET_AXES`
- Remove the CLI flag, Discord slash option, Telegram parse, Web UI field
- Remove `task.estimatedUsd` from `taskSchema` (or keep as historical-only with deprecated doc-comment matching `task.maxTurns`)
- Remove the planner prompt's `estimatedUsd` instruction

Either option closes the gap. Option A preserves the contract; option B fixes the contract to match reality. **Option A is the better fit** because the safety net is the kind of bound an operator would want on autonomous runs with unfamiliar projects (LLM bias toward planning expensive tasks). It's also a single new pre-launch check (~30 lines), parallel to the pool watchdog that already exists.

## Affected files

- `packages/core/src/budget-defaults.ts` — explainer text + (option B) axis removal
- `packages/core/src/schemas.ts` — (option B) drop `estimatedUsd`
- `packages/brain/src/planner.ts` — prompt text removal (option B) or keep (option A — planner emit feeds the new check)
- `packages/brain/src/pool.ts` — (option A) add pre-launch USD check
- `packages/brain/src/pool-usage.ts` — (option A) extend POOL_AXES or add per-task accessor
- `packages/cli/src/commands/budget-flags.ts` — (option B) remove flag
- `packages/channels/src/discord-commands.ts`, `telegram.ts`, `command-handlers.ts` — (option B) remove options
- `packages/ipc/src/schemas.ts` — (option B) drop from PUT body schema
- `docs/decisions/0034-budget-pool-paradigm.md` — (option B) supersedure amendment or (option A) confirmation amendment
- Tests: `packages/cli/src/commands/budget-flags.test.ts`, `packages/core/src/budget-defaults.test.ts`, `packages/daemon/src/server.test.ts` (the Phase 14.9 regression test that explicitly verifies persistence of `maxUsdPerTask` to `payload.budgets`)
