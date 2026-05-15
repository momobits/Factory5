# Next session kickoff

> Auto-generated from `.control/progress/STATE.md`. Edit STATE.md's "Next action"
> or "Notes for next session" to influence this prompt; **do not edit
> next.md by hand** -- it's overwritten on every session end.

This is a Control-managed project. Bootstrap protocol:

1. Read `.control/progress/STATE.md` -- the single source of truth.
2. Read the current phase's `README.md` and `steps.md` (path in STATE.md).
3. Check `.control/issues/OPEN/` for current-phase blockers.

If the SessionStart hook is installed, steps 1-3 run automatically and you
see a structured `[control:state]` block instead of doing them by hand.

## Next action

**No active phase. Upgrade arc closed for the sixth time** at `phase-9-control-room-redesign-closed` 2026-05-15. To resume work, the operator can:

1. **Author a Tier 10 plan** — most-likely candidate per demand signal: **U005 chat REPL cancel UX path (a+)** (now thrice-deferred through Tier 9 — was the operator-felt bug pre-Tier-8). Or one of the Phase 8-introduced carry-forwards (per-project deadline override, `factory config get/set`, override-after-auto-answer) or one of the Tier-9-deferred items (inline-style audit on the 12 pages, ADR 0031 for the editorial aesthetic).
2. **Promote a carry-forward item** — see STATE.md's `## In-flight work`.
3. **Park** — surfaces are stable; nothing is gated on more work.

**Previous arc-closes (for context):** Tiers 1–4 closed at `phase-4-cli-completion-closed` 2026-05-06; Tier 5 closed at `phase-5-agent-prompts-closed` 2026-05-07; Tier 6 closed at `phase-6-skills-rewrites-closed` 2026-05-07; Tier 7 closed at `phase-7-findings-mark-closed` 2026-05-08; Tier 8 closed at `phase-8-question-auto-answer-closed` 2026-05-08; Tier 9 closed at `phase-9-control-room-redesign-closed` 2026-05-15 — first tier in the arc that shipped visual-design work without an underlying contract change.

To kick off Phase 10:

1. Operator drafts `UPGRADE/plans/tier-10-<name>.md` with goal, sub-steps, acceptance.
2. Add a Phase 10 row to `.control/architecture/phase-plan.md`.
3. Add a Tier 10 section to `UPGRADE/ROADMAP.md`.
4. Scaffold `.control/phases/phase-10-<name>/{README.md,steps.md}` from `.control/templates/`.
5. Then start working through the sub-steps.

If the operator doesn't want a Tier 10, the project is in a clean post-arc parking state.

## Notes for next session

**Read first** when next session resumes:

- [`UPGRADE/LOG.md`](../../UPGRADE/LOG.md) — full upgrade-side narrative across all nine closed tiers (Tier 9 entry now at the top).
- [`.control/progress/journal.md`](journal.md) — session-by-session control narrative.
- [`.control/progress/STATE.md`](STATE.md) — this file's source of truth.

**Frontend-design judgement calls** carried from Phase 3 — not load-bearing for any active phase but worth recalling for any future web-side work: smart defaults beat empty states; native HTML beats custom widgets; theme-independent intentional colors for status semantics; error-class differentiation; visible-label vs. hover-title separation; inherit-don't-invent; root-cause CSS over global rewrites; hint-copy-teaches-consequence; in-context-affordance vs nav.

**Tier 9 in retrospect:** Three commits this session — bundled redesign + recordkeeping `397637c`, gitignore tweak `307d79c`, phase-close `9e8ee5c`. First aesthetic-only tier in the upgrade arc; no tests added (visual change), no new APIs, no new packages. Live browser smoke completed via Playwright MCP in-session (operator-side gate satisfied; README's "operator cannot open a browser" text was stale and got updated). Two false positives investigated and dismissed during smoke: Playwright cursor hover-retention masking nav active-state, and Chrome `currentColor` cache from pre-injection paint masking dark-mode contrast. Neither is a real production bug.

**Tier 8 in retrospect:** 8 work commits + phase-close. Real structural addition — schema migration + new ADR + new config home + brain-side LLM dispatcher with race mitigation + web surface. Workspace count grew 1152 → 1182 + 3 skipped (+30 across migration, config, deadline-stamp, dispatcher tests). ADR 0030 pinned six-part decision; two plan deviations both noted: (1) `loadConfig` I/O placed in `@factory5/state` not `@factory5/core`; (2) prompt context pruned to question + options + directive + past Q&A for first ship.

**Tier 7 in retrospect:** Pure composition — `factory findings mark` wraps the existing `updateFindingStatus` API. No new ADRs (no structural ambiguity). Status-enum cast had no surprises — TypeScript narrowed without explicit cast. Workspace count grew 1144 → 1152.

**Structural pending fix (now 26 occurrences):** `/session-end` lag-by-1 — STATE.md tracking "last work commit" rather than HEAD, OR amending STATE.md post-commit. The Tier 9 phase-close commit references itself as "Last commit: this commit" (the closer pattern), so the lag count doesn't grow this turn. But the structural fix to `/session-end` skill still hasn't shipped. Tier 10+ candidate.
