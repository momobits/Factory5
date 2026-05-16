import type { Migration } from './index.js';

/**
 * Migration 010 — `directive_log_lines` table. Persists `log.line` SSE
 * events the brain emits during a directive's lifetime so the
 * directive-detail activity panel survives page reloads, stays
 * consistent across tabs, and renders a usable post-mortem view on
 * terminal directives whose run happened in a prior session.
 *
 * Rationale (Tier 11 / U031): Phase 3 (ADR 0029) shipped the SSE
 * stream protocol; Phase 10 (ADR 0031) shipped the brain-side emit
 * convention. Both treated `log.line` events as ephemeral — fanned out
 * to subscribers, dropped on disconnect. Operator-felt failure modes
 * surfaced 2026-05-16 by Tier 10's post-close smoke: refresh forgets
 * everything; multi-tab event split; post-mortem invisibility.
 *
 * Columns:
 *   - `id`            — surrogate primary key. Used for stable ordering
 *                       when two events share a millisecond timestamp.
 *   - `directive_id`  — owning directive; ON DELETE CASCADE so deleting
 *                       a directive drops its log too (no orphan rows).
 *   - `ts`            — ISO 8601 with offset (`event.ts` from the
 *                       `logLineEventSchema` shape; brain stamps via
 *                       `new Date().toISOString()` in `emitLogLine`).
 *   - `level`         — `trace` | `debug` | `info` | `warn` | `error` |
 *                       `fatal`. Stored as TEXT (matches the SSE schema's
 *                       z.enum at the application layer).
 *   - `component`     — dotted hierarchy, e.g. `'brain.architect'`,
 *                       `'brain.planner'`, `'brain.pool'`. Convention
 *                       pinned by ADR 0031 §2.
 *   - `msg`           — single-line human-readable summary.
 *   - `attrs_json`    — optional JSON-serialised attrs payload (per
 *                       ADR 0031 §3, error events carry `detail` here
 *                       with the first 500 chars of the offending LLM
 *                       output). Stored as TEXT NULL.
 *
 * Index on `(directive_id, ts)` — the dominant query pattern is "give
 * me this directive's log lines ordered by time, optionally filtered
 * since a cursor." The hub-tee write path is single-row INSERT, so the
 * index cost on write is acceptable.
 *
 * No backfill. Pre-Tier-11 directives have empty histories, which
 * matches their previous behaviour anyway — the activity panel was
 * always blank on reload for those.
 */
export const migration010: Migration = {
  id: 10,
  name: 'directive-log-lines',
  up: `
    CREATE TABLE IF NOT EXISTS directive_log_lines (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      directive_id TEXT NOT NULL,
      ts           TEXT NOT NULL,
      level        TEXT NOT NULL,
      component    TEXT NOT NULL,
      msg          TEXT NOT NULL,
      attrs_json   TEXT,
      FOREIGN KEY (directive_id) REFERENCES directives(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_directive_log_lines_directive_ts
      ON directive_log_lines (directive_id, ts);
  `,
};
