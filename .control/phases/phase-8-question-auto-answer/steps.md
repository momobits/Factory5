# Phase 8 Steps

- [ ] 8.1 — Open U029 (unanswered `ask_user` blocks directive; no auto-answer fallback) in [`../../../UPGRADE/ISSUES.md`](../../../UPGRADE/ISSUES.md). ROADMAP rows + phase scaffold pre-authored at scaffold time
- [ ] 8.2 — Migration 009 — `pending_questions.answered_by` column + backfill (orphan-sweep rows from `[orphaned by ...]` prefix; all other answered rows → `'user'`); update `pendingQuestionSchema` (`@factory5/core`) with optional `answeredBy` field; extend `pendingQuestions.answer` to accept `answeredBy` parameter (default `'user'`); update `markOrphanAnswered` to set `'orphan-sweep'` going forward
- [ ] 8.3 — ADR 0030 — pending-question auto-answer contract: pins `answered_by` enum, deadline-config home (`<dataDir>/config.json`), LLM dispatcher failure semantics, no-override-after-auto-answer rule; update `INDEX.md`; cross-reference ADR 0024
- [ ] 8.4 — `@factory5/core` `loadConfig()` reader for `<dataDir>/config.json` (Zod-validated; missing file returns defaults; partial file fills missing keys); export `DEFAULT_ASK_USER_DEADLINE_MS = 300_000`; `writeConfig(partial)` for tests + future operator commands; 6+ unit tests
- [ ] 8.5 — Brain stamps `deadline_at` from `loadConfig().askUserDeadlineMs` on every new `ask_user` pending-question; audit + update every `pendingQuestions.create` call site in `packages/brain/src/` and `packages/worker/src/`; existing tests updated with fake-clock injection to assert the stamping
- [ ] 8.6 — Brain auto-answer dispatcher + deadline sweep: new `findOpenPastDeadline(db, now)` query in `pending-questions.ts`; new `packages/brain/src/auto-answer.ts` builds prompt (question + options + parent directive + project CLAUDE.md + task log + recent findings + past Q&A) → dispatches via existing model/provider → writes `answered_by = 'agent'` on success / `'agent-failed'` on retry-then-fail; sentinel race-mitigation write before dispatch; spend recorded against parent directive on success; wire into brain tick loop; 10+ tests across query / dispatcher / end-to-end
- [ ] 8.7 — Surface updates: CLI `factory questions list` adds answerer column/icon, `factory questions show <id>` adds `Answered by:` line; web `/app/questions/index` + `/app/questions/detail` render the answerer; closes U029
- [ ] 8.close — `/phase-close` — tag `phase-8-question-auto-answer-closed`; append session entry to [`../../../UPGRADE/LOG.md`](../../../UPGRADE/LOG.md); scaffold Phase 9 if a tier-9 plan exists, otherwise re-close the upgrade arc

## Step detail

Each step's full detail (file pointers, acceptance criteria, edge cases, runtime-contract verification branches, suggested commit messages) is in [`../../../UPGRADE/plans/tier-8-question-auto-answer.md`](../../../UPGRADE/plans/tier-8-question-auto-answer.md) under the matching `### 8.<step>` heading. Below: just the commit-message templates and step-local guardrails.

### 8.1 — Open U029

Per [`../../../UPGRADE/plans/tier-8-question-auto-answer.md`](../../../UPGRADE/plans/tier-8-question-auto-answer.md) §8.1.

**Acceptance:** `UPGRADE/ISSUES.md` Open section grows by 1 entry (U029); U005 stays open and parked. ROADMAP scaffold and phase directory were pre-authored at scaffold time — verify both exist before opening the issue. All four `pnpm` gates green (no code touched yet).

**Commit:** `chore(8.1): open U029`

### 8.2 — Schema migration: `answered_by` column

Per [`../../../UPGRADE/plans/tier-8-question-auto-answer.md`](../../../UPGRADE/plans/tier-8-question-auto-answer.md) §8.2.

**Pre-write homework:** confirm migration 008's shape (add-column + index pattern); confirm `pendingQuestionSchema`'s frontmatter location in `@factory5/core`; confirm Zod's `optional()` semantics for the new field; confirm the orphan-sweep `[bracketed]` prefix string is stable enough to LIKE-match in the backfill SQL.

**Acceptance:** migration 009 lands with backfill correct for both pre-existing user and orphan-sweep rows, gated by a migration test mirroring `004-model-usage-mode.test.ts`. `pendingQuestionSchema` carries optional `answeredBy`. `pendingQuestions.answer(db, id, text, when, answeredBy?)` extends to a fifth optional parameter (default `'user'`). All four `pnpm` gates clean. Existing tests unmodified.

**Commit:** `feat(8.2): pending_questions.answered_by column + backfill`

### 8.3 — ADR 0030: auto-answer contract

Per [`../../../UPGRADE/plans/tier-8-question-auto-answer.md`](../../../UPGRADE/plans/tier-8-question-auto-answer.md) §8.3.

**Acceptance:** `docs/decisions/0030-pending-question-auto-answer.md` lands with full Context / Decision / Consequences / Alternatives. `INDEX.md` updated. Cross-reference appended to ADR 0024 in a non-decision section (ADR 0024 is accepted and immutable per CLAUDE.md). All four gates green (docs-only commit).

**Commit:** `docs(8.3): ADR 0030 — pending-question auto-answer contract`

### 8.4 — `@factory5/core` `loadConfig` reader

Per [`../../../UPGRADE/plans/tier-8-question-auto-answer.md`](../../../UPGRADE/plans/tier-8-question-auto-answer.md) §8.4.

**Pre-write homework:** confirm `dataDir()` from `@factory5/logger/paths` is stable across Windows + Linux; confirm `@factory5/core` already has Zod as a dependency (avoid pulling in a new one).

**Acceptance:** `loadConfig()` + `DEFAULT_ASK_USER_DEADLINE_MS` exported from `@factory5/core`. Atomic write-rename in `writeConfig`. 6+ unit tests covering the contract (missing file, partial file, invalid JSON, invalid schema, round-trip). All four gates green.

**Commit:** `feat(8.4): @factory5/core loadConfig + askUserDeadlineMs default`

### 8.5 — Brain stamps `ask_user` deadline

Per [`../../../UPGRADE/plans/tier-8-question-auto-answer.md`](../../../UPGRADE/plans/tier-8-question-auto-answer.md) §8.5.

**Pre-write homework:** `grep -rn "pendingQuestions.create\|insert.*pending_questions" packages/brain/src/ packages/worker/src/` to enumerate every `ask_user`-emitting call site. Confirm fake-clock injection pattern (`submitOneDirective`'s `now: () => number`).

**Acceptance:** every `ask_user` call site stamps `deadline_at = now() + askUserDeadlineMs`. Brain-side unit tests assert the stamping. All four gates green.

**Commit:** `feat(8.5): brain stamps ask_user deadline_at from config`

### 8.6 — Auto-answer dispatcher + deadline sweep

Per [`../../../UPGRADE/plans/tier-8-question-auto-answer.md`](../../../UPGRADE/plans/tier-8-question-auto-answer.md) §8.6.

**Pre-write homework:** identify the brain's tick-loop entry (where the existing directive poll + orphan sweep live). Confirm the model/provider abstraction the brain uses for triage — auto-answer reuses it. Confirm the spend-recording API signature.

**Acceptance:** new `findOpenPastDeadline` query, new `packages/brain/src/auto-answer.ts` dispatcher, brain tick wiring. Sentinel race-mitigation write before LLM dispatch (UPDATE-with-WHERE-`answered_at IS NULL` pattern; concurrent `factory answer` no-ops on the won row). 10+ tests across query + dispatcher + end-to-end. All four gates green.

**Commit:** `feat(8.6): brain auto-answer dispatcher + deadline sweep`

### 8.7 — Surface updates: CLI + web

Per [`../../../UPGRADE/plans/tier-8-question-auto-answer.md`](../../../UPGRADE/plans/tier-8-question-auto-answer.md) §8.7.

**Acceptance:** CLI `questions list` + `show` render the answerer for all four enum values. Web `questions/index` + `questions/detail` render the answerer. Reuses existing component library — no new design tokens. U029 marked Resolved in `UPGRADE/ISSUES.md` with commit ref. All four gates green.

**Commit:** `feat(8.7): surface answered_by in questions CLI + web`

### 8.close — Phase close

Run `/phase-close` after 8.7 lands and gates are green. Tags `phase-8-question-auto-answer-closed`. If a Phase 9 plan exists, scaffolds it; otherwise the upgrade arc closes out and STATE.md transitions back to "all phases complete".

**Commit:** auto-generated by `/phase-close`, shape: `chore(phase-8): close phase 8` (+ kickoff if Phase 9 plan exists).
