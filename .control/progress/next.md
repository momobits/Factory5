# Next session kickoff

> Auto-generated from `.control/progress/STATE.md` at 2026-05-05T16:59:32Z by
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

Open [`../phases/phase-3-web-ui/steps.md`](../phases/phase-3-web-ui/steps.md). Step **3.7 = `/app/projects/new` — mirror of `factory init <project>` for a single project** per [`../../UPGRADE/plans/tier-3-web-ui-live-and-complete.md`](../../UPGRADE/plans/tier-3-web-ui-live-and-complete.md) §3.7. **Decision 2 from last session is locked in: Option A — extract `createProject(workspace, name, language) → { id, path }` into `@factory5/wiki`, then add `POST /api/v1/projects` route gated by `requireUiAuth` (mirrors 3.6 cancel-route pattern), then add the FE page.** Confirmed last session by reading `packages/cli/src/commands/init.ts:402` (CLI's `runProjectInit` is filesystem + DB-direct, not HTTP — there's no existing route to reuse) and `packages/daemon/src/server.ts:898+` (daemon has GET routes for projects but no POST). Three-commit shape: (a) `refactor(3.7): extract createProject into @factory5/wiki` (~50 LOC + tests + CLI thin-wrapper rewrite), (b) `feat(3.7): POST /api/v1/projects route + schemas` (~100 LOC + 6 route tests mirroring 3.6's auth/conflict/happy-path coverage), (c) `feat(3.7): /app/projects/new page` (~150 LOC, frontend-design skill required before authoring per saved feedback). Acceptance: form submit creates `<workspace>/<project>/.factory/project.json` + matching DB row, project appears at `/app/projects`, follow-up build directive at `/app/build` succeeds against the new project end-to-end.

## Notes for next session

Step 3.7 is the `/app/projects/new` page — browser mirror of `factory init <project>`. Decision 2 was resolved last session: **Option A — extract `createProject(...)` into `@factory5/wiki`, daemon and CLI both call it**. Three-commit plan is locked in.

**3.7 execution plan:**

1. **Commit (a) — `refactor(3.7): extract createProject into @factory5/wiki`.**
   - New export `wiki.createProject({ workspace, name, language, claudeMd? }) → { id, path }` containing the body of `runProjectInit` from `packages/cli/src/commands/init.ts:402-452`: refuse-to-overwrite guards, `mkdirSync`, `writeFileSync(claudeMd)` via `scaffoldClaudeMd`, `loadOrCreateProjectMetadata`. Move `scaffoldClaudeMd` itself from CLI to wiki (or re-export through wiki) so the daemon doesn't reach across to `@factory5/cli`.
   - Rewrite CLI's `runProjectInit` as a thin caller (parses flags, calls `wiki.createProject`, prints results to stdout).
   - +unit tests in `packages/wiki/src/createProject.test.ts` mirroring `init.test.ts`'s coverage: happy-path-each-language, refuse-overwrite-existing, refuse-when-CLAUDE.md-exists, identity-stable-after-create. CLI test count adjusts; wiki gains a new file.
   - Frontend-design skill NOT required for this commit (no UI).

2. **Commit (b) — `feat(3.7): POST /api/v1/projects route + schemas`.**
   - New schemas in `packages/ipc/src/schemas.ts`: `apiV1CreateProjectRequestSchema { name: string≥1, language: 'python'|'node'|'go'|'rust', claudeMd?: string, maxUsd?: number, maxSteps?: number }` + `apiV1CreateProjectResponseSchema { id, path }`. Mirror the existing `apiV1CreateBuildRequestSchema` shape.
   - New route in `packages/daemon/src/server.ts` near the existing `/api/v1/projects` GET routes (around line 898+). Gated by `requireUiAuth` (mirrors 3.6 cancel pattern). Handler: parse body via Zod, call `wiki.createProject`, return `{ id, path }`. Error envelope follows existing `ipcErrorSchema`.
   - +6 route tests in `packages/daemon/test/`: 401 UI_AUTH_REQUIRED / 503 UI_DISABLED / 400 SCHEMA_VALIDATION_FAILED on missing-name / 409 ALREADY_EXISTS on name-collision (refuse-overwrite from wiki) / happy path with bearer (DB row + filesystem files created) / 400 on invalid language enum.
   - Daemon test count expected ~167 → ~173.

3. **Commit (c) — `feat(3.7): /app/projects/new page`.**
   - New `apps/factory-web/src/pages/projects/new.astro` modeled on `apps/factory-web/src/pages/build.astro`'s `<Form>` + `<Field>` + `<Submit>` shape (3.4 commit `58d4584`). Fields: project name (required), language picker (`python` / `node` / `go` / `rust` / `(use server default)`), optional `CLAUDE.md` textarea, optional `--max-usd` / `--max-steps` numeric inputs. On submit: `apiPost('/api/v1/projects', ...)`, redirect to `/app/projects/detail?id=<new-id>` on success or surface inline `<Alert kind="conflict">` on failure (same hidden-Alert-placeholder pattern used by build.astro).
   - **Frontend-design skill required before authoring** per saved feedback.
   - **Apply the captureTokenFromUrl pattern from the start** — all auth-gated pages need it (lesson from this session's 3.6 follow-up `00d2bc4`).
   - Add nav link to dashboard between "Projects" and "Build" (or under the Projects submenu if the nav has hierarchy).
   - Acceptance: form submit creates `<workspace>/<project>/.factory/project.json` + matching DB row; project appears in `/app/projects`; follow-up build directive at `/app/build` succeeds against the new project end-to-end.

**Acceptance smoke for 3.7:** ideally combined with the still-open phase-3 acceptance smoke (which also closes the `finding.created` live-verification gap from ADR 0029). Live-test the new project flow: create at `/app/projects/new` → verify it renders at `/app/projects` → kick a build at `/app/build` against the new project → watch `directives/detail` for SSE events including `finding.created` (which the substantive build will exercise).

**Carry-forward bugs / cleanup (not blocking 3.7):**

- **Submit button invisible** (Submit.astro `.btn-primary` `color: Canvas` issue) — minor, one-line fix likely. Could land as `fix(3.x)` standalone or fold into the PageShell + Dashboard `<style is:global>` migration follow-up if that lands first.
- **Control framework repo uncommitted edits** at `G:\Projects\Small-Projects\Control` — operator decides on commit + 2.2.3 publish. Local factory5 already patched (`e5ec723`).
- **Smoke residue cleanup** — see "In-flight work" above; optional.
- **Daemon + astro background processes** — still up on `127.0.0.1:25295` and `127.0.0.1:4321`. Useful if you want to immediately resume live-testing on session start; otherwise stop at session start.

**3.x backlog still open** (no 3.7 acceptance dependency, in `phase-3-web-ui/steps.md` "Deferred follow-ups"):

- **PageShell + Dashboard `<style is:global>` migration** — 11-page structural sweep. Now has additional motivation: the 2026-05-05 smoke surfaced multiple visual quirks ("Completed Cancelling" text-glom on the cancel button, invisible Submit button, generally unstyled forms). Land in a session where you can spot-check pages in a browser as they convert.
- **Pause primitive** — design when a workflow signal demands it. Option A (status-enum extension) vs Option B (`markBlocked` reuse) vs longer-term-defer.
- **Pre-3.5 baseline live-smoke against running factoryd** — partially closed by the 2026-05-05 smoke (4 of 5 SSE event types verified). Phase-3 acceptance smoke needs to close the `finding.created` gap on a substantive build.

**Smoke lessons (carried to inform future smokes):**

- A directed `CLAUDE.md` (e.g., "Add `add(a, b)` pure function with vitest test") gets the architect past readiness checks but `assisted` autonomy still parks at each phase transition (architect→planning, planning→execution). To exercise an unattended build for `finding.created` evidence, use `--autonomy autonomous`, OR plan to answer 2 askUser questions before workers fire.
- The brain's `emitFindingCreated` emits per-task only when `listFindings(plan.projectPath)` returns non-empty. The smoke-demo "add(a,b)" project produced no findings (no verifier-class issues). Smokes that need to verify `finding.created` should pick a project that produces findings naturally — e.g., a build the verifier flags advisories on.
- Operator can answer pending questions via direct API POST (`/api/v1/pending-questions/:id/answer`) when the FE submit button is hidden by the unstyled-CSS issue. Faster than navigating around UI bugs and equally valid for non-UI-smoke purposes.

Read [`../../UPGRADE/LOG.md`](../../UPGRADE/LOG.md) for the upgrade-side narrative across sessions; this STATE.md is the operational cursor (overwritten at each `/session-end`).
