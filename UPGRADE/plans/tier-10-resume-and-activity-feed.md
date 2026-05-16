# Tier 10 — Resume button + activity feed on directive detail

**Status:** scaffolded, not started
**Estimated duration:** 2 sessions
**Issues addressed:** new (U030 — resume button + activity feed)

## Goal

Two operator surfaces are missing on the Control Room:

1. **No way to resume a failed/blocked directive from the web UI.** `factory resume <project>` exists as a CLI command (`packages/cli/src/commands/resume.ts`) that reuses the architect's wiki output and re-runs the planner. There's no daemon HTTP equivalent, so the web UI can't surface it. Operators have to drop to a terminal — including when they're answering channel messages from a phone with no terminal access.
2. **Directive-detail has no narrative.** The page shows the task table + spend + open questions + a log-tail panel, but the log tail is wired to the SSE `log.line` event which the brain only emits from one site today (`packages/brain/src/loop.ts:258`, chat reply rendering). For a `build` directive, the operator sees the task table populate but no narrative of _what stage the brain is in_. When the planner crashed on `automl` `01KRQ1RPE5SM6Q8AYSRHHAPG39` after a 10-minute Sonnet call, nothing surfaced in the UI — the directive simply flipped from `running` to `failed`.

Tier 10 ships both: a `POST /api/v1/directives/:id/resume` daemon route + UI buttons on directive-detail and the projects index, plus broader `emitLogLine` coverage from the brain so the activity panel renders a real timeline (architect start → wiki written → readiness checks → planner start → planner result / error → tasks dispatched).

## Outcome

- Operator viewing a failed directive in the dashboard (e.g. `/app/directives/detail?id=01KRQ1RPE5SM6Q8AYSRHHAPG39`) sees a **Resume** button next to Cancel; one click mints a child directive that re-enters the brain with `parentDirectiveId` + `payload.resumeFrom` set, skipping the architect when the wiki is on disk.
- Same button surfaces on the Projects index row (per row, "Resume last build") when the project's most recent directive is in a terminal non-`complete` state.
- The activity panel on directive-detail shows a live timeline of brain stages: `brain.triage`, `brain.architect started → wiki written (N pages) → readiness checked`, `brain.planner started → plan written (M tasks)` / `planner: Zod parse failed: …`, `brain.pool: task X started/finished`, `brain.assessor: ran (build=ok integration=ok verify=fail)`, etc.
- Schema-validation errors that today crash silently on the operator (planner's `tasks Required`, similar) surface on the timeline as a red error line with the first 500 chars of the offending LLM output, matching the existing helpful-error pattern at `planner.ts:331`.
- ADR 0031 pins the log-forwarder design choice (explicit `emitLogLine` sites vs Pino transport tap) so future agents add narrative consistently.

## Where we were, end of Phase 9

Phase 9 closed at `phase-9-control-room-redesign-closed` 2026-05-15 — the Control Room redesign. Upgrade arc parked for the sixth time. The factoryd / brain SSE plumbing for `log.line` events shipped in **Phase 3** (ADR 0029, `directive-stream-protocol`); the directive-detail page consumes it; only the _emission_ side is sparse. The resume CLI command shipped in **Phase 1** and has been working through five subsequent tier-closes without an HTTP surface.

The user-felt incident that drove this tier: an `automl` build directive crashed at the planner-JSON-parse step after a 10-minute Sonnet call. The wiki-readiness `modules-documented` warn fired correctly (the architect wrote a top-level `modules.md` with `# Modules` h1 — the gate's regex requires `## Modules` h2 or a `modules/` directory; both are over-literal). The operator saw the warn and thought it was the cause; the real cause was downstream and silent in the UI.

## Why this phase exists

Two failure modes the operator has now hit firsthand:

1. **"How do I resume from the UI?"** — opening the dashboard from a phone after Discord pings about a failed directive, the operator has no recovery action available except to walk to a terminal.
2. **"What is the brain actually doing?"** — a build directive in `running` state can be doing anything from the architect's Opus call (~3 min) to the planner's Sonnet call (~10 min) to a tasks-pool dispatch. With no narrative, the operator can't tell whether the brain is stuck, the LLM is being slow, or the build has silently crashed.

Both are operator-feels-blind problems. Both have the infrastructure already in place (resume.ts on the CLI side, SSE `log.line` schema in IPC) — Tier 10 closes the loop.

## What this tier ships

### 10.2 — ADR 0031: log-forwarder design

Pin the choice between:

- **Manual emit sites** (recommended): `emitLogLine(emit, directiveId, level, component, msg, attrs?)` called explicitly at narrative breakpoints in `architect.ts`, `planner.ts`, `pool.ts`, `loop.ts`. Pros: exactly what we want surfaces, nothing more; no overhead on non-directive logs; testable per site. Cons: requires authors to remember.
- **Pino transport tap**: child logger with `directiveId` binding auto-mirrors every line where that binding is set. Pros: zero-touch; covers anything anyone logs. Cons: every internal `log.debug` would surface to the operator; some pino fields (stack traces, large objects) bloat the SSE stream; harder to throttle.
- **Hybrid**: manual sites for first-ship, pino-tap as a Tier 11 follow-up if the manual-emit overhead becomes painful.

ADR 0031 recommends manual sites with a guardrail: at least one explicit `emitLogLine` per brain stage entry + exit + error path. The ADR also pins the **error-line shape** — `level: 'error'`, `component: 'brain.<stage>'`, `msg` is the human-readable summary, `attrs.detail` carries the first 500 chars of any offending LLM response.

### 10.3 — Brain emit sites for narrative

Add `emitLogLine` calls at these sites in the brain:

| File                   | Site                        | level            | msg shape                                                                  |
| ---------------------- | --------------------------- | ---------------- | -------------------------------------------------------------------------- |
| `loop.ts` (triage)     | after triage classification | `info`           | `triage → intent=<X> confidence=<Y>`                                       |
| `architect.ts`         | start                       | `info`           | `architect: calling <model>`                                               |
| `architect.ts`         | wiki written                | `info`           | `architect: wrote <N> wiki pages`                                          |
| `architect.ts`         | readiness                   | `info` or `warn` | `wiki readiness: <ok\|failed: <ids>>`                                      |
| `planner.ts`           | start                       | `info`           | `planner: calling <model>`                                                 |
| `planner.ts`           | parse fail (`:331`)         | `error`          | `planner: no JSON in response`; attrs include first 500 chars              |
| `planner.ts`           | Zod fail (`:335`)           | `error`          | `planner: schema parse failed`; attrs include Zod issues                   |
| `planner.ts`           | plan written                | `info`           | `planner: <N> tasks queued`                                                |
| `pool.ts`              | task dispatched             | `info`           | `pool: task <id> (<agent>) started` (parallel to `task.started` SSE event) |
| `pool.ts`              | task error                  | `error`          | `pool: task <id> failed: <reason>`                                         |
| `assessor invocation`  | start + end                 | `info`           | `assessor: build=<x> integration=<y> verify=<z>`                           |
| `loop.ts` finalisation | terminal                    | `info`           | `brain: directive <status>`                                                |

The exact list is the floor; authors can add more where useful. Tests in `loop.test.ts` extend to assert these emit sites fire on the happy path; one regression test feeds `planner.ts` a deliberately malformed Sonnet output to assert the error-line surfaces with the first 500 chars.

### 10.4 — Daemon `POST /api/v1/directives/:id/resume`

New route in `packages/daemon/src/server.ts`. Body: `{ autonomy?: 'assisted' | 'autonomous' }` (defaults to the prior directive's autonomy). Behaviour:

1. Look up the prior directive via `directivesQ.getById(opts.db, id)`. 404 if not found.
2. Extract `projectPath`, `projectId`, `language` from the prior payload (same logic as `packages/cli/src/commands/resume.ts:33-139`).
3. Build the child directive with `parentDirectiveId: prior.id` and `payload.resumeFrom: prior.id`, status `pending`, intent `build`.
4. Insert via `directivesQ.insert`; emit `doorbell.emit('directive.new', ...)` so the brain's serve loop picks it up.
5. Respond with the newly-created directive shape (same as `POST /api/v1/builds`).

Reuses the bearer-auth + Zod-validated body pattern from `/api/v1/builds`. Adds `apiV1ResumeRequestSchema` + `apiV1ResumeResponseSchema` to `packages/ipc/src/`. New test in `packages/daemon/test/` that minted a prior directive, POSTs to `/resume`, asserts child directive shape + `parentDirectiveId` chain.

**Refuses to resume when:**

- Prior directive doesn't exist (404 `NOT_FOUND`).
- Prior directive is currently `running` or `pending` (409 `CONFLICT` — operator should cancel first).
- Prior directive's `projectPath` no longer exists on disk (422 `PROJECT_NOT_FOUND`).

### 10.5 — UI: Resume button on directive-detail + Projects row

`apps/factory-web/src/pages/directives/detail.astro`:

- When `effectiveStatus()` returns `failed` / `blocked` / `complete`, render a `Resume` button next to the title row (parallel to the existing `Cancel` for `running` / `pending`).
- On click: POST to `/api/v1/directives/<id>/resume`; on 2xx, navigate to `/app/directives/detail?id=<new-id>`.
- Mirror the `cancelInflight` / `cancelError` UX shape — disabled-while-inflight, inline error on failure.
- `resume` state added to `PageState`; rendered above the title row when inline error needed.

`apps/factory-web/src/pages/projects/index.astro`:

- For each project row, add a "Resume" link after the workspace path. Visible only when the project's most recent directive's status is `failed | blocked | complete`. Clicking POSTs to the resume endpoint with the most-recent directive's id, then navigates to the new directive's detail page.

### 10.6 — UI: activity panel rendering refinements

The existing log-tail panel on directive-detail already renders `log.line` events. Light refinements:

- **Level badges** — small pill next to `component`: `info` neutral, `warn` amber, `error` red. Maps to the existing dark/light token system.
- **Component grouping (optional)** — collapse consecutive same-component lines under one expandable header. Defer if scope creeps.
- **Auto-scroll pin** — already implemented (the "Resume tailing" button at `:385`). No new work.
- **Empty state** — when zero `log.line` events have arrived but the directive is `running`, render "Waiting for the brain to narrate…" instead of nothing. Beats a blank panel.

### 10.7 — Phase close

Standard gates: `pnpm build / test / lint / format:check`. Browser smoke: re-run an `automl` build via the new Resume button on the failed directive, confirm the activity panel narrates architect / planner stages.

## Done criteria

- [ ] All four `pnpm` gates clean
- [ ] ADR 0031 (log-forwarder design) lands and INDEX.md updated
- [ ] `emitLogLine` fires at every site in the 10.3 table; loop.test.ts asserts the happy-path emissions
- [ ] Regression test: malformed planner output → `error`-level `log.line` event with first 500 chars in attrs
- [ ] `POST /api/v1/directives/:id/resume` integration test green (mints child directive with correct parent chain)
- [ ] Browser smoke: resume button on `automl` `01KRQ1RPE5SM6Q8AYSRHHAPG39` mints child directive that re-enters the planner (architect skipped — wiki on disk)
- [ ] Browser smoke: activity panel shows narrative on a fresh build (triage → architect → planner → tasks → terminal)
- [ ] Activity panel renders the planner Zod error visibly when reproduced
- [ ] U030 closes in `UPGRADE/ISSUES.md`

## Rollback

`git checkout -- apps/factory-web/src/pages/directives/detail.astro apps/factory-web/src/pages/projects/index.astro packages/daemon/src/server.ts packages/brain/src/{architect,planner,pool,loop}.ts packages/ipc/src/` reverts the surface changes. ADR 0031 supersession requires a new ADR per CLAUDE.md "do not edit accepted ADRs". No DB schema changes; no migrations to roll back.

## Carry-forward (Tier 11 candidates)

- **Pino transport tap** — auto-mirror brain pino lines with `directiveId` binding to SSE. Tier 11 candidate per ADR 0031's "alternatives". Defer-until-signal that manual emit sites are becoming painful to maintain.
- **Per-directive log persistence** — today `log.line` events are SSE-only (ephemeral). If an operator opens directive-detail after the directive completes, the activity panel is empty. Tier 11 candidate: persist `log.line` events to a `directive_log_lines` table and serve via `GET /api/v1/directives/:id/logs` for replay. Requires migration.
- **Resume-after-edit** — let the operator edit the prior directive's payload (autonomy, budget) before resuming. Today both CLI and the new UI route inherit verbatim.
- **Bulk resume / replay** — pick N failed directives, resume all of them. Defer until the operator hits this pain.
- **Wiki readiness gate refinement** — `checkModules` (`packages/wiki/src/readiness.ts:74`) accepts `## Modules` h2 or `modules/` dir but NOT `# Modules` h1 on a dedicated page. False-negative when the architect writes a top-level `modules.md` (the `automl` case). Self-contained ~5-line fix; not load-bearing — the gate is advisory ("continuing anyway in Phase 1").

## Suggested commit shape

- `chore(phase-10): scaffold tier 10 resume + activity feed`
- `chore(10.1): open U030`
- `docs(10.2): ADR 0031 — log-forwarder design`
- `feat(10.3): brain emitLogLine narrative sites`
- `feat(10.4): POST /api/v1/directives/:id/resume`
- `feat(10.5): UI resume button + project-row resume link`
- `feat(10.6): UI activity panel level badges + empty state`
- `chore(phase-10): close phase 10`
