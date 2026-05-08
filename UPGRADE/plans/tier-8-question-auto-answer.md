# Tier 8 — `ask_user` deadline + LLM auto-answer

**Goal**: when an `ask_user` pending-question goes unanswered past its deadline, factory makes an LLM call with the question + surrounding context, writes the answer back, marks it `answered_by = 'agent'`, and lets the parent directive proceed. Today an unanswered question blocks its directive indefinitely (until the orphan sweep runs after the directive itself terminates) — autonomous runs stall waiting on a human who isn't there.

**Why this tier**: the `ask_user` flow is load-bearing — every agent class can emit it (verifier, fixer, planner, etc.). Today there's no "the human isn't coming back" path; the directive sits open until the orphan sweep retroactively fills `[orphaned by ...]` after the directive ends. That's forensic cleanup, not progress. A deadline + LLM auto-answer gives autonomous runs a way to keep going, and the `answered_by` provenance makes it auditable that the agent (not the operator) made the call.

**Estimated effort**: 2 sessions. ~7 substantive commits. Schema migration + ADR + brain-side sweep + LLM dispatch + surface updates.

**Issues addressed**: U029 (opened by 8.1: unanswered `ask_user` blocks directive indefinitely; no auto-answer fallback).

**Scope explicitly excluded**:

- **Override after auto-answer.** Once the agent has answered, the answer is final. No `factory questions answer <id>` flow that supersedes an `answered_by = 'agent'` row. If the operator disagrees, they can open a new directive citing the question they want re-asked. (Decision per operator: "no override, answer is final".)
- **Per-project deadline override.** First ship is daemon-wide config only. Per-project override (via CLAUDE.md frontmatter or `<project>/.factory/project.json`) is deferred — no demand signal yet, and adding the resolution chain after-the-fact is non-breaking.
- **Channel-side auto-answer surfacing.** Discord/Telegram already render historic Q&A via the channels' embed flows. Those flows render `answer` text as-is; an `answered_by` badge in the chat embed is out of scope (low value — the operator was the one who didn't reply).
- **U005 (chat REPL daemon-reply timeout).** Stays parked in `UPGRADE/ISSUES.md` Open. Different concern; see Tier 7's plan §"Out of scope" for the carry-forward note. Promote to Tier 9 only if the demand signal arrives.
- **Cost cap on the auto-answer LLM call.** The auto-answer charges against the parent directive's budget through the existing spend plumbing. No separate cap. If a directive's budget is exhausted, the auto-answer dispatcher fails through to the `[auto-answer failed: budget]` synthetic — same fallback as any other LLM call.
- **Bulk answer for multiple deadlines firing in one tick.** The sweep handles one question per tick iteration; if 5 deadlines elapse together, they're processed serially. Parallelization is a performance concern, not a correctness one — defer until the sweep shows up in profiles.

---

## Pre-requisites

Read before starting:

- `packages/state/src/queries/pending-questions.ts` — full file. Note the `deadline_at` column (already present, currently mostly nullable); the `markOrphanAnswered` precedent that writes synthetic answers with a `[bracketed]` prefix; the `findOrphaned` sweep that the brain already runs (`factory questions cleanup`).
- `packages/state/src/migrations/008-pending-questions-bot-message-id.ts` — migration shape. Tier 8's migration 009 follows this template.
- `packages/brain/src/pool.ts` (and wherever the brain emits `ask_user` outbounds) — the call site that creates the pending-question row. Tier 8 stamps `deadline_at` here.
- `packages/brain/src/` tick / poll loop — wherever the periodic worker scan lives. Tier 8's deadline sweep extends that tick.
- `packages/brain/src/prompts.ts` — `loadSkill(id)` and prompt-loading utilities. The auto-answer prompt is a new skill or a brain-internal prompt template.
- `packages/state/src/queries/spend.ts` — spend-recording API. The auto-answer LLM call records spend against the parent directive's project.
- `packages/cli/src/commands/questions.ts` — `factory questions list / show <id>` rendering. Tier 8 surfaces the `answered_by` badge.
- `apps/factory-web/src/pages/questions/` — web UI rendering. Same surface update.
- `docs/decisions/0024-worker-subprocess-ask-user.md` — the existing `ask_user` ADR. ADR 0030 (Tier 8) extends rather than supersedes it.

Verify all four gates pass before starting (`pnpm build && pnpm test && pnpm lint && pnpm format:check`).

---

## Sub-tasks

### 8.1 Open U029

**Today**: STATE.md's carry-forward menu listed "auto-answer pending questions" as a speculative item. No `UPGRADE/ISSUES.md` entry; no severity classification.

**Wire**:

- Open `U029 — unanswered ask_user blocks directive; no auto-answer fallback` in `UPGRADE/ISSUES.md` Open section. Severity: medium. Tier: 8. Area: brain. Hypothesis: brain stamps `deadline_at` on every `ask_user` (defaulting from config), a new tick-loop sweep dispatches an LLM call for any open question past deadline, writes the answer with `answered_by = 'agent'`, and the directive proceeds. New schema column + ADR for the contract.

**Acceptance**:

- `UPGRADE/ISSUES.md` Open section grows by 1 entry (U029); U005 stays open and parked.
- All four `pnpm` gates green (no code touched yet).

**Commit**: `chore(8.1): open U029`

### 8.2 Schema migration — `answered_by` column

**Today**: `pending_questions` has `answer` + `answered_at` but no provenance. The orphan-sweep encodes provenance via a `[orphaned by ...]` text prefix (`pending-questions.ts:272`).

**Goal**: structured provenance via a new `answered_by` enum-typed TEXT column.

**Wire**:

- `packages/state/src/migrations/009-pending-questions-answered-by.ts`:
  - `ALTER TABLE pending_questions ADD COLUMN answered_by TEXT;`
  - Backfill orphan-sweep rows: `UPDATE pending_questions SET answered_by = 'orphan-sweep' WHERE answer LIKE '[orphaned by factory questions cleanup at %]' AND answered_by IS NULL;`
  - Backfill all other answered rows: `UPDATE pending_questions SET answered_by = 'user' WHERE answered_at IS NOT NULL AND answered_by IS NULL;` (pre-Tier-8 user answers default to `'user'`).
  - Index: none. Field is read by id, not scanned.
- Migration test (mirrors `004-model-usage-mode.test.ts`): seed pre-migration rows of all three classes, run migration, assert backfill correctness.
- Update `pendingQuestionSchema` in `@factory5/core` with the new optional field (`answeredBy?: 'user' | 'agent' | 'agent-failed' | 'orphan-sweep'`). The `'agent-failed'` value covers the LLM-call-failure fallback (see 8.6).
- Update `rowToQuestion` + `create` + `answer` in `pending-questions.ts` to round-trip the column. Existing call sites pass through; only the new dispatcher (8.6) and the orphan sweep (8.7) write a non-null value.
- Update `markOrphanAnswered` to set `answered_by = 'orphan-sweep'` going forward (drop the `[bracketed]` prefix? — leave it for now, the prefix is forensic and harmless; only the structured column is load-bearing).

**Constraints**:

- **Column nullable.** Pre-migration rows that haven't been answered stay null; the answerer hasn't been determined yet.
- **Backfill is idempotent.** The migration runs once per database; the `WHERE answered_by IS NULL` predicate makes a re-run a no-op on already-backfilled rows.
- **Schema validation** (Zod) enforces the four-value enum on writes; reads relax to `string | undefined` to tolerate any pre-migration null rows that somehow slipped through.

**Acceptance**:

- Migration 009 lands, gated by the migration test.
- `pendingQuestionSchema` carries the optional `answeredBy` field.
- `pendingQuestions.answer(db, id, text, when)` extends to a fourth optional `answeredBy` parameter (default `'user'` for the existing call sites — the operator-driven `factory answer` and channel-reply paths).
- All four `pnpm` gates clean. Existing tests unmodified.

**Commit**: `feat(8.2): pending_questions.answered_by column + backfill`

### 8.3 ADR 0030 — auto-answer contract + config home

**Today**: no ADR pins the `answered_by` semantics or the deadline-config source. ADR 0024 covers the `ask_user` worker-subprocess flow but predates auto-answer.

**Wire**:

- Author `docs/decisions/0030-pending-question-auto-answer.md` (next free number).
  - **Context**: ADR 0024 set up `ask_user` as worker-emitted outbound + state row; the original assumption was a human always answers. Autonomous runs need a path forward when the human is absent.
  - **Decision**:
    - `pending_questions.answered_by` enum: `'user' | 'agent' | 'agent-failed' | 'orphan-sweep'`.
    - Deadline default: 5 minutes; configurable via `<dataDir>/config.json` (uses `@factory5/logger/paths` `dataDir()` — same root as `factory.db`). New file; ship a writer + reader in `@factory5/core` or a small new `@factory5/config` package (decide in 8.4).
    - Schema: `{ "askUserDeadlineMs": 300000 }`. Missing file or missing key → fall back to the 5-minute default.
    - The brain stamps `deadline_at` on every new `ask_user` pending-question. Pre-existing nullable behaviour preserved for non-`ask_user` rows (none currently emit, but future surfaces can opt out).
    - LLM auto-answer prompt: brain-internal (not under `prompts/agents/` or `skills/` — this is a system call, not an agent invocation). Uses the existing model/provider plumbing; spend recorded against the parent directive.
    - Failure path: retry once with backoff → on second failure write `answered_by = 'agent-failed'` + `answer = '[auto-answer failed: <reason>]'`. The directive proceeds from the synthetic answer same as a successful one.
    - No override: an `answered_by != 'user'` row is final. Subsequent answer attempts (race condition: human reply lands after auto-answer) log a warning and discard.
  - **Consequences**: agent-class spend now includes auto-answer LLM calls; ADR 0021 spend taxonomy extends. Provenance is queryable, so analytics like "what fraction of questions were auto-answered" become possible. Adds a brain-side dependency on the new config file location.
  - **Alternatives considered**:
    - Per-project CLAUDE.md frontmatter for the deadline. Deferred — no demand signal that different projects need different deadlines, and adding a project-level override later is non-breaking.
    - Skip the LLM entirely; just timeout-fail the directive with a marker. Rejected — the value of auto-answer is _progress_, not just _exit_.
    - `[bracketed]` text-only provenance, no schema column. Rejected — would force every consumer to string-parse to know the answerer.
- Update `docs/decisions/INDEX.md` with the new entry.
- Cross-reference from ADR 0024 — append a "See also: ADR 0030" line (NOT an edit to the Decision section; ADR 0024 is accepted and immutable per CLAUDE.md, but a "See also" pointer in a non-decision section is acceptable).

**Acceptance**:

- ADR 0030 in `docs/decisions/` with full Context / Decision / Consequences / Alternatives.
- `INDEX.md` updated.
- All four gates green (this commit is docs-only).

**Commit**: `docs(8.3): ADR 0030 — pending-question auto-answer contract`

### 8.4 Config plumbing — `~/.factory5/config.json` reader

**Today**: no daemon-wide config file. Per-project config lives in `<project>/.factory/project.json`. Daemon endpoint info lives in `<dataDir>/daemon.json`.

**Goal**: a reader for `<dataDir>/config.json` that surfaces `askUserDeadlineMs` (and is extensible for future config keys without a churn).

**Wire**:

- Decide package home: extend `@factory5/core` with a `loadConfig()` reader, OR create a thin new `@factory5/config` package. Recommend: **`@factory5/core`** — single function, ~30 lines, no need for a new package boundary.
- `loadConfig(): { askUserDeadlineMs: number; ... }` — reads `<dataDir>/config.json`, returns parsed object with defaults filled in. Validates via Zod. Missing file → all defaults.
- Default constant: `DEFAULT_ASK_USER_DEADLINE_MS = 300_000` (5 minutes), exported from the same module.
- `writeConfig(partial)` — for tests + future operator commands. Writes `<dataDir>/config.json` atomically (write-rename pattern).
- 6+ unit tests: missing file returns defaults; partial file fills missing keys with defaults; invalid JSON throws clearly; invalid schema (e.g. `askUserDeadlineMs: "5m"` instead of ms number) throws clearly; round-trip via writeConfig + loadConfig.

**Constraints**:

- **No CLI surface in this sub-task.** A future `factory config get / set <key>` is a separate concern; out of scope here.
- **Cross-platform paths.** `dataDir()` from `@factory5/logger/paths` already handles Windows + Linux correctly; reuse, don't reinvent.
- **No env-var fallback.** Config file is the single source. (Test injection for unit tests goes via direct path argument, not env vars.)

**Acceptance**:

- `loadConfig()` + `DEFAULT_ASK_USER_DEADLINE_MS` exported from `@factory5/core`.
- 6+ unit tests covering the config-reader contract.
- All four gates green.

**Commit**: `feat(8.4): @factory5/core loadConfig + askUserDeadlineMs default`

### 8.5 Brain-side: stamp `deadline_at` on `ask_user` emission

**Today**: the brain emits `ask_user` outbound + creates a `pending_questions` row with `deadline_at` left null in many call sites. The deadline column exists but is honoured nowhere.

**Goal**: every new `ask_user` pending-question gets `deadline_at = now() + askUserDeadlineMs` from config.

**Wire**:

- Audit: `grep -rn "pendingQuestions.create\|insert.*pending_questions" packages/brain/src/ packages/worker/src/`. List every `ask_user`-emitting call site.
- For each: ensure the `PendingQuestion` object passed to `pendingQuestions.create` has `deadlineAt` populated:
  - Read `loadConfig().askUserDeadlineMs` once at brain startup (or lazily on first emit, then cache).
  - `deadlineAt: new Date(Date.now() + askUserDeadlineMs).toISOString()`.
- Tests: update existing pending-question creation tests to assert `deadline_at` is non-null with an expected value range (use a fake clock injection — same pattern as `submitOneDirective`'s `now: () => number` deps).

**Constraints**:

- **Don't change the brain's poll cadence** — that's a separate concern. This sub-task only stamps the deadline; the sweep that consumes it lives in 8.6.
- **Backfill nothing.** Pre-existing rows with `deadline_at = null` are left alone — the auto-answer dispatcher (8.6) treats null as "no deadline", same as today.
- **No retroactive deadline on the orphan sweep.** That's a separate sweep with its own semantics.

**Acceptance**:

- Every `ask_user` call site in the brain stamps `deadline_at`.
- Brain-side unit tests assert the stamping happens with the configured deadline.
- All four gates green.

**Commit**: `feat(8.5): brain stamps ask_user deadline_at from config`

### 8.6 Brain-side: deadline sweep + LLM auto-answer dispatcher

**Today**: the brain has a tick loop that polls for new directives and runs the orphan sweep. No deadline-driven sweep exists.

**Goal**: every brain tick scans for open questions past deadline whose parent directive is still active; for each, build an LLM prompt + dispatch + write the answer back with `answered_by = 'agent'` (or `'agent-failed'`).

**Wire**:

- New `findOpenPastDeadline(db, now)` query in `packages/state/src/queries/pending-questions.ts`:
  - `SELECT pq.* FROM pending_questions pq JOIN directives d ON d.id = pq.directive_id WHERE pq.answered_at IS NULL AND pq.deadline_at IS NOT NULL AND pq.deadline_at < ? AND d.status NOT IN ('complete','failed','blocked')`.
  - Sorted by `deadline_at ASC` so oldest-overdue is processed first.
- New brain-side dispatcher `packages/brain/src/auto-answer.ts`:
  - `autoAnswerPendingQuestion(db, q, deps): Promise<void>`.
  - Build prompt from: `q.question`, `q.options` (if any), the parent directive (intent + payload + source), the project's CLAUDE.md (read via existing project-resolution plumbing), the linked task's `task_log` (if `q.taskId` is set — read via `tasksInflight.getById` + log query), recent findings on the directive, past Q&A in this directive (via `pendingQuestions.openForDirective` extended to include answered).
  - Dispatch via the existing model/provider abstraction (whatever the brain uses for triage; reuse, don't reinvent).
  - On success: `pendingQuestions.answer(db, q.id, llmReply, now, 'agent')`. Record spend against the directive's project (via `spend.record` or wherever the brain currently records it).
  - On first failure: retry once with 2-second backoff.
  - On second failure: `pendingQuestions.answer(db, q.id, '[auto-answer failed: ' + reason + ']', now, 'agent-failed')`. No spend recorded (failed call may or may not have charged provider-side; deferred to provider-billing reconciliation).
- Wire into the brain tick loop: after the existing directive poll + before/after the orphan sweep (order doesn't matter functionally; pick the spot that minimizes log noise).
- Tests:
  - `findOpenPastDeadline` unit tests: empty DB → empty; one overdue + active-directive → returns it; one overdue + terminal-directive → excluded; one not-yet-overdue → excluded; null deadline → excluded.
  - `autoAnswerPendingQuestion` unit tests with a mocked LLM provider: success path writes answered_by='agent'; first-failure-then-success path; double-failure writes answered_by='agent-failed'; spend recorded on success only.
  - End-to-end test: fake clock + fake provider; create a pending question with deadline 1ms; run one tick; assert answer present + provenance correct + directive eligible to proceed.

**Constraints**:

- **Sweep is brain-side, not daemon-side.** The brain owns directive lifecycle; daemon is the IPC + transport layer. Putting the sweep in the brain keeps the dependency arrow clean.
- **No `process.exit` / no logger config side effects** in `auto-answer.ts`. Pure async function; tests drive directly.
- **Spend recording is best-effort.** If `spend.record` throws, log the error and continue — don't block the answer write. The directive shouldn't stall on a billing-system glitch.
- **Concurrency.** Two ticks racing on the same overdue question is theoretically possible if the tick interval is shorter than the LLM call. Mitigate with a sentinel write at the start of the dispatch (e.g. `UPDATE pending_questions SET answered_by = 'agent', answer = '[in flight]' WHERE id = ? AND answered_at IS NULL`) — the second racer sees no rows updated and skips. Refine to a real ANSWERING-state column if races become common.
- **No prompt template under `prompts/agents/`.** This is a system-internal call, not a named agent; the prompt lives in `auto-answer.ts` as a string template (with the same `loadSkill`-style parameter substitution where useful).

**Acceptance**:

- New `findOpenPastDeadline` query + `autoAnswerPendingQuestion` dispatcher + brain tick wiring.
- 10+ tests across the three modules.
- End-to-end test demonstrates the full deadline → auto-answer → directive-proceeds path.
- All four gates green.

**Commit**: `feat(8.6): brain auto-answer dispatcher + deadline sweep`

### 8.7 Surface updates — CLI + web

**Today**: `factory questions list / show <id>` and the web `/app/questions/*` pages render `answer` + `answered_at` but nothing about who answered.

**Goal**: surface `answered_by` in the existing rendering paths.

**Wire**:

- `packages/cli/src/commands/questions.ts`:
  - `factory questions list`: add a column or icon (e.g. ` [agent]` / ` [user]` / ` [orphan]` suffix on each row's status). Keep the row terse.
  - `factory questions show <id>`: add an explicit "Answered by:" line below "Answered at:". Render `'agent-failed'` distinctly (e.g. with a `(LLM failure fallback)` parenthetical).
- `apps/factory-web/src/pages/questions/index.astro` — update the table to include an "Answered by" column (or a badge in the existing row).
- `apps/factory-web/src/pages/questions/detail.astro` — add the "Answered by" field in the same block as "Answered at".
- Use the existing component library — `<Badge>` if one exists, otherwise just text. Don't introduce new components for this.
- Tests: extend the existing CLI questions tests to cover the four `answered_by` values; web tests follow the existing component test patterns.

**Constraints**:

- **No styling that depends on theme tokens not already in use.** The badge / text colour for `'agent'` should reuse an existing semantic colour (probably the same one used for system-emitted messages elsewhere); no new design tokens.
- **Missing `answered_by`** (i.e. the row was answered before the migration backfill ran — shouldn't happen, but defensive): render as `(unknown)`.

**Acceptance**:

- CLI `questions list` + `show` render the answerer.
- Web `questions/index` + `questions/detail` render the answerer.
- All four gates green.

**Commit**: `feat(8.7): surface answered_by in questions CLI + web`

### 8.close /phase-close

Run `/phase-close` after 8.7 lands and gates are green. Tags `phase-8-question-auto-answer-closed`. No Phase 9 plan exists at scaffold time; the upgrade arc closes again unless the operator authors a Tier 9 in advance (Tier 9 candidate: U005 chat REPL cancel UX path (a+)).

**Commit**: auto-generated by `/phase-close`, shape: `chore(phase-8): close phase 8`.

---

## Acceptance criteria for the whole tier

- All four `pnpm` gates pass after every commit.
- Migration 009 lands with backfill correct for both pre-existing user and orphan-sweep rows.
- Every new `ask_user` stamps `deadline_at` from `<dataDir>/config.json` (`askUserDeadlineMs`, default 5 min).
- Brain tick sweep + LLM dispatcher fire when an open question goes past deadline + parent directive is still active.
- Successful auto-answer writes `answered_by = 'agent'` + records spend; failed auto-answer (after one retry) writes `answered_by = 'agent-failed'` with a `[auto-answer failed: <reason>]` synthetic answer.
- CLI + web surface the `answered_by` field for all four enum values.
- ADR 0030 lands with the full contract.
- Issue U029 marked Resolved with commit ref. U005 stays open, parked.
- Tier 8 ROADMAP rows ticked.
- Append session entry to `UPGRADE/LOG.md` at session end.

---

## Risks + decisions

- **Config home is daemon-wide, not per-project.** Operator-confirmed at plan-write time. Per-project deadline override (CLAUDE.md frontmatter or `<project>/.factory/project.json`) is non-breaking to add later — the resolution chain extends to `project → daemon → default` without schema churn. First ship is single-source.
- **5-minute default deadline.** Operator-confirmed. Long enough that an attentive operator answers, short enough that an autonomous run isn't materially blocked. The whole point of config-as-file is that this number is changeable without redeploying.
- **No override after auto-answer.** Operator-confirmed. The `answered_by != 'user'` row is final; race-loser writes are discarded with a log warning. Simpler model; any future "supersede" verb is its own ADR.
- **LLM call cost.** Each auto-answer is a real provider call charged against the parent directive's budget. Estimate ~$0.01-0.05 per call. If a directive's budget is exhausted, the dispatcher falls through to `'agent-failed'` — the directive's own budget-enforcement code handles whether it then halts or proceeds.
- **LLM call quality.** First ship uses a generic prompt assembled from question + directive + CLAUDE.md + task log + findings + Q&A history. There's no agent-class-specific tailoring (verifier-emitted questions don't get a verifier-flavoured prompt, etc.). If quality is bad in practice, a follow-up tier can specialize the prompt per emitting agent. Not pre-optimized.
- **Race between human reply and auto-answer.** The 8.6 dispatcher writes a sentinel ANSWERING marker before the LLM call so concurrent `factory answer` lands on a no-op UPDATE. This is correct-by-construction; the human's reply is discarded with a warning. If this becomes common in practice, surface a CLI message like "an agent answered this question while you were typing" — out of scope for v1.
- **Sweep frequency.** The brain tick loop already runs at some cadence (~1-5 seconds). Adding the deadline sweep doesn't change the cadence; the sweep query is cheap (indexed by directive_id, filters to small open-question count). No perf concern at expected scale.
- **`'agent-failed'` semantics.** This is _the answer the auto-answer system gave when its LLM call failed_. It's not "the directive failed" — the directive proceeds from the synthetic answer. If the directive's own logic can't proceed without a real answer, that's the directive's failure mode, surfaced through normal directive-status flow. The auto-answer tier doesn't introduce a new "directive failed because auto-answer failed" path.
- **No new ADRs beyond 0030.** Tier 8's structural decisions are all captured in ADR 0030. If 8.6's race mitigation needs a stronger primitive (e.g. a real ANSWERING column), that's an ADR 0031 and a sub-tier.

---

## Suggested commit shape

8-commit tier:

1. `chore(8.1): open U029`
2. `feat(8.2): pending_questions.answered_by column + backfill`
3. `docs(8.3): ADR 0030 — pending-question auto-answer contract`
4. `feat(8.4): @factory5/core loadConfig + askUserDeadlineMs default`
5. `feat(8.5): brain stamps ask_user deadline_at from config`
6. `feat(8.6): brain auto-answer dispatcher + deadline sweep`
7. `feat(8.7): surface answered_by in questions CLI + web`
8. `chore(phase-8): close phase 8`

---

## Out of scope — Tier 9+ candidate

- **U005 chat REPL cancel UX path (a+).** Carry-forward from Phase 2's Tier-2-or-4 designation; twice-deferred. Tier 9 candidate. Path (a+): bump timeout to 10 min + print directive id + heartbeat + SIGINT handler + clean exit prompt.
- **Per-project deadline override.** CLAUDE.md frontmatter or `<project>/.factory/project.json` `metadata.askUserDeadlineMs`. Non-breaking to add; deferred until demand signal.
- **`factory config get / set <key>` CLI.** Operator surface for editing `<dataDir>/config.json` without hand-editing the JSON. Out of scope here; add when other config keys need editing too.
- **Override after auto-answer.** A future tier could add a `factory questions answer --force <id>` that overrides an `answered_by != 'user'` row. Pin via ADR if it ships.
- **Channel-side `answered_by` badge.** Discord/Telegram embed render currently shows `answer` text only; adding the answerer to historic embeds is a low-value polish.
- **Bulk auto-answer perf.** Parallelizing the sweep when many deadlines fire simultaneously. Defer until profiles show the serial sweep is a bottleneck.
- **Agent-class-specialized prompts.** Per-emitting-agent prompt templates (verifier-flavoured, fixer-flavoured, etc.). Defer until quality data shows the generic prompt underperforms.
- **`factory skills list / show <name>` CLI** — skill discovery surface; carry-forward; no demand signal.
- **PageShell + Dashboard `<style is:global>` migration** — 11-page sweep; carry-forward.
- **ADR amendments** — 0027 §1 missing route pin (POST `/api/v1/projects`), 0002 footnote stale post-Tier-5; doc-debt only.
