/**
 * Typed CRUD for the `projects` table — registry of all projects factory has touched.
 */

import { projectSchema, type Project } from '@factory5/core';

import type { Database } from '../db.js';

interface Row {
  name: string;
  workspace_path: string;
  status: string;
  created_at: string;
  last_touched_at: string;
  metadata_json: string | null;
}

function rowToProject(row: Row): Project {
  return projectSchema.parse({
    name: row.name,
    workspacePath: row.workspace_path,
    status: row.status,
    createdAt: row.created_at,
    lastTouchedAt: row.last_touched_at,
    ...(row.metadata_json !== null ? { metadata: JSON.parse(row.metadata_json) } : {}),
  });
}

/** Upsert a project record (keyed by name). */
export function upsert(db: Database, p: Project): void {
  const validated = projectSchema.parse(p);
  db.prepare(
    `INSERT INTO projects (name, workspace_path, status, created_at, last_touched_at, metadata_json)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(name) DO UPDATE SET
       workspace_path  = excluded.workspace_path,
       status          = excluded.status,
       last_touched_at = excluded.last_touched_at,
       metadata_json   = excluded.metadata_json`,
  ).run(
    validated.name,
    validated.workspacePath,
    validated.status,
    validated.createdAt,
    validated.lastTouchedAt,
    validated.metadata !== undefined ? JSON.stringify(validated.metadata) : null,
  );
}

/** Lookup a project by name. */
export function getByName(db: Database, name: string): Project | undefined {
  const row = db.prepare('SELECT * FROM projects WHERE name = ?').get(name) as
    | Row
    | undefined;
  return row !== undefined ? rowToProject(row) : undefined;
}

/** All known projects, most-recently touched first. */
export function listAll(db: Database): Project[] {
  const rows = db
    .prepare('SELECT * FROM projects ORDER BY last_touched_at DESC')
    .all() as Row[];
  return rows.map(rowToProject);
}
