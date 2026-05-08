# Next session kickoff

> Auto-generated from `.control/progress/STATE.md` at 2026-05-08T10:46:30Z by
> `.claude/hooks/regenerate-next-md.sh`. Edit STATE.md's "Next action"
> or "Notes for next session" to influence this prompt; **do not edit
> next.md by hand** -- it's overwritten on every session end.

This is a Control-managed project. Bootstrap protocol:

1. Read `.control/progress/STATE.md` -- the single source of truth.
2. Read the current phase's `README.md` and `steps.md` (path in STATE.md).
3. Check `.control/issues/OPEN/` for current-phase blockers.

If the SessionStart hook is installed, steps 1-3 run automatically and you
see a structured `[control:state]` block instead of doing them by hand.

## Next action

**Step 8.1 — open U029.**

Open `U029 — unanswered ask_user blocks directive; no auto-answer fallback` in `UPGRADE/ISSUES.md` Open section. Severity: medium. Tier: 8. Area: brain. Hypothesis: brain stamps `deadline_at` on every `ask_user` from config (default 5 min); new tick-loop sweep dispatches LLM call for any open question past deadline + active parent directive; writes answer with `answered_by = 'agent'` (or `'agent-failed'` after one retry); directive proceeds. New schema column + ADR 0030 for the contract.

After 8.1 commits, advance to 8.2 (migration 009 — `pending_questions.answered_by` column + backfill).

Full plan: [`../../UPGRADE/plans/tier-8-question-auto-answer.md`](../../UPGRADE/plans/tier-8-question-auto-answer.md).
Phase scaffold: [`../phases/phase-8-question-auto-answer/`](../phases/phase-8-question-auto-answer/).

**Operator decisions baked in at scaffold time** (no further input needed for the in-scope sub-tasks):

- Provenance via new `answered_by` column (option A) — `'user' | 'agent' | 'agent-failed' | 'orphan-sweep'`.
- Default deadline 5 minutes, configurable via `<dataDir>/config.json` (`askUserDeadlineMs`); not hardcoded.
- No override after auto-answer — agent answer is final; race-loser human reply discarded with a log warning.
- U005 stays parked as Tier 9 candidate (path (a+): bump REPL daemon-reply timeout to 10 min + print directive id + heartbeat + SIGINT handler + clean exit prompt).

## Notes for next session

**Phase 8 active at 8.1.** Run the next session-start as usual; the cursor will land on 8.1 (open U029).

**Step 8.1 first commit shape:** `chore(8.1): open U029` — append the issue entry to `UPGRADE/ISSUES.md` Open section. No code edits; the ROADMAP rows + phase scaffold are pre-authored at this scaffold commit, so 8.1 is purely the issue-tracker entry.

**Pre-write homework before 8.2 (migration):**

- Re-read `packages/state/src/migrations/008-pending-questions-bot-message-id.ts` for the migration shape (ADD COLUMN + index pattern).
- Confirm `pendingQuestionSchema`'s location in `@factory5/core` and Zod's optional() semantics for the new field.
- Check the orphan-sweep `[orphaned by ...]` prefix string — confirm it's stable enough for the LIKE backfill SQL (it is per current `markOrphanAnswered` body).

**Pre-write homework before 8.5 (brain stamp):**

- `grep -rn "pendingQuestions.create\|insert.*pending_questions" packages/brain/src/ packages/worker/src/` — enumerate every `ask_user`-emitting call site.

**Pre-write homework before 8.6 (dispatcher + sweep):**

- Identify the brain's tick-loop entry — where the existing directive poll + orphan sweep live.
- Confirm the model/provider abstraction the brain uses for triage (auto-answer reuses it).
- Confirm `spend.record` signature for charging the auto-answer LLM call against the parent directive.

**Read first** when next session resumes:

- [`UPGRADE/LOG.md`](../../UPGRADE/LOG.md) — full upgrade-side narrative across all seven closed tiers (Tier 8 entry will be appended at session-end).
- [`UPGRADE/plans/tier-8-question-auto-answer.md`](../../UPGRADE/plans/tier-8-question-auto-answer.md) — full Tier 8 plan; richest source.
- [`.control/phases/phase-8-question-auto-answer/README.md`](../phases/phase-8-question-auto-answer/README.md) + [`steps.md`](../phases/phase-8-question-auto-answer/steps.md) — phase cursor.
- [`.control/progress/journal.md`](journal.md) — session-by-session control narrative.
- This file (`STATE.md`).

**Frontend-design judgement calls** carried from Phase 3 — not load-bearing for any active phase but worth recalling for any future web-side work: smart defaults beat empty states; native HTML beats custom widgets; theme-independent intentional colors for status semantics; error-class differentiation; visible-label vs. hover-title separation; inherit-don't-invent; root-cause CSS over global rewrites; hint-copy-teaches-consequence; in-context-affordance vs nav.

**Tier 7 in retrospect:** 4 work commits this session (drift-fix `436887a` + scaffold `ee970e8` + 7.1 `b1dd5d6` + 7.2 `0d27925`) plus the phase-close commit. Tier 7 itself was pure composition: `factory findings mark` wraps the existing `updateFindingStatus` API with `runFindingsShow`-style disambiguation. Total Tier 7 code: ~80 lines of handler + 90 lines of Commander wiring + 130 lines of test fixtures. All 4 `pnpm` gates green throughout. Workspace count grew 1144 → 1152 from 7.2's 8 mark tests. No new ADRs (composition tier; no structural ambiguity). Drift fix #18 caught up mid-session via `docs(state)`; the phase-close commit reintroduces the lag at #19, structural fix still pending.

**Frontend-design judgement calls** carried from Phase 3 — not load-bearing for any active phase but worth recalling for any future web-side work: smart defaults beat empty states; native HTML beats custom widgets; theme-independent intentional colors for status semantics; error-class differentiation; visible-label vs. hover-title separation; inherit-don't-invent; root-cause CSS over global rewrites; hint-copy-teaches-consequence; in-context-affordance vs nav.

**Tier 6 in retrospect:** 11 work commits (scaffold + 6.1 → 6.last + the phase-close commit). Total session output: ~1100 lines added across the codebase (most in 6 skill rewrites + tier-6 plan + fixer parser code). All 4 `pnpm` gates green throughout. Workspace count grew 1135 → 1144 + 3 skipped from 6.3's parser tests. No new ADRs; the 6.3 attach-point homework found a clean precedent in `parse-findings.ts` (worker-side), no structural ambiguity to pin. Two per-skill verbatim-rule deviations (progress-tracking, scaffolding frontmatter descriptions) — both justified by factual wrongness against ADR 0021. The README done-criterion that said the parser would live in `packages/brain/src/` was contradicted by the homework finding (worker-side); intent satisfied, location revised in 6.3's commit body but README left as historical scaffold.
