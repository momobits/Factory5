# ADR 0034 — Budget Pool Paradigm

- **Status:** Superseded by ADR 0035 (2026-05-25)
- **Date:** 2026-05-24
- **Supersedes:** [ADR 0032](0032-budget-ux-paradigm.md)
- **Builds on:** [ADR 0020](0020-pre-call-budget-enforcement.md) — `maxUsd` / `maxSteps` directive-wide pool semantics this ADR extends to the three `maxTurns*` axes. [ADR 0030](0030-pending-question-auto-answer.md) — auto-answer dispatcher this ADR simplifies by removing the `[BUDGET]` branch entirely. [ADR 0032](0032-budget-ux-paradigm.md) — budget UX paradigm superseded by this ADR; the closed-set contract, `BUDGET_DEFAULTS`, and persistence contract all carry forward under the new pool model.

## Context

ADR 0032 exposed the three `maxTurns*` axes (scaffolder / builder / fixer) at the operator surface and wired a `[BUDGET]` `askUser` path so that a per-task budget trip became an operator decision rather than a hard-fail. The intent was sound; the implementation revealed three structural gaps.

**Incident: 2026-05-23 pythonetl build (`01KSB8DEZQCENQEKBKBRCKNYZK`).** The operator typed `"accept, bump to 160"` in response to a `[BUDGET]` question. The auto-answer parser rejected the free-form input; the task aborted; 12 dependent tasks cascaded with `exit 2 'upstream failure'`. The operator lost the entire build run.

Three structural gaps converged on this incident:

1. **Parser fragility.** `pickBudgetEscalationAnswer` matched structured-option literals (`accept`, `custom <n>`, `abort`). Natural-language synonyms — "accept, bump to 160", "yes bump it", "go ahead" — all failed the check and fell through to abort. Any finite token-matcher will find new shapes to miss.

2. **UI freedom on a structured contract.** The `[BUDGET]` askUser was surfaced as a free-text channel (Discord, CLI, Telegram). The answer fed a typed parser. The gap between "this looks like a text box" and "this requires a precise syntax" is the source of the incident. A structured contract needs a structured UI — a button or a slider — not a chat reply.

3. **Per-task vs pool mental model mismatch.** Operators think in terms of "how much budget does this build have overall?" not "what is the per-task turn cap for the scaffolder class?". A per-task cap that triggers an operator interruption for every task that overshoots creates interruption fatigue and inconsistency: one 200-line scaffolder hits the cap; a 50-line one does not; the operator is interrupted arbitrarily.

A surface-level fix — loosen the parser to accept synonyms — would have addressed gap (1) but left gaps (2) and (3) open for the next incident. Tier 15 unifies the fix by deleting the `askUser` path entirely and replacing per-task caps with directive-wide pools resolved live from the project page.

Full design specification: [`docs/superpowers/specs/2026-05-24-tier-15-budget-ux-overhaul-design.md`](../superpowers/specs/2026-05-24-tier-15-budget-ux-overhaul-design.md).

## Decision

Six parts, one ADR. Tier 15 lands all six.

### 1. Pool semantic for the three `maxTurns*` axes

The three `maxTurns*` axes (`maxTurnsScaffolder`, `maxTurnsBuilder`, `maxTurnsFixer`) switch from per-task caps to directive-wide pools, one pool per agent class. Each task within a class draws turns from its class pool; pool exhaustion — not per-task exhaustion — is the trigger event.

`maxUsd` and `maxSteps` already pool directive-wide (no change to their semantics). `maxUsdPerTask` stays as a per-task safety net (ADR 0032 §4 carry-forward from Tier 13). `askUserDeadlineMs` and `maxWikiReadinessAttempts` keep their existing per-question / single-shot semantics — they are not pool axes.

Cap resolution rule per axis:

```
effectiveCap[axis] = max(
  project.json.budgetDefaults[axis],
  directive.payload.budgets[axis],
  BUDGET_DEFAULTS[axis].value
)
```

The `max()` ensures operator edits via the project page can only raise the cap during a directive's lifetime, never lower it (monotonic-up guarantee from §2).

### 2. Live re-resolve from `project.json` (monotonic-up only)

The effective cap per pool axis recomputes on every budget check (≤ 250 ms, via the existing serve-poll tick). `project.json`'s `budgetDefaults` is the live source of truth; an operator editing the project page pushes a new `budgetDefaults` value that flows through on the next tick without a daemon restart.

`payload.budgets` narrows from ADR 0032's "runtime cap" semantic to a **per-directive floor**: it is the budget set that was resolved at build-mint time (operator's Build form / CLI flag override). The floor means the operator's per-build override survives the directive's lifetime and cannot be undercut by a later change to `project.json` defaults. Caps can only rise during a directive's lifetime; the floor enforces the "never lower" side of the monotonic-up guarantee.

The project page is the single editable source for per-project budget defaults. The directive detail page shows the live effective cap for diagnostics.

### 3. Pool exhaustion parks the directive — no `askUser`

When a pool's total turns consumed reaches its effective cap, the brain marks the directive `blocked` with a structured `blockedReason`:

```ts
blockedReason: {
  kind: 'pool-exhausted',
  axis: 'maxTurnsScaffolder' | 'maxTurnsBuilder' | 'maxTurnsFixer',
  usedAtPark: number,
  capAtPark: number,
}
```

The project page's Live tab surfaces a parked-alert banner with a one-click **"Raise cap to {nextBumpValue}"** CTA. No `[BUDGET]` `askUser` is created. No auto-answer parser. No structured-option literals for the operator to match. The previous `[BUDGET]` infrastructure is deleted per §6.

The structured `blockedReason` is machine-parseable by any future automation (CI watch, auto-increase toggle per §5) without text matching.

### 4. Linear bump rule

Each manual raise-cap click (project page CTA) or auto-bump iteration (§5) adds the project's per-axis default. Example for `maxTurnsScaffolder` with a default of 120:

```
120 → 240 → 360 → 480 → …
```

No `BUMP_BUCKETS` (the per-axis bucket schedule from ADR 0032 §4). No `MAX_TURNS_CLAMP_MIN / MAX_TURNS_CLAMP_MAX` constants. The rule is: **cap += project default per axis**. This is predictable in default-units: "3 raises = 4× the default." Operators building intuition about a project's typical cost can reason in units they already understand (the default) rather than in an opaque bucket schedule.

### 5. Per-project auto-increase toggle with safety multiplier ceiling

Two new keys in `project.json` metadata:

| Key                             | Type           | Default |
| ------------------------------- | -------------- | ------- |
| `autoIncreaseBudgets`           | `boolean`      | `false` |
| `autoIncreaseCeilingMultiplier` | `number` (≥ 1) | `5`     |

When `autoIncreaseBudgets === true`: on pool exhaustion, the brain auto-bumps the effective cap by `+project default` and retries the directive — without operator interaction. Auto-bumps repeat until either:

- The directive completes (success path), or
- The effective cap reaches `project default × autoIncreaseCeilingMultiplier`, at which point the directive parks with the standard blocked alert per §3.

The ceiling multiplier is the runaway-cost guardrail. With the defaults (`autoIncreaseCeilingMultiplier = 5`, `maxTurnsScaffolder = 120`), the cap can auto-increase to 600 (5× the default) before the directive parks and requires operator attention. Operators can lower the multiplier for cost-sensitive projects or raise it for long-running automation pipelines.

The toggle and multiplier are stored in `project.json` metadata (not in `payload.budgets`) — they are project-level settings that apply across directives, not per-build overrides. The project page Settings tab exposes them.

### 6. Planner stops emitting `task.maxTurns`

The planner prompt instruction that told the planner to include a `maxTurns` value in every emitted task object is removed. The worker receives no per-task `maxTurns`; the pool dispatcher owns the turn limit entirely.

`taskSchema.maxTurns` stays in the schema as optional (not removed) to allow read-back of historical directives without a parse error. The field is ignored at dispatch time — the pool cap is the only operative limit. Future cleanup (removing the field from the schema) is deferred until no historical directives with `task.maxTurns` remain in active production databases.

`pickBudgetEscalationAnswer` helper and `packages/brain/src/budget-escalation.ts` are deleted. The `[BUDGET]` marker branch in `packages/brain/src/auto-answer.ts` is deleted. The `budget_escalation` provenance value in `pending_questions.answered_by` is retired (no new rows; old rows remain for audit-trail correctness).

## Consequences

### Positive

- **Operator-felt UX simpler.** Pool exhaustion → project page banner → one-click raise. No syntax to learn, no parser to fool, no mid-build interruption unless the pool is genuinely exhausted.
- **Single source of truth.** `project.json` `budgetDefaults` is the live source for per-project defaults. The project page is the single editable surface. No daemon restart required.
- **Live editing.** Operator raises a cap on the project page; the brain picks it up on the next poll tick (≤ 250 ms). The directive can resume without a `factory resume` command.
- **Optional automation.** `autoIncreaseBudgets = true` with a safety ceiling multiplier gives operators hands-off behavior for long-running or batch pipelines without unlimited runaway-cost exposure.
- **Mental model matches reality.** "How much budget does this build have overall?" maps directly to the pool cap — a single number the operator sets and the project page displays, not a per-task cap that fires arbitrarily depending on task size.

### Negative

- **`payload.budgets` semantic narrows.** ADR 0032 described `payload.budgets` as the "runtime cap" the directive runs against. Under this ADR, it is a per-directive floor — the minimum cap for this directive's lifetime. Code that read `payload.budgets[axis]` as the authoritative cap must be updated to call the live-resolve formula (§1). The formula is backward-compatible for directives with no `project.json` override (the `max()` reduces to `max(BUDGET_DEFAULTS[axis].value, payload.budgets[axis])`, which preserves the prior behavior).
- **In-flight directives at deploy time.** Directives running at the moment the Tier 15 pool dispatcher deploys will fail because the new dispatcher does not recognize old per-task `maxTurns` semantics. Mitigation: `daemon stop` before deploying Tier 15 (standing practice; no active directives survive a daemon restart). Operators are advised in the release notes to let all active directives complete or cancel before upgrading.
- **Discord `/budget` slash command is a 2-axis subset.** The Discord channel still surfaces only `maxUsd` and `maxSteps` for quick budget queries. Expanding the `/budget` command to the full five-axis pool display is deferred to a follow-on tier — the pool axes are more naturally expressed in the tabular project page than in a single-line Discord reply.

## Alternatives considered

### A. Surface-level parser loosening only

Extend `pickBudgetEscalationAnswer` to accept natural-language synonyms ("yes", "bump it", "go ahead") in addition to the structured literals. Pros: minimal blast radius; no architecture change. Cons:

- **Addresses the pythonetl symptom but leaves gaps (2) and (3) open.** The next incident where a user types a phrase outside the synonym set produces the same abort cascade. Natural-language matching is an arms race with infinite edge cases.
- **UI freedom on a structured contract is still present.** A text box that accepts some natural-language is still a text box feeding a structured parser.
- **Per-task vs pool confusion remains.** Operators still receive interruptions arbitrarily based on which tasks happen to be large.

**Rejected.** Root-cause analysis points at the structure, not the vocabulary.

### B. Phased delivery across two tiers

Land the pool semantic in Tier 15 but keep the `[BUDGET]` `askUser` for transition compatibility; remove it in Tier 16. Pros: smaller per-tier blast radius. Cons:

- **Dead-code window.** The `[BUDGET]` path would co-exist with the pool dispatcher for an entire tier, creating a dual-path that both need maintenance and both need test coverage.
- **No clear deprecation signal to operators.** The `[BUDGET]` path would still fire if the code path is reachable; suppressing it without removing it creates invisible state.

**Rejected.** The pool dispatcher and the `[BUDGET]` path are mutually exclusive by design; running both simultaneously adds confusion without reducing risk.

### C. Keep `[BUDGET]` `askUser` but add structured-options UI

Route the `[BUDGET]` question to a structured UI (inline keyboard buttons in Discord; a modal in the web UI) so the operator clicks rather than types. Pros: eliminates the text-parsing gap (2) while preserving the `[BUDGET]` infrastructure. Cons:

- **Gap (1) is patched, not closed.** The parser still exists for CLI and Telegram surfaces that don't support inline buttons.
- **Gap (3) remains.** Per-task interruption is still the model; operators still receive arbitrary interruptions.
- **Structural `askUser` path is complex.** Adding a per-surface rendering layer for structured options is more implementation work than deleting the path entirely.

**Rejected.** Preserving three open gaps in exchange for a more incremental change does not improve the system's structural integrity.

### D. Keep per-task model, extend with better diagnostics

Preserve per-task caps but emit a richer `blocked_reason` so the operator knows which task tripped and why. Pros: zero paradigm change; low risk. Cons:

- **Per-task interruption fatigue is the root complaint.** Better diagnostics help the operator understand the failure but do not reduce the frequency of interruptions.
- **The pythonetl incident would recur.** A richer `blocked_reason` still routes through `[BUDGET]` `askUser`; parser fragility is unchanged.

**Rejected.** Per-task semantics are the current state (source of operator confusion per the pythonetl incident); preserving them is not an improvement.

## References

- [Spec](../superpowers/specs/2026-05-24-tier-15-budget-ux-overhaul-design.md) — Tier 15 full design: six-part ADR content, schema definitions, implementation breakdown
- [ADR 0020](0020-pre-call-budget-enforcement.md) — `maxUsd` / `maxSteps` directive-wide enforcement pattern extended to `maxTurns*` by this ADR
- [ADR 0030](0030-pending-question-auto-answer.md) — auto-answer dispatcher simplified by this ADR (see ADR 0030's Tier 15 amendment block)
- [ADR 0032](0032-budget-ux-paradigm.md) — superseded; `BUDGET_DEFAULTS` closed-set contract, CLI/web surface, and persistence contract carry forward under the pool model
- Incident `01KSB8DEZQCENQEKBKBRCKNYZK` — 2026-05-23 pythonetl build; parser rejection of `"accept, bump to 160"`; 12-task cascade abort; primary forcing function
