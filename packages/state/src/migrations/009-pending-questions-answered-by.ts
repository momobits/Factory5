import type { Migration } from './index.js';

/**
 * Migration 009 — `pending_questions` gains `answered_by`, structured
 * provenance for who (or what) wrote the answer. Replaces the
 * `[orphaned by ...]` text-prefix convention used by `markOrphanAnswered`
 * with a queryable enum column.
 *
 * Rationale (Tier 8 / U029): when the brain dispatches an LLM auto-answer
 * for an unanswered question past its deadline, the answer needs to be
 * recorded as agent-authored, not user-authored. ADR 0030 pins the
 * four-value enum and the auto-answer contract.
 *
 * Values:
 *   - `'user'`        — the human operator answered (CLI / channel / web)
 *   - `'agent'`       — Tier 8 LLM auto-answer succeeded
 *   - `'agent-failed'` — Tier 8 LLM auto-answer failed both attempts; the
 *                       answer field carries `[auto-answer failed: <reason>]`
 *                       and the directive proceeds from the synthetic
 *   - `'orphan-sweep'` — `factory questions cleanup` retroactively closed
 *                       the row when its parent directive terminated
 *                       unanswered (existing pre-Tier-8 behaviour)
 *
 * Nullable: pre-migration unanswered rows have no answerer yet, so the
 * column stays NULL until they're answered. NULL bypasses the CHECK
 * constraint via SQLite's three-valued logic.
 *
 * Backfill: pre-migration answered rows split into two classes —
 * orphan-sweep-written rows (matched by the `[orphaned by ...]` answer
 * prefix that `markOrphanAnswered` writes) get `'orphan-sweep'`; every
 * other answered row gets `'user'`. This preserves provenance forensics
 * for the existing dataset.
 *
 * No index. The column is read by id, not scanned. If a future tier
 * needs answerer-keyed analytics queries, an index can be added then.
 */
export const migration009: Migration = {
  id: 9,
  name: 'pending-questions-answered-by',
  up: `
    ALTER TABLE pending_questions ADD COLUMN answered_by TEXT
      CHECK (answered_by IN ('user', 'agent', 'agent-failed', 'orphan-sweep'));
    UPDATE pending_questions
       SET answered_by = 'orphan-sweep'
     WHERE answer LIKE '[orphaned by factory questions cleanup at %'
       AND answered_by IS NULL;
    UPDATE pending_questions
       SET answered_by = 'user'
     WHERE answered_at IS NOT NULL
       AND answered_by IS NULL;
  `,
};
