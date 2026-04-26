# Project State

> Single source of truth for Control's operational cursor. Read this first every session. Updated at every `/session-end` and by the `PreCompact` hook.

**Last updated:** 2026-04-26 (session `2026-04-26T16`, session-end after phase 11 close) — Phase 11 closed at `fa5ee25` with tag `phase-11-web-ui-9b-closed`. ADR 0027 + three backend mutation routes + SPA write affordances + GET /api/v1/projects + operator-driven live browser smoke. Phase 12 (worker filesystem-scoping) scaffolded; kicks off next session at 12.1.
**Current phase:** 12 — Worker filesystem-scoping — **🟢 active**
**Current sub-phase:** n/a — single-charter phase
**Current step:** 12.1 — ADR for sandbox contract (next)
**Status:** Working tree clean. **717 tests** green across 14 packages. `pnpm lint` + `pnpm format:check` clean. `pnpm build` clean across 14 packages + 3 apps.

---

## Project spec

**Canonical:** `CompleteArchitecture.md` at root. §22 "Pluggable runtimes" added at Phase 10 close. §23 "Web UI mutation surface" added at Phase 11 close. Phase 12 will add §24 (or extend §3 / §16) for the worker-sandbox model at 12.5 close.
**Current reference:** `docs/ARCHITECTURE.md` (evolves), `docs/CONTRACTS.md`, `docs/SKILLS.md`, `docs/AGENTS.md`.
**Phase history:** `docs/PROGRESS.md` (chronological). `docs/Phase11_Progress.md` written at Phase 11 close (one charter doc per phase pattern). `docs/Phase12_Progress.md` will land at 12.5.
**Role:** the `docs/` tree is authoritative. `.control/architecture/overview.md` is a pointer.

---

## Next action

**Sub-step 12.1 — ADR for the worker-sandbox contract.** Pin the gate site + path-prefix algebra + out-of-scope behaviour + the Bash story before any code lands. Survey what `claude-cli` exposes natively (cheap config-based gate vs. needing a custom MCP middleware) — the cheapest cross-platform gate wins. Write `docs/decisions/0028-*.md` covering the five sub-decisions in the charter.

After 12.1: 12.2 (implementation at the chosen gate site), 12.3 (regression tests — F001 replay + cross-platform out-of-scope path), 12.4 (live validation against a Phase 10 fixture), 12.5 (phase close).

The Phase 11 forward queue identified Phase 12's three forcing functions: F001 (verifier hallucination, 6c), Phase 8's deferred filesystem-scoping carry-forward, and Phase 10's I013 worktree-cleanup pain. Phase 12 pays down all three with one mechanism.

---

## Git state

- **Branch:** main (ahead of `origin/main` — push at operator discretion)
- **Last commit:** session-end `docs(state)` lands on top of phase-close. Recent log: this session-end commit → `fa5ee25 chore(phase-11)` (tag here) → `db90421 docs(11.6)` → `97469e9 chore(harness)` → `08a0d63 feat(11.5)` → `a34f473 docs(state)` → `c83e3d5 docs(state)`. Tag `phase-11-web-ui-9b-closed` placed on `fa5ee25`.
- **Uncommitted changes:** none at session end (modulo `.claude/scheduled_tasks.lock` which the harness rewrites on session resume — gets swept up at the next harness chore commit).
- **Last phase tag:** `phase-11-web-ui-9b-closed` (placed on `fa5ee25`).

Earlier tags intact: `phase-10-assessor-tier3-closed`, `phase-9-web-ui-closed`, `phase-8-worker-ask-user-closed`, `addendum-onboarding-closed`, `phase-7c-telegram-channel-closed`, `phase-7b-spend-dashboard-closed`, `phase-7a-budget-enforcement-closed`, `phase-7-closed`, `phase-6-closed`, `phase-6a-findings-registry-closed`, `phase-6c-verifier-overhaul-closed`, `protocol-initialised`.

---

## Open blockers

- **None for Phase 12.** All carry-forwards below are non-blocking.
- **Carry-forward** (unchanged from Phase 11 close):
  - **I009** (MEDIUM, OPEN, `channels/telegram`) — Telegram/Discord inbound `/build` doesn't inherit `[budget.defaults]`. After 11.4 it skips two tiers (project + config), not one. Right fix: extract a shared `resolveDirectiveLimits(projectMeta, cfg, explicitFlags)` helper in `@factory5/brain` or `@factory5/wiki` so every directive-creation path runs the same three-tier resolution.
  - **I012** (LOW, OPEN, `channels/telegram`) — `maybeAnswerPendingQuestion` FIFO matcher can't target a specific open question.
  - **I014** (MEDIUM, OPEN, `brain/architect`) — architect re-running on existing project leaves wiki edits uncommitted, dirty-tripping `gate.verify`. Targeted fix: stage + commit at end of `runArchitect` if a git repo exists.
  - **Stale-dist dev-loop gotcha** — Phase 9's recommended one-line fix is incompatible with the prod runtime path; needs design (conditional exports + `--conditions=development`, OR app-side bundling with full transitive npm deps declared). Workaround: `pnpm build` after editing workspace deps before running `pnpm factoryd`.
  - **`factory ui-token` CLI command** (ADR 0025 §2 carry-forward) — operator closes terminal → loses dashboard URL.
  - **Phase 6 operator follow-ups** (PAT revoke, `gh repo delete`, env var cleanup) — out-of-band.

---

## In-flight work

- None. Phase 11 closed clean; Phase 12 hasn't opened (waits for next session + 12.1 ADR).

---

## Test / eval status

- **Last test run:** 2026-04-26 (Phase 11 close gate) — **717 tests** across 14 packages, all green on Windows. `pnpm lint` + `pnpm format:check` clean. `pnpm build` clean across 14 packages + 3 apps.
- **Per-package counts (post-Phase-11):** core 14, logger 13, ipc 14, providers 39, state 134, assessor 79, wiki 58, channels 62, events 3, worker 28, brain 74, daemon 121 (was 79 at Phase 9 close — +42 across 11.x: 9 from 11.2 + 11 from 11.3 + 12 from 11.4 + 10 from 11.5), cli 63, worker-mcp 15. Sum = 717.
- **Live run datapoints:** Phase 11.6 — `log-totals-cli` directive `01KQ5CRRVDT16YRP0TMDEP8PHX` ran end-to-end via the SPA build form, $4.25, terminal status `blocked` (2 blocking + 4 advisory findings). Two mid-stream askUser questions answered via the SPA answer form. Budget propagation verified via Build #2 (`01KQ5G9DFN41H2ATVV8MZ9WY5A`) — `hasLimits: true` with project-tier values.
- **Pre-existing flake:** `packages/daemon/src/pidfile.test.ts > pidfile > reaps a stale pidfile (dead owner)` flaked once under parallel test load on Windows; passed on retry and in isolation. Not from any Phase 11 change; documented for awareness, no action taken.

---

## Recent decisions (last 3 ADRs)

- **ADR 0027** (2026-04-26) — Web UI mutation surface: route shape + idempotency + error envelope + per-project budget defaults. Five sub-decisions in one ADR (multi-decision shape per ADRs 0024/0025/0026): (1) verbs/URLs per route — `POST /api/v1/pending-questions/:id/answer`, `POST /api/v1/builds` (top-level collection, mirrors `factory build <name>`), `PUT /api/v1/projects/:id/budget` (full-doc replacement); (2) idempotency rules — answer same-no-op/different-409, build never (operator action), budget PUT-replaceable; (3) reuse of `ipcErrorSchema` envelope + four new mutation codes (others collapse into `SCHEMA_VALIDATION_FAILED`); (4) `metadata.budgetDefaults` mirrors `directiveLimitsSchema`, lives under ADR 0021's `metadata` extension point — same slot as 10.8's `metadata.language`; (5) bearer-only auth (no weaker / stronger check on mutations; CSRF out of scope per loopback-only design).
- **ADR 0026** (2026-04-24) — Pluggable assessor runtimes.
- **ADR 0025** (2026-04-23) — Web UI architecture.

All 27 ADRs live under `docs/decisions/`. Phase 11 added one (0027). Phase 12 will likely add ADR 0028 at 12.1 covering the worker-sandbox contract.

---

## Recently completed (last 5 phase closes / major steps)

- **Phase 11 closed** — 2026-04-26 — this commit + tag `phase-11-web-ui-9b-closed`. Web UI 9b mutation surface shipped. Three new routes + three new SPA forms + two new SPA pages + three-tier budget resolution + GET /api/v1/projects prerequisites. Live-validated end-to-end via operator browser smoke. ADR 0027 accepted.
- **Phase 11 sub-step 11.6 — Live validation** — 2026-04-26 — `db90421 docs(11.6)`. Operator-driven browser smoke against real factoryd; full assisted-mode build + two mid-stream answers + project-tier budget propagation all verified. $4.25 spend.
- **Phase 11 sub-step 11.5 — SPA write affordances** — 2026-04-26 — `08a0d63 feat(11.5)`. Three forms wired in `apps/factory-web/`. New pages: `build.astro`, `projects/{index,detail}.astro`. Modified: `questions/detail.astro` (answer form). New helpers: `apiPost` / `apiPut` in `src/lib/api.ts`. Shared form CSS primitives in `Dashboard.astro`. Read-side prerequisites: `GET /api/v1/projects` (list) + `GET /api/v1/projects/:id` (detail). +10 daemon tests.
- **Phase 11 sub-step 11.4 — Project budget defaults route** — 2026-04-26 — `3231c5c feat(11.4)`. New `PUT /api/v1/projects/:id/budget` (full-document replacement). New `projectBudgetDefaultsSchema` in @factory5/core; new `budgetDefaultsFromProjectMeta` + `updateProjectMetadata` + `ProjectMetadataNotFoundError` in @factory5/wiki. Build resolution upgraded from two-tier to three-tier in both CLI and daemon code paths. +9 wiki tests, +12 daemon tests.
- **Phase 11 sub-step 11.3 — Build creation route** — 2026-04-26 — `dcaa0a3 feat(11.3)`. New `POST /api/v1/builds` mirroring `factory build <project>` server-side (same `resolveProjectPath` + `loadOrCreateProjectMetadata` chain; refuses to create new projects per Phase 11 charter). Refactor: `languageFromProjectMeta` moved from cli/build.ts to @factory5/wiki + new `ProjectLanguage` type. +11 daemon tests.

---

## Attempts that didn't work (current step only)

- None for Phase 12 yet — phase hasn't opened.

---

## Environment snapshot

- **Language / runtime:** TypeScript strict mode on Node 20+ (ADR 0001). pnpm workspaces. ESM (NodeNext) with explicit `.js` import extensions.
- **Key pinned deps (unchanged from Phase 10 close):** `astro ^5.0.0`, `@astrojs/check ^0.9.0` (in `apps/factory-web/`); `@fastify/static ^7.0.0` (in `@factory5/daemon`); Pino, Zod, Commander, Fastify v4, better-sqlite3, discord.js, chokidar, simple-git, vitest, ulid, `@modelcontextprotocol/sdk ^1.0.0`. **No new external deps in Phase 11.**
- **Model in use:** Claude Opus 4.7 for session work.
- **Other:** Windows + Linux cross-platform mandatory. **14 packages + 3 apps**. **717 tests**. `CHANNEL_IDS` narrowed to `['cli','discord','telegram']` (ADR 0019). Budget enforcement per ADR 0020. Project identity via `.factory/project.json` (ADR 0021). Cross-session spend via `factory spend` (7b.3). Telegram channel via plugin-owned long-poll (ADR 0022). Instance data dir via cwd-walk (ADR 0023). Worker `ask_user` per ADR 0024. Web UI per ADR 0025 + mutation surface per ADR 0027. Pluggable runtime per ADR 0026.
- **Host toolchain at Phase 10 close (still current):** pnpm 9.12.0, Node v22.22.2, Go 1.26.2, Rust/Cargo 1.95.0 — all on PATH.

---

## Notes for next session

If resuming after `/session-end` or a cold start:

1. Read `CLAUDE.md` (root) — standing brief incl. Control-framework section.
2. Read this STATE.md.
3. Read `.control/phases/phase-12-worker-fs-scoping/{README.md,steps.md}` — Phase 12 charter.
4. Skim Phase 11 carry-forwards above; I009 + I014 are the most likely mid-Phase-12 opportunities if the worker-side touch makes them adjacent.
5. Run `/session-start` for the full drift check.

**Budget for Phase 12:** ~2–3 sessions. 12.1 (ADR) is design-only ($0). 12.2 (implementation) is mostly TS work ($0); 12.3 (tests) likewise. 12.4 (live validation) needs one cheap real build — pick a Phase 10 fixture (`go-line-counter` or `rust-csv-summary`, both small) so the smoke costs $2–4. 12.5 (phase close) is documentation.

**Memory:** unchanged from Phase 11 close. `feedback_use_frontend_design_skill.md` still applies to any future SPA work; no new memories from Phase 11.6 + 11.7.

**Carry-forward** (still non-blocking):

- I009 (MEDIUM) + I012 (LOW) + I014 (MEDIUM).
- Stale-dist dev-loop gotcha — needs design.
- `factory ui-token` CLI command (ADR 0025 §2).
- Phase 6 operator follow-up.
