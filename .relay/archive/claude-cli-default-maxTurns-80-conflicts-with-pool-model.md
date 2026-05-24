*Created: 2026-05-24*

# claude-cli provider default `maxTurns: 80` hard-caps every task call regardless of pool size

**Severity:** P1 high — operators sizing their `maxTurnsScaffolder` pool to 500 expect any single scaffolder task to be able to use up to 500 turns if the others use less. With the provider default of 80, no single call can exceed 80 turns even if the pool has 420 left. The pool model from ADR 0034 assumes per-call has no cap; the provider quietly imposes one.

## Problem statement

ADR 0034 §6 says:

> The planner prompt instruction that told the planner to include a `maxTurns` value in every emitted task object is removed. The worker receives no per-task `maxTurns`; the pool dispatcher owns the turn limit entirely.

But "the pool dispatcher owns the turn limit entirely" depends on the worker NOT enforcing a per-call cap of its own. The provider does:

```ts
// packages/providers/src/claude-cli.ts:622
this.maxTurns = opts.maxTurns ?? 80;
```

And the stream call at `packages/providers/src/claude-cli.ts:745` passes `maxTurns: effectiveMaxTurns` to `buildClaudeArgs`, which adds `--max-turns 80` to the claude-cli invocation. claude-cli enforces 80 turns per `claude` invocation, then returns `error_max_turns` — which under Tier 15 surfaces as a worker outcome with `errorSubtype` set, but no pool re-dispatch happens because the pool considers the cap an axis cap (pool-level), not a per-call cap.

The worker thread at `packages/worker/src/run-worker.ts:582-583` only passes maxTurns to the provider when `task.maxTurns` is set:

```ts
...(opts.task.maxTurns !== undefined ? { maxTurns: opts.task.maxTurns } : {}),
```

Since (per ADR 0034 §6) the planner should no longer emit `task.maxTurns`, the provider falls back to its constructor default — **80 turns per call** — regardless of how big the operator set the pool.

(The seed-issue `maxTurns-dual-cap` covers the case where the planner DOES emit `task.maxTurns` and the worker propagates it; this issue covers the case where the planner DOESN'T emit and the provider's own default fires.)

## Current state

Provider construction sites:
- `packages/providers/src/registry.ts` (or wherever the daemon constructs the ProviderRegistry) — uses default `maxTurns` (no operator override path documented or wired)
- `packages/daemon/src/index.ts` / `packages/brain/src/serve.ts` registry-creation paths

Verification:
- Find the ClaudeCliProvider construction sites and confirm none pass `maxTurns`
- Set up a test directive that exhausts 80 turns inside a single scaffolder task while the pool cap is 500 → observe `error_max_turns` rather than pool-continuation

The provider chooses 80 as its default; the BUDGET_DEFAULTS for `maxTurnsBuilder` is also 80, but they're independent values — `BUDGET_DEFAULTS` is the POOL size, the provider's 80 is the PER-CALL size. Coincidental equality masks the mismatch.

For tool-using agents under the pool model, the operator's intent is "you can use up to N turns across all tasks in this class" — not "each task call is hard-capped at 80." The hard cap turns the pool from a high-water-mark guarantee into a no-op for tasks needing >80 turns.

## Impact

1. **Pool sizing > 80 doesn't help any single oversized task.** Operator raises `maxTurnsBuilder` to 240 expecting one big-builder-task room; the task still trips at 80 turns.
2. **Watchdog and pool dispatcher cannot enforce above-80 per task.** The mid-stream watchdog at `packages/worker/src/run-worker.ts:594-610` checks pool cap on each chunk and aborts on cross — but the per-call cap fires first, inside claude-cli, before the watchdog can interrupt.
3. **Auto-increase pool feature is partly ineffective.** The Tier 15 auto-increase toggle raises the pool cap (`bumpProjectCap`) but a single task can still only consume 80 turns per `claude` call. If the pool was exhausted by a single large task, the auto-bump can't help it complete — it'll just re-trip at 80.

## Proposed fix

Two options:

**Option A (cleanest, matches ADR 0034 §6 intent).** Set the provider's default `maxTurns` to a large value (e.g. `Number.MAX_SAFE_INTEGER` or a sane cap like `10000`) so the pool is the only operative cap. The pool watchdog already enforces the pool ceiling mid-stream. Any per-call cap below the pool cap is just an extra trip hazard.

**Option B.** Resolve the per-call cap dynamically: per task, pass `maxTurns: poolRemainingForAxis(task.agent)` (or `poolCap - poolUsedExcludingThisTask`) so each call's cap is sized to the remaining pool. Requires the worker to query pool state at launch time. More complex but more conservative for cases where the provider's own internal cap exists for safety reasons (e.g., a runaway claude-cli loop should still terminate eventually even if the watchdog is wedged).

**Recommend Option A** with the provider default raised. The pool watchdog provides the bound; the 80-turn provider default is a per-call concept that ADR 0034 explicitly retired ("the pool dispatcher owns the turn limit entirely").

If Option A is rejected on safety grounds, the doc should be amended: ADR 0034 §6 should say "the pool dispatcher owns the per-axis limit; the provider keeps a per-call safety cap at N" with N stated explicitly.

## Affected files

- `packages/providers/src/claude-cli.ts:622` — change default or remove
- `packages/providers/src/claude-cli.ts:745` — possibly conditional pass-through
- ClaudeCliProvider construction sites in daemon + brain (find and confirm)
- `docs/decisions/0034-budget-pool-paradigm.md` §6 — amendment to clarify what "owns the turn limit" means in practice
- `packages/worker/src/run-worker.test.ts` — add regression test for "no per-task maxTurns + pool cap 500 + task wanting 100 turns succeeds"

## Verification

Spin up a directive with a single big builder task, set `maxTurnsBuilder=500` (project default), no per-task maxTurns from planner. Observe whether the task can use >80 turns. If it trips at 80, this issue is real.
