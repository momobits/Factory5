# Project State

> Single source of truth for Control's operational cursor. Read this first every session. Updated at every `/session-end` and by the `PreCompact` hook.

**Last updated:** 2026-04-23 — session `2026-04-23` (Phase 8 opened — charter = worker-subprocess `askUser`; Web UI queued for Phase 9, assessor tier-3 for Phase 10)
**Current phase:** 8 — Worker-subprocess `askUser` — **🟢 active**
**Current sub-phase:** n/a — single-charter phase (no sub-letter split)
**Current step:** 8.1 — author ADR 0024 (route choice + wall-clock budget policy + correlation contract + brain-restart recovery + tool whitelist)
**Status:** Phase 8 directory authored at `.control/phases/phase-8-worker-ask-user/` (README + steps.md). Operator picked worker-subprocess `askUser` per charter discussion: highest leverage per session, smallest blast radius, reuses entire Phase-4 `askUser` + Phase-7c channels stack. Forward queue locked as Phase 9 = Web UI, Phase 10 = assessor tier-3. ADR 0024 in flight as 8.1; rest of the sub-step bodies are outlined in `steps.md` and expand at each session open.

---

## Project spec

**Canonical:** `CompleteArchitecture.md` at root (~700 lines) — snapshot at scaffold, canonical design. §12 line 454 (`max_usd` / `max_steps`) wired per ADR 0020 (Phase 7a). §3 (project storage layout) gained `<project>/.factory/project.json` per ADR 0021 (Phase 7b.1).
**Current reference:** `docs/ARCHITECTURE.md` (evolves), `docs/CONTRACTS.md` (typed data shapes), `docs/SKILLS.md`, `docs/AGENTS.md`.
**Phase history:** `docs/PROGRESS.md` (chronological session log), `docs/Phase5_Progress.md`, `docs/Phase6_Progress.md`, `docs/Phase7_Progress.md` (all three sub-phases closed; Phase 7 complete).
**Role:** the `docs/` tree is authoritative. `.control/architecture/overview.md` is a pointer file only.

---

## Next action

**Phase 8 sub-step 8.1 — author ADR 0024.** Five decisions in one ADR:

1. **Route**: MCP server (Claude CLI's official tool-extension; net-new infra in this repo; clean abstraction; reusable for future custom tools) vs direct-stdio JSON-RPC (smaller diff; bespoke; brittle to claude-cli protocol drift). Lean: MCP, but ADR captures the trade.
2. **Wall-clock budget policy**: pause directive TTL + `max_steps` while waiting for human? Recommendation: yes (matches operator intent — "agent is correctly stopped, not thrashing"), with per-question soft deadline (default 1h, configurable) so subprocess doesn't pin a CLI seat indefinitely.
3. **Correlation contract**: `taskId` mandatory in worker→brain `ask_user` envelope so two workers in same directive don't crossover.
4. **Brain-restart recovery**: `tasks_inflight.status = 'waiting_for_human'`; on brain startup, orphans → `aborted`; late answers no-op.
5. **Tool whitelist**: `scaffolder` / `builder` / `fixer` / `investigator` get `AskUser`; brain-checkpointed agents (architect, planner, reviewer, verifier) keep using existing `escalateBlocked`.

After ADR 0024 lands: 8.2 (brain RPC endpoint), 8.3 (worker tool plumbing — implementation depends on route choice), 8.4–8.7 (registry + lifecycle + tests + live validation), 8.8 (close).

---

## Git state

- **Branch:** main (ahead of `origin/main` by ~64 commits since Phase 5 close — push at operator discretion)
- **Last commit (pre-Phase-8 open):** `6cdb6dd` — `docs(state): session end post-addendum-onboarding close`. Phase 8 opening commit (8.1 charter + ADR 0024) lands on top.
- **Uncommitted changes:** Phase 8 charter dir + STATE.md update + ADR 0024 in-flight for the opening commit. `.claude/scheduled_tasks.lock` shows dirty in `git status` (Claude Code harness artifact; gitignored semantics-wise; ignored at every prior session-end).
- **Last addendum tag:** `addendum-onboarding-closed` (on `17c393d`).
- **Last phase tag:** `phase-7-closed` (on `7906099`). Phase 8 is open; new tag not placed until 8.8.

Earlier tags intact: `phase-7c-telegram-channel-closed`, `phase-7b-spend-dashboard-closed`, `phase-7a-budget-enforcement-closed`, `phase-6-closed`, `phase-6a-findings-registry-closed`, `phase-6c-verifier-overhaul-closed`.

---

## Open blockers

- **None.** I008 RESOLVED in 7b.1 (prior session). Open backlog empty for the third consecutive session.

---

## In-flight work

- Phase 8 opening commit: `.control/phases/phase-8-worker-ask-user/{README.md,steps.md}`, this STATE.md update, `docs/decisions/0024-worker-subprocess-ask-user.md`, `docs/decisions/INDEX.md` row. All to land in one `feat(8.1):` commit.

---

## Test / eval status

- **Last test run:** addendum-onboarding close, 2026-04-22T21:44Z — 471 tests across 13 packages, all green. (+35 over 7b close: +29 at 7c.2 TelegramChannel unit suite, +6 at 7c.5 round-trip fixtures, +8 at addendum for `paths.test.ts`; net +8 at addendum close over Phase 7c close.)
- **Per-package counts at close:** core 14, **logger 13**, ipc 5, providers 37, state 92, assessor 42, wiki 39, **channels 60**, events 3, worker 24, brain 59, daemon 28, cli 55.
- **Eval score** (agent phases only): unchanged from 7a.8 — directive `01KPRHNEX1T3VR3S4ZTTSJ8F0M`, $1.9151 of $3.00 ceiling, tripped cleanly at builder-2. Not re-run this session — no agent-stack changes after 7a.
- **Regression tests (key additions this session):** `packages/channels/src/telegram.test.ts` (29 tests — plugin handler, pending-question answers, lifecycle, polling-loop offset discipline), `packages/channels/src/telegram-roundtrip.test.ts` (6 tests — realistic fixtures through full plugin → db path), `packages/logger/src/paths.test.ts` (8 tests — env wins, cwd-walk hit / miss / ignore-non-instance, homedir fallback, logsDir). Prior regressions intact: I008 / ADR 0021 in `packages/cli/src/commands/spend-roundtrip.test.ts`, 7a budget in `packages/brain/src/budget-regression.test.ts`, migration 006 in `packages/state/src/migrations/006-project-identity.test.ts`, F001 verifier in `packages/worker/src/verifier-f001.test.ts`.
- **Live validation (7c.6):** `scripts/telegram-smoke.ts` against `@Factory5_bot`. 2026-04-22 17:37:50–17:38:13Z — identity verified, kickoff posted as `message_id 5`, operator reply captured 22s later as directive `01KPV4AQVDSPA24ZMRP944QYDG`, echo sent as `message_id 7`, poll loop exited cleanly.
- **Live validation (7c.4):** `factory doctor --skip-call --skip-discord` returned `getMe: ok (token accepted)` / `bot: @Factory5_bot` / `testChatId: 1225367797`.
- **Live validation (addendum migration):** `factory init` in validate mode against the migrated `.factory/config.toml` reported `Config looks healthy`. `factory spend` re-rendered the pre-migration $63.1666 / 116 calls / 2 projects + unassigned rollup — DB migrated byte-for-byte.
- **Live validation (addendum init template-copy):** `FACTORY5_DATA_DIR=/tmp/... factory init` in a clean tmpdir copied the 7,364-byte `config.example.toml` into `<tmp>/.factory/config.toml` with next-step instructions.

---

## Recent decisions (last 3 ADRs)

- **ADR 0023** (2026-04-22) — Repo-local factory instances via cwd-walk discovery. `dataDir()` precedence: `FACTORY5_DATA_DIR` env → walk up from cwd looking for `.factory/config.toml` → `~/.factory/` fallback. Name `.factory/` used consistently; disambiguated from per-project `.factory/project.json` (ADR 0021) by requiring `config.toml` as the instance marker. Partially supersedes ADR 0004's storage-location claims.
- **ADR 0022** (2026-04-22) — Telegram long-polling lives inside `TelegramChannel` (mirroring Discord's websocket-inside-plugin pattern), not as a separate `@factory5/events` `EventSource`. Closes 7c.3 as a no-op.
- **ADR 0021** (2026-04-21) — First-class project identity via `<project>/.factory/project.json` (ULID). Stable across path moves; explicit at fork. Closes I008. Foundation for 7b per-project rollups.

All 23 ADRs live under `docs/decisions/`.

---

## Recently completed (last 5 steps)

- **"State next Control command" invariant** — 2026-04-22 — commit `7ce70e7` in factory5, `d07d6a3` in Control source. One-line assistant-side discipline add to CLAUDE.md in both repos. Also appended Improvement 7 (`/control-next` user-callable skill) to `G:\Projects\Small-Projects\Control\improvement.md` as v1.5.0 candidate. Motivated by "what do I run next?" UX gap observed between Phase 7 close and the addendum.
- **addendum-onboarding closed** — 2026-04-22 — tag `addendum-onboarding-closed`; commit `17c393d`. 5 substantive commits: gitignore `.factory/`, `dataDir()` rewrite with cwd-walk + 8 tests, ADR 0023 + `config.example.toml` + `docs/ONBOARDING.md`, `factory init` three-mode reshape, `[daemon]` config + `loadDaemonEndpoint()` for multi-instance ports.
- **Migration executed** — 2026-04-22 — `%LOCALAPPDATA%\factory5\*` → `G:\Projects\Large-Projects\factory\factory5\.factory\`. Verified via `factory doctor` + `factory spend` ($63.17 / 116 calls preserved). Old dir deleted. Not a git commit (tokens are gitignored).
- **Phase 7 closed** — 2026-04-22 — tag `phase-7-closed`; commit `7906099`. All three sub-phases shipped in strict order (7a budget enforcement / 7b spend dashboard / 7c Telegram channel).
- **Phase 7c closed** — 2026-04-22 — tag `phase-7c-telegram-channel-closed`; commit `7906099` (co-tagged with phase-7-closed). 6 sub-steps (7c.1 HALT clearance → 7c.7 close). Live round-trip against `@Factory5_bot` verified end-to-end at 7c.6.

---

## Attempts that didn't work (current step only)

- n/a — no active step; Phase 7 complete, Phase 8 undecided.

---

## Environment snapshot

- **Language / runtime:** TypeScript strict mode on Node 20+ (ADR 0001). pnpm workspaces. ESM (NodeNext) with explicit `.js` import extensions.
- **Key pinned deps:** Pino, Zod, Commander, Fastify, better-sqlite3, discord.js, chokidar, simple-git, vitest, ulid.
- **Model in use:** Claude Opus 4.7 for scaffolding sessions; live builds use category routing per ADR 0004 (quick=Haiku 4.5, planning=Sonnet 4.6, deep/reasoning=Opus 4.7).
- **Other:** Windows + Linux cross-platform mandatory. 13 packages + 2 apps. **471 tests**. `CHANNEL_IDS` narrowed to `['cli','discord','telegram']` per ADR 0019 — all three plugins shipped. Budget enforcement per ADR 0020. Project identity via `.factory/project.json` per ADR 0021. Cross-session spend dashboard via `factory spend` per 7b.3. Telegram channel via `TelegramChannel` with plugin-owned long-poll loop per ADR 0022 (7c.2). Instance data dir resolved via cwd-walk per ADR 0023 (primary at `<repo>/.factory/`).

---

## Notes for next session

If resuming after `/session-end` or a cold start:

1. Read `CLAUDE.md` (root) — standing brief incl. Control-framework section and the steps.md-checkbox discipline line.
2. Read this STATE.md.
3. Read `.control/phases/phase-8-worker-ask-user/README.md` + `steps.md` — Phase 8 charter, sub-step schedule, done criteria.
4. Read `docs/decisions/0024-worker-subprocess-ask-user.md` (once landed) — the architectural pin for sub-steps 8.2–8.5.
5. Read `docs/decisions/0015-mid-flight-user-engagement.md` — the original Phase 4 deferral that Phase 8 reverses (Shape 1).
6. Run `/session-start` for the full drift check.
7. **Next concrete work:** continue at the next unchecked box in `steps.md`. If 8.1 is checked and 8.2 is the next box, that means the brain RPC endpoint scaffold (Zod schema + Fastify route or extension thereof + token gate + tests).

**Budget for Phase 8:** 2–3 sessions total. 8.1 = ~½ session (ADR + charter commit). 8.2–8.4 = ~1 session (brain RPC + worker tool plumbing + registry update). 8.5–8.6 = ~½–1 session (lifecycle + regression tests). 8.7–8.8 = ~½ session (live validation + close).

**Onboarding artefacts in place** (from the addendum this session):

- `config.example.toml` at repo root — hand-editable template with inline comments + Discord / Telegram walkthroughs.
- `docs/ONBOARDING.md` — full clone-to-first-build walkthrough including multi-instance via `cd` and the new `[daemon]` port config.
- ADR 0023 — repo-local instances via cwd-walk + `~/.factory/` fallback.
- `factory init` now template-copy-first (copies `config.example.toml` → `<instance>/.factory/config.toml` and exits with instructions); `--force` + flags keeps CI-friendly generation.

**Operator follow-up from Phase 6 close (still out-of-band whenever convenient, none blocks Phase 8):**

1. Revoke PAT at https://github.com/settings/tokens.
2. Delete throwaway repo: `gh repo delete momobits/factory5-6b-smoke --yes`.
3. Clear env var: `reg delete "HKCU\Environment" /v GITHUB_TOKEN /f`.
