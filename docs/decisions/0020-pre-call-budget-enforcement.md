# 0020 — Pre-call budget enforcement: estimator and escalation shape

- **Status:** Accepted
- **Date:** 2026-04-21

## Context

Phase 7a wires `max_usd` and `max_steps` ceilings into `brain.loop`. The
CLI gains `factory build <spec> --max-usd <N> --max-steps <N>`; the brain
must refuse to make an LLM call that will push the directive past its
ceiling. Post-call accounting is already solid — `model_usage` records
exact cost from the provider's own billing envelope (`claude-cli`'s
`total_cost_usd`), so `modelUsage.totalCostForDirective()` gives the
ground-truth running total. The open question is how the brain estimates
a call's cost _before_ making it, so the pre-call comparison has
something to compare against.

Three candidate estimators were enumerated at end-of-Phase-6:

1. **Input-token estimate only.** Count tokens in the composed prompt;
   multiply by the model's input rate. Cheapest. Misses output cost
   entirely.
2. **Input + per-agent expected-output heuristic.** Add a per-agent
   constant for expected output tokens (e.g. builder ~10k, triage ~200).
   Accurate only as good as the hand-tuned constants.
3. **Running average from `model_usage`.** Per-`(category, mode)` rolling
   average of observed `cost_usd`. Self-calibrating; needs defaults for
   cold-start.

Two properties the estimator must have, regardless of approach:

- **Directional correctness for tool-using agents.** 90% of factory5's
  spend goes through `provider.stream()` (scaffolder/builder/fixer).
  A single `stream()` call drives a claude-cli subprocess through N
  tool-loop turns; factory sees one billed event per stream, but that
  event covers many internal model calls. Estimating "will this call
  exceed the ceiling?" must account for the full subprocess, not just
  the initial prompt.
- **Honest about uncertainty rather than optimistic.** Any estimator
  that is systematically low means the first ceiling-trip comes _after_
  the overshoot — the exact failure mode Phase 7a is meant to prevent.
  Phase 6c's live run cost $7.71 against a $4–6 envelope; an optimistic
  estimator would have approved every one of those calls.

On costs: the provider is the source of truth. `claude-cli` prints
`total_cost_usd` in its result envelope. factory5 does not maintain a
rate card and should not start — the moment Anthropic reprices Opus,
any factory-side tokens × rate math goes stale.

`max_steps` is under-specified in `CompleteArchitecture.md` §12 line 454
("configurable `max_usd` or `max_steps`"). Three reasonable meanings
surface: turns inside a stream, LLM calls, plan tasks. The anti-loop
spirit of the OmO guardrail points at LLM calls — retry loops and
stall-grind loops both show up as unbounded growth in that one
dimension, and neither `claude-cli --max-turns` (bounds turns per
stream, ADR 0016) nor the planner's materialisation (ADR 0016 bounds
plan task count) catches them. Calls is the dimension with no existing
ceiling.

## Decision

Pick (3) with (2) as fallback — **rolling average from `model_usage`
per `(category, invocation-mode)`, with hardcoded category×mode defaults
for cold start**. Wrap the provider in the brain to enforce the ceiling.
Escalate cleanly when it trips.

Four parts, one ADR:

### 1. Estimator shape

A new `@factory5/state` query
`modelUsage.averageCostByCategory(db, category, mode, sampleSize = 20)`
returns the average `cost_usd` over the last N successful (non-error)
`model_usage` rows matching `(category, mode)`. `mode` is `'call'` or
`'stream'` — tool-using subprocess calls cost an order of magnitude more
than one-shot classifications, so they must not share a bucket. When
the query returns zero samples, the estimator falls back to a baked-in
`DEFAULT_CATEGORY_COST` table in `packages/brain/src/budget.ts`.
Defaults are seeded from Phase 6c live-run data for `reasoning`/`deep`
(stream ≈ $1.30 per builder, call ≈ $0.05) and from Phase 5 / 6a data
for the others.

Rolling over the last 20 is deliberate: ten-ish builds' worth of
history converges to a stable mean while still tracking drift if the
category's effective model changes. Variance remains high for
`stream()` (one task can be $0.50 or $3) — mitigated in §3 below.

### 2. Enforcement location

A thin wrapper lives in `packages/brain/src/budget.ts`:

```ts
enforcedCall(registry, req, opts): Promise<ProviderResponse>
enforcedStream(registry, req, opts): AsyncIterable<ProviderStreamChunk>
```

Every brain-side call site that today invokes `registry.call(...)` or
`registry.stream(...)` is rewritten to go through this wrapper. The
wrapper:

1. Reads `directive.maxUsd` + `modelUsage.totalCostForDirective(db, id)`;
   reads `directive.maxSteps` + `modelUsage.countForDirective(db, id)`.
2. Computes the pre-call estimate via §1.
3. If `spent + estimate > maxUsd` or `calls + 1 > maxSteps`, throws a
   typed `BudgetExceededError` without touching the provider.
4. Otherwise delegates to `registry.call` / `registry.stream` and
   returns the result; the call is recorded by the existing
   `recordUsage` path so the next pre-call check sees the new running
   total.

Enforcement sits at the brain's orchestration layer, not in each
provider — providers stay dumb about budgets; the brain owns policy.
No provider change. No new plumbing in `@factory5/providers`.

### 3. Escalation shape

`BudgetExceededError` is a typed error:

```ts
class BudgetExceededError extends Error {
  kind: 'budget_exceeded_usd' | 'budget_exceeded_steps';
  ceiling: number;
  spentSoFar: number;
  estimatedCost: number; // 0 for the steps variant
  callsMadeSoFar: number;
  category: ModelCategory;
  agent: string;
}
```

The pool and the inline loop catch it at the outer boundary (same
`catch` arm that already wraps provider errors). On catch:

1. If a task was in flight when the check tripped, mark that task row
   in `tasks_inflight` as `blocked` (not `failed` — the task did nothing
   wrong, its budget ran out).
2. Mark the directive `blocked` and set `directives.blocked_reason =
'budget_exceeded_usd: spent=$1.23 ceiling=$3.00 est=$0.80 calls=7'`
   (or `budget_exceeded_steps: calls=40/40`). The `blocked_reason`
   column already exists (migration 002); prefix with the error `kind`
   keeps it machine-parseable.
3. Queue an outbound `escalate_blocked`-style message via the normal
   escalation path (not inventing a new channel). The message tells
   the operator the directive is halted, how much it had spent, and
   how to resume with a higher ceiling (`factory resume <directive>
--max-usd <new-N>` — exact CLI syntax defined in step 7a.5).

No half-torn-down task state. The provider was never called, so there
is nothing mid-flight to kill.

### 4. Ceiling scope

`max_usd` and `max_steps` are **per-directive**, not per-build, per-
session, or cumulative across all of an operator's work. A directive
is the natural unit because `model_usage` is already indexed by
`directive_id`, and the CLI `factory build --max-usd` maps one directive
= one build invocation. Cross-session cumulative ceilings
("no more than $50 across all my work today") are not in Phase 7a;
Phase 7b's spend dashboard is the natural home for cumulative views
and can grow a cumulative-ceiling dimension later if demand surfaces.

## Consequences

**Positive.**

- **Self-calibrating accuracy.** After 20 builds per category×mode,
  estimates track observed spend within one standard deviation. The
  hand-tuned defaults only matter on a fresh install.
- **No rate card maintenance.** factory5 never multiplies tokens ×
  dollars. Provider billing stays authoritative. Rolling average uses
  observed costs; the default table uses constants that only apply at
  cold-start and are tunable from config without a code change.
- **Fail-closed by default.** `BudgetExceededError` throws before the
  provider is called. No in-flight subprocess to kill; no partial
  tool-loop state to reconcile. The directive is left in a clean
  `blocked` state with a machine-parseable `blocked_reason`.
- **Existing `blocked_reason` column carries the escalation.** Migration
  002 already added it (currently used by abort paths). The
  `budget_exceeded_*:` prefix keeps it grep-friendly and doesn't
  require a schema change.
- **Pre-call semantics match the operator's mental model.**
  `factory build example --max-usd 3` means "don't let this build cost
  more than $3" — and it doesn't, because the ceiling check fires
  before each call. A build that needs $5 to finish trips at the first
  call that would push over $3, not at $3.01-plus-overshoot after the
  fact.
- **`max_steps` as call count lines up with the anti-loop doctrine.**
  Retry loops (same task retried N times) and stall-grind loops (brain
  keeps planning without making progress) both show up as unbounded
  growth in `COUNT(*) FROM model_usage WHERE directive_id = ?`. A hard
  step ceiling catches both without needing a stall detector as part
  of Phase 7a.
- **Opt-in migration.** Absent `max_usd` / `max_steps` on a directive
  means unlimited — existing behaviour. Phase 7a is a strict no-op for
  operators who don't pass the flag or set the config default.

**Negative.**

- **Cold-start estimates are as good as the defaults.** First few
  builds on a fresh install use the baked-in table. If defaults are
  low, legitimate builds trip the ceiling; if defaults are high, the
  first few overshoots still happen. Mitigation: defaults are seeded
  from Phase 6c data (already conservative) and are tunable via
  `~/.factory5/config.toml` `[budget.defaults]`.
- **`stream()` estimates have high intrinsic variance.** One builder
  task can be $0.50 (simple module) or $3 (heavy TDD loop). Rolling
  average smooths this across history but does not eliminate it
  per-call. A task with above-average cost can still push past the
  ceiling between checks. Mitigation: the check fires per call, so
  even if one call overshoots its own estimate, the next is bounded.
  Worst-case single-call overshoot is one task's cost above its
  estimate, bounded by `maxTurns × model max output` — roughly $10 at
  Opus 4.7 rates worst-case, well under the typical ceiling.
- **No mid-call enforcement.** If a `stream()` call runs longer than
  expected and blows its estimate, factory5 sees it only after the
  subprocess terminates. The next call trips the ceiling, but the
  overshooting call itself is not killed mid-flight. Phase 7a accepts
  this. A future phase could watchdog `factoryd` for progress and
  SIGINT the subprocess when its observed cost exceeds a fraction of
  remaining budget; not in 7a's scope.
- **Rolling average mixes across models.** A category whose fallback
  chain runs Sonnet one day and Opus the next will have an average
  that reflects neither. Mitigation: in practice each category
  resolves to one model for the duration of a session; chain fallbacks
  are rare and trip exception paths (provider unavailable). Not worth
  bucketing by model at this point.
- **Per-directive scope leaves aggregate spend uncapped.** One build
  can stay under its ceiling while the operator runs ten concurrent
  directives with no aggregate bound. Phase 7a does not solve this;
  Phase 7b's spend dashboard surfaces the aggregate and operator
  discretion fills the gap until a demand signal justifies a second
  ceiling dimension.

**Reversible?** Yes. The wrapper is an opt-in layer. Removing
`enforcedCall` / `enforcedStream` from call sites, or setting
`maxUsd = Infinity` / `maxSteps = Infinity` as the ambient default,
reverts to pre-7a behaviour without touching `model_usage` or any
persisted state. Migration 004 (directive limits columns) is additive
and nullable; back-filling NULL means "unlimited" and is harmless if
reverted.

## Alternatives considered

- **Input-token estimate only.** Rejected. Opus 4.7's rate ratio is
  roughly 1:5 (input:output). For tool-using `stream()` calls — ~90%
  of factory5's spend — output dominates. An input-only estimate is
  5–10× low in the common case; the ceiling would consistently trip
  after the actual overshoot, not before, defeating the phase's whole
  point. The approach works for one-shot classifications (triage,
  the architect's single call), but those are cheap enough that the
  ceiling rarely matters for them.

- **Input + per-agent expected-output heuristic (pure).** Rejected as
  primary, retained as cold-start fallback. Works about as well as
  rolling average in steady state but requires calibration the rolling
  average handles itself. The per-agent defaults in
  `DEFAULT_CATEGORY_COST` are this approach, used only when
  `model_usage` has insufficient history.

- **Post-call enforcement (tripwire, not pre-call).** Rejected. Halting
  after an overshoot gives the operator the wrong contract —
  "`max_usd` is roughly your ceiling plus one call's worth of slack"
  is strictly worse than "`max_usd` is the ceiling." The CLI flag is
  a hard ceiling; enforcement must match. Post-call does have one
  genuine advantage (accurate; no estimation needed) but in exchange,
  the worst-case overshoot is one expensive-builder's worth of spend
  (~$3) above the declared ceiling — exactly the silent slip that
  motivated Phase 7.

- **Compute costs from tokens × rate at factory5-side.** Rejected.
  claude-cli already prints `total_cost_usd` in its result envelope.
  Duplicating that math factory-side means maintaining a rate card
  that drifts from provider reality. The rolling-average approach
  uses observed costs from the provider; the default table uses
  baked-in constants tunable from config. Neither path needs
  factory5 to know dollar-per-token rates.

- **Make `max_steps` mean "turns inside `stream()`".** Rejected.
  `claude-cli --max-turns` already caps this at 40 per stream (ADR
  0016); exposing it under a different name at the brain level
  creates two settings that could disagree. "Calls to any provider
  for this directive" is the dimension with no existing ceiling and
  the one the OmO-style anti-loop guardrail actually wants.

- **Make `max_steps` mean "plan tasks".** Rejected. The planner's
  materialisation logic (ADR 0016) already bounds plan size by
  category and file-ownership. A plan-task ceiling would double-bound
  something the planner already enforces and fail to catch retry
  loops — which is the anti-loop guardrail's whole job.

- **Per-build / per-session / cumulative ceiling instead of
  per-directive.** Rejected for Phase 7a. `model_usage` is indexed
  by `directive_id`. `factory build` is one directive per invocation,
  so per-directive is the natural unit. Cross-session cumulative
  ceilings are Phase 7b territory.

- **Bucket rolling averages by model (not just category×mode).**
  Deferred, not rejected. At Phase 7a scale each category resolves to
  one model for the duration of a session; a category-level bucket is
  correct in practice. If multi-model fallback becomes common, a
  future ADR can refine the bucket shape without changing the
  enforcement architecture.

- **Hard-abort the in-flight `stream()` subprocess when the directive
  ran over without warning.** Deferred. Would require a watchdog
  reading `model_usage` inserts as the subprocess runs and a kill
  path that doesn't corrupt `tasks_inflight`. Value small — factory
  today has no way for a single stream to drastically overshoot its
  rolling-average estimate short of pathological tool-loop grinding,
  which is bounded by `--max-turns 40`. If this ever becomes the
  dominant overshoot mode, a future ADR can introduce mid-call
  enforcement.

## Implementation notes

Steps 7a.2 through 7a.7 land the plumbing. Rough split:

- **7a.2 — `@factory5/state`.** Add `averageCostByCategory(db,
category, mode, sampleSize=20)` and `countForDirective(db,
directiveId)` to `packages/state/src/queries/model-usage.ts`.
  Additive, no schema change.
- **7a.3 — `@factory5/providers`.** No change. Providers stay dumb
  about budgets; the brain owns policy. (Step 7a.3 in the plan was
  provisional — revised to "confirm providers need no change" in
  light of this ADR.)
- **7a.4 — `@factory5/brain`.** New `packages/brain/src/budget.ts`:
  `BudgetExceededError`, `DEFAULT_CATEGORY_COST`, `enforcedCall` /
  `enforcedStream`. Rewrite call sites in `loop.ts`, `pool.ts`,
  `triage.ts`, `architect.ts`, `planner.ts`, `ask-user.ts` to route
  through the wrappers. Outer try/catch in `loop.ts` and `pool.ts`
  handles `BudgetExceededError` specifically.
- **7a.5 — `@factory5/cli`.** `--max-usd <N>` and `--max-steps <N>`
  on `factory build` and (for symmetry) `factory resume`. Plumb
  through to the directive row.
- **7a.6 — Config defaults.** Add `[budget.defaults]` section to
  `~/.factory5/config.toml` with `max_usd` and `max_steps` keys.
  Absent = unlimited.
- **New migration 004** (lands with 7a.4): add `max_usd REAL`,
  `max_steps INTEGER` columns to `directives`. Both nullable. A new
  `Directive.limits: { maxUsd?: number; maxSteps?: number }` field
  on the `@factory5/core` type reads them.

Tests:

- **7a.7 — Regression.** Synthetic build via the stub provider that
  reports deterministic costs hits `max_usd = 1.0` after 5 calls at
  $0.25 each. The 6th pre-call check trips `BudgetExceededError`;
  the directive ends `blocked` with `blocked_reason` starting
  `budget_exceeded_usd:`; no orphan `tasks_inflight` rows; the
  outbound escalation message is present.
- **7a.8 — Live validation.** `factory build example --max-usd 3`
  with real claude-cli. Pass either by completing under budget
  cleanly or tripping the ceiling cleanly (blocked directive with
  `blocked_reason`, no mid-task corruption, clean escalation message).
  Failure mode the test catches: silent overshoot without a
  `blocked_reason`, or a corrupt in-flight row.

`CompleteArchitecture.md` §12 line 454 ("configurable `max_usd` or
`max_steps`") gets an inline pointer to this ADR in the same commit
that lands 7a.4.

## Amendment — 2026-05-24 (Tier 15)

Pool semantics across `maxUsd`, `maxSteps`, `maxTurnsScaffolder`, `maxTurnsBuilder`, `maxTurnsFixer` are now unified per ADR 0034. ADR 0020's `maxUsd` / `maxSteps` already pool directive-wide; the three `maxTurns*` axes were per-task pre-Tier-15. ADR 0034 is the canonical reference for the pool model going forward.
