/**
 * Typed upsert for the `findings_registry` table — the SQLite mirror
 * of every per-project `findings.json`. Phase 6a.
 *
 * The per-project file is the source of truth; the registry is a
 * derived aggregate. The dual-write contract (step 6a.2) calls
 * {@link upsert} after the per-project write succeeds so a registry
 * hiccup cannot lose or corrupt findings.
 *
 * Read helpers (`listBy`, `getById`) land in 6a.3 when the CLI needs
 * them. This file ships only what 6a.2 requires.
 */

import type { Finding } from '@factory5/core';

import type { Database } from '../db.js';

export interface FindingsRegistryUpsertInput {
  /** Stable project handle — typically `basename(projectPath)`. */
  projectId: string;
  /** Absolute workspace path, snapshotted for cross-workspace display. */
  projectPath: string;
  /** The Finding exactly as stored in `<project>/.factory/findings.json`. */
  finding: Finding;
  /** Directive that raised this finding; written as `origin_directive_id`. */
  originDirectiveId?: string;
  /** ISO timestamp to record as `updated_at`. Defaults to `new Date().toISOString()`. */
  updatedAt?: string;
}

/**
 * Insert-or-update a registry row using the composite PK
 * `(project_id, finding_id)` as the conflict target.
 *
 * Semantics:
 *  - `created_at` is set on first insert and preserved across re-raises.
 *    It records the first time the registry observed the finding, not
 *    the latest refresh.
 *  - Every other mutable column (severity, status, description,
 *    resolution, advisory, resolved_at, origin_directive_id) is copied
 *    from the input on every call.
 *  - `updated_at` is bumped on every call.
 *  - `advisory` is persisted as `0` or `1` (per ADR 0018's boolean on
 *    the `Finding` schema).
 */
export function upsert(db: Database, input: FindingsRegistryUpsertInput): void {
  const f = input.finding;
  const updatedAt = input.updatedAt ?? new Date().toISOString();
  db.prepare(
    `INSERT INTO findings_registry (
       project_id, project_path, finding_id, source, target, severity,
       status, description, resolution, advisory, origin_directive_id,
       created_at, resolved_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(project_id, finding_id) DO UPDATE SET
       project_path        = excluded.project_path,
       source              = excluded.source,
       target              = excluded.target,
       severity            = excluded.severity,
       status              = excluded.status,
       description         = excluded.description,
       resolution          = excluded.resolution,
       advisory            = excluded.advisory,
       origin_directive_id = excluded.origin_directive_id,
       resolved_at         = excluded.resolved_at,
       updated_at          = excluded.updated_at`,
  ).run(
    input.projectId,
    input.projectPath,
    f.id,
    f.source,
    f.target,
    f.severity,
    f.status,
    f.description,
    f.resolution ?? null,
    f.advisory === true ? 1 : 0,
    input.originDirectiveId ?? null,
    f.createdAt,
    f.resolvedAt ?? null,
    updatedAt,
  );
}
