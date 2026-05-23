# Next session kickoff

> Auto-generated from `.control/progress/STATE.md` at 2026-05-23T16:56:28Z by
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

**Arc-complete (tenth time — no Phase 15 planned).** Phase 14 closed and tagged. Operator decides next move:

1. **`/session-end`** to close out today (default — Tier 14 was a substantial 25-commit tier with a clean arc close).
2. **Author a new tier** if a fresh operator-felt issue surfaces. Carry-forwards available from spec §9 (Out of scope for Tier 14): generic critic loops for other stages (planner critic, build critic); diff-style architect output on retry; per-directive model category overrides; critic prompt context expansion (task_log, findings, prior similar projects); `maxWikiJudgeUsd` dollar cap; mid-task budget escalation; budget audit dashboard. Plus standing carry-forwards: U005 chat REPL UX (5x deferred), `/session-end` lag-by-1 structural fix (~#42 now), per-project `askUserDeadlineMs` override, `factory config get/set` CLI, etc.
3. **Run a follow-up live smoke** exercising the retry/exhaustion paths (today's smoke had the critic pass first try; an `--max-wiki-readiness-attempts 1` build against a deliberately bad spec would force the askUser exhaustion path live).

**Previous arc-closes (for context):** Tiers 1–4 closed at `phase-4-cli-completion-closed` 2026-05-06; Tier 5 at `phase-5-agent-prompts-closed` 2026-05-07; Tier 6 at `phase-6-skills-rewrites-closed` 2026-05-07; Tier 7 at `phase-7-findings-mark-closed` 2026-05-08 at `40a78a8`; Tier 8 at `phase-8-question-auto-answer-closed` 2026-05-08 at `d863ea0`; Tier 9 at `phase-9-control-room-redesign-closed` 2026-05-15 at `9e8ee5c`; Tier 10 at `phase-10-resume-and-activity-feed-closed` 2026-05-16 at `fbc3c27`; Tier 11 at `phase-11-directive-log-persistence-closed` 2026-05-16 at `343f101`; Tier 12 at `phase-12-budget-ux-closed` 2026-05-17 at `8231f87`; Tier 13 at `phase-13-budget-followups-closed` 2026-05-17 at `aae86dc`; Tier 14 at `phase-14-wiki-readiness-judge-closed` 2026-05-23 at `431c7da`.

## Notes for next session

**Phase 13 (budget-followups) closed; upgrade arc complete (ninth time).** Phase 12 → Phase 13 sequence closed the operator-felt budget loop end-to-end: Phase 12 built the structural pieces (BUDGET_DEFAULTS, ADR 0032, escalation plumbing); Phase 12's deferred smoke surfaced the propagation gap (U033); Phase 13 fixed the propagation (13.3) + the Windows daemon-stop pidfile sloppy-shutdown (13.4) + extended per-project defaults to all axes (13.5) + shipped the per-task USD cap (13.6) + closed with a live browser smoke + U034-fix verification (13.7).

**This was the second consecutive no-op `/session-end`** opened at arc-complete after the prior no-op. Operator accepted the canonical `/session-end` path again over a separate drift-fix commit — same rationale as the prior no-op (the cosmetic structural lag bounces by one either way). Lag count now #40. Three consecutive no-op session-ends now in the log; if a fourth no-op comes, consider whether the structural fix is worth bundling as a Tier 14 micro-tier or whether opening a bigger tier on a fresh issue is the better path.

**Live browser smoke at phase-close** (Playwright MCP, smoke-demo, $1.09 spend / $1.50 cap, status=complete). Verified:

- Phase 13.5 propagation end-to-end via API: directive `01KRTWEPJ7KRJR20ABDTGAD87W` carries `payload.budgets.maxTurnsScaffolder=10` exactly as submitted from the UI form.
- Phase 13.6 UI: seventh-axis "Max USD — per task" accordion field renders with 0-default chip + Phase-13.6 explainer; accordion summary text reads "seven axes · all optional · ADR 0032".
- U034 fix exercised live: post-stop daemon log line `daemon.pidfile path=...factoryd.pid pid=46452 msg="reaped stale pidfile after stop"` confirmed cleanup ran; pidfile absent on disk at `.factory/factoryd.pid` and `$LOCALAPPDATA\factory5\factoryd.pid` post-stop.
- End-to-end build completes with operator-set budget present (no regression introduced).

**Live `[BUDGET]` askUser firing NOT demonstrated** because smoke-demo's scaffolder completed within the 10-turn cap (no trip). The trip path itself is unit-test-covered (44 brain tests across Phase 12.6 + 13.3 + 13.6 escalation paths). A future smoke harness should include a multi-module project (or a `maxTurnsScaffolder=1` override paired with a scaffolder that must do at least one tool call) to force the trip path live.

**Recommended next options for the next session:**

1. **`/session-end`** — close out today; banks Phase 13 as a clean arc close.
2. **Author a new tier** if a fresh operator-felt issue surfaces. Available carry-forwards: mid-task escalation, budget audit dashboard, daemon `POST /shutdown` IPC route (U034 candidate 2), planner-honors-budgets belt-and-suspenders (U033 candidate 2), U005 chat REPL UX (5x deferred).
3. **Run a follow-up live smoke** to force the `[BUDGET]` askUser path on a project larger than smoke-demo. Optional.

**Daemon state at handoff:** stopped (post-phase-close-smoke teardown). Restart with `factory daemon start` if next session needs it.

**Phase 13 done-criteria status (10 of 10 green at close):**

- [x] All four `pnpm` gates green (workspace 1322 + 3 skipped)
- [x] ADR 0032 amendment lands (13.3 at `46198b4`)
- [x] `resolveTaskMaxTurns` returns `min(planner_emit, operator_ceiling)`; docstring updated; 6 new tests (13.3)
- [x] `factory daemon stop` on Windows leaves no stale pidfile; cross-platform unit test + LIVE verification (13.4 at `31afcb9`)
- [x] `<project>/.factory/project.json` `metadata.budgetDefaults` accepts all seven axes; three-tier resolution preserved (13.5 at `ffdbd8f`)
- [x] `BUDGET_DEFAULTS` gains `maxUsdPerTask`; pool pre-launch check; CLI flag + Web accordion (13.6 at `aae86dc`)
- [x] Auto-answer's `[BUDGET]` recognition is axis-agnostic at the marker level (was already; 13.6 confirms by reusing marker)
- [x] Browser smoke — propagation verified end-to-end ($1.09 spend, status=complete); live `[BUDGET]` firing covered by unit tests (see Notes above)
- [x] U033 closes — `46198b4`
- [x] U034 closes — `31afcb9` + LIVE-verified at phase-close

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
- **Structural `/session-end` lag-by-1 fix** — see the carry-forwards section above for current count (now #39 after this second session-end). Two structural options remain: track "last work commit" rather than HEAD, or amend STATE.md post-commit.

**Frontend-design judgement calls** carried from Phase 3 — not load-bearing for any active phase but worth recalling for any future web-side work: smart defaults beat empty states; native HTML beats custom widgets; theme-independent intentional colors for status semantics; error-class differentiation; visible-label vs. hover-title separation; inherit-don't-invent; root-cause CSS over global rewrites; hint-copy-teaches-consequence; in-context-affordance vs nav. **Tier 9 added** a new vocabulary on top: vermillion (`#ff4d1c`) as the singular signal color; Fraunces italic display + Bricolage Grotesque body + JetBrains Mono data; CSS custom-property tokens (`--bg / --surface / --ink / --hairline / --signal / --amber / --acid / --halt / --cool`) flipped by `prefers-color-scheme`; paper-grain SVG atmosphere via `body::before / body::after`; editorial masthead with brand mark `§` + numbered nav + monospaced status pip + pulse animation.

**Tier 11 in retrospect:** Two-session tier (afternoon scaffold + 11.1-11.2; evening 11.3 → 11.7 close, same calendar day 2026-05-16). Five tier-11 work commits in this session continuation (`81a0c74` 11.3, `49cc4e5` 11.4, `93c1c85` 11.5, `f95da1b` 11.6, this phase-close). +16 tests across packages (11.3 +7 state queries, 11.4 +4 daemon hub, 11.5 +5 daemon route); workspace 1200 → 1216 + 3 skipped. **No new ADR** — persistence design is straightforward (SQLite + tee + replay endpoint); the two interesting decisions (fan-out-after-persist; fixed cursor not advancing) live in commit bodies + code comments. Three plan-deviations all documented: (1) 11.4's hub-tee test went into a dedicated `directive-stream.test.ts` rather than `server.test.ts` (no HTTP surface; matches per-module convention); (2) 11.5 shipped 5 tests instead of the planned 3 (added 404 + empty-list at trivial cost); (3) 11.6 used a fixed join-cursor instead of the plan's advancing variant (advancing drops ms-collision live events sharing a ts with a previously-accepted live event — Tier 8/10 evidence). Live browser smoke (Playwright MCP, smoke-demo, $1.00 cap, real spend $0.6238 — under last smoke's $0.7241) confirmed all three Tier 11 scenarios end-to-end: refresh-survives, multi-tab consistency, terminal directive post-mortem visibility. Notable smoke-harness finding: `browser_tabs new` opens fresh contexts so the UI token captured by `captureTokenFromUrl()` doesn't carry — resolved by passing `?t=<token>` in the new tab's URL explicitly (not a production bug; real users share browser context).

**Tier 10 in retrospect:** Two-session tier (scaffold + 10.1–10.7 same day 2026-05-16). Eight tier-10 commits: scaffold `1ac1823`, 10.1 `0ce4590`, 10.2 `bb2bca9`, 10.3 `585f172`, 10.4 `e83c3c1`, 10.5 `f100910`, 10.6 `9289aff`, phase-close (this commit). +12 tests across packages (planner-emit +4, daemon resume route +8); workspace 1182 → 1194 + 3 skipped. ADR 0031 (log-forwarder design) landed; first ADR in the upgrade arc that pins an *emission convention* (manual emit-site discipline at every brain stage entry/exit/error) vs a structural surface. Two real bugs surfaced in passing: (1) the pre-existing `.cancel-btn` chrome had been rendering as default browser button since Phase 3 — Astro scoped `<style>` rules attach a `[data-astro-cid-xyz]` selector that JS-created elements never match. Fixed by lifting log-tail + button styles to `Dashboard.astro` `<style is:global>`. (2) `brain.serve`'s uncaught-throw catch path flipped the directive to `failed` in the DB but never emitted `directive.completed` on SSE — added belt-and-suspenders emit so the UI sees the terminal flip immediately. Live browser smoke (Playwright MCP) clicked Resume on the original `01KRQ1RPE5SM6Q8AYSRHHAPG39`, child `01KRR9RGFN10YMDX5C16TXK91Y` minted, activity panel narrated 5 events live (triage → architect-calling → wrote 13 wiki pages → readiness passed → planner-calling). Interesting observation: the architect on the resume produced 13 pages with a proper `modules/` directory split — wiki-readiness `modules-documented` check passed cleanly, the original automl warn was Opus non-determinism. The carry-forward `checkModules` h1 acceptance refinement stays a valid Tier 11 candidate but is advisory-only. Cancelled the planner mid-Sonnet to keep smoke budget bounded — total smoke spend $0.7241 (architect Opus). One UX gap surfaced post-cancel and noted as Tier 11 candidate: activity panel is empty after page reload on a terminal directive because `log.line` events are SSE-only (ephemeral).

**Tier 9 in retrospect:** Four commits this session — bundled redesign + recordkeeping `397637c`, gitignore tweak `307d79c`, phase-close `9e8ee5c`, next.md regen `faeb209`. First aesthetic-only tier in the upgrade arc; no tests added (visual change only), no new APIs, no new packages, workspace count unchanged at 1182 + 3 skipped. The "informal cadence" (no per-step commits, no ADR, post-hoc recordkeeping) worked because the redesign was a single-author single-session concept transfer from a sibling project — per-step commits would have added friction without information. Live browser smoke completed via Playwright MCP in-session, satisfying the operator-side gate that the README originally said couldn't be assistant-driven. Two false positives investigated and dismissed during smoke (Playwright cursor hover-retention on the nav active-state, Chrome `currentColor` cache from pre-injection paint on dark-mode body copy); neither is a production bug. Absorbed Phase 8's "PageShell + Dashboard `<style is:global>` migration" de facto — global stylesheet now carries the look pages have always referenced via shared classes.

**Tier 8 in retrospect:** 8 work commits this session (scaffold + 8.1 → 8.7) plus this phase-close commit. Tier 8 was a real structural addition: schema migration + new ADR + new config home + brain-side LLM dispatcher with race mitigation + web surface. Total Tier 8 code: ~1900 lines added across the codebase (heaviest in 8.6's dispatcher + tests + 8.3's ADR + 8.2's migration). All 4 `pnpm` gates green throughout. Workspace count grew 1152 → 1182 + 3 skipped (+30 across migration, config, deadline-stamp, and dispatcher tests). New ADR (0030) — Tier 8 had real structural decisions to pin (provenance shape, config home, race mitigation, no-override). Two intentional plan deviations both noted in commit bodies + LOG: (1) `loadConfig` I/O placed in `@factory5/state` not `@factory5/core` to keep core fs-free; (2) prompt context pruned to question + options + directive + past Q&A for first ship per ADR 0030's "alternatives considered" — re-add when quality data shows the generic prompt underperforms. Drift fix #19 was carried into the scaffold commit (STATE.md inside scaffold referenced `cf9d4f9` while HEAD moved to `8453086`); the phase-close commit reintroduces the lag at #20, structural fix still pending.

**Tier 7 in retrospect:** 4 work commits this session (drift-fix `436887a` + scaffold `ee970e8` + 7.1 `b1dd5d6` + 7.2 `0d27925`) plus the phase-close commit. Tier 7 itself was pure composition: `factory findings mark` wraps the existing `updateFindingStatus` API with `runFindingsShow`-style disambiguation. Total Tier 7 code: ~80 lines of handler + 90 lines of Commander wiring + 130 lines of test fixtures. All 4 `pnpm` gates green throughout. Workspace count grew 1144 → 1152 from 7.2's 8 mark tests. No new ADRs (composition tier; no structural ambiguity). Drift fix #18 caught up mid-session via `docs(state)`; the phase-close commit reintroduces the lag at #19, structural fix still pending.

**Frontend-design judgement calls** carried from Phase 3 — not load-bearing for any active phase but worth recalling for any future web-side work: smart defaults beat empty states; native HTML beats custom widgets; theme-independent intentional colors for status semantics; error-class differentiation; visible-label vs. hover-title separation; inherit-don't-invent; root-cause CSS over global rewrites; hint-copy-teaches-consequence; in-context-affordance vs nav.

**Tier 6 in retrospect:** 11 work commits (scaffold + 6.1 → 6.last + the phase-close commit). Total session output: ~1100 lines added across the codebase (most in 6 skill rewrites + tier-6 plan + fixer parser code). All 4 `pnpm` gates green throughout. Workspace count grew 1135 → 1144 + 3 skipped from 6.3's parser tests. No new ADRs; the 6.3 attach-point homework found a clean precedent in `parse-findings.ts` (worker-side), no structural ambiguity to pin. Two per-skill verbatim-rule deviations (progress-tracking, scaffolding frontmatter descriptions) — both justified by factual wrongness against ADR 0021. The README done-criterion that said the parser would live in `packages/brain/src/` was contradicted by the homework finding (worker-side); intent satisfied, location revised in 6.3's commit body but README left as historical scaffold.
