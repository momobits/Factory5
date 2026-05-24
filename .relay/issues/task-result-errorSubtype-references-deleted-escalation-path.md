*Created: 2026-05-24*

# `taskResultSchema.errorSubtype` JSDoc describes the deleted budget-escalation flow

**Severity:** P3 low — docs-only drift; no runtime impact. But it's a public schema export that operators and integrators read.

## Problem statement

`packages/core/src/schemas.ts:237-246`:

```ts
/**
 * Tier-12 / ADR 0032 §4 — typed error subtype the worker bubbles up from
 * the provider when the model layer reports a structured failure. Today
 * the only populator is the claude-cli provider's `error_max_turns`
 * result event, surfaced as `'error_max_turns'`. The pool reads this to
 * trigger the budget-escalation askUser flow instead of hard-failing
 * the task. Optional: read-only-agent failures + worker-internal errors
 * (worktree allocation, cleanup, sandbox) carry only `error` text.
 */
errorSubtype: z.string().optional(),
```

Three problems:

1. **ADR cross-ref is wrong.** ADR 0032 is superseded by ADR 0034 (2026-05-24). Reference should be ADR 0034 §3.
2. **"budget-escalation askUser flow" is gone.** Tier 15.8 (`89b4e85`) deleted the entire askUser path. The current consumer is the pool watchdog at `packages/brain/src/pool.ts:637-672` which parks the directive on `errorSubtype === 'pool-exhausted-midstream'` — no askUser.
3. **"Today the only populator is `error_max_turns`" is outdated.** Tier 15 added `'pool-exhausted-midstream'` (synthesized by the worker watchdog on cap-cross) and `'pool-exhausted'` (synthesized by `synthesizePoolExhaustedResult` in `pool.ts:379-389`). At least three distinct subtypes now exist.

## Current state

- `packages/core/src/schemas.ts:237-246` — stale JSDoc as above
- `packages/brain/src/pool.ts:386` — populates `'pool-exhausted'` subtype
- `packages/worker/src/run-worker.ts:614-620` — populates `'pool-exhausted-midstream'` via `ClaudeCliStreamError.subtype`
- `packages/providers/src/claude-cli.ts:51-65` (the typed error class) — produces `'error_max_turns'` per the original Tier 12 design

Audit shows the consumer that branches on this field is `packages/brain/src/pool.ts:637`:

```ts
if (
  outcome.result.errorSubtype === 'pool-exhausted-midstream' &&
  axis !== undefined &&
  signal?.aborted !== true
) {
  // park-the-directive logic
}
```

— no longer maps `'error_max_turns'` to anything special (the entire mid-stream `error_max_turns` handling was absorbed by the watchdog because watchdog-interrupted streams produce `'pool-exhausted-midstream'` first).

## Impact

Schema doc reader (operator integrating against the IPC contract, future ADR reviewer, AI agent reading the codebase to understand budget plumbing) gets a wrong mental model:
- Thinks errorSubtype triggers an askUser (gone)
- Thinks `'error_max_turns'` is the only value (false)
- Cites a superseded ADR (0032 → should be 0034)

## Proposed fix

Rewrite the JSDoc:

```ts
/**
 * Tier 15 / ADR 0034 §3 — typed error subtype carrying the structured
 * failure mode when a task didn't exit cleanly. Three known values:
 *
 *   - `'error_max_turns'` — claude-cli reported per-call turn limit;
 *     surfaced verbatim from the provider's terminal `result` event.
 *   - `'pool-exhausted-midstream'` — the pool watchdog interrupted the
 *     stream because directive-wide pool consumption crossed the cap
 *     mid-task (`packages/worker/src/run-worker.ts:614`). The pool
 *     dispatcher parks the directive with a structured `blockedReason`.
 *   - `'pool-exhausted'` — synthesized when the pre-launch pool check
 *     refuses to dispatch a task (`packages/brain/src/pool.ts:386`).
 *
 * Optional: read-only-agent failures + worker-internal errors (worktree
 * allocation, cleanup, sandbox) carry only `error` text. Pre-Tier-15
 * directives may carry `'error_max_turns'` from the deleted budget-
 * escalation path — historical rows only.
 */
```

## Affected files

- `packages/core/src/schemas.ts:237-246` — JSDoc rewrite
- (No code change required — the runtime behavior is correct, only the doc is stale)
