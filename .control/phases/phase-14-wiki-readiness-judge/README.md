# Phase 14 — wiki-readiness-judge

**Dependencies:** Phase 13 closed (`phase-13-budget-followups-closed`)
**Estimated duration:** 2-3 sessions
**Status:** scaffolded, not started

## Goal

Replace the over-literal regex wiki-readiness gate with an LLM judge that evaluates the wiki against the directive's intent. The current `checkModules` regex in `packages/wiki/src/readiness.ts` requires either a `modules/` subdirectory of wiki pages OR a literal `\n## Modules` H2 header; the architect (Opus) frequently produces `# Modules` H1, `## Components`, scattered headings, or other shapes the regex misses. The warn fires on most projects, creating noise operators learn to ignore — when the warn IS load-bearing (genuinely thin wiki) the noise mixes it into the chaff.

## Outcome

- **U035 closes** — regex checks replaced with an LLM judge (`runWikiCritic`) that evaluates against directive intent + the project's CLAUDE.md + all wiki pages. On failure the architect re-runs with the critique as feedback (up to `maxWikiReadinessAttempts`, default 3). On exhaustion the brain files an `askUser` for operator decision; auto-answer defaults to `continue` per the new `[CRITIC]` marker case in ADR 0030's dispatcher.
- **`wikiReadiness()` and its four helpers deleted** — no deprecated aliases; anything still importing them is broken code worth surfacing.
- **Architect default category flips from `reasoning` (Opus) to `planning` (Sonnet)** — cheap fast author + thorough expensive critic (Opus) can net lower spend than today's expensive author with no critic. Configurable via `[agents.architect]` in `.factory/config.toml`.
- **New `critic` agent role** — 10th entry in `AGENT_ROLES`; spend rollups get the new bucket automatically.
- **New `maxWikiReadinessAttempts` axis** — 8th `BUDGET_DEFAULTS` entry; flows through CLI flag + Web UI accordion + per-project metadata + payload + resume inheritance.
- **New `[agents.*]` config table** — `agentsConfigSchema` + `resolveAgentCategory` helper in `@factory5/state`; per-agent model category overrides without code changes.
- **ADR 0033** — wiki-readiness critique loop (headline ADR for Tier 14). Plus amendment blocks on ADR 0032 (8th axis), ADR 0004 (per-agent category override layer), ADR 0030 (`[CRITIC]` marker case).

Full plan: [`../../../UPGRADE/plans/tier-14-wiki-readiness-judge.md`](../../../UPGRADE/plans/tier-14-wiki-readiness-judge.md).
Implementation plan: [`../../../docs/superpowers/plans/2026-05-23-tier-14-wiki-readiness-llm-judge.md`](../../../docs/superpowers/plans/2026-05-23-tier-14-wiki-readiness-llm-judge.md).

## Where we were, end of Phase 13

Phase 13 closed cleanly (`phase-13-budget-followups-closed`, tagged at `aae86dc`) — U033 and U034 both resolved; `resolveTaskMaxTurns` returns `min(planner_emit, operator_ceiling)` (ADR 0032 amendment); Windows pidfile cleanup verified live at phase-close; per-project budget defaults extended to all seven axes; seventh `maxUsdPerTask` axis ships with pre-launch escalation. Workspace 1322 + 3 skipped. All four `pnpm` gates green from the Phase 13 close run.

Post-close the arc sat at `arc-complete (ninth time)`. The wiki-readiness U035 issue filed during the Phase 11 retro ("Opus non-determinism, not a load-bearing gate bug") was nominated as the next carry-forward demand signal. Tier 14 is the response.

## Why this phase exists

The advisory contract (warn-but-proceed) is right in principle; the regex implementation is wrong in practice. Operators running chronically-thin-wiki projects see the `modules-documented` warn on every build — not because their wikis are thin, but because Opus writes `# Modules` H1 where the regex expects `\n## Modules` H2. The noise trains operators to ignore the warn; the warn loses its signal value. An LLM judge evaluating against directive intent eliminates the false-positive noise while upgrading the true-positive signal: the judge understands what the operator asked for and can articulate _why_ the wiki falls short.

Issues addressed: U035 (open from 2026-05-23 Phase 14 scaffold).

## Steps

See [`steps.md`](steps.md).

## Done criteria

- [ ] All four `pnpm` gates green (build / test / lint / format:check) across all 15 packages
- [ ] ADR 0033 lands; ADR 0032/0004/0030 amendment blocks dated 2026-05-18
- [ ] `wikiReadiness()` and its 4 helpers deleted; no remaining importers (`ReadinessCheck` / `ReadinessReport` types deleted, no deprecated aliases)
- [ ] `runWikiCritic` + `runArchitectWithCritique` + `runArchitect priorCritique` parameter all tested per spec §8
- [ ] `BUDGET_DEFAULTS` has 8 axes; `maxWikiReadinessAttempts` flows through CLI (`--max-wiki-readiness-attempts`) + Web UI accordion (8th row) + per-project metadata + payload + resume inheritance
- [ ] `[agents.*]` config table parses; `resolveAgentCategory` defaults correctly (`architect` → `planning`, `critic` → `reasoning`)
- [ ] `AGENT_ROLES` has 10 entries including `'critic'`
- [ ] Live browser smoke verified: critic fires on a CLAUDE.md-thin project; at least one retry observed; spend rollup shows distinct `critic` row in `/app/spend?group-by=agent`
- [ ] Auto-answer dispatcher recognizes `[CRITIC]` marker; defaults to `continue` after deadline
- [ ] Workspace test count ≥ 1340 passing
- [ ] U035 closes

## Rollback

`git reset --hard phase-13-budget-followups-closed`. No DB schema changes; no migrations. ADR 0033 is reversible via git revert; amendments on ADR 0032/0004/0030 are append-only blocks (revert or delete the block). The `wikiReadiness()` deletion is reversible by restoring the deleted file from git history.

## ADRs decided in this phase

- **ADR 0033** (new) — wiki-readiness critique loop: six-part decision covering LLM-as-sole-readiness-arbiter, critic contract, rich critique schema, retry-with-feedback, exhaustion path, and architect default-category flip.
- **ADR 0032 amendment block** (dated 2026-05-18) — adds `maxWikiReadinessAttempts` as 8th axis. No supersedure; §3 contract unchanged.
- **ADR 0004 amendment block** (dated 2026-05-18) — adds `[agents.*]` per-agent category override layer on top of existing category→model routing.
- **ADR 0030 amendment block** (dated 2026-05-18) — auto-answer dispatcher recognises `[CRITIC]` marker; deterministic default `continue`.

## Deferred to Tier 15 (or later)

- **Generic critic loops for other stages** — planner critic, build critic. The `critic` agent role is generic for future-proofing, but only the wiki critic ships in Tier 14.
- **Diff-style architect output on retry** — architect rewrites full wiki on retry; optimize if cost becomes a problem.
- **Per-directive model category overrides** — `[agents.*]` lives in daemon-wide config; per-build model switching deferred.
- **Critic prompt context expansion** — task_log, findings, prior similar projects. Expand when quality data shows the lean prompt underperforms.
- **Cost-axis enforcement** (`maxWikiJudgeUsd`) — count-only for first ship; add a dedicated dollar cap later if needed.
- **Mid-task budget escalation** — carried forward from Phase 13; bigger surface still.
- **Budget audit dashboard** — needs telemetry foundation first.
