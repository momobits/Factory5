# Tier 14 — Wiki-readiness LLM judge

**Status:** scaffolded, not started
**Estimated duration:** 2-3 sessions
**Issues addressed:** U035 (regex wiki-readiness gate fires on most builds because the architect's output shapes don't match the literal patterns expected)

## Goal

Replace `packages/wiki/src/readiness.ts`'s regex-based `wikiReadiness()` gate with an LLM judge that evaluates the wiki against the directive's intent + the project's CLAUDE.md + all wiki pages. The judge produces a structured `WikiCritique`; on failure the architect re-runs with critique feedback; on exhaustion (default 3 attempts) the brain files an `askUser` for operator decision.

Full design spec: [`../../docs/superpowers/specs/2026-05-18-tier-14-wiki-readiness-llm-judge-design.md`](../../docs/superpowers/specs/2026-05-18-tier-14-wiki-readiness-llm-judge-design.md)

Full implementation plan: [`../../docs/superpowers/plans/2026-05-23-tier-14-wiki-readiness-llm-judge.md`](../../docs/superpowers/plans/2026-05-23-tier-14-wiki-readiness-llm-judge.md)

## Outcome

- **Over-literal regex gate replaced** — `wikiReadiness()` and its four helpers deleted from `packages/wiki/src/readiness.ts`. No deprecated aliases. `ReadinessCheck` and `ReadinessReport` types deleted; anything still importing them is broken code worth surfacing.
- **New `runWikiCritic` module** — single LLM call against the resolved `critic` agent category (Opus by default). Returns a `WikiCritique { passes, severity, findings[], summary }`. No retry logic — retry is the wrapper's job.
- **New `runArchitectWithCritique` wrapper** — orchestrates the architect→critic→architect retry loop. Owns the `maxWikiReadinessAttempts` budget check, the `askUser` exhaustion path, and per-iteration `emitLogLine` narration.
- **Architect default category flip** — `reasoning` (Opus) → `planning` (Sonnet). Cheap fast author + thorough expensive critic can net lower spend than today's expensive author with no critic. Operator can flip back via `[agents].architect = "reasoning"` in `.factory/config.toml`.
- **New `critic` agent role** — 10th entry in `AGENT_ROLES`; spend rollups under `agent: 'critic'` are automatic.
- **8th `BUDGET_DEFAULTS` axis** — `maxWikiReadinessAttempts` (default 3, 0 = unlimited). Flows through the five-surface pipeline Phase 13.6 established: core schema → CLI flag → Web UI accordion → per-project metadata → payload → resume inheritance.
- **New `[agents.*]` config table** — `agentsConfigSchema` + `resolveAgentCategory` helper in `@factory5/state`. Per-agent model category overrides live in daemon-wide `config.json`; agent category choice is stable across directives.
- **ADR 0033** (new) + amendment blocks on ADR 0032/0004/0030.
- **U035 closes** at step 14.12.

## Where we were, end of Phase 13

Phase 13 closed `phase-13-budget-followups-closed` at `aae86dc` — U033 and U034 both resolved; workspace 1322 + 3 skipped; all four `pnpm` gates green. The wiki-readiness warn had been called out in the Phase 11 retrospective as a carry-forward ("Opus non-determinism, not a load-bearing gate bug"); it surfaces as U035 at Tier 14 scaffold time.

## Why this tier exists

The advisory contract (warn-but-proceed) is right; the regex is wrong. `checkModules` requires `modules/` subdirectory pages OR a literal `\n## Modules` H2. The architect produces `# Modules` H1, `## Components`, scattered headings, and other shapes — all semantically equivalent, all failing the regex. The warn fires on most projects, training operators to ignore it; when it IS load-bearing, the noise masks the signal. An LLM judge evaluating against directive intent eliminates the false-positive noise and upgrades the true-positive signal.

## What this tier ships

### 14.1 — Scaffold tier

This commit: `UPGRADE/ISSUES.md` (U035 opened), ROADMAP Tier 14 section, UPGRADE plan (this file), phase-14 README + steps, `phase-plan.md` Phase 14 row, STATE.md cursor flip.

### 14.2 — ADR 0033 + amendments

ADR 0033 (new) — wiki-readiness critique loop: six-part decision (LLM-as-sole-readiness-arbiter, critic contract, rich critique schema, retry-with-feedback, exhaustion path, architect default-category flip). Amendment blocks on ADR 0032 (8th axis), ADR 0004 (per-agent category override layer), ADR 0030 (`[CRITIC]` marker case). INDEX.md + `docs/ARCHITECTURE.md` ADR count line bumped 32 → 33.

### 14.3 — Core schemas + constants

`packages/core/src/schemas.ts` — `wikiCritiqueSchema` (and aspect/severity/finding helpers). `packages/core/src/constants.ts` — `AGENT_ROLES` gains `'critic'` (10th). `packages/core/src/budget-defaults.ts` — `BUDGET_DEFAULTS` gains `maxWikiReadinessAttempts` (8th axis, default 3). `packages/core/src/schemas.ts` — `budgetsSchema` extended. Unit tests: ~8 tests (spec §8.2).

### 14.4 — State: agent config

`packages/state/src/config.ts` — `agentsConfigSchema`, `DEFAULT_AGENT_CATEGORIES` (`architect: 'planning'`, `critic: 'reasoning'`), `resolveAgentCategory(config, role)` helper. Unit tests: ~4 tests (spec §8.2).

### 14.5 — Brain: `runWikiCritic`

New `packages/brain/src/critic.ts` (~180 lines). Reads directive body + CLAUDE.md + wiki pages on disk; single LLM call against resolved `critic` category; returns `WikiCritique`; emits `brain.critic` log lines per ADR 0031. Budget assertion fires before LLM call. Unit tests: ~10-12 tests (spec §8.1).

### 14.6 — Brain: `runArchitect` modifications

`packages/brain/src/architect.ts` — `priorCritique?: WikiCritique` parameter appends `--- PREVIOUS ATTEMPT FAILED ---` block to user prompt. Architect category resolves via `resolveAgentCategory(config, 'architect')` (was hardcoded `'reasoning'`). Unit tests: ~3-4 added tests (spec §8.1).

### 14.7 — Brain: `runArchitectWithCritique` wrapper

New `packages/brain/src/architect-loop.ts` (~200 lines). Orchestrates architect→critic→architect retry loop. Owns `maxWikiReadinessAttempts` budget check, `askUser` exhaustion path (`[continue/abort/extend-N]`), per-iteration `emitLogLine` narration. Returns `ArchitectLoopResult`. Unit tests: ~12-15 tests (spec §8.1).

### 14.8 — Brain: loop integration + deletions

`packages/brain/src/loop.ts` — swaps `runArchitect(...)` for `runArchitectWithCritique(...)` at the `// -------- ARCHITECT --------` block; resume-skip check replaced with pages-on-disk structural check. `packages/wiki/src/readiness.ts` — deleted entirely. `packages/wiki/src/wiki.test.ts` — `describe('wikiReadiness')` block (~80 lines) deleted. `packages/wiki/src/index.ts` — re-exports removed. Loop integration tests: ~4 tests (spec §8.5). Workspace stays green at this commit boundary.

### 14.9 — Daemon: schema + persistence + resume

`packages/daemon/src/server.ts` — verifies `apiV1CreateBuildRequestSchema` accepts `body.budgets.maxWikiReadinessAttempts` (free via Phase 13.5 widening); per-axis resume inheritance verified. Integration tests: ~2-3 tests (spec §8.3).

### 14.10 — CLI: `--max-wiki-readiness-attempts` flag

`packages/cli/src/commands/budget-flags.ts` — adds `--max-wiki-readiness-attempts <n>` via `parsePositiveInt`. CLI tests: ~2 tests (spec §8.4).

### 14.11 — Web UI: 8th accordion row

`apps/factory-web/src/pages/build.astro` — adds 8th field to the "Advanced budgets" accordion; summary "seven axes" → "eight axes". Follows the Phase 12.4 / 13.6 accordion pattern.

### 14.12 — Phase close

Standard gates + live browser smoke (Playwright MCP, spec §8.6 shape). ROADMAP/STATE recordkeeping; `phase-14-wiki-readiness-judge-closed` tag.

## Done criteria

- [ ] All four `pnpm` gates green (build / test / lint / format:check) across all 15 packages
- [ ] ADR 0033 lands; ADR 0032/0004/0030 amendment blocks dated
- [ ] `wikiReadiness()` and its 4 helpers deleted; no remaining importers
- [ ] `runWikiCritic` + `runArchitectWithCritique` + `runArchitect priorCritique` parameter all tested per spec §8
- [ ] `BUDGET_DEFAULTS` has 8 axes; `maxWikiReadinessAttempts` flows through CLI + Web UI + per-project + payload + resume
- [ ] `[agents.*]` config table parses; `resolveAgentCategory` defaults correctly
- [ ] `AGENT_ROLES` has 10 entries including `'critic'`
- [ ] Live browser smoke: critic fires on a CLAUDE.md-thin project; at least one retry observed; spend rollup shows distinct `critic` row
- [ ] Auto-answer dispatcher recognizes `[CRITIC]` marker; defaults to `continue` after deadline
- [ ] Workspace test count ≥ 1340 passing
- [ ] U035 closes

## Rollback

`git reset --hard phase-13-budget-followups-closed`. No DB schema changes; no migrations. ADR 0033 reversible via git revert; amendments are append-only blocks. `wikiReadiness()` deletion reversible by restoring the deleted file from git history.

## Suggested commit shape

- `chore(phase-14): scaffold tier 14 wiki-readiness judge`
- `docs(14.2): ADR 0033 + ADR 0032/0004/0030 amendments`
- `feat(14.3): wikiCritiqueSchema + AGENT_ROLES critic + BUDGET_DEFAULTS 8th axis`
- `feat(14.4): agentsConfigSchema + resolveAgentCategory in state`
- `feat(14.5): runWikiCritic (TDD)`
- `feat(14.6): runArchitect priorCritique param + agent-category resolution`
- `feat(14.7): runArchitectWithCritique wrapper (TDD)`
- `feat(14.8): loop integration + delete wikiReadiness + delete old tests`
- `feat(14.9): daemon schema acceptance + persistence + resume inheritance`
- `feat(14.10): --max-wiki-readiness-attempts CLI flag`
- `feat(14.11): web UI 8th accordion row`
- `chore(phase-14): close phase 14`

## Carry-forward (Tier 15+ candidates)

- **Generic critic loops for other stages** — planner critic, build critic. `critic` role is generic; only wiki critic ships here.
- **Diff-style architect output on retry** — full wiki rewrite per attempt; optimize if cost data shows it matters.
- **Per-directive model category overrides** — `[agents.*]` is daemon-wide; per-build switching is future.
- **Critic prompt context expansion** — task_log, findings, prior similar projects. Expand when quality data shows the lean prompt underperforms.
- **`maxWikiJudgeUsd` cost axis** — count-only for first ship; dedicated dollar cap if count-axis proves insufficient.
- **Mid-task budget escalation** — carried forward from Phase 13; bigger surface still.
- **Budget audit dashboard** — needs telemetry foundation first.
