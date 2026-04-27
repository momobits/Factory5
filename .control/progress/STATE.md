# Project State

> Single source of truth for Control's operational cursor. Read this first every session. Updated at every `/session-end` and by the `PreCompact` hook.

**Last updated:** 2026-04-28T01:30:00Z (session `2026-04-28T01`, Phase 15 still-quiet close) — Phase 15 closed still-quiet at this commit + tag `phase-15-demand-driven-runoff-closed`. No sub-steps shipped. Phase content was 1 still-quiet pass-through (session `2026-04-27T22`, `c2a12db`) + this close commit. **Active Control phase chain exited** — no Phase 16 scaffolded; new phase opens on demand if/when work surfaces. The codebase is genuinely at rest: `docs/issues/INDEX.md` Open empty, 876 tests green, 28 ADRs, 8 migrations, 15 packages + 3 apps, no `CompleteArchitecture.md` change in Phase 15.
**Current phase:** _none_ — active Control phase chain exited at Phase 15 close. Dormant until next demand signal, at which point a new phase opens against it.
**Current sub-phase:** n/a
**Current step:** n/a — no active step. Last completed: Phase 15 close (still-quiet) at this commit.
**Status:** Working tree clean (after this commit). **876 tests** green across 15 packages (last gate, Phase 14.5 close — unchanged across Phase 15 because no code changed). `pnpm lint` + `pnpm format:check` clean. `pnpm build` clean across 15 packages + 3 apps. `origin/main` synced (operator pushed between sessions `2026-04-27T22` and `2026-04-28T01`).

---

## Project spec

**Canonical:** `CompleteArchitecture.md` at root. §22 "Pluggable runtimes" added at Phase 10 close. §23 "Web UI mutation surface" added at Phase 11 close. §24 "Worker filesystem-scoping" added at Phase 12 close. **No §25 yet** — Phases 13 + 14 + 15 were each sweep / paused-state phases with no new architectural seam. Phase 16 (when/if it opens) is the next opportunity.
**Current reference:** `docs/ARCHITECTURE.md` (evolves), `docs/CONTRACTS.md`, `docs/SKILLS.md`, `docs/AGENTS.md`.
**Phase history:** `docs/PROGRESS.md` (chronological). Phase progress files: `docs/Phase14_Progress.md` (14.5 close), `docs/Phase15_Progress.md` (still-quiet close). Phases 5–13 have their own files.
**Role:** the `docs/` tree is authoritative. `.control/architecture/overview.md` is a pointer.

---

## Next action

**No active phase. No next step queued.**

The active Control phase chain exited at Phase 15's still-quiet close. Future sessions don't bootstrap into a paused phase — they bootstrap into a dormant state and only open a new phase if a demand signal has surfaced.

**At the next session start (post-`/session-start`):**

1. If something has surfaced (new issue, smoke finding, feature request, incident) — scaffold Phase 16 against it: create `.control/phases/phase-16-<short-name>/{README.md,steps.md}` per the templates in `.control/templates/` (or model on `.control/phases/phase-15-demand-driven-runoff/`); update STATE.md to point at it; open 16.1 against the bite. The framework supports re-entry from the dormant state.
2. If nothing has surfaced — the right move is to do nothing. Confirm state, run `/session-end`, repeat. The dormant state has no per-session "still-quiet pass" cost — every session-end just records "still dormant."
3. Out-of-band cleanup the operator might do at any time without involving Claude: kill the orphan `node.exe` on port 25295, change factoryd's default port, PAT revocation, `gh repo delete`, env var cleanup. None of these require a phase frame.

---

## Git state

- **Branch:** main (synced with `origin/main` after operator's push between sessions `2026-04-27T22` and `2026-04-28T00`).
- **Last commit:** the `chore(phase-15)` Phase 15 still-quiet close commit. Recent log: this close commit (`chore(phase-15): close phase 15 still-quiet`) → `c2a12db docs(state)` (still-quiet session 2026-04-27T22) → `1626ced docs(state)` (Phase 14.5 session-end) → `d583117 docs(journal)` (Phase 14 close journal append) → `6cc0008 chore(phase-14)` (Phase 14 close + Phase 15 scaffold; tag `phase-14-carry-forward-continuation-closed` here) → `448505f fix(14.4)` → `6e40872 fix(14.3)` → `ee96dcd fix(14.2)` → `95b901b fix(14.1)` → `208d4ad docs(state)` (Phase 13 session-end) → `eb4ade3 chore(phase-13)`.
- **Uncommitted changes:** none after the close commit lands.
- **Last phase tag:** `phase-15-demand-driven-runoff-closed` (placed on this close commit).

Earlier tags intact: `phase-14-carry-forward-continuation-closed`, `phase-13-operator-experience-closed`, `phase-12-worker-fs-scoping-closed`, `phase-11-web-ui-9b-closed`, `phase-10-assessor-tier3-closed`, `phase-9-web-ui-closed`, `phase-8-worker-ask-user-closed`, `addendum-onboarding-closed`, `phase-7c-telegram-channel-closed`, `phase-7b-spend-dashboard-closed`, `phase-7a-budget-enforcement-closed`, `phase-7-closed`, `phase-6-closed`, `phase-6a-findings-registry-closed`, `phase-6c-verifier-overhaul-closed`, `protocol-initialised`.

---

## Open blockers

- **None.** `docs/issues/INDEX.md` Open table remains **empty** — unchanged across the entire Phase 15 lifetime.
- **Carry-forward candidate pool** (all non-blocking, demand-signal-driven; not tied to a current phase since the chain is dormant — these are "if-and-when" notes for the next phase scaffold):
  - **Bash sandboxing** (incident-driven; ADR 0028 §4 deferral).
  - **`/build` flag parsing on Telegram + Discord** (operator-request-driven).
  - **Network egress scoping** (demand-driven).
  - **Orphan `node.exe` on port 25295** — already identified (older Node install at `C:\Program Files (x86)\nodejs\node.exe`); remaining work is operator-side (kill or change factoryd default port).
  - **Phase 6 operator follow-ups** (out-of-band) — PAT revoke, `gh repo delete`, env var cleanup.

---

## In-flight work

- None. Phase 15 closed still-quiet with a clean working tree.

---

## Test / eval status

- **Last test run:** 2026-04-27 (Phase 14.5 close gate; **not re-run during Phase 15** — no code changed across the phase) — **876 tests** across 15 packages, all green on Windows. `pnpm lint` + `pnpm format:check` clean. `pnpm build` clean across 15 packages + 3 apps.
- **Per-package counts (post-Phase-14, unchanged):** core 14, logger 20, ipc 14, providers 39, state 146, assessor 79, wiki 64, channels 70, events 3, worker 38, worker-mcp 15, worker-sandbox 89 (86 passed + 3 Linux-only skipped on Windows runner), brain 82, daemon 131, cli 75. Sum (passing) = 876.
- **Live run datapoints in Phase 15:** none. No `pnpm factoryd` smoke ran during Phase 15 (still-quiet pass + close commit only).
- **Pre-existing flake (still tracked):** `packages/daemon/src/pidfile.test.ts > pidfile > reaps a stale pidfile (dead owner)` flaked once under parallel test load on Windows during Phase 11; passed on retry and in isolation. Not from any Phase 11–15 change. No action taken.

---

## Recent decisions (last 3 ADRs)

- **ADR 0028** (2026-04-26, Phase 12) — Worker-sandbox contract: gate site + path-prefix algebra + out-of-scope behaviour + Bash story + write-vs-read scope. Five sub-decisions in one ADR.
- **ADR 0027** (2026-04-26, Phase 11) — Web UI mutation surface.
- **ADR 0026** (2026-04-24, Phase 10) — Pluggable assessor runtimes.

All 28 ADRs live under `docs/decisions/`. **Phases 13 + 14 + 15 each added zero ADRs** — Phases 13 + 14 were sweep phases; Phase 15 was paused-state.

---

## Recently completed (last 5 phase closes / major steps)

- **Phase 15 closed still-quiet** — 2026-04-28 — this `chore(phase-15)` close commit + tag `phase-15-demand-driven-runoff-closed`. Zero sub-steps shipped. Active Control phase chain exited. `docs/issues/INDEX.md` Open empty across the entire phase. $0 spend.
- **Phase 14 closed** — 2026-04-27 — `6cc0008 chore(phase-14)` + tag `phase-14-carry-forward-continuation-closed`. Sweep phase: I012 + I013 → RESOLVED, conditional exports for dev hot-reload, `factory questions cleanup` CLI, Windows mojibake README addendum. 855 → 876 tests; no new ADRs; no `CompleteArchitecture.md` change.
- **Phase 14 sub-step 14.4 — `factory questions cleanup` CLI + Windows mojibake README** — 2026-04-27 — `448505f fix(14.4)`. New `findOrphaned` / `markOrphanAnswered` helpers; pure `runQuestionsCleanup` for testability; "Windows operator tips" subsection in README.
- **Phase 14 sub-step 14.3 — I012 → RESOLVED** — 2026-04-27 — `6e40872 fix(14.3)`. Migration 008 (`pending_questions.bot_message_id`); outbound-worker stamp on delivery; new exact rung in Telegram matcher.
- **Phase 14 sub-step 14.2 — I013 → RESOLVED** — 2026-04-27 — `ee96dcd fix(14.2)`. Pure doc reconciliation; `prePurgeDepDirs` + regression test were already shipped in Phase 10.3.

---

## Attempts that didn't work (current step only)

- N/A — no active step.

---

## Environment snapshot

- **Language / runtime:** TypeScript strict mode on Node 20+ (ADR 0001). pnpm workspaces. ESM (NodeNext) with explicit `.js` import extensions. Workspace packages resolve to `src/` under `--conditions=development` (Phase 14.1) and `dist/` otherwise.
- **Key pinned deps:** unchanged from Phase 14 close. `astro ^5.0.0`, `@astrojs/check ^0.9.0`, `@fastify/static ^7.0.0`, Pino, Zod, Commander, Fastify v4, better-sqlite3, discord.js, chokidar, vitest, ulid, `simple-git ^3.25.0` (explicit in `@factory5/brain` since Phase 13), `@modelcontextprotocol/sdk ^1.0.0`.
- **Model in use:** Claude Opus 4.7 for session work.
- **Other:** Windows + Linux cross-platform mandatory. **15 packages + 3 apps**. **876 tests**. **8 schema migrations** (latest: `008-pending-questions-bot-message-id`, Phase 14.3). `CHANNEL_IDS` narrowed to `['cli','discord','telegram']` (ADR 0019). Budget enforcement per ADR 0020 + Phase 13.3's shared helper. Project identity via `.factory/project.json` (ADR 0021). Cross-session spend via `factory spend` (7b.3). Telegram channel via plugin-owned long-poll (ADR 0022). Instance data dir via cwd-walk (ADR 0023). Worker `ask_user` per ADR 0024. Web UI per ADR 0025 + mutation surface per ADR 0027 + `factory ui-token` CLI (Phase 13.2). Pluggable runtime per ADR 0026. Worker filesystem-scoping per ADR 0028. New surfaces from Phase 14: `factory questions cleanup` (14.4) + Telegram Reply-feature exact-question targeting (14.3) + dev-mode workspace-package routing through `src/` (14.1).
- **Host toolchain at Phase 10 close (still current):** pnpm 9.12.0, Node v22.22.2, Go 1.26.2, Rust/Cargo 1.95.0 — all on PATH. tsx 4.21.0.

---

## Notes for next session

If resuming after `/session-end` or a cold start:

1. Read `CLAUDE.md` (root) — standing brief incl. Control-framework section.
2. Read this STATE.md.
3. **Note: no active phase.** No phase README/steps.md to read. The active Control phase chain exited at Phase 15 close. Last phase artifact: `.control/phases/phase-15-demand-driven-runoff/` (closed; not the current phase).
4. Run `/session-start` for the full drift check. The git verification will confirm the close tag + branch position.

**Bias for next session:**

1. **If a demand signal has surfaced** (new issue, incident, smoke finding, operator feature request) — scaffold Phase 16 against it. The framework supports re-entry from the dormant state: create `.control/phases/phase-16-<short-name>/{README.md,steps.md}` (model on phase-15 or phase-14 templates), update STATE.md to mark Phase 16 as the active phase, open 16.1 against the bite. Naming should reflect what the bite actually is — don't pre-cook a name.
2. **If nothing has surfaced** — confirm state, end the session. The dormant state has zero per-session protocol overhead — STATE.md doesn't need a "still-dormant pass" entry pattern; just a session-end docs commit if anything changed. If nothing changed at all, even the docs commit can be skipped.
3. **Out-of-band operator actions** (no Claude involvement needed): kill the orphan `node.exe` on port 25295 / change factoryd's default port to something else / PAT revocation / `gh repo delete` / env var cleanup. These are operator-side cleanups that the operator can do at any time without scaffolding a phase.

**Memory:** unchanged. `feedback_use_frontend_design_skill.md` still applies to any future SPA work; `feedback_fix_root_causes.md` continues to apply. No new memories.

**Carry-forward** (candidate pool for the eventual Phase 16, all non-blocking):

- Bash sandboxing (incident-driven) + `/build` flag parsing (operator-request-driven) + network egress scoping (demand-driven) + orphan `node.exe` on port 25295 (operator-side) + Phase 6 operator follow-ups (out-of-band).

**Stable-state observation (final, pre-dormancy):** factory5's open issue tracker is empty, all carry-forwards from Phases 9–14 are addressed, the Phase 15 paused-state closed without sub-steps, and the codebase is at the most stable point in its history. The Control phase chain exited cleanly. Re-entry is fully supported when work demands it; the dormant state is not a special case in the framework — it's just the absence of an active phase.
