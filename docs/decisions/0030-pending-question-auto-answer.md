# 0030 — Pending-question auto-answer: deadline-driven LLM dispatch with structured `answered_by` provenance, daemon-wide config home, no-override-after-auto-answer

- **Status:** Accepted
- **Date:** 2026-05-08
- **Builds on:** [ADR 0024](0024-worker-subprocess-ask-user.md) — `pending_questions` table + the `ask_user` lifecycle the worker emits and the brain consumes. Tier 8 extends ADR 0024's design rather than supersedes it: the row, the channel routing, the answer correlation are all unchanged. [ADR 0021](0021-first-class-project-identity.md) — spend taxonomy that the auto-answer LLM call records against. [ADR 0028](0028-worker-sandbox-contract.md) — worker sandboxing; the auto-answer dispatcher runs in the brain process, not in a worker subprocess, so sandbox concerns don't apply.

## Context

ADR 0024 set up `ask_user` as a worker-or-brain-emitted outbound + a `pending_questions` row + a channel-routed answer collection. The original assumption was load-bearing: a human always answers. The orphan-sweep (`factory questions cleanup`, `markOrphanAnswered` in `packages/state/src/queries/pending-questions.ts:272`) handles the case where no human answers and the parent directive eventually terminates — but it's _retroactive_: the question sits open from when the directive emits it until when the directive ends, possibly hours or days later.

This blocks autonomous runs. A typical `--autonomy autonomous` build that hits an `ask_user` mid-stream (a builder finding the spec ambiguous, a reviewer finding insufficient information to grade, a planner finding a category overlap) waits indefinitely for an operator who isn't there. The orphan sweep eventually closes the row but only after the directive itself has been declared a stall and terminated by some other mechanism — typically a budget exhaustion or a manual `factory cancel`. By then the run has already failed for the wrong reason: it stalled, not budgeted-out.

Three forcing functions converge on Tier 8:

1. **Autonomous runs are the production case.** `--autonomy chat` is for interactive sessions. `assisted` and `autonomous` runs need to make progress without a human-on-call.
2. **The orphan sweep is forensic, not load-bearing.** Its job is recordkeeping, not progress. The naming reflects this: it sweeps _orphans_ — rows whose parent has already died.
3. **The `deadline_at` column already exists.** ADR 0024 reserved the slot but the brain doesn't honour it consistently and there's no consumer. Tier 8 makes it real without shape changes to the surrounding data model.

The decision space has six load-bearing dimensions: provenance representation; config home for the deadline; LLM dispatcher prompt + failure semantics; race-mitigation between the dispatcher and a late human reply; spend treatment; override-after-auto-answer policy.

## Decision

Six parts, one ADR. Tier 8 lands all six.

### 1. Provenance via a structured `answered_by` enum column

`pending_questions` gains a new TEXT column `answered_by` (migration 009) with a CHECK constraint:

```sql
ALTER TABLE pending_questions ADD COLUMN answered_by TEXT
  CHECK (answered_by IN ('user', 'agent', 'agent-failed', 'orphan-sweep'));
```

Four values:

| Value            | Semantics                                                                                                                                                                          |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `'user'`         | The operator answered via CLI (`factory answer`), channel reply (Discord thread / Telegram reply / inline button), or web (`POST /api/v1/pending-questions/:id/answer`).           |
| `'agent'`        | The Tier 8 LLM dispatcher's auto-answer succeeded and wrote a real reply.                                                                                                          |
| `'agent-failed'` | The Tier 8 LLM dispatcher's auto-answer failed both attempts (one retry); the answer field carries `[auto-answer failed: <reason>]` and the directive proceeds from the synthetic. |
| `'orphan-sweep'` | `factory questions cleanup` retroactively closed the row when its parent directive terminated unanswered. Pre-Tier-8 behaviour, preserved.                                         |

NULL on unanswered rows. NULL bypasses the CHECK via SQLite three-valued logic, so unanswered rows stay legal. Migration 009's backfill maps pre-existing rows: orphan-sweep prefix matches → `'orphan-sweep'`; every other already-answered row → `'user'`.

The schema column is preferred over the prior `[bracketed]` text-prefix convention (`markOrphanAnswered`'s `[orphaned by ...]` synthetic answer) because UIs need to render an answerer badge without string-parsing, analytics need queryable provenance, and any future "what fraction of questions are auto-answered?" report needs structured data. The text prefix in `markOrphanAnswered`'s output stays for forensic readability — only the structured column is load-bearing.

### 2. Default deadline 5 minutes, daemon-wide config home

Every new `ask_user` pending-question gets `deadline_at = now() + askUserDeadlineMs`. The brain reads `askUserDeadlineMs` from `<dataDir>/config.json` at the start of each emission (or caches at startup; implementation choice). Default if file is absent or key is missing: 5 minutes (`300_000` ms).

`<dataDir>` is the same directory `factory.db` lives in (`@factory5/logger/paths` `dataDir()` — typically `~/.factory5/` on Linux, `%LOCALAPPDATA%\factory5\` on Windows). New file (no migration required for the file's absence; readers fall back to defaults). New `loadConfig()` in `@factory5/core` is the single read path.

```json
{
  "askUserDeadlineMs": 300000
}
```

**Why daemon-wide and not per-project**: simplicity. No demand signal yet that different projects need different deadlines. Per-project override (CLAUDE.md frontmatter or `<project>/.factory/project.json` `metadata.askUserDeadlineMs`) is non-breaking to add later — the resolution chain extends to `project → daemon → default` without touching the schema or the dispatcher. Defer the resolution-chain work until a real demand signal arrives.

**Why a config file and not a CLI flag or env var**: the deadline applies to brain-emitted questions, not to operator commands. There's no "current invocation" the flag would attach to — the brain runs as a long-lived daemon and emits questions across many directives. Env var would work, but a config file is operator-editable mid-session without a daemon restart (the brain re-reads on emit).

**Why 5 minutes**: long enough that an attentive operator answers without the auto-answer firing, short enough that an autonomous run isn't materially blocked. The whole point of config-as-file is that this number is changeable without code changes — an operator running long autonomous batches at night can set 30 seconds; an interactive operator can set 1 hour.

### 3. LLM dispatcher: brain-internal prompt, retry-once-then-synthetic

The auto-answer dispatcher lives at `packages/brain/src/auto-answer.ts`. It is **not** an agent invocation under `prompts/agents/` and is not a skill under `skills/` — those surfaces are operator-readable and operator-tunable. Auto-answer is a system-internal call; its prompt template lives inline in `auto-answer.ts` as a string template, treated as code rather than content.

**Prompt context** (assembled at dispatch time):

- The question text and `options[]` if present (always)
- The parent directive's intent + payload + source + autonomy mode (always)
- The project's `CLAUDE.md` content (read via the project-resolution plumbing the brain already uses; if missing, omit silently)
- The linked task's `task_log` snippet if `taskId` is set (the conversation that led to the question)
- Recent findings on the directive (last N, where N is bounded by token budget — implementation choice)
- Past Q&A in this directive (via an extended `pendingQuestions.openForDirective` that includes answered rows, ordered by createdAt) — for consistency across multi-question directives

The dispatcher uses the same model/provider abstraction the brain uses for triage. The category for spend taxonomy is `system/auto-answer` (a new category that ADR 0021's existing budgetary plumbing will accept; categories are TEXT, no enum).

**Failure semantics:**

- First call fails (network, provider, parse error, anything): wait 2 seconds, retry once with the same prompt.
- Second call also fails: write `pendingQuestions.answer(db, id, '[auto-answer failed: <reason>]', now, 'agent-failed')`. The directive proceeds from the synthetic answer the same way it would from a successful auto-answer — the _receiving_ code in the worker / brain agent that emitted the question handles `[auto-answer failed: ...]` the same way it handles any other text answer (it's prose; agents already handle ambiguous prose).
- If the receiving agent can't proceed without a real answer, that's _its_ failure mode — the directive's status will reflect the agent's downstream failure, not "auto-answer failed." Tier 8 doesn't introduce a new "directive failed because auto-answer failed" path.

**Why retry-once-then-synthetic** (not "retry forever" or "fail the directive"): a transient provider error shouldn't permanently stall a directive, and an indefinitely-retried auto-answer is just a retry storm. One retry covers the common case (a TLS handshake hiccup); two failures suggest something structural that retrying won't fix.

### 4. Race mitigation: `WHERE answered_by IS NULL` guard on the `answer()` write path

The dispatcher and `factory answer` (or any other human-driven answer path) can race when a human's reply lands milliseconds before the dispatcher writes. Without mitigation, the race-loser silently overwrites the race-winner's answer.

Mitigation: `pendingQuestions.answer(...)` is amended to `UPDATE ... WHERE answered_by IS NULL`, so the second write is a no-op against an already-claimed row. The dispatcher uses a two-phase claim:

1. **Sentinel claim**: `UPDATE pending_questions SET answered_by = 'agent', answer = '[in flight]' WHERE id = ? AND answered_by IS NULL`. If 0 rows updated, the human won the race; abort the LLM call.
2. **Finalize**: after the LLM completes, the dispatcher updates the row with the real answer + `answered_at` (the dispatcher owns the row at this point — no WHERE answered_by IS NULL needed; the column is already `'agent'` from the sentinel).

This makes the race-loser case (whichever side lost) a graceful no-op rather than a corruption. The race-loser human's input is logged at `warn` level so an operator who reaches for `factory answer` and finds it silently dropped can learn why.

### 5. No override after auto-answer

Once `answered_by` is non-NULL, the row is final. No `factory questions answer --force <id>` flow that supersedes an `'agent'` / `'agent-failed'` / `'orphan-sweep'` row. If the operator disagrees with the agent's answer, the path is to open a new directive citing the disagreement — not to retroactively rewrite the historical answer.

**Why no override**: the answer is a runtime input that downstream agents and tasks consume. Once consumed, retroactive changes don't unwind the decisions made on the basis of the original answer. Letting the operator overwrite-in-place creates a misleading audit trail (the new answer looks like it came from the agent's run, but didn't influence it). Cleaner: the answer log is immutable post-write, and any operator-driven correction is a new event.

A future ADR could lift this rule (e.g. `factory questions answer --force <id>` that records a separate correction row) but Tier 8 holds the simpler invariant.

### 6. Spend recording: charge to the parent directive on success only

A successful auto-answer LLM call records spend via the existing `recordUsage(...)` path under category `system/auto-answer`. The directive_id on the spend row is the parent directive — operators looking at `factory spend <directive>` see the auto-answer cost folded into the directive's total.

A failed auto-answer (the `'agent-failed'` path) records _no_ spend even if the provider charged for the failed call. Two reasons: (1) the directive made no progress from the failed call, so charging it muddies the spend report's "what did this directive cost?" answer; (2) provider-side billing for failed calls is reconciled separately from factory's spend log (provider invoices vs. factory's per-directive accounting). If this materially diverges, that's a reconciliation problem outside Tier 8's scope.

The auto-answer is bounded by the parent directive's existing budget. If the directive has exhausted its budget, the dispatcher's pre-call estimator (ADR 0020) refuses the call, and the auto-answer falls through to `'agent-failed'` with reason `budget`. The directive then proceeds from the synthetic answer; whether _that_ directive can do anything useful with `[auto-answer failed: budget]` is the directive's own concern.

## Consequences

- **Schema additive.** Migration 009 adds one TEXT column with a CHECK constraint; no rewrites, no index. Backfill is idempotent. Rolling back the code leaves the column in place; it's harmless.
- **Existing call sites unchanged.** `pendingQuestions.answer(db, id, text, when)` keeps its four-arg shape via the optional fifth `answeredBy` parameter (default `'user'`). Channel collectors, CLI `factory answer`, and the web UI POST route all flow through the default — no churn.
- **Race-loser human inputs are silently discarded.** Logged at `warn` so an operator can observe the race when it happens. Trade-off: simpler than building a race-aware UI affordance ("an agent answered while you were typing — your input was discarded; <link to history>"). If users hit this often, surface the warning at the CLI/web level in a follow-up.
- **Spend taxonomy gains `system/auto-answer`.** No taxonomy change at the type level — categories are TEXT — but reporting tools that filter on category should add the new value to their allow-lists. `factory spend` rolls up by directive regardless of category, so the default report is unaffected.
- **Per-project deadline override is a future surface.** Adding a `metadata.askUserDeadlineMs` field to project.json + extending the resolution chain is non-breaking. Until then, a single deadline applies to every project the daemon serves.
- **Auto-answer quality is not pre-tuned per agent.** First ship uses a single generic prompt across verifier-emitted, fixer-emitted, planner-emitted, etc. questions. If quality data shows specific agent classes systematically produce auto-answers that downstream tasks can't use, a follow-up tier can specialize.
- **No CLI surface for the config file in Tier 8.** `<dataDir>/config.json` is hand-edited or written by tests. A future `factory config get / set <key>` is a separate concern; deferred until other config keys justify it.

## Alternatives considered

- **Per-project deadline as the first ship.** Rejected — no demand signal, doubles the implementation cost of the first ship, and the resolution chain is non-breaking to add later.
- **No structured provenance; keep the `[bracketed]` prefix convention.** Rejected — every UI consumer would have to string-parse to render a badge; analytics queries on "who answered" become regex-based; the convention would have to extend to cover three new variants ('agent', 'agent-failed', and a way to distinguish them from `'user'` answers that happen to start with `[`). Schema column is cleaner.
- **Skip the LLM and timeout-fail the directive with a marker.** Rejected — the value of auto-answer is _progress_, not _exit_. Timeout-fail is what already happens (the orphan sweep eventually does it); we'd just be making it faster, which doesn't help the autonomous-run case.
- **Override after auto-answer via a `--force` flag.** Rejected for first ship — adds complexity for a use case (operator disagrees with auto-answer) that's better served by opening a new directive. Re-visit if real operator feedback shows the immutability is painful.
- **Indefinite retry on LLM failure.** Rejected — risks a retry storm if the provider is having an extended outage. One retry handles the transient-error common case; two failures suggest something structural that retrying won't fix.
- **Per-question opt-in to auto-answer (some questions explicitly mark themselves as "human-only, never auto-answer").** Rejected for first ship — the `ask_user` emission sites don't have rich enough metadata to make this distinction reliably, and the operator-facing surface (CLI flag at directive kickoff?) would require its own design pass. The simpler model is "every question can be auto-answered after the deadline; if a question genuinely requires a human, the operator answers within the deadline." If this turns out to be wrong, opt-out becomes a follow-up tier.

## Amendment — 2026-05-23 (Phase 14)

The auto-answer dispatcher's marker-recognition path (Phase 12.6) extends to recognize `[CRITIC]` alongside `[BUDGET]`. When a pending question's prompt begins with the `[CRITIC]` marker, the dispatcher applies a deterministic answer: `continue` (the wiki-readiness-exhausted default). No LLM call required — matches the `[BUDGET]` deterministic-bump-then-abort precedent. `answered_by = 'agent'` per the existing enum (rendered as "agent (auto)" in the Web UI).

## Amendment — 2026-05-24 (Tier 15)

The `[BUDGET]` marker branch added in Tier 12 (ADR 0032) and extended in the prior Tier 14 amendment block is removed. Per ADR 0034 (Budget Pool Paradigm), the `[BUDGET]` askUser is no longer created — pool exhaustion now parks the directive with a structured `blockedReason` and the operator unblocks via the project page Live tab. The auto-answer dispatcher now handles only the `[CRITIC]` marker (Tier 14) and generic LLM dispatch. `pickBudgetEscalationAnswer` helper deleted along with `packages/brain/src/budget-escalation.ts`. No supersedure — this is the consequence of ADR 0034's `[BUDGET]` deletion, mechanically removing a dependency.
