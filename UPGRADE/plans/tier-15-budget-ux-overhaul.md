# Tier 15 — Budget UX overhaul

**Status:** plan ready, not yet scaffolded
**Estimated duration:** 3-4 sessions
**Issues addressed:** U036 (parser too strict — pythonetl build), U037 (free-text textarea on structured-options questions); **defers** U038 (brain races auto-answer on directive-level `[escalation]`)

## Goal

Replace the entire `[BUDGET]` askUser path with a project-level budget cockpit: live tally, live-editable caps, optional auto-increase. Switch the three `maxTurns*` axes from per-task caps to per-agent-class directive-wide pools. The parser, the askUser, the structured-options-UI gap, and the per-axis bucket schedule all disappear together. ADR 0034 (new) supersedes ADR 0032 with the pool paradigm.

Full design spec: [`../../docs/superpowers/specs/2026-05-24-tier-15-budget-ux-overhaul-design.md`](../../docs/superpowers/specs/2026-05-24-tier-15-budget-ux-overhaul-design.md)

Full implementation plan: [`../../docs/superpowers/plans/2026-05-24-tier-15-budget-ux-overhaul.md`](../../docs/superpowers/plans/2026-05-24-tier-15-budget-ux-overhaul.md)

## Outcome

- **`[BUDGET]` askUser path deleted entirely.** `packages/brain/src/budget-escalation.ts` (~360 lines) + companion test (~520 lines) removed. `auto-answer.ts` loses its `[BUDGET]` marker branch + `pickBudgetEscalationAnswer` helper. `BUMP_BUCKETS`, `MAX_TURNS_CLAMP_MIN/MAX`, `parseBudgetEscalationAnswer` all gone.
- **Pool model for `maxTurns*` axes.** One directive-wide cap per agent class (scaffolder / builder / fixer). Tasks draw from their class's pool; pool exhaustion is the trigger event. `maxUsd` + `maxSteps` already pool directive-wide; `maxUsdPerTask` stays per-task safety net.
- **Linear bump rule.** `accept` or auto-bump adds project-default per axis. Cap 120 → 240 → 360 → 480.
- **Pool calculation is derived live.** No new DB table. New `computePoolUsage(db, directiveId, currentProjectBudgets)` helper in `packages/brain/src/pool-usage.ts` aggregates `tasks.turnsUsed` grouped by `agent` + `model_usage` summed across `directive_id` rows + reads `project.json` caps on every check.
- **Live re-resolve from `project.json`.** Pool cap = `max(project.json[axis], directive.payload.budgets[axis], BUDGET_DEFAULTS[axis])` on every tick. Operator edits to project budgets take effect on in-flight directives. Per-build override is a floor (can be raised, never lowered for the directive's lifetime).
- **`pool-resume.ts` watcher.** chokidar on `<project>/.factory/project.json`; on write, re-checks parked directives and flips them back to running if cap now has headroom.
- **Pool exhaustion parks the directive — no askUser.** Brain marks `blocked` with structured `blockedReason: { kind: 'pool-exhausted', axis, usedAtPark, capAtPark }`. Project page surfaces a parked-alert banner with one-click "Raise cap to {nextBumpValue}" CTA.
- **Per-project auto-increase toggle.** `autoIncreaseBudgets: bool` (default `false`) + `autoIncreaseCeilingMultiplier: number` (default `5`) on `project.json`. When on: pool exhaustion auto-bumps cap by +default and retries; parks at `default × multiplier` ceiling.
- **Web UI project page tabbed cockpit.** Live (default) / Defaults / History / Settings tabs. Live tab uses bar treatment with click-to-expand per-task drill-down. Defaults tab expands today's 2-axis form to all 8 axes. Settings tab carries auto-increase toggle.
- **Directive detail page** gets a small "Pool usage" breadcrumb pill linking to the project page Live tab. No full-tally duplication.
- **New HTTP surface.** `GET /api/v1/directives/:id/pool-usage` returns live tally; `PUT /api/v1/projects/:id/budget-defaults` extends to all 8 axes + 2 new scalars; new `pool.tally` SSE event piggybacks the existing per-directive stream.
- **Planner drops `task.maxTurns` emit.** Prompt instruction removed. `taskSchema.maxTurns` stays as optional + ignored for backward read-back.
- **ADR 0034** (new — Budget Pool Paradigm) supersedes ADR 0032. **ADR 0030** amendment block (`[BUDGET]` removal). **ADR 0020** cross-reference amendment.
- **U036 + U037 close** at step 15.12.

## Where we were, end of Phase 14

Phase 14 closed `phase-14-wiki-readiness-judge-closed` at `431c7da` 2026-05-23 — Tier 14 delivered the LLM critic loop; U035 resolved; workspace 1388 + 3 skipped; all four `pnpm` gates green. The 2026-05-23 pythonetl test build (`01KSB8DEZQCENQEKBKBRCKNYZK`) surfaced the parser fragility (operator typed `"accept, bump to 160"` → parse-failed → 12-task cascade failure) and the structural mismatch between operator mental model (pool) and current per-task `maxTurns*` semantic.

## Why this tier exists

Three operator-felt gaps surfaced by the pythonetl run:

1. **Parser fragility.** `parseBudgetEscalationAnswer` only recognizes literal `accept` / `abort` / `custom <n>`; natural-language replies fail.
2. **UI freedom on a structured contract.** ADR 0032 §4 specified a closed answer set; the question detail page rendered a free-text textarea regardless.
3. **Per-task semantic is the wrong mental model.** Operators reason about "how much can this build cost" (pool), not per-task. The current `maxTurns*` axes are per-task; operator's "set the cap to 500" implies pool.

A surface-level parser loosening would address (1) but leave (2) and (3). Tier 15 unifies the fix by deleting the askUser entirely, replacing it with live-editable project budgets and an optional auto-bump policy.

## What this tier ships

### 15.1 — Scaffold tier

This commit: `UPGRADE/ISSUES.md` (U036, U037, U038 opened), ROADMAP Tier 15 section + intro count bump "Fourteen tiers" → "Fifteen tiers", UPGRADE plan (this file), `docs/superpowers/plans/2026-05-24-tier-15-budget-ux-overhaul.md` (detailed plan), phase-15 README + steps, `phase-plan.md` Phase 15 row, STATE.md cursor flip arc-complete → Phase 15 active at 15.1.

### 15.2 — ADRs

ADR 0034 (new) — Budget Pool Paradigm — supersedes ADR 0032. Six-part decision (pool semantic, linear bump, planner drops emit, live re-resolve with floor, park-not-askUser, auto-increase). ADR 0032 status flips to `Superseded by ADR 0034` via a Status line edit at the top (the only allowed edit per CLAUDE.md). ADR 0030 amendment block (`[BUDGET]` marker removed). ADR 0020 amendment block (cross-ref to ADR 0034). INDEX.md + `docs/ARCHITECTURE.md` ADR count line bumped 33 → 34.

### 15.3 — Core: project-level config scalars

`packages/core/src/schemas.ts` — extend `projectMetadataSchema` to allow `autoIncreaseBudgets: z.boolean().optional()` and `autoIncreaseCeilingMultiplier: z.number().min(1).optional()`. Both default off / 5× at the resolver layer, not the schema layer (schema stays permissive of absence). Unit tests: ~6.

### 15.4 — State: project metadata read/write

`packages/wiki/src/project-metadata.ts` — extend `loadOrCreateProjectMetadata` to return the two new scalars with defaults (`false`, `5`). Verify `writeProjectMetadata` round-trips the new keys. Delete `resolveDirectivePayloadBudgets` helper (the old per-axis snapshot resolver — replaced by live re-resolve in Section 15.5). Unit tests: ~4.

### 15.5 — Brain: `computePoolUsage`

New `packages/brain/src/pool-usage.ts` (~150 lines). Pure SQL aggregation: turn counts grouped by `agent` from `tasks` (mapped to `maxTurns{Scaffolder,Builder,Fixer}` axes via `axisForAgent` — moved here from the deleted `budget-escalation.ts`); USD + steps summed from `model_usage` rows scoped to directive_id; caps resolved via `effectiveCap[axis] = max(projectBudgets[axis], payloadBudgets[axis], BUDGET_DEFAULTS[axis].value)`. Per-axis `status` derivation: green < 80%, amber 80-99%, vermillion ≥ 100%. Per-task contribution array populated for the three pool axes only. Unit tests: ~10.

### 15.6 — Brain: `pool-resume` watcher

New `packages/brain/src/pool-resume.ts` (~120 lines). chokidar watcher on each known project's `<project>/.factory/project.json`; lazy-add on first directive creation per project; tear down when no directives on the project remain. On write: list parked directives for that project; re-compute pool usage for each; flip to `running` and re-enqueue via the directive doorbell when the recomputed `effectiveCap` has headroom over `used`. Idempotent against multiple writes (re-flip on already-running is a no-op). Unit tests: ~8.

### 15.7 — Brain: pool-driven dispatcher

`packages/brain/src/pool.ts` — replace the per-task `error_max_turns` retry-loop (~80 lines removed) with the new pool-driven dispatcher:

- Pre-launch pool check: bail to `parkOrAutoIncrease` if exhausted before worker starts.
- Worker watchdog callback: passed to `runWorker` via new `onTurnComplete` param. Worker (already heartbeating per Tier 11) calls it after each completed turn; callback returns `{ interrupt: true }` if pool now exhausted; worker exits via existing SIGTERM cancellation plumbing.
- `parkOrAutoIncrease(directive, axis, pool, projectBudgets)` helper: if `autoIncreaseBudgets` && cap < ceiling, writes `bumpProjectCap(projectPath, axis, defaultDelta)` and retries; else marks directive `blocked` with structured `blockedReason`.
- Cascade behavior: dependent tasks see `directive.status === 'blocked'` at dispatch-check time and aren't launched (gates the 12-task `'upstream failure'` cascade observed in the pythonetl run).

`packages/brain/src/planner.ts` — drop the `task.maxTurns` emit instruction from the prompt (~5 lines). Unit tests: ~12.

### 15.8 — Brain: delete `[BUDGET]` infrastructure

Delete `packages/brain/src/budget-escalation.ts` (~360 lines). Delete `packages/brain/src/budget-escalation.test.ts` (~520 lines). Delete the `[BUDGET]` marker branch + `pickBudgetEscalationAnswer` + `BUDGET_ESCALATION_MARKER` import from `packages/brain/src/auto-answer.ts` (~20 lines). Move `axisForAgent` helper to `pool-usage.ts` (the only remaining consumer). Regression test: `[CRITIC]` marker (Tier 14) still handled correctly; generic LLM dispatch still works. Net: ~900 lines removed; ~3 regression tests pass green at commit boundary.

### 15.9 — Daemon: HTTP / SSE surface

`packages/daemon/src/server.ts`:

- Extend `PUT /api/v1/projects/:id/budget-defaults` body schema to accept all 8 axes + `autoIncreaseBudgets` + `autoIncreaseCeilingMultiplier`. PUT semantics unchanged (full-document replace). Strict mode: extra keys rejected. Bearer auth unchanged.
- New `GET /api/v1/directives/:id/pool-usage` route. Bearer auth. 404 missing directive. Returns the `apiV1PoolUsageResponseSchema` shape (computed via `computePoolUsage`).
- Extend `GET /api/v1/directives/:id` response: `blockedReason` is a union of structured `{ kind: 'pool-exhausted', axis, usedAtPark, capAtPark }` OR plain string for legacy compat. DB column `directives.blocked_reason` stays `TEXT`; serialization handled at IPC layer.
- `directives.updateStatus(db, id, 'blocked', reason)` — `reason` parameter widens to accept the structured object; helper stringifies to JSON for storage.
- New SSE event `{ kind: 'pool.tally', directiveId, perAxis, parkedReason? }` on the per-directive stream. Emitted from the brain pool dispatcher after every task-completion event + after every `bumpProjectCap` write.

`packages/ipc/src/schemas.ts` (or wherever IPC schemas live) — add `apiV1PoolUsageResponseSchema`, extend `apiV1ProjectBudgetDefaultsPutBodySchema`, add `directiveStatusBlockedReasonSchema` union.

Integration tests: ~10 (PUT accepts/rejects, GET shape, 404, bearer, SSE event emit).

### 15.10 — Web UI: project page tabbed cockpit

`apps/factory-web/src/pages/projects/detail.astro` — full rewrite (~700 lines new). Structure:

- Header row: project name, ULID, workspace path, language, status.
- Parked-alert banner (conditional on any in-flight directive on this project being blocked-pool-exhausted): "⚠ Parked: pool {axis} exhausted at {cap} · Directive {short} · raised N times · [Raise cap to {nextBump}] [Abort directive]".
- Tab strip: Live (default) / Defaults / History / Settings. Tab persistence via localStorage.
- **Live tab**: bar treatment with three subsections (directive-wide pools / per-class turn pools / other caps). Each row click-to-expand for drill-down. Initial fetch `GET /api/v1/directives/:id/pool-usage` → subscribe SSE filtered for `pool.tally`. Empty-state copy when no in-flight directive. Directive selector at top when multiple in-flight directives on same project.
- **Defaults tab**: 8-axis form using `Field`/`Form`/`Submit` primitives. Inline help under each axis matching `BUDGET_DEFAULTS[axis].explainer`. PUT semantics preserved.
- **History tab**: paginated table of past directives on this project; columns ID, created, status, intent, spend USD, total turns, link to directive detail. Uses existing `GET /api/v1/directives?projectId=X`.
- **Settings tab**: `autoIncreaseBudgets` checkbox + `autoIncreaseCeilingMultiplier` number input (≥1). Saves via the same PUT `/budget-defaults` endpoint.

### 15.11 — Web UI: directive detail + build form polish

`apps/factory-web/src/pages/directives/detail.astro` — add small "Pool usage" pill near the spend display, linking to `/app/projects/{projectId}` (Live tab). Renders `pool: {axis} {used}/{cap} {STATUS}` from the latest `pool.tally` event; falls back to single fetch on initial mount.

`apps/factory-web/src/pages/build.astro` — Advanced budgets accordion (Phase 12.4) stays. Copy update: "Override budgets for this build (operator floor). Live edits during the build happen on the project page and can only raise the cap further." Functional unchanged.

`apps/factory-web/src/pages/questions/detail.astro` — no structural change (still handles non-budget askUsers).

### 15.12 — Phase close

Standard gates + live browser smoke gates (3 scenarios per spec §8.6):

1. Parked-directive flow: low cap → exhaustion → manual raise → auto-resume within ≤250 ms.
2. Auto-increase flow: toggle on + ceiling 3× → silent bumps until ceiling reached → park.
3. Multi-class isolation: scaffolder exhaustion doesn't affect builder/fixer pools.

ROADMAP/STATE recordkeeping; `phase-15-budget-ux-overhaul-closed` tag annotated at the last work commit per Phase 12/13/14 convention.

## Done criteria

- [ ] All four `pnpm` gates green (build / test / lint / format:check) across all 15 packages
- [ ] ADR 0034 lands; ADR 0032 marked `Superseded by ADR 0034` (Status line edit only); ADR 0030 amendment block dated; ADR 0020 cross-ref amendment dated
- [ ] `packages/brain/src/budget-escalation.ts` deleted; companion test deleted; no remaining importers (grep clean for `BUDGET_ESCALATION_MARKER`, `parseBudgetEscalationAnswer`, `BUMP_BUCKETS`, `escalateBudgetTrip`, `escalateMaxUsdPerTaskTrip`)
- [ ] `[BUDGET]` branch removed from `auto-answer.ts`; `[CRITIC]` regression test still passes
- [ ] Pool consumer lives in `pool.ts` + `pool-usage.ts` + `pool-resume.ts` with full test coverage (~30 tests across the three files)
- [ ] New `GET /api/v1/directives/:id/pool-usage` route returns correct shape; SSE `pool.tally` events emit on task-completion and on `bumpProjectCap` writes
- [ ] `PUT /api/v1/projects/:id/budget-defaults` accepts all 8 axes + `autoIncreaseBudgets` + `autoIncreaseCeilingMultiplier`
- [ ] Project detail page renders 4 tabs (Live default, Defaults, History, Settings); Live tab shows bar treatment + click-to-expand drill-down; parked-alert banner appears when in-flight directive is parked
- [ ] Auto-increase toggle actually bumps on exhaustion, respects ceiling multiplier, parks at `default × multiplier`
- [ ] Live re-resolve verified: edit `project.json` out-of-band, watch in-flight directive's cap update on next pool-check tick
- [ ] Browser smoke #1 (parked → raise → auto-resume) verified
- [ ] Workspace test count ≥ 1450 passing (target 1454, from current 1388)
- [ ] U036 + U037 moved to Resolved; U038 stays in Open as a Tier-16+ candidate

## Rollback

Per Phase 12/13/14 convention: not a "revert all commits" operation. Roll back individual sub-step commits if a regression surfaces post-close. Most likely rollback target: the deletion of `budget-escalation.ts` (15.8) if pool dispatcher (15.7) shows latent bugs not caught by unit tests — restoring the file from git history is mechanical, but the `pool.ts` dispatcher needs to be reverted in lockstep.

Backward-compat note: in-flight directives at deploy time would crash because the new pool dispatcher doesn't recognize the old per-task `task.maxTurns` semantic. Mitigation: operator deploys with `daemon stop` (standing practice per Phase 12 retro). Documented in the phase-15 README.

## Risks and decisions

- **chokidar watcher scope.** Lazy-add on first directive creation per project, tear down when no directives remain. Alternative: watch every project on daemon start. Lazy chosen to keep daemon startup time bounded. (Spec §10 open question — resolved here.)
- **`pool.tally` SSE event cadence.** Emit after every task-completion + every `bumpProjectCap` write. Don't emit on every worker turn-tick (too noisy); the worker watchdog computes the pool locally for its interrupt decision. Live tab listens for the existing `task.*` SSE events too, so progress within a single task is still visible via task-table updates.
- **`computePoolUsage` consistency under concurrent task writes.** Read uses a single SQL transaction; aggregation reflects a consistent point-in-time view. Race: a task could complete between the brain's pool check and the SSE emit, so the operator briefly sees `n` tasks contributing while the underlying total is `n+1` turns. Acceptable — corrects on next tick. Not worth a serialized writer queue.
- **Auto-increase + per-build floor interaction.** Auto-increase writes ONLY to `project.json`, never to `payload.budgets`. So per-build floor stays static for the directive's lifetime; the project-level cap rises to match. When auto-increase + per-build floor are both present, the per-build floor wins until project edits push above it. The `max(...)` rule handles this cleanly.
- **CLI `factory resume` budget flags.** Survive removal of `factory build` flags? Per spec §11: the resume path now writes to `project.json` (consistent with live re-resolve). To be confirmed during 15.7 implementation — there's no test coverage for the existing resume budget-flag behavior, so the change is low-risk.
- **Tab persistence default.** localStorage-backed. Spec §11 open question resolved.
- **`computePoolUsage` cache invalidation.** SSE event pushes diffs; client re-fetches GET endpoint only on initial mount + reconnect (not after every task-completion). Spec §11 open question resolved.
- **Settings tab default on first project creation.** Auto-increase unchecked by default; conservative. Spec §11 open question resolved.
