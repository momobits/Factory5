import type { Migration } from './index.js';

/**
 * Record a free-text reason when a directive is marked `blocked`.
 *
 * Consumers:
 *  - `directives.markBlocked(db, id, reason)` — CLI + brain paths set this
 *    to explain why a directive is no longer running (escalation-kill,
 *    orphaned reconcile at daemon start, operator override, etc.).
 *  - `directives.getById` / `listByStatus` surface it to `factory status`
 *    and the future `factory directives inspect` command.
 *
 * Nullable because most `blocked` directives today got there via the
 * assisted-mode abort path, which pre-dates this column. Reading that
 * column for a pre-migration row yields NULL — callers must tolerate it.
 */
export const migration002: Migration = {
  id: 2,
  name: 'directive-blocked-reason',
  up: `
    ALTER TABLE directives ADD COLUMN blocked_reason TEXT;
  `,
};
