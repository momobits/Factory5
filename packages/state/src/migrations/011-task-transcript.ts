import type { Migration } from './index.js';

/**
 * Migration 011 — transcript columns on `tasks_inflight`. Adds three columns
 * to record where a task's conversation transcript file lives on disk and its
 * current size, so the brain can stream live progress and persist a stable
 * post-mortem reference after the worker exits.
 *
 * Columns:
 *   - `transcript_path`  — absolute path to the JSONL transcript file written
 *                          by the worker. NULL until the worker creates the
 *                          file and reports back.
 *   - `transcript_bytes` — file size in bytes at last heartbeat. Used by the
 *                          cockpit to show a live progress indicator and to
 *                          detect stalls. NULL until path is set.
 *   - `transcript_lines` — number of JSONL lines (conversation turns) written
 *                          so far. NULL until path is set.
 *
 * All three are nullable — existing rows and newly-registered tasks default to
 * NULL until the worker calls `updateTranscriptMeta`. No backfill is required.
 */
export const migration011: Migration = {
  id: 11,
  name: 'task-transcript',
  up: `
    ALTER TABLE tasks_inflight ADD COLUMN transcript_path  TEXT;
    ALTER TABLE tasks_inflight ADD COLUMN transcript_bytes INTEGER;
    ALTER TABLE tasks_inflight ADD COLUMN transcript_lines INTEGER;
  `,
};
