*Created: 2026-05-24*

# Planner prompt still instructs LLM to emit `estimatedUsd` for a cap no consumer enforces

**Severity:** P2 medium — wastes planner-tier tokens on every directive and adds noise to plan.json files. Closely related to the `maxUsdPerTask-silently-dead-code.md` issue but a distinct cleanup site.

## Problem statement

The planner prompt at `packages/brain/src/planner.ts:253-256` includes:

```
'  - `estimatedUsd` (optional) — your best-guess model spend in USD for this task.',
'       Emit when the directive carries a `maxUsdPerTask` cap so the brain can',
'       escalate via askUser BEFORE launching an expensive task. Reasonable',
'       baselines: scaffolder $0.30-1.50, builder $0.20-1.00, fixer $0.10-0.50.',
```

But no consumer reads `task.estimatedUsd` against any cap (see `maxUsdPerTask-silently-dead-code.md` for the full chain). Result:

1. **Planner LLM sees the instruction every call and dutifully emits the field.** Sonnet (post-Tier-14 default for planning category) burns tokens generating per-task USD estimates that nothing uses. At ~50 tokens per task per estimate, a 10-task plan adds 500 wasted output tokens (~$0.005-0.015 depending on model).

2. **`plan.json` files carry the field on disk.** Plan.json schema includes `estimatedUsd` (planner-emitted, optional). Files written today carry the estimates as dead data. Re-reads (resume path) parse and discard.

3. **Planner-emit testing exercises the field.** `packages/brain/src/planner-emit.test.ts` and `packages/brain/src/planner.test.ts` both reference and validate the field; the regression coverage costs CI time for a field with no semantic consumer.

## Current state

**Prompt emission:**
- `packages/brain/src/planner.ts:253-256` — prompt instruction
- `packages/brain/src/planner.ts:64` — schema definition `maxTurns: z.number().int().positive().optional()` (this is the related `task.maxTurns` issue from the seed)

Wait — re-reading the schema, `estimatedUsd` is NOT in the plannerTaskSchema (`packages/brain/src/planner.ts:42-65`); it's only in the downstream `taskSchema` (`packages/core/src/schemas.ts:298`). So the planner prompt instructs the LLM to emit a field that the planner's own Zod schema (`plannerJsonSchema.parse`) does NOT recognize. The Zod schema's default `.strict()` posture would reject extra keys, but inspecting the schemas — `plannerTaskSchema` uses default `z.object` (which allows extra keys) — so the LLM-emitted `estimatedUsd` gets silently dropped at parse time and never reaches the `materialisePlannerTasks` step.

So actually there are FOUR layers of dead code here:

1. Prompt tells LLM to emit `estimatedUsd` (~80 tokens of instruction every call)
2. LLM emits it (~50 tokens per task)
3. `plannerTaskSchema` doesn't include the field — Zod parse strips it silently
4. Downstream `taskSchema` has the field but no writer ever populates it (the materializer at `planner.ts:101-192` doesn't carry it through)
5. No reader downstream consumes the field

Confirmed by grep: `grep -rn "estimatedUsd" packages --include="*.ts"` returns only the planner prompt, the schema definition, and test files.

## Impact

1. **Burns planner-tier tokens on every directive.** Cost per build is small (cents) but compounds across long-running operators and CI scenarios.
2. **Misleading documentation.** Future contributors reading the planner prompt assume there's a consumer at the other end. The Zod-strip means the field doesn't even survive parse.
3. **Test coverage is for fictional behavior.** Tests assert "planner can emit estimatedUsd" — assertion passes because the LLM gets the prompt — but the field never reaches a consumer that matters.

## Proposed fix

If the maxUsdPerTask safety net is being restored per `maxUsdPerTask-silently-dead-code.md` Option A — fix this in the same tier:

- Add `estimatedUsd: z.number().nonnegative().optional()` to `plannerTaskSchema`
- Pass it through `materialisePlannerTasks` into `Task`
- Wire the pre-launch USD check in `executeTask` to read `task.estimatedUsd`

If maxUsdPerTask is being retired per that sibling issue's Option B — delete this prompt instruction too:

- Remove lines `planner.ts:253-256`
- Remove `estimatedUsd` from `taskSchema`
- Update affected tests

Either way, the inconsistency of "prompt instructs, parse strips, downstream schema accepts" should resolve.

## Affected files

- `packages/brain/src/planner.ts:253-256` — prompt instruction
- `packages/brain/src/planner.ts:42-65` — plannerTaskSchema (option A: add field)
- `packages/brain/src/planner.ts:101-192` — materialisePlannerTasks (option A: carry through)
- `packages/core/src/schemas.ts:298` — taskSchema.estimatedUsd
- `packages/brain/src/planner.test.ts` + `planner-emit.test.ts` — update assertions
