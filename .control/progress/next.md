# Next session kickoff

> Auto-generated from `.control/progress/STATE.md` at 2026-05-07T17:34:44Z by
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

**No active phase.** The upgrade arc has closed for the second time (Tiers 1–4 closed at `phase-4-cli-completion-closed` 2026-05-06; the audit-driven Tier 5 reopened the arc 2026-05-07 at `c0869d6`; Tier 5 closed at `phase-5-agent-prompts-closed` 2026-05-07 at this commit).

If the operator wants to continue, the natural next move is **Tier 6 (skills review + rewrites)**. All 12 skills in `skills/` are "ported from factory2/skills/" per `docs/SKILLS.md`. Tier 5's four prompt rewrites referenced six of those skills (`tdd`, `code-review`, `error-recovery`, `ask-user`, `progress-tracking`, `work-verification`) without surfacing hot-fix-worthy drift; an audit-only pass might confirm they're fine, or might surface drift that warrants rewrites. Sized as 1–2 sessions per `UPGRADE/plans/tier-5-agent-prompts.md` Out-of-scope section.

To kick off Phase 6:

1. Operator drafts `UPGRADE/plans/tier-6-skills-rewrites.md` with goal, sub-steps, acceptance.
2. Add a Phase 6 row to `.control/architecture/phase-plan.md`.
3. Add a Tier 6 section to `UPGRADE/ROADMAP.md`.
4. Scaffold `.control/phases/phase-6-<name>/{README.md,steps.md}` from `.control/templates/`.
5. Then start working through the sub-steps, or run `/phase-close` again to land a kickoff.

If the operator doesn't want a Tier 6, the project is in a clean post-arc parking state — there's no queued work in the upgrade arc.

## Notes for next session

**No active phase.** The upgrade arc closed at `phase-5-agent-prompts-closed`. To resume work, the operator can either:

1. **Author a Tier 6 plan** — likely candidate: skills review + rewrites. Tier 5's 5.4–5.7 prompt rewrites referenced 6 skills (`tdd`, `code-review`, `error-recovery`, `ask-user`, `progress-tracking`, `work-verification`) without surfacing hot-fix-worthy drift; an audit-only pass might confirm they're clean, or might surface drift that warrants rewrites. Sized as 1–2 sessions. To start: draft `UPGRADE/plans/tier-6-skills-rewrites.md`, add a Phase 6 row to `.control/architecture/phase-plan.md`, add a Tier 6 section to `UPGRADE/ROADMAP.md`, scaffold `.control/phases/phase-6-<name>/{README.md,steps.md}`.

2. **Promote a carry-forward item** — see `## In-flight work` above. Each item ships as ~1 commit when authored. Order-of-likelihood (most likely demand signal first):
   - **`fixer→updateFindingStatus` parser path** — wiring it up gives the operator/CLI a real "mark FIXED" verb without manual `findings.json` edits. Solid Tier 6 candidate, possibly a sibling to skills review.
   - **U005 chat 120s timeout re-tier** — affects channel-chat UX directly.
   - **PageShell + Dashboard `<style is:global>` migration** — absorbs filter-form Apply / "Clear all defaults" + inline-style audit; self-contained ~1 commit.

3. **Park** — surfaces are stable; nothing is gated on more work.

**Read first** when next session resumes:

- [`UPGRADE/LOG.md`](../../UPGRADE/LOG.md) — full upgrade-side narrative across all five tiers (Tier 5 entry just appended).
- [`.control/progress/journal.md`](journal.md) — session-by-session control narrative.
- This file (`STATE.md`).

**Frontend-design judgement calls** carried from Phase 3 — not load-bearing for any active phase but worth recalling for any future web-side work: smart defaults beat empty states; native HTML beats custom widgets; theme-independent intentional colors for status semantics; error-class differentiation; visible-label vs. hover-title separation; inherit-don't-invent; root-cause CSS over global rewrites; hint-copy-teaches-consequence; in-context-affordance vs nav.

**Tier 5 in retrospect:** 8 work commits (5.1 → 5.8) plus this phase-close commit. Total session output ~1100 lines added across the codebase (most in 4 prompt files + ISSUES.md). All 4 `pnpm` gates green throughout. No new ADRs; pre-write homework for 5.4 + 5.5 confirmed runtime contracts that didn't need pinning. Tier 6 candidates surfaced (skills review, fixer→`updateFindingStatus` parser path, U005 re-tier).
