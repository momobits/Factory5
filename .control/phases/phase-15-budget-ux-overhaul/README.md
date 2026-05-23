# Phase 15 — budget-ux-overhaul

**Dependencies:** Phase 14 closed (`phase-14-wiki-readiness-judge-closed`)
**Estimated duration:** 2-3 sessions
**Status:** scaffolded, not started

## Goal

Replace the entire `[BUDGET]` askUser escalation path with a project-level budget cockpit. Switch the three `maxTurns*` axes from per-task caps to per-agent-class directive-wide pools. Live re-resolve from `project.json` so the operator can raise a cap while a directive is running. Optional auto-increase toggle bounded by a safety multiplier ceiling. The parser, the askUser, the structured-options-UI gap, and the per-axis bucket schedule all disappear together.

## Outcome

- **U036 closes** — `parseBudgetEscalationAnswer` and the `[BUDGET]` askUser path deleted entirely. Pool exhaustion parks the directive with a structured `blockedReason`; operator unblocks via the project page Live tab or by raising the cap in `project.json`.
- **U037 closes** — the Question Detail free-form textarea on structured-options questions is no longer reachable for budget escalation (the `[BUDGET]` askUser is never created). General fix for other structured-options askUsers deferred to Tier 16+.
- **`budget-escalation.ts` deleted** — ~360 lines of parser + bucket schedule + escalation helpers gone; companion test file deleted. No deprecated aliases; anything still importing them is broken code worth surfacing.
- **Pool model for `maxTurns*` axes** — `computePoolUsage(db, directiveId, projectBudgets)` aggregates task turn counts per agent class. Cap resolution: `max(project.json defaults, payload.budgets, BUDGET_DEFAULTS)` per axis. Pool is derived live — not stored.
- **Live re-resolve from `project.json`** — new `pool-resume.ts` chokidar watcher on `<project>/.factory/project.json`; on mutation, flips any parked directives back to running when the recomputed cap has headroom (monotonic-up only — per-directive `payload.budgets` floor preserved).
- **Optional auto-increase policy** — new `autoIncreaseBudgets` boolean + `autoIncreaseCeilingMultiplier` number (default 5×) in `project.json` `metadata`. When enabled, pool exhaustion auto-bumps the cap by the project default for that axis, up to the ceiling multiplier. Parks when ceiling is reached.
- **Project page tabbed cockpit** — full rewrite of `apps/factory-web/src/pages/projects/detail.astro` into four tabs: Live (pool bars + per-axis drill-down + parked-alert banner + auto-resume CTA), Defaults (8-axis form replacing the old 2-axis form), History (paginated directive list), Settings (auto-increase toggle + multiplier).
- **New `GET /api/v1/directives/:id/pool-usage` route** — returns live pool tally; daemon route + IPC schema.
- **`pool.tally` SSE event** — emitted after every task completion and after every cap bump; FE subscribes for live bar updates.
- **ADR 0034** — Budget Pool Paradigm (supersedes ADR 0032). Plus amendment blocks on ADR 0030 (delete `[BUDGET]` marker branch from auto-answer) and ADR 0020 (pool semantics cross-ref).

Full plan: [`../../../UPGRADE/plans/tier-15-budget-ux-overhaul.md`](../../../UPGRADE/plans/tier-15-budget-ux-overhaul.md).
Implementation plan: [`../../../docs/superpowers/plans/2026-05-24-tier-15-budget-ux-overhaul.md`](../../../docs/superpowers/plans/2026-05-24-tier-15-budget-ux-overhaul.md).

## Where we were, end of Phase 14

Phase 14 closed cleanly (`phase-14-wiki-readiness-judge-closed`, tagged at `431c7da`) — U035 resolved; regex `wikiReadiness` gate deleted, LLM critic wired, 8th budget axis (`maxWikiReadinessAttempts`) flows through CLI + Web UI + per-project + payload + resume, `[agents.*]` per-agent category override layer (architect defaults flipped to Sonnet, critic defaults Opus), auto-answer `[CRITIC]` marker support. Live smoke ran cleanly — Sonnet architect ($0.110) + Opus critic ($0.172) = $0.282 wiki-phase spend; critic passed first try. Workspace 1388 passing + 3 skipped. All four `pnpm` gates green from the Phase 14 close run.

Post-close the arc sat at `arc-complete (tenth time)`. During the 2026-05-23 pythonetl build, two new issues surfaced (U036 — `[BUDGET]` parser rejects natural-language replies; U037 — Question Detail renders free-form textarea on structured-options questions) plus a race-condition observation filed as U038 (deferred Tier 16+ candidate). Tier 15 is the response to U036 and U037.

## Why this phase exists

The `parseBudgetEscalationAnswer` parser recognizes only literal `'accept'`, `'abort'`, or `/^custom\s+(\d+)$/`. An operator typing `"accept, bump to 160"` during the 2026-05-23 pythonetl build hit parse-failed → abort, cascading 12 dependent task failures with exit 2. The root cause is not the parser — it's the paradigm: asking the operator to type a structured reply via a free-form textarea for a closed-set answer space (U037). The correct fix is to delete the paradigm. The budget pool model (ADR 0034) replaces it: pool exhaustion parks the directive, the operator raises the cap on the project page, and the chokidar watcher auto-resumes the directive. No parser, no askUser, no option-list UI gap.

Issues addressed: U036 (open from 2026-05-24 Phase 15 scaffold), U037 (open from 2026-05-24 Phase 15 scaffold).

## Steps

See [`steps.md`](steps.md).

## Done criteria

- [ ] All 4 `pnpm` gates green (~1454 passing + 3 skipped)
- [ ] ADR 0034 lands; ADR 0032 marked `Superseded by ADR 0034`; ADR 0030 amendment block (delete `[BUDGET]` branch); ADR 0020 cross-ref amendment
- [ ] `packages/brain/src/budget-escalation.ts` deleted; companion test deleted; no remaining importers
- [ ] `[BUDGET]` branch removed from `auto-answer.ts`; `[CRITIC]` regression test passes
- [ ] Pool consumer lives in `pool.ts` + `pool-usage.ts` + `pool-resume.ts` with full test coverage
- [ ] New `GET /api/v1/directives/:id/pool-usage` returns correct shape; SSE `pool.tally` events emit
- [ ] `PUT /api/v1/projects/:id/budget-defaults` accepts all 8 axes + 2 new scalars (`autoIncreaseBudgets`, `autoIncreaseCeilingMultiplier`)
- [ ] Project detail page renders 4 tabs; Live tab shows bars + drill-down; parked-alert banner appears
- [ ] Auto-increase toggle bumps on exhaustion, respects ceiling, parks at ceiling
- [ ] Live re-resolve verified: edit `project.json` out-of-band, in-flight cap updates without restart
- [ ] Browser smoke #1 (parked → raise → auto-resume) verified
- [ ] U036 + U037 moved to Resolved; U038 stays in Open as Tier-16+ candidate

## Rollback

`git reset --hard phase-14-wiki-readiness-judge-closed`. No DB schema changes; no migrations. ADR 0034 is reversible via git revert; amendments on ADR 0030/0020 are append-only blocks (revert or delete the block). The `budget-escalation.ts` deletion is reversible by restoring from git history. The pool-model code in `pool.ts` / `pool-usage.ts` / `pool-resume.ts` can be reverted without data loss (no migrations run in Tier 15).

## ADRs decided in this phase

- **ADR 0034** (new) — Budget Pool Paradigm: pool semantic for `maxTurns*` axes; live re-resolve from `project.json`; pool exhaustion parks (no askUser); linear bump rule; auto-increase toggle with safety ceiling; planner stops emitting `task.maxTurns`. Supersedes ADR 0032.
- **ADR 0032 status update** — Status line only: `Superseded by ADR 0034 (2026-05-24)`. No other edits per CLAUDE.md "do not edit accepted ADRs" rule.
- **ADR 0030 amendment block** (dated 2026-05-24) — deletes the `[BUDGET]` marker branch added in Tier 12. Auto-answer dispatcher now handles only `[CRITIC]` (Tier 14) and generic LLM dispatch.
- **ADR 0020 amendment block** (dated 2026-05-24) — cross-reference to ADR 0034 as the canonical pool model reference going forward.

## Deferred to Tier 16 (or later)

- **U038** — brain races auto-answer LLM dispatch on directive-level `[escalation]` askUser. Brain-side timing fix; separate tier.
- **General fix for non-budget structured-options askUsers** — Question Detail free-form textarea for non-`[BUDGET]` structured questions. In scope for Tier 16+.
- **Generic critic loops for other stages** — planner critic, build critic. Carried from Tier 14.
- **Mid-task budget escalation for non-turn axes** — `maxUsd` and `maxSteps` still use the legacy `[BUDGET]` escalation pattern for per-task USD cap (`maxUsdPerTask`). Unify with pool model in a future tier.
- **Budget audit dashboard** — needs telemetry foundation first. Carried from Tier 14.
- **Per-directive model category overrides** — `[agents.*]` lives in daemon-wide config. Carried from Tier 14.
