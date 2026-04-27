# Project State

> Single source of truth for Control's operational cursor. Read this first every session. Updated at every `/session-end` and by the `PreCompact` hook.

**Last updated:** 2026-04-27T22:30:00Z (session `2026-04-27T22`, still-quiet pass-through after Phase 14 close) — No demand signal surfaced this session. Phase 15 remains paused. No code edits, no sub-step opened, no live-LLM spend, no new issues filed. The session was a `/session-start` → confirm-state → `/session-end` pass-through. Single `docs(state)` commit refreshes the cursor + a journal entry recording the still-quiet pass.
**Current phase:** 15 — Demand-driven runoff — **⏸ pending demand signal** (now across two consecutive session boundaries)
**Current sub-phase:** n/a — single-charter phase
**Current step:** 15.1 — first demand signal (placeholder; phase opens against whatever bites; no demand surfaced as of this session)
**Status:** Working tree clean. **876 tests** green across 15 packages (last gate, Phase 14.5 close — not re-run this session; no code changed since). `pnpm lint` + `pnpm format:check` clean. `pnpm build` clean across 15 packages + 3 apps.

---

## Project spec

**Canonical:** `CompleteArchitecture.md` at root. §22 "Pluggable runtimes" added at Phase 10 close. §23 "Web UI mutation surface" added at Phase 11 close. §24 "Worker filesystem-scoping" added at Phase 12 close. **No §25 yet** — Phase 13 + Phase 14 were both sweep phases, and Phase 15's still-quiet pass-through changes nothing architectural either.
**Current reference:** `docs/ARCHITECTURE.md` (evolves), `docs/CONTRACTS.md`, `docs/SKILLS.md`, `docs/AGENTS.md`.
**Phase history:** `docs/PROGRESS.md` (chronological). `docs/Phase14_Progress.md` written at 14.5. `docs/Phase15_Progress.md` will land at the eventual 15.x phase close — either against a real sub-step deliverable or as a still-quiet close (latter increasingly likely given two consecutive sessions with no demand signal).
**Role:** the `docs/` tree is authoritative. `.control/architecture/overview.md` is a pointer.

---

## Next action

**Phase 15 remains paused, pending demand signal — now across two consecutive session boundaries.** No code work indicated this session. The candidate pool is unchanged from Phase 14 close (no new bite has surfaced):

1. **Bash sandboxing.** ADR 0028 §4 explicitly deferred this. Phases 12.4, 13.x, 14.x — and now this still-quiet 15-pass — all produced zero `decision":"deny"` lines from the existing tool gate. Demand signal still absent. Open this only on a real incident.
2. **`/build` flag parsing on Telegram + Discord.** Today an inbound `/build foo --max-usd 5` parses the whole text as a project name. The shared `resolveDirectiveLimits` helper from 13.3 already accepts an `explicitFlags` slot — wiring is one line once the parser exists. Defer until an operator asks for inline overrides.
3. **Network egress scoping.** Long-tail concern; wait for an egress-policy demand signal.
4. **Orphan `node.exe` on port 25295 investigation.** Noted during Phase 14.1 smoke — a Node process at `C:\Program Files (x86)\nodejs\node.exe` (older Node install) is squatting on factoryd's default port. Not from any factoryd we ran (no pidfile). Could be diagnostic-only or surface a deeper issue.
5. **Phase 6 operator follow-ups** — PAT revoke, `gh repo delete`, env var cleanup. Out-of-band.
6. **Anything new the operator surfaces.** New issues, post-`pnpm factoryd` smoke findings, feature requests.

**Bias for the next session:** if no demand signal has surfaced by then, the recommended move is to close Phase 15 still-quiet — `phase-15-demand-driven-runoff-closed` tag + `docs/Phase15_Progress.md` recording dormancy + a one-line `docs/PROGRESS.md` entry. Then exit the active Control-managed phase chain until new work demands a phase frame. The phase charter explicitly enables this path; it is a one-commit operation since no sub-steps need rolling up. If demand surfaces between now and then, open 15.1 against whatever bites instead.

---

## Git state

- **Branch:** main (ahead of `origin/main` by 65 commits — push at operator discretion).
- **Last commit:** the `docs(state)` session-end commit produced by this still-quiet pass-through. Recent log: this commit (`docs(state)` still-quiet 15-pass) → `1626ced docs(state)` (prior session-end for 14.5) → `d583117 docs(journal)` (Phase 14 close journal append) → `6cc0008 chore(phase-14)` (Phase 14 close + Phase 15 scaffold; tag here) → `448505f fix(14.4)` → `6e40872 fix(14.3)` → `ee96dcd fix(14.2)` → `95b901b fix(14.1)` → `208d4ad docs(state)` (Phase 13 session-end) → `eb4ade3 chore(phase-13)`.
- **Uncommitted changes:** none at session boundary.
- **Last phase tag:** `phase-14-carry-forward-continuation-closed` (placed on `6cc0008`).

Earlier tags intact: `phase-13-operator-experience-closed`, `phase-12-worker-fs-scoping-closed`, `phase-11-web-ui-9b-closed`, `phase-10-assessor-tier3-closed`, `phase-9-web-ui-closed`, `phase-8-worker-ask-user-closed`, `addendum-onboarding-closed`, `phase-7c-telegram-channel-closed`, `phase-7b-spend-dashboard-closed`, `phase-7a-budget-enforcement-closed`, `phase-7-closed`, `phase-6-closed`, `phase-6a-findings-registry-closed`, `phase-6c-verifier-overhaul-closed`, `protocol-initialised`.

---

## Open blockers

- **None for Phase 15.** `docs/issues/INDEX.md` Open table remains **empty** — no new issues filed this session, no carry-forward fires.
- **Phase 15 candidate pool** (unchanged from Phase 14 close; all non-blocking, demand-signal-driven):
  - **Bash sandboxing** (incident-driven; ADR 0028 §4 deferral).
  - **`/build` flag parsing on Telegram + Discord** (operator-request-driven).
  - **Network egress scoping** (demand-driven).
  - **Orphan `node.exe` on port 25295** (diagnostic; noted during 14.1 smoke).
  - **Phase 6 operator follow-ups** (out-of-band) — PAT revoke, `gh repo delete`, env var cleanup.

---

## In-flight work

- None. Phase 15 remains paused; no code edits this session.

---

## Test / eval status

- **Last test run:** 2026-04-27 (Phase 14.5 close gate; **not re-run this session** — no code changed since) — **876 tests** across 15 packages, all green on Windows. `pnpm lint` + `pnpm format:check` clean. `pnpm build` clean across 15 packages + 3 apps.
- **Per-package counts (post-Phase-14):** core 14, logger 20, ipc 14, providers 39, state 146 (+12 from 14.3 + 14.4: 5 `setBotMessageId`/`findOpenByBotMessageId` + 7 `findOrphaned`/`markOrphanAnswered`), assessor 79, wiki 64, channels 70 (+2 from 14.3 telegram regressions), events 3, worker 38, worker-mcp 15, worker-sandbox 89 (86 passed + 3 Linux-only skipped on Windows runner), brain 82, daemon 131 (+2 from 14.3 outbound-worker), cli 75 (+5 from 14.4 `runQuestionsCleanup`). Sum (passing) = 876.
- **Live run datapoints this session:** none. No `pnpm factoryd` smoke this session.
- **Pre-existing flake (still tracked):** `packages/daemon/src/pidfile.test.ts > pidfile > reaps a stale pidfile (dead owner)` flaked once under parallel test load on Windows during Phase 11; passed on retry and in isolation. Not from any Phase 11–14 change. No action taken.

---

## Recent decisions (last 3 ADRs)

- **ADR 0028** (2026-04-26, Phase 12) — Worker-sandbox contract: gate site + path-prefix algebra + out-of-scope behaviour + Bash story + write-vs-read scope. Five sub-decisions in one ADR.
- **ADR 0027** (2026-04-26, Phase 11) — Web UI mutation surface.
- **ADR 0026** (2026-04-24, Phase 10) — Pluggable assessor runtimes.

All 28 ADRs live under `docs/decisions/`. **Phase 13 + Phase 14 each added zero ADRs** (sweep phases). Phase 15 has added zero so far.

---

## Recently completed (last 5 phase closes / major steps)

- **Phase 14 closed** — 2026-04-27 — `6cc0008 chore(phase-14)` + tag `phase-14-carry-forward-continuation-closed`. Sweep phase: I012 + I013 → RESOLVED, conditional exports for dev hot-reload, `factory questions cleanup` CLI, Windows mojibake README addendum. 855 → 876 tests; no new ADRs; no `CompleteArchitecture.md` change. `docs/issues/INDEX.md` Open table now empty.
- **Phase 14 sub-step 14.4 — `factory questions cleanup` CLI + Windows mojibake README** — 2026-04-27 — `448505f fix(14.4)`. New `findOrphaned` / `markOrphanAnswered` helpers; pure `runQuestionsCleanup` for testability; "Windows operator tips" subsection in README.
- **Phase 14 sub-step 14.3 — I012 → RESOLVED** — 2026-04-27 — `6e40872 fix(14.3)`. Migration 008 (`pending_questions.bot_message_id`); outbound-worker stamp on delivery; new exact rung in Telegram matcher. Discord untouched (Phase 7c live data showed no FIFO mismatch).
- **Phase 14 sub-step 14.2 — I013 → RESOLVED** — 2026-04-27 — `ee96dcd fix(14.2)`. Pure doc reconciliation; `prePurgeDepDirs` + regression test were already shipped in Phase 10.3 (`50bab61`).
- **Phase 14 sub-step 14.1 — Stale-dist dev-loop (conditional exports)** — 2026-04-27 — `95b901b fix(14.1)`. Each `packages/*/package.json` gained a `development` condition; root scripts pass `--conditions=development`. Verified by booting factoryd with `packages/daemon/dist/` removed.

(No Phase 15 entry — this session was a still-quiet pass-through with no deliverable.)

---

## Attempts that didn't work (current step only)

- None for Phase 15 yet — phase hasn't opened.

---

## Environment snapshot

- **Language / runtime:** TypeScript strict mode on Node 20+ (ADR 0001). pnpm workspaces. ESM (NodeNext) with explicit `.js` import extensions. Workspace packages now resolve to `src/` under `--conditions=development` (Phase 14.1) and `dist/` otherwise.
- **Key pinned deps:** unchanged from Phase 14 close. `astro ^5.0.0`, `@astrojs/check ^0.9.0`, `@fastify/static ^7.0.0`, Pino, Zod, Commander, Fastify v4, better-sqlite3, discord.js, chokidar, vitest, ulid, `simple-git ^3.25.0` (explicit in `@factory5/brain` since Phase 13), `@modelcontextprotocol/sdk ^1.0.0`.
- **Model in use:** Claude Opus 4.7 for session work.
- **Other:** Windows + Linux cross-platform mandatory. **15 packages + 3 apps**. **876 tests**. **8 schema migrations** (latest: `008-pending-questions-bot-message-id`, Phase 14.3). `CHANNEL_IDS` narrowed to `['cli','discord','telegram']` (ADR 0019). Budget enforcement per ADR 0020 + Phase 13.3's shared helper. Project identity via `.factory/project.json` (ADR 0021). Cross-session spend via `factory spend` (7b.3). Telegram channel via plugin-owned long-poll (ADR 0022). Instance data dir via cwd-walk (ADR 0023). Worker `ask_user` per ADR 0024. Web UI per ADR 0025 + mutation surface per ADR 0027 + `factory ui-token` CLI (Phase 13.2). Pluggable runtime per ADR 0026. Worker filesystem-scoping per ADR 0028. New surfaces from Phase 14: `factory questions cleanup` (14.4) + Telegram Reply-feature exact-question targeting (14.3) + dev-mode workspace-package routing through `src/` (14.1).
- **Host toolchain at Phase 10 close (still current):** pnpm 9.12.0, Node v22.22.2, Go 1.26.2, Rust/Cargo 1.95.0 — all on PATH. tsx 4.21.0.

---

## Notes for next session

If resuming after `/session-end` or a cold start:

1. Read `CLAUDE.md` (root) — standing brief incl. Control-framework section.
2. Read this STATE.md.
3. Read `.control/phases/phase-15-demand-driven-runoff/{README.md,steps.md}` — Phase 15 charter (paused state).
4. Skim Phase 15 candidate pool above. **No predetermined first sub-step**; phase opens when something bites.
5. Run `/session-start` for the full drift check.

**This is now the second consecutive session-boundary with no demand signal for Phase 15.** Bias for the next session, in priority order:

1. **If something has bitten by then:** open 15.1 against whichever item from the candidate pool fires first. The phase opens at that point with whatever scope the bite warrants.
2. **Otherwise: close Phase 15 still-quiet.** `/phase-close` produces the tag (`phase-15-demand-driven-runoff-closed`), authors a short `docs/Phase15_Progress.md` recording the dormancy (charter + two still-quiet passes + final state), and prepends a one-line entry to `docs/PROGRESS.md`. Exit the active Control-managed phase chain until new work demands one. The phase charter explicitly enables this path. Estimated effort: a single commit, $0 spend.
3. **(Less preferred) Another still-quiet pass-through.** Only if there's a specific reason to keep Phase 15 nominally open another session — none is apparent right now.

**Budget for Phase 15:** $0 baseline. If the still-quiet close path runs, it's a single-commit operation: $0. If a demand signal opens 15.1 instead, the candidate's scope dictates the budget (most candidates are TS-only; only Bash sandboxing would likely involve ADR + multi-session work + possibly live-LLM verification).

**Memory:** unchanged. `feedback_use_frontend_design_skill.md` still applies to any future SPA work; `feedback_fix_root_causes.md` continues to apply. No new memories from this still-quiet pass.

**Carry-forward** (Phase 15 candidate pool, all non-blocking, unchanged from Phase 14 close):

- Bash sandboxing (incident-driven) + `/build` flag parsing (operator-request-driven) + network egress scoping (demand-driven) + orphan `node.exe` on port 25295 (diagnostic) + Phase 6 operator follow-ups (out-of-band).

**Stable-state observation:** factory5's open issue tracker remains empty. The codebase is at the most stable point in its history. Two consecutive still-quiet session boundaries strongly suggest the still-quiet close is the right next move — Phase 15 was always designed to be paused on demand-signal, and there is no protocol cost to closing it without sub-steps. Closing it cleanly is a more accurate signal of project state than holding it open indefinitely.
