# Next session kickoff

> Auto-generated from `.control/progress/STATE.md` at 2026-05-23T17:07:27Z by
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

**Phase 14 (wiki-readiness-judge) closed; upgrade arc complete (tenth time).** Replaced the regex `wikiReadiness` gate with an LLM critic loop per ADR 0033. Architect default flipped Opus → Sonnet; critic defaults Opus; both overridable via new `[agents.*]` config table. 8th budget axis `maxWikiReadinessAttempts` (default 3) caps architect+critic retry cycles; on exhaustion the brain files an askUser with `[continue/abort/extend-N]` and the auto-answer dispatcher recognizes the `[CRITIC]` marker for deterministic `continue`.

**Live smoke verified end-to-end** (Playwright MCP, directive `01KSAVBNVNTARM6EPFPPJFQZKT`, project tier-14-smoke, 2026-05-23). Activity panel narrated the full flow: `brain.architect-loop: critic: evaluating wiki (attempt 1/3)` → `brain.architect: calling claude-sonnet-4-6` (Sonnet flip live) → `architect: wrote 3 wiki pages` → `brain.critic: calling claude-opus-4-7 (category reasoning)` → `critic: passed — <full Opus verdict>` → planner runs normally. Wiki-phase spend $0.282 (architect $0.110 + critic $0.172). Critic passed first try — retry path NOT live-exercised (covered by 42 unit tests across critic/architect-loop/auto-answer modules). Persistence verified via API GET: `directive.payload.budgets.maxWikiReadinessAttempts: 3` round-tripped.

**Two pre-existing bugs incidentally caught and fixed during Tier 14:**

1. Phase 13.6's `maxUsdPerTask` was silently dropped by a hardcoded 6-axis list in `packages/wiki/src/project-metadata.ts::resolveDirectivePayloadBudgets`. Fixed in Task 14.9 by replacing the hardcoded list with `BUDGET_AXES` iteration. Regression tests added.
2. ADR 0030's promised `[CRITIC]` marker handler was written in the amendment block but never implemented in `auto-answer.ts`. Caught by the final code reviewer; fix at `431c7da`.

**Recommended next options for the next session:**

1. **`/session-end`** — bank the day; arc-complete state is the natural resting point.
2. **Author a new tier** if a fresh operator-felt issue surfaces. Available carry-forwards from Tier 14 §9 (Out of scope): generic critic loops for other stages (planner critic, build critic — the `critic` agent role was made generic for this); diff-style architect output on retry; per-directive model category overrides; critic prompt context expansion; `maxWikiJudgeUsd` dollar cap; mid-task budget escalation; budget audit dashboard. Long-standing carry-forwards below.
3. **Run a follow-up live smoke** exercising the retry/exhaustion paths (today's smoke had the critic pass first try). An `--max-wiki-readiness-attempts 1` build against a deliberately bad spec would force the askUser exhaustion path live, demonstrating the `[CRITIC]` marker + auto-answer handler in production.

**Daemon state at handoff:** stopped (post-smoke teardown). Restart with `pnpm factory daemon start` if next session needs it.

**Phase 14 done-criteria status (11 of 11 green at close):**

- [x] All four `pnpm` gates green (workspace 1388 + 3 skipped; +66 from Phase 13's 1322)
- [x] ADR 0033 lands (14.2 at `50d38a8`); ADR 0032/0004/0030 amendment blocks appended
- [x] `wikiReadiness()` and its 4 helpers deleted (14.8 at `02adf0c`); no remaining importers
- [x] `runWikiCritic` (14.5) + `runArchitectWithCritique` (14.7) + `runArchitect priorCritique` (14.6) all tested
- [x] `BUDGET_DEFAULTS` has 8 axes; `maxWikiReadinessAttempts` flows through CLI + Web UI + per-project + payload + resume
- [x] `[agents.*]` config table parses; `resolveAgentCategory` defaults correctly (architect→planning, critic→reasoning)
- [x] `AGENT_ROLES` has 10 entries including `'critic'`
- [x] Live browser smoke verified at `01KSAVBNVNTARM6EPFPPJFQZKT` (see Notes above)
- [x] Auto-answer dispatcher recognizes `[CRITIC]` marker; defaults to `continue`
- [x] Workspace test count ≥ 1340 passing (actual: 1388)
- [x] U035 closes (`02adf0c`)

**Future tiers — Phase 14 Deferred section carry-forwards:**

- **Generic critic loops for other stages** — planner critic, build critic. The `critic` agent role is generic for future-proofing.
- **Diff-style architect output on retry** — architect rewrites full wiki on retry; optimize if cost becomes a problem.
- **Per-directive model category overrides** — `[agents.*]` lives in daemon-wide config; per-build model switching deferred.
- **Critic prompt context expansion** — task_log, findings, prior similar projects. Expand when quality data shows the lean prompt underperforms.
- **Cost-axis enforcement** (`maxWikiJudgeUsd`) — count-only for first ship; add a dedicated dollar cap later if needed.
- **Mid-task budget escalation** — carried forward from Phase 13; bigger surface still.
- **Budget audit dashboard** — needs telemetry foundation first.

**Long-standing carry-forwards** (bundle opportunistically):

- **U005** — `factory chat` REPL cancel UX path (a+). Five-times-deferred. Promote when false-timeout pain surfaces in real use.
- **Per-project `askUserDeadlineMs` override** — CLAUDE.md frontmatter or `<project>/.factory/project.json` `metadata`. Non-breaking atop Tier 8's daemon-wide config.
- **`factory config get / set <key>` CLI** — operator surface for `<dataDir>/config.json`.
- **Override after auto-answer** — `factory questions answer --force <id>`. Pin via ADR if it ships.
- **Inline-style audit on the 12 pages** — Tier 9-deferred.
- **Structural `/session-end` lag-by-1 fix** — now at #44 occurrences after Tier 14's commit-heavy session. Two structural options remain: track "last work commit" rather than HEAD, or amend STATE.md post-commit. The Tier-14-as-Tier-15-micro-tier framing from prior session-ends is more attractive now that Tier 14 alone burned 4 lag increments.
- **`pnpm-lock.yaml` 3-line drift** — uncommitted on disk; probably a transitive resolution change from one of the workspace dep updates during Tier 14. Worth a `pnpm install` audit at next session.
- **`docs/superpowers/{plans,specs}` prettier reformatting** — uncommitted on disk from format:check runs. Either commit the reformat or add the paths to `.prettierignore`.

**Frontend-design judgement calls** carried from Phase 3 — not load-bearing for any active phase but worth recalling for any future web-side work: smart defaults beat empty states; native HTML beats custom widgets; theme-independent intentional colors for status semantics; error-class differentiation; visible-label vs. hover-title separation; inherit-don't-invent; root-cause CSS over global rewrites; hint-copy-teaches-consequence; in-context-affordance vs nav. **Tier 9 added** a new vocabulary on top: vermillion (`#ff4d1c`) as the singular signal color; Fraunces italic display + Bricolage Grotesque body + JetBrains Mono data; CSS custom-property tokens (`--bg / --surface / --ink / --hairline / --signal / --amber / --acid / --halt / --cool`) flipped by `prefers-color-scheme`; paper-grain SVG atmosphere via `body::before / body::after`; editorial masthead with brand mark `§` + numbered nav + monospaced status pip + pulse animation.

**Tier 11 in retrospect:** Two-session tier (afternoon scaffold + 11.1-11.2; evening 11.3 → 11.7 close, same calendar day 2026-05-16). Five tier-11 work commits in this session continuation (`81a0c74` 11.3, `49cc4e5` 11.4, `93c1c85` 11.5, `f95da1b` 11.6, this phase-close). +16 tests across packages (11.3 +7 state queries, 11.4 +4 daemon hub, 11.5 +5 daemon route); workspace 1200 → 1216 + 3 skipped. **No new ADR** — persistence design is straightforward (SQLite + tee + replay endpoint); the two interesting decisions (fan-out-after-persist; fixed cursor not advancing) live in commit bodies + code comments. Three plan-deviations all documented: (1) 11.4's hub-tee test went into a dedicated `directive-stream.test.ts` rather than `server.test.ts` (no HTTP surface; matches per-module convention); (2) 11.5 shipped 5 tests instead of the planned 3 (added 404 + empty-list at trivial cost); (3) 11.6 used a fixed join-cursor instead of the plan's advancing variant (advancing drops ms-collision live events sharing a ts with a previously-accepted live event — Tier 8/10 evidence). Live browser smoke (Playwright MCP, smoke-demo, $1.00 cap, real spend $0.6238 — under last smoke's $0.7241) confirmed all three Tier 11 scenarios end-to-end: refresh-survives, multi-tab consistency, terminal directive post-mortem visibility. Notable smoke-harness finding: `browser_tabs new` opens fresh contexts so the UI token captured by `captureTokenFromUrl()` doesn't carry — resolved by passing `?t=<token>` in the new tab's URL explicitly (not a production bug; real users share browser context).

**Tier 10 in retrospect:** Two-session tier (scaffold + 10.1–10.7 same day 2026-05-16). Eight tier-10 commits: scaffold `1ac1823`, 10.1 `0ce4590`, 10.2 `bb2bca9`, 10.3 `585f172`, 10.4 `e83c3c1`, 10.5 `f100910`, 10.6 `9289aff`, phase-close (this commit). +12 tests across packages (planner-emit +4, daemon resume route +8); workspace 1182 → 1194 + 3 skipped. ADR 0031 (log-forwarder design) landed; first ADR in the upgrade arc that pins an *emission convention* (manual emit-site discipline at every brain stage entry/exit/error) vs a structural surface. Two real bugs surfaced in passing: (1) the pre-existing `.cancel-btn` chrome had been rendering as default browser button since Phase 3 — Astro scoped `<style>` rules attach a `[data-astro-cid-xyz]` selector that JS-created elements never match. Fixed by lifting log-tail + button styles to `Dashboard.astro` `<style is:global>`. (2) `brain.serve`'s uncaught-throw catch path flipped the directive to `failed` in the DB but never emitted `directive.completed` on SSE — added belt-and-suspenders emit so the UI sees the terminal flip immediately. Live browser smoke (Playwright MCP) clicked Resume on the original `01KRQ1RPE5SM6Q8AYSRHHAPG39`, child `01KRR9RGFN10YMDX5C16TXK91Y` minted, activity panel narrated 5 events live (triage → architect-calling → wrote 13 wiki pages → readiness passed → planner-calling). Interesting observation: the architect on the resume produced 13 pages with a proper `modules/` directory split — wiki-readiness `modules-documented` check passed cleanly, the original automl warn was Opus non-determinism. The carry-forward `checkModules` h1 acceptance refinement stays a valid Tier 11 candidate but is advisory-only. Cancelled the planner mid-Sonnet to keep smoke budget bounded — total smoke spend $0.7241 (architect Opus). One UX gap surfaced post-cancel and noted as Tier 11 candidate: activity panel is empty after page reload on a terminal directive because `log.line` events are SSE-only (ephemeral).

**Tier 9 in retrospect:** Four commits this session — bundled redesign + recordkeeping `397637c`, gitignore tweak `307d79c`, phase-close `9e8ee5c`, next.md regen `faeb209`. First aesthetic-only tier in the upgrade arc; no tests added (visual change only), no new APIs, no new packages, workspace count unchanged at 1182 + 3 skipped. The "informal cadence" (no per-step commits, no ADR, post-hoc recordkeeping) worked because the redesign was a single-author single-session concept transfer from a sibling project — per-step commits would have added friction without information. Live browser smoke completed via Playwright MCP in-session, satisfying the operator-side gate that the README originally said couldn't be assistant-driven. Two false positives investigated and dismissed during smoke (Playwright cursor hover-retention on the nav active-state, Chrome `currentColor` cache from pre-injection paint on dark-mode body copy); neither is a production bug. Absorbed Phase 8's "PageShell + Dashboard `<style is:global>` migration" de facto — global stylesheet now carries the look pages have always referenced via shared classes.

**Tier 8 in retrospect:** 8 work commits this session (scaffold + 8.1 → 8.7) plus this phase-close commit. Tier 8 was a real structural addition: schema migration + new ADR + new config home + brain-side LLM dispatcher with race mitigation + web surface. Total Tier 8 code: ~1900 lines added across the codebase (heaviest in 8.6's dispatcher + tests + 8.3's ADR + 8.2's migration). All 4 `pnpm` gates green throughout. Workspace count grew 1152 → 1182 + 3 skipped (+30 across migration, config, deadline-stamp, and dispatcher tests). New ADR (0030) — Tier 8 had real structural decisions to pin (provenance shape, config home, race mitigation, no-override). Two intentional plan deviations both noted in commit bodies + LOG: (1) `loadConfig` I/O placed in `@factory5/state` not `@factory5/core` to keep core fs-free; (2) prompt context pruned to question + options + directive + past Q&A for first ship per ADR 0030's "alternatives considered" — re-add when quality data shows the generic prompt underperforms. Drift fix #19 was carried into the scaffold commit (STATE.md inside scaffold referenced `cf9d4f9` while HEAD moved to `8453086`); the phase-close commit reintroduces the lag at #20, structural fix still pending.

**Tier 7 in retrospect:** 4 work commits this session (drift-fix `436887a` + scaffold `ee970e8` + 7.1 `b1dd5d6` + 7.2 `0d27925`) plus the phase-close commit. Tier 7 itself was pure composition: `factory findings mark` wraps the existing `updateFindingStatus` API with `runFindingsShow`-style disambiguation. Total Tier 7 code: ~80 lines of handler + 90 lines of Commander wiring + 130 lines of test fixtures. All 4 `pnpm` gates green throughout. Workspace count grew 1144 → 1152 from 7.2's 8 mark tests. No new ADRs (composition tier; no structural ambiguity). Drift fix #18 caught up mid-session via `docs(state)`; the phase-close commit reintroduces the lag at #19, structural fix still pending.

**Frontend-design judgement calls** carried from Phase 3 — not load-bearing for any active phase but worth recalling for any future web-side work: smart defaults beat empty states; native HTML beats custom widgets; theme-independent intentional colors for status semantics; error-class differentiation; visible-label vs. hover-title separation; inherit-don't-invent; root-cause CSS over global rewrites; hint-copy-teaches-consequence; in-context-affordance vs nav.

**Tier 6 in retrospect:** 11 work commits (scaffold + 6.1 → 6.last + the phase-close commit). Total session output: ~1100 lines added across the codebase (most in 6 skill rewrites + tier-6 plan + fixer parser code). All 4 `pnpm` gates green throughout. Workspace count grew 1135 → 1144 + 3 skipped from 6.3's parser tests. No new ADRs; the 6.3 attach-point homework found a clean precedent in `parse-findings.ts` (worker-side), no structural ambiguity to pin. Two per-skill verbatim-rule deviations (progress-tracking, scaffolding frontmatter descriptions) — both justified by factual wrongness against ADR 0021. The README done-criterion that said the parser would live in `packages/brain/src/` was contradicted by the homework finding (worker-side); intent satisfied, location revised in 6.3's commit body but README left as historical scaffold.
