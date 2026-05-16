# Next session kickoff

> Auto-generated from `.control/progress/STATE.md` at 2026-05-16T16:40:36Z by
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

**Phase 11 (directive-log-persistence) starting at step 11.1.** Tier 10 closed cleanly; the post-close smoke surfaced three operator-felt gaps that Tier 11 + Tier 12 close in sequence.

**Pre-tier follow-up shipped first** — commit `fa2f800` (`fix(phase-10): surface task errors + clarify pip + bump turn defaults`):
- `task.result.error` rendered in the task table for failed tasks (red-tinted follow-up row).
- Pip label "Completed" → "Stream ended" so it doesn't compete with the title's directive status.
- `maxTurns` default bumped 40 → 80 (`packages/providers/src/claude-cli.ts:597`); planner range advertised 10-80 → 10-160 (`prompts/agents/planner.md` + `packages/brain/src/planner.ts:247`).

**Tier 11 (this work)** — Per-directive log persistence:
1. Migration 010 (`directive_log_lines` table)
2. Daemon `DirectiveStreamHub.emit` tees `log.line` events to DB before fanning out
3. New `GET /api/v1/directives/:id/logs?since=<iso>&limit=<n>`
4. FE replays historic on connect; dedups against live SSE via join-cursor
5. Closes U031 (activity panel empty after refresh; multi-tab event split)

**Tier 12 (next, scaffolded only)** — Budget UX:
1. ADR 0033 pins the budget paradigm (operator-facing vs internal; escalation; default-publication; persistence)
2. `BUDGET_DEFAULTS` in `@factory5/core` as single source of truth (six fields + defaults + explainers)
3. Web Build form "Advanced budgets" accordion + CLI flags
4. Brain escalation on `error_max_turns` via typed askUser ("Task X out of turns at 80; bump to 120?")
5. Tier 8 auto-answer adapts (bump on first failure, abort on second)
6. Closes U032

**Mystery from operator session 2026-05-16** — *"my max-steps=100 didn't persist after resume"* — investigated 2026-05-16 by querying the DB directly. The directive's `max_steps` correctly persisted at 1000 across both resumes. The "40" the operator saw was the scaffolder task's `maxTurns` (per-task tool-conversation cap), NOT `max_steps`. Two completely different knobs with overlapping-sounding names — exactly the surface area Tier 12 addresses.

1. **Author a Tier 11 plan** — the Phase 10 Deferred section identified five candidates worth promoting if/when demand signal surfaces: pino transport tap (auto-mirror brain pino lines via `directiveId` binding); per-directive log persistence (today `log.line` events are SSE-only — operator reopening a terminal directive sees empty activity panel); resume-after-edit (override autonomy/budget on resume); bulk resume (pick N failed directives, resume all); `checkModules` h1 acceptance (`packages/wiki/src/readiness.ts:74` accepts only h2 or `modules/` dir today; the original automl crash's modules-documented warn was a false-negative since the architect wrote `# Modules` h1).
2. **Promote a longer-standing carry-forward** — U005 chat REPL cancel UX path (a+) is now four-times-deferred. Other Phase 8-introduced carry-forwards (per-project deadline override, `factory config get/set`, override-after-auto-answer) and Tier-9-deferred items (inline-style audit, ADR 0031 for editorial aesthetic — already landed in Tier 10 as log-forwarder ADR instead) remain.
3. **Park** — surfaces are stable; nothing is gated on more work.

**Previous arc-closes (for context):** Tiers 1–4 closed at `phase-4-cli-completion-closed` 2026-05-06; the audit-driven Tier 5 closed at `phase-5-agent-prompts-closed` 2026-05-07; Tier 6 closed at `phase-6-skills-rewrites-closed` 2026-05-07; Tier 7 closed at `phase-7-findings-mark-closed` 2026-05-08 at `40a78a8`; Tier 8 closed at `phase-8-question-auto-answer-closed` 2026-05-08 at `d863ea0`; Tier 9 closed at `phase-9-control-room-redesign-closed` 2026-05-15 at `9e8ee5c`; Tier 10 reopened 2026-05-16 at `1ac1823` (scaffold) and closed at `phase-10-resume-and-activity-feed-closed` 2026-05-16 at this phase-close commit.

To kick off Phase 11:

1. Operator drafts `UPGRADE/plans/tier-11-<name>.md` with goal, sub-steps, acceptance.
2. Add a Phase 11 row to `.control/architecture/phase-plan.md`.
3. Add a Tier 11 section to `UPGRADE/ROADMAP.md`.
4. Scaffold `.control/phases/phase-11-<name>/{README.md,steps.md}` from `.control/templates/`.
5. Then start working through the sub-steps.

If the operator doesn't want a Tier 11, the project is in a clean post-arc parking state.


## Notes for next session

**No active phase.** The upgrade arc closed at `phase-10-resume-and-activity-feed-closed` 2026-05-16. To resume work, the operator can either:

1. **Author a Tier 11 plan** — the Tier 10 Deferred section identified five strong candidates: **pino transport tap** (auto-mirror brain pino lines by `directiveId` binding — ADR 0031 explicitly flagged this as the natural follow-up if manual emit-site overhead grows); **per-directive log persistence** (today `log.line` events are SSE-only — operator reopening a terminal directive sees empty activity panel; needs `directive_log_lines` table + `GET /api/v1/directives/:id/logs` replay endpoint; the live smoke this session surfaced the gap on the cancelled directive); **resume-after-edit** (override autonomy/budget on resume); **bulk resume** (pick N failed directives, resume all); **`checkModules` h1 acceptance** (`packages/wiki/src/readiness.ts:74` over-literal — false-negatived the original automl architect output; ~5-line fix; advisory not load-bearing). To start: draft `UPGRADE/plans/tier-11-<name>.md`, add a Phase 11 row to `.control/architecture/phase-plan.md`, add a Tier 11 section to `UPGRADE/ROADMAP.md`, scaffold `.control/phases/phase-11-<name>/{README.md,steps.md}`.

2. **Promote a longer-standing carry-forward** — U005 chat REPL cancel UX path (a+) is now four-times-deferred (Phase 2 → 4 → 8 → 9 → 10). Other still-open Phase 8 carry-forwards (per-project deadline override, `factory config get/set`, override-after-auto-answer) and Tier-9-deferred items (inline-style audit on the 12 pages; structural `/session-end` lag-by-1 fix — now 27 occurrences).

3. **Park** — surfaces are stable; nothing is gated on more work.

**Read first** when next session resumes:

- [`UPGRADE/LOG.md`](../../UPGRADE/LOG.md) — full upgrade-side narrative across all ten closed tiers (Tier 10 entry now at the top).
- [`.control/progress/journal.md`](journal.md) — session-by-session control narrative.
- This file (`STATE.md`).

**Frontend-design judgement calls** carried from Phase 3 — not load-bearing for any active phase but worth recalling for any future web-side work: smart defaults beat empty states; native HTML beats custom widgets; theme-independent intentional colors for status semantics; error-class differentiation; visible-label vs. hover-title separation; inherit-don't-invent; root-cause CSS over global rewrites; hint-copy-teaches-consequence; in-context-affordance vs nav. **Tier 9 added** a new vocabulary on top: vermillion (`#ff4d1c`) as the singular signal color; Fraunces italic display + Bricolage Grotesque body + JetBrains Mono data; CSS custom-property tokens (`--bg / --surface / --ink / --hairline / --signal / --amber / --acid / --halt / --cool`) flipped by `prefers-color-scheme`; paper-grain SVG atmosphere via `body::before / body::after`; editorial masthead with brand mark `§` + numbered nav + monospaced status pip + pulse animation.

**Tier 10 in retrospect:** Two-session tier (scaffold + 10.1–10.7 same day 2026-05-16). Eight tier-10 commits: scaffold `1ac1823`, 10.1 `0ce4590`, 10.2 `bb2bca9`, 10.3 `585f172`, 10.4 `e83c3c1`, 10.5 `f100910`, 10.6 `9289aff`, phase-close (this commit). +12 tests across packages (planner-emit +4, daemon resume route +8); workspace 1182 → 1194 + 3 skipped. ADR 0031 (log-forwarder design) landed; first ADR in the upgrade arc that pins an *emission convention* (manual emit-site discipline at every brain stage entry/exit/error) vs a structural surface. Two real bugs surfaced in passing: (1) the pre-existing `.cancel-btn` chrome had been rendering as default browser button since Phase 3 — Astro scoped `<style>` rules attach a `[data-astro-cid-xyz]` selector that JS-created elements never match. Fixed by lifting log-tail + button styles to `Dashboard.astro` `<style is:global>`. (2) `brain.serve`'s uncaught-throw catch path flipped the directive to `failed` in the DB but never emitted `directive.completed` on SSE — added belt-and-suspenders emit so the UI sees the terminal flip immediately. Live browser smoke (Playwright MCP) clicked Resume on the original `01KRQ1RPE5SM6Q8AYSRHHAPG39`, child `01KRR9RGFN10YMDX5C16TXK91Y` minted, activity panel narrated 5 events live (triage → architect-calling → wrote 13 wiki pages → readiness passed → planner-calling). Interesting observation: the architect on the resume produced 13 pages with a proper `modules/` directory split — wiki-readiness `modules-documented` check passed cleanly, the original automl warn was Opus non-determinism. The carry-forward `checkModules` h1 acceptance refinement stays a valid Tier 11 candidate but is advisory-only. Cancelled the planner mid-Sonnet to keep smoke budget bounded — total smoke spend $0.7241 (architect Opus). One UX gap surfaced post-cancel and noted as Tier 11 candidate: activity panel is empty after page reload on a terminal directive because `log.line` events are SSE-only (ephemeral).

**Tier 9 in retrospect:** Four commits this session — bundled redesign + recordkeeping `397637c`, gitignore tweak `307d79c`, phase-close `9e8ee5c`, next.md regen `faeb209`. First aesthetic-only tier in the upgrade arc; no tests added (visual change only), no new APIs, no new packages, workspace count unchanged at 1182 + 3 skipped. The "informal cadence" (no per-step commits, no ADR, post-hoc recordkeeping) worked because the redesign was a single-author single-session concept transfer from a sibling project — per-step commits would have added friction without information. Live browser smoke completed via Playwright MCP in-session, satisfying the operator-side gate that the README originally said couldn't be assistant-driven. Two false positives investigated and dismissed during smoke (Playwright cursor hover-retention on the nav active-state, Chrome `currentColor` cache from pre-injection paint on dark-mode body copy); neither is a production bug. Absorbed Phase 8's "PageShell + Dashboard `<style is:global>` migration" de facto — global stylesheet now carries the look pages have always referenced via shared classes.

**Tier 8 in retrospect:** 8 work commits this session (scaffold + 8.1 → 8.7) plus this phase-close commit. Tier 8 was a real structural addition: schema migration + new ADR + new config home + brain-side LLM dispatcher with race mitigation + web surface. Total Tier 8 code: ~1900 lines added across the codebase (heaviest in 8.6's dispatcher + tests + 8.3's ADR + 8.2's migration). All 4 `pnpm` gates green throughout. Workspace count grew 1152 → 1182 + 3 skipped (+30 across migration, config, deadline-stamp, and dispatcher tests). New ADR (0030) — Tier 8 had real structural decisions to pin (provenance shape, config home, race mitigation, no-override). Two intentional plan deviations both noted in commit bodies + LOG: (1) `loadConfig` I/O placed in `@factory5/state` not `@factory5/core` to keep core fs-free; (2) prompt context pruned to question + options + directive + past Q&A for first ship per ADR 0030's "alternatives considered" — re-add when quality data shows the generic prompt underperforms. Drift fix #19 was carried into the scaffold commit (STATE.md inside scaffold referenced `cf9d4f9` while HEAD moved to `8453086`); the phase-close commit reintroduces the lag at #20, structural fix still pending.

**Tier 7 in retrospect:** 4 work commits this session (drift-fix `436887a` + scaffold `ee970e8` + 7.1 `b1dd5d6` + 7.2 `0d27925`) plus the phase-close commit. Tier 7 itself was pure composition: `factory findings mark` wraps the existing `updateFindingStatus` API with `runFindingsShow`-style disambiguation. Total Tier 7 code: ~80 lines of handler + 90 lines of Commander wiring + 130 lines of test fixtures. All 4 `pnpm` gates green throughout. Workspace count grew 1144 → 1152 from 7.2's 8 mark tests. No new ADRs (composition tier; no structural ambiguity). Drift fix #18 caught up mid-session via `docs(state)`; the phase-close commit reintroduces the lag at #19, structural fix still pending.

**Frontend-design judgement calls** carried from Phase 3 — not load-bearing for any active phase but worth recalling for any future web-side work: smart defaults beat empty states; native HTML beats custom widgets; theme-independent intentional colors for status semantics; error-class differentiation; visible-label vs. hover-title separation; inherit-don't-invent; root-cause CSS over global rewrites; hint-copy-teaches-consequence; in-context-affordance vs nav.

**Tier 6 in retrospect:** 11 work commits (scaffold + 6.1 → 6.last + the phase-close commit). Total session output: ~1100 lines added across the codebase (most in 6 skill rewrites + tier-6 plan + fixer parser code). All 4 `pnpm` gates green throughout. Workspace count grew 1135 → 1144 + 3 skipped from 6.3's parser tests. No new ADRs; the 6.3 attach-point homework found a clean precedent in `parse-findings.ts` (worker-side), no structural ambiguity to pin. Two per-skill verbatim-rule deviations (progress-tracking, scaffolding frontmatter descriptions) — both justified by factual wrongness against ADR 0021. The README done-criterion that said the parser would live in `packages/brain/src/` was contradicted by the homework finding (worker-side); intent satisfied, location revised in 6.3's commit body but README left as historical scaffold.