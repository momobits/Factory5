# Next session kickoff

> Auto-generated from `.control/progress/STATE.md` at 2026-05-16T22:19:57Z by
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

**Phase 12 (budget-ux) active — next is 12.1 (open U032).** Phase 11 closed cleanly with the live browser smoke confirming all three operator-felt failure modes are gone (refresh-restores, multi-tab consistency, terminal post-mortem visibility). Tier 12 was scaffolded in the same scaffold commit as Tier 11 (`c22cb71`); plan + phase dir + ROADMAP rows + U032 in ISSUES are all in place.

**Tier 12 sub-steps** (per `.control/phases/phase-12-budget-ux/steps.md`):
1. **12.1** — Open U032 in `UPGRADE/ISSUES.md` Open section (recordkeeping flip; U032 already added in the scaffold commit).
2. **12.2** — ADR 0033 pins the budget UX paradigm: operator-facing vs internal-pacing budgets; escalation rule; default-publication contract; persistence contract.
3. **12.3** — `BUDGET_DEFAULTS` exported from `@factory5/core` as the single source of truth for six operator-facing budgets (maxUsd, maxSteps, askUserDeadlineMs, maxTurnsScaffolder, maxTurnsBuilder, maxTurnsFixer) + defaults + explainers.
4. **12.4** — Web UI Build form: "Advanced budgets" accordion (collapsed by default) with the six fields + defaults + explainers from the constant.
5. **12.5** — CLI: six new flags on `factory build` AND `factory resume`; `--help` post-text quotes the explainers verbatim.
6. **12.6** — Directive payload gains `budgets` field; Tier 10 resume route inherits the full set.
7. **12.7** — Brain escalation: `pool.ts` catches `error_max_turns` subtype → typed askUser ("Task X ran out of turns at N; bump to M?") → on accept, relaunches the task with the bumped budget; on abort, current failed-task behaviour.
8. **12.8** — Tier 8 auto-answer adapts: bump on first failure, abort on second.
9. **12.9** — Tests across the escalation path + ipc / cli / fe surfaces.
10. **12.10** — `/phase-close` + live browser smoke (budget-tripping task escalates → accept → retry → success).

**Driving operator quote 2026-05-16:** *"why are we failing instead of asking the user if we should continue over the budget? why do we have a max cost and max steps that we ask the user and have other limits the user does not see?"* — captured in U032. The automl scaffolder hitting `error_max_turns` at 40 (then 80 post-Tier-10-bump) was the canonical example.

**Previous arc-closes (for context):** Tiers 1–4 closed at `phase-4-cli-completion-closed` 2026-05-06; Tier 5 at `phase-5-agent-prompts-closed` 2026-05-07; Tier 6 at `phase-6-skills-rewrites-closed` 2026-05-07; Tier 7 at `phase-7-findings-mark-closed` 2026-05-08 at `40a78a8`; Tier 8 at `phase-8-question-auto-answer-closed` 2026-05-08 at `d863ea0`; Tier 9 at `phase-9-control-room-redesign-closed` 2026-05-15 at `9e8ee5c`; Tier 10 at `phase-10-resume-and-activity-feed-closed` 2026-05-16 at `fbc3c27`; Tier 11 at `phase-11-directive-log-persistence-closed` 2026-05-16 at this phase-close commit.

## Notes for next session

**Phase 12 (budget-ux) is the active phase.** Tier 11 (`phase-11-directive-log-persistence-closed`) ships persistent log lines + replay; Tier 12 is the next operator-felt closure (operator-invisible turn budgets; hard-fail without retry-question escalation). Tier 12 was scaffolded in the same commit as Tier 11 (`c22cb71`) — plan, phase dir, ROADMAP, U032 in ISSUES all in place. Pick up at **12.1 — open U032** (recordkeeping flip mirroring 11.1).

**Read first** when next session resumes:

1. `UPGRADE/plans/tier-12-budget-ux.md` — the full Tier 12 plan including the budget audit (15 hardcoded budgets vs 6 operator-facing), ADR 0033 sketch, brain escalation flow, Tier 8 auto-answer adaptation.
2. `.control/phases/phase-12-budget-ux/steps.md` — the per-step checklist.
3. `UPGRADE/ISSUES.md` — U032 description + hypothesis.
4. ADR 0030 (auto-answer contract) — 12.7/12.8 adapt the auto-answer dispatcher.

**Tier 12 driving incident:** the automl scaffolder hit `error_max_turns` at 40 (pre-Tier-10), then again at 80 (post-Tier-10-bump). Each time the worker reported the failure, the task marked failed, and the brain raised a generic `askUser("what next?")` with no bump-suggestion context. The operator could only see "Task failed" with no diagnostic and no recovery path. Tier 11's activity panel persistence (now visible post-mortem) makes the failure visible; Tier 12 makes it ACTIONABLE.

**Tier 11 post-close** — three deferred items moved to Phase 12 Deferred section of phase-11 README and to Tier 12's plan if relevant:
- **Auto-prune retention policy** for `directive_log_lines` (sweep older than N days). Defer-until-signal that the table is growing meaningfully.
- **Search / filter in the activity panel** (free-text grep + level + component filters). UX polish.
- **Persist task / finding / spend events too** (unify replay across all six SSE event types). Would unify the code path.
- **CLI tail** — `factory directive tail <id>` consumes the new logs endpoint. Composition tier.

**Previous arc-closes (for context):** see "Notes for next session" intro above for the full list of tags. The carry-forward items below (U005, `/session-end` lag-by-1, etc.) all stay open into the Tier 12 session — they're not Tier 12 work but operators may opt to bundle one if 12.x finishes early.

**Long-standing carry-forwards** (none load-bearing for Tier 12; bundle opportunistically):

- **U005** — `factory chat` REPL cancel UX path (a+). Five-times-deferred (Phase 2 → 4 → 8 → 9 → 10 → 11). Promote when false-timeout pain surfaces in real use.
- **Per-project `askUserDeadlineMs` override** — CLAUDE.md frontmatter or `<project>/.factory/project.json` `metadata`. Non-breaking atop Tier 8's daemon-wide config.
- **`factory config get / set <key>` CLI** — operator surface for `<dataDir>/config.json`.
- **Override after auto-answer** — `factory questions answer --force <id>`. Pin via ADR if it ships.
- **Inline-style audit on the 12 pages** — Tier 9-deferred.
- **Structural `/session-end` lag-by-1 fix** — now 30 occurrences (phase-close `343f101` was a non-lagging instance because it named itself in STATE.md; this session-end commit reintroduces the lag at #30 — STATE.md correctly points at `343f101` right now, but once this session-end commit lands, HEAD diverges from STATE). Two structural options remain: track "last work commit" rather than HEAD, or amend STATE.md post-commit.

**Frontend-design judgement calls** carried from Phase 3 — not load-bearing for any active phase but worth recalling for any future web-side work: smart defaults beat empty states; native HTML beats custom widgets; theme-independent intentional colors for status semantics; error-class differentiation; visible-label vs. hover-title separation; inherit-don't-invent; root-cause CSS over global rewrites; hint-copy-teaches-consequence; in-context-affordance vs nav. **Tier 9 added** a new vocabulary on top: vermillion (`#ff4d1c`) as the singular signal color; Fraunces italic display + Bricolage Grotesque body + JetBrains Mono data; CSS custom-property tokens (`--bg / --surface / --ink / --hairline / --signal / --amber / --acid / --halt / --cool`) flipped by `prefers-color-scheme`; paper-grain SVG atmosphere via `body::before / body::after`; editorial masthead with brand mark `§` + numbered nav + monospaced status pip + pulse animation.

**Tier 11 in retrospect:** Two-session tier (afternoon scaffold + 11.1-11.2; evening 11.3 → 11.7 close, same calendar day 2026-05-16). Five tier-11 work commits in this session continuation (`81a0c74` 11.3, `49cc4e5` 11.4, `93c1c85` 11.5, `f95da1b` 11.6, this phase-close). +16 tests across packages (11.3 +7 state queries, 11.4 +4 daemon hub, 11.5 +5 daemon route); workspace 1200 → 1216 + 3 skipped. **No new ADR** — persistence design is straightforward (SQLite + tee + replay endpoint); the two interesting decisions (fan-out-after-persist; fixed cursor not advancing) live in commit bodies + code comments. Three plan-deviations all documented: (1) 11.4's hub-tee test went into a dedicated `directive-stream.test.ts` rather than `server.test.ts` (no HTTP surface; matches per-module convention); (2) 11.5 shipped 5 tests instead of the planned 3 (added 404 + empty-list at trivial cost); (3) 11.6 used a fixed join-cursor instead of the plan's advancing variant (advancing drops ms-collision live events sharing a ts with a previously-accepted live event — Tier 8/10 evidence). Live browser smoke (Playwright MCP, smoke-demo, $1.00 cap, real spend $0.6238 — under last smoke's $0.7241) confirmed all three Tier 11 scenarios end-to-end: refresh-survives, multi-tab consistency, terminal directive post-mortem visibility. Notable smoke-harness finding: `browser_tabs new` opens fresh contexts so the UI token captured by `captureTokenFromUrl()` doesn't carry — resolved by passing `?t=<token>` in the new tab's URL explicitly (not a production bug; real users share browser context).

**Tier 10 in retrospect:** Two-session tier (scaffold + 10.1–10.7 same day 2026-05-16). Eight tier-10 commits: scaffold `1ac1823`, 10.1 `0ce4590`, 10.2 `bb2bca9`, 10.3 `585f172`, 10.4 `e83c3c1`, 10.5 `f100910`, 10.6 `9289aff`, phase-close (this commit). +12 tests across packages (planner-emit +4, daemon resume route +8); workspace 1182 → 1194 + 3 skipped. ADR 0031 (log-forwarder design) landed; first ADR in the upgrade arc that pins an *emission convention* (manual emit-site discipline at every brain stage entry/exit/error) vs a structural surface. Two real bugs surfaced in passing: (1) the pre-existing `.cancel-btn` chrome had been rendering as default browser button since Phase 3 — Astro scoped `<style>` rules attach a `[data-astro-cid-xyz]` selector that JS-created elements never match. Fixed by lifting log-tail + button styles to `Dashboard.astro` `<style is:global>`. (2) `brain.serve`'s uncaught-throw catch path flipped the directive to `failed` in the DB but never emitted `directive.completed` on SSE — added belt-and-suspenders emit so the UI sees the terminal flip immediately. Live browser smoke (Playwright MCP) clicked Resume on the original `01KRQ1RPE5SM6Q8AYSRHHAPG39`, child `01KRR9RGFN10YMDX5C16TXK91Y` minted, activity panel narrated 5 events live (triage → architect-calling → wrote 13 wiki pages → readiness passed → planner-calling). Interesting observation: the architect on the resume produced 13 pages with a proper `modules/` directory split — wiki-readiness `modules-documented` check passed cleanly, the original automl warn was Opus non-determinism. The carry-forward `checkModules` h1 acceptance refinement stays a valid Tier 11 candidate but is advisory-only. Cancelled the planner mid-Sonnet to keep smoke budget bounded — total smoke spend $0.7241 (architect Opus). One UX gap surfaced post-cancel and noted as Tier 11 candidate: activity panel is empty after page reload on a terminal directive because `log.line` events are SSE-only (ephemeral).

**Tier 9 in retrospect:** Four commits this session — bundled redesign + recordkeeping `397637c`, gitignore tweak `307d79c`, phase-close `9e8ee5c`, next.md regen `faeb209`. First aesthetic-only tier in the upgrade arc; no tests added (visual change only), no new APIs, no new packages, workspace count unchanged at 1182 + 3 skipped. The "informal cadence" (no per-step commits, no ADR, post-hoc recordkeeping) worked because the redesign was a single-author single-session concept transfer from a sibling project — per-step commits would have added friction without information. Live browser smoke completed via Playwright MCP in-session, satisfying the operator-side gate that the README originally said couldn't be assistant-driven. Two false positives investigated and dismissed during smoke (Playwright cursor hover-retention on the nav active-state, Chrome `currentColor` cache from pre-injection paint on dark-mode body copy); neither is a production bug. Absorbed Phase 8's "PageShell + Dashboard `<style is:global>` migration" de facto — global stylesheet now carries the look pages have always referenced via shared classes.

**Tier 8 in retrospect:** 8 work commits this session (scaffold + 8.1 → 8.7) plus this phase-close commit. Tier 8 was a real structural addition: schema migration + new ADR + new config home + brain-side LLM dispatcher with race mitigation + web surface. Total Tier 8 code: ~1900 lines added across the codebase (heaviest in 8.6's dispatcher + tests + 8.3's ADR + 8.2's migration). All 4 `pnpm` gates green throughout. Workspace count grew 1152 → 1182 + 3 skipped (+30 across migration, config, deadline-stamp, and dispatcher tests). New ADR (0030) — Tier 8 had real structural decisions to pin (provenance shape, config home, race mitigation, no-override). Two intentional plan deviations both noted in commit bodies + LOG: (1) `loadConfig` I/O placed in `@factory5/state` not `@factory5/core` to keep core fs-free; (2) prompt context pruned to question + options + directive + past Q&A for first ship per ADR 0030's "alternatives considered" — re-add when quality data shows the generic prompt underperforms. Drift fix #19 was carried into the scaffold commit (STATE.md inside scaffold referenced `cf9d4f9` while HEAD moved to `8453086`); the phase-close commit reintroduces the lag at #20, structural fix still pending.

**Tier 7 in retrospect:** 4 work commits this session (drift-fix `436887a` + scaffold `ee970e8` + 7.1 `b1dd5d6` + 7.2 `0d27925`) plus the phase-close commit. Tier 7 itself was pure composition: `factory findings mark` wraps the existing `updateFindingStatus` API with `runFindingsShow`-style disambiguation. Total Tier 7 code: ~80 lines of handler + 90 lines of Commander wiring + 130 lines of test fixtures. All 4 `pnpm` gates green throughout. Workspace count grew 1144 → 1152 from 7.2's 8 mark tests. No new ADRs (composition tier; no structural ambiguity). Drift fix #18 caught up mid-session via `docs(state)`; the phase-close commit reintroduces the lag at #19, structural fix still pending.

**Frontend-design judgement calls** carried from Phase 3 — not load-bearing for any active phase but worth recalling for any future web-side work: smart defaults beat empty states; native HTML beats custom widgets; theme-independent intentional colors for status semantics; error-class differentiation; visible-label vs. hover-title separation; inherit-don't-invent; root-cause CSS over global rewrites; hint-copy-teaches-consequence; in-context-affordance vs nav.

**Tier 6 in retrospect:** 11 work commits (scaffold + 6.1 → 6.last + the phase-close commit). Total session output: ~1100 lines added across the codebase (most in 6 skill rewrites + tier-6 plan + fixer parser code). All 4 `pnpm` gates green throughout. Workspace count grew 1135 → 1144 + 3 skipped from 6.3's parser tests. No new ADRs; the 6.3 attach-point homework found a clean precedent in `parse-findings.ts` (worker-side), no structural ambiguity to pin. Two per-skill verbatim-rule deviations (progress-tracking, scaffolding frontmatter descriptions) — both justified by factual wrongness against ADR 0021. The README done-criterion that said the parser would live in `packages/brain/src/` was contradicted by the homework finding (worker-side); intent satisfied, location revised in 6.3's commit body but README left as historical scaffold.
