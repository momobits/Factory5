/**
 * Typed CRUD for the `findings_registry` table — the SQLite mirror of
 * every per-project `findings.json`. Phase 6a.
 *
 * The per-project file is the source of truth; the registry is a
 * derived aggregate. The dual-write contract (step 6a.2) calls
 * {@link upsert} after the per-project write succeeds so a registry
 * hiccup cannot lose or corrupt findings. Read helpers ({@link list},
 * {@link getByProjectAndId}) drive `factory findings list|show`
 * (steps 6a.3 / 6a.4) and the 6a.5 backfill's "already imported?"
 * check.
 */

import { findingSchema, type Finding } from '@factory5/core';

import type { Database } from '../db.js';

export interface FindingsRegistryUpsertInput {
  /**
   * Stable project handle — the ULID from `<project>/.factory/project.json`
   * (ADR 0021). Pre-ADR-0021 callers passed `basename(projectPath)`; that
   * legacy mapping was migrated in 006-project-identity. Callers must now
   * resolve the project id via `wiki.loadOrCreateProjectMetadata` (or
   * `wiki.readProjectMetadata` when not creating) before upsert.
   */
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

/**
 * A single row from `findings_registry`, rehydrated into its {@link
 * Finding} shape plus the registry-specific metadata (project handle,
 * snapshot path, directive link, last-updated marker).
 */
export interface RegistryEntry {
  projectId: string;
  projectPath: string;
  finding: Finding;
  originDirectiveId?: string;
  /** ISO timestamp of the most recent upsert. */
  updatedAt: string;
}

interface Row {
  project_id: string;
  project_path: string;
  finding_id: string;
  source: string;
  target: string;
  severity: string;
  status: string;
  description: string;
  resolution: string | null;
  advisory: number;
  origin_directive_id: string | null;
  created_at: string;
  resolved_at: string | null;
  updated_at: string;
}

function rowToEntry(row: Row): RegistryEntry {
  const finding = findingSchema.parse({
    id: row.finding_id,
    source: row.source,
    target: row.target,
    severity: row.severity,
    status: row.status,
    description: row.description,
    createdAt: row.created_at,
    ...(row.resolution !== null ? { resolution: row.resolution } : {}),
    ...(row.resolved_at !== null ? { resolvedAt: row.resolved_at } : {}),
    ...(row.advisory === 1 ? { advisory: true } : {}),
  });
  return {
    projectId: row.project_id,
    projectPath: row.project_path,
    finding,
    ...(row.origin_directive_id !== null ? { originDirectiveId: row.origin_directive_id } : {}),
    updatedAt: row.updated_at,
  };
}

export interface ListFilter {
  severity?: Finding['severity'];
  status?: Finding['status'];
  /**
   * Project filter. Bare string → exact match on `project_id`. If the
   * string contains `*` or `?`, glob wildcards translate to SQL LIKE
   * patterns (`*` → `%`, `?` → `_`) with backslash-escaping of any
   * literal `%` or `_` in the source.
   */
  project?: string;
  /** `true` → advisory-only, `false` → blocking-only, `undefined` → both. */
  advisory?: boolean;
  /** Caps the result set. Defaults to 100; clamped to [1, 1000]. */
  limit?: number;
}

function compileProjectFilter(filter: string): { sql: string; param: string } {
  if (!/[*?]/.test(filter)) {
    return { sql: 'project_id = ?', param: filter };
  }
  const escaped = filter.replace(/([%_])/g, '\\$1');
  const pattern = escaped.replace(/\*/g, '%').replace(/\?/g, '_');
  return { sql: "project_id LIKE ? ESCAPE '\\'", param: pattern };
}

/**
 * List registry entries matching the supplied filter. Results ordered
 * by `updated_at DESC` so the most recently touched findings surface
 * first. Advisory filter (ADR 0018) — `advisory: false` is the default
 * in {@link listBlocking}-style callers; this helper stays agnostic.
 */
export function list(db: Database, filter: ListFilter = {}): RegistryEntry[] {
  const parts: string[] = [];
  const params: (string | number)[] = [];
  if (filter.severity !== undefined) {
    parts.push('severity = ?');
    params.push(filter.severity);
  }
  if (filter.status !== undefined) {
    parts.push('status = ?');
    params.push(filter.status);
  }
  if (filter.project !== undefined && filter.project.length > 0) {
    const f = compileProjectFilter(filter.project);
    parts.push(f.sql);
    params.push(f.param);
  }
  if (filter.advisory === true) parts.push('advisory = 1');
  else if (filter.advisory === false) parts.push('advisory = 0');

  const where = parts.length > 0 ? `WHERE ${parts.join(' AND ')}` : '';
  const limit = Math.min(1000, Math.max(1, Math.floor(filter.limit ?? 100)));
  const rows = db
    .prepare(`SELECT * FROM findings_registry ${where} ORDER BY updated_at DESC LIMIT ?`)
    .all(...params, limit) as Row[];
  return rows.map(rowToEntry);
}

/** Fetch a specific registry row by composite key. */
export function getByProjectAndId(
  db: Database,
  projectId: string,
  findingId: string,
): RegistryEntry | undefined {
  const row = db
    .prepare('SELECT * FROM findings_registry WHERE project_id = ? AND finding_id = ?')
    .get(projectId, findingId) as Row | undefined;
  return row !== undefined ? rowToEntry(row) : undefined;
}

/**
 * Search by finding_id alone (across all projects). Used by
 * `factory findings show <id>` when the operator omits the project
 * prefix — if exactly one row matches, we resolve unambiguously;
 * otherwise the CLI asks the operator to disambiguate.
 */
export function findByFindingId(db: Database, findingId: string): RegistryEntry[] {
  const rows = db
    .prepare('SELECT * FROM findings_registry WHERE finding_id = ? ORDER BY updated_at DESC')
    .all(findingId) as Row[];
  return rows.map(rowToEntry);
}
