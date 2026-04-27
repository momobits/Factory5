# Project State

> Single source of truth for Control's operational cursor. Read this first every session. Updated at every `/session-end` and by the `PreCompact` hook.

**Last updated:** 2026-04-27T15:29:53Z (session `2026-04-27T13`, session-end after Phase 13 close) — Phase 13 closed at `eb4ade3` with tag `phase-13-operator-experience-closed`. Five sub-steps shipped in a single session arc: 13.1 (logger fix / I015) → 13.2 (`factory ui-token` CLI + IPC route) → 13.3 (`resolveDirectiveLimits` helper / I009) → 13.4 (architect auto-commit / I014) → 13.5 (phase close). No new ADRs (sweep phase). Phase 14 (carry-forward continuation + ergonomics) scaffolded; opens at 14.1 next session.
**Current phase:** 14 — Carry-forward continuation + ergonomics — **🟢 active**
**Current sub-phase:** n/a — single-charter phase
**Current step:** 14.1 — first-bite carry-forward (next; demand-signal-ordered)
**Status:** Working tree clean. **855 tests** green across 15 packages. `pnpm lint` + `pnpm format:check` clean. `pnpm build` clean across 15 packages + 3 apps.

---

## Project spec

**Canonical:** `CompleteArchitecture.md` at root. §22 "Pluggable runtimes" added at Phase 10 close. §23 "Web UI mutation surface" added at Phase 11 close. §24 "Worker filesystem-scoping" added at Phase 12 close. **No §25 yet** — Phase 13 was a sweep phase and shipped no new architectural seam.
**Current reference:** `docs/ARCHITECTURE.md` (evolves), `docs/CONTRACTS.md`, `docs/SKILLS.md`, `docs/AGENTS.md`.
**Phase history:** `docs/PROGRESS.md` (chronological). `docs/Phase13_Progress.md` written at 13.5 (one charter doc per phase pattern). `docs/Phase14_Progress.md` will land at the eventual 14.x phase close.
**Role:** the `docs/` tree is authoritative. `.control/architecture/overview.md` is a pointer.

---

## Next action

**Sub-step 14.1 — First-bite carry-forward.** Demand-signal-ordered: 14.1 opens against whichever Phase 14 candidate the operator hits first. The candidate pool, in rough priority order (per `.control/phases/phase-14-carry-forward-continuation/README.md`):

1. **Stale-dist dev-loop gotcha (now overdue since Phase 9).** `apps/factoryd` imports `@factory5/daemon` via `main: "./dist/index.js"`, so dev runs don't see un-rebuilt source — every workspace-dep edit currently requires manual `pnpm build` before `pnpm factoryd`. Two solutions on the table: (A) conditional exports + `--conditions=development` (lowest blast radius); (B) flip `main` to `src/index.ts` for dev-only packages and bundle prod paths. Pick at sub-step open.
2. **I013 status re-read.** INDEX still shows OPEN; Phase 10's `prePurgeDepDirs` rimraf'd the symptom and Phase 12's sandbox cleanup further shrank the surface. Likely a doc-status drift; verify and move to RESOLVED with a regression-pointer or scope a residual fix.
3. **I012 — Telegram FIFO matcher.** `maybeAnswerPendingQuestion` matches inbound replies by chat-id LIKE prefix; can't disambiguate when there are two open questions in the same chat. One-line guard: when >1 open question, require `reply_to_message.message_id` (Telegram already includes it).
4. **Stale "open" pending_questions DB sweep.** 14 orphaned escalations from older completed directives. One-shot SQL or a `factory questions cleanup --orphaned --since <date>` CLI surface.
5. **PowerShell em-dash mojibake README addendum.** `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8` documented in the project README. Free, no-code change.
6. **Phase 6 operator follow-ups** — PAT revoke, `gh repo delete`, env var cleanup. Out-of-band, may not land this phase.

After Phase 14 closes (5 sub-steps incl. close): next phase by demand signal (Bash sandboxing if an incident surfaces, network egress scoping, or another sweep round).

---

## Git state

- **Branch:** main (ahead of `origin/main` by 56 commits — push at operator discretion).
- **Last commit:** `eb4ade3 chore(phase-13): close phase 13, kick off phase 14`. Phase-13 close + Phase 14 scaffold landed in one commit; tag `phase-13-operator-experience-closed` placed on this SHA. Recent log: this session-end commit (`docs(state)`) → `eb4ade3 chore(phase-13)` → `00682ef fix(13.4)` (architect auto-commit / I014) → `bf79c26 fix(13.3)` (`resolveDirectiveLimits` / I009) → `f25b323 feat(13.2)` (`factory ui-token`) → `652f411 fix(13.1)` (logger / I015) → `5b9fdd6 docs(state)` (Phase 12 session-end) → `ed88a60 chore(phase-12)` (Phase 12 close, tag).
- **Uncommitted changes:** none at session end (modulo `.claude/scheduled_tasks.lock` — harness rewrite on resume, swept by next harness chore commit).
- **Last phase tag:** `phase-13-operator-experience-closed` (placed on `eb4ade3`).

Earlier tags intact: `phase-12-worker-fs-scoping-closed`, `phase-11-web-ui-9b-closed`, `phase-10-assessor-tier3-closed`, `phase-9-web-ui-closed`, `phase-8-worker-ask-user-closed`, `addendum-onboarding-closed`, `phase-7c-telegram-channel-closed`, `phase-7b-spend-dashboard-closed`, `phase-7a-budget-enforcement-closed`, `phase-7-closed`, `phase-6-closed`, `phase-6a-findings-registry-closed`, `phase-6c-verifier-overhaul-closed`, `protocol-initialised`.

---

## Open blockers

- **None for Phase 14.** The remaining carry-forwards are all non-blocking polish items.
- **Carry-forward** (Phase 9–12 long-tail; Phase 14 candidate pool):
  - **Stale-dist dev-loop gotcha** (now overdue since Phase 9 close) — `apps/factoryd` imports compiled `dist/index.js`; dev edits don't propagate without manual `pnpm build`. Phase 14 candidate.
  - **I013** (MEDIUM, OPEN per INDEX, but likely paid down) — `worker/worktree`. INDEX row says "node_modules blocks worktree cleanup (Win)" but Phase 10's `prePurgeDepDirs` fixed the symptom and Phase 12's sandbox cleanup further shrank the surface. Doc drift; Phase 14 should re-read and either RESOLVE or scope.
  - **I012** (LOW, OPEN, `channels/telegram`) — `maybeAnswerPendingQuestion` FIFO matcher; can't target a specific open question when >1 are open in the same chat. Phase 14 candidate.
  - **14 stale "open" pending_questions** (LOW) — orphaned escalations from older completed directives. One-shot DB sweep when convenient.
  - **PowerShell em-dash mojibake** (LOW) — operator-side console codepage; cheapest fix is a one-paragraph README addendum.
  - **Phase 6 operator follow-ups** (LOW, out-of-band) — PAT revoke, `gh repo delete`, env var cleanup.

---

## In-flight work

- None. Phase 13 closed clean; Phase 14 hasn't opened (waits for next session + 14.1).

---

## Test / eval status

- **Last test run:** 2026-04-27 (Phase 13.5 close gate) — **855 tests** across 15 packages, all green on Windows. `pnpm lint` + `pnpm format:check` clean. `pnpm build` clean across 15 packages + 3 apps.
- **Per-package counts (post-Phase-13):** core 14, logger 20 (+7 from 13.1 file-sink + I015 subprocess driver), ipc 14, providers 39, state 134, assessor 79, wiki 64 (+6 from 13.3 `resolveDirectiveLimits` helper), channels 68 (+4 telegram + +2 discord I009 inbound regression), events 3, worker 38, worker-mcp 15, worker-sandbox 89 (86 passed + 3 Linux-only skipped on Windows runner), brain 82 (+8 from 13.4 architect auto-commit), daemon 129 (+5 ui-token route + +3 config-tier `/api/v1/builds`), cli 70 (+7 from 13.2 ui-token round-trip). Sum (passing) = 855.
- **Live run datapoints this phase:** none required. Phase 13 was TS-only; the 13.1 fix was end-to-end smoke-verified by booting `npx tsx apps/factoryd/src/main.ts --foreground` against a clean `.factory/` and observing both the file materialise + every line tagged `"process":"factoryd"`. Same factoryd run powered the 13.2 end-to-end smoke (`factory ui-token` returned the live URL).
- **Pre-existing flake (still tracked):** `packages/daemon/src/pidfile.test.ts > pidfile > reaps a stale pidfile (dead owner)` flaked once under parallel test load on Windows during Phase 11; passed on retry and in isolation. Not from any Phase 11/12/13 change. No action taken.

---

## Recent decisions (last 3 ADRs)

- **ADR 0028** (2026-04-26, Phase 12) — Worker-sandbox contract: gate site + path-prefix algebra + out-of-scope behaviour + Bash story + write-vs-read scope. Five sub-decisions in one ADR.
- **ADR 0027** (2026-04-26, Phase 11) — Web UI mutation surface.
- **ADR 0026** (2026-04-24, Phase 10) — Pluggable assessor runtimes.

All 28 ADRs live under `docs/decisions/`. **Phase 13 added zero ADRs** (sweep phase — none of the four fixes warranted pinning a new contract).

---

## Recently completed (last 5 phase closes / major steps)

- **Phase 13 closed** — 2026-04-27 — `eb4ade3 chore(phase-13)` + tag `phase-13-operator-experience-closed`. Sweep phase paid down four issues (I009, I014, I015) plus the ADR 0025 §2 ergonomic gap. 813 → 855 tests; no new ADRs; no `CompleteArchitecture.md` change.
- **Phase 13 sub-step 13.4 — Architect auto-commit** — 2026-04-27 — `00682ef fix(13.4)`. `commitArchitectWritesIfRepo` helper; stages only architect-written paths; degrades gracefully on git failure. I014 → RESOLVED.
- **Phase 13 sub-step 13.3 — `resolveDirectiveLimits`** — 2026-04-27 — `bf79c26 fix(13.3)`. Shared helper across all four directive-creation paths. New `ChannelContext.resolveBuildLimits` callback; new `IpcServerOptions.configBudgetDefaults`. I009 → RESOLVED.
- **Phase 13 sub-step 13.2 — `factory ui-token`** — 2026-04-27 — `f25b323 feat(13.2)`. New CLI command + `GET /ui-token` IPC route (loopback-only, no bearer; same threat model as `/status`/`/healthz`). ADR 0025 §2 carry-forward closed.
- **Phase 13 sub-step 13.1 — File-sink logger fix (I015)** — 2026-04-27 — `652f411 fix(13.1)`. `createLogger` Proxy-deferred; `initLogger` replaces auto-init root. End-to-end verified. I015 → RESOLVED.

---

## Attempts that didn't work (current step only)

- None for Phase 14 yet — phase hasn't opened.

---

## Environment snapshot

- **Language / runtime:** TypeScript strict mode on Node 20+ (ADR 0001). pnpm workspaces. ESM (NodeNext) with explicit `.js` import extensions.
- **Key pinned deps (Phase 13 changes):** `simple-git ^3.25.0` newly explicit in `@factory5/brain` (already a worker dep transitively). No other dep changes. Other pinned deps unchanged from Phase 12 close: `astro ^5.0.0`, `@astrojs/check ^0.9.0`, `@fastify/static ^7.0.0`, Pino, Zod, Commander, Fastify v4, better-sqlite3, discord.js, chokidar, vitest, ulid, `@modelcontextprotocol/sdk ^1.0.0`.
- **Model in use:** Claude Opus 4.7 for session work.
- **Other:** Windows + Linux cross-platform mandatory. **15 packages + 3 apps**. **855 tests**. `CHANNEL_IDS` narrowed to `['cli','discord','telegram']` (ADR 0019). Budget enforcement per ADR 0020 + Phase 13.3's shared helper. Project identity via `.factory/project.json` (ADR 0021). Cross-session spend via `factory spend` (7b.3). Telegram channel via plugin-owned long-poll (ADR 0022). Instance data dir via cwd-walk (ADR 0023). Worker `ask_user` per ADR 0024. Web UI per ADR 0025 + mutation surface per ADR 0027 + new `factory ui-token` CLI surface (Phase 13.2). Pluggable runtime per ADR 0026. Worker filesystem-scoping per ADR 0028.
- **Host toolchain at Phase 10 close (still current):** pnpm 9.12.0, Node v22.22.2, Go 1.26.2, Rust/Cargo 1.95.0 — all on PATH.

---

## Notes for next session

If resuming after `/session-end` or a cold start:

1. Read `CLAUDE.md` (root) — standing brief incl. Control-framework section.
2. Read this STATE.md.
3. Read `.control/phases/phase-14-carry-forward-continuation/{README.md,steps.md}` — Phase 14 charter.
4. Skim Phase 13 carry-forwards above; Phase 14 is demand-signal-ordered, so 14.1 opens against whichever item bites first.
5. Run `/session-start` for the full drift check.

**Budget for Phase 14:** ~2–3 sessions. All carry-forwards are TS / docs work, $0 spend baseline. No live-LLM smoke runs anticipated unless a fix touches a code path that benefits from end-to-end verification (e.g. the stale-dist dev-loop fix would benefit from a `pnpm factoryd` smoke).

**Memory:** unchanged from Phase 13 close. `feedback_use_frontend_design_skill.md` still applies to any future SPA work; `feedback_fix_root_causes.md` continues to apply (13.1's logger fix exemplified it — not papering over with `noFile: true` defaults but tracing to the auto-init footgun). No new memories from Phase 13.

**Carry-forward** (still non-blocking; Phase 14 candidate pool):

- Stale-dist dev-loop gotcha (overdue) + I013 status re-read + I012 Telegram FIFO matcher + stale pending_questions DB sweep + PowerShell em-dash README addendum + Phase 6 operator follow-ups.
