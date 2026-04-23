# Project State

> Single source of truth for Control's operational cursor. Read this first every session. Updated at every `/session-end` and by the `PreCompact` hook.

**Last updated:** 2026-04-23T21:00:00Z (session `2026-04-23T20`) — Phase 9 at 8/10 after ADR 025 + full `apps/factory-web` scaffold + 4 read-side API routes + 7 SPA pages; read-side complete, only live validation + phase close remain.
**Current phase:** 9 — Web UI — **🟢 active**
**Current sub-phase:** n/a — single-charter phase (no sub-letter split planned)
**Current step:** 9.9 — Live validation (operator-in-loop: start factoryd, open logged URL in browser, click through every page, verify data + latency)
**Status:** Eight sub-steps committed this session (9.1 ADR → 9.8 SPA pages). Read-side `/api/v1/*` surface (directives, questions, spend, findings) + static `/app/*` bundle + bearer-gated auth are all wired and tested at the HTTP layer. 605 tests green (+41 from Phase 8 close baseline of 564). Working tree clean. 9.9 needs an operator at a browser — agent-executable smoke-testing via curl is possible but the charter criterion is "every page renders with real data + < 100 ms p50 latency" which needs human observation. 9.10 closes the phase.

---

## Project spec

**Canonical:** `CompleteArchitecture.md` at root — snapshot at scaffold, canonical design. Phase 9 does not touch §11; a new §Web UI pointer lands with the 9.10 close commit.
**Current reference:** `docs/ARCHITECTURE.md` (evolves), `docs/CONTRACTS.md` (typed data shapes; to be updated if Phase 9 response schemas promote), `docs/SKILLS.md`, `docs/AGENTS.md`.
**Phase history:** `docs/PROGRESS.md` (chronological), `docs/Phase8_Progress.md` (last closed). `docs/Phase9_Progress.md` authored at 9.10.
**Role:** the `docs/` tree is authoritative. `.control/architecture/overview.md` is a pointer file only.

---

## Next action

**Sub-step 9.9 — Live validation.** Needs an operator at a browser. Concrete steps:

1. Ensure no stale factoryd is running (`factory daemon status`; stop if live).
2. Start factoryd foreground: `pnpm factoryd --foreground` in one terminal.
3. Grab the `ui: http://127.0.0.1:25295/app/?t=<48-hex>` line from stdout.
4. Open the URL in Chrome or Firefox.
5. Confirm:
   - `/app/` overview shows summary cards populated from real factory.db.
   - `/app/directives/` list renders rows; clicking an id opens `/app/directives/detail?id=<ulid>` with timeline (tasks + open questions + spend rollup).
   - `/app/questions/` list defaults to `status=open`; switching to `all` returns answered rows too; deep-link to detail works.
   - `/app/spend/` shows all four rollups (project / directive / day / model) against the operator's ~$63 / 116-call corpus; `since` / `until` filters restrict.
   - `/app/findings/` surfaces the findings_registry rows; severity / status / project filters narrow.
6. Measure latency: each `/api/v1/*` call should hit sub-100ms p50 on the ~5MB factory.db (DevTools Network panel).
7. Paste observations into `docs/Phase9_Progress.md` during 9.10 close.

After 9.9: **9.10 phase close** — tag `phase-9-web-ui-closed`, author `docs/Phase9_Progress.md`, `docs/PROGRESS.md` entry, `CompleteArchitecture.md` §Web UI pointer, scaffold Phase 10 (Assessor tier-3).

---

## Git state

- **Branch:** main (ahead of `origin/main` by ~80 commits — push at operator discretion)
- **Last commit:** `5190f44 feat(9.8): SPA pages consuming /api/v1/* — overview, directives, questions, spend, findings`
- **Uncommitted changes:** none. Working tree clean at session end (docs commit lands next).
- **Last phase tag:** `phase-8-worker-ask-user-closed` (Phase 9 tag waits on 9.10).

Earlier tags intact: `addendum-onboarding-closed`, `phase-7c-telegram-channel-closed`, `phase-7b-spend-dashboard-closed`, `phase-7a-budget-enforcement-closed`, `phase-7-closed`, `phase-6-closed`, `phase-6a-findings-registry-closed`, `phase-6c-verifier-overhaul-closed`.

---

## Open blockers

- **None for Phase 9 itself.** 9.9 is operator-bound, not blocked.
- **Carry-forward from Phase 8 (unchanged, non-blocking):**
  - Issue **I009** (MEDIUM, OPEN) — Telegram/Discord inbound don't inherit `[budget.defaults]`.
  - Issue **I012** (LOW, OPEN) — `maybeAnswerPendingQuestion` matcher is FIFO across open questions on a directive.

---

## In-flight work

- None. All 8 closed sub-steps are committed; working tree is clean post-docs-commit.

---

## Test / eval status

- **Last test run:** Phase 9 session end, 2026-04-23T20:55Z — **605 tests** across 14 packages, all green. +41 over Phase 8 close baseline of 564.
- **Per-package counts:** core 14, **logger 13**, **ipc 14**, **providers 39**, **state 134** (+13: 6 for `directivesQ.listPaged` @ 9.4, 7 for `pendingQuestions.listPaged` @ 9.5), assessor 42, **wiki 47**, channels 62, events 3, worker 24, **brain 64**, **daemon 79** (+38: 9 for `/api/v1/status` + 4 for `/app/*` @ 9.3; 9 for directives routes @ 9.4; 7 for pending-questions routes @ 9.5; 5 for spend @ 9.6; 8 for findings @ 9.7), cli 55, **worker-mcp 15**.
- **New test files this session:** `packages/state/src/queries/pending-questions.test.ts` (+7 tests — first dedicated unit tests for that module).
- **Eval score** (agent phases only): no agent runs this session. Phase 8.7 live run remains the most recent: directive `01KPX1Z4RE3535H8X55E169PHR`, $2.579 / 7 LLM calls.
- **Regression tests added in Phase 9:**
  - `packages/state/src/queries/directives.test.ts` (+6 — 9.4 `listPaged` limit/offset/status filter / clamp)
  - `packages/state/src/queries/pending-questions.test.ts` (+7 — 9.5 `listPaged` status=open/answered/all / directiveId / limit clamp)
  - `packages/daemon/src/server.test.ts` (+38 — 9.3 static + /api/v1/status auth; 9.4 directives list + detail; 9.5 pending-questions list + detail; 9.6 spend; 9.7 findings)
  - `packages/daemon/src/server.test.ts` + `worker-ask-user-regression.test.ts` (edits — 9.3 async-ify of `buildIpcServer` to accommodate `@fastify/static` registration)

---

## Recent decisions (last 3 ADRs)

- **ADR 0025** (2026-04-23) — Web UI architecture: Astro MPA + Islands + `<ClientRouter />`, separate `FACTORY5_UI_TOKEN` bearer distributed via `?t=` query → sessionStorage, `@fastify/static` under `/app/` + Vite dev proxy in dev, `/api/v1/*` URL-prefix versioning. Four sub-decisions in one ADR per the multi-part shape established by ADR 0020.
- **ADR 0024** (2026-04-23) — Worker-subprocess `askUser`: MCP route, paused-budget wait, taskId-mandatory correlation, `waiting_for_human` lifecycle, whitelist.
- **ADR 0023** (2026-04-22) — Repo-local factory instances via cwd-walk discovery; `.factory/` replaces `.factory5/`.

All 25 ADRs live under `docs/decisions/`. Phase 9 adds only ADR 025; 9.10 may cite it without adding another.

---

## Recently completed (last 5 phase closes / major steps)

- **Phase 9 sub-step 9.8 — SPA pages** — 2026-04-23 — `5190f44`. Seven Astro pages (overview, directives list+detail, questions list+detail, spend, findings) wired to `/api/v1/*`. Static output; detail pages use `?id=<ulid>` query param rather than dynamic routes. `<ClientRouter />` for cross-page transition feel.
- **Phase 9 sub-step 9.7 — /api/v1/findings** — 2026-04-23 — `6a29f2f`. List with severity/status/project/advisory filters, limit clamped to [1, 1000]. +8 daemon tests.
- **Phase 9 sub-step 9.6 — /api/v1/spend** — 2026-04-23 — `a5ad4d0`. Four rollups (project/directive/day/model) in one envelope. +5 daemon tests.
- **Phase 9 sub-step 9.5 — /api/v1/pending-questions** — 2026-04-23 — `917f4a8`. List + detail with `status={open|answered|all}` filter + `directiveId` scope. +14 tests (7 state + 7 daemon).
- **Phase 9 sub-step 9.4 — /api/v1/directives** — 2026-04-23 — `9c2d10a`. List with status filter + `:id` detail with timeline (tasks, open questions, spend rollup). New `directivesQ.listPaged` in state. +15 tests (6 state + 9 daemon).
- **Phase 9 sub-step 9.3 — Fastify static + /api/v1/status bearer gate** — 2026-04-23 — `930b7a1`. `@fastify/static` under `/app/` + `FACTORY5_UI_TOKEN` minted on factoryd boot + URL printed to stdout. Extracted `requireUiAuth` helper. +13 daemon tests.

Earlier: 9.2 `b0cbf53` (Astro scaffold), 9.1 `f71840a` (ADR 0025). Phase 8 closed `9bc9136` → tag `phase-8-worker-ask-user-closed`.

---

## Attempts that didn't work (current step only)

- **Dynamic Astro routes (`[id].astro`) require an adapter.** Initial draft at 9.8 put the detail pages at `src/pages/directives/[id].astro` with `prerender: false`. `astro build` failed with `NoAdapterInstalled`. Switched to query-param pattern (`/app/directives/detail?id=<ulid>`) — fully static, no adapter needed, still reads the id client-side. All link builders updated (list → detail and cross-links between directive ↔ question detail).
- **`<ViewTransitions />` deprecated in Astro 5.** `astro check` raised 2 hints; swapped for `<ClientRouter />` (same behaviour, new export name).
- **FK constraint surprises in pending-questions.test.ts.** Initial `makeQuestion` minted a fresh `directiveId` via `newId()` without inserting a directive; `pendingQuestions.create` then tripped `FOREIGN KEY constraint failed`. Fixed by having `makeQuestion` seed a directive first when `overrides.directiveId` isn't supplied. Same hazard hit the server-side directiveId-filter test; fixed there by seeding the shared directive explicitly.
- **Cache-busting `@factory5/ipc` exports.** Tests that consumed new schemas (`apiV1DirectivesListQuerySchema` etc.) failed with `Cannot read properties of undefined (reading 'parse')` until `@factory5/ipc` was rebuilt. Reminder: workspace packages resolve via `dist/` — rebuild upstream before running dependent tests. `pnpm --filter @factory5/ipc --filter @factory5/state build` was the mechanical fix applied before every daemon test run this session.

---

## Environment snapshot

- **Language / runtime:** TypeScript strict mode on Node 20+ (ADR 0001). pnpm workspaces. ESM (NodeNext) with explicit `.js` import extensions.
- **Key pinned deps (new this session):** `astro ^5.0.0`, `@astrojs/check ^0.9.0` (in `apps/factory-web`); `@fastify/static ^7.0.0` (in `@factory5/daemon`). 305 transitive dep packages added by the initial Astro install at 9.2.
- **Other pinned deps (unchanged from Phase 8):** Pino, Zod, Commander, Fastify v4, better-sqlite3, discord.js, chokidar, simple-git, vitest, ulid, `@modelcontextprotocol/sdk ^1.0.0`.
- **Model in use:** Claude Opus 4.7 for all session work (no agent runs — pure TS/HTML/SQL + tests).
- **Other:** Windows + Linux cross-platform mandatory. **14 packages + 4 apps** (new: `apps/factory-web` at 9.2). **605 tests**. `CHANNEL_IDS` narrowed to `['cli','discord','telegram']` per ADR 0019. Budget enforcement per ADR 0020. Project identity via `.factory/project.json` per ADR 0021. Cross-session spend via `factory spend` per 7b.3. Telegram channel via plugin-owned long-poll per ADR 0022. Instance data dir via cwd-walk per ADR 0023. Worker `ask_user` per ADR 0024. **Web UI per ADR 0025** (this phase).

---

## Notes for next session

If resuming after `/session-end` or a cold start:

1. Read `CLAUDE.md` (root) — standing brief incl. Control-framework section.
2. Read this STATE.md.
3. Read `.control/phases/phase-9-web-ui/README.md` + `steps.md` — 9.9 + 9.10 are the only unchecked items.
4. Skim `docs/decisions/0025-web-ui-architecture.md` for the auth / bundle / routing contract the SPA pages implement against.
5. Run `/session-start` for the full drift check.
6. **Next concrete work:** 9.9 live validation — follow the 7-step operator checklist in the "Next action" section above. Expected outcome: every page loads, sub-100ms p50 latency against the operator's existing factory.db, observations captured for `docs/Phase9_Progress.md`.

**Budget for remaining Phase 9:** 0.5–1 session. 9.9 is ~30 min operator time; 9.10 is ~1h of doc authoring + tagging + Phase 10 scaffold.

**Carry-forward from Phase 8 (still non-blocking):**

- Issue **I009** (MEDIUM, OPEN) — Telegram/Discord `/build` inbound doesn't inherit `[budget.defaults]`. Phase 10 cleanup candidate.
- Issue **I012** (LOW, OPEN) — `maybeAnswerPendingQuestion` FIFO matcher can't target a specific open question. Phase 9b (mutation UI) could surface a "choose question" interaction that closes this functionally.
- Resource-hygiene note — `askUser` handler's poll loop keeps running after the worker subprocess exits. Cosmetic.
- Filesystem scoping — workers have unrestricted `Read`/`Glob`/`Grep` against the host filesystem. Pre-existing.

**Operator follow-up from Phase 6 close (unchanged, out-of-band):**

1. Revoke PAT at <https://github.com/settings/tokens>.
2. Delete throwaway repo: `gh repo delete momobits/factory5-6b-smoke --yes`.
3. Clear env var: `reg delete "HKCU\Environment" /v GITHUB_TOKEN /f`.

**Phase 9 ergonomic follow-ups deferred (not blockers, nice-to-haves):**

- `factory ui-token` CLI command — ADR 0025 §2 described it but 9.3 scope was daemon-wiring only. Would land as a small IPC route on factoryd + a `packages/cli/src/commands/ui-token.ts`. Operator who closes the terminal loses the URL today; mitigation is to restart factoryd and copy the new one.
- Refactor inline bearer checks to a Fastify preHandler scoped to `/api/v1/*`. ADR 0025 §3 described a "shared preHandler"; 9.3 chose inline handler-level checks to mirror `/worker/ask-user`. Effect is identical; refactor is aesthetic.
- SSE for live overview updates — explicitly deferred by ADR 0025 §Alternatives. Polling works on localhost; layer on top of the existing bearer when the UX pressure materialises.
