# Project State

> Single source of truth for Control's operational cursor. Read this first every session. Updated at every `/session-end` and by the `PreCompact` hook.

**Last updated:** 2026-04-27T20:45:00Z (session `2026-04-27T19`, post Phase 14 close commit) — Phase 14 closed with tag `phase-14-carry-forward-continuation-closed`. Five sub-steps shipped in a single sustained session arc the same day Phase 13 closed: 14.1 (stale-dist dev-loop / conditional exports) → 14.2 (I013 status reconciliation) → 14.3 (I012 / `bot_message_id` targeting) → 14.4 (`factory questions cleanup` CLI + Windows mojibake README) → 14.5 (phase close). No new ADRs (sweep phase). `docs/issues/INDEX.md` Open table is empty for the first time. Phase 15 (Demand-driven runoff) scaffolded; opens when something bites.
**Current phase:** 15 — Demand-driven runoff — **⏸ pending demand signal**
**Current sub-phase:** n/a — single-charter phase
**Current step:** 15.1 — first demand signal (placeholder; phase opens against whatever bites)
**Status:** Working tree clean. **876 tests** green across 15 packages. `pnpm lint` + `pnpm format:check` clean. `pnpm build` clean across 15 packages + 3 apps.

---

## Project spec

**Canonical:** `CompleteArchitecture.md` at root. §22 "Pluggable runtimes" added at Phase 10 close. §23 "Web UI mutation surface" added at Phase 11 close. §24 "Worker filesystem-scoping" added at Phase 12 close. **No §25 yet** — Phase 13 + Phase 14 were both sweep phases, neither shipped a new architectural seam.
**Current reference:** `docs/ARCHITECTURE.md` (evolves), `docs/CONTRACTS.md`, `docs/SKILLS.md`, `docs/AGENTS.md`.
**Phase history:** `docs/PROGRESS.md` (chronological). `docs/Phase14_Progress.md` written at 14.5. `docs/Phase15_Progress.md` will land at the eventual 15.x phase close (or as a still-quiet close if no sub-steps fire).
**Role:** the `docs/` tree is authoritative. `.control/architecture/overview.md` is a pointer.

---

## Next action

**Phase 15 is paused, pending demand signal.** No predetermined first sub-step. The candidate pool, in rough priority but not pre-decided (per `.control/phases/phase-15-demand-driven-runoff/README.md`):

1. **Bash sandboxing.** ADR 0028 §4 explicitly deferred this. Phases 12.4, 13.x, 14.x all produced zero `decision":"deny"` lines from the existing tool gate — demand signal still absent. Open this only on a real incident.
2. **`/build` flag parsing on Telegram + Discord.** Today an inbound `/build foo --max-usd 5` parses the whole text as a project name. The shared `resolveDirectiveLimits` helper from 13.3 already accepts an `explicitFlags` slot — wiring is one line once the parser exists. Defer until an operator asks.
3. **Network egress scoping.** Long-tail concern; wait for an egress-policy demand signal.
4. **Orphan `node.exe` on port 25295 investigation.** Noted during Phase 14.1 smoke — a Node process at `C:\Program Files (x86)\nodejs\node.exe` (older Node install) is squatting on factoryd's default port. Not from any factoryd we ran (no pidfile). Could be diagnostic-only or surface a deeper issue.
5. **Phase 6 operator follow-ups** — PAT revoke, `gh repo delete`, env var cleanup. Out-of-band.
6. **Anything new the operator surfaces.** New issues, post-`pnpm factoryd` smoke findings, feature requests.

If nothing has bitten by next session: do nothing. Phase 15 is a paused state, not a queued backlog. The right move is to run `/session-start`, confirm state, and end the session if no work signals are present.

---

## Git state

- **Branch:** main (ahead of `origin/main` by 62 commits — push at operator discretion).
- **Last commit:** `<phase-14-close-sha> chore(phase-14): close phase 14, kick off phase 15`. Phase 14 close + Phase 15 scaffold landed in one commit; tag `phase-14-carry-forward-continuation-closed` placed on this SHA. Recent log: this close commit → `448505f fix(14.4)` (questions cleanup CLI + Windows mojibake README) → `6e40872 fix(14.3)` (I012 / `bot_message_id`) → `ee96dcd fix(14.2)` (I013 → RESOLVED) → `95b901b fix(14.1)` (conditional exports for dev hot-reload) → `208d4ad docs(state)` (Phase 13 session-end) → `eb4ade3 chore(phase-13)` (Phase 13 close, tag).
- **Uncommitted changes:** none at session boundary.
- **Last phase tag:** `phase-14-carry-forward-continuation-closed` (placed on the close commit).

Earlier tags intact: `phase-13-operator-experience-closed`, `phase-12-worker-fs-scoping-closed`, `phase-11-web-ui-9b-closed`, `phase-10-assessor-tier3-closed`, `phase-9-web-ui-closed`, `phase-8-worker-ask-user-closed`, `addendum-onboarding-closed`, `phase-7c-telegram-channel-closed`, `phase-7b-spend-dashboard-closed`, `phase-7a-budget-enforcement-closed`, `phase-7-closed`, `phase-6-closed`, `phase-6a-findings-registry-closed`, `phase-6c-verifier-overhaul-closed`, `protocol-initialised`.

---

## Open blockers

- **None for Phase 15.** `docs/issues/INDEX.md` Open table is **empty for the first time** since the issue tracker was instituted. Both prior open issues (I012 + I013) moved to RESOLVED in Phase 14.
- **Phase 15 candidate pool** (all non-blocking, demand-signal-driven):
  - **Bash sandboxing** (incident-driven; ADR 0028 §4 deferral).
  - **`/build` flag parsing on Telegram + Discord** (operator-request-driven).
  - **Network egress scoping** (demand-driven).
  - **Orphan `node.exe` on port 25295** (diagnostic; noted during 14.1 smoke).
  - **Phase 6 operator follow-ups** (out-of-band) — PAT revoke, `gh repo delete`, env var cleanup.

---

## In-flight work

- None. Phase 14 closed clean; Phase 15 hasn't opened (waits for demand signal).

---

## Test / eval status

- **Last test run:** 2026-04-27 (Phase 14.5 close gate) — **876 tests** across 15 packages, all green on Windows. `pnpm lint` + `pnpm format:check` clean. `pnpm build` clean across 15 packages + 3 apps.
- **Per-package counts (post-Phase-14):** core 14, logger 20, ipc 14, providers 39, state 146 (+12 from 14.3 + 14.4: 5 `setBotMessageId`/`findOpenByBotMessageId` + 7 `findOrphaned`/`markOrphanAnswered`), assessor 79, wiki 64, channels 70 (+2 from 14.3 telegram regressions), events 3, worker 38, worker-mcp 15, worker-sandbox 89 (86 passed + 3 Linux-only skipped on Windows runner), brain 82, daemon 131 (+2 from 14.3 outbound-worker), cli 75 (+5 from 14.4 `runQuestionsCleanup`). Sum (passing) = 876.
- **Live run datapoints this phase:** 14.1 verified with a real `pnpm factoryd` boot (with `packages/daemon/dist/` removed) on Node 22.22.2 + tsx 4.21.0. No spend; just confirmed src routing works under `--conditions=development` and that the absence of the flag fails with `ERR_MODULE_NOT_FOUND` against missing dist. The other three sub-steps were unit-test only.
- **Pre-existing flake (still tracked):** `packages/daemon/src/pidfile.test.ts > pidfile > reaps a stale pidfile (dead owner)` flaked once under parallel test load on Windows during Phase 11; passed on retry and in isolation. Not from any Phase 11–14 change. No action taken.

---

## Recent decisions (last 3 ADRs)

- **ADR 0028** (2026-04-26, Phase 12) — Worker-sandbox contract: gate site + path-prefix algebra + out-of-scope behaviour + Bash story + write-vs-read scope. Five sub-decisions in one ADR.
- **ADR 0027** (2026-04-26, Phase 11) — Web UI mutation surface.
- **ADR 0026** (2026-04-24, Phase 10) — Pluggable assessor runtimes.

All 28 ADRs live under `docs/decisions/`. **Phase 13 + Phase 14 each added zero ADRs** (sweep phases).

---

## Recently completed (last 5 phase closes / major steps)

- **Phase 14 closed** — 2026-04-27 — `<phase-14-close-sha> chore(phase-14)` + tag `phase-14-carry-forward-continuation-closed`. Sweep phase: I012 + I013 → RESOLVED, conditional exports for dev hot-reload, `factory questions cleanup` CLI, Windows mojibake README addendum. 855 → 876 tests; no new ADRs; no `CompleteArchitecture.md` change. `docs/issues/INDEX.md` Open table now empty.
- **Phase 14 sub-step 14.4 — `factory questions cleanup` CLI + Windows mojibake README** — 2026-04-27 — `448505f fix(14.4)`. New `findOrphaned` / `markOrphanAnswered` helpers; pure `runQuestionsCleanup` for testability; "Windows operator tips" subsection in README.
- **Phase 14 sub-step 14.3 — I012 → RESOLVED** — 2026-04-27 — `6e40872 fix(14.3)`. Migration 008 (`pending_questions.bot_message_id`); outbound-worker stamp on delivery; new exact rung in Telegram matcher. Discord untouched (Phase 7c live data showed no FIFO mismatch).
- **Phase 14 sub-step 14.2 — I013 → RESOLVED** — 2026-04-27 — `ee96dcd fix(14.2)`. Pure doc reconciliation; `prePurgeDepDirs` + regression test were already shipped in Phase 10.3 (`50bab61`).
- **Phase 14 sub-step 14.1 — Stale-dist dev-loop (conditional exports)** — 2026-04-27 — `95b901b fix(14.1)`. Each `packages/*/package.json` gained a `development` condition; root scripts pass `--conditions=development`. Verified by booting factoryd with `packages/daemon/dist/` removed.

---

## Attempts that didn't work (current step only)

- None for Phase 15 yet — phase hasn't opened.

---

## Environment snapshot

- **Language / runtime:** TypeScript strict mode on Node 20+ (ADR 0001). pnpm workspaces. ESM (NodeNext) with explicit `.js` import extensions. Workspace packages now resolve to `src/` under `--conditions=development` (Phase 14.1) and `dist/` otherwise.
- **Key pinned deps:** unchanged from Phase 13 close. `astro ^5.0.0`, `@astrojs/check ^0.9.0`, `@fastify/static ^7.0.0`, Pino, Zod, Commander, Fastify v4, better-sqlite3, discord.js, chokidar, vitest, ulid, `simple-git ^3.25.0` (explicit in `@factory5/brain` since Phase 13), `@modelcontextprotocol/sdk ^1.0.0`.
- **Model in use:** Claude Opus 4.7 for session work.
- **Other:** Windows + Linux cross-platform mandatory. **15 packages + 3 apps**. **876 tests**. **8 schema migrations** (latest: `008-pending-questions-bot-message-id`, Phase 14.3). `CHANNEL_IDS` narrowed to `['cli','discord','telegram']` (ADR 0019). Budget enforcement per ADR 0020 + Phase 13.3's shared helper. Project identity via `.factory/project.json` (ADR 0021). Cross-session spend via `factory spend` (7b.3). Telegram channel via plugin-owned long-poll (ADR 0022). Instance data dir via cwd-walk (ADR 0023). Worker `ask_user` per ADR 0024. Web UI per ADR 0025 + mutation surface per ADR 0027 + `factory ui-token` CLI (Phase 13.2). Pluggable runtime per ADR 0026. Worker filesystem-scoping per ADR 0028. New surfaces this phase: `factory questions cleanup` (Phase 14.4) + Telegram Reply-feature exact-question targeting (Phase 14.3) + dev-mode workspace-package routing through `src/` (Phase 14.1).
- **Host toolchain at Phase 10 close (still current):** pnpm 9.12.0, Node v22.22.2, Go 1.26.2, Rust/Cargo 1.95.0 — all on PATH. tsx 4.21.0.

---

## Notes for next session

If resuming after `/session-end` or a cold start:

1. Read `CLAUDE.md` (root) — standing brief incl. Control-framework section.
2. Read this STATE.md.
3. Read `.control/phases/phase-15-demand-driven-runoff/{README.md,steps.md}` — Phase 15 charter (paused state).
4. Skim Phase 15 candidate pool above. **No predetermined first sub-step**; phase opens when something bites.
5. Run `/session-start` for the full drift check.

**Budget for Phase 15:** indefinite. If something fires, bound by the candidate's scope (Bash sandboxing would likely be its own multi-session phase with an ADR; `/build` flag parsing is a one-line wiring on top of an existing helper; orphan node.exe is diagnostic-only). $0 baseline assumed unless a candidate fires that involves live-LLM verification (none in the current pool).

**Memory:** unchanged from Phase 13 close. `feedback_use_frontend_design_skill.md` still applies to any future SPA work; `feedback_fix_root_causes.md` continues to apply (Phase 14.3 was another instance of it — declined the easy stop-gap, did the schema-column fix). No new memories from Phase 14.

**Carry-forward** (Phase 15 candidate pool, all non-blocking):

- Bash sandboxing (incident-driven) + `/build` flag parsing (operator-request-driven) + network egress scoping (demand-driven) + orphan `node.exe` on port 25295 (diagnostic) + Phase 6 operator follow-ups (out-of-band).

**Stable-state observation:** factory5's open issue tracker is empty, all carry-forwards from Phases 9–13 are addressed, and the codebase is at the most stable point in its history. If demand signal stays absent for several sessions, it may be appropriate to close Phase 15 as a "still-quiet" close without sub-steps and exit the active Control phase chain until new work surfaces.
