# 0032 — Budget UX paradigm: operator-facing vs internal-pacing, default-publication, escalation, persistence

- **Status:** Accepted
- **Date:** 2026-05-17
- **Builds on:** [ADR 0020](0020-pre-call-budget-enforcement.md) — pinned the pre-call `BudgetExceededError` shape for `maxUsd` / `maxSteps`. [ADR 0027](0027-web-ui-mutation-surface.md) §4 — pinned the four-tier resolution order for per-project budget defaults (instance config → project metadata → directive payload → CLI override). [ADR 0030](0030-pending-question-auto-answer.md) — pinned the `askUser` deadline-driven LLM auto-answer dispatcher this ADR extends with a typed-prompt path.

## Context

The codebase carries 15 budgets and timeouts (audited 2026-05-16, captured verbatim in [`UPGRADE/plans/tier-12-budget-ux.md`](../../UPGRADE/plans/tier-12-budget-ux.md) § "Budget audit"). Of those, the operator can set exactly two from any surface: `maxUsd` and `maxSteps`. The other thirteen are hardcoded constants in source files. Two are operator-felt (`maxTurns` per agent class; `askUserDeadlineMs`); the rest are internal pacing — poll intervals, heartbeats, claude-cli per-call timeouts, retry backoffs.

The forcing function is a 2026-05-16 `automl` build directive (`01KRQ1RPE5SM6Q8AYSRHHAPG39`) that failed with `error_max_turns` after the planner emitted a 13-module scaffold against a 40-turn default cap. Operator response, verbatim: _"why are we failing instead of asking the user if we should continue over the budget? why do we have a cost limit? why do we have a max cost and max steps that we ask the user and have other limits the user does not see? why don't we ask the user for input on all the limits we have in the code instead of failing like this when the user plans a new build."_

Two failure modes today:

1. **Invisible budgets.** Per-task `maxTurns` (provider default 80 post-`fa2f800`), `askUserDeadlineMs` (config.json only, no CLI/web surface). Operator can't tune them at mint time.
2. **Hard-fail when ceiling hits.** `maxTurns` trips → worker returns `error_max_turns` → task marked failed → brain raises a generic `askUser("what next?")` carrying no budget context. The Tier 8 auto-answer dispatcher (ADR 0030) sees the same generic prompt and defaults to `blocked`. The operator sees "Task failed" with no diagnostic and no recovery path.

`maxUsd` / `maxSteps` already follow the right pattern (ADR 0020): pre-flight ceiling check, `BudgetExceededError` carries a typed reason, outbound message names the resume flag. This ADR generalises that pattern across every operator-felt budget — and pins the decision rule for what "operator-felt" means, so future budget axes don't drift back into the hardcoded-constant pool.

## Decision

Five parts, one ADR.

### 1. Operator-facing budgets — the closed set

For first-ship the operator-facing set is six axes:

| Axis                 | Default | Scope                             | Resolved via                                             |
| -------------------- | ------- | --------------------------------- | -------------------------------------------------------- |
| `maxUsd`             | 0 (off) | directive                         | CLI flag / web form / project metadata / instance config |
| `maxSteps`           | 0 (off) | directive                         | CLI flag / web form / project metadata / instance config |
| `askUserDeadlineMs`  | 300_000 | directive (per-`askUser`)         | CLI flag / web form / project metadata / instance config |
| `maxTurnsScaffolder` | 120     | per scaffolder-tagged worker task | CLI flag / web form / project metadata / instance config |
| `maxTurnsBuilder`    | 80      | per builder-tagged worker task    | CLI flag / web form / project metadata / instance config |
| `maxTurnsFixer`      | 80      | per fixer-tagged worker task      | CLI flag / web form / project metadata / instance config |

Four-tier resolution order per [ADR 0027](0027-web-ui-mutation-surface.md) §4: instance config → project metadata → directive payload → CLI / web-form override. The set is **closed** for first-ship — any new axis enters via this ADR's amendment, not by a hardcoded constant slipping into source code.

**Decision rule for future axes:** a budget is operator-facing iff (a) the operator can plausibly judge what value they want for THIS build (project size, time pressure, $ ceiling), AND (b) the failure mode if it trips is operator-visible (a worker error reaches the directive surface; a task fails; a directive flips to blocked). Internal pacing constants fail (a) — they tune daemon responsiveness, not build outcome. The audit in the plan applies this rule to every constant in the codebase; future additions MUST apply it explicitly and record the answer in the constant's doc comment.

### 2. Internal-pacing constants — stay hidden, but document why

Constants that fail the operator-facing rule stay hardcoded but MUST carry a `// internal pacing — operator should not need to tune` comment when introduced or moved. The intent is reviewer-visible: a PR that promotes an internal constant to operator-facing must remove the comment AND add an entry to `BUDGET_DEFAULTS` (decision 3) AND surface it through CLI + Web (decision 5's surface contract). The reverse direction is also flagged — a constant losing operator-facing status should be exceptional and ADR-amended.

The audit in the Tier 12 plan documents the current internal-pacing set: `claudeCliTimeoutMs`, `claudeCliStreamTimeoutMs`, `DEFAULT_TURN_TIMEOUT_MS` (chat REPL — separate work tracked in U005), `DEFAULT_POLL_INTERVAL_MS`, `AUTO_ANSWER_SWEEP_INTERVAL_MS`, `HEARTBEAT_INTERVAL_MS` (SSE + pool), `RETRY_BACKOFF_MS`, `ORPHAN_STALE_AFTER_MS`, `START_WAIT_BUDGET_MS`, `STOP_WAIT_BUDGET_MS`.

### 3. Default-publication contract — `BUDGET_DEFAULTS` is the single source of truth

A new module `packages/core/src/budget-defaults.ts` exports a `BUDGET_DEFAULTS` constant carrying `{ value, explainer }` per operator-facing axis, plus a matching Zod schema. Every operator-facing surface MUST read from this module:

- **CLI flags** (`packages/cli/src/commands/build.ts`, `resume.ts`) read defaults + render `--help` post-text from the explainers verbatim.
- **Web Build form** (`apps/factory-web/src/pages/build.astro`) reads defaults to seed input values + renders explainers as hint text.
- **Project-metadata parser** (`packages/wiki/src/project-metadata.ts` and downstream) reads the Zod schema to validate `<project>/.factory/project.json`'s `metadata.budgets` field.
- **Directive-payload validator** (`packages/core/src/directive.ts`) uses the same Zod schema for `payload.budgets`.

The contract is: **no operator-facing budget value or explainer text exists anywhere except `BUDGET_DEFAULTS`**. Surface code reads strings from the constant; tests assert surfaces render the strings; a future grep for the explainer text will find exactly one definition site.

The Zod schema is `.partial()` everywhere it's consumed (CLI / web / payload) — every axis is optional at every layer, and the resolver in decision 1 fills missing values from defaults. This is what enables the operator to override exactly one axis without re-specifying the others.

### 4. Escalation rule — per-task budget trips raise a typed askUser, not a hard-fail

When a per-task budget trips (today: `maxTurns` returns `error_max_turns` from the worker; future: per-task USD cap if Tier 13 adds it), the brain's pool layer (`packages/brain/src/pool.ts`):

1. Detects the typed error subtype from the worker's structured outcome.
2. Raises an `askUser` with **provenance `budget_escalation`** (new value, extends ADR 0030's provenance enum), carrying:
   - `axis` — which budget tripped (`maxTurnsScaffolder`, etc.)
   - `taskTitle` — the failing task's planner-emitted title
   - `currentValue` — the cap that tripped
   - `suggestedNext` — the next-bucket bump (scaffolder 80→120→160; builder 80→160; fixer 80→160)
3. Awaits the answer (Tier 8 auto-answer fallback applies — see decision 5).
4. On `accept` — relaunches the task with `maxTurns = suggestedNext`; worker subprocess restart in the same worktree; spend continues on the same parent directive.
5. On `custom <n>` — relaunches with `maxTurns = n`, clamped to `[10, 160]`.
6. On `abort` — marks the task failed (current behaviour); the directive's normal post-task pool handling takes over (typically a planner re-plan or a directive-level `blocked` flip).

The directive does **not** flip to `failed`/`blocked` while the question is open. This matches the existing `maxUsd`/`maxSteps` escalation pattern from ADR 0020 — pre-call ceiling trips raise a `pausedAtBudget` askUser, not a directive failure.

The auto-answer dispatcher recognises the `budget_escalation` provenance via a typed prompt path (see decision 5).

### 5. Auto-answer integration — typed-prompt path with bump-then-abort policy

ADR 0030 §3 listed the auto-answer prompt context as question + options + parent directive + project CLAUDE.md + task log + findings + past Q&A. The first-ship of Tier 8 dropped the CLAUDE.md/task_log/findings entries for token economy. Tier 12 adds a **typed-prompt path** for `budget_escalation`-provenance questions:

- The dispatcher (`packages/brain/src/auto-answer.ts`) checks the question's provenance; if it equals `budget_escalation`, it skips the generic prompt-builder and uses a specialised one that frames the question as "this task tried to do X, hit cap Y, suggested bump is Z; should I accept the bump or abort?"
- The auto-answer **policy** (not LLM judgement) is deterministic: bump-by-one-bucket on the **first** trip per axis per directive; abort on the **second**. The state is tracked via a new `directives.budget_bump_count` table (or equivalent join, design decided at 12.6 implementation time).
- The LLM is consulted only for nuance — e.g., distinguishing "this task is making progress and just needs more turns" from "this task is in a loop and bumping won't help". For first-ship, the dispatcher accepts the LLM's recommendation only if it's `accept` or `abort`; any `custom` recommendation is downgraded to the policy default.

The provenance enum (`packages/state/migrations/009-pending-question-answered-by.ts` per ADR 0030 §1) gains `budget_escalation` as a new value. No schema migration needed — the enum is open-set at the SQLite CHECK level (text column, no constraint), and the ADR 0030 § "Race mitigation" sentinel-claim path still applies.

### 6. Persistence contract — `payload.budgets` carries the resolved set

Every directive's `payload.budgets` (new field, optional at validation time, defaulting to `BUDGET_DEFAULTS` values at consumption time) MUST carry the **resolved** budget set the directive was built against — after the four-tier resolution from decision 1 collapses to a single object. This means:

- A build minted via `factory build --max-turns-scaffolder 160` lands `payload.budgets.maxTurnsScaffolder = 160` on the directive, regardless of project-metadata or instance-config defaults.
- A build minted with no overrides lands `payload.budgets` with every axis populated from defaults (NOT an empty object) — the resolver collapses defaults into payload so the planner / pool / worker code all sees a complete budget set without re-walking the resolution chain.
- A `resume` of a prior directive inherits `prior.payload.budgets` verbatim. Body overrides on `POST /api/v1/directives/:id/resume` (Tier 10) merge against the inherited set. This extends Tier 10's `prior.limits` inheritance (which today carries only `maxUsd` / `maxSteps` / autonomy).

Backward compat: pre-Tier-12 directives have no `payload.budgets`. Consumers MUST treat the field as optional and fall back to `BUDGET_DEFAULTS` when absent — typical pattern: `const budgets = directive.payload?.budgets ?? BUDGET_DEFAULTS.values()`.

## Consequences

### Positive

- Operator sees every budget that can fail a build, with a default and a one-line explainer, at build-mint time. No more "the build failed because of a 40-turn cap I didn't know existed".
- Per-task budget trips become an operator decision instead of a hard-fail. The auto-answer policy (bump-then-abort) covers the common case so an autonomous run doesn't stall waiting for human input.
- Adding a new budget axis follows a single pattern: entry in `BUDGET_DEFAULTS` (decision 3), CLI flag + web form field (decision 3), escalation path if it's per-task (decision 4), persistence in `payload.budgets` (decision 6). The pattern is reviewable on a single PR.
- Resume inherits the exact budget set the prior directive ran with. No silent default-shift between original and resume — the operator can resume a budget-blocked directive and trust the budgets are the same unless they explicitly bump them on the resume.

### Negative

- `BUDGET_DEFAULTS` adds a new module that every operator-facing surface depends on. The cost is a small one-time refactor across CLI / web / project-metadata code; thereafter, edits to defaults or explainers happen in one file and propagate.
- The auto-answer policy is deterministic (bump-then-abort), not LLM-judged. This is intentional first-ship — LLM judgement on budget tuning is high-variance and hard to test. A future ADR can promote the LLM to advisory or decisive once we have data on which axis-and-task combinations benefit from bumps.
- Per-task budget retry costs additional model spend (the failed task plus the relaunched task). For `maxTurns` this is the cost of finishing a build that would have hard-failed; for the auto-answer's first-trip-bump policy, the second trip aborts so the cost is bounded.
- The `budget_bump_count` state needed to enforce "bump first, abort second" introduces a small persistence surface. The implementation can live as a join over the directive's prior `budget_escalation` askUsers — no migration required if the auto-answer dispatcher counts past `pending_questions` rows scoped to the directive.

## Alternatives considered

### A. Keep hardcoded defaults, document them better

Leave the constants in source, add `// operator-facing` comments, and rely on documentation to surface them. Pros: zero refactor; lowest blast radius. Cons:

- **Doesn't fix the operator complaint.** The complaint is "I can't see these knobs at build time", not "I can't find these knobs in the source". Documentation in the code surfaces the budget to the developer, not the operator.
- **Drifts.** Constants in 15 files drift independently. The auto-answer fallback's deadline and the chat REPL's deadline both live as `DEFAULT_*` constants; today's mismatch is a real bug source.
- **No persistence contract.** Resumes still inherit whatever the new defaults are at resume time, not what the original directive ran with. A change to `maxTurns: 80 → 120` between original and resume silently re-budgets the resume.

**Rejected.** The audit-and-surface part of this ADR is the work; documentation alone doesn't move the operator surface.

### B. Hard-fail with a better error message, no escalation

When `maxTurns` trips, mark the task failed but include the cap + suggested resume flag in the error message: _"Task failed: scaffolder hit 80-turn cap; rerun with `--max-turns-scaffolder 120` to retry."_ Pros: simpler than the askUser escalation; no new auto-answer prompt type. Cons:

- **Wastes the autonomous-mode investment.** ADR 0030's auto-answer dispatcher exists precisely to keep autonomous runs unblocked. A hard-fail forces an autonomous run to halt mid-build for a budget bump that an LLM could decide deterministically in 200 ms.
- **Worse UX in chat / assisted modes.** The operator has to abandon the current directive and start a new one with the right flag. The askUser escalation lets them say "yes, bump it" without losing the partial work done so far.
- **The askUser machinery is already there.** ADR 0015 (mid-flight user engagement) and ADR 0030 (auto-answer) ship the entire infrastructure. The marginal cost of one more provenance value (`budget_escalation`) is small.

**Rejected.** The askUser path matches the existing budget-escalation pattern from ADR 0020's `maxUsd`/`maxSteps` model; consistency wins over per-axis special-casing.

### C. Operator-configurable budgets but no auto-answer integration

Surface the budgets at build time and let the brain escalate, but require human input for every budget question (no auto-answer for `budget_escalation` provenance). Pros: removes the deterministic-policy decision from this ADR; defers all judgement to humans. Cons:

- **Breaks autonomous mode in any sustained run.** A 10-task scaffold that trips two budget caps would halt twice, requiring human intervention. The whole point of autonomous mode is uninterrupted progress; budget bumps that don't change build outcome (just allow it to continue) shouldn't gate on a human.
- **Pushes the policy decision off without making it easier.** The "bump first, abort second" rule is provably sufficient for the canonical incident pattern (one budget set too low; once bumped, succeeds). Deferring it just means re-deciding it later under more pressure.

**Rejected.** The auto-answer policy is the cheap part; doing the surface work without it would leave the most common autonomous-mode failure unaddressed.

### D. Per-task USD cap as part of this tier

Add `maxUsdPerTask` to the operator-facing set, mirroring `maxTurns` semantics. Pros: closes the per-task budget axis fully. Cons:

- **No incident driving it.** The canonical incident is `maxTurns` trips; per-task USD trips don't exist as a failure mode today (only directive-level `maxUsd`).
- **Larger surface.** Adds a budget axis without an established escalation pattern; would couple Tier 12's surface work with new per-task-spend tracking infrastructure.

**Deferred to Tier 13+.** Carried in [`UPGRADE/plans/tier-12-budget-ux.md`](../../UPGRADE/plans/tier-12-budget-ux.md) "Carry-forward" section. Same escalation pattern (provenance `budget_escalation`, axis `maxUsdPerTask`) will apply when added; no ADR revision needed beyond a row in `BUDGET_DEFAULTS`.

## References

- [ADR 0020](0020-pre-call-budget-enforcement.md) — `maxUsd`/`maxSteps` pre-call enforcement pattern this ADR generalises
- [ADR 0027](0027-web-ui-mutation-surface.md) §4 — four-tier resolution order
- [ADR 0030](0030-pending-question-auto-answer.md) — auto-answer dispatcher this ADR extends with typed-prompt path
- [Tier 12 plan](../../UPGRADE/plans/tier-12-budget-ux.md) — full budget audit (15 constants), per-step implementation breakdown
- U032 — operator-felt incident driving this ADR (`automl` scaffolder hit 40-turn cap with 13 modules)

## Amendment 2026-05-17 — operator budget is a ceiling on planner emit (U033 clarification)

Phase 12's deferred browser smoke (run the day after the phase close) failed the operator-felt gate: a build with `maxTurnsScaffolder=10` set in the Web UI's Advanced budgets accordion persisted `payload.budgets.maxTurnsScaffolder=10` daemon-side, but the scaffolder ran 40 turns (planner-emitted) and completed `exitCode=0` with no `[BUDGET]` askUser. Investigation traced to `resolveTaskMaxTurns` in `packages/brain/src/budget-escalation.ts:105-112` preferring `task.maxTurns` (planner-emit, always set per the planner prompt's 10-160 range) over `directive.payload.budgets[axis]` (operator). Filed as U033 (high; Tier 13).

The shipped Phase 12 resolver read this ADR's §6 docstring label ("operator override") as "operator value when planner is silent" — a fallback ordering. That reading is consistent with §6's literal text but inconsistent with §6's stated intent ("Every directive's `payload.budgets` ... MUST carry the **resolved** budget set the directive was built against") and with the Decision's §4 escalation rule (which exists precisely so the operator can interrupt a budget trip — pointless if the operator's cap can't reach the worker).

The amended semantic (landed in Phase 13.3): the operator's `directive.payload.budgets[axis]` is a **ceiling** on the planner's per-task emit. `resolveTaskMaxTurns` returns `min(task.maxTurns, operator_ceiling)` when both are defined; `task.maxTurns` unchanged when the operator did not set the axis or set it to `0` (the "no ceiling" sentinel, matching ADR 0020's `maxUsd: 0 = unlimited` pattern). The planner's range guidance (10-160) stays — operators can refine _downward_, the planner refines _downward within the ceiling_, neither side raises caps the other set. The docstring rewrites from "operator override" to "operator ceiling — planner emit refines downward."

This is a clarification of stated intent, not a paradigm change — supersedure-by-new-ADR is not warranted per CLAUDE.md's "do not edit accepted ADRs" rule, which targets _changes_ to a Decision's substance. The Decision's §4 (typed askUser on budget trip) and §6 (payload persistence + resume inheritance) both presupposed the operator-as-ceiling semantic; this amendment makes that explicit so future readers don't repeat the Phase 12 confusion.

**What's covered by the regression tests** (added to `packages/brain/src/budget-escalation.test.ts` in 13.3):

- `applies operator ceiling when planner emit exceeds it` — planner 200, operator 160 → 160.
- `floors planner emit at the operator directive budget (U033 smoke regression)` — planner 40, operator 10 → 10 (the live smoke incident).
- `applies the operator ceiling at the boundary` — planner 80, operator 80 → 80.
- `lets the planner refine below the operator ceiling` — planner 30, operator 80 → 30 (planner-refined-down case; previous behavior preserved).
- `treats operator-set 0 as a no-ceiling sentinel` — planner 40, operator 0 → 40 (matches `maxUsd: 0 = unlimited`).
- `isolates ceilings per-axis` — scaffolder task with `maxTurnsBuilder=10` set only → planner emit wins (no cross-axis bleed).

**Carried forward.** A belt-and-suspenders enhancement is open: feeding `directive.payload.budgets` into the planner prompt at `packages/brain/src/planner.ts:247-249` so the planner can self-clamp before emitting. Today the `Math.min()` clamp at consumption time is sufficient; deferred until a real-world case surfaces a too-eager planner.

## Amendment — 2026-05-23 (Phase 14)

§1's closed-set axis table extends to eight axes with the addition of `maxWikiReadinessAttempts` (default 3) — the architect+critic retry cap from ADR 0033's wiki-readiness critique loop. Zero sentinel = unlimited, matching `maxUsd: 0` / `maxSteps: 0`. §3 `BUDGET_DEFAULTS` source-of-truth contract unchanged; the table just grows. No supersedure per CLAUDE.md "do not edit accepted ADRs" — this is a contract-preserving extension, not a paradigm change (precedent: Phase 13.3's amendment for U033 clarification).
