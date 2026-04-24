# Project State

> Single source of truth for Control's operational cursor. Read this first every session. Updated at every `/session-end` and by the `PreCompact` hook.

**Last updated:** 2026-04-24T13:16:12Z (session `2026-04-24T13`, session-end) — Phase 10 sub-steps 10.1 + 10.2 + 10.4 + 10.6 closed. Three tier-3 runtimes (Node / Go / Rust) code-complete; live validations (10.3 / 10.5 / 10.7) + 10.8 init picker + 10.9 phase close remain.
**Current phase:** 10 — Assessor tier-3 — **🟢 active**
**Current sub-phase:** n/a — single-charter phase
**Current step:** 10.3 — Node live validation next (or 10.8 init picker if operator prefers an additive code step before spending on live builds)
**Status:** 4/9 sub-steps closed this session. 642 tests green across 14 packages (605 → +37: +15 Node seam + 1 real Node e2e + 12 Go seam + 9 Rust seam). ADR 0026 accepted. All three new runtimes (`runtimes/{node,go,rust}.ts`) follow the pluggable contract; Node has a real-subprocess e2e under `test/node-e2e.test.ts` (~7 s warm against a tmpdir TS fixture). `lint` + `format:check` clean, `build` clean. Working tree clean (session-end docs commit pending on top).

---

## Project spec

**Canonical:** `CompleteArchitecture.md` at root. Phase 10's close commit will extend §6/§9 or add §22 once tier-3 live validations complete.
**Current reference:** `docs/ARCHITECTURE.md` (evolves), `docs/CONTRACTS.md`, `docs/SKILLS.md`, `docs/AGENTS.md`.
**Phase history:** `docs/PROGRESS.md` (chronological). `docs/Phase10_Progress.md` opens at phase close (9.10 pattern — deferred until 10.9).
**Role:** the `docs/` tree is authoritative. `.control/architecture/overview.md` is a pointer.

---

## Next action

**Sub-step 10.3 — Node live validation** is the load-bearing next step. Four sub-decisions from ADR 0026 are implemented in code but have only been exercised against seam-injected subprocesses + one tmpdir e2e; a real `factory build` against a scaffolded Node spec validates the whole loop (scaffolder → builder → assessor.node.runGate → verifier → gate composition).

Suggested spec: **"Build a TypeScript CLI that parses a JSON log file and prints totals"** — ~200 LOC, one small integration test, exercises `pnpm install → pnpm typecheck → pnpm test` end-to-end. Autonomy mode with a modest per-directive budget ceiling (say $5 cap) so a loop that won't terminate bails automatically.

After 10.3: pick either 10.5 / 10.7 (needs `go` / `cargo` on the host — currently absent) or 10.8 (`factory init` language picker, pure code, no host-tool dependency). 10.8 is the right next-after-10.3 step if the live Go/Rust runs can't be scheduled immediately.

Phase close (10.9) is gated on all three live validations — 10.3 / 10.5 / 10.7 all have to be green before the tag `phase-10-assessor-tier3-closed` goes on.

---

## Git state

- **Branch:** main (ahead of `origin/main` by ~85 commits — push at operator discretion)
- **Last commit:** `0563a85 feat(10.6): Rust assessor runtime (ADR 0026)`. Session-end docs-state commit lands after this STATE.md update.
- **Uncommitted changes:** none at last tool-invocation; session-end docs commit pending.
- **Last phase tag:** `phase-9-web-ui-closed` (no new phase tag this session — Phase 10 still open).

Earlier tags intact: `phase-8-worker-ask-user-closed`, `addendum-onboarding-closed`, `phase-7c-telegram-channel-closed`, `phase-7b-spend-dashboard-closed`, `phase-7a-budget-enforcement-closed`, `phase-7-closed`, `phase-6-closed`, `phase-6a-findings-registry-closed`, `phase-6c-verifier-overhaul-closed`, `protocol-initialised`.

---

## Open blockers

- **None for Phase 10 itself.** The three live validations (10.3 / 10.5 / 10.7) are operator-triggered, not blockers.
- **Host-tool gap for 10.5 / 10.7:** neither `go` nor `cargo` is on this dev machine (verified at 10.4 / 10.6 close via `command -v`). Install Go 1.21+ from <https://go.dev/dl/> and Rust via <https://rustup.rs/> before attempting 10.5 / 10.7. The assessor will surface `ENV_HOST_MISSING_TOOL` with these exact install hints if invoked before then.
- **Carry-forward** (unchanged, non-blocking):
  - Issue **I009** (MEDIUM, OPEN) — Telegram/Discord inbound don't inherit `[budget.defaults]`.
  - Issue **I012** (LOW, OPEN) — `maybeAnswerPendingQuestion` FIFO matcher can't target a specific open question.
  - **Stale-dist dev-loop gotcha** — flip `packages/{daemon,ipc,state}/package.json` `main` from `"./dist/index.js"` to `"./src/index.ts"`. Highest-ROI Phase 10 cleanup item; fits nicely as a one-line chore per package any session that touches those manifests.
  - **`factory ui-token` CLI command** (ADR 0025 §2) — operator closes terminal → loses dashboard URL.

---

## In-flight work

- None. All four sub-steps committed clean; working tree clean modulo session-end docs.

---

## Test / eval status

- **Last test run:** 10.6 close, 2026-04-24T13:14Z (local) — **642 tests** across 14 packages, all green on Windows. `pnpm lint` + `pnpm format:check` clean. `pnpm build` clean across 14 packages + 3 apps + factory-web's static output.
- **Per-package counts (end of session):** core 14, logger 13, ipc 14, providers 39, state 134, assessor 79 (Python 42 + Node 15 + Node e2e 1 + Go 12 + Rust 9), wiki 47, channels 62, events 3, worker 24, brain 64, daemon 79, cli 55, worker-mcp 15. Sum = 642 (verified).
- **Eval score** (agent phases only): no agent runs this session. Phase 8.7 live run remains the most recent: directive `01KPX1Z4RE3535H8X55E169PHR`, $2.579 / 7 LLM calls. 10.3 live validation will produce the first post-Phase-8 agent-run datapoint.
- **Real-subprocess coverage in assessor test suite:** Node e2e runs `pnpm install` + `pnpm typecheck` + `pnpm test` against a seeded tmpdir TS fixture per run. Observed ~7 s warm, up to ~15 s cold. Go and Rust e2es are out of scope for 10.4 / 10.6 (host-tool-missing) and roll into 10.5 / 10.7 live validation.

---

## Recent decisions (last 3 ADRs)

- **ADR 0026** (2026-04-24) — Pluggable assessor runtimes: two-shape provisioner contract (env-owning for Python, env-assuming for Node / Go / Rust), per-runtime verify-gate command mapping, four-tag failure-mode taxonomy (`BUILD_FAILURE` / `TEST_FAILURE` / `ENV_SETUP_FAILURE` / `ENV_HOST_MISSING_TOOL`) on a new optional `AssessResult.failureMode`, host-tool pre-flight via `resolveOnPath` with actionable install hints. Four sub-decisions in one ADR per the multi-part pattern established by ADR 0020 / 0024 / 0025.
- **ADR 0025** (2026-04-23) — Web UI architecture: Astro MPA + Islands + `<ClientRouter />`, separate `FACTORY5_UI_TOKEN`, `@fastify/static` under `/app/`, `/api/v1/*` URL-prefix versioning.
- **ADR 0024** (2026-04-23) — Worker-subprocess `askUser`: MCP route, paused-budget wait, taskId-mandatory correlation, `waiting_for_human` lifecycle.

All 26 ADRs live under `docs/decisions/`. No new ADR expected before 10.9 phase close.

---

## Recently completed (last 5 phase closes / major steps)

- **Phase 10 sub-step 10.6 — Rust runtime** — 2026-04-24 — `0563a85 feat(10.6): Rust assessor runtime (ADR 0026)`. Env-assuming provisioner, single `cargo test` for build+test, `test result:` aggregator across unit/integration/doc targets. 9 seam tests.
- **Phase 10 sub-step 10.4 — Go runtime** — 2026-04-24 — `10f2132 feat(10.4): Go assessor runtime (ADR 0026)`. `go build ./...` + `go test -list` no-test detection + `go test ./...` with `--- PASS/FAIL` line counting incl. subtests. 12 seam tests.
- **Phase 10 sub-step 10.2 — Node/TypeScript runtime** — 2026-04-24 — `34763dc feat(10.2): Node/TypeScript assessor runtime (ADR 0026)`. `pnpm install → typecheck || tsc --noEmit → test` with vitest/jest/node:test summary parsing, full type refactor of `AssessResult` (runtime / failureMode / neutral provisioning), Python runtime moved to `runtimes/python.ts` as an adapter. 15 seam + 1 real-subprocess e2e.
- **Phase 10 sub-step 10.1 — ADR 0026** — 2026-04-24 — `d493ff9 docs(10.1): ADR 0026 — pluggable-runtime contract`. Four sub-decisions pinned before any tier-3 code; implementation outline at bottom of ADR doubled as the 10.2 type sketch.
- **Phase 9 closed** — 2026-04-23 — `e360436 chore(phase-9): close phase 9, kick off phase 10` → tag `phase-9-web-ui-closed`.

---

## Attempts that didn't work (current step only)

- None this session. One in-flight regression was caught immediately: the Go summary parser's PASS/FAIL regex was anchored with `^` and didn't match indented subtest lines (`    --- PASS: Parent/sub`). Switched to `line.trimStart()` before matching; test case was already in place so the fix landed clean in one iteration.

---

## Environment snapshot

- **Language / runtime:** TypeScript strict mode on Node 20+ (ADR 0001). pnpm workspaces. ESM (NodeNext) with explicit `.js` import extensions.
- **Key pinned deps (unchanged):** `astro ^5.0.0`, `@astrojs/check ^0.9.0` (in `apps/factory-web/`); `@fastify/static ^7.0.0` (in `@factory5/daemon`); Pino, Zod, Commander, Fastify v4, better-sqlite3, discord.js, chokidar, simple-git, vitest, ulid, `@modelcontextprotocol/sdk ^1.0.0`. No new deps this session.
- **Model in use:** Claude Opus 4.7 for session work.
- **Other:** Windows + Linux cross-platform mandatory. **14 packages + 3 apps**. **642 tests**. `CHANNEL_IDS` narrowed to `['cli','discord','telegram']` (ADR 0019). Budget enforcement per ADR 0020. Project identity via `.factory/project.json` (ADR 0021). Cross-session spend via `factory spend` (7b.3). Telegram channel via plugin-owned long-poll (ADR 0022). Instance data dir via cwd-walk (ADR 0023). Worker `ask_user` per ADR 0024. Web UI per ADR 0025. Pluggable runtime per ADR 0026.
- **Host toolchain this session:** pnpm 9.12.0, Node v22.22.2. Go + cargo NOT present — 10.5 / 10.7 blocked on install.

---

## Notes for next session

If resuming after `/session-end` or a cold start:

1. Read `CLAUDE.md` (root) — standing brief incl. Control-framework section.
2. Read this STATE.md.
3. Read `.control/phases/phase-10-assessor-tier3/README.md` + `steps.md` (checkboxes flipped for 10.1 / 10.2 / 10.4 / 10.6).
4. Skim [ADR 0026](../../docs/decisions/0026-pluggable-runtime-contract.md) — the contract the three new runtimes implement. The Implementation outline at the bottom of the ADR is the type sketch that landed verbatim in `packages/assessor/src/types.ts`.
5. Skim `packages/assessor/src/runtimes/` (four files + four `.test.ts`s) to see the three concrete runtimes + Python adapter.
6. Run `/session-start` for the full drift check.

**Budget for remainder of Phase 10:** 1–2 more sessions. 10.3 is code-less but spends live LLM budget. 10.5 / 10.7 need host-tool installs. 10.8 is small. 10.9 is docs + tagging.

**Carry-forward** (still non-blocking):

- Issues I009 (MEDIUM) + I012 (LOW).
- Stale-dist dev-loop gotcha — flip `packages/{daemon,ipc,state}/package.json` `main` to `src/index.ts`. Easy single-commit win.
- `factory ui-token` CLI command (ADR 0025 §2).
- Phase 6 operator follow-up (PAT revoke; `gh repo delete momobits/factory5-6b-smoke --yes`; `reg delete "HKCU\Environment" /v GITHUB_TOKEN /f`).
- Phase 8 resource-hygiene note — `askUser` handler's poll loop keeps running after the worker subprocess exits. Cosmetic.
- Phase 8 filesystem scoping note — workers have unrestricted `Read`/`Glob`/`Grep`.
