# Project State

> Single source of truth for Control's operational cursor. Read this first every session. Updated at every `/session-end` and by the `PreCompact` hook.

**Last updated:** 2026-04-21T22:45:00Z — session `2026-04-21T22` (Phase 7b closed; `/session-end`)
**Current phase:** 7 — Operator-control + budget discipline
**Current sub-phase:** 7c — Telegram channel (awaiting operator input)
**Current step:** 7c.1 — **[HALT] secret_needed** — Telegram bot token + target chat-id required
**Status:** awaiting-operator — Phase 7b shipped cleanly; 7c is the final sub-phase in Phase 7 and its first step is an explicit HALT gate per `steps.md`. Nothing further can proceed autonomously until the operator provides secrets.

---

## Project spec

**Canonical:** `CompleteArchitecture.md` at root (~700 lines) — snapshot at scaffold, canonical design. §12 line 454 (`max_usd` / `max_steps`) wired per ADR 0020 (Phase 7a). §3 (project storage layout) gained `<project>/.factory/project.json` per ADR 0021 (Phase 7b.1).
**Current reference:** `docs/ARCHITECTURE.md` (evolves), `docs/CONTRACTS.md` (typed data shapes), `docs/SKILLS.md`, `docs/AGENTS.md`.
**Phase history:** `docs/PROGRESS.md` (chronological session log), `docs/Phase5_Progress.md`, `docs/Phase6_Progress.md`, `docs/Phase7_Progress.md` (7a + 7b closed; 7c queued).
**Role:** the `docs/` tree is authoritative. `.control/architecture/overview.md` is a pointer file only.

---

## Next action

**Step 7c.1 — [HALT] operator provides Telegram bot token + target chat-id.** This is the only HALT gate in Phase 7 and it must clear before any 7c code lands. Mechanics:

1. Operator creates a bot via [@BotFather](https://t.me/BotFather) and records the token.
2. Operator identifies a target chat-id for smoke tests (one of: their personal chat, a test group).
3. Operator writes both to `~/.factory5/config.toml` under a new `[channels.telegram]` section — or provides them for session-scoped env var use (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_TEST_CHAT_ID`) if they prefer not to persist.

Once secrets are in place, 7c.2 begins: `packages/channels/src/telegram.ts` implementing `ChannelPlugin` (Discord is the reference plugin — ADR 0019 dropped GitHub).

Detailed Phase 7c plan: `.control/phases/phase-7-budget-discipline/README.md` + `steps.md` (7c has 7 sub-steps: 7c.1 → 7c.7).

---

## Git state

- **Branch:** main (ahead of `origin/main` by ~49 commits since Phase 5 close — push at operator discretion)
- **Last commit:** `ecce6ef` — `chore(phase-7b): close Phase 7b — cross-session spend dashboard shipped`
- **Uncommitted changes:** no (pending this session-end docs commit)
- **Last phase tag:** `phase-7b-spend-dashboard-closed` (on `ecce6ef`)

Earlier tags intact: `phase-7a-budget-enforcement-closed`, `phase-6-closed`, `phase-6a-findings-registry-closed`, `phase-6c-verifier-overhaul-closed`.

---

## Open blockers

- **None.** I008 RESOLVED in 7b.1 (prior session). Open backlog empty for the third consecutive session.

---

## In-flight work

- None — Phase 7b fully shipped + tagged. 7c.1 is a hard HALT gate; no files mid-edit.

---

## Test / eval status

- **Last test run:** Phase 7b close, 2026-04-21T22:37Z — 428 tests across 13 packages, all green. (+53 across the full 7b arc: +28 at 7b.1 for migration 006 + identity helper, +23 at 7b.2 for spend aggregations, +24 at 7b.3 for CLI handler + window parser + project resolver, +6 at 7b.4 for round-trip.)
- **Per-package counts at close:** core 14, logger 5, ipc 5, providers 37, state 92, assessor 42, wiki 39, channels 25, events 3, worker 24, brain 59, daemon 28, cli 55.
- **Eval score** (agent phases only): unchanged from 7a.8 — directive `01KPRHNEX1T3VR3S4ZTTSJ8F0M`, $1.9151 of $3.00 ceiling, tripped cleanly at builder-2.
- **Regression tests:** I008 / ADR 0021 regression in `packages/cli/src/commands/spend-roundtrip.test.ts` (6 tests). 7a budget regression in `packages/brain/src/budget-regression.test.ts`. Migration 006 shape + backfill in `packages/state/src/migrations/006-project-identity.test.ts` (11 tests). F001 verifier regression in `packages/worker/src/verifier-f001.test.ts`. Registry shape regression in `packages/state/src/migrations/003-findings-registry.test.ts`.
- **Live validation (7b.3 smoke):** `factory spend` against the real local DB returned 2 projects (`example (…SG6H)` + `parallel-example (…9PR3)`) + 2 `(unassigned)` calls totalling $63.17 across 116 rows. Migration 006 auto-ran on first touch of that DB.

---

## Recent decisions (last 3 ADRs)

- **ADR 0021** (2026-04-21) — First-class project identity via `<project>/.factory/project.json` (ULID). Stable across path moves; explicit at fork. Closes I008. Foundation for 7b per-project rollups.
- **ADR 0020** (2026-04-21) — Pre-call budget enforcement: rolling-average estimator per `(category, mode)` + cold-start defaults; `assertBudget` wrapper in brain; `budget_exceeded_*:` prefix on `directives.blocked_reason`.
- **ADR 0019** (2026-04-21) — Drop GitHub integration. Future output-to-GH is operator-directed per-directive, not pattern-driven. **Durable doctrine** that shapes Phase 7c framing (Discord is now the reference channel; Telegram is the third, not the second-after-GitHub).

All 21 ADRs live under `docs/decisions/`.

---

## Recently completed (last 5 steps)

- **Phase 7b closed** — 2026-04-22 — tag `phase-7b-spend-dashboard-closed`; commit `ecce6ef`. 5 sub-steps (7b.1 → 7b.5).
- **7b.4 — Round-trip regression for I008 under ADR 0021** — 2026-04-22 — commit `6743ee3`. `spend-roundtrip.test.ts` — two tmp workspaces basename `example` with distinct identity files; both surface distinctly in dashboard; `--project example` hits ambiguity path.
- **7b.3 — `factory spend` CLI subcommand** — 2026-04-22 — commit `87ef9dd`. `runSpend` handler + Commander wrapper; `--group-by`/`--since`/`--until`/`--project`/`--json`/`--limit`; ambiguous project-ref disambiguation list; live-smoke against real DB returned 116 rows / $63.17 across 2 projects.
- **7b.2 — `@factory5/state.queries.spend` aggregation queries** — 2026-04-22 — commit `beb540a`. `perProject`/`perDirective`/`perDay`/`perModel` + shared `SpendFilter` + `formatProjectDisplay` helper. LEFT JOIN through directives/projects so orphan rows collapse into `(unassigned)`.
- **7b.1 — Data-model prep / first-class project identity** — 2026-04-21 — commits `71b36ff` → `92bebf4` → `786698a` → `1999a14`. ADR 0021 + migration 006 + `loadOrCreateProjectMetadata` helper + insert-path wiring across CLI build/resume/findings + brain pool + wiki findings. Closes I008.

---

## Attempts that didn't work (current step only)

- None yet — 7c.1 is a HALT, not a work step. No attempts have been made.

---

## Environment snapshot

- **Language / runtime:** TypeScript strict mode on Node 20+ (ADR 0001). pnpm workspaces. ESM (NodeNext) with explicit `.js` import extensions.
- **Key pinned deps:** Pino, Zod, Commander, Fastify, better-sqlite3, discord.js, chokidar, simple-git, vitest, ulid.
- **Model in use:** Claude Opus 4.7 for scaffolding sessions; live builds use category routing per ADR 0004 (quick=Haiku 4.5, planning=Sonnet 4.6, deep/reasoning=Opus 4.7).
- **Other:** Windows + Linux cross-platform mandatory. 13 packages + 2 apps. 428 tests. `CHANNEL_IDS` narrowed to `['cli','discord','telegram']` per ADR 0019. Budget enforcement per ADR 0020. Project identity via `.factory/project.json` per ADR 0021. Cross-session spend dashboard via `factory spend` per 7b.3.

---

## Notes for next session

If resuming after `/session-end` or a cold start:

1. Read `CLAUDE.md` (root) — standing brief incl. Control-framework section and the steps.md-checkbox discipline line.
2. Read this STATE.md.
3. Read `.control/phases/phase-7-budget-discipline/README.md` + `steps.md` for the Phase 7c checklist (7c.1 → 7c.7; 7c.1 is a HALT).
4. Read `docs/decisions/0019-drop-github-integration.md` for the durable doctrine — factory's effects in the world are operator-directed per-directive, not pattern-driven. This frames how Telegram is scoped (same shape as Discord; no outbound webhook spam, no pattern-driven messaging).
5. Read `docs/Phase7_Progress.md` for the full 7b arc (§"Phase 7b — cross-session spend dashboard") and the 7c outline at the bottom.
6. Run `/session-start` for the full drift check.
7. **Next concrete work:** confirm with the operator that secrets are in place (env vars or `~/.factory5/config.toml [channels.telegram]`), then begin 7c.2 — `packages/channels/src/telegram.ts` implementing `ChannelPlugin`.

**Execution order reminder:** Phase 7 runs **7a → 7b → 7c** in strict order. 7a + 7b both closed; 7c is the final sub-phase. After 7c.7 closes, Phase 7 as a whole closes with tag `phase-7-closed` and Phase 8 opens (not yet charted — options discussed at 7b close: Web UI, assessor tier-3, worker-subprocess `ask_user`).

**Budget for 7c:** 1–2 sessions. Telegram integration is a third ChannelPlugin (Discord is the reference); long-polling event source (Telegram's preferred transport). Budget-wise similar to Phase 4's Discord integration but lighter since the plugin pattern is established.

**Operator follow-up from Phase 6 close (still out-of-band whenever convenient):**

1. Revoke PAT at https://github.com/settings/tokens.
2. Delete throwaway repo: `gh repo delete momobits/factory5-6b-smoke --yes`.
3. Clear env var: `reg delete "HKCU\Environment" /v GITHUB_TOKEN /f`.

None of these block Phase 7c.
