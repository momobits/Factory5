# Project State

> Single source of truth for Control's operational cursor. Read this first every session. Updated at every `/session-end` and by the `PreCompact` hook.

**Last updated:** 2026-04-23T13:00:00Z — Phase 8 closed (tag `phase-8-worker-ask-user-closed`); Phase 9 (Web UI) kicks off.
**Current phase:** 9 — Web UI — **🟢 active**
**Current sub-phase:** n/a — single-charter phase (no sub-letter split planned)
**Current step:** 9.1 — Author ADR 025 (web-UI architecture: framework pick, auth, bundling, dev-loop, routing)
**Status:** Phase 8 closed cleanly. Worker-subprocess `ask_user` end-to-end validated live 2026-04-23 via Telegram (directive `01KPX1Z4RE3535H8X55E169PHR`, $2.579, 7 LLM calls). ADR 0024 accepted. 564 tests across 14 packages. 4 issues surfaced during Phase 8 (I009–I012): two resolved (I010 WONTFIX, I011 RESOLVED), two OPEN (I009 medium, I012 low) — both filed as post-close follow-ups, neither blocks Phase 9. Phase 9 scaffolded: ten sub-steps from ADR-025 architecture pick to phase close + Phase 10 scaffold.

---

## Project spec

**Canonical:** `CompleteArchitecture.md` at root — snapshot at scaffold, canonical design. §11 updated in Phase 8 close with inline pointer to ADR 0024 (worker-subprocess `ask_user` via MCP route).
**Current reference:** `docs/ARCHITECTURE.md` (evolves), `docs/CONTRACTS.md` (typed data shapes), `docs/SKILLS.md`, `docs/AGENTS.md`.
**Phase history:** `docs/PROGRESS.md` (chronological session log), `docs/Phase5_Progress.md`, `docs/Phase6_Progress.md`, `docs/Phase7_Progress.md`, `docs/Phase8_Progress.md` (NEW this close).
**Role:** the `docs/` tree is authoritative. `.control/architecture/overview.md` is a pointer file only.

---

## Next action

**Sub-step 9.1 — ADR 025 (web-UI architecture).** Pin the framework (Astro vs Vite+React vs lit-html/vanilla), auth shape (reuse `FACTORY5_WORKER_AUTH_TOKEN` vs mint a separate `FACTORY5_UI_TOKEN`), bundle serving (Fastify static plugin vs Astro dev middleware vs prebundled), and routing shape (SPA shell vs MPA). Output: `docs/decisions/0025-web-ui-architecture.md` + INDEX row.

After 9.1: the sub-step outlines in `steps.md` expand as each one opens. 9.2 scaffolds `apps/factory-web/`, 9.3 wires the Fastify static + bearer gate, 9.4–9.7 are the read-side `/api/v1/*` endpoints, 9.8 is the SPA pages, 9.9 is live validation, 9.10 is phase close.

---

## Git state

- **Branch:** main (ahead of `origin/main` by ~72 commits — push at operator discretion)
- **Last commit:** phase-close commit (`chore(phase-8): close phase 8, kick off phase 9`) placed on top of `761034a` (`feat(8.7): live validation of worker ask_user via Telegram`).
- **Uncommitted changes:** none. Working tree clean at close.
- **Last phase tag:** `phase-8-worker-ask-user-closed` (applied in this close commit).

Earlier tags intact: `phase-7-closed`, `addendum-onboarding-closed`, `phase-7c-telegram-channel-closed`, `phase-7b-spend-dashboard-closed`, `phase-7a-budget-enforcement-closed`, `phase-6-closed`, `phase-6a-findings-registry-closed`, `phase-6c-verifier-overhaul-closed`.

---

## Open blockers

- **None.** Issues I009 (Telegram budget defaults) and I012 (Telegram reply-matcher FIFO) are MEDIUM/LOW and don't block Phase 9. Both surfaced during 8.7 live run; filed under `docs/issues/`.

---

## In-flight work

- None at phase-close. Phase 9 opens fresh at 9.1.

---

## Test / eval status

- **Last test run:** Phase 8 close, 2026-04-23T13:00Z — **564 tests** across 14 packages, all green. +93 over Phase 7 close baseline of 471.
- **Per-package counts at close:** core 14, **logger 13**, **ipc 14** (+9 from 8.2), **providers 39** (+2 from 8.3), **state 121** (+29: 24 from 8.5 + 5 from the `fix(8.7)` outbound-filter), assessor 42, **wiki 47** (+8 from the 8.7 `project-resolver.ts`), channels 62 (+2 from the 8.7 Telegram resolver integration), events 3, worker 24, **brain 64** (+5 from 8.4), **daemon 41** (+13: 9 from 8.2 + 4 from 8.6), cli 55, **worker-mcp 15** (NEW in 8.3).
- **Eval score** (agent phases only): Phase 8.7 live run — directive `01KPX1Z4RE3535H8X55E169PHR`, $2.579 over 7 calls, Telegram-initiated, builder MCP `ask_user` → Telegram round-trip validated, directive ended `blocked` (verifier's hallucinated findings, operator replied `abort`). Primary ADR 0024 mechanism validated end-to-end; the "complete + within budget" literal charter nuance documented in `docs/Phase8_Progress.md`.
- **Regression tests added in Phase 8:**
  - `packages/ipc/src/schemas.test.ts` (+9 — 8.2 worker-askUser schema)
  - `packages/daemon/src/server.test.ts` (+9 — 8.2 route happy path / 503 / 401 / 400 / pass-through)
  - `packages/worker-mcp/src/*.test.ts` (+15 — 8.3 NEW package)
  - `packages/providers/src/claude-cli.test.ts` (+2 — 8.3 `--mcp-config` plumbing)
  - `packages/brain/src/agents/registry.test.ts` (+5 — 8.4 whitelist)
  - `packages/state/src/migrations/007-task-waiting-for-human.test.ts` (+9 — 8.5 schema)
  - `packages/state/src/queries/tasks-inflight.test.ts` (+15 — 8.5 lifecycle queries)
  - `packages/daemon/src/worker-ask-user-regression.test.ts` (+4 — 8.6 four ADR 0024 §6 scenarios)
  - `packages/state/src/queries/outbound.test.ts` (+5 — `fix(8.7)` outbound filter)
  - `packages/wiki/src/project-resolver.test.ts` (+8 — 8.7 shared helper)
  - `packages/channels/src/telegram.test.ts` (+2 — 8.7 resolver integration)

---

## Recent decisions (last 3 ADRs)

- **ADR 0024** (2026-04-23) — Worker-subprocess `askUser`: MCP route, paused-budget wait, taskId-mandatory correlation, `waiting_for_human` lifecycle, whitelist. Supersedes ADR 0015's Phase-4 deferral. Validated live in 8.7.
- **ADR 0023** (2026-04-22) — Repo-local factory instances via cwd-walk discovery; `.factory/` replaces `.factory5/`. Partially supersedes ADR 0004's storage-location claims.
- **ADR 0022** (2026-04-22) — Telegram long-polling lives inside `TelegramChannel`, not as a separate `EventSource`.

All 24 ADRs live under `docs/decisions/`. ADR 025 will be written at 9.1.

---

## Recently completed (last 5 phase closes / major steps)

- **Phase 8 closed** — 2026-04-23 — tag `phase-8-worker-ask-user-closed`. Worker-subprocess `ask_user` end-to-end via MCP. 8 sub-steps + one mid-phase `fix(8.7)`. ADR 0024 accepted. 564 tests (+93 from Phase 7 close). 4 new issues (I009–I012, 2 resolved this phase). See `docs/Phase8_Progress.md`.
- **Addendum-onboarding closed** — 2026-04-22 — tag `addendum-onboarding-closed`. Fresh-clone operator journey: deduped `CLAUDE.md`, `docs/ONBOARDING.md`, reshaped `factory init`, `[daemon]` config + `loadDaemonEndpoint()`.
- **Phase 7 closed** — 2026-04-21 — tag `phase-7-closed`. 7a budget enforcement + 7b spend dashboard + 7c Telegram channel. 471 tests. Multiple ADRs (0020, 0022).
- **Phase 6 closed** — 2026-04-21 — tag `phase-6-closed`. 6c verifier advisory (ADR 0018) + 6a findings registry; 6b dropped (ADR 0019).
- **Phase 5 closed pre-Control** — 2026-04-19 — green-verify end-to-end; 255 tests; I001–I007 all resolved.

---

## Attempts that didn't work (current step only)

- n/a — Phase 9 hasn't started. 9.1 opens fresh.

---

## Environment snapshot

- **Language / runtime:** TypeScript strict mode on Node 20+ (ADR 0001). pnpm workspaces. ESM (NodeNext) with explicit `.js` import extensions.
- **Key pinned deps:** Pino, Zod, Commander, Fastify, better-sqlite3, discord.js, chokidar, simple-git, vitest, ulid, **`@modelcontextprotocol/sdk ^1.0.0`** (new in 8.3).
- **Model in use:** Claude Opus 4.7 for scaffolding sessions; live builds use category routing per ADR 0004 (quick=Haiku 4.5, planning=Sonnet 4.6, deep/reasoning=Opus 4.7).
- **Other:** Windows + Linux cross-platform mandatory. **14 packages + 2 apps**. **564 tests**. `CHANNEL_IDS` narrowed to `['cli','discord','telegram']` per ADR 0019. Budget enforcement per ADR 0020. Project identity via `.factory/project.json` per ADR 0021. Cross-session spend dashboard via `factory spend` per 7b.3. Telegram channel via plugin-owned long-poll per ADR 0022. Instance data dir via cwd-walk per ADR 0023. **Worker-subprocess `ask_user`** wired end-to-end per ADR 0024 (Phase 8 shipped).

---

## Notes for next session

If resuming after `/session-end` or a cold start:

1. Read `CLAUDE.md` (root) — standing brief incl. Control-framework section.
2. Read this STATE.md.
3. Read `.control/phases/phase-9-web-ui/README.md` + `steps.md` — Phase 9 charter; 9.1 opens next.
4. Read `docs/Phase8_Progress.md` for the immediate-prior phase retrospective.
5. Skim `docs/decisions/INDEX.md` for the 24 existing ADRs (ADR 025 lands at 9.1).
6. Run `/session-start` for the full drift check.
7. **Next concrete work:** sub-step 9.1 — author ADR 025 on web-UI architecture. Framework pick (Astro leaning), auth shape, bundle serving, routing model. Ship as the single spec for the whole Phase 9 arc before scaffolding `apps/factory-web/` at 9.2.

**Budget for Phase 9:** 3–5 sessions. 9.1 is lightweight (just the ADR). 9.2 scaffolds the app (small, mostly config). 9.3–9.7 are five small Fastify routes (each well-scoped, ~1 session chunk each but bundleable). 9.8 is the SPA pages (likely 1–2 sessions depending on framework pick). 9.9 live validation + 9.10 phase close.

**Carry-forward from Phase 8 (non-blocking):**

- Issue **I009** (MEDIUM, OPEN) — Telegram/Discord inbound don't inherit `[budget.defaults]`.
- Issue **I012** (LOW, OPEN) — `maybeAnswerPendingQuestion` matcher is FIFO across open questions on a directive.
- Resource-hygiene note — `askUser` poll loops kept running in the daemon's HTTP handler after worker subprocess exited (cosmetic; worth honouring `request.aborted` in a future hardening pass).
- Filesystem scoping — workers have unrestricted `Read`/`Glob`/`Grep` against the host filesystem (pre-existing; surfaced via verifier reading our `docs/issues/` during 8.7).

**Operator follow-up from Phase 6 close (unchanged, out-of-band):**

1. Revoke PAT at <https://github.com/settings/tokens>.
2. Delete throwaway repo: `gh repo delete momobits/factory5-6b-smoke --yes`.
3. Clear env var: `reg delete "HKCU\Environment" /v GITHUB_TOKEN /f`.
