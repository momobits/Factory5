# Phase 9 — progress & roadmap

> Phase-level overview of the Phase 9 arc. `docs/PROGRESS.md` has the
> session-by-session history; this file tracks the _shape_ of Phase 9
> (what's done, what "done" looked like, carry-forwards).

## Where we were, end of Phase 8

Phase 8 closed 2026-04-23 (`phase-8-worker-ask-user-closed` on commit
`9bc9136`) with worker-subprocess `ask_user` shipped: MCP route
(new `@factory5/worker-mcp`), `taskId`-mandatory correlation,
paused-budget wait with 1h soft deadline, `tasks_inflight.status =
'waiting_for_human'` migration 007 for brain-restart recovery,
whitelist limited to scaffolder/builder/fixer/investigator.
**564 tests green**, 24 ADRs.

Operating surface at Phase 9 start:

- **CLI-only observability.** `factory status` / `factory directives`
  / `factory questions` / `factory spend` / `factory findings` — five
  independent commands an operator would shell through to answer "what
  is factory doing right now?" No single surface aggregated them.
- **Phase 8 made `pending_questions` a first-class interactive
  surface.** Builders now ask mid-stream; answers land via Discord /
  Telegram / CLI. The "where is factory waiting on me?" question was
  immediately more important, and the CLI wasn't a satisfying answer.
- **Fastify already ran on `127.0.0.1:25295`** (ADR 0012) with the
  `/worker/*` bearer namespace (ADR 0024). Phase 9 extends that server
  with two new surfaces — static `/app/*` and bearer-gated
  `/api/v1/*` — without forking the process.

## Phase 9 scope

Single-charter phase (no sub-letter split). Ten sub-steps shipped in
order; the charter and per-step detail live in
`.control/phases/phase-9-web-ui/{README.md,steps.md}`.

| Step | Subject                                                                         | Status         |
| ---- | ------------------------------------------------------------------------------- | -------------- |
| 9.1  | ADR 0025 — Web UI architecture (Astro + Islands + FACTORY5_UI_TOKEN + routing)  | ✅ `f71840a`   |
| 9.2  | `apps/factory-web/` scaffold (Astro 5 + `@astrojs/check`, `apps/*` glob pickup) | ✅ `b0cbf53`   |
| 9.3  | Fastify `@fastify/static` under `/app/*` + bearer gate + `/api/v1/status`       | ✅ `930b7a1`   |
| 9.4  | `/api/v1/directives` list + `:id` detail with timeline rollup                   | ✅ `9c2d10a`   |
| 9.5  | `/api/v1/pending-questions` list + `:id` detail                                 | ✅ `917f4a8`   |
| 9.6  | `/api/v1/spend` — per-project / per-directive / per-day / per-model rollups     | ✅ `a5ad4d0`   |
| 9.7  | `/api/v1/findings` list + severity/status/project/advisory filters              | ✅ `6a29f2f`   |
| 9.8  | SPA pages (overview / directives / questions / spend / findings)                | ✅ `5190f44`   |
| 9.9  | Live validation — operator browser smoke, all pages green, latency within SLO   | ✅ this commit |
| 9.10 | Phase close (tag, docs, §Web UI pointer, Phase 10 scaffold)                     | ✅ this commit |

## ADR decided in Phase 9

**[ADR 0025](decisions/0025-web-ui-architecture.md)** — Web UI
architecture. Four sub-decisions in one ADR per the multi-part shape
established by ADR 0020:

1. **Framework = Astro MPA + Islands + `<ClientRouter />`.** File-based
   routing under `src/pages/`, one HTML file per page, each fetches
   its data client-side via `fetch('/api/v1/...')`. No cross-page
   shared state to manage. `<ClientRouter />` gives SPA-ish transition
   feel without SPA state plumbing. Islands (`client:load`) stay
   available for 9b interactive surfaces. Considered alternatives:
   Vite+React (ships ~44 KB min+gz of React alone for a read-only
   grid), lit-html / vanilla (needs hand-rolled build pipeline).
2. **Auth = separate `FACTORY5_UI_TOKEN`** minted at factoryd startup
   via `randomBytes(24).toString('hex')`, distinct from the worker
   token (ADR 0024). Distributed via `?t=<48-hex>` query → `sessionStorage`
   (stripped from URL by `history.replaceState` on page load). Rationale:
   a leaked dashboard token (e.g. rogue browser extension slurps
   sessionStorage) must not grant worker-impersonation privileges.
3. **Bundle serving = `@fastify/static` under `/app/*` in prod** +
   Astro dev server with Vite `/api/v1` → `127.0.0.1:25295` proxy in
   dev. No SSR adapter (keeps output fully static → deploys as a
   `dist/` directory). Detail pages use `?id=<ulid>` query param
   pattern, not dynamic `[id].astro` (dynamic routes under static
   output require a server adapter).
4. **Routing = `/api/v1/*` URL-prefix versioning.** Future
   incompatible schema changes ship as `/api/v2/*` alongside v1 until
   both clients and server cut over. Same pattern every long-lived
   HTTP API grows into.

## Live validation (9.9) — what was proven

factoryd started against the operator's existing `factory.db` (~5 MB,
25 directives, 13 pending questions, $69.6 spend across 141 calls in 5
projects, 3+ findings). UI token `de0e2ceb3b7da4c1608faef86d39ceb4fa75d17db3785b34`
minted on boot; `http://127.0.0.1:25295/app/?t=<token>` printed to
stdout. Operator opened the URL in a browser and clicked through all
five surfaces.

**Server-side smoke (pre-browser, 14 route variants):**

| Route                                               | Status | Latency (ms) |
| --------------------------------------------------- | ------ | ------------ |
| `/api/v1/status`                                    | 200    | 4.2          |
| `/api/v1/directives` (full list, 25 items)          | 200    | 4.0          |
| `/api/v1/directives?limit=5&offset=0`               | 200    | 3.7          |
| `/api/v1/directives?status=complete&limit=5`        | 200    | 2.3          |
| `/api/v1/directives/:id` (detail + timeline)        | 200    | 2.1          |
| `/api/v1/directives/<nonexistent>`                  | 404    | 2.1          |
| `/api/v1/pending-questions` (default status=open)   | 200    | 2.8          |
| `/api/v1/pending-questions?status=answered&limit=5` | 200    | 2.2          |
| `/api/v1/pending-questions?status=all&limit=5`      | 200    | 2.6          |
| `/api/v1/pending-questions/:id`                     | 200    | ~2           |
| `/api/v1/spend` (all 4 rollups)                     | 200    | 2.8          |
| `/api/v1/spend?since=...&until=...`                 | 200    | 3.4          |
| `/api/v1/findings` (10 items)                       | 200    | 2.5          |
| `/api/v1/findings?limit=5` / `?severity=HIGH` / ... | 200    | 1.9–2.3      |
| `/app/` (Astro shell HTML)                          | 200    | 4.5          |
| auth: no token / bad token (`UI_AUTH_REQUIRED`)     | 401    | 2.2          |

**p50 ≈ 2.5 ms across 14 routes** — ~40× headroom under the 100 ms
charter target on the ~5 MB local factory.db.

**Browser-side (operator observation, all green):**

- `/app/` — five summary cards populated (directives total, open
  questions, today spend, all-time spend, open findings).
- `/app/directives/` — list renders; row click → `/app/directives/detail?id=<ulid>`
  shows full timeline (tasks, open questions, model_usage rollup).
- `/app/questions/` — defaults to `status=open`; toggle to `answered`
  / `all` re-fetches cleanly; detail deep-link works.
- `/app/spend/` — four rollup tables render with tabular-num
  formatting; `since` / `until` / `projectId` filters restrict.
- `/app/findings/` — severity / status / project / advisory filters
  narrow the list.
- DevTools Network — per-route wall-clock consistent with server-side
  numbers (5–15 ms including browser transition cost).

## Non-trivial finding (worth keeping)

**Stale-`dist/` runtime gotcha.** First restart of factoryd during 9.9
pre-flight tripped on a stale `packages/daemon/dist/index.js` (5 minutes
older than `src/server.ts` at HEAD). `/api/v1/spend` and `/api/v1/findings`
returned 404 despite all daemon tests passing. Root cause: `apps/factoryd`
imports `@factory5/daemon` as a workspace dep, which resolves via
`packages/daemon/package.json` `main: "./dist/index.js"`. Vitest resolves
`.ts` source directly, so tests pass on fresh source even when dist is
stale; `pnpm factoryd` (which runs under tsx, but imports workspace deps
via their `main` entry) picks up stale dist.

STATE.md's "Attempts that didn't work" section already flagged the same
hazard for `@factory5/ipc` / `@factory5/state` rebuilds during in-session
test runs. Runtime is the analog. Fix applied in-session:
`pnpm --filter @factory5/ipc --filter @factory5/state --filter @factory5/daemon build`.

**Candidate remediation** (deferred to Phase 10+ or early Phase 9b):

1. Change `packages/daemon/package.json` (and `@factory5/ipc` /
   `@factory5/state`) to point `main`/`exports` at `src/index.ts`.
   `tsx` transpiles on demand, dev-loop no longer needs explicit
   rebuild. Prod `pnpm build` still produces `dist/` for downstream
   consumers. One-line config change per package; highest ROI.
2. Add a `prefactoryd` build step at repo root. Cheap but rebuilds
   every start, even when nothing changed. Weaker than (1).
3. CI: a run-factoryd smoke script that hits every `/api/v1/*` route
   once. Would have caught this pre-commit. Complementary to (1), not
   a substitute.

## Ergonomic follow-ups deferred (also non-blocking)

Surfaced during implementation; not in 9.x scope; carry forward to
9b / Phase 10:

- **`factory ui-token` CLI command.** ADR 0025 §2 described it; 9.3
  scope was daemon-wiring only. Operator who closes the terminal
  loses the URL — today's mitigation is to restart factoryd and copy
  the new URL from stdout.
- **Fastify preHandler scoped to `/api/v1/*`.** ADR 0025 §3 described
  a shared preHandler for the bearer check; 9.3 chose inline
  handler-level checks to mirror `/worker/ask-user`. Effect is
  identical — purely stylistic refactor.
- **SSE for live overview updates.** Explicitly deferred by ADR 0025
  §Alternatives. Polling works on localhost; layer on top of the
  existing bearer when UX pressure materialises.

## Issues opened / closed in Phase 9

None. I009 (MEDIUM, OPEN) + I012 (LOW, OPEN) carry forward unchanged
from Phase 8; they describe Telegram/Discord inbound behaviour, not
Web UI surface.

## Tests at close

- Phase 8 close baseline: 564 aggregate (per-package sum 554 — the
  Phase 8 progress doc's aggregate had a +10 miscount; noting for
  honesty, not re-litigating).
- **Phase 9 close: 605** tests across 14 packages. All green on
  Windows. Per-package sums exactly to 605. `pnpm lint` +
  `pnpm format:check` clean. `pnpm build` clean (14 packages + 3
  apps + factory-web's static dist).

Per-sub-step test deltas:

- 9.3 — +13 daemon (`/api/v1/status` auth paths + `/app/*` static
  serve + 404 + loopback guard).
- 9.4 — +6 state (`directivesQ.listPaged`), +9 daemon (list + detail
  happy/error paths).
- 9.5 — +7 state (`pendingQuestions.listPaged` — first dedicated
  unit-tests for that module), +7 daemon (list + detail, status
  filter, directiveId scope).
- 9.6 — +5 daemon (`/api/v1/spend` — 401, empty-db shape, seeded
  rollups, since/until, 400 on invalid since).
- 9.7 — +8 daemon (`/api/v1/findings` — each filter isolated + 400 on
  invalid severity).
- 9.8 — 0 new tests (SPA pages; verification via operator browser
  smoke in 9.9).

Per-package at close: core 14, **logger 13**, **ipc 14**, **providers
39**, **state 134** (+13 from 9.4 + 9.5), assessor 42, **wiki 47**,
**channels 62**, events 3, worker 24, **brain 64**, **daemon 79**
(+38 across 9.3–9.7), **cli 55**, **worker-mcp 15**.

## Dependency changes

- `astro ^5.0.0` + `@astrojs/check ^0.9.0` added to new
  `apps/factory-web/`.
- `@fastify/static ^7.0.0` added to `@factory5/daemon`.
- `pnpm-lock.yaml` grew ~3.6 KLOC from Astro's transitive deps
  (305 packages added at 9.2).

No runtime-dep removals.

## Carry-forward

1. **Issue I009** (OPEN, MEDIUM) — Telegram/Discord inbound don't
   inherit `[budget.defaults]`. Non-blocking. Fix at directive
   creation: apply defaults regardless of source.
2. **Issue I012** (OPEN, LOW) — `maybeAnswerPendingQuestion` FIFO
   matcher. Phase 9b's mutation UI ("answer a specific question from
   the browser") can functionally close this with a "choose question"
   picker.
3. **Stale-dist dev-loop gotcha** (§Non-trivial finding above).
   Recommendation: flip `packages/{daemon,ipc,state}/package.json`
   `main` → `src/index.ts`. One-line per package. Pair with a CI
   smoke that starts factoryd and curls every `/api/v1/*` route.
4. **`factory ui-token` CLI** (ADR 0025 §2) — small IPC route + cli
   command. Easy win for 9b or a Phase 10 cleanup step.
5. **Phase 6 operator follow-up** (still unchanged, still out-of-band):
   revoke PAT at <https://github.com/settings/tokens>;
   `gh repo delete momobits/factory5-6b-smoke --yes`;
   `reg delete "HKCU\Environment" /v GITHUB_TOKEN /f`.

## Done criteria — assessment at close

- [x] All sub-steps checked off with commit references (table above).
- [x] `pnpm build` clean; `pnpm test` green (605 tests across 14
      packages, 2026-04-23).
- [x] `pnpm lint` + `pnpm format:check` clean.
- [x] Browser loads `http://127.0.0.1:25295/app/` against a live
      factoryd; overview / directives / questions / spend / findings
      pages all render with real data (operator confirmation, 2026-04-23).
- [x] `/api/v1/*` returns 401 without the bearer token (smoke
      `UI_AUTH_REQUIRED` on both no-token and bad-token).
- [x] [ADR 0025](decisions/0025-web-ui-architecture.md) authored
      covering framework + auth + bundling + routing.
- [x] `docs/PROGRESS.md` entry appended; this `docs/Phase9_Progress.md`
      charter created.
- [x] Working tree clean.
- [x] Tag `phase-9-web-ui-closed` (applied on the phase-close commit).
