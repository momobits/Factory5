# Next session kickoff

> Auto-generated from `.control/progress/STATE.md` at 2026-05-16T00:44:46Z by
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

**Phase 10 (resume-and-activity-feed) scaffolded, awaiting 10.1.** Tier 10 reopens the upgrade arc post-Phase-9-close. Operator-felt incident driving the tier: `automl` build directive `01KRQ1RPE5SM6Q8AYSRHHAPG39` failed at the planner Zod-parse step 2026-05-16 with no narrative surfacing in the dashboard. Two surfaces ship:

1. **`POST /api/v1/directives/:id/resume`** daemon route — HTTP mirror of `factory resume` CLI (`packages/cli/src/commands/resume.ts`). Web UI gains a Resume button on directive-detail (terminal status) + per-row Resume link on Projects index.
2. **Brain `emitLogLine` coverage** — narrative sites at every brain stage entry / exit / error. Planner parse-fail and Zod-fail surface first 500 chars of LLM output as `attrs.detail`. SSE plumbing from Phase 3 (ADR 0029) already in place; only emission-side coverage was sparse.
3. **ADR 0031** pins the log-forwarder design: manual emit sites as first-ship; pino-transport-tap deferred to Tier 11+.

Next step: 10.1 — open U030 in `UPGRADE/ISSUES.md` Open section. Severity medium; Tier 10; Area web + brain. Then 10.2 (ADR 0031), 10.3 (emit sites), 10.4 (daemon route), 10.5 (UI surfaces), 10.6 (activity panel refinements), 10.7 (`/phase-close`).

**Previous arc-closes (for context):** Tiers 1–4 closed at `phase-4-cli-completion-closed` 2026-05-06; the audit-driven Tier 5 reopened the arc 2026-05-07 at `c0869d6` and closed at `phase-5-agent-prompts-closed` 2026-05-07; Tier 6 reopened 2026-05-07 at `542f99a` and closed at `phase-6-skills-rewrites-closed` 2026-05-07; Tier 7 reopened 2026-05-07 at `ee970e8` and closed at `phase-7-findings-mark-closed` 2026-05-08 at `40a78a8`; Tier 8 reopened 2026-05-08 at `8453086` and closed at `phase-8-question-auto-answer-closed` 2026-05-08 at `d863ea0`; Tier 9 reopened 2026-05-15 at `397637c` and closed at `phase-9-control-room-redesign-closed` 2026-05-15 at `9e8ee5c`. Tier 10 reopens 2026-05-16 at this scaffold commit.


## Notes for next session

**No active phase.** The upgrade arc closed at `phase-9-control-room-redesign-closed` 2026-05-15. To resume work, the operator can either:

1. **Author a Tier 10 plan** — most-likely candidate per demand signal: **U005 chat REPL cancel UX path (a+)** (now thrice-deferred — was the operator-felt bug pre-Tier-8). Or one of the Phase 8-introduced carry-forwards (per-project deadline override, `factory config get/set`, override-after-auto-answer) or one of the Tier-9-deferred items (inline-style audit on the 12 pages, ADR 0031 for the editorial aesthetic). To start: draft `UPGRADE/plans/tier-10-<name>.md`, add a Phase 10 row to `.control/architecture/phase-plan.md`, add a Tier 10 section to `UPGRADE/ROADMAP.md`, scaffold `.control/phases/phase-10-<name>/{README.md,steps.md}`.

2. **Promote a carry-forward item** — see `## In-flight work` above. Order-of-likelihood (most likely demand signal first):
   - **U005 chat REPL cancel UX path (a+)** — thrice-deferred; the operator-felt bug.
   - **`factory questions list / show <id>` CLI** — composition over existing query helpers; ~1 commit if narrowly scoped. Tier 8 made `answered_by` real; CLI list/show would render the badge end-to-end.
   - **`factory config get / set <key>` CLI** — operator surface for the Tier 8 config file.
   - **Inline-style audit on the 12 pages** — Tier 9 absorbed the PageShell migration de facto but cosmetic-only `style=` attributes remain (e.g. `index.astro:15` `style="margin-top: 1.5rem;"`). ~30-min sweep.
   - **ADR 0031 — Editorial Control Room aesthetic + dual-theme tokens** — pin Tier 9's design system retrospectively if a follow-up tier wants to lean on it.
   - **Structural `/session-end` lag-by-1 fix** — 26 occurrences accumulated. Real engineering work, not a one-liner.

3. **Park** — surfaces are stable; nothing is gated on more work.

**Read first** when next session resumes:

- [`UPGRADE/LOG.md`](../../UPGRADE/LOG.md) — full upgrade-side narrative across all nine closed tiers (Tier 9 entry now at the top).
- [`.control/progress/journal.md`](journal.md) — session-by-session control narrative.
- This file (`STATE.md`).

**Frontend-design judgement calls** carried from Phase 3 — not load-bearing for any active phase but worth recalling for any future web-side work: smart defaults beat empty states; native HTML beats custom widgets; theme-independent intentional colors for status semantics; error-class differentiation; visible-label vs. hover-title separation; inherit-don't-invent; root-cause CSS over global rewrites; hint-copy-teaches-consequence; in-context-affordance vs nav. **Tier 9 added** a new vocabulary on top: vermillion (`#ff4d1c`) as the singular signal color; Fraunces italic display + Bricolage Grotesque body + JetBrains Mono data; CSS custom-property tokens (`--bg / --surface / --ink / --hairline / --signal / --amber / --acid / --halt / --cool`) flipped by `prefers-color-scheme`; paper-grain SVG atmosphere via `body::before / body::after`; editorial masthead with brand mark `§` + numbered nav + monospaced status pip + pulse animation.

**Tier 9 in retrospect:** Four commits this session — bundled redesign + recordkeeping `397637c`, gitignore tweak `307d79c`, phase-close `9e8ee5c`, next.md regen `faeb209`. First aesthetic-only tier in the upgrade arc; no tests added (visual change only), no new APIs, no new packages, workspace count unchanged at 1182 + 3 skipped. The "informal cadence" (no per-step commits, no ADR, post-hoc recordkeeping) worked because the redesign was a single-author single-session concept transfer from a sibling project — per-step commits would have added friction without information. Live browser smoke completed via Playwright MCP in-session, satisfying the operator-side gate that the README originally said couldn't be assistant-driven. Two false positives investigated and dismissed during smoke (Playwright cursor hover-retention on the nav active-state, Chrome `currentColor` cache from pre-injection paint on dark-mode body copy); neither is a production bug. Absorbed Phase 8's "PageShell + Dashboard `<style is:global>` migration" de facto — global stylesheet now carries the look pages have always referenced via shared classes.

**Tier 8 in retrospect:** 8 work commits this session (scaffold + 8.1 → 8.7) plus this phase-close commit. Tier 8 was a real structural addition: schema migration + new ADR + new config home + brain-side LLM dispatcher with race mitigation + web surface. Total Tier 8 code: ~1900 lines added across the codebase (heaviest in 8.6's dispatcher + tests + 8.3's ADR + 8.2's migration). All 4 `pnpm` gates green throughout. Workspace count grew 1152 → 1182 + 3 skipped (+30 across migration, config, deadline-stamp, and dispatcher tests). New ADR (0030) — Tier 8 had real structural decisions to pin (provenance shape, config home, race mitigation, no-override). Two intentional plan deviations both noted in commit bodies + LOG: (1) `loadConfig` I/O placed in `@factory5/state` not `@factory5/core` to keep core fs-free; (2) prompt context pruned to question + options + directive + past Q&A for first ship per ADR 0030's "alternatives considered" — re-add when quality data shows the generic prompt underperforms. Drift fix #19 was carried into the scaffold commit (STATE.md inside scaffold referenced `cf9d4f9` while HEAD moved to `8453086`); the phase-close commit reintroduces the lag at #20, structural fix still pending.

**Tier 7 in retrospect:** 4 work commits this session (drift-fix `436887a` + scaffold `ee970e8` + 7.1 `b1dd5d6` + 7.2 `0d27925`) plus the phase-close commit. Tier 7 itself was pure composition: `factory findings mark` wraps the existing `updateFindingStatus` API with `runFindingsShow`-style disambiguation. Total Tier 7 code: ~80 lines of handler + 90 lines of Commander wiring + 130 lines of test fixtures. All 4 `pnpm` gates green throughout. Workspace count grew 1144 → 1152 from 7.2's 8 mark tests. No new ADRs (composition tier; no structural ambiguity). Drift fix #18 caught up mid-session via `docs(state)`; the phase-close commit reintroduces the lag at #19, structural fix still pending.

**Frontend-design judgement calls** carried from Phase 3 — not load-bearing for any active phase but worth recalling for any future web-side work: smart defaults beat empty states; native HTML beats custom widgets; theme-independent intentional colors for status semantics; error-class differentiation; visible-label vs. hover-title separation; inherit-don't-invent; root-cause CSS over global rewrites; hint-copy-teaches-consequence; in-context-affordance vs nav.

**Tier 6 in retrospect:** 11 work commits (scaffold + 6.1 → 6.last + the phase-close commit). Total session output: ~1100 lines added across the codebase (most in 6 skill rewrites + tier-6 plan + fixer parser code). All 4 `pnpm` gates green throughout. Workspace count grew 1135 → 1144 + 3 skipped from 6.3's parser tests. No new ADRs; the 6.3 attach-point homework found a clean precedent in `parse-findings.ts` (worker-side), no structural ambiguity to pin. Two per-skill verbatim-rule deviations (progress-tracking, scaffolding frontmatter descriptions) — both justified by factual wrongness against ADR 0021. The README done-criterion that said the parser would live in `packages/brain/src/` was contradicted by the homework finding (worker-side); intent satisfied, location revised in 6.3's commit body but README left as historical scaffold.