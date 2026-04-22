# Project State

> Single source of truth for Control's operational cursor. Read this first every session. Updated at every `/session-end` and by the `PreCompact` hook.

**Last updated:** 2026-04-22T17:45:00Z — session `2026-04-22T17` (Phase 7c + Phase 7 closed)
**Current phase:** 7 — Operator-control + budget discipline — **🟢 CLOSED**
**Current sub-phase:** n/a — Phase 7 fully shipped (7a + 7b + 7c all closed)
**Current step:** n/a — awaiting Phase 8 charter decision
**Status:** phase-complete — Phase 7 wrapped with tags `phase-7c-telegram-channel-closed` + `phase-7-closed`. 463 tests across 13 packages green; `pnpm lint` + `pnpm format:check` clean; no open blockers. Phase 8 options discussed at 7b close (Web UI, assessor tier-3, worker-subprocess `ask_user`) remain live — pick in the next session.

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

- **Branch:** main (ahead of `origin/main` by ~56 commits since Phase 5 close — push at operator discretion)
- **Last commit:** Phase 7c + Phase 7 close commit (title `chore(phase-7c): close Phase 7c and Phase 7 — telegram channel shipped`; this commit)
- **Uncommitted changes:** no
- **Last phase tag:** `phase-7-closed` (on this commit; also `phase-7c-telegram-channel-closed` co-tagged here)

Earlier tags intact: `phase-7b-spend-dashboard-closed`, `phase-7a-budget-enforcement-closed`, `phase-6-closed`, `phase-6a-findings-registry-closed`, `phase-6c-verifier-overhaul-closed`.

---

## Open blockers

- **None.** I008 RESOLVED in 7b.1 (prior session). Open backlog empty for the third consecutive session.

---

## In-flight work

- None — Phase 7b fully shipped + tagged. 7c.1 is a hard HALT gate; no files mid-edit.

---

## Test / eval status

- **Last test run:** Phase 7c close, 2026-04-22T17:44Z — 463 tests across 13 packages, all green. (+35 across the 7c arc: +29 at 7c.2 for the TelegramChannel unit suite, +6 at 7c.5 for the round-trip fixtures.)
- **Per-package counts at close:** core 14, logger 5, ipc 5, providers 37, state 92, assessor 42, wiki 39, **channels 60**, events 3, worker 24, brain 59, daemon 28, cli 55.
- **Eval score** (agent phases only): unchanged from 7a.8 — directive `01KPRHNEX1T3VR3S4ZTTSJ8F0M`, $1.9151 of $3.00 ceiling, tripped cleanly at builder-2. Not re-run at 7c — no agent-stack changes in 7c.
- **Regression tests:** new Telegram coverage in `packages/channels/src/telegram.test.ts` (29 tests) + `packages/channels/src/telegram-roundtrip.test.ts` (6 tests). I008 / ADR 0021 regression still covered in `packages/cli/src/commands/spend-roundtrip.test.ts`. 7a budget regression in `packages/brain/src/budget-regression.test.ts`. Migration 006 shape + backfill in `packages/state/src/migrations/006-project-identity.test.ts`. F001 verifier regression in `packages/worker/src/verifier-f001.test.ts`.
- **Live validation (7c.6):** `scripts/telegram-smoke.ts` against `@Factory5_bot`. 2026-04-22 17:37:50–17:38:13Z — identity verified, kickoff posted as `message_id 5`, operator reply captured 22s later as directive `01KPV4AQVDSPA24ZMRP944QYDG`, echo sent as `message_id 7`, poll loop exited cleanly.
- **Live validation (7c.4):** `factory doctor --skip-call --skip-discord` returned `getMe: ok (token accepted)` / `bot: @Factory5_bot` / `testChatId: 1225367797`.

---

## Recent decisions (last 3 ADRs)

- **ADR 0022** (2026-04-22) — Telegram long-polling lives inside `TelegramChannel` (mirroring Discord's websocket-inside-plugin pattern), not as a separate `@factory5/events` `EventSource`. Closes 7c.3 as a no-op. Reversible if future Telegram signals need `Event` rather than `Directive` treatment.
- **ADR 0021** (2026-04-21) — First-class project identity via `<project>/.factory/project.json` (ULID). Stable across path moves; explicit at fork. Closes I008. Foundation for 7b per-project rollups.
- **ADR 0020** (2026-04-21) — Pre-call budget enforcement: rolling-average estimator per `(category, mode)` + cold-start defaults; `assertBudget` wrapper in brain; `budget_exceeded_*:` prefix on `directives.blocked_reason`.

All 22 ADRs live under `docs/decisions/`.

---

## Recently completed (last 5 steps)

- **Phase 7 closed** — 2026-04-22 — tag `phase-7-closed`; this commit. All three sub-phases shipped in strict order (7a budget enforcement, 7b spend dashboard, 7c Telegram channel).
- **Phase 7c closed** — 2026-04-22 — tag `phase-7c-telegram-channel-closed`; this commit. 6 sub-steps (7c.1 HALT clearance → 7c.7 close).
- **7c.6 — Live run** — 2026-04-22 — commit `b712a09`. `scripts/telegram-smoke.ts` against `@Factory5_bot`; round-trip captured operator reply as directive `01KPV4AQVDSPA24ZMRP944QYDG` + echoed with `reply_to_message_id`.
- **7c.5 — Round-trip integration tests** — 2026-04-22 — commit `e770815`. `packages/channels/src/telegram-roundtrip.test.ts` with realistic-shape fixtures; 6 new tests.
- **7c.4 — Formalise config + wire init/doctor/daemon** — 2026-04-22 — commit `784e41b`. `factory init` Telegram flags; `factory doctor` `probeTelegram` + `--skip-telegram`; daemon auto-wires plugin when `botToken` is set.

---

## Attempts that didn't work (current step only)

- n/a — no active step; Phase 7 complete, Phase 8 undecided.

---

## Environment snapshot

- **Language / runtime:** TypeScript strict mode on Node 20+ (ADR 0001). pnpm workspaces. ESM (NodeNext) with explicit `.js` import extensions.
- **Key pinned deps:** Pino, Zod, Commander, Fastify, better-sqlite3, discord.js, chokidar, simple-git, vitest, ulid.
- **Model in use:** Claude Opus 4.7 for scaffolding sessions; live builds use category routing per ADR 0004 (quick=Haiku 4.5, planning=Sonnet 4.6, deep/reasoning=Opus 4.7).
- **Other:** Windows + Linux cross-platform mandatory. 13 packages + 2 apps. **463 tests**. `CHANNEL_IDS` narrowed to `['cli','discord','telegram']` per ADR 0019 — all three plugins shipped. Budget enforcement per ADR 0020. Project identity via `.factory/project.json` per ADR 0021. Cross-session spend dashboard via `factory spend` per 7b.3. Telegram channel via `TelegramChannel` with plugin-owned long-poll loop per ADR 0022 (7c.2).

---

## Notes for next session

If resuming after `/session-end` or a cold start:

1. Read `CLAUDE.md` (root) — standing brief incl. Control-framework section and the steps.md-checkbox discipline line.
2. Read this STATE.md.
3. Read `docs/Phase7_Progress.md` for the full Phase 7 close (all three sub-phases, done criteria, carry-forward).
4. Run `/session-start` for the full drift check.
5. **Next concrete work:** pick the Phase 8 charter. Three live options (see Next action above). No HALT.

**Budget for Phase 8:** TBD once the charter is picked. Web UI is probably the largest (3–5 sessions); assessor tier-3 and worker-subprocess `ask_user` are each 2–3 sessions depending on scope.

**Operator follow-up from Phase 6 close (still out-of-band whenever convenient, none blocks Phase 8):**

1. Revoke PAT at https://github.com/settings/tokens.
2. Delete throwaway repo: `gh repo delete momobits/factory5-6b-smoke --yes`.
3. Clear env var: `reg delete "HKCU\Environment" /v GITHUB_TOKEN /f`.
