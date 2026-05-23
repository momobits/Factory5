# Next session kickoff

> Auto-generated from `.control/progress/STATE.md` at 2026-05-23T17:26:23Z by
> `.claude/hooks/regenerate-next-md.ps1`. Edit STATE.md's "Next action"
> or "Notes for next session" to influence this prompt; **do not edit
> next.md by hand** -- it's overwritten on every session end.

This is a Control-managed project. Bootstrap protocol:

1. Read `.control/progress/STATE.md` -- the single source of truth.
2. Read the current phase's `README.md` and `steps.md` (path in STATE.md).
3. Check `.control/issues/OPEN/` for current-phase blockers.

If the SessionStart hook is installed, steps 1-3 run automatically and you
see a structured `[control:state]` block instead of doing them by hand.

## Next action

**Arc-complete (tenth time — no Phase 15 planned).** Phase 14 closed and tagged. Operator decides next move:

1. **`/session-end`** to close out today (default — Tier 14 was a substantial 25-commit tier with a clean arc close).
2. **Author a new tier** if a fresh operator-felt issue surfaces. Carry-forwards available from spec §9 (Out of scope for Tier 14): generic critic loops for other stages (planner critic, build critic); diff-style architect output on retry; per-directive model category overrides; critic prompt context expansion (task_log, findings, prior similar projects); `maxWikiJudgeUsd` dollar cap; mid-task budget escalation; budget audit dashboard. Plus standing carry-forwards: U005 chat REPL UX (5x deferred), `/session-end` lag-by-1 structural fix (~#42 now), per-project `askUserDeadlineMs` override, `factory config get/set` CLI, etc.
3. **Run a follow-up live smoke** exercising the retry/exhaustion paths (today's smoke had the critic pass first try; an `--max-wiki-readiness-attempts 1` build against a deliberately bad spec would force the askUser exhaustion path live).

**Previous arc-closes (for context):** Tiers 1–4 closed at `phase-4-cli-completion-closed` 2026-05-06; Tier 5 at `phase-5-agent-prompts-closed` 2026-05-07; Tier 6 at `phase-6-skills-rewrites-closed` 2026-05-07; Tier 7 at `phase-7-findings-mark-closed` 2026-05-08 at `40a78a8`; Tier 8 at `phase-8-question-auto-answer-closed` 2026-05-08 at `d863ea0`; Tier 9 at `phase-9-control-room-redesign-closed` 2026-05-15 at `9e8ee5c`; Tier 10 at `phase-10-resume-and-activity-feed-closed` 2026-05-16 at `fbc3c27`; Tier 11 at `phase-11-directive-log-persistence-closed` 2026-05-16 at `343f101`; Tier 12 at `phase-12-budget-ux-closed` 2026-05-17 at `8231f87`; Tier 13 at `phase-13-budget-followups-closed` 2026-05-17 at `aae86dc`; Tier 14 at `phase-14-wiki-readiness-judge-closed` 2026-05-23 at `431c7da`.


## Notes for next session

**Phase 14 (wiki-readiness-judge) closed; upgrade arc complete (tenth time).** Replaced the regex `wikiReadiness` gate with an LLM critic loop per ADR 0033. Architect default flipped Opus → Sonnet; critic defaults Opus; both overridable via new `[agents.*]` config table. 8th budget axis `maxWikiReadinessAttempts` (default 3) caps architect+critic retry cycles; on exhaustion the brain files an askUser with `[continue/abort/extend-N]` and the auto-answer dispatcher recognizes the `[CRITIC]` marker for deterministic `continue`.

**Live smoke verified end-to-end** (Playwright MCP, directive `01KSAVBNVNTARM6EPFPPJFQZKT`, project tier-14-smoke, 2026-05-23). Activity panel narrated the full flow: `brain.architect-loop: critic: evaluating wiki (attempt 1/3)` → `brain.architect: calling claude-sonnet-4-6` (Sonnet flip live) → `architect: wrote 3 wiki pages` → `brain.critic: calling claude-opus-4-7 (category reasoning)` → `critic: passed — <full Opus verdict>` → planner runs normally. Wiki-phase spend $0.282 (architect $0.110 + critic $0.172). Critic passed first try — retry path NOT live-exercised (covered by 42 unit tests across critic/architect-loop/auto-answer modules). Persistence verified via API GET: `directive.payload.budgets.maxWikiReadinessAttempts: 3` round-tripped.

**Two pre-existing bugs incidentally caught and fixed during Tier 14:**

1. Phase 13.6's `maxUsdPerTask` was silently dropped by a hardcoded 6-axis list in `packages/wiki/src/project-metadata.ts::resolveDirectivePayloadBudgets`. Fixed in Task 14.9 by replacing the hardcoded list with `BUDGET_AXES` iteration. Regression tests added.
2. ADR 0030's promised `[CRITIC]` marker handler was written in the amendment block but never implemented in `auto-answer.ts`. Caught by the final code reviewer; fix at `431c7da`.

**Recommended next options for the next session:**

1. **Operator's stated intent — run a real end-to-end test.** Step-by-step guide handed off at the end of this session (see "End-to-end test runbook" below). The canonical loop: start factoryd → register project → mint a build directive via Web UI or CLI → observe the activity feed narrate triage → architect → critic → planner → workers → terminal status → spot-check outputs (wiki + findings + spend). Tier 14 added the architect-loop critic to this path; the smoke yesterday already exercised it once.
2. **Author a new tier** if a fresh operator-felt issue surfaces from the E2E test above. Available carry-forwards from Tier 14 §9 (Out of scope): generic critic loops for other stages (planner critic, build critic); diff-style architect output on retry; per-directive model category overrides; critic prompt context expansion; `maxWikiJudgeUsd` dollar cap; mid-task budget escalation; budget audit dashboard. Long-standing carry-forwards below.
3. **`/session-end`** if the E2E test goes clean and there's no follow-up work — arc-complete state is the natural resting point.
