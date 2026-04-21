/**
 * Typed CRUD for the `projects` table — registry of all projects factory
 * has touched.
 *
 * Per ADR 0021, the canonical key is `id` (a ULID written by
 * `wiki.loadOrCreateProjectMetadata` to `<project>/.factory/project.json`),
 * not `name`. `name` is a non-unique human label; two projects with the same
 * basename in different workspaces are distinct rows. Lookup-by-name is
 * therefore an array-returning convenience helper, not a primary access
 * pattern.
 */

import { projectSchema, type Project } from '@factory5/core';

import type { Database } from '../db.js';

interface Row {
  id: string;
  name: string;
  workspace_path: string;
  last_workspace_path: string | null;
  status: string;
  created_at: string;
  last_touched_at: string;
  metadata_json: string | null;
}

function rowToProject(row: Row): Project {
  return projectSchema.parse({
    id: row.id,
    name: row.name,
    workspacePath: row.workspace_path,
    ...(row.last_workspace_path !== null ? { lastWorkspacePath: row.last_workspace_path } : {}),
    status: row.status,
    createdAt: row.created_at,
    lastTouchedAt: row.last_touched_at,
    ...(row.metadata_json !== null ? { metadata: JSON.parse(row.metadata_json) } : {}),
  });
}

/**
 * Upsert a project row keyed on `id`. The id is supplied by the caller —
 * typically obtained via `wiki.loadOrCreateProjectMetadata` so the value
 * matches the per-project `.factory/project.json` file.
 */
export function upsert(db: Database, p: Project): void {
  const validated = projectSchema.parse(p);
  db.prepare(
    `INSERT INTO projects
       (id, name, workspace_path, last_workspace_path, status,
        created_at, last_touched_at, metadata_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name                = excluded.name,
       workspace_path      = excluded.workspace_path,
       last_workspace_path = excluded.last_workspace_path,
       status              = excluded.status,
       last_touched_at     = excluded.last_touched_at,
       metadata_json       = excluded.metadata_json`,
  ).run(
    validated.id,
    validated.name,
    validated.workspacePath,
    validated.lastWorkspacePath ?? null,
    validated.status,
    validated.createdAt,
    validated.lastTouchedAt,
    validated.metadata !== undefined ? JSON.stringify(validated.metadata) : null,
  );
}

/** Lookup a project by its canonical id. */
export function getById(db: Database, id: string): Project | undefined {
  const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as Row | undefined;
  return row !== undefined ? rowToProject(row) : undefined;
}

/**
 * Lookup projects by display name. Returns an array because `name` is
 * non-unique post-ADR-0021 — two projects in different workspaces may share
 * a basename. Empty array on no match.
 */
export function findByName(db: Database, name: string): Project[] {
  const rows = db
    .prepare('SELECT * FROM projects WHERE name = ? ORDER BY last_touched_at DESC')
    .all(name) as Row[];
  return rows.map(rowToProject);
}

/** All known projects, most-recently touched first. */
export function listAll(db: Database): Project[] {
  const rows = db.prepare('SELECT * FROM projects ORDER BY last_touched_at DESC').all() as Row[];
  return rows.map(rowToProject);
}
