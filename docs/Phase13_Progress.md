# Phase 13 — progress & roadmap

> Phase-level overview of the Phase 13 arc. `docs/PROGRESS.md` has the
> session-by-session history; this file tracks the _shape_ of Phase 13
> (what shipped, what "done" looked like, carry-forwards).

## Where we were, end of Phase 12

Phase 12 closed 2026-04-26 (`phase-12-worker-fs-scoping-closed`) with the worker subprocess sandbox shipped: a new 15th workspace package `@factory5/worker-sandbox`, three layered Claude-Code-native primitives (per-spawn `permissions.deny` + `PreToolUse` hook + `--permission-mode acceptEdits`), and ADR 0028 pinning the contract. Live validation produced **zero deny lines** across a real `factory build log-totals-cli`; the LLM never reached out of scope. **813 tests green**, 28 ADRs, 15 packages.

The 12.4 operator investigation surfaced two new things alongside that win:

- **MAJOR**: the daemon was silently disabling its file-sink logger. Pretty-printed stdout worked but `<dataDir>/logs/factoryd-*.log` never materialised. mkdirSync ran without exception; the directory still didn't appear. Discovered while trying to debug 12.4 itself.
- **MEDIUM**: the operator hit the long-standing `factory ui-token` ergonomic gap (lose terminal scrollback → lose dashboard URL until factoryd restart). On the carry-forward list since Phase 7 (ADR 0025 §2).

Plus two existing carry-forwards still pending:

- **MEDIUM**: I009 (Phase 11.4 carry-forward) — Telegram + Discord inbound `/build` paths skip both the project-tier and config-tier budget defaults. Builds initiated from chat ran uncapped regardless of `[budget.defaults]` or `metadata.budgetDefaults`.
- **MEDIUM**: I014 (Phase 10.5 carry-forward) — `runArchitect` re-running on `factory resume` leaves tracked `docs/knowledge/*.md` edits uncommitted, dirty-tripping `gate.verify` even when the runtime gate passes.

Phase 13's charter pays down all four with surgical, sweep-style fixes — TS-only work, no live-LLM spend.

## Phase 13 scope

Single-charter phase (no sub-letter split). Five sub-steps shipped in order; the charter and per-step detail live in `.control/phases/phase-13-operator-experience/{README.md,steps.md}`.

| Step | Subject                                                                                                                                                              | Status         |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| 13.1 | I015 — file-sink logger silent fail. Auto-init footgun in `createLogger` shadowed every explicit `initLogger`. Fixed via `Proxy` deferral + `initLogger` replacement | ✅ `652f411`   |
| 13.2 | `factory ui-token` CLI command + `GET /ui-token` IPC route. ADR 0025 §2 carry-forward                                                                                | ✅ `f25b323`   |
| 13.3 | I009 — extract shared `resolveDirectiveLimits` helper across all four directive-creation paths                                                                       | ✅ `bf79c26`   |
| 13.4 | I014 — `runArchitect` auto-commits its wiki writes when a git repo exists                                                                                            | ✅ `00682ef`   |
| 13.5 | Phase close (tag, this doc, PROGRESS entry, Phase 14 scaffold)                                                                                                       | ✅ this commit |

## What "done" looked like

End-to-end smoke against a clean `.factory/` after every sub-step:

| Sub-step | Smoke evidence                                                                                                                                                                                                                                                                                                           |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 13.1     | `npx tsx apps/factoryd/src/main.ts --foreground` → `.factory/logs/factoryd-2026-04-27.log` materialises (2247 bytes) with every line tagged `"process":"factoryd"`. The smoking gun pre-fix: every line was tagged `"process":"unknown"` because the auto-init won the race against the explicit init.                   |
| 13.2     | Same factoryd run + `node apps/factory/dist/main.js ui-token` → printed `http://127.0.0.1:25295/app/?t=<48-hex>`, exit 0. `--token-only` printed just the token. Round-trip test in CLI runs against a real `startIpcServer`-backed daemon (no mocks).                                                                   |
| 13.3     | factoryd boots with `resolveBuildLimits` wired into the channel registry; Telegram/Discord plugin tests assert `directive.limits` is set when the resolver returns project + config tiers, and absent (no crash) when the resolver is unwired or throws. `POST /api/v1/builds` regression-tested with all three tiers.   |
| 13.4     | Eight unit tests around `commitArchitectWritesIfRepo` cover modify+commit, untracked+commit, no-op-on-identical, no-op-on-non-repo, no-op-on-empty-pages, default-subject, graceful-degrade-on-git-failure, and isolation-from-unrelated-dirty-docs. Live verification deferred — would require a real `factory resume`. |

## Architecture decisions

**No new ADRs.** Phase 13 was a sweep phase. None of the four fixes required pinning a new contract:

- **13.1's logger fix** rewrote internal init mechanics but kept the public API surface (`createLogger` / `initLogger`) shape-compatible. The Proxy is an implementation detail.
- **13.2's `factory ui-token`** added one CLI command and one IPC route. The auth shape was deliberately the same as `/status` and `/healthz` (loopback-only, no bearer) — no new boundary.
- **13.3's `resolveDirectiveLimits` helper** consolidated logic ADR 0027 §4 already pinned. The helper is the single source of truth for the merge order it spec'd.
- **13.4's architect auto-commit** is a localised change inside `runArchitect`. ADR-level discussion considered (a wider "commit any uncommitted state" sweep before the worker pool) but rejected as too aggressive.

The Phase 12 close already extended `CompleteArchitecture.md` with §24. Phase 13 ships **no `CompleteArchitecture.md` change**.

## Implementation footprint

| Component                                          | Change                                                                                                                                                                                                                                              |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/logger/src/logger.ts`                    | Lazy-resolving `Proxy` from `createLogger`; `initLogger` replaces an auto-init root when called explicitly. New `__resetLoggerForTests` for test isolation.                                                                                         |
| `packages/logger/src/filesink-repro.test.ts` (NEW) | 7 regression tests including a subprocess driver against the dist build that asserts the file-sink lands the line on disk.                                                                                                                          |
| `packages/ipc/src/schemas.ts` + `client.ts`        | New `uiTokenResponseSchema` + `UiTokenResponse` type + `DaemonClient.uiToken()`.                                                                                                                                                                    |
| `packages/daemon/src/server.ts`                    | New `GET /ui-token` route (loopback-only, no bearer, returns `{ token, url, hasStaticBundle }`). New `IpcServerOptions.configBudgetDefaults` threaded through to `POST /api/v1/builds` for the Phase-13.3 third tier.                               |
| `packages/cli/src/commands/ui-token.ts` (NEW)      | `factory ui-token [--token-only]` subcommand wired into the Commander tree. Exposes `runUiToken` for tests.                                                                                                                                         |
| `packages/cli/README.md`                           | Documents the new command, its output shapes, and the four exit codes.                                                                                                                                                                              |
| `packages/wiki/src/project-metadata.ts`            | New `resolveDirectiveLimits({ explicitFlags, projectDefaults, configDefaults })`. Per-field independent merge. Lives next to existing `budgetDefaultsFromProjectMeta`.                                                                              |
| `packages/cli/src/commands/build.ts`               | Refactored to call the helper inline (was duplicated logic).                                                                                                                                                                                        |
| `packages/channels/src/types.ts` + `registry.ts`   | New `ChannelContext.resolveBuildLimits(name) → DirectiveLimits \| undefined` callback. Threaded from registry options.                                                                                                                              |
| `packages/channels/src/{telegram,discord}.ts`      | Both inbound `/build` paths call `resolveBuildLimits` when available; attach the result to the directive before emitting via `onInbound`. Channels stay decoupled from `@factory5/wiki`.                                                            |
| `packages/daemon/src/index.ts`                     | Lifted `fileConfig` load out of the `noChannels` block so both channels (resolveBuildLimits) and IPC (`configBudgetDefaults`) see it. Wired `registryResolveBuildLimits` closure that loads project meta + applies the helper.                      |
| `packages/brain/src/architect.ts`                  | `commitArchitectWritesIfRepo` helper called at end of `runArchitect`. Stages only the architect-written paths (preserves unrelated dirty `docs/`); commits with deterministic subject. Graceful-degrade on git failure (logged warn, never throws). |
| `packages/brain/package.json`                      | Adds `simple-git ^3.25.0` (was already a worker dep).                                                                                                                                                                                               |
| `packages/brain/src/architect.test.ts` (NEW)       | 8 unit tests covering all eight decision branches of the helper.                                                                                                                                                                                    |

## Tests at close

**855 tests green** across 15 packages (was 813 across 15). +42 from this phase:

- `logger`: 13 → 20 (+7 from 13.1 — file-sink + I015-regression + subprocess driver)
- `ipc`: 14 (unchanged)
- `daemon`: 121 → 129 (+5 from 13.2 `/ui-token` route + +3 from 13.3 config-tier `/api/v1/builds`)
- `cli`: 63 → 70 (+7 from 13.2 `factory ui-token` round-trip)
- `wiki`: 58 → 64 (+6 from 13.3 `resolveDirectiveLimits` unit tests)
- `channels`: 62 → 68 (+4 telegram + +2 discord I009 inbound regression)
- `brain`: 74 → 82 (+8 from 13.4 `commitArchitectWritesIfRepo` coverage)

`pnpm lint` + `pnpm format:check` clean. `pnpm build` clean across 15 packages + 3 apps.

## Issues paid down

| Issue | Severity | Resolution                                                                                                                                              |
| ----- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I015  | MAJOR    | Logger auto-init no longer wins the race against explicit `initLogger`. `Proxy`-deferred child binding + replace-on-explicit-init.                      |
| I009  | MEDIUM   | Three-tier merge consolidated in `@factory5/wiki/resolveDirectiveLimits`; channels gain `resolveBuildLimits` callback wired by the daemon.              |
| I014  | MEDIUM   | `runArchitect` auto-commits its wiki writes via `commitArchitectWritesIfRepo`. Stages only architect-written paths; degrades gracefully on git failure. |

(I015 was filed AND resolved within Phase 13.1 — discovered during 12.4 operator investigation, surfaced as the smoking gun behind every previously-suspected-Pino weirdness.)

## New CLI surface

| Command                         | Purpose                                                    | Notes                                                     |
| ------------------------------- | ---------------------------------------------------------- | --------------------------------------------------------- |
| `factory ui-token`              | Print the dashboard URL with the live `FACTORY5_UI_TOKEN`. | Loopback-only daemon route. Hint when SPA bundle missing. |
| `factory ui-token --token-only` | Print just the bare token.                                 | For piping into `curl -H "Authorization: Bearer $(...)"`. |

## Carry-forward — discovered or amplified during Phase 13

Phase 13 didn't surface significant new debt — the four-issue sweep was the main work. The same long-tail items from Phase 12 carry forward unchanged:

| Item                               | Severity | Origin                  | Notes                                                                                                                                                                       |
| ---------------------------------- | -------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **I012** — Telegram FIFO matcher   | LOW      | Phase 8                 | `maybeAnswerPendingQuestion` can't target a specific open question; matches by chat-id prefix. Carries forward.                                                             |
| **I013** — node_modules cleanup    | MEDIUM   | Phase 10 (status drift) | INDEX still lists OPEN; Phase 10's `prePurgeDepDirs` fixed the original symptom and Phase 12's sandbox cleanup paid down the worktree-cleanup surface. Re-status candidate. |
| **Stale "open" pending_questions** | LOW      | Phase 12                | 14 orphaned escalations from older completed directives. One-shot DB sweep when convenient.                                                                                 |
| **PowerShell em-dash mojibake**    | LOW      | Phase 12                | Operator console codepage. README addendum is the cheapest fix; `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8` recommended.                                     |
| **Stale-dist dev-loop gotcha**     | (no ID)  | Phase 9                 | "now overdue" — every workspace-dep edit requires `pnpm build` before `pnpm factoryd`. Recommended remediation: conditional exports + `--conditions=development`.           |
| **Phase 6 operator follow-ups**    | LOW      | Out-of-band             | PAT revoke, `gh repo delete`, env var cleanup.                                                                                                                              |

## Out of scope, deferred

- **Bash sandboxing** — Phase 12 charter explicitly accepted as a limitation; 13's brief revisited and stayed deferred. 12.4 produced zero deny lines, so demand signal is absent. Revisit if a real incident materialises.
- **Network egress scoping** — long-tail concern; today workers reach npm / crates.io / etc. for legitimate dep installs. Wait for an egress-policy demand signal.
- **`/build` flag parsing on Telegram/Discord** (e.g. `/build foo --max-usd 5`) — flagged in I009's hypothesis as a follow-up. The shared `resolveDirectiveLimits` helper accepts an `explicitFlags` slot; once the channel parser lands, wiring is one line. Not in 13.3 scope.

## Where we are heading

**Phase 14 — Carry-forward continuation + ergonomics** (working title). Charter scaffolded at `.control/phases/phase-14-carry-forward-continuation/`. The natural follow-up to Phase 13's sweep theme: knock down the longest-running carry-forwards (stale-dist dev-loop is "overdue" since Phase 9; the I013 status drift would benefit from a re-read), then small ergonomic wins (PowerShell mojibake README addendum, the orphaned-pending-questions DB sweep, I012 Telegram matcher fix). Order is by demand signal — 14.1 opens against whichever carry-forward bites the operator first. Estimated 2–3 sessions; mostly TS / docs work, no live-LLM spend baseline.
