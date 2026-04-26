# Phase 11 — Web UI 9b (mutation surface)

**Dependencies:** Phase 10 closed (tag `phase-10-assessor-tier3-closed`)
**Estimated duration:** 1–2 sessions
**Status:** 🟢 active — opens with this commit

## Goal

Extend the Phase 9 read-only Web UI with the **mutation surface** that
was deferred at Phase 9 charter time. Operators should be able to
answer pending questions, kick off builds, and configure per-project
budget defaults from the browser without dropping back to the CLI.
This makes the Web UI a complete operating surface for typical day-to-day
factory use, not just a read-only dashboard.

The forcing function: ADR 0024 made `pending_questions` a first-class
interactive surface (workers ask mid-stream); Phase 9 made them visible
in the browser; Phase 11 makes them actionable in the browser.

Per-step detail gets fleshed out as each sub-step opens (Phase 7 / 8 /
9 / 10 pattern).

## Charter

Phase 9 shipped GET-only `/api/v1/*` routes; Phase 11 adds the matching
mutation routes. The new write surface needs the same `FACTORY5_UI_TOKEN`
bearer gate and the same `/api/v1/*` versioned URL prefix. Same factoryd
process, same Fastify server (§3 / §21).

Per-route scope:

1. **Answer a pending question** — `POST /api/v1/pending-questions/:id/answer`
   with `{ answer: string }`. Same path the channel inbound handlers
   take (`maybeAnswerPendingQuestion`); the Web UI is just one more
   inbound channel.
2. **Kick off a build** — `POST /api/v1/builds` with `{ project: string,
language?: 'python'|'node'|'go'|'rust', autonomy?: AutonomyMode,
limits?: { maxUsd?: number, maxSteps?: number } }`. Mirrors the
   `factory build` CLI command's directive-creation path.
3. **Update per-project budget defaults** — `PUT /api/v1/projects/:id/budget`
   with `{ maxUsd?: number, maxSteps?: number }`. Stores into
   `<project>/.factory/project.json` `metadata.budgetDefaults` (uses the
   same `metadata` extension point as 10.8's `language` field).
4. **SPA write affordances** — pending-questions detail page gets an
   answer textarea; a new build form lets the operator pick project +
   language + autonomy + budget; the project detail page gets budget
   inputs.
5. **Live validation** — operator at the browser exercises each route
   against the running factoryd; smoke that mutations land in SQLite +
   propagate as expected (e.g. answering a question unblocks the
   waiting worker).

Deliberately out of scope for Phase 11:

- **Multi-user auth.** Single shared `FACTORY5_UI_TOKEN` is fine for
  the operator-on-laptop model. Multi-tenant or per-user identity is a
  separate architectural decision.
- **Inline build log streaming.** Phase 9's polling pattern is good
  enough for now; live streaming (SSE / WebSocket) is its own phase.
- **Project create from scratch in the UI.** `factory init` is still
  the entry point for new projects; the UI assumes the project already
  exists on disk.

## Sub-step schedule (preliminary — refined at 11.1 open)

| Step | Subject                                                                          |
| ---- | -------------------------------------------------------------------------------- |
| 11.1 | ADR 0027 — mutation route shape, idempotency rules, error envelope contract      |
| 11.2 | `POST /api/v1/pending-questions/:id/answer` route + tests                        |
| 11.3 | `POST /api/v1/builds` route — directive-creation parity with `factory build`     |
| 11.4 | `PUT /api/v1/projects/:id/budget` route + project.json `metadata.budgetDefaults` |
| 11.5 | SPA write affordances (question answer form, build form, budget inputs)          |
| 11.6 | Live validation — operator browser smoke against all three mutation routes       |
| 11.7 | Phase close — tag `phase-11-web-ui-9b-closed`, scaffold Phase 12                 |

Single-charter phase. Sub-letter split possible (11a routes / 11b SPA)
if any single layer balloons; default is to stay single-phase.

## Done criteria

- [ ] All sub-steps checked off with commit references
- [ ] `pnpm build` clean; `pnpm test` green (new route tests included)
- [ ] `pnpm lint` + `pnpm format:check` clean
- [ ] Live validation: operator browser successfully answers a pending
      question (worker unblocks), kicks off a build (directive lands +
      runs), and updates a project's budget defaults (next build picks
      them up)
- [ ] [ADR 0027](../../../docs/decisions/) authored covering mutation
      route shape + idempotency + error envelopes
- [ ] `docs/PROGRESS.md` entry; `docs/Phase11_Progress.md` charter created
- [ ] `CompleteArchitecture.md` §21 extended (or new §23) with the
      mutation surface
- [ ] Working tree clean
- [ ] Tag `phase-11-web-ui-9b-closed`

## Rollback plan

`git reset --hard phase-10-assessor-tier3-closed`. The new code is
purely additive (new POST/PUT routes + SPA forms). The read-only API
and existing routes are untouched.

## Forward queue (after Phase 11)

- **Phase 12** — Filesystem-scoping for worker subprocesses (Read /
  Glob / Grep whitelist scoped to the worker's active worktree +
  `.factory/` + template dirs). Surfaced as the Phase 8 "filesystem
  scoping" carry-forward; non-urgent until a verifier hallucinates
  from repo-internal files in a way that affects a build outcome.
- **I014 fix** — architect's wiki edits should commit themselves on
  resume so `gate.verify` doesn't dirty-trip. Could land mid-Phase-11
  or as a standalone fix commit.
- **I009 / I012** — Telegram inbound budget defaults / FIFO matcher.
  Carry-forwards from Phase 8 / 9.

Order is durable — only re-pick if a HALT event reveals a different
priority.
