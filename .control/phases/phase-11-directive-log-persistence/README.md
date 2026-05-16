# Phase 11 — directive-log-persistence

**Dependencies:** Phase 10 closed (`phase-10-resume-and-activity-feed-closed` at `fbc3c27`)
**Estimated duration:** ~1 session
**Status:** scaffolded, starting

## Goal

Persist `log.line` SSE events to SQLite so the directive-detail activity panel survives page reloads and multi-tab consistency. Today the events are ephemeral — emitted by the brain, broadcast by the SSE hub, dropped when the subscriber disconnects.

## Outcome

- New `directive_log_lines` table (migration 010); daemon hub tees `log.line` events to DB; new `GET /api/v1/directives/:id/logs` route; FE replays on connect and dedupes against the SSE stream. Activity panel now survives reloads + cross-tab.

Full plan: [`../../../UPGRADE/plans/tier-11-directive-log-persistence.md`](../../../UPGRADE/plans/tier-11-directive-log-persistence.md).

## Where we were, end of Phase 10

Phase 10 (resume + activity feed) shipped the SSE-live brain narrative, but events were ephemeral. The post-close smoke surfaced two operator-felt gaps: refresh forgets everything; multi-tab tabs see different event sets. ADR 0031 explicitly noted "Per-directive log persistence" as the Tier 11+ follow-up.

## Why this phase exists

Three operator-felt failure modes on 2026-05-16, all rooted in the same gap:

1. Refresh forgets everything. Activity panel comes back empty on a running directive.
2. Multi-tab event split. Tabs that subscribe after another tab miss historic events.
3. Post-mortem invisibility. Opening a terminal directive a session later shows nothing.

Issues addressed: U031 (opened in 11.1).

## Steps

See [`steps.md`](steps.md).

## Done criteria

- [ ] All four `pnpm` gates green
- [ ] Migration 010 lands; three pre-existing migration shape tests bump to `[1..10]`
- [ ] State queries + tests
- [ ] Daemon hub tees `log.line` to DB; integration test asserts read-back
- [ ] `GET /api/v1/directives/:id/logs` returns historic; integration tests
- [ ] FE replays on load; dedup against the SSE stream
- [ ] Browser smoke: refresh on a running directive preserves activity panel
- [ ] Browser smoke: open same directive in tab 2, identical panel content
- [ ] Browser smoke: open a terminal directive a session later, full history visible
- [ ] U031 closes

## Rollback

`git reset --hard phase-10-resume-and-activity-feed-closed`. Migration 010 stays in the history; `CREATE TABLE IF NOT EXISTS` makes re-runs safe.

## Deferred to Phase 12 (or later)

- **Auto-prune retention policy** — sweep that drops log lines older than N days (configurable). Defer-until-signal that the table is growing meaningfully.
- **Search / filter in the activity panel** — free-text grep + level + component filters. UX polish, not load-bearing.
- **Persist task / finding / spend events too** — unify replay across all six SSE event types. Today the snapshot route handles those; would unify the code path.
- **CLI tail** — `factory directive tail <id>` consumes the new logs endpoint and prints live. Composition.
