# Project State

> Single source of truth for Control's operational cursor. Read this first every session. Updated at every `/session-end` and by the `PreCompact` hook.

**Last updated:** 2026-04-27 (session `2026-04-26T19`, session-end after Phase 12 close) — Phase 12 closed at `ed88a60` with tag `phase-12-worker-fs-scoping-closed`. ADR 0028 + new package `@factory5/worker-sandbox` + worker wiring + 96 new regression tests + operator-driven live validation. Phase 13 (operator experience polish + carry-forward sweep) scaffolded; kicks off next session at 13.1.
**Current phase:** 13 — Operator experience polish + carry-forward sweep — **🟢 active**
**Current sub-phase:** n/a — single-charter phase
**Current step:** 13.1 — File-sink logger bug (next)
**Status:** Working tree clean. **813 tests** green across 15 packages. `pnpm lint` + `pnpm format:check` clean. `pnpm build` clean across 15 packages + 3 apps.

---

## Project spec

**Canonical:** `CompleteArchitecture.md` at root. §22 "Pluggable runtimes" added at Phase 10 close. §23 "Web UI mutation surface" added at Phase 11 close. **§24 "Worker filesystem-scoping" added at Phase 12 close.** Phase 13 is a sweep phase — likely no `CompleteArchitecture.md` change unless 13.1's logger fix changes the multistream contract.
**Current reference:** `docs/ARCHITECTURE.md` (evolves), `docs/CONTRACTS.md`, `docs/SKILLS.md`, `docs/AGENTS.md`.
**Phase history:** `docs/PROGRESS.md` (chronological). `docs/Phase12_Progress.md` written at Phase 12 close (one charter doc per phase pattern). `docs/Phase13_Progress.md` will land at 13.5.
**Role:** the `docs/` tree is authoritative. `.control/architecture/overview.md` is a pointer.

---

## Next action

**Sub-step 13.1 — File-sink logger bug.** Investigate why `<dataDir>/logs/factoryd-<YYYY-MM-DD>.log` does not materialise on disk despite `mkdirSync(logsDir, { recursive: true })` running during `initLogger`. Pretty-printed stdout works (multistream construction succeeds); only the file destination is broken. Trace `pino.destination({ sync: false, mkdir: true })` for silently-swallowed errors. File a major issue under `docs/issues/` first (regression-test required before close per CLAUDE.md), then write the regression test in `@factory5/logger`, then fix.

After 13.1: 13.2 (`factory ui-token` CLI command — ADR 0025 §2 carry-forward), 13.3 (I009 fix — extract `resolveDirectiveLimits` shared helper), 13.4 (I014 fix — architect commits wiki on resume), 13.5 (phase close).

The Phase 12 forward queue identified Phase 13's four targets: file-sink logger (12.4-discovered), `factory ui-token` (Phase 7+ carry-forward; operator just hit the friction during 12.4), I009 (Phase 11 carry-forward, amplified by 11.4), I014 (Phase 10 carry-forward).

---

## Git state

- **Branch:** main (ahead of `origin/main` by 7 commits — push at operator discretion).
- **Last commit:** session-end `docs(state)` lands on top of Phase-12 close. Recent log: this session-end commit → `ed88a60 chore(phase-12)` (Phase 12 close, tag here) → `09b0876 docs(12.4)` → `1f070f9 test(12.3)` → `fab1327 feat(12.2)` → `452db47 docs(12.1)` → `1cc13ed docs(state)` (Phase 11 session-end) → `fa5ee25 chore(phase-11)` (Phase 11 close, tag there). Tag `phase-12-worker-fs-scoping-closed` placed on `ed88a60`.
- **Uncommitted changes:** none at session end (modulo `.claude/scheduled_tasks.lock` which the harness rewrites on session resume — gets swept up at the next harness chore commit).
- **Last phase tag:** `phase-12-worker-fs-scoping-closed` (placed on `ed88a60`).

Earlier tags intact: `phase-11-web-ui-9b-closed`, `phase-10-assessor-tier3-closed`, `phase-9-web-ui-closed`, `phase-8-worker-ask-user-closed`, `addendum-onboarding-closed`, `phase-7c-telegram-channel-closed`, `phase-7b-spend-dashboard-closed`, `phase-7a-budget-enforcement-closed`, `phase-7-closed`, `phase-6-closed`, `phase-6a-findings-registry-closed`, `phase-6c-verifier-overhaul-closed`, `protocol-initialised`.

---

## Open blockers

- **None for Phase 13.** All carry-forwards below are non-blocking.
- **Carry-forward** (12.4-discovered + Phase 10/11 long-tail):
  - **File-sink logger bug** (MAJOR, OPEN, `@factory5/logger`) — `<dataDir>/logs/factoryd-*.log` does not materialise despite `mkdirSync` running. Pretty-printed stdout works; only file sink broken. Discovered during 12.4 operator investigation. Phase 13.1 — file as a major issue + regression test + fix.
  - **`factory ui-token` CLI command** (MEDIUM, OPEN, ADR 0025 §2 carry-forward) — operator closes terminal → loses dashboard URL; per-startup token rotation means restart loses session tabs. On the carry-forward list since Phase 7. Phase 13.2.
  - **I009** (MEDIUM, OPEN, `channels/telegram` + `channels/discord`) — Telegram/Discord inbound `/build` doesn't inherit `[budget.defaults]`. After 11.4 it skips two tiers (project + config), not one. Right fix: extract a shared `resolveDirectiveLimits(projectMeta, cfg, explicitFlags)` helper in `@factory5/brain` or `@factory5/wiki`. Phase 13.3.
  - **I014** (MEDIUM, OPEN, `brain/architect`) — architect re-running on existing project leaves wiki edits uncommitted, dirty-tripping `gate.verify`. Targeted fix: stage + commit at end of `runArchitect` if a git repo exists. Phase 13.4.
  - **I012** (LOW, OPEN, `channels/telegram`) — `maybeAnswerPendingQuestion` FIFO matcher can't target a specific open question. Carries forward.
  - **14 stale "open" pending_questions** (LOW) — orphaned escalations from older directives that completed without being answered. One-shot DB sweep when convenient.
  - **PowerShell em-dash mojibake** (LOW) — operator-side console codepage issue (`[Console]::OutputEncoding = [System.Text.Encoding]::UTF8`); not a factory5 bug.
  - **Stale-dist dev-loop gotcha** — Phase 9's recommended one-line fix is incompatible with the prod runtime path; needs design (conditional exports + `--conditions=development`, OR app-side bundling with full transitive npm deps declared). Workaround: `pnpm build` after editing workspace deps before running `pnpm factoryd`.
  - **Phase 6 operator follow-ups** (PAT revoke, `gh repo delete`, env var cleanup) — out-of-band.

---

## In-flight work

- None. Phase 12 closed clean; Phase 13 hasn't opened (waits for next session + 13.1).

---

## Test / eval status

- **Last test run:** 2026-04-26 (Phase 12 close gate) — **813 tests** across 15 packages, all green on Windows. `pnpm lint` + `pnpm format:check` clean. `pnpm build` clean across 15 packages + 3 apps.
- **Per-package counts (post-Phase-12):** core 14, logger 13, ipc 14, providers 39, state 134, assessor 79, wiki 58, channels 62, events 3, worker 38 (+10 sandbox-integration), brain 74, daemon 121, cli 63, worker-mcp 15, **worker-sandbox 89** (86 passed + 3 Linux-only skipped on Windows runner — NEW). Sum = 813.
- **Live run datapoints:** Phase 12.4 — `log-totals-cli` directive `01KQ5PNR3GYMCW48NBWVZQE75W` ran end-to-end via `factory build` under the new gate, $3.07, terminal status `blocked` (4 blocking + 4 advisory findings). 4 `worker.sandbox: gate up` lines emitted; **zero deny lines** across the full build. Builder `4p8pb1j2` advanced base from `aa3a1263 → 0d4dcbc3` with 1 file changed under the gate. Worktree cleanup all clean — `.factory/worktrees/` empty on disk post-build.
- **Pre-existing flake:** `packages/daemon/src/pidfile.test.ts > pidfile > reaps a stale pidfile (dead owner)` flaked once under parallel test load on Windows during Phase 11; passed on retry and in isolation. Not from any Phase 11 / 12 change; documented for awareness, no action taken.

---

## Recent decisions (last 3 ADRs)

- **ADR 0028** (2026-04-26) — Worker-sandbox contract: gate site + path-prefix algebra + out-of-scope behaviour + Bash story + write-vs-read scope. Five sub-decisions in one ADR (multi-decision shape per ADRs 0024/0025/0026/0027): (1) gate site — three Claude Code-native primitives layered per-spawn (`permissions.deny` + PreToolUse hook + `--permission-mode acceptEdits`); MCP middleware infeasible (Claude Code's MCP layer adds tools, can't intercept built-ins); OS sandbox too heavy + not cross-platform. (2) Path-prefix algebra `{ workspaceRoots, readOnlyRoots, allowSymlinks }` with Windows case-insensitive + UNC + symlink-rejection edges. (3) Hard-error out-of-scope (`permissionDecision: deny` listing allowed roots, never deny rules — no evasion hints). (4) Bash story accepted as Phase 12 limitation; OS-level Bash sandboxing deferred. (5) Write-vs-read scope — explicit asymmetry; writes worktree-only, reads broader.
- **ADR 0027** (2026-04-26) — Web UI mutation surface.
- **ADR 0026** (2026-04-24) — Pluggable assessor runtimes.

All 28 ADRs live under `docs/decisions/`. Phase 12 added one (0028). Phase 13 is a sweep phase — no new ADRs expected unless 13.1 surfaces a multistream-design decision.

---

## Recently completed (last 5 phase closes / major steps)

- **Phase 12 closed** — 2026-04-26 — this commit + tag `phase-12-worker-fs-scoping-closed`. Worker filesystem-scoping shipped. ADR 0028 + new 15th workspace package `@factory5/worker-sandbox` + worker wiring + 96 new tests + operator-driven live validation. Three forcing functions paid down (F001, Phase 8 carry-forward, I013).
- **Phase 12 sub-step 12.4 — Live validation** — 2026-04-26 — `09b0876 docs(12.4)`. Operator-driven `factory build log-totals-cli`; 5/5 tasks succeeded under the gate, 4 sandbox-up lines, zero deny lines, $3.07 spend.
- **Phase 12 sub-step 12.3 — Regression tests** — 2026-04-26 — `1f070f9 test(12.3)`. 96 new tests across `worker-sandbox` (89: path-prefix + evaluate-tool-call + settings + hook-runtime) + `worker` (10: sandbox-integration). Includes F001 replay scenario, cross-platform out-of-scope, symlink rejection.
- **Phase 12 sub-step 12.2 — Implementation** — 2026-04-26 — `fab1327 feat(12.2)`. New `@factory5/worker-sandbox` package + `prepareSandbox` helper in `runWorker.ts` + `permissionMode` flip from `bypassPermissions` to `acceptEdits` + `FACTORY5_DISABLE_WORKER_SANDBOX` env var + `worker.sandbox` logger.
- **Phase 12 sub-step 12.1 — ADR 0028** — 2026-04-26 — `452db47 docs(12.1)`. Five-decision multi-part ADR pinning the worker-sandbox contract before any code landed.

---

## Attempts that didn't work (current step only)

- None for Phase 13 yet — phase hasn't opened.

---

## Environment snapshot

- **Language / runtime:** TypeScript strict mode on Node 20+ (ADR 0001). pnpm workspaces. ESM (NodeNext) with explicit `.js` import extensions.
- **Key pinned deps (unchanged from Phase 11 close):** `astro ^5.0.0`, `@astrojs/check ^0.9.0` (in `apps/factory-web/`); `@fastify/static ^7.0.0` (in `@factory5/daemon`); Pino, Zod, Commander, Fastify v4, better-sqlite3, discord.js, chokidar, simple-git, vitest, ulid, `@modelcontextprotocol/sdk ^1.0.0`. **No new external deps in Phase 12.**
- **Model in use:** Claude Opus 4.7 for session work.
- **Other:** Windows + Linux cross-platform mandatory. **15 packages + 3 apps** (`@factory5/worker-sandbox` added at 12.2). **813 tests**. `CHANNEL_IDS` narrowed to `['cli','discord','telegram']` (ADR 0019). Budget enforcement per ADR 0020. Project identity via `.factory/project.json` (ADR 0021). Cross-session spend via `factory spend` (7b.3). Telegram channel via plugin-owned long-poll (ADR 0022). Instance data dir via cwd-walk (ADR 0023). Worker `ask_user` per ADR 0024. Web UI per ADR 0025 + mutation surface per ADR 0027. Pluggable runtime per ADR 0026. **Worker filesystem-scoping per ADR 0028.**
- **Host toolchain at Phase 10 close (still current):** pnpm 9.12.0, Node v22.22.2, Go 1.26.2, Rust/Cargo 1.95.0 — all on PATH.

---

## Notes for next session

If resuming after `/session-end` or a cold start:

1. Read `CLAUDE.md` (root) — standing brief incl. Control-framework section.
2. Read this STATE.md.
3. Read `.control/phases/phase-13-operator-experience/{README.md,steps.md}` — Phase 13 charter.
4. Skim Phase 12 carry-forwards above; the file-sink logger bug (13.1) blocks future on-disk debugging until resolved.
5. Run `/session-start` for the full drift check.

**Budget for Phase 13:** ~2–3 sessions. All four sub-steps are TS work, $0 spend. Optional cheap smoke run after 13.3 to verify Telegram inbound path picks up project-tier defaults — pick a small fixture so the smoke costs $1–3 if exercised.

**Memory:** unchanged from Phase 12 close. `feedback_use_frontend_design_skill.md` still applies to any future SPA work; `feedback_fix_root_causes.md` continues to apply (paying down debt is exactly the spirit). No new memories from Phase 12.

**Carry-forward** (still non-blocking):

- File-sink logger bug (Phase 13.1, MAJOR) + `factory ui-token` CLI (Phase 13.2, MEDIUM) + I009 (Phase 13.3, MEDIUM) + I014 (Phase 13.4, MEDIUM).
- I012 (LOW). Stale "open" pending_questions cleanup. PowerShell em-dash mojibake (operator-side fix). Stale-dist dev-loop gotcha. Phase 6 operator follow-ups.
