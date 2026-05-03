# Project State

> Single source of truth. Read this first every session. Updated at every
> `/session-end` and by the `PreCompact` hook. Every field has a purpose -- fill each.

**Last updated:** 2026-05-03 18:30 UTC by `/session-end` (post step 3.6 — cancel button on directive detail; pause deferred per Decision 2 = option C)
**Current phase:** 3 — web-ui
**Current step:** 3.7 — `/app/projects/new` (next; step 3.6 closed this session)
**Status:** ready (clean working tree; 3.6 shipped across 1 step commit + 1 close commit, plus a session-opening drift-reconcile and a 3.1b deferred-work commit; all four pnpm gates green at every commit)

---

## Project spec

**Canonical:** `.control/SPEC.md` (v2.0 single-file layout)
**Evolution:** `git log .control/SPEC.md` (and the `## Artifacts (chronological)` section in SPEC.md, populated by `/spec-amend <slug>`)
**Role:** Source of truth for project content. When distilled docs (phase-plan, phase READMEs) disagree with the spec, the spec wins. Newer artifacts in SPEC.md's `## Artifacts` section win over conflicting content in the canonical sections above.

---

## Next action

Open [`../phases/phase-3-web-ui/steps.md`](../phases/phase-3-web-ui/steps.md). Step **3.7 = `/app/projects/new` — mirror of `factory init <project>` for a single project** per [`../../UPGRADE/plans/tier-3-web-ui-live-and-complete.md`](../../UPGRADE/plans/tier-3-web-ui-live-and-complete.md) §3.7. Form mirrors `factory init`'s flags (language picker, optional `CLAUDE.md` upload, `--max-usd` / `--max-steps` budgets). On submit, scaffold the project via the existing init path; the new project shows up in `/app/projects` and is kickoff-able from `/app/build`. File pointers: new page at `apps/factory-web/src/pages/projects/new.astro` (modeled on `apps/factory-web/src/pages/build.astro`'s `<Form>` + `<Field>` + `<Submit>` shape from 3.4 commit `58d4584`); reuse the daemon's existing project-init route or add a new `POST /api/v1/projects` route gated by `requireUiAuth` (mirrors the 3.6 cancel-route pattern in `packages/daemon/src/server.ts`). Acceptance: form submit creates `<workspace>/<project>/.factory/project.json` end-to-end, project appears at `/app/projects`, and a follow-up build directive succeeds against it. Frontend-design skill required before authoring per saved feedback. Before starting 3.7, consider whether to slot the **operator-pinned live-smoke** in first — it covers 3.6 acceptance + the chat page + ADR 0029 promotion gate in one factoryd-up window (see "3.x backlog" below).

---

## Git state

- **Branch:** main
- **Last commit:** `0f5775a` — refactor(3.6): close step 3.6 — cancel-only; pause + 3.x follow-ups deferred
- **Uncommitted changes:** none (working tree clean)
- **Last phase tag:** `phase-2-channel-parity-closed` (annotated tag at commit `081b832`)

---

## Open blockers

- None

---

## In-flight work

None. Step 3.6 closed cleanly across 2 step commits (`01686e1` cancel button impl + `0f5775a` close-and-flip), preceded by a session-opening drift-reconcile (`288603e`) and a 3.1b deferred-work commit (`f990323`); all four `pnpm` gates green at every commit. Three deferred items remain on the 3.x backlog rather than as in-flight work — same shape as last session, with one item (`finding.created` emission) flipped to done:

- **`<PageShell>` adoption + Dashboard `<style is:global>` migration** — 11-page structural sweep with no acceptance dependency from any 3.x step. Was queued for autonomous landing this session but stopped before commit: the migration touches all 11 pages plus the `Dashboard.astro` layout, with high visual-regression surface that an autonomous gate-only run can't verify (no browser harness in `factory-web`). Right venue is a focused session where the operator can spot-check pages in a browser as they convert. Documented under phase-3-web-ui/steps.md "Deferred follow-ups".
- **Pause primitive on directive detail** — Decision 2 = option C means pause stays deferred until a workflow signal demands it. When that lands, choose between Option A (extend `directivesQ.status` with `paused`/resume + brain claim-loop skip + 2 routes + 2 buttons) and Option B (reuse `markBlocked` with `blockedReason: 'paused-by-operator'`). Documented under phase-3-web-ui/steps.md "Deferred follow-ups".
- **Pre-3.5 baseline live-smoke against running factoryd** — gates ADR 0029 promotion. The 3.6 cancel acceptance smoke covers the detail-page condition (real factoryd + real browser + real SSE during a real build); chat page is a 30-second click-test laid on top. Pin as part of phase-3 acceptance. Not a 3.7 blocker.

---

## Test / eval status

- **Last test run:** 2026-05-03 — full workspace passes, all four `pnpm` gates green: build / test / lint / format:check. Per-package counts after 3.6: state 152, channels 175, daemon **167** (+6 from new `/api/v1/directives/:id/cancel` route tests covering 401/503/happy-path/404/409/legacy-CLI-parity), brain **101** (+4 from `pool.test.ts` covering `emitFindingCreated`), worker 38, worker-sandbox 86 (+ 3 skipped Windows/Linux branches), assessor 79, wiki 64, cli 82, providers 39, ipc 28, events 3, worker-mcp 15, core 14, logger 20. Workspace total +10 vs the prior session's baseline. `factory-web` still has no vitest harness — `detail.astro`'s cancel button is integration-tested only by the daemon route tests + manual smoke.
- **Eval score** (agent phases only): n/a
- **Regression tests:** unit + integration only; no eval harness

---

## Recent decisions (last 3 ADRs)

- ADR 0028 — worker-sandbox-contract (per-spawn fs scoping; three Claude-Code-native primitives layered per-spawn)
- ADR 0027 — web-ui-mutation-surface (`POST /api/v1/builds`, `POST /api/v1/pending-questions/:id/answer`, `PUT /api/v1/projects/:id/budget`)
- ADR 0026 — pluggable-runtime-contract (assessor pluggable across Python / Node / Go / Rust; env-owning vs env-assuming provisioner; failure-mode taxonomy)

Step 3.6 did not promote new ADRs. **ADR 0029 — directive-stream protocol** is now one operator-driven smoke away from promotion: with the 3.1b `finding.created` emission this session, all 5 directive-stream event types flow end-to-end (`task.started`, `task.completed`, `finding.created`, `spend.updated`, `log.line` → `directive.completed`); both detail-page and chat-page consumers are wired; the only remaining gate is "kick off a real build, click cancel from `/app/directives/detail`, click-test `/app/chat`, observe all 5 event types." Promote ADR 0029 immediately after that smoke is recorded.

---

## Recently completed (last 5 steps)

- Step 3.6 closing — `refactor(3.6)`: close step 3.6 — cancel-only; pause + 3.x follow-ups deferred (flips `[ ] 3.6` → `[x] 3.6` in phase-3-web-ui/steps.md and UPGRADE/ROADMAP.md; rewrites the 3.6 line to "cancel-only" wording per Decision 2 = option C; adds a "Deferred follow-ups" section to steps.md with three explicit `- [ ]` bullets for pause primitive, PageShell + Dashboard global migration, and pre-3.5 baseline live-smoke). — 2026-05-03 — `0f5775a`
- Step 3.6 detail — `feat(3.6)`: cancel button on directive detail (Decision 1 = option a + Decision 2 = option C; new `POST /api/v1/directives/:id/cancel` route in `packages/daemon/src/server.ts` gated by `requireUiAuth`, sharing one closure-scoped `handleCancel` with the existing `/directives/:id/cancel` CLI path; FE button in `apps/factory-web/src/pages/directives/detail.astro` visible-when-`running`/`pending`-or-cancel-in-flight, click disables and morphs to "Cancelling" with blinking trailing dot echoing live-pip-blink, ApiError handling distinguishes ALREADY_TERMINAL/UI_AUTH_REQUIRED/UI_DISABLED inline; +6 daemon route tests covering 401/503/happy-path-with-abort/404/409/legacy-CLI-parity; daemon test count 161 → 167). Frontend-design skill invoked before authoring per saved feedback. — 2026-05-03 — `01686e1`
- Step 3.1b deferred — `feat(3.1b)`: emit finding.created from brain pool (5th of 5 directive-stream events spec'd by ADR 0029 + 3.1's `findingCreatedEventSchema`; brain emission was deferred when 3.1 shipped the schema + SSE route — FE has been refreshing findings on `task.completed` as a stand-in. New `emitFindingCreated` synchronous helper in `packages/brain/src/pool.ts`; caller does one `listFindings(plan.projectPath)` per task to feed every emit, avoiding N+1 disk reads; emission happens after `task.completed` so subscribers see completion first then findings; wrapped in try/catch so a corrupt findings.json never fails the task. +4 unit tests in `pool.test.ts` mirror `loop.test.ts` shape: emitter-undefined-silent, well-formed-event-with-advisory-false-default, advisory-true-pass-through, one-event-per-call. Brain test count 97 → 101). — 2026-05-03 — `f990323`
- Drift reconcile — `docs(state)`: reconcile commit cursor after session-end (operator chose option (a) at session-start: STATE.md "Last commit" caught up from `2dfd25f` to HEAD's `96f5883` session-end docs commit; "Current step" narrowed from "cancel + pause" to "cancel button" per Decision 2 = option C; "Recently completed" prepended with the session-end docs commit and the dropped 6th item moved to a footnote — fifth occurrence of the post-session-end self-reference drift the runbook accepts). — 2026-05-03 — `288603e`
- Session-end docs (prior session) — `docs(state)`: session end for step 3.5. Captures the 3.5 close cursor in STATE.md / journal.md / UPGRADE/LOG.md / next.md; no code changes. — 2026-05-03 — `96f5883`

---

## Attempts that didn't work (current step only)

- None yet — Step 3.7 not started. (3.6 had no dead-ends; the cancel-route auth design call was resolved at session-start before any code, so no rollback or rework happened mid-step.)

---

## Environment snapshot

- **Language / runtime:** TypeScript on Node 20+ (currently running Node 22.22.2)
- **Key pinned deps:** pnpm 9.12.0, tsup 8.5.1, vitest 2.1.9, prettier 3.8.3, eslint 9.39.4, better-sqlite3 (workspace), discord.js v14, grammy, fastify (workspace), Astro 5.x
- **Model in use:** Claude Code (claude-opus-4-7[1m])
- **Other:** Windows Server 2025 host

---

## Notes for next session

Step 3.7 is the `/app/projects/new` page — browser mirror of `factory init <project>`. Per [`../phases/phase-3-web-ui/steps.md`](../phases/phase-3-web-ui/steps.md) line 9 and [`../../UPGRADE/plans/tier-3-web-ui-live-and-complete.md`](../../UPGRADE/plans/tier-3-web-ui-live-and-complete.md) §3.7.

**Two design decisions to resolve before code, in order:**

1. **Live-smoke first?** All five SSE event types now flow end-to-end (3.1b shipped `finding.created` emission this session); both detail-page and chat-page consumers are wired; 3.6's cancel button needs a single live-smoke against a running factoryd to close acceptance. The smoke also unblocks ADR 0029 promotion. Doing it before 3.7 means 3.7 is built on a verified base; doing it after means a longer rollback path if the smoke surfaces a wire issue. **Recommendation:** smoke first — kick off `factory build <project>`, open `/app/directives/detail?id=<id>`, click cancel, watch worker terminate; click-test `/app/chat` in the same window. ~5 minutes of operator time. If clean: promote ADR 0029, then start 3.7. If issues surface: fix before 3.7.

2. **3.7 form-submit route — reuse or add?** The existing daemon may already have a project-init route (used by the CLI's `factory init`); if so, the FE can call it directly. If not, a new `POST /api/v1/projects` route gated by `requireUiAuth` mirrors the 3.6 cancel pattern (one shared handler, two route prefixes — CLI-facing + SPA-facing). Grep `packages/daemon/src/server.ts` and `packages/cli/src/commands/init.ts` to confirm before designing. The pattern is the same as 3.6's: extract a closure-scoped helper, register it under both prefixes when the CLI hits it via HTTP, register it under just `/api/v1/*` if the CLI uses a non-HTTP path.

**File pointers for 3.7:**

- New page: `apps/factory-web/src/pages/projects/new.astro` — modeled on `apps/factory-web/src/pages/build.astro`'s `<Form>` + `<Field>` + `<Submit>` shape (3.4 commit `58d4584`). Fields: project name (required), language picker (`python` / `node` / `go` / `rust` / `(use server default)`), optional `CLAUDE.md` textarea, optional `--max-usd` / `--max-steps` numeric inputs. On submit: `apiPost('/api/v1/projects', ...)`, redirect to `/app/projects/detail?id=<new-id>` on success or surface inline `<Alert kind="conflict">` on failure (same hidden-Alert-placeholder pattern used by build.astro).
- Form schema: `packages/ipc/src/schemas.ts` — add `apiV1CreateProjectRequestSchema` + `apiV1CreateProjectResponseSchema`. Mirror the existing `apiV1CreateBuildRequestSchema` shape.
- Daemon route: `packages/daemon/src/server.ts` — new `POST /api/v1/projects` (and possibly `/projects` for CLI parity). The handler delegates to whatever `factory init` runs server-side today (likely a function in `@factory5/wiki` or `@factory5/state`).
- CLI parity check: `packages/cli/src/commands/init.ts` — confirm whether init goes through HTTP or DB-direct, mirroring how the 3.6 cancel-route audit confirmed CLI cancel uses HTTP via `cancelDirective` daemon-client.
- Frontend-design skill required before authoring per saved feedback.

**Acceptance:** form submit at `/app/projects/new` creates `<workspace>/<project>/.factory/project.json` and the matching DB row; the project appears in `/app/projects`; a follow-up build directive at `/app/build` succeeds against the new project end-to-end (live-smoke against a real factoryd).

**3.x backlog still open (no 3.7 acceptance dependency, in `phase-3-web-ui/steps.md` "Deferred follow-ups"):**

- **PageShell + Dashboard `<style is:global>` migration** — 11-page structural sweep. **Land in a session where you can spot-check pages in a browser as they convert** — autonomous-only is the wrong fit because the layout's scoped-CSS rules (`.cards`, `.empty`, `.err`, `.btn*`, `.alert*`, `.form-*`, table-base) are currently inert against slot content; flipping to global will start applying them, which can shift layouts the component-level scoped CSS isn't compensating for. Self-contained ~1 commit when run by hand.
- **Pause primitive** — design when a workflow signal demands it. Option A (status-enum extension) vs Option B (`markBlocked` reuse) vs longer-term-defer.
- **Pre-3.5 baseline live-smoke against running factoryd** — gates ADR 0029 promotion. Combined with the 3.6 cancel acceptance smoke into one factoryd-up window per Decision 1's recommendation above.

**Loose ends from prior sessions (still open; not blocking 3.7):**

- Synthetic smoke directive in DB (`01KQPDMQE6QTQZ3QMDD69019YK`, status=failed/cancelled) plus a synthetic project (`demo-project`) and its linked directive. Reap with `cd packages/state && node smoke-cleanup.mjs` if you want a clean `factory status`.
- factoryd PID 32436 from prior session may still be running. `factory daemon stop` shuts it down.

Read [`../../UPGRADE/LOG.md`](../../UPGRADE/LOG.md) for the upgrade-side narrative across sessions; this STATE.md is the operational cursor (overwritten at each `/session-end`).
