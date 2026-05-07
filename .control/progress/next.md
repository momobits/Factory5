# Next session kickoff

> Auto-generated from `.control/progress/STATE.md` at 2026-05-07T20:32:56Z by
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

**No active phase.** The upgrade arc has closed for the third time (Tiers 1–4 closed at `phase-4-cli-completion-closed` 2026-05-06; the audit-driven Tier 5 reopened the arc 2026-05-07 at `c0869d6` and closed at `phase-5-agent-prompts-closed` 2026-05-07; the audit-driven Tier 6 reopened the arc 2026-05-07 at `542f99a` and closed at `phase-6-skills-rewrites-closed` 2026-05-07 at this commit).

If the operator wants to continue, three Tier 7+ candidates surfaced from Phase 6's Deferred section, ordered by demand-signal likelihood:

1. **`factory findings mark <id> <status>` CLI command** — operator-side parallel to 6.3's agent-side parser. Now that the agent-side flow is wired (RESOLUTION markers cause auto-flips), an operator-side CLI verb is the next composition. Probably ~1 commit; CLI command + test using the existing `updateFindingStatus` API. Solid Tier 7 candidate.
2. **U005 chat 120s timeout re-tier** — affects channel-chat UX directly. Carry-forward from Phase 2's Tier-2-or-4 designation; both shipped without addressing it.
3. **PageShell + Dashboard `<style is:global>` migration** — 11-page sweep absorbing filter-form Apply / "Clear all defaults" + inline-style audit. Self-contained ~1 commit.
4. **`factory skills list / show <name>` CLI commands** — skill discovery surface. Tier 8 candidate (deeper than the 1-commit items).

To kick off Phase 7:

1. Operator drafts `UPGRADE/plans/tier-7-<name>.md` with goal, sub-steps, acceptance.
2. Add a Phase 7 row to `.control/architecture/phase-plan.md`.
3. Add a Tier 7 section to `UPGRADE/ROADMAP.md`.
4. Scaffold `.control/phases/phase-7-<name>/{README.md,steps.md}` from `.control/templates/`.
5. Then start working through the sub-steps, or run `/phase-close` again to land a kickoff.

If the operator doesn't want a Tier 7, the project is in a clean post-arc parking state — there's no queued work in the upgrade arc.

## Notes for next session

**No active phase.** The upgrade arc closed at `phase-6-skills-rewrites-closed`. To resume work, the operator can either:

1. **Author a Tier 7 plan** — most likely candidate per demand signal: **`factory findings mark <id> <status>` CLI command** (operator-side parallel to the agent-side parser shipped in 6.3). ~1 commit. Or a small bundle if multiple Tier 7 candidates ship together. To start: draft `UPGRADE/plans/tier-7-<name>.md`, add a Phase 7 row to `.control/architecture/phase-plan.md`, add a Tier 7 section to `UPGRADE/ROADMAP.md`, scaffold `.control/phases/phase-7-<name>/{README.md,steps.md}`.

2. **Promote a carry-forward item** — see `## In-flight work` above. Each item ships as ~1 commit when authored. Order-of-likelihood (most likely demand signal first):
   - **`factory findings mark <id> <status>` CLI** — completes the agent + operator marker-flip surface; agent-side already shipped in 6.3.
   - **U005 chat 120s timeout re-tier** — affects channel-chat UX directly.
   - **PageShell + Dashboard `<style is:global>` migration** — absorbs filter-form Apply / "Clear all defaults" + inline-style audit; self-contained ~1 commit.

3. **Park** — surfaces are stable; nothing is gated on more work.

**Read first** when next session resumes:

- [`UPGRADE/LOG.md`](../../UPGRADE/LOG.md) — full upgrade-side narrative across all six tiers (Tier 6 entry just appended).
- [`.control/progress/journal.md`](journal.md) — session-by-session control narrative.
- This file (`STATE.md`).

**Frontend-design judgement calls** carried from Phase 3 — not load-bearing for any active phase but worth recalling for any future web-side work: smart defaults beat empty states; native HTML beats custom widgets; theme-independent intentional colors for status semantics; error-class differentiation; visible-label vs. hover-title separation; inherit-don't-invent; root-cause CSS over global rewrites; hint-copy-teaches-consequence; in-context-affordance vs nav.

**Tier 6 in retrospect:** 11 work commits (scaffold + 6.1 → 6.last + the phase-close commit). Total session output: ~1100 lines added across the codebase (most in 6 skill rewrites + tier-6 plan + fixer parser code). All 4 `pnpm` gates green throughout. Workspace count grew 1135 → 1144 + 3 skipped from 6.3's parser tests. No new ADRs; the 6.3 attach-point homework found a clean precedent in `parse-findings.ts` (worker-side), no structural ambiguity to pin. Two per-skill verbatim-rule deviations (progress-tracking, scaffolding frontmatter descriptions) — both justified by factual wrongness against ADR 0021. The README done-criterion that said the parser would live in `packages/brain/src/` was contradicted by the homework finding (worker-side); intent satisfied, location revised in 6.3's commit body but README left as historical scaffold.
