# Project State

> Single source of truth for Control's operational cursor. Read this first every session. Updated at every `/session-end` and by the `PreCompact` hook.

**Last updated:** 2026-04-22T22:15:00Z — session `2026-04-22T19` (Phase 7c + Phase 7 + addendum-onboarding all closed; `/session-end`)
**Current phase:** 7 — Operator-control + budget discipline — **🟢 CLOSED** (plus pre-Phase-8 onboarding addendum — **🟢 CLOSED**)
**Current sub-phase:** n/a — Phase 7 fully shipped + onboarding addendum shipped
**Current step:** n/a — awaiting Phase 8 charter decision
**Status:** phase-complete — three tags placed this session: `phase-7c-telegram-channel-closed`, `phase-7-closed`, `addendum-onboarding-closed`. Plus one additional commit (`7ce70e7`) adding a Control-discipline invariant ("state the next Control command explicitly after every commit/tag/close") mirrored into the Control source repo. 471 tests across 13 packages green; `pnpm lint` + `pnpm format:check` clean; no open blockers. Phase 8 options (Web UI, assessor tier-3, worker-subprocess `ask_user`) remain live — pick in the next session.

---

## Project spec

**Canonical:** `CompleteArchitecture.md` at root (~700 lines) — snapshot at scaffold, canonical design. §12 line 454 (`max_usd` / `max_steps`) wired per ADR 0020 (Phase 7a). §3 (project storage layout) gained `<project>/.factory/project.json` per ADR 0021 (Phase 7b.1).
**Current reference:** `docs/ARCHITECTURE.md` (evolves), `docs/CONTRACTS.md` (typed data shapes), `docs/SKILLS.md`, `docs/AGENTS.md`.
**Phase history:** `docs/PROGRESS.md` (chronological session log), `docs/Phase5_Progress.md`, `docs/Phase6_Progress.md`, `docs/Phase7_Progress.md` (all three sub-phases closed; Phase 7 complete).
**Role:** the `docs/` tree is authoritative. `.control/architecture/overview.md` is a pointer file only.

---

## Next action

**Phase 8 charter — not yet decided.** Three live options inherited from the 7b close discussion:

1. **Web UI** — browser-based operator dashboard (served by `factoryd`) that wraps `factory spend` + directive queue + outbound replies in one page. Probably the biggest operator-visible upgrade.
2. **Assessor tier-3** — language-aware project environments beyond Python venv (Node `package.json` scripts, Go modules, Rust cargo). Unblocks "factory builds in $language" beyond the current Python bias.
3. **Worker-subprocess `ask_user`** — surface the brain's `askUser` tool to tool-using workers so a mid-build agent can escalate interactively rather than marking blocked. Cleanest fix for "agent gets confused and silently thrashes" cases that budget enforcement in 7a only bounds rather than resolves.

No HALT. Pick in the next session based on what's most painful in the current surface. After a charter decision, open Phase 8 directory with `.control/phases/phase-8-<name>/README.md` + `steps.md`.

---

## Git state

- **Branch:** main (ahead of `origin/main` by ~63 commits since Phase 5 close — push at operator discretion)
- **Last commit (pre-session-end):** `7ce70e7` — `docs(onboarding): add "state next Control command" invariant to CLAUDE.md`. This session-end docs commit lands on top.
- **Uncommitted changes:** only this session-end docs commit in-flight; tracked tree otherwise clean. `.claude/scheduled_tasks.lock` shows dirty in `git status` (Claude Code harness artifact; gitignored semantics-wise; ignored at every prior session-end).
- **Last addendum tag:** `addendum-onboarding-closed` (on `17c393d`).
- **Last phase tag:** `phase-7-closed` (on `7906099`) — still current. Addendum is pre-Phase-8, doesn't reopen Phase 7.

Earlier tags intact: `phase-7c-telegram-channel-closed`, `phase-7b-spend-dashboard-closed`, `phase-7a-budget-enforcement-closed`, `phase-6-closed`, `phase-6a-findings-registry-closed`, `phase-6c-verifier-overhaul-closed`.

---

## Open blockers

- **None.** I008 RESOLVED in 7b.1 (prior session). Open backlog empty for the third consecutive session.

---

## In-flight work

- None. Phase 7 + addendum + Control-discipline invariant all shipped and committed this session; no files mid-edit.

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
3. Read `docs/Phase7_Progress.md` for the full Phase 7 close (all three sub-phases, done criteria, carry-forward).
4. Run `/session-start` for the full drift check.
5. **Next concrete work:** pick the Phase 8 charter. Three live options (see Next action above). No HALT.

**Budget for Phase 8:** TBD once the charter is picked. Web UI is probably the largest (3–5 sessions); assessor tier-3 and worker-subprocess `ask_user` are each 2–3 sessions depending on scope.

**Onboarding artefacts in place** (from the addendum this session):

- `config.example.toml` at repo root — hand-editable template with inline comments + Discord / Telegram walkthroughs.
- `docs/ONBOARDING.md` — full clone-to-first-build walkthrough including multi-instance via `cd` and the new `[daemon]` port config.
- ADR 0023 — repo-local instances via cwd-walk + `~/.factory/` fallback.
- `factory init` now template-copy-first (copies `config.example.toml` → `<instance>/.factory/config.toml` and exits with instructions); `--force` + flags keeps CI-friendly generation.

**Operator follow-up from Phase 6 close (still out-of-band whenever convenient, none blocks Phase 8):**

1. Revoke PAT at https://github.com/settings/tokens.
2. Delete throwaway repo: `gh repo delete momobits/factory5-6b-smoke --yes`.
3. Clear env var: `reg delete "HKCU\Environment" /v GITHUB_TOKEN /f`.
