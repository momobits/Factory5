import type { Migration } from './index.js';

/**
 * Cross-project findings registry — the SQLite mirror of every
 * `<project>/.factory/findings.json` file factory has produced.
 *
 * The per-project file remains the source of truth; this table is a
 * derived aggregate that `factory findings list|show` queries against
 * without walking the filesystem. See ADR 0018 for the `advisory` flag
 * that this table propagates.
 *
 * Dedup strategy: a project re-raised with the same F-ID is an update,
 * not an insert. `PRIMARY KEY (project_id, finding_id)` enforces that,
 * and 6a.2's dual-write uses `INSERT ... ON CONFLICT DO UPDATE` to bump
 * `updated_at` and re-copy mutable fields. `(F001 in project A)` and
 * `(F001 in project B)` are distinct rows — F-IDs are project-scoped,
 * per `findingId()` in `@factory5/core`.
 *
 * `project_id` is the stable project handle that corresponds to
 * `projects.name` when the project is registered; no FK is enforced
 * because the 6a.5 backfill walks a workspace glob and will encounter
 * projects never formally registered. `project_path` snapshots the
 * absolute workspace path at insert time so cross-workspace display
 * works even after the project moves.
 *
 * `origin_directive_id` links a finding to the directive that raised
 * it; ON DELETE SET NULL so pruning old directives doesn't destroy the
 * finding trail. Nullable because legacy `findings.json` entries
 * (pre-Phase-6a) predate the column — the backfill inserts them as
 * NULL.
 *
 * CHECK constraints intentionally cover `severity` + `status` only;
 * those enums are frozen (SEVERITIES, FINDING_STATUSES in
 * `@factory5/core/constants.ts`). `source` is deliberately
 * unconstrained so a new agent role doesn't require a schema
 * migration; Zod validation at the wiki boundary catches typos before
 * they reach the DB.
 */
export const migration003: Migration = {
  id: 3,
  name: 'findings-registry',
  up: `
    CREATE TABLE findings_registry (
      project_id           TEXT NOT NULL,
      project_path         TEXT NOT NULL,
      finding_id           TEXT NOT NULL,
      source               TEXT NOT NULL,
      target               TEXT NOT NULL,
      severity             TEXT NOT NULL CHECK (severity IN ('LOW','MEDIUM','HIGH','CRITICAL')),
      status               TEXT NOT NULL CHECK (status IN ('OPEN','FIXED','VERIFIED','WONTFIX')),
      description          TEXT NOT NULL,
      resolution           TEXT,
      advisory             INTEGER NOT NULL DEFAULT 0 CHECK (advisory IN (0,1)),
      origin_directive_id  TEXT REFERENCES directives(id) ON DELETE SET NULL,
      created_at           TEXT NOT NULL,
      resolved_at          TEXT,
      updated_at           TEXT NOT NULL,
      PRIMARY KEY (project_id, finding_id)
    );
    CREATE INDEX idx_findings_registry_severity_status
      ON findings_registry(severity, status);
  `,
};
