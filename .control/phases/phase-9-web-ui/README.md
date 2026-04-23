# Phase 9 — Web UI

**Dependencies:** Phase 8 closed (tag `phase-8-worker-ask-user-closed`)
**Estimated duration:** 3–5 sessions
**Status:** 🟢 active — opens with the Phase 8 close commit

## Goal

Browser dashboard served by `factoryd` that surfaces the operator's
existing state at a glance and replaces the half-dozen `factory …`
CLI subcommands an operator currently strings together to check "what
is factory doing right now?" Ship the **read-side first** (directives,
tasks-inflight, pending questions, spend, findings) so the dashboard
is useful immediately against live factoryd data. Phase 9b+ adds the
interactive surfaces (answer a pending question from the browser,
kick off a build, etc.) — but the Phase 8 `ask_user` work now makes
pending-question surfacing a compelling headline feature that pays for
the whole dashboard on its own.

The charter lives here; per-step detail gets fleshed out as each
sub-step opens (Phase 7 pattern).

## Charter

`factoryd` already owns an HTTP Fastify on `127.0.0.1:25295`
([ADR 0012](../../../docs/decisions/0012-daemon-in-factoryd-process.md)).
Phase 9 extends it with two surfaces served off the same port:

1. **Static SPA bundle** (`/app/*`) — an Astro build (same stack used
   in other Anthropic internal projects) output at
   `apps/factory-web/dist/`. Served by Fastify's static plugin under
   `/app`; clients load `http://127.0.0.1:25295/app/` and the SPA
   takes it from there.
2. **Read-side JSON API** (`/api/v1/*`) — bearer-gated (reuse the
   `FACTORY5_WORKER_AUTH_TOKEN` pattern from 8.2, or rotate a fresh
   UI token), returning the shapes the SPA needs: directive list,
   directive detail + timeline, pending questions, spend rollups,
   findings. No server-side rendering.

The SPA reads-only in sub-phase 9a. Sub-phase 9b adds mutations (POST
endpoints to answer questions, start new builds). Sub-phase 9c is the
close + charter for the Phase 10 queue.

Binding stays localhost-only. Non-loopback requests refused at the
preHandler (same guard as the existing IPC routes).

## Sub-step schedule (preliminary — refined at 9.1 open)

| Step | Subject                                                                     |
| ---- | --------------------------------------------------------------------------- |
| 9.1  | ADR 025 — Web UI architecture (framework pick, bundling, auth, routing)     |
| 9.2  | `apps/factory-web/` scaffold + dev-loop (`pnpm dev --filter factory-web`)   |
| 9.3  | Fastify static serve of `/app` + bearer gate + `/api/v1/status` smoke       |
| 9.4  | `/api/v1/directives` + `/api/v1/directives/:id` (list + detail, read-only)  |
| 9.5  | `/api/v1/pending-questions` (list + detail, with answered/unanswered split) |
| 9.6  | `/api/v1/spend` (surface the existing `factory spend` aggregations)         |
| 9.7  | `/api/v1/findings` (list + filter by severity / status / project)           |
| 9.8  | SPA pages: overview / directives / questions / spend / findings             |
| 9.9  | Live validation (open browser, confirm all pages load, latency budget)      |
| 9.10 | Phase close — tag `phase-9-web-ui-closed`, scaffold Phase 10 (assessor T3)  |

Single-charter phase; no sub-letter split planned at this point (can
revisit if 9a vs 9b mutation split grows large).

## Done criteria

- [ ] All sub-steps checked off with commit references
- [ ] `pnpm build` clean (including new `apps/factory-web/` bundle), `pnpm test` green
- [ ] `pnpm lint` + `pnpm format:check` clean
- [ ] Browser loads `http://127.0.0.1:25295/app/` against a live factoryd; overview / directives / questions / spend / findings pages all render with real data
- [ ] `/api/v1/*` returns 401 without the bearer token
- [ ] [ADR 025](../../../docs/decisions/) authored covering framework pick, auth, bundling, dev-loop shape
- [ ] `docs/PROGRESS.md` entry; `docs/Phase9_Progress.md` charter created
- [ ] Working tree clean
- [ ] Tag `phase-9-web-ui-closed`

## Rollback plan

`git reset --hard phase-8-worker-ask-user-closed`. The new code is
purely additive (new `apps/factory-web/` package, new Fastify routes
under `/app/*` and `/api/v1/*`). factoryd without the Phase 9 changes
behaves exactly as today — the bearer-gated `/worker/*` routes stay
unchanged.

## Forward queue (after Phase 9)

- **Phase 10** — Assessor tier-3 (Node / Go / Rust pluggable runtimes,
  ~2–3 sessions). The Phase 8 `ask-user-smoke` run re-confirmed that
  the current Python-only assessor is the ceiling on what projects
  factory can produce; once the UI lands, broadening the assessor is
  the next visibility unlock (more languages → more real builds → more
  operator eyes on the UI).

Order is durable — only re-pick if a HALT event in Phase 9 reveals a
different priority.
