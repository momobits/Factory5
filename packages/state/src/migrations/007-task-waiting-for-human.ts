import type { Migration } from './index.js';

/**
 * Migration 007 — `tasks_inflight` gains the `waiting_for_human` and
 * `aborted` lifecycle states plus the `waiting_question_id` /
 * `aborted_reason` columns that ADR 0024 sub-step 8.5 needs for
 * worker-subprocess `ask_user` plumbing.
 *
 * Rationale (ADR 0024 §4):
 *
 *  - `waiting_for_human` distinguishes a per-task pause (the worker is
 *    inside an MCP `ask_user` tool call, waiting on the operator) from
 *    `blocked` (which is a directive-wide halt). Brain startup uses this
 *    state to detect orphans whose worker subprocess died with the brain.
 *
 *  - `aborted` is "the task didn't finish, but it wasn't the task's
 *    fault" — set by the orphan-cleanup pass at brain startup, and
 *    available for any future external-halt path. Distinct from `failed`
 *    so the operator can tell "task produced bad output" from "we killed
 *    it for unrelated reasons."
 *
 *  - `waiting_question_id` cross-references the `pending_questions` row the
 *    task is waiting on. Nullable; only populated while `status =
 *    'waiting_for_human'`. Cleared when the task transitions back to
 *    `running` (answer received) or to `aborted` (orphan cleanup).
 *
 *  - `aborted_reason` is a short machine-friendly tag (e.g.
 *    `'brain_restart_during_human_wait'`) explaining the abort. Mirrors
 *    `directives.blocked_reason` (migration 002) in spirit.
 *
 * SQLite can't ALTER an existing CHECK constraint, so this migration
 * follows the standard table-rebuild recipe: create a new table with the
 * widened CHECK + extra columns, copy data, drop the old, rename, recreate
 * indexes. Same pattern migration 006 used for `projects`.
 */
export const migration007: Migration = {
  id: 7,
  name: 'task-waiting-for-human',
  up: `
    -- 1. Build the new table with the widened CHECK + new columns.
    CREATE TABLE tasks_inflight_new (
      id                   TEXT PRIMARY KEY,
      directive_id         TEXT NOT NULL REFERENCES directives(id) ON DELETE CASCADE,
      plan_id              TEXT NOT NULL,
      title                TEXT NOT NULL,
      agent                TEXT NOT NULL,
      category             TEXT NOT NULL,
      worktree_path        TEXT,
      pid                  INTEGER,
      status               TEXT NOT NULL CHECK (status IN (
                             'pending','running','complete','failed','blocked',
                             'waiting_for_human','aborted'
                           )),
      attempts             INTEGER NOT NULL DEFAULT 0,
      started_at           TEXT,
      last_heartbeat       TEXT,
      finished_at          TEXT,
      result_json          TEXT,
      waiting_question_id  TEXT,
      aborted_reason       TEXT
    );

    -- 2. Copy every existing row through; the new columns default to NULL.
    INSERT INTO tasks_inflight_new
      (id, directive_id, plan_id, title, agent, category, worktree_path, pid,
       status, attempts, started_at, last_heartbeat, finished_at, result_json)
    SELECT
      id, directive_id, plan_id, title, agent, category, worktree_path, pid,
      status, attempts, started_at, last_heartbeat, finished_at, result_json
    FROM tasks_inflight;

    -- 3. Replace.
    DROP TABLE tasks_inflight;
    ALTER TABLE tasks_inflight_new RENAME TO tasks_inflight;

    -- 4. Recreate the indexes (DROP TABLE took them with it).
    CREATE INDEX idx_tasks_status ON tasks_inflight(status, started_at);
    CREATE INDEX idx_tasks_directive ON tasks_inflight(directive_id);
    -- New helper index for the brain-startup orphan scan: the predicate
    -- 'WHERE status = waiting_for_human' is small and selective when most
    -- tasks are running, so a partial index keeps it cheap to maintain.
    CREATE INDEX idx_tasks_waiting_for_human
      ON tasks_inflight(id) WHERE status = 'waiting_for_human';
  `,
};
