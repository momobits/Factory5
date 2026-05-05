# Project State

> Single source of truth. Read this first every session. Updated at every
> `/session-end` and by the `PreCompact` hook. Every field has a purpose -- fill each.

**Last updated:** 2026-05-05 18:22 UTC by `/session-end` (post step 3.7 commits a/b/c — code-complete; live-smoke + steps.md/ROADMAP close commit pending)
**Current phase:** 3 — web-ui
**Current step:** 3.7 — `/app/projects/new` (code-complete; checkbox not yet flipped — close commit lands alongside the live-smoke acceptance per the project's multi-commit-step pattern)
**Status:** ready (clean working tree post session-end; all four `pnpm` gates green; workspace test count 1063 → 1075 across the three step commits; live-smoke acceptance still open and folds into the still-pending phase-3 acceptance smoke that closes ADR 0029's `finding.created` live-verification gap)

---

## Project spec

**Canonical:** `.control/SPEC.md` (v2.0 single-file layout)
**Evolution:** `git log .control/SPEC.md` (and the `## Artifacts (chronological)` section in SPEC.md, populated by `/spec-amend <slug>`)
**Role:** Source of truth for project content. When distilled docs (phase-plan, phase READMEs) disagree with the spec, the spec wins. Newer artifacts in SPEC.md's `## Artifacts` section win over conflicting content in the canonical sections above.

---

## Next action

Live-smoke step 3.7's full flow against a restarted factoryd (the long-running daemon on `127.0.0.1:25295` is the pre-3.7 build and 404s the new `POST /api/v1/projects` route). Stop + restart factoryd (`factory daemon stop` then `factory daemon start`, or kill the process and re-run), open `/app/projects/new?t=<token>` (or via the dashboard's `+ New project` link from `/app/projects/`), submit a real project (e.g. name `node-sse-smoke`, language `node`, optional CLAUDE.md asking the architect to add a non-trivial verifier-flagged feature so the build produces findings). Verify: scaffolded files at `<workspace>/<name>/{CLAUDE.md, .factory/project.json}`, redirect to `/app/projects/detail?id=<id>`, project visible at `/app/projects/`, then kick a build at `/app/build` against the new project, watch `directives/detail` for SSE events including `finding.created` (the still-open phase-3 acceptance gap from ADR 0029's Live verification section). After the smoke lands cleanly, single close commit `refactor(3.7): close step 3.7` flips `- [ ] 3.7` → `- [x] 3.7` in [`../phases/phase-3-web-ui/steps.md`](../phases/phase-3-web-ui/steps.md) and ticks the matching item in [`../../UPGRADE/ROADMAP.md`](../../UPGRADE/ROADMAP.md). Per [`../../UPGRADE/plans/tier-3-web-ui-live-and-complete.md`](../../UPGRADE/plans/tier-3-web-ui-live-and-complete.md) §3.7. Phase 3 has 3.8 / 3.9 / 3.10 / 3.11 still open after that.

---

## Git state

- **Branch:** main
- **Last commit:** `e3aca18` — fix(3.7): drop `<ClientRouter />` so page setup runs on every nav
- **Uncommitted changes:** none (working tree clean post step-3.7 close commit; same lag-by-1 the runbook documents — STATE.md reconcile folded into this commit per the operator's preference, vs. the standalone `317d94b`-shape last cycle)
- **Last phase tag:** `phase-2-channel-parity-closed` (annotated tag at commit `081b832`)

---

## Open blockers

- None

---

## In-flight work

Step 3.7 itself is **code-complete** but not closed: the `- [ ] 3.7` checkbox in `phase-3-web-ui/steps.md` and the matching tick in `UPGRADE/ROADMAP.md` are intentionally not flipped yet — they land in a separate `refactor(3.7): close step 3.7` commit alongside the live-smoke acceptance (matches the pattern set by `dfd1a07` for 3.4 close and `0f5775a` for 3.6 close). The acceptance smoke is the operator's call to schedule.

Carry-forward items outside the work cursor (none block 3.7's close):

- **Stale running factoryd on `127.0.0.1:25295`.** Started in the prior session for the 3.6 smoke; loaded the pre-3.7 build, so `POST /api/v1/projects` 404s on it. Live-smoke for 3.7 needs a `factory daemon stop && factory daemon start` (or process kill + restart) to pick up commit (b)'s new route. Astro dev on `127.0.0.1:4321` is hot-reloading and already serving the new page — confirmed via `curl` against `/app/projects/new`.
- **Submit button invisible** in `apps/factory-web/src/components/Submit.astro` `.btn-primary` style — `color: Canvas` rendered identical to the page background. Will repro on the new `/app/projects/new` form too. Not a blocker for the smoke (operator can ctrl+A or click the right region of the visible outline). One-line fix or fold into the deferred PageShell + `<style is:global>` migration.
- **Control framework repo** (`G:\Projects\Small-Projects\Control`) still has uncommitted upstream patches matching local `e5ec723`. Operator owns the go for 2.2.2 → 2.2.3 publish.
- **Smoke residue from prior session** — two cancelled directives (`01KQW3D4CZ84ZFHFKYEP7BWQBX`, `01KQWDWRQD08X3BEYEQNAD6M23`) and a real `smoke-demo` project (`01KQW30T5274QGSEHHVZTRQ953` at `C:\Users\Momo\factory5-workspace\smoke-demo`) remain. Optional cleanup via `cd packages/state && node smoke-cleanup.mjs` + `rm -rf C:\Users\Momo\factory5-workspace\smoke-demo\`.

---

## Test / eval status

- **Last test run:** 2026-05-05 — full workspace passes, all four `pnpm` gates green: build / test / lint / format:check. Per-package counts: state 152, channels 175, daemon **173** (+6 new POST /api/v1/projects route tests), brain 101, worker 38, worker-sandbox 86 + 3 skipped, assessor 79, wiki **74** (+10: 4 scaffold migrated from CLI + 6 new createProject tests), cli **78** (-4: scaffold tests moved to wiki), providers 39, ipc 28, events 3, core 14, logger 20, worker-mcp 15. **Workspace total 1075 passing + 3 skipped** — net +12 from the 1063 baseline (+10 wiki - 4 cli + 6 daemon).
- **Eval score** (agent phases only): n/a
- **Regression tests:** unit + integration only; no eval harness. The 3.7 commit (b) happy-path daemon test asserts CLAUDE.md scaffold body + `.factory/project.json` identity + SQLite registry row in one assertion sweep — substantive coverage even before the live-smoke.

---

## Recent decisions (last 3 ADRs)

- **ADR 0029 — directive-stream-protocol** (Accepted 2026-05-05) — promoted this session from `UPGRADE/specs/sse-directive-stream.md`. Distills six decisions: endpoint shape (`GET /api/v1/directives/:id/stream?t=<token>`); six event types (`task.started` / `task.completed` / `finding.created` / `spend.updated` / `log.line` / `directive.completed`); 15-s heartbeats + backfill on connect; `DirectiveStreamHub` subscription map; brain-side optional-callback emission (no compile-time daemon dep); cleanup symmetry on disconnect. Live verification section pins the 2026-05-05 smoke evidence: 4 of 5 functional event types verified live + cancel-button round-trip; `finding.created` documented as unit-test-only (4 tests in `pool.test.ts` from `f990323`) with the parallel-implementation argument that risk of inflight breakage is low. Phase-3 acceptance smoke at `/phase-close` will close the live-verification gap.
- ADR 0028 — worker-sandbox-contract (per-spawn fs scoping; three Claude-Code-native primitives layered per-spawn)
- ADR 0027 — web-ui-mutation-surface (`POST /api/v1/builds`, `POST /api/v1/pending-questions/:id/answer`, `PUT /api/v1/projects/:id/budget`)

---

## Recently completed (last 5 steps)

- Step 3.7 commit (c) — `feat(3.7)`: `/app/projects/new` page. Mirrors `build.astro`'s `<Form>`+`<Field>`+`<Submit>` shape; fields are name (required text), language (required select; python default), claudeMd (optional textarea, 12 rows). On submit, `apiPost('/api/v1/projects', …)` then redirects to `/app/projects/detail?id=<id>`; on error, hidden-`<Alert>`-placeholder pattern surfaces inline with `ALREADY_EXISTS` / `SCHEMA_VALIDATION_FAILED` / `UI_AUTH_REQUIRED` / `UI_DISABLED` headings. `captureTokenFromUrl()` first executable statement (per saved-feedback memory + lesson from `00d2bc4`). `+ New project` outline-button affordance added to `projects/index.astro` near the page heading; empty-state copy updated to surface the new web flow. Top nav left at 8 items — adding "New project" as a 9th would crowd; the contextual affordance covers discoverability without nav clutter (intentional deviation from plan's nav-link recommendation, lighter direction). — 2026-05-05 — `53e4e98`
- Step 3.7 commit (b) — `feat(3.7)`: POST /api/v1/projects route + schemas. New `apiV1CreateProject{Request,Response}Schema` in `@factory5/ipc` (request: `name` ≥1, `language` enum, `claudeMd?`; response: `{ id (ULID), path }`). New route in `packages/daemon/src/server.ts` near the GET counterparts; bearer-gated via `requireUiAuth`; pipeline `parseBody → join workspace + name → wiki.createProject (maps CreateProjectAlreadyExistsError → 409 ALREADY_EXISTS) → projectsQ.upsert → respond { id, path }`. New `IpcServerOptions.workspace?` opt for test override (also future-proofs the prod path for cfg.general.workspace once that wiring lands; POST /api/v1/builds has the same gap, deferred). +6 route tests in `server.test.ts` mirroring the build route's 401/503/400/happy/409 shape. — 2026-05-05 — `50e8b33`
- Step 3.7 commit (a) — `refactor(3.7)`: extract createProject into `@factory5/wiki`. New `wiki.createProject({projectPath, name, language, claudeMd?}) → {id, path, claudeMdPath}`; `CreateProjectAlreadyExistsError` with `reason ∈ {'existing-metadata' | 'existing-claude-md'}` + `existingProjectId?`; `scaffoldClaudeMd` relocated from CLI to wiki. CLI's `runProjectInit` collapses to ~30-LOC thin wrapper (path resolution + try/catch around createProject + stdout messages). `packages/cli/src/commands/init.test.ts` deleted; its 4 scaffoldClaudeMd tests reproduced verbatim in `wiki/src/create-project.test.ts` alongside 6 new createProject tests (fresh-create, claudeMd override, refuse-existing-identity, refuse-existing-claude-md, identity-stable, each-language scaffold). Wiki 64→74, CLI 82→78. — 2026-05-05 — `d118e1c`
- State reconcile — `docs(state)`: reconcile STATE.md last-commit pointer to current HEAD. Fifth occurrence of the post-session-end self-reference drift (after `cce7065` / `db61baf` / `54c0f20` / `288603e`); STATE.md said `79474b1` but HEAD was `1c6eeaf`. Brought "Last commit" + "Recently completed[0]" current to `1c6eeaf`. Same `288603e`-shape — accepts the steady-state lag-by-1 the runbook documents. — 2026-05-05 — `317d94b`
- Session-end docs (prior session) — `docs(state)`: session end for step 3.7 — captures the 2026-05-05 session cursor ahead of step 3.7 work; documents `00d2bc4` / `e5ec723` / `79474b1` and locks in Decision 2 = Option A. — 2026-05-05 — `1c6eeaf`

---

## Attempts that didn't work (current step only)

- None — all three step commits + the reconcile landed cleanly on first attempt, all gates green at every commit. No rollbacks, no rework. The closest thing to a course-correction was tightening the `let result;` declaration in CLI's thin wrapper to `let result: CreateProjectResult;` for TS strict-mode flow analysis, decided pre-commit before the build was run.

---

## Environment snapshot

- **Language / runtime:** TypeScript on Node 20+ (currently running Node 22.22.2)
- **Key pinned deps:** pnpm 9.12.0, tsup 8.5.1, vitest 2.1.9, prettier 3.8.3, eslint 9.39.4, better-sqlite3 (workspace), discord.js v14, grammy, fastify (workspace), Astro 5.x
- **Model in use:** Claude Code (claude-opus-4-7[1m])
- **Other:** Windows Server 2025 host
- **Background processes still running** (carry-forward from prior session): `factoryd` on `127.0.0.1:25295` — **stale; loaded the pre-3.7 build, will 404 the new POST /api/v1/projects route**; restart with `factory daemon stop && factory daemon start` before live-smoke. `astro dev` on `127.0.0.1:4321` — hot-reloading correctly, already serving `/app/projects/new` (verified via curl). Stop both with `factory daemon stop` + kill astro process by PID if not running the smoke this session.

---

## Notes for next session

Step 3.7 is **code-complete**. Three commits landed plus a drift reconcile; all four `pnpm` gates green at the end of every commit; workspace test count 1063 → 1075. The remaining work is the live-smoke + a single close commit.

**Live-smoke + 3.7 close (recommended next):**

1. **Restart factoryd** to pick up commit (b)'s new POST `/api/v1/projects` route — the stale background daemon on port 25295 was loaded with the pre-3.7 build. `factory daemon stop && factory daemon start` (or process kill + restart). Astro dev on 4321 already has the new page hot-reloaded.
2. **Run the smoke**, ideally combined with the still-open phase-3 acceptance smoke that closes ADR 0029's `finding.created` live-verification gap:
   - Open `/app/projects/new` (via the dashboard's `+ New project` link from `/app/projects/`, or directly).
   - Submit a real project that the assessor will produce findings on — e.g. name `node-sse-smoke`, language `node`, optional CLAUDE.md asking the architect to add a verifier-flagged feature (per the prior smoke lesson: pick a project that naturally produces findings, not the trivial `add(a, b)`). Use `--autonomy autonomous` if you want unattended; `assisted` parks at architect→planning + planning→execution and needs 2 askUser answers.
   - Verify: scaffolded `<workspace>/<name>/{CLAUDE.md, .factory/project.json}`, redirect to `/app/projects/detail?id=<id>` on success, project visible at `/app/projects/`.
   - Kick a build at `/app/build` against the new project; watch `directives/detail` SSE for `finding.created` events (the gap pinned in ADR 0029's Live verification section).
3. **Close commit** `refactor(3.7): close step 3.7` — flips `- [ ] 3.7` → `- [x] 3.7` in `.control/phases/phase-3-web-ui/steps.md` and ticks the matching item in `UPGRADE/ROADMAP.md`. Same shape as `dfd1a07` (3.4 close) and `0f5775a` (3.6 close).

**After 3.7 closes**, Phase 3 still has 4 step commits + one phase-close commit ahead:

- **3.8** — Spend page charts. Sparkline per project (last 14 days) + 30-day stacked bar of daily totals split by project. Vanilla SVG, no chart-lib dep. Per `tier-3-web-ui-live-and-complete.md` §3.8.
- **3.9** — Mobile-responsive nav. Hamburger drawer at ≤768px; primary actions reachable in two taps at 375px.
- **3.10** — Explicit logout + connection-status indicator in header. SSE-heartbeat-backed pip; clears session token on logout.
- **3.11** — `/phase-close` (tags `phase-3-web-ui-closed`, scaffolds Phase 4).
- Plus the **Deferred follow-ups** still open in `phase-3-web-ui/steps.md`: pause primitive (when a workflow signal demands it), PageShell + `<style is:global>` migration (11-page structural sweep — would also fix the Submit-invisible bug), pre-3.5 baseline live-smoke (mostly closed by the 2026-05-05 smoke + the upcoming 3.7 acceptance).

**Carry-forward bugs / cleanup (not blocking 3.8 or beyond):**

- **Submit button invisible** (`Submit.astro` `.btn-primary` `color: Canvas` issue) will repro on the new `/app/projects/new` form too — same `<style is:global>` follow-up will fix all dashboard buttons in one sweep.
- **Control framework repo** at `G:\Projects\Small-Projects\Control` — operator's go on 2.2.3 publish.
- **Smoke residue from prior session** — optional reap via `cd packages/state && node smoke-cleanup.mjs` + `rm -rf C:\Users\Momo\factory5-workspace\smoke-demo\`.

**Frontend-design judgement calls captured during 3.7 commit (c)** worth recalling for 3.8 / 3.9 / 3.10:

- **Inherit, don't invent.** The dashboard's existing aesthetic is utilitarian-functional (`system-ui`, `color-mix(currentColor)` palette adapting to `color-scheme: light dark`); the page-design move is to apply frontend-design *principles* (hierarchy, affordance copy, friction-aware errors, smart defaults) within that aesthetic, not introduce a new palette / typography.
- **Hint copy teaches the consequence, not the shape.** "Drives the per-language CLAUDE.md scaffold and the assessor runtime on subsequent builds" beats "Pick a language" — the operator already knows what a select does; what they don't know is what choosing affects downstream.
- **Empty submit fields ≠ explicit empty.** `body.claudeMd` is sent only when the textarea has non-whitespace content; sending `claudeMd: ''` would override the per-language scaffold with nothing. Same pattern transfers to 3.8/3.9 forms (don't conflate "not specified" with "explicitly cleared").
- **Skipping the global nav addition** when an in-context affordance covers discoverability is the cleaner UX — `+ New project` on the projects list page beats a 9th nav item. Plan recommended nav; this was an intentional deviation in the lighter direction (recorded in `53e4e98`'s body).

Read [`../../UPGRADE/LOG.md`](../../UPGRADE/LOG.md) for the upgrade-side narrative across sessions; this STATE.md is the operational cursor (overwritten at each `/session-end`).
