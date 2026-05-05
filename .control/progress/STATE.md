# Project State

> Single source of truth. Read this first every session. Updated at every
> `/session-end` and by the `PreCompact` hook. Every field has a purpose -- fill each.

**Last updated:** 2026-05-05 18:50 UTC by `/session-end` (post 3.6 live-smoke + ADR 0029 promotion + auth-bootstrap fix on detail page + Claude Code hooks cwd-anchor)
**Current phase:** 3 — web-ui
**Current step:** 3.7 — `/app/projects/new` (next; Decision 1 = smoke-first landed this session, Decision 2 = Option A locked in for execution)
**Status:** ready (clean working tree post session-end commit; all four `pnpm` gates green; ADR 0029 promoted with documented `finding.created` live-verification gap)

---

## Project spec

**Canonical:** `.control/SPEC.md` (v2.0 single-file layout)
**Evolution:** `git log .control/SPEC.md` (and the `## Artifacts (chronological)` section in SPEC.md, populated by `/spec-amend <slug>`)
**Role:** Source of truth for project content. When distilled docs (phase-plan, phase READMEs) disagree with the spec, the spec wins. Newer artifacts in SPEC.md's `## Artifacts` section win over conflicting content in the canonical sections above.

---

## Next action

Open [`../phases/phase-3-web-ui/steps.md`](../phases/phase-3-web-ui/steps.md). Step **3.7 = `/app/projects/new` — mirror of `factory init <project>` for a single project** per [`../../UPGRADE/plans/tier-3-web-ui-live-and-complete.md`](../../UPGRADE/plans/tier-3-web-ui-live-and-complete.md) §3.7. **Decision 2 from last session is locked in: Option A — extract `createProject(workspace, name, language) → { id, path }` into `@factory5/wiki`, then add `POST /api/v1/projects` route gated by `requireUiAuth` (mirrors 3.6 cancel-route pattern), then add the FE page.** Confirmed last session by reading `packages/cli/src/commands/init.ts:402` (CLI's `runProjectInit` is filesystem + DB-direct, not HTTP — there's no existing route to reuse) and `packages/daemon/src/server.ts:898+` (daemon has GET routes for projects but no POST). Three-commit shape: (a) `refactor(3.7): extract createProject into @factory5/wiki` (~50 LOC + tests + CLI thin-wrapper rewrite), (b) `feat(3.7): POST /api/v1/projects route + schemas` (~100 LOC + 6 route tests mirroring 3.6's auth/conflict/happy-path coverage), (c) `feat(3.7): /app/projects/new page` (~150 LOC, frontend-design skill required before authoring per saved feedback). Acceptance: form submit creates `<workspace>/<project>/.factory/project.json` + matching DB row, project appears at `/app/projects`, follow-up build directive at `/app/build` succeeds against the new project end-to-end.

---

## Git state

- **Branch:** main
- **Last commit:** `79474b1` — docs(adr): ADR 0029 — directive-stream protocol
- **Uncommitted changes:** none (working tree clean post session-end commit)
- **Last phase tag:** `phase-2-channel-parity-closed` (annotated tag at commit `081b832`)

---

## Open blockers

- None

---

## In-flight work

None on the factory5 side. Three carry-forward items live outside the work cursor:

- **Control framework repo (`G:\Projects\Small-Projects\Control`) has uncommitted edits awaiting operator's go.** `tools/cli.js` settings-template generator was refactored to use `JSON.stringify` + `cmdFor()` helper, generating both bash and PowerShell hook commands wrapped with `cd "$CLAUDE_PROJECT_DIR"` (the upstream of the local `chore(install)` patch in `e5ec723`). `.claude/settings.json` in the Control repo also patched to match. Operator wanted explicit go before commit + version bump (2.2.2 → 2.2.3) + npm publish since that's a public artifact change. Not blocking factory5 work.
- **Submit button invisible** in `apps/factory-web/src/components/Submit.astro` `.btn-primary` style — `color: Canvas` rendered identical to the page background for the operator's browser color scheme. Surfaced when answering the askUser question in the live smoke; operator could only locate the button via Ctrl+A text selection. Minor; one-line fix likely (swap `color: Canvas` for an explicit foreground that holds against any color scheme, or add an explicit background fill that contrasts). Not blocking 3.7.
- **Smoke residue in DB** — two cancelled directives (`01KQW3D4CZ84ZFHFKYEP7BWQBX`, `01KQWDWRQD08X3BEYEQNAD6M23`) and a real `smoke-demo` project (`01KQW30T5274QGSEHHVZTRQ953` at `C:\Users\Momo\factory5-workspace\smoke-demo`) remain. The `smoke-demo` workspace got real files written (scaffolder + builder ran before cancel — `package.json`, `tsconfig.json`, `src/index.ts`, etc.). Operator can reap with `cd packages/state && node smoke-cleanup.mjs` (existing tool used for prior smoke residue) plus an `rm -rf C:\Users\Momo\factory5-workspace\smoke-demo\` if a clean `factory status` is wanted. Not blocking 3.7.

---

## Test / eval status

- **Last test run:** 2026-05-05 — full workspace passes, all four `pnpm` gates green: build / test / lint / format:check. Per-package counts unchanged from last session (no test files touched this session — auth fix in `apps/factory-web/src/pages/directives/detail.astro` has no FE test harness; ADR 0029 promotion is markdown only; hooks settings.json is config). Workspace total still ~1063.
- **Eval score** (agent phases only): n/a
- **Regression tests:** unit + integration only; no eval harness

---

## Recent decisions (last 3 ADRs)

- **ADR 0029 — directive-stream-protocol** (Accepted 2026-05-05) — promoted this session from `UPGRADE/specs/sse-directive-stream.md`. Distills six decisions: endpoint shape (`GET /api/v1/directives/:id/stream?t=<token>`); six event types (`task.started` / `task.completed` / `finding.created` / `spend.updated` / `log.line` / `directive.completed`); 15-s heartbeats + backfill on connect; `DirectiveStreamHub` subscription map; brain-side optional-callback emission (no compile-time daemon dep); cleanup symmetry on disconnect. Live verification section pins the 2026-05-05 smoke evidence: 4 of 5 functional event types verified live + cancel-button round-trip; `finding.created` documented as unit-test-only (4 tests in `pool.test.ts` from `f990323`) with the parallel-implementation argument that risk of inflight breakage is low. Phase-3 acceptance smoke at `/phase-close` will close the live-verification gap.
- ADR 0028 — worker-sandbox-contract (per-spawn fs scoping; three Claude-Code-native primitives layered per-spawn)
- ADR 0027 — web-ui-mutation-surface (`POST /api/v1/builds`, `POST /api/v1/pending-questions/:id/answer`, `PUT /api/v1/projects/:id/budget`)

---

## Recently completed (last 5 steps)

- ADR 0029 promotion — `docs(adr)`: ADR 0029 — directive-stream protocol (authors `docs/decisions/0029-directive-stream-protocol.md`; adds INDEX row; pins 6 architectural decisions distilled from the spec; Live verification section records the 2026-05-05 smoke scorecard with `finding.created` documented as unit-test-only). — 2026-05-05 — `79474b1`
- Hooks cwd-anchor — `chore(install)`: cwd-anchor Claude Code hooks via `$CLAUDE_PROJECT_DIR` (wraps each hook command in `.claude/settings.json` with `bash -c 'cd "$CLAUDE_PROJECT_DIR" && exec bash .claude/hooks/<name>.sh'`; addresses the recurring "No such file or directory" Stop hook error caused by Bash-tool-call cwd drift; verified end-to-end by running the new Stop hook command from `packages/state/`. Local hot-patch ahead of Control v2.2.3 — Control's installer template (`tools/cli.js`) and own `.claude/settings.json` mirrored upstream but uncommitted there pending operator's go for npm publish). — 2026-05-05 — `e5ec723`
- 3.6 follow-up auth fix — `fix(3.6)`: bootstrap UI token in `directives/detail.astro` (one-line addition: `import captureTokenFromUrl` from `lib/api`, call it as the first executable statement in the script body. Mirrors the canonical pattern used by every other auth-gated page; detail.astro was the only page using auth-gated APIs that didn't bootstrap the token from URL. Surfaced during the 3.6 cancel-button live-smoke when the operator opened the detail page directly without a prior visit to `/app/`). — 2026-05-05 — `00d2bc4`
- Session-end docs (prior session) — `docs(state)`: session end for step 3.6. Captures the 3.6 close cursor in STATE.md / journal.md / UPGRADE/LOG.md / next.md; no code changes. — 2026-05-03 — `fb63d58`
- Step 3.6 closing — `refactor(3.6)`: close step 3.6 — cancel-only; pause + 3.x follow-ups deferred (flips `[ ] 3.6` → `[x] 3.6` in phase-3-web-ui/steps.md and UPGRADE/ROADMAP.md; rewrites the 3.6 line to "cancel-only" wording per Decision 2 = option C; adds a "Deferred follow-ups" section to steps.md with three explicit `- [ ]` bullets for pause primitive, PageShell + Dashboard global migration, and pre-3.5 baseline live-smoke). — 2026-05-03 — `0f5775a`

---

## Attempts that didn't work (current step only)

- None yet — Step 3.7 not started. (Session-time work was 3.6 follow-ups + ADR 0029 promotion + hooks infrastructure; no rollback or rework happened.)

---

## Environment snapshot

- **Language / runtime:** TypeScript on Node 20+ (currently running Node 22.22.2)
- **Key pinned deps:** pnpm 9.12.0, tsup 8.5.1, vitest 2.1.9, prettier 3.8.3, eslint 9.39.4, better-sqlite3 (workspace), discord.js v14, grammy, fastify (workspace), Astro 5.x
- **Model in use:** Claude Code (claude-opus-4-7[1m])
- **Other:** Windows Server 2025 host
- **Background processes still running** (cleanup at next session start if not wanted): `factoryd` on `127.0.0.1:25295` (started this session for the smoke), `astro dev` on `127.0.0.1:4321`. Both consume desktop resources but don't burn API spend with no inflight directive. Stop with `factory daemon stop` + kill astro process by PID.

---

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
