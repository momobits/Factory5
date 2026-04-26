# Project State

> Single source of truth for Control's operational cursor. Read this first every session. Updated at every `/session-end` and by the `PreCompact` hook.

**Last updated:** 2026-04-26 (session `2026-04-26T13`, session-end) — Phase 11 backend triplet shipped: 11.1 (ADR 0027) + 11.2 (answer route) + 11.3 (build route) + 11.4 (budget defaults route + project-tier resolution layered into both CLI and daemon code paths). Three of the four sub-steps that close out the mutation surface are done; SPA write affordances (11.5) + live validation (11.6) + phase close (11.7) carry forward.
**Current phase:** 11 — Web UI 9b (mutation surface) — **🟢 active**
**Current sub-phase:** n/a — single-charter phase
**Current step:** 11.5 — SPA write affordances (next)
**Status:** Working tree clean. 707 tests green across 14 packages. `pnpm lint` + `pnpm format:check` clean. `pnpm build` clean across 14 packages + 3 apps.

---

## Project spec

**Canonical:** `CompleteArchitecture.md` at root. §22 "Pluggable runtimes" added at Phase 10 close. Phase 11 will extend §21 (or add §23) for the mutation surface at 11.7 close.
**Current reference:** `docs/ARCHITECTURE.md` (evolves), `docs/CONTRACTS.md`, `docs/SKILLS.md`, `docs/AGENTS.md`.
**Phase history:** `docs/PROGRESS.md` (chronological). `docs/Phase10_Progress.md` written at Phase 10 close (one charter doc per phase pattern). `docs/Phase11_Progress.md` will land at 11.7.
**Role:** the `docs/` tree is authoritative. `.control/architecture/overview.md` is a pointer.

---

## Next action

**Sub-step 11.5 — SPA write affordances.** Wire three forms in `apps/factory-web/` against the routes shipped in 11.2/11.3/11.4:

1. Pending-questions detail page → answer textarea + submit → `POST /api/v1/pending-questions/:id/answer`. Handle 409 `QUESTION_ALREADY_ANSWERED_DIFFERENTLY` gracefully (show the existing answer); render an orphan-task warning if the response surfaces it.
2. New build form (page or modal) → operator picks `project + language + autonomy + budget` → `POST /api/v1/builds`. Disable submit on first click; navigate to the new directive's detail on 200.
3. Project detail page → `<input>`s for `maxUsd` / `maxSteps` → `PUT /api/v1/projects/:id/budget`. Full-document semantics — empty body clears, partial body removes the omitted field.

All three forms route through `src/lib/api.ts` (centralised bearer + envelope unwrap + error-code switch over the codes pinned in ADR 0027 §3). The `:id` on the budget route is the project ULID; Phase 11 will need a `GET /api/v1/projects` list endpoint so the SPA can map names → ULIDs (cheap read-side addition; lands at 11.5 alongside the form work).

**Standing rule for 11.5 (and any future factory5 UI work):** invoke the `frontend-design` plugin / skill BEFORE hand-rolling Astro markup. The operator's preference is to let `frontend-design` drive design + Islands wiring; implement against its output. Recorded in `feedback_use_frontend_dev_skill.md` memory and surfaced in `.control/phases/phase-11-web-ui-9b/steps.md` 11.5 entry.

After 11.5: 11.6 (operator-driven live validation against a real factoryd), 11.7 (phase close).

---

## Git state

- **Branch:** main (ahead of `origin/main` — push at operator discretion)
- **Last commit:** `3231c5c feat(11.4): PUT /api/v1/projects/:id/budget — per-project budget defaults`. Recent log: `3231c5c feat(11.4)` → `dcaa0a3 feat(11.3)` → `1a1af0e feat(11.2)` → `2557800 docs(11.1) prettier reflow` → `ea2f21c docs(11.1) ADR 0027` → `40590d7 docs(state) Phase 10 close session-end` → `0df2b51 docs(state)`. Session-end docs commit lands on top of this STATE.md update.
- **Uncommitted changes:** none (modulo `.claude/scheduled_tasks.lock` which is harness-local and gitignored from working-tree intent).
- **Last phase tag:** `phase-10-assessor-tier3-closed` (no new tag this session — Phase 11 still open).

Earlier tags intact: `phase-9-web-ui-closed`, `phase-8-worker-ask-user-closed`, `addendum-onboarding-closed`, `phase-7c-telegram-channel-closed`, `phase-7b-spend-dashboard-closed`, `phase-7a-budget-enforcement-closed`, `phase-7-closed`, `phase-6-closed`, `phase-6a-findings-registry-closed`, `phase-6c-verifier-overhaul-closed`, `protocol-initialised`.

---

## Open blockers

- **None for Phase 11.** All carry-forwards below are non-blocking.
- **Carry-forward** (unchanged):
  - **I009** (MEDIUM, OPEN, `channels/telegram`) — Telegram/Discord inbound `/build` doesn't inherit `[budget.defaults]`. Now also doesn't inherit project-tier `metadata.budgetDefaults` (worse after 11.4). The right fix extracts a shared `resolveDirectiveLimits(projectMeta, cfg, explicitFlags)` helper in `@factory5/brain` or `@factory5/wiki` so every directive-creation path runs the same three-tier resolution. Recorded as ADR 0027 §4 carry-forward.
  - **I012** (LOW, OPEN, `channels/telegram`) — `maybeAnswerPendingQuestion` FIFO matcher can't target a specific open question.
  - **I014** (MEDIUM, OPEN, `brain/architect`) — architect re-running on existing project leaves wiki edits uncommitted, dirty-tripping `gate.verify`. Targeted fix: stage + commit at end of `runArchitect` if a git repo exists.
  - **Stale-dist dev-loop gotcha** — Phase 9's recommended one-line fix is incompatible with the prod runtime path; needs design (conditional exports + `--conditions=development`, OR app-side bundling with full transitive npm deps declared). Workaround: `pnpm build` after editing workspace deps before running `pnpm factoryd`.
  - **`factory ui-token` CLI command** (ADR 0025 §2 carry-forward) — operator closes terminal → loses dashboard URL.
  - **Phase 6 operator follow-ups** (PAT revoke, `gh repo delete`, env var cleanup) — out-of-band.

---

## In-flight work

- None. 11.4 closed clean; 11.5 hasn't opened yet (waits for next session + `frontend-design` skill invocation).

---

## Test / eval status

- **Last test run:** 2026-04-26 (post-11.4) — **707 tests** across 14 packages, all green on Windows. `pnpm lint` + `pnpm format:check` clean. `pnpm build` clean across 14 packages + 3 apps.
- **Per-package counts (post-11.4):** core 14, logger 13, ipc 14, providers 39, state 134, assessor 79, wiki 58 (was 49; +9 from 11.4 wiki helpers — 5 `budgetDefaultsFromProjectMeta` + 4 `updateProjectMetadata`), channels 62, events 3, worker 28, brain 74, daemon 111 (was 79; +9 from 11.2 + 11 from 11.3 + 12 from 11.4), cli 63, worker-mcp 15. Sum = 707 (verified).
- **Live run datapoints:** none this session — Phase 11 backend triplet was all unit/integration. Live validation belongs to 11.6 (operator browser smoke against a real factoryd).
- **Pre-existing flake:** `packages/daemon/src/pidfile.test.ts > pidfile > reaps a stale pidfile (dead owner)` flaked once under parallel test load on Windows; passed on retry and in isolation. Not from 11.x changes; documented for future awareness, no action taken.

---

## Recent decisions (last 3 ADRs)

- **ADR 0027** (2026-04-26) — Web UI mutation surface: route shape + idempotency + error envelope + per-project budget defaults. Five sub-decisions in one ADR (multi-decision shape per ADRs 0024/0025/0026): (1) verbs/URLs per route — `POST /api/v1/pending-questions/:id/answer`, `POST /api/v1/builds` (top-level collection, mirrors `factory build <name>`), `PUT /api/v1/projects/:id/budget` (full-doc replacement); (2) idempotency rules — answer same-no-op/different-409, build never (operator action), budget PUT-replaceable; (3) reuse of `ipcErrorSchema` envelope + four new mutation codes (others collapse into `SCHEMA_VALIDATION_FAILED`); (4) `metadata.budgetDefaults` mirrors `directiveLimitsSchema`, lives under ADR 0021's `metadata` extension point — same slot as 10.8's `metadata.language`; (5) bearer-only auth (no weaker / stronger check on mutations; CSRF out of scope per loopback-only design).
- **ADR 0026** (2026-04-24) — Pluggable assessor runtimes.
- **ADR 0025** (2026-04-23) — Web UI architecture.

All 27 ADRs live under `docs/decisions/`. Phase 11 added one this session (0027); 11.7 may add zero or one depending on whether SPA work surfaces a fresh decision.

---

## Recently completed (last 5 phase closes / major steps)

- **Phase 11 sub-step 11.4 — Project budget defaults route** — 2026-04-26 — `3231c5c feat(11.4)`. New `PUT /api/v1/projects/:id/budget` (full-document replacement). New `projectBudgetDefaultsSchema` in @factory5/core; new `budgetDefaultsFromProjectMeta` + `updateProjectMetadata` + `ProjectMetadataNotFoundError` in @factory5/wiki. Build resolution upgraded from two-tier (flag → config) to three-tier (flag → project → config) in both CLI and daemon code paths. +9 wiki tests, +12 daemon tests.
- **Phase 11 sub-step 11.3 — Build creation route** — 2026-04-26 — `dcaa0a3 feat(11.3)`. New `POST /api/v1/builds` mirroring `factory build <project>` server-side (same `resolveProjectPath` + `loadOrCreateProjectMetadata` chain; refuses to create new projects per Phase 11 charter). Refactor: `languageFromProjectMeta` moved from cli/build.ts to @factory5/wiki + new `ProjectLanguage` type. +11 daemon tests.
- **Phase 11 sub-step 11.2 — Answer route** — 2026-04-26 — `1a1af0e feat(11.2)`. New `POST /api/v1/pending-questions/:id/answer` reusing the same answer-write path as the channel collectors. Idempotency per ADR 0027 §2: same-payload-200, different-payload-409. ADR 0024 §4 orphan-tolerant. +9 daemon tests (incl. `tasksInflight` orphan path). Re-exported `InflightTask` type from @factory5/state index.
- **Phase 11 sub-step 11.1 — ADR 0027** — 2026-04-26 — `ea2f21c docs(11.1)` + `2557800 docs(11.1)` (prettier reflow). Mutation surface contract pinned for 11.2–11.4.
- **Phase 10 closed** — 2026-04-26 — `1351b2f` + tag `phase-10-assessor-tier3-closed`. Three new runtimes Node / Go / Rust shipped + live-validated; ADR 0026 accepted.

---

## Attempts that didn't work (current step only)

- None for the 11.x sub-steps closed this session — every commit landed first-try plus a single prettier reflow each (cosmetic, no logic touched). Past dead-ends from prior sessions (stale-dist investigation, etc.) cleared at Phase 11 open.

---

## Environment snapshot

- **Language / runtime:** TypeScript strict mode on Node 20+ (ADR 0001). pnpm workspaces. ESM (NodeNext) with explicit `.js` import extensions.
- **Key pinned deps (unchanged from Phase 10 close):** `astro ^5.0.0`, `@astrojs/check ^0.9.0` (in `apps/factory-web/`); `@fastify/static ^7.0.0` (in `@factory5/daemon`); Pino, Zod, Commander, Fastify v4, better-sqlite3, discord.js, chokidar, simple-git, vitest, ulid, `@modelcontextprotocol/sdk ^1.0.0`. **No new external deps in Phase 11 so far.**
- **Model in use:** Claude Opus 4.7 for session work.
- **Other:** Windows + Linux cross-platform mandatory. **14 packages + 3 apps**. **707 tests**. `CHANNEL_IDS` narrowed to `['cli','discord','telegram']` (ADR 0019). Budget enforcement per ADR 0020. Project identity via `.factory/project.json` (ADR 0021). Cross-session spend via `factory spend` (7b.3). Telegram channel via plugin-owned long-poll (ADR 0022). Instance data dir via cwd-walk (ADR 0023). Worker `ask_user` per ADR 0024. Web UI per ADR 0025 + mutation surface per ADR 0027. Pluggable runtime per ADR 0026.
- **Host toolchain at Phase 10 close:** pnpm 9.12.0, Node v22.22.2, Go 1.26.2, Rust/Cargo 1.95.0 — all on PATH.

---

## Notes for next session

If resuming after `/session-end` or a cold start:

1. Read `CLAUDE.md` (root) — standing brief incl. Control-framework section.
2. Read this STATE.md.
3. Read `.control/phases/phase-11-web-ui-9b/{README.md,steps.md}` — note the 11.5 entry includes the standing rule about invoking the `frontend-design` skill BEFORE writing UI code.
4. Skim [ADR 0027](../../docs/decisions/0027-web-ui-mutation-surface.md) — load-bearing contract for the routes the SPA forms wire against.
5. Run `/session-start` for the full drift check.

**Budget for Phase 11 remainder:** 1 session expected (11.5 SPA + 11.6 live val + 11.7 phase close together). 11.5 is mostly UI code (no live LLM spend); 11.6 needs operator browser presence + a small live build for end-to-end smoke (pick a Phase 10 fixture so it's cheap).

**Memory updates this session:**

- New: `feedback_use_frontend_design_skill.md` — standing preference to invoke the `frontend-design` skill before hand-rolling factory5 UI.

**Carry-forward** (still non-blocking):

- I009 (MEDIUM) + I012 (LOW) + I014 (MEDIUM).
- Stale-dist dev-loop gotcha — needs design.
- `factory ui-token` CLI command (ADR 0025 §2).
- Phase 6 operator follow-up.
