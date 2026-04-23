# Project State

> Single source of truth for Control's operational cursor. Read this first every session. Updated at every `/session-end` and by the `PreCompact` hook.

**Last updated:** 2026-04-23T21:30:00Z (session `2026-04-23T21`) — Phase 9 (Web UI) closed. Phase 10 (Assessor tier-3) active, opens at step 10.1.
**Current phase:** 10 — Assessor tier-3 — **🟢 active**
**Current sub-phase:** n/a — single-charter phase (may re-split into 10a Node / 10b Go / 10c Rust if any single runtime balloons)
**Current step:** 10.1 — ADR 0026 (pluggable-runtime contract: provisioner shape + verify-gate command mapping + failure-mode taxonomy + host-tool pre-flight)
**Status:** Phase 9 closed clean: 605 tests green across 14 packages; all 10 sub-steps committed + checked off; ADR 0025 accepted; Web UI read-side live-validated against the operator's real factory.db at p50 ≈ 2.5 ms (~40× headroom on the 100 ms charter target). Phase 10 scaffolded. Working tree clean. Tag `phase-9-web-ui-closed` applied on the phase-close commit.

---

## Project spec

**Canonical:** `CompleteArchitecture.md` at root. New §21 "Web UI" added in the Phase 9 close commit (2026-04-23). Phase 10's close commit will extend §6 or §9 (or add §22) once the pluggable-runtime shape lands.
**Current reference:** `docs/ARCHITECTURE.md` (evolves), `docs/CONTRACTS.md`, `docs/SKILLS.md`, `docs/AGENTS.md`.
**Phase history:** `docs/PROGRESS.md` (chronological), `docs/Phase9_Progress.md` (last closed).
**Role:** the `docs/` tree is authoritative. `.control/architecture/overview.md` is a pointer.

---

## Next action

**Sub-step 10.1 — ADR 0026** (pluggable-runtime contract).

The ADR pins four sub-decisions before any runtime lands:

1. **Provisioner shape** — does the provisioner own the project's env (install deps, configure typecheck tools) or does it expect the project runnable out-of-the-box and just run the gate commands? Python (ADR 0017, tier-2) owns the venv; Node/Go/Rust likely benefit from _not_ owning — `package.json` / `go.mod` / `Cargo.toml` are enough.
2. **Verify-gate command mapping** — which commands count as the "did this project build + pass tests" signal per runtime? Draft: Node = `pnpm install → pnpm typecheck || tsc --noEmit → pnpm test`; Go = `go build ./... && go test ./...`; Rust = `cargo test`. Edge cases: projects with no `typecheck` script, workspace monorepos, optional doc-test gates.
3. **Failure-mode taxonomy** — how does the assessor distinguish compile failure vs. test failure vs. env-setup failure vs. missing tool? Today's finding taxonomy (severity + tag) has to encode this uniformly so the Phase 9 findings UI stays runtime-agnostic.
4. **Host-tool pre-flight** — failure shape when `node` / `pnpm` / `go` / `cargo` is missing from PATH. Probably `ENV_HOST_MISSING_TOOL` finding + WONTFIX default + operator-facing error; blocking until resolved. Should be consistent across all three runtimes.

Output: `docs/decisions/0026-pluggable-runtime-contract.md` (or similar slug) + `docs/decisions/INDEX.md` row + phase-9 → phase-10 transition commit on top of the close.

After 10.1: 10.2 Node/TypeScript runtime (provisioner + verify gate + integration test).

---

## Git state

- **Branch:** main (ahead of `origin/main` by ~81 commits — push at operator discretion)
- **Last commit:** `<to-be-filled-by-phase-close-commit>` (will be the `chore(phase-9): close phase 9, kick off phase 10` commit).
- **Uncommitted changes:** none. Working tree clean post-close.
- **Last phase tag:** `phase-9-web-ui-closed` (applied on the close commit).

Earlier tags intact: `phase-8-worker-ask-user-closed`, `addendum-onboarding-closed`, `phase-7c-telegram-channel-closed`, `phase-7b-spend-dashboard-closed`, `phase-7a-budget-enforcement-closed`, `phase-7-closed`, `phase-6-closed`, `phase-6a-findings-registry-closed`, `phase-6c-verifier-overhaul-closed`, `protocol-initialised`.

---

## Open blockers

- **None for Phase 10 itself.** No prior-phase blockers gate 10.1.
- **Carry-forward** (unchanged, non-blocking):
  - Issue **I009** (MEDIUM, OPEN) — Telegram/Discord inbound don't inherit `[budget.defaults]`.
  - Issue **I012** (LOW, OPEN) — `maybeAnswerPendingQuestion` FIFO matcher can't target a specific open question.
  - **Stale-dist dev-loop gotcha** (from Phase 9 `docs/Phase9_Progress.md` §Non-trivial finding) — recommend flipping `packages/{daemon,ipc,state}/package.json` `main` to `src/index.ts` to eliminate the rebuild-before-run footgun.
  - **`factory ui-token` CLI command** (from ADR 0025 §2) — operator closes the terminal → loses the dashboard URL; today's mitigation is restart factoryd.

---

## In-flight work

- None. Phase 9 closed clean; Phase 10 not yet started in code.

---

## Test / eval status

- **Last test run:** Phase 9 close, 2026-04-23T21:22Z — **605 tests** across 14 packages, all green on Windows. Exit code 0. `pnpm lint` + `pnpm format:check` clean. `pnpm build` clean across 14 packages + 3 apps.
- **Per-package counts at close:** core 14, logger 13, ipc 14, providers 39, state 134, assessor 42, wiki 47, channels 62, events 3, worker 24, brain 64, daemon 79, cli 55, worker-mcp 15. Sum = 605 (verified).
- **Eval score** (agent phases only): no agent runs this close. Phase 8.7 live run remains the most recent: directive `01KPX1Z4RE3535H8X55E169PHR`, $2.579 / 7 LLM calls.

---

## Recent decisions (last 3 ADRs)

- **ADR 0025** (2026-04-23) — Web UI architecture: Astro MPA + Islands + `<ClientRouter />`, separate `FACTORY5_UI_TOKEN` bearer distributed via `?t=` query → sessionStorage, `@fastify/static` under `/app/` + Vite dev proxy in dev, `/api/v1/*` URL-prefix versioning. Four sub-decisions in one ADR per the multi-part shape established by ADR 0020.
- **ADR 0024** (2026-04-23) — Worker-subprocess `askUser`: MCP route, paused-budget wait, taskId-mandatory correlation, `waiting_for_human` lifecycle, whitelist.
- **ADR 0023** (2026-04-22) — Repo-local factory instances via cwd-walk discovery; `.factory/` replaces `.factory5/`.

All 25 ADRs live under `docs/decisions/`. ADR 0026 (pluggable-runtime contract) opens Phase 10 at 10.1.

---

## Recently completed (last 5 phase closes / major steps)

- **Phase 9 — Web UI closed** — 2026-04-23 — tag `phase-9-web-ui-closed`. Read-side dashboard on factoryd: `/app/*` static SPA (Astro) + `/api/v1/*` JSON API (5 routes). 605 tests green. ADR 0025.
- **Phase 9 sub-step 9.8 — SPA pages** — 2026-04-23 — `5190f44`. Seven Astro pages wired to `/api/v1/*`.
- **Phase 9 sub-step 9.7 — /api/v1/findings** — 2026-04-23 — `6a29f2f`.
- **Phase 9 sub-step 9.6 — /api/v1/spend** — 2026-04-23 — `a5ad4d0`.
- **Phase 9 sub-step 9.5 — /api/v1/pending-questions** — 2026-04-23 — `917f4a8`.

Earlier: 9.4 `9c2d10a` (directives), 9.3 `930b7a1` (static + status), 9.2 `b0cbf53` (Astro scaffold), 9.1 `f71840a` (ADR 0025). Phase 8 closed `9bc9136` → tag `phase-8-worker-ask-user-closed`.

---

## Attempts that didn't work (current step only)

- None yet — Phase 10 not started in code.

---

## Environment snapshot

- **Language / runtime:** TypeScript strict mode on Node 20+ (ADR 0001). pnpm workspaces. ESM (NodeNext) with explicit `.js` import extensions.
- **Key pinned deps (unchanged from Phase 9 close):** `astro ^5.0.0`, `@astrojs/check ^0.9.0` (in `apps/factory-web/`); `@fastify/static ^7.0.0` (in `@factory5/daemon`); Pino, Zod, Commander, Fastify v4, better-sqlite3, discord.js, chokidar, simple-git, vitest, ulid, `@modelcontextprotocol/sdk ^1.0.0`.
- **Model in use:** Claude Opus 4.7 for session work.
- **Other:** Windows + Linux cross-platform mandatory. **14 packages + 3 apps**. **605 tests**. `CHANNEL_IDS` narrowed to `['cli','discord','telegram']` (ADR 0019). Budget enforcement per ADR 0020. Project identity via `.factory/project.json` (ADR 0021). Cross-session spend via `factory spend` (7b.3). Telegram channel via plugin-owned long-poll (ADR 0022). Instance data dir via cwd-walk (ADR 0023). Worker `ask_user` per ADR 0024. Web UI per ADR 0025. Pluggable runtime contract to land as ADR 0026 (this phase).

---

## Notes for next session

If resuming after `/session-end` or a cold start:

1. Read `CLAUDE.md` (root) — standing brief incl. Control-framework section.
2. Read this STATE.md.
3. Read `.control/phases/phase-10-assessor-tier3/README.md` + `steps.md`.
4. Skim [ADR 0017](../../docs/decisions/0017-assessor-project-env-provisioning.md) — the tier-1/2 provisioner abstraction that Phase 10's ADR 0026 extends. Also skim `packages/assessor/src/` to see the current Python-runtime implementation shape before writing ADR 0026.
5. Run `/session-start` for the full drift check.
6. **Next concrete work:** sub-step 10.1 — author ADR 0026. The ADR pins the four sub-decisions listed in this STATE's "Next action" section.

**Budget for Phase 10:** 2–3 sessions per README.

**Carry-forward** (still non-blocking):

- Issues I009 (MEDIUM, OPEN) + I012 (LOW, OPEN).
- Stale-dist dev-loop gotcha — flip `packages/{daemon,ipc,state}/package.json` `main` to `src/index.ts`. Easy win whenever touched.
- `factory ui-token` CLI command (ADR 0025 §2).
- Phase 6 operator follow-up (PAT revoke at <https://github.com/settings/tokens>; `gh repo delete momobits/factory5-6b-smoke --yes`; `reg delete "HKCU\Environment" /v GITHUB_TOKEN /f`).
- Phase 8 resource-hygiene note — `askUser` handler's poll loop keeps running after the worker subprocess exits. Cosmetic.
- Phase 8 filesystem scoping note — workers have unrestricted `Read`/`Glob`/`Grep`. Pre-existing; becomes a Phase 12 (tentative) candidate if verifier hallucinations from repo-internal files affect a build outcome.
