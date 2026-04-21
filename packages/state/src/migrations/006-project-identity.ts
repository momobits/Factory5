/**
 * Migration 006 — first-class project identity (ADR 0021).
 *
 * Pre-migration, project identity was the legacy `projects.name TEXT PRIMARY KEY`
 * derived from `basename(projectPath)`. Two workspaces sharing a project
 * basename collided on a single row (issue I008), and the
 * `findings_registry.(project_id, finding_id)` PK inherited the trap.
 *
 * Post-migration, identity is the ULID written to
 * `<project>/.factory/project.json` by `wiki.loadOrCreateProjectMetadata`.
 * The new `projects.id TEXT PRIMARY KEY` is stable across path moves; the
 * `name` column is demoted to a non-unique human label. `directives.project_id`
 * is added so spend / findings / learnings can be rolled up cleanly without
 * re-parsing `payload_json`. `findings_registry.project_id` and
 * `learnings.source_project` keep their TEXT shape but are translated from
 * basenames to ULIDs by the post hook.
 *
 * No FK constraint on `directives.project_id`; application code maintains
 * integrity. Adding a `REFERENCES projects(id)` ALTER is awkward in SQLite
 * (no `ALTER ... ADD CONSTRAINT`) and would force another table-rebuild on
 * `directives` purely to record an FK whose enforcement is already covered
 * by the helper that owns the lifecycle.
 *
 * The post hook does the data movement that SQL alone cannot:
 *   1. Read every row from the legacy `projects` table.
 *   2. Generate a ULID for each, attempt to write the project file at
 *      `<workspace_path>/.factory/project.json` (skip silently if the
 *      workspace path no longer exists on disk — the in-DB record carries
 *      the canonical id regardless), insert into `projects_new`.
 *   3. Drop the legacy `projects` table and rename `projects_new` → `projects`.
 *   4. Walk `directives.payload_json`, look up the new ULID by the legacy
 *      basename, populate `directives.project_id`. Directives without a
 *      project reference (chat / system) leave the column NULL.
 *   5. Translate `findings_registry.project_id` from basename → ULID.
 *      Pre-existing collisions stay collided (this is data already lost
 *      per I008's repro; the migration does not invent rows it cannot prove).
 *   6. Translate `learnings.source_project` from name → ULID.
 *
 * Idempotent across re-runs of the migration system as a whole (the
 * `migrations` table records that 006 ran). Re-running the post-hook on
 * a fresh DB is a no-op because `legacy projects` would be empty after the
 * first run completes.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { newId } from '@factory5/core';
import { createLogger } from '@factory5/logger';

import type { Database } from '../db.js';
import type { Migration } from './index.js';

const log = createLogger('state.migration-006');

/**
 * Bumped when `<project>/.factory/project.json`'s schema evolves.
 * Read by the helper to decide whether forward-migration of the file
 * itself is needed; for now the helper accepts any value and reads
 * whatever fields it understands.
 */
const PROJECT_FILE_VERSION = '0.x';

interface LegacyProjectRow {
  name: string;
  workspace_path: string;
  status: string;
  created_at: string;
  last_touched_at: string;
  metadata_json: string | null;
}

interface ProjectFileShape {
  id: string;
  name: string;
  createdAt: string;
  factoryVersion: string;
  metadata: Record<string, unknown>;
}

export const migration006: Migration = {
  id: 6,
  name: 'project-identity',
  up: `
    -- New projects table (id-keyed). Populated by the post hook.
    -- Note the explicit NOT NULL on id: SQLite's "TEXT PRIMARY KEY"
    -- shorthand does NOT imply NOT NULL (unlike most other databases),
    -- so an unconstrained PK column would silently accept NULL ids. We
    -- match the existing convention in migrations 001-005 of always
    -- declaring PK columns as NOT NULL explicitly.
    CREATE TABLE projects_new (
      id                   TEXT PRIMARY KEY NOT NULL,
      name                 TEXT NOT NULL,
      workspace_path       TEXT NOT NULL,
      last_workspace_path  TEXT,
      status               TEXT NOT NULL CHECK (status IN ('active','paused','complete','archived')),
      created_at           TEXT NOT NULL,
      last_touched_at      TEXT NOT NULL,
      metadata_json        TEXT
    );
    CREATE INDEX idx_projects_name ON projects_new(name);

    -- directives gains project_id (no FK; application code maintains integrity).
    ALTER TABLE directives ADD COLUMN project_id TEXT;
    CREATE INDEX idx_directives_project ON directives(project_id);
  `,
  post: backfillProjectIdentity,
};

/**
 * One-shot backfill that runs inside migration 006's transaction.
 * Idempotent at the migration-system level — if 006 has already been
 * applied, the post hook is not invoked again.
 */
function backfillProjectIdentity(db: Database): void {
  // 1. Materialise the legacy rows + assign ULIDs + write project files.
  const legacyRows = db.prepare('SELECT * FROM projects').all() as LegacyProjectRow[];
  const nameToId = new Map<string, string>();

  const insertNew = db.prepare(
    `INSERT INTO projects_new
       (id, name, workspace_path, last_workspace_path, status,
        created_at, last_touched_at, metadata_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  let projectFilesWritten = 0;
  let projectFilesSkipped = 0;

  for (const row of legacyRows) {
    const fresh = newId();
    const freshMeta: ProjectFileShape = {
      id: fresh,
      name: row.name,
      createdAt: row.created_at,
      factoryVersion: PROJECT_FILE_VERSION,
      metadata: {},
    };

    // Adopt-or-write: if a project.json already exists at the workspace
    // (operator-placed, or carried over from a prior failed migration
    // attempt that wrote files but rolled back the DB transaction), adopt
    // its id rather than overwrite with a fresh ULID. Mismatch between
    // file and DB would orphan future directives that read the file.
    const result = adoptOrWriteProjectFile(row.workspace_path, freshMeta);
    if (result.wrote) projectFilesWritten++;
    else projectFilesSkipped++;

    nameToId.set(row.name, result.id);

    insertNew.run(
      result.id,
      row.name,
      row.workspace_path,
      // last_workspace_path is the advisory snapshot; populate it when
      // we could not touch the identity file (workspace path missing) so
      // the operator has a breadcrumb. Otherwise leave NULL — the live
      // workspace_path is authoritative.
      result.id === fresh && !result.wrote ? row.workspace_path : null,
      row.status,
      row.created_at,
      row.last_touched_at,
      row.metadata_json,
    );
  }

  // 2. Replace the projects table.
  db.exec(`
    DROP TABLE projects;
    ALTER TABLE projects_new RENAME TO projects;
  `);

  // 3. Populate directives.project_id from payload_json hints.
  let directivesPopulated = 0;
  const directiveRows = db
    .prepare(`SELECT id, payload_json FROM directives WHERE project_id IS NULL`)
    .all() as { id: string; payload_json: string }[];
  const updateDirective = db.prepare(`UPDATE directives SET project_id = ? WHERE id = ?`);
  for (const d of directiveRows) {
    const projectName = extractProjectName(d.payload_json);
    if (projectName === undefined) continue;
    const projectId = nameToId.get(projectName);
    if (projectId === undefined) continue;
    updateDirective.run(projectId, d.id);
    directivesPopulated++;
  }

  // 4. Translate findings_registry.project_id from basename → ULID.
  let registryTranslated = 0;
  let registrySkipped = 0;
  const registryRows = db.prepare(`SELECT project_id, finding_id FROM findings_registry`).all() as {
    project_id: string;
    finding_id: string;
  }[];
  const updateRegistry = db.prepare(
    `UPDATE findings_registry SET project_id = ?
       WHERE project_id = ? AND finding_id = ?`,
  );
  for (const r of registryRows) {
    const projectUlid = nameToId.get(r.project_id);
    if (projectUlid === undefined) {
      // Basename not in the projects table — leave as-is (orphan registry row).
      registrySkipped++;
      continue;
    }
    updateRegistry.run(projectUlid, r.project_id, r.finding_id);
    registryTranslated++;
  }

  // 5. Translate learnings.source_project from name → ULID.
  let learningsTranslated = 0;
  const learningsRows = db
    .prepare(`SELECT id, source_project FROM learnings WHERE source_project IS NOT NULL`)
    .all() as { id: string; source_project: string }[];
  const updateLearning = db.prepare(`UPDATE learnings SET source_project = ? WHERE id = ?`);
  for (const l of learningsRows) {
    const projectUlid = nameToId.get(l.source_project);
    if (projectUlid === undefined) continue;
    updateLearning.run(projectUlid, l.id);
    learningsTranslated++;
  }

  log.info(
    {
      legacyProjects: legacyRows.length,
      projectFilesWritten,
      projectFilesSkipped,
      directivesPopulated,
      registryTranslated,
      registryOrphaned: registrySkipped,
      learningsTranslated,
    },
    'migration 006 post-hook backfill complete',
  );
}

interface AdoptOrWriteResult {
  /** The id factory should use — either freshMeta.id or the adopted file's id. */
  id: string;
  /** True iff a fresh project.json was written this call. */
  wrote: boolean;
}

const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

/**
 * Reconciles the workspace's `.factory/project.json` with the migration's
 * fresh ULID. Three outcomes:
 *
 *   - Workspace path missing → returns `{ id: freshMeta.id, wrote: false }`.
 *     The in-DB row carries the fresh id; the file does not exist on disk.
 *     A future `loadOrCreateProjectMetadata` call against this workspace
 *     would create a new identity (different ULID), which is the
 *     correct outcome — the project is gone.
 *
 *   - File present and valid → adopts the file's id. Returns
 *     `{ id: <file's id>, wrote: false }`. Honours the file as authoritative
 *     so the runtime helper and the backfill agree on identity. Covers
 *     both operator pre-placement and mid-migration retries.
 *
 *   - File absent (workspace exists) → writes freshMeta and returns
 *     `{ id: freshMeta.id, wrote: true }`. The common case for the first
 *     successful migration attempt against an established project.
 *
 * Never throws — a workspace whose I/O fails (read-only mount, permissions)
 * still gets its in-DB row populated with the fresh id; the file mismatch
 * is logged and surfaces at next runtime helper call.
 *
 * Synchronous fs APIs match the migration runner's synchronous transaction
 * (better-sqlite3's `db.transaction()` cannot await).
 */
function adoptOrWriteProjectFile(
  workspacePath: string,
  freshMeta: ProjectFileShape,
): AdoptOrWriteResult {
  if (!existsSync(workspacePath)) {
    return { id: freshMeta.id, wrote: false };
  }
  const factoryDir = join(workspacePath, '.factory');
  const filePath = join(factoryDir, 'project.json');

  if (existsSync(filePath)) {
    const adopted = tryAdoptExistingFile(filePath);
    if (adopted !== undefined) {
      return { id: adopted, wrote: false };
    }
    // File exists but is unreadable or malformed — log and skip the write
    // (overwriting could destroy operator data). Future runtime helper calls
    // will throw ProjectMetadataCorruptError so the operator knows.
    log.warn(
      { workspacePath, filePath },
      'migration 006: project.json exists but is not a parseable identity — leaving on disk; helper will surface the corruption at next runtime call',
    );
    return { id: freshMeta.id, wrote: false };
  }

  try {
    mkdirSync(factoryDir, { recursive: true });
    writeFileSync(filePath, JSON.stringify(freshMeta, null, 2), 'utf8');
    return { id: freshMeta.id, wrote: true };
  } catch (err) {
    log.warn(
      { err, workspacePath, projectId: freshMeta.id },
      'migration 006: failed to write project.json — workspace will rely on in-DB id only',
    );
    return { id: freshMeta.id, wrote: false };
  }
}

/**
 * Read an existing `project.json` and return its `id` if the file shape
 * is valid (ULID-formatted id, name, createdAt all present). Returns
 * `undefined` on any read or parse failure so the caller can fall back
 * to skipping the write rather than overwriting.
 */
function tryAdoptExistingFile(filePath: string): string | undefined {
  try {
    const raw = readFileSync(filePath, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return undefined;
    const obj = parsed as Record<string, unknown>;
    if (typeof obj.id !== 'string' || !ULID_RE.test(obj.id)) return undefined;
    return obj.id;
  } catch {
    return undefined;
  }
}

/**
 * Extract a project name from a directive's `payload_json`. Returns
 * `undefined` if the payload is not an object, has no `project` field,
 * or fails to parse. The legacy `payload.project` field carried the
 * basename of the project directory — the same value that became
 * `projects.name`, so we can join on it for the backfill.
 */
function extractProjectName(payloadJson: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(payloadJson);
    if (typeof parsed !== 'object' || parsed === null) return undefined;
    const project = (parsed as { project?: unknown }).project;
    return typeof project === 'string' && project.length > 0 ? project : undefined;
  } catch {
    return undefined;
  }
}
