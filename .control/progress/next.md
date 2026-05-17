# Next session kickoff

> Auto-generated from `.control/progress/STATE.md` at 2026-05-17T09:58:23Z by
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

**Step 13.5 — per-project budget defaults extension.** Today `<project>/.factory/project.json` `metadata.budgetDefaults` (added in Tier 8) carries `{ maxUsd, maxSteps }` only. Phase 13.5 widens it to cover all six Phase 12 axes: `askUserDeadlineMs`, `maxTurnsScaffolder`, `maxTurnsBuilder`, `maxTurnsFixer` (and `maxUsdPerTask` once 13.6 lands as the seventh). Implementation surface:

- `@factory5/core` project metadata schema: swap the existing `budgetDefaults: z.object({ maxUsd, maxSteps }).optional()` for `budgetDefaults: budgetsSchema.optional()` (reuse the 12.3 Zod schema in `@factory5/core/budgets`).
- Daemon `apiV1CreateBuildRequestSchema` body-resolution (ADR 0027 §4's three-tier: instance config → project metadata → body flags) extends to merge the new keys per-axis using the existing tiered merge helper.
- CLI `factory build` already reads project metadata; no CLI surface change beyond schema acceptance.
- Tests: three-tier resolution chain for each new axis; project metadata + body unset; project metadata + body override.

Estimated ~1 hour. Realistic shape: 5-8 unit tests + schema edit + daemon-resolution-path test.

Then **13.6 — per-task USD cap (`maxUsdPerTask`)**: new seventh axis in `BUDGET_DEFAULTS`; planner-side `estimatedUsd` per task (schema bump); pool pre-launch check; typed `[BUDGET]` askUser on over-cap reusing Phase 12's escalation pattern; auto-answer `[BUDGET]` recognition refactors from `maxTurns*`-coupled to axis-agnostic. Larger scope; ~2-3 hours.

Then **13.7 — phase close** with live browser smoke (Playwright MCP, `smoke-demo` project, $1.50 spend cap). Smoke shape: operator sets `maxTurnsScaffolder=10` in Web UI Advanced budgets → expect scaffolder trips at 10 → `[BUDGET]` askUser fires → accept → retry with bumped cap → success. Also exercises U034's fix on the daemon-stop teardown.

**Daemon state at handoff:** stopped (operator ran `factory daemon stop` at the prior session-end). Restart with `factory daemon start` when 13.5/13.6 unit tests need a live daemon (none do — pure schema + helper work). 13.7's smoke needs a fresh start. **Note:** 13.4's U034 fix is in dist — next `factory daemon stop` will leave a clean pidfile.

**Previous arc-closes (for context):** Tiers 1–4 closed at `phase-4-cli-completion-closed` 2026-05-06; Tier 5 at `phase-5-agent-prompts-closed` 2026-05-07; Tier 6 at `phase-6-skills-rewrites-closed` 2026-05-07; Tier 7 at `phase-7-findings-mark-closed` 2026-05-08 at `40a78a8`; Tier 8 at `phase-8-question-auto-answer-closed` 2026-05-08 at `d863ea0`; Tier 9 at `phase-9-control-room-redesign-closed` 2026-05-15 at `9e8ee5c`; Tier 10 at `phase-10-resume-and-activity-feed-closed` 2026-05-16 at `fbc3c27`; Tier 11 at `phase-11-directive-log-persistence-closed` 2026-05-16 at `343f101`; Tier 12 at `phase-12-budget-ux-closed` 2026-05-17 at `8231f87`.

## Notes for next session

**Phase 13 mid-flight; U033 + U034 both closed this session.** Resume at step **13.5 — per-project budget defaults extension**. Today `<project>/.factory/project.json` `metadata.budgetDefaults` carries `{ maxUsd, maxSteps }` only (added in Tier 8); 13.5 widens to all six Phase 12 axes by swapping the existing Zod object for `budgetsSchema.optional()` (reuse the 12.3 schema in `@factory5/core/budgets`). Three-tier resolution chain (instance config → project metadata → body flags) preserved. No new ADR expected — schema extension only.

**Read first** when next session resumes:

1. `.control/phases/phase-13-budget-followups/steps.md` — 13.5 description + remaining sub-steps (13.5 / 13.6 / 13.7).
2. `UPGRADE/plans/tier-13-budget-followups.md` § "13.5 — Per-project budget defaults extension" + § "13.6 — Per-task USD cap" for the planned implementation shape.
3. `packages/core/src/` schema files (where the existing `budgetDefaults` Zod definition lives — quick grep for `budgetDefaults` finds it).
4. `packages/daemon/src/server.ts` body-resolution path (ADR 0027 §4's three-tier merge) — 13.5 extends per-axis using the existing helper.
5. The 13.3 ADR amendment in `docs/decisions/0032-budget-ux-paradigm.md` — context for the operator-as-ceiling semantic that 13.5's extension feeds into.

**13.5 shape (recommended):**

- Schema edit in `@factory5/core`: `budgetDefaults: budgetsSchema.optional()` (reuse 12.3's Zod definition).
- Daemon `apiV1CreateBuildRequestSchema` body-resolution: merge new keys per-axis using the existing tiered merge helper.
- Tests: project metadata + body unset → metadata wins; project metadata + body override → body wins; project metadata + planner emit > ceiling → planner clamped to project ceiling (cross-tier interaction with 13.3's fix).
- Estimated ~1 hour. 5-8 unit tests.

**Then 13.6 (per-task USD cap):**

- New seventh axis in `BUDGET_DEFAULTS` (`@factory5/core/budgets`).
- Planner schema bump: `planTaskSchema` gains optional `estimatedUsd: z.number().optional()`. Planner prompt extends to instruct estimation when `directive.payload.budgets.maxUsdPerTask > 0`.
- Pool pre-launch check in `packages/brain/src/pool.ts`: if `task.estimatedUsd > operatorCap`, raise typed `[BUDGET]` askUser reusing the Phase 12 escalation path.
- Auto-answer recognition (`packages/brain/src/auto-answer.ts`): refactor `[BUDGET]` matcher from `maxTurns*`-coupled to axis-agnostic (the marker payload already carries `axis`).
- CLI `--max-usd-per-task <n>` on `factory build` + `factory resume`; seventh Web accordion field.
- Estimated ~2-3 hours. 5+ new brain tests covering planner-estimate path + escalation + bump.

**Then 13.7 (phase close + live browser smoke):**

- Start factoryd (current dist, post-13.4 U034 fix); capture UI token; navigate to `/app/build`.
- Pick `smoke-demo` (or any project that exercises a tool-using agent).
- Open "Advanced budgets"; set `Max turns — scaffolder = 10`.
- Submit; expect brain to narrate triage → architect → planner → pool task start. Operator's 10 should now CEILING the planner's emit (per 13.3), so the scaffolder trips immediately → `[BUDGET]` askUser fires → questions surface.
- Operator answers `accept`; brain retries with bumped cap; task succeeds.
- Stop factoryd; **verify pidfile is gone** (U034 fix verification) — `Get-ChildItem $env:LOCALAPPDATA\factory5\factoryd.pid` should return nothing.
- Spend cap $1.50.

**Daemon state at handoff:** stopped (operator ran `factory daemon stop` at the prior session-end). **U034 fix is in dist now** — the next `factory daemon stop` will leave a clean pidfile. 13.5/13.6 don't need a live daemon (pure schema + helper work); 13.7's smoke does.

**Phase 13 done-criteria status (4 of 9 green):**

- [x] All four `pnpm` gates green (current as of `31afcb9`)
- [x] ADR 0032 amendment (`46198b4`)
- [x] `resolveTaskMaxTurns` returns `min(planner_emit, operator_ceiling)`; docstring updated; 5+ new tests (`46198b4`)
- [x] `factory daemon stop` on Windows leaves no stale pidfile; cross-platform unit test (`31afcb9`)
- [ ] `<project>/.factory/project.json` `metadata.budgetDefaults` accepts all axes — 13.5
- [ ] `BUDGET_DEFAULTS` gains `maxUsdPerTask`; pool pre-launch check; CLI flag + Web accordion — 13.6
- [ ] Auto-answer's `[BUDGET]` recognition generalises across axes — 13.6
- [ ] Browser smoke: operator sets `maxTurnsScaffolder=10` in UI → `[BUDGET]` askUser fires → accept → retry → success — 13.7
- [x] U033 closes — `46198b4`
- [x] U034 closes — `31afcb9`

**Future tiers — Phase 12 Deferred section carry-forwards:**

- **Per-task USD cap** — `maxUsdPerTask` axis; same escalation pattern. Defer-until-incident.
- **Mid-task escalation** — proactive warning before the worker actually trips. Bigger surface; defer until the post-failure escalation proves out in real use.
- **Per-project default overrides for the new budget axes** — extend `<project>/.factory/project.json` `metadata.budgetDefaults` to cover maxTurns + askUserDeadlineMs. Small; bundle with a future build-form-related tier.
- **Budget audit dashboard** — multi-build telemetry view of "you've burned $X across the last N directives; here's where it went."

**Previous arc-closes (for context):** Tier 12 at `phase-12-budget-ux-closed` 2026-05-17 closes the eighth upgrade arc. The carry-forward items below (U005, `/session-end` lag-by-1, etc.) all stay open — they're not load-bearing for any active phase but operators may opt to bundle one if a future tier surfaces.

**Long-standing carry-forwards** (none load-bearing for Tier 12; bundle opportunistically):

- **U005** — `factory chat` REPL cancel UX path (a+). Five-times-deferred (Phase 2 → 4 → 8 → 9 → 10 → 11). Promote when false-timeout pain surfaces in real use.
- **Per-project `askUserDeadlineMs` override** — CLAUDE.md frontmatter or `<project>/.factory/project.json` `metadata`. Non-breaking atop Tier 8's daemon-wide config.
- **`factory config get / set <key>` CLI** — operator surface for `<dataDir>/config.json`.
- **Override after auto-answer** — `factory questions answer --force <id>`. Pin via ADR if it ships.
- **Inline-style audit on the 12 pages** — Tier 9-deferred.
- **Structural `/session-end` lag-by-1 fix** — now 31 occurrences (session-end `68dbd6b` was #30; this drift-fix at session start catches up STATE to `68dbd6b` and itself becomes #31 since the drift-fix can't name its own SHA pre-commit). Two structural options remain: track "last work commit" rather than HEAD, or amend STATE.md post-commit.

**Frontend-design judgement calls** carried from Phase 3 — not load-bearing for any active phase but worth recalling for any future web-side work: smart defaults beat empty states; native HTML beats custom widgets; theme-independent intentional colors for status semantics; error-class differentiation; visible-label vs. hover-title separation; inherit-don't-invent; root-cause CSS over global rewrites; hint-copy-teaches-consequence; in-context-affordance vs nav. **Tier 9 added** a new vocabulary on top: vermillion (`#ff4d1c`) as the singular signal color; Fraunces italic display + Bricolage Grotesque body + JetBrains Mono data; CSS custom-property tokens (`--bg / --surface / --ink / --hairline / --signal / --amber / --acid / --halt / --cool`) flipped by `prefers-color-scheme`; paper-grain SVG atmosphere via `body::before / body::after`; editorial masthead with brand mark `§` + numbered nav + monospaced status pip + pulse animation.

**Tier 11 in retrospect:** Two-session tier (afternoon scaffold + 11.1-11.2; evening 11.3 → 11.7 close, same calendar day 2026-05-16). Five tier-11 work commits in this session continuation (`81a0c74` 11.3, `49cc4e5` 11.4, `93c1c85` 11.5, `f95da1b` 11.6, this phase-close). +16 tests across packages (11.3 +7 state queries, 11.4 +4 daemon hub, 11.5 +5 daemon route); workspace 1200 → 1216 + 3 skipped. **No new ADR** — persistence design is straightforward (SQLite + tee + replay endpoint); the two interesting decisions (fan-out-after-persist; fixed cursor not advancing) live in commit bodies + code comments. Three plan-deviations all documented: (1) 11.4's hub-tee test went into a dedicated `directive-stream.test.ts` rather than `server.test.ts` (no HTTP surface; matches per-module convention); (2) 11.5 shipped 5 tests instead of the planned 3 (added 404 + empty-list at trivial cost); (3) 11.6 used a fixed join-cursor instead of the plan's advancing variant (advancing drops ms-collision live events sharing a ts with a previously-accepted live event — Tier 8/10 evidence). Live browser smoke (Playwright MCP, smoke-demo, $1.00 cap, real spend $0.6238 — under last smoke's $0.7241) confirmed all three Tier 11 scenarios end-to-end: refresh-survives, multi-tab consistency, terminal directive post-mortem visibility. Notable smoke-harness finding: `browser_tabs new` opens fresh contexts so the UI token captured by `captureTokenFromUrl()` doesn't carry — resolved by passing `?t=<token>` in the new tab's URL explicitly (not a production bug; real users share browser context).

**Tier 10 in retrospect:** Two-session tier (scaffold + 10.1–10.7 same day 2026-05-16). Eight tier-10 commits: scaffold `1ac1823`, 10.1 `0ce4590`, 10.2 `bb2bca9`, 10.3 `585f172`, 10.4 `e83c3c1`, 10.5 `f100910`, 10.6 `9289aff`, phase-close (this commit). +12 tests across packages (planner-emit +4, daemon resume route +8); workspace 1182 → 1194 + 3 skipped. ADR 0031 (log-forwarder design) landed; first ADR in the upgrade arc that pins an *emission convention* (manual emit-site discipline at every brain stage entry/exit/error) vs a structural surface. Two real bugs surfaced in passing: (1) the pre-existing `.cancel-btn` chrome had been rendering as default browser button since Phase 3 — Astro scoped `<style>` rules attach a `[data-astro-cid-xyz]` selector that JS-created elements never match. Fixed by lifting log-tail + button styles to `Dashboard.astro` `<style is:global>`. (2) `brain.serve`'s uncaught-throw catch path flipped the directive to `failed` in the DB but never emitted `directive.completed` on SSE — added belt-and-suspenders emit so the UI sees the terminal flip immediately. Live browser smoke (Playwright MCP) clicked Resume on the original `01KRQ1RPE5SM6Q8AYSRHHAPG39`, child `01KRR9RGFN10YMDX5C16TXK91Y` minted, activity panel narrated 5 events live (triage → architect-calling → wrote 13 wiki pages → readiness passed → planner-calling). Interesting observation: the architect on the resume produced 13 pages with a proper `modules/` directory split — wiki-readiness `modules-documented` check passed cleanly, the original automl warn was Opus non-determinism. The carry-forward `checkModules` h1 acceptance refinement stays a valid Tier 11 candidate but is advisory-only. Cancelled the planner mid-Sonnet to keep smoke budget bounded — total smoke spend $0.7241 (architect Opus). One UX gap surfaced post-cancel and noted as Tier 11 candidate: activity panel is empty after page reload on a terminal directive because `log.line` events are SSE-only (ephemeral).

**Tier 9 in retrospect:** Four commits this session — bundled redesign + recordkeeping `397637c`, gitignore tweak `307d79c`, phase-close `9e8ee5c`, next.md regen `faeb209`. First aesthetic-only tier in the upgrade arc; no tests added (visual change only), no new APIs, no new packages, workspace count unchanged at 1182 + 3 skipped. The "informal cadence" (no per-step commits, no ADR, post-hoc recordkeeping) worked because the redesign was a single-author single-session concept transfer from a sibling project — per-step commits would have added friction without information. Live browser smoke completed via Playwright MCP in-session, satisfying the operator-side gate that the README originally said couldn't be assistant-driven. Two false positives investigated and dismissed during smoke (Playwright cursor hover-retention on the nav active-state, Chrome `currentColor` cache from pre-injection paint on dark-mode body copy); neither is a production bug. Absorbed Phase 8's "PageShell + Dashboard `<style is:global>` migration" de facto — global stylesheet now carries the look pages have always referenced via shared classes.

**Tier 8 in retrospect:** 8 work commits this session (scaffold + 8.1 → 8.7) plus this phase-close commit. Tier 8 was a real structural addition: schema migration + new ADR + new config home + brain-side LLM dispatcher with race mitigation + web surface. Total Tier 8 code: ~1900 lines added across the codebase (heaviest in 8.6's dispatcher + tests + 8.3's ADR + 8.2's migration). All 4 `pnpm` gates green throughout. Workspace count grew 1152 → 1182 + 3 skipped (+30 across migration, config, deadline-stamp, and dispatcher tests). New ADR (0030) — Tier 8 had real structural decisions to pin (provenance shape, config home, race mitigation, no-override). Two intentional plan deviations both noted in commit bodies + LOG: (1) `loadConfig` I/O placed in `@factory5/state` not `@factory5/core` to keep core fs-free; (2) prompt context pruned to question + options + directive + past Q&A for first ship per ADR 0030's "alternatives considered" — re-add when quality data shows the generic prompt underperforms. Drift fix #19 was carried into the scaffold commit (STATE.md inside scaffold referenced `cf9d4f9` while HEAD moved to `8453086`); the phase-close commit reintroduces the lag at #20, structural fix still pending.

**Tier 7 in retrospect:** 4 work commits this session (drift-fix `436887a` + scaffold `ee970e8` + 7.1 `b1dd5d6` + 7.2 `0d27925`) plus the phase-close commit. Tier 7 itself was pure composition: `factory findings mark` wraps the existing `updateFindingStatus` API with `runFindingsShow`-style disambiguation. Total Tier 7 code: ~80 lines of handler + 90 lines of Commander wiring + 130 lines of test fixtures. All 4 `pnpm` gates green throughout. Workspace count grew 1144 → 1152 from 7.2's 8 mark tests. No new ADRs (composition tier; no structural ambiguity). Drift fix #18 caught up mid-session via `docs(state)`; the phase-close commit reintroduces the lag at #19, structural fix still pending.

**Frontend-design judgement calls** carried from Phase 3 — not load-bearing for any active phase but worth recalling for any future web-side work: smart defaults beat empty states; native HTML beats custom widgets; theme-independent intentional colors for status semantics; error-class differentiation; visible-label vs. hover-title separation; inherit-don't-invent; root-cause CSS over global rewrites; hint-copy-teaches-consequence; in-context-affordance vs nav.

**Tier 6 in retrospect:** 11 work commits (scaffold + 6.1 → 6.last + the phase-close commit). Total session output: ~1100 lines added across the codebase (most in 6 skill rewrites + tier-6 plan + fixer parser code). All 4 `pnpm` gates green throughout. Workspace count grew 1135 → 1144 + 3 skipped from 6.3's parser tests. No new ADRs; the 6.3 attach-point homework found a clean precedent in `parse-findings.ts` (worker-side), no structural ambiguity to pin. Two per-skill verbatim-rule deviations (progress-tracking, scaffolding frontmatter descriptions) — both justified by factual wrongness against ADR 0021. The README done-criterion that said the parser would live in `packages/brain/src/` was contradicted by the homework finding (worker-side); intent satisfied, location revised in 6.3's commit body but README left as historical scaffold.
