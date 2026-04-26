# Project State

> Single source of truth for Control's operational cursor. Read this first every session. Updated at every `/session-end` and by the `PreCompact` hook.

**Last updated:** 2026-04-26 (session `2026-04-26T09`, session-end) — Phase 10 closed earlier this session (`phase-10-assessor-tier3-closed`, commit `1351b2f`); a follow-up stale-dist investigation explored two fixes for the Phase-9-suggested one-line flip but both have non-trivial blockers, so the carry-forward language was clarified rather than landing a code change (commit `0df2b51`). Phase 11 (Web UI 9b — mutation surface) opens with 11.1 next.
**Current phase:** 11 — Web UI 9b (mutation surface) — **🟢 active**
**Current sub-phase:** n/a — single-charter phase
**Current step:** 11.1 — ADR 0027 (mutation route shape, idempotency, error envelope)
**Status:** Working tree clean. 666 tests green across 14 packages. `pnpm lint` + `pnpm format:check` clean. `pnpm build` clean across 14 packages + 3 apps.

---

## Project spec

**Canonical:** `CompleteArchitecture.md` at root. §22 "Pluggable runtimes" added at Phase 10 close.
**Current reference:** `docs/ARCHITECTURE.md` (evolves), `docs/CONTRACTS.md`, `docs/SKILLS.md`, `docs/AGENTS.md`.
**Phase history:** `docs/PROGRESS.md` (chronological). `docs/Phase10_Progress.md` written at Phase 10 close (one charter doc per phase pattern).
**Role:** the `docs/` tree is authoritative. `.control/architecture/overview.md` is a pointer.

---

## Next action

**Sub-step 11.1 — ADR 0027 (mutation route shape).** Pin the mutation surface contract before any route lands. Decisions to nail down: HTTP verbs + URL shape, idempotency rules (especially for build-creation; per-question answer is naturally idempotent), error envelope shape (status + code + human + maybe field-level errors), `metadata.budgetDefaults` shape mirroring `directiveLimitsSchema`. Output: `docs/decisions/0027-*.md` + INDEX row.

After 11.1: 11.2 (answer route), 11.3 (build route), 11.4 (budget route), 11.5 (SPA forms), 11.6 (live validation), 11.7 (phase close).

---

## Git state

- **Branch:** main (ahead of `origin/main` — push at operator discretion)
- **Last commit:** `0df2b51 docs(state): clarify stale-dist gotcha needs design, not a one-liner`. Recent log: `0df2b51 docs(state)` → `1351b2f chore(phase-10) close` → `8be8dc0 feat(10.7)` → `62ee979 feat(10.5)` → `503da4d feat(10.8)` → `50bab61 feat(10.3)` → `9c8106f docs(state)` → `0563a85 feat(10.6)` → `10f2132 feat(10.4)` → `34763dc feat(10.2)`. Session-end docs commit lands on top of this STATE.md update.
- **Uncommitted changes:** none (modulo `.claude/scheduled_tasks.lock` which is harness-local and gitignored from working-tree intent).
- **Last phase tag:** `phase-10-assessor-tier3-closed` (set on `1351b2f`).

Earlier tags intact: `phase-9-web-ui-closed`, `phase-8-worker-ask-user-closed`, `addendum-onboarding-closed`, `phase-7c-telegram-channel-closed`, `phase-7b-spend-dashboard-closed`, `phase-7a-budget-enforcement-closed`, `phase-7-closed`, `phase-6-closed`, `phase-6a-findings-registry-closed`, `phase-6c-verifier-overhaul-closed`, `protocol-initialised`.

---

## Open blockers

- **None for Phase 11.** All carry-forwards below are non-blocking.
- **Carry-forward** (unchanged):
  - **I009** (MEDIUM, OPEN, `channels/telegram`) — Telegram/Discord inbound `/build` doesn't inherit `[budget.defaults]`.
  - **I012** (LOW, OPEN, `channels/telegram`) — `maybeAnswerPendingQuestion` FIFO matcher can't target a specific open question.
  - **I014** (MEDIUM, OPEN, `brain/architect`) — new in Phase 10. Architect re-running on existing project leaves wiki edits uncommitted, dirty-tripping `gate.verify`. Targeted fix: stage + commit at end of `runArchitect` if a git repo exists.
  - **Stale-dist dev-loop gotcha** — Phase 9's recommended one-line fix (flip `packages/{daemon,ipc,state}/package.json` `main` to `src/index.ts`) is **incompatible with the prod runtime path**. Confirmed empirically 2026-04-26: tsx/vitest pick up the source fine, but `node apps/factoryd/dist/main.js` then fails with `Cannot find module .../src/brain-supervisor.js` (raw node can't transpile `.js` extensions on `.ts` source). Real fixes are bigger: (a) **conditional exports** with a `development` condition + explicit `--conditions=development` for tsx/vitest, or (b) **bundle workspace deps in `apps/*/tsup.config.ts`** via `skipNodeModulesBundle: true` + `noExternal: [/^@factory5\//]` — but then app package.jsons need to declare every transitive npm dep (commander, pino, fastify, zod, …) since pnpm doesn't hoist transitive deps to where bundled output looks. Both are real design decisions, not one-line cleanups; deserves its own substep when next touched.
  - **`factory ui-token` CLI command** (ADR 0025 §2 carry-forward) — operator closes terminal → loses dashboard URL.
  - **Phase 6 operator follow-ups** (PAT revoke, `gh repo delete`, env var cleanup) — out-of-band.

---

## In-flight work

- None. Phase 10 closed clean; Phase 11 opens with 11.1 next.

---

## Test / eval status

- **Last test run:** Phase 10 close, 2026-04-26 — **666 tests** across 14 packages, all green on Windows. `pnpm lint` + `pnpm format:check` clean. `pnpm build` clean across 14 packages + 3 apps.
- **Per-package counts (end of Phase 10):** core 14, logger 13, ipc 14, providers 39, state 134, assessor 79 (Python 42 + Node 15 + Node e2e 1 + Go 12 + Rust 9), wiki 49, channels 62, events 3, worker 28, brain 74, daemon 79, cli 63, worker-mcp 15. Sum = 666 (verified).
- **Live run datapoints (Phase 10 — three real `factory build`s):**
  - Node: directive `01KQ0P14MZZPJRPA5RW929TTSJ`, $3.57, 14 vitest passed.
  - Go: directive `01KQ4H8Y66HVWJJXAYTS1BJE2Q` (resume of `01KQ4GCTJ8EFVJ2VBVJ6ETP46H`), $5.40 across both attempts, 34 go-test passed.
  - Rust: directive `01KQ4JEQWAV3E36DV7RQ6SFH8S`, $1.98, 7 cargo-test passed.
- **Real-subprocess coverage in assessor test suite:** Node e2e runs `pnpm install` + `pnpm typecheck` + `pnpm test` against a seeded tmpdir TS fixture per run. Observed ~7 s warm, up to ~15 s cold. Go and Rust e2es remain out of scope for the seam test suite (covered by 10.5 / 10.7 live validation).

---

## Recent decisions (last 3 ADRs)

- **ADR 0026** (2026-04-24) — Pluggable assessor runtimes: two-shape provisioner contract, per-runtime verify-gate command mapping, four-tag failure-mode taxonomy, host-tool pre-flight via `resolveOnPath`. Three runtimes (Node / Go / Rust) implement the contract; all three live-validated by Phase 10 close.
- **ADR 0025** (2026-04-23) — Web UI architecture: Astro MPA + Islands + `<ClientRouter />`, separate `FACTORY5_UI_TOKEN`, `@fastify/static` under `/app/`, `/api/v1/*` URL-prefix versioning.
- **ADR 0024** (2026-04-23) — Worker-subprocess `askUser`: MCP route, paused-budget wait, taskId-mandatory correlation, `waiting_for_human` lifecycle.

All 26 ADRs live under `docs/decisions/`. Phase 11 will add ADR 0027 (mutation route shape) at 11.1.

---

## Recently completed (last 5 phase closes / major steps)

- **Stale-dist investigation** — 2026-04-26 — `0df2b51 docs(state)`. Empirically tested both Phase-9-suggested fixes (simple `main` flip + tsup workspace-bundling); both surfaced non-trivial blockers (raw-node `.js`-on-`.ts` resolution; transitive npm dep visibility under bundled output). Reverted; clarified carry-forward language so the next session doesn't repeat the simple flip.
- **Phase 10 closed** — 2026-04-26 — `1351b2f` + tag `phase-10-assessor-tier3-closed`. Three new runtimes Node / Go / Rust shipped + live-validated; ADR 0026 accepted; 4 in-phase bugs caught + fixed (`--language` threading, I013 worktree cleanup, `extractJsonObject` string state, Go runtime `-v -count=1`); I014 filed; 666 tests (605 → +61).
- **Phase 10 sub-step 10.7 — Rust live validation** — 2026-04-26 — `8be8dc0 feat(10.7)`. cargo-test 7 passed, $1.98, clean first try.
- **Phase 10 sub-step 10.5 — Go live validation** — 2026-04-26 — `62ee979 feat(10.5)`. go-test 34 passed; runtime parser `-v -count=1` fix + I014 filed.
- **Phase 10 sub-step 10.8 — `factory init` language picker** — 2026-04-25 — `503da4d feat(10.8)`. Project scaffold mode + `metadata.language` + build fallback.

---

## Attempts that didn't work (current step only)

- **Stale-dist gotcha — simple `main` flip** (this session, 2026-04-26). Flipped `packages/{daemon,ipc,state}/package.json` `main` from `dist/index.js` to `src/index.ts`. dev-loop (tsx + vitest) worked, raw-node prod path (`node apps/factoryd/dist/main.js`) failed with `Cannot find module .../src/brain-supervisor.js` — raw node doesn't transpile `.js` extensions on `.ts` source.
- **Stale-dist gotcha — workspace-dep bundling in apps/\* tsup** (this session, 2026-04-26). Added `tsup.config.ts` to `apps/{factory,factoryd}/` with `skipNodeModulesBundle: true` + `noExternal: [/^@factory5\//]`. Bundles built cleanly but raw-node failed on transitive npm deps not declared in app package.json (`commander` for factory, `zod` for factoryd) — pnpm doesn't hoist transitive deps to where bundled output expects them. Apps would need to declare every transitive npm dep explicitly. Reverted.
- Cleared once Phase 11 opens (these are stale-dist, not 11.x).

---

## Environment snapshot

- **Language / runtime:** TypeScript strict mode on Node 20+ (ADR 0001). pnpm workspaces. ESM (NodeNext) with explicit `.js` import extensions.
- **Key pinned deps (unchanged from Phase 9 close):** `astro ^5.0.0`, `@astrojs/check ^0.9.0` (in `apps/factory-web/`); `@fastify/static ^7.0.0` (in `@factory5/daemon`); Pino, Zod, Commander, Fastify v4, better-sqlite3, discord.js, chokidar, simple-git, vitest, ulid, `@modelcontextprotocol/sdk ^1.0.0`. **No new external deps in Phase 10.**
- **Model in use:** Claude Opus 4.7 for session work.
- **Other:** Windows + Linux cross-platform mandatory. **14 packages + 3 apps**. **666 tests**. `CHANNEL_IDS` narrowed to `['cli','discord','telegram']` (ADR 0019). Budget enforcement per ADR 0020. Project identity via `.factory/project.json` (ADR 0021). Cross-session spend via `factory spend` (7b.3). Telegram channel via plugin-owned long-poll (ADR 0022). Instance data dir via cwd-walk (ADR 0023). Worker `ask_user` per ADR 0024. Web UI per ADR 0025. Pluggable runtime per ADR 0026.
- **Host toolchain at Phase 10 close:** pnpm 9.12.0, Node v22.22.2, Go 1.26.2, Rust/Cargo 1.95.0. All four host tools the assessor's runtimes need are installed and on PATH; `resolveOnPath` finds each.

---

## Notes for next session

If resuming after `/session-end` or a cold start:

1. Read `CLAUDE.md` (root) — standing brief incl. Control-framework section.
2. Read this STATE.md.
3. Read `.control/phases/phase-11-web-ui-9b/README.md` + `steps.md` (the new charter).
4. Skim [docs/Phase10_Progress.md](../../docs/Phase10_Progress.md) for the just-closed phase context (the bugs that surfaced there are useful priors for the I014 fix that will likely land mid-Phase-11).
5. Skim [ADR 0026](../../docs/decisions/0026-pluggable-runtime-contract.md) if you'll touch anything assessor-related; otherwise it's not on Phase 11's path.
6. Run `/session-start` for the full drift check.

**Budget for Phase 11:** 1–2 sessions per the README. Mostly code (no live LLM spend other than the 11.6 validation run, which can be cheap because the operator just exercises mutations end-to-end against an already-known project).

**Carry-forward** (still non-blocking):

- I009 (MEDIUM) + I012 (LOW) + **I014 (MEDIUM, new this phase)**.
- Stale-dist dev-loop gotcha — flip `packages/{daemon,ipc,state}/package.json` `main` to `src/index.ts`. Easy single-commit win.
- `factory ui-token` CLI command (ADR 0025 §2).
- Phase 6 operator follow-up.
