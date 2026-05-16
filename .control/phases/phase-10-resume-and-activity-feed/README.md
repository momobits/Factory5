# Phase 10 — resume-and-activity-feed

**Dependencies:** Phase 9 closed (`phase-9-control-room-redesign-closed` at `9e8ee5c`)
**Estimated duration:** ~2 sessions
**Status:** scaffolded

## Goal

Close two operator-feels-blind gaps on the Control Room dashboard: (1) no way to resume a failed/blocked directive from the web UI; (2) directive-detail's activity panel is silent because the brain only emits one `log.line` SSE event today.

## Outcome

- `POST /api/v1/directives/:id/resume` exists; the web UI's directive-detail page renders a **Resume** button on terminal directives and the Projects index gains a per-row resume link.
- The directive-detail activity panel narrates brain stages live: triage → architect (start / wiki written / readiness) → planner (start / plan written or parse-fail with first 500 chars) → tasks pool → assessor → terminal. Schema-parse failures that crash silently today show up on the timeline as red `error` lines with diagnostic detail.
- ADR 0031 pins the log-forwarder design choice (manual `emitLogLine` sites vs Pino transport tap), with manual sites as the first-ship and a hybrid auto-tap as Tier 11+ candidate.

Full plan: [`../../../UPGRADE/plans/tier-10-resume-and-activity-feed.md`](../../../UPGRADE/plans/tier-10-resume-and-activity-feed.md).

## Where we were, end of Phase 9

Phase 9 closed at `phase-9-control-room-redesign-closed` 2026-05-15 — the editorial Control Room redesign. Upgrade arc parked for the sixth time. Tier 10 reopens the arc for an operator-felt pair of gaps surfaced by an `automl` build that crashed at the planner schema-parse step (`01KRQ1RPE5SM6Q8AYSRHHAPG39`, 2026-05-16): the operator couldn't see the failure narrative in the UI, and had no UI surface to resume.

The SSE plumbing this tier consumes already exists from Phase 3 (ADR 0029 — `directive-stream-protocol`): six event types schema'd in `packages/ipc/src/sse.ts`, the daemon mounts `GET /api/v1/directives/:id/stream`, the directive-detail page subscribes via `apiStream`. Only the *emission* side is sparse — the brain calls `emitLogLine` from one site today (`packages/brain/src/loop.ts:258`, chat reply rendering).

The resume CLI command exists from Phase 1 at `packages/cli/src/commands/resume.ts`; the daemon route is a thin HTTP wrapper around the same logic.

## Why this phase exists

Two failure modes the operator hit firsthand on 2026-05-16:

1. **"How do I resume from the UI?"** — opening the dashboard from a phone after the `automl` directive failed, no recovery action available except walking to a terminal.
2. **"What is the brain actually doing?"** — the `automl` directive sat in `running` for ~14 minutes (architect ~3min, planner ~10min) before flipping to `failed` with no narrative in the UI. The wiki-readiness `modules-documented` warn fired correctly in the daemon log but never reached the dashboard.

Both are infrastructure-already-in-place problems. Tier 10 closes the loop.

Issues addressed: U030 (to be opened in 10.1).

## Steps

See [`steps.md`](steps.md).

## Done criteria

All must be verified before `/phase-close` advances:

- [ ] All items in `steps.md` checked off, each with a commit reference
- [ ] `.control/issues/OPEN/` contains no items tagged `phase:10-blocker`
- [ ] `pnpm build` clean
- [ ] `pnpm test` clean
- [ ] `pnpm lint` clean
- [ ] `pnpm format:check` clean
- [ ] ADR 0031 (log-forwarder design) lands; INDEX.md updated
- [ ] `emitLogLine` fires at every site in the plan's 10.3 table; `loop.test.ts` asserts happy-path emissions
- [ ] Regression test: malformed planner LLM output → `error`-level `log.line` event with first 500 chars in `attrs.detail`
- [ ] `POST /api/v1/directives/:id/resume` integration test green (mints child directive with `parentDirectiveId` + `payload.resumeFrom` set)
- [ ] Browser smoke (Playwright MCP): resume button on the `automl` failed directive mints a child that re-enters the planner (architect skipped — wiki on disk)
- [ ] Browser smoke: activity panel narrates a fresh build (triage → architect → planner → tasks → terminal)
- [ ] Activity panel renders the planner Zod error visibly when reproduced
- [ ] U030 closes in `UPGRADE/ISSUES.md`
- [ ] Working tree clean; phase will be tagged `phase-10-resume-and-activity-feed-closed`

## Rollback plan

`git reset --hard phase-9-control-room-redesign-closed` then force-push if applicable. No DB schema changes — no migrations to undo.

## ADRs decided in this phase

- ADR 0031 — log-forwarder design (to be authored in 10.2)

## Deferred to Phase 11 (or later)

- **Pino transport tap** — auto-mirror brain pino lines with `directiveId` binding to SSE. ADR 0031 will pin manual emit sites as first-ship; the auto-tap is the natural follow-up if maintenance overhead grows.
- **Per-directive log persistence** — `log.line` events are SSE-only (ephemeral). Operator opening directive-detail after the directive completes sees an empty activity panel. Needs `directive_log_lines` table + `GET /api/v1/directives/:id/logs` replay endpoint.
- **Resume-after-edit** — let the operator edit the prior directive's payload (autonomy, budget) before resuming. Today both CLI and the new UI route inherit verbatim.
- **Bulk resume / replay** — pick N failed directives, resume all. Defer until operator hits this pain.
- **Wiki readiness `checkModules` refinement** — accept `# Modules` h1 on a dedicated `modules.md` page (today only `## Modules` h2 or `modules/` dir matches). Self-contained ~5-line fix; advisory not load-bearing ("continuing anyway in Phase 1").
