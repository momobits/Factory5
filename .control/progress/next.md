# Next session kickoff

> Auto-generated from `.control/progress/STATE.md` at 2026-05-08T15:56:49Z by
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

**No active phase.** Upgrade arc closed for the fifth time. Tiers 1–4 closed at `phase-4-cli-completion-closed` 2026-05-06; the audit-driven Tier 5 reopened the arc 2026-05-07 at `c0869d6` and closed at `phase-5-agent-prompts-closed` 2026-05-07; Tier 6 reopened 2026-05-07 at `542f99a` and closed at `phase-6-skills-rewrites-closed` 2026-05-07; Tier 7 reopened 2026-05-07 at `ee970e8` and closed at `phase-7-findings-mark-closed` 2026-05-08 at `40a78a8`; Tier 8 reopened 2026-05-08 at `8453086` and closed at `phase-8-question-auto-answer-closed` 2026-05-08 at this commit.

If the operator wants to continue, the carry-forward candidates from Phase 8's Deferred section are (ordered by demand-signal likelihood):

1. **U005 chat REPL cancel UX path (a+)** — twice-deferred (Phase 2 → Phase 4 → still open). Bumps timeout to 10 min + adds heartbeat + SIGINT handler + directive-id print + exit-with-cancel prompt. Tier 9 candidate. Highest-impact carry-forward.
2. **Per-project deadline override** — CLAUDE.md frontmatter or `metadata.askUserDeadlineMs`. Non-breaking to add atop Tier 8's daemon-wide config; defer-until-signal that different projects want different deadlines.
3. **`factory config get / set <key>` CLI** — operator surface for editing `<dataDir>/config.json`. Add when other config keys justify it.
4. **Override after auto-answer** — `factory questions answer --force <id>`. Pin via ADR if it ships; Tier 8 holds the simpler immutable-after-auto-answer invariant.
5. **`factory questions list / show <id>` CLI** — subcommands don't exist today; only `cleanup` is wired. Composition-style tier.
6. **`factory skills list / show <name>` CLI** — skill discovery surface. Composition-style; CLI runs `loadSkill(id)` against the per-user/per-project override paths the brain already uses.
7. **PageShell + Dashboard `<style is:global>` migration** — 11-page sweep absorbing filter-form Apply / "Clear all defaults" + inline-style audit. Self-contained ~1 commit.
8. **Structural `/session-end` lag-by-1 fix** — STATE.md tracking "last work commit" rather than HEAD, or amending STATE.md post-commit. **20 occurrences** accumulated through this session-end. Real engineering work.
9. **Agent-class-specialized auto-answer prompts** — defer-until-signal. Quality data on the generic Tier 8 prompt should drive any specialization.
10. **Channel-side `answered_by` badge** — Discord/Telegram historic embed rendering. Low value.
11. **ADR amendments** — 0027 §1 missing route pin (POST `/api/v1/projects`), 0002 footnote stale post-Tier-5. Doc-debt; not load-bearing.

To kick off Phase 9:

1. Operator drafts `UPGRADE/plans/tier-9-<name>.md` with goal, sub-steps, acceptance.
2. Add a Phase 9 row to `.control/architecture/phase-plan.md`.
3. Add a Tier 9 section to `UPGRADE/ROADMAP.md`.
4. Scaffold `.control/phases/phase-9-<name>/{README.md,steps.md}` from `.control/templates/`.
5. Then start working through the sub-steps.

If the operator doesn't want a Tier 9, the project is in a clean post-arc parking state — there's no queued work in the upgrade arc.

## Notes for next session

**No active phase.** The upgrade arc closed at `phase-8-question-auto-answer-closed`. To resume work, the operator can either:

1. **Author a Tier 9 plan** — most likely candidate per demand signal: **U005 chat REPL cancel UX path (a+)** (twice-deferred carry-forward; full path-(a+) sketch exists from the Phase 8 conversation). Or one of the Phase 8-introduced carry-forwards: per-project deadline override, `factory config get/set`, override-after-auto-answer. To start: draft `UPGRADE/plans/tier-9-<name>.md`, add a Phase 9 row to `.control/architecture/phase-plan.md`, add a Tier 9 section to `UPGRADE/ROADMAP.md`, scaffold `.control/phases/phase-9-<name>/{README.md,steps.md}`.

2. **Promote a carry-forward item** — see `## In-flight work` above. Order-of-likelihood (most likely demand signal first):
   - **U005 chat REPL cancel UX path (a+)** — twice-deferred; the operator-felt bug.
   - **`factory questions list / show <id>` CLI** — composition over existing query helpers; ~1 commit if narrowly scoped. Now that Tier 8 made `answered_by` real, the CLI list/show would render the badge end-to-end (closing one of the tier 8 plan-deviation gaps).
   - **`factory config get / set <key>` CLI** — operator surface for the Tier 8 config file.
   - **PageShell + Dashboard `<style is:global>` migration** — absorbs filter-form Apply / "Clear all defaults" + inline-style audit; self-contained ~1 commit.
   - **Structural `/session-end` lag-by-1 fix** — 20 occurrences accumulated. Real engineering work, not a one-liner.

3. **Park** — surfaces are stable; nothing is gated on more work.

**Read first** when next session resumes:

- [`UPGRADE/LOG.md`](../../UPGRADE/LOG.md) — full upgrade-side narrative across all eight closed tiers (Tier 8 entry now at the top).
- [`.control/progress/journal.md`](journal.md) — session-by-session control narrative.
- This file (`STATE.md`).

**Frontend-design judgement calls** carried from Phase 3 — not load-bearing for any active phase but worth recalling for any future web-side work: smart defaults beat empty states; native HTML beats custom widgets; theme-independent intentional colors for status semantics; error-class differentiation; visible-label vs. hover-title separation; inherit-don't-invent; root-cause CSS over global rewrites; hint-copy-teaches-consequence; in-context-affordance vs nav.

**Tier 8 in retrospect:** 8 work commits this session (scaffold + 8.1 → 8.7) plus this phase-close commit. Tier 8 was a real structural addition: schema migration + new ADR + new config home + brain-side LLM dispatcher with race mitigation + web surface. Total Tier 8 code: ~1900 lines added across the codebase (heaviest in 8.6's dispatcher + tests + 8.3's ADR + 8.2's migration). All 4 `pnpm` gates green throughout. Workspace count grew 1152 → 1182 + 3 skipped (+30 across migration, config, deadline-stamp, and dispatcher tests). New ADR (0030) — Tier 8 had real structural decisions to pin (provenance shape, config home, race mitigation, no-override). Two intentional plan deviations both noted in commit bodies + LOG: (1) `loadConfig` I/O placed in `@factory5/state` not `@factory5/core` to keep core fs-free; (2) prompt context pruned to question + options + directive + past Q&A for first ship per ADR 0030's "alternatives considered" — re-add when quality data shows the generic prompt underperforms. Drift fix #19 was carried into the scaffold commit (STATE.md inside scaffold referenced `cf9d4f9` while HEAD moved to `8453086`); the phase-close commit reintroduces the lag at #20, structural fix still pending.

**Tier 7 in retrospect:** 4 work commits this session (drift-fix `436887a` + scaffold `ee970e8` + 7.1 `b1dd5d6` + 7.2 `0d27925`) plus the phase-close commit. Tier 7 itself was pure composition: `factory findings mark` wraps the existing `updateFindingStatus` API with `runFindingsShow`-style disambiguation. Total Tier 7 code: ~80 lines of handler + 90 lines of Commander wiring + 130 lines of test fixtures. All 4 `pnpm` gates green throughout. Workspace count grew 1144 → 1152 from 7.2's 8 mark tests. No new ADRs (composition tier; no structural ambiguity). Drift fix #18 caught up mid-session via `docs(state)`; the phase-close commit reintroduces the lag at #19, structural fix still pending.

**Frontend-design judgement calls** carried from Phase 3 — not load-bearing for any active phase but worth recalling for any future web-side work: smart defaults beat empty states; native HTML beats custom widgets; theme-independent intentional colors for status semantics; error-class differentiation; visible-label vs. hover-title separation; inherit-don't-invent; root-cause CSS over global rewrites; hint-copy-teaches-consequence; in-context-affordance vs nav.

**Tier 6 in retrospect:** 11 work commits (scaffold + 6.1 → 6.last + the phase-close commit). Total session output: ~1100 lines added across the codebase (most in 6 skill rewrites + tier-6 plan + fixer parser code). All 4 `pnpm` gates green throughout. Workspace count grew 1135 → 1144 + 3 skipped from 6.3's parser tests. No new ADRs; the 6.3 attach-point homework found a clean precedent in `parse-findings.ts` (worker-side), no structural ambiguity to pin. Two per-skill verbatim-rule deviations (progress-tracking, scaffolding frontmatter descriptions) — both justified by factual wrongness against ADR 0021. The README done-criterion that said the parser would live in `packages/brain/src/` was contradicted by the homework finding (worker-side); intent satisfied, location revised in 6.3's commit body but README left as historical scaffold.
