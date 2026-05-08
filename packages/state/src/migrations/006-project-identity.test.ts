import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import BetterSqlite3 from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runMigrations } from './index.js';

interface ColumnInfo {
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
}

interface IndexInfo {
  name: string;
  unique: number;
}

function freshDb(): BetterSqlite3.Database {
  const db = new BetterSqlite3(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

/**
 * Spin up a DB at schema version 5 (legacy projects table, no project_id
 * on directives) so backfill tests can stage data shaped as it would have
 * existed before ADR 0021.
 */
function dbAtSchemaVersion5(): BetterSqlite3.Database {
  const db = new BetterSqlite3(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db, { maxId: 5 });
  return db;
}

const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

describe('migration 006-project-identity — schema shape', () => {
  it('rebuilds projects table id-keyed with name demoted', () => {
    const db = freshDb();
    const cols = db.prepare('PRAGMA table_info(projects)').all() as ColumnInfo[];
    const byName = new Map(cols.map((c) => [c.name, c]));
    const expected: Record<string, { type: string; notnull: boolean; pk: boolean }> = {
      id: { type: 'TEXT', notnull: true, pk: true },
      name: { type: 'TEXT', notnull: true, pk: false },
      workspace_path: { type: 'TEXT', notnull: true, pk: false },
      last_workspace_path: { type: 'TEXT', notnull: false, pk: false },
      status: { type: 'TEXT', notnull: true, pk: false },
      created_at: { type: 'TEXT', notnull: true, pk: false },
      last_touched_at: { type: 'TEXT', notnull: true, pk: false },
      metadata_json: { type: 'TEXT', notnull: false, pk: false },
    };
    for (const [name, spec] of Object.entries(expected)) {
      const col = byName.get(name);
      expect(col, `column ${name} missing`).toBeDefined();
      expect(col?.type).toBe(spec.type);
      expect(Boolean(col?.notnull)).toBe(spec.notnull);
      expect(Boolean(col?.pk)).toBe(spec.pk);
    }
    expect(cols).toHaveLength(Object.keys(expected).length);
  });

  it('PRIMARY KEY on projects is now (id) only', () => {
    const db = freshDb();
    const cols = db.prepare('PRAGMA table_info(projects)').all() as ColumnInfo[];
    const pkCols = cols.filter((c) => c.pk > 0).sort((a, b) => a.pk - b.pk);
    expect(pkCols.map((c) => c.name)).toEqual(['id']);
  });

  it('exposes idx_projects_name non-unique secondary index over name', () => {
    const db = freshDb();
    const indexes = db.prepare('PRAGMA index_list(projects)').all() as IndexInfo[];
    const idx = indexes.find((i) => i.name === 'idx_projects_name');
    expect(idx, 'idx_projects_name missing').toBeDefined();
    expect(idx?.unique).toBe(0);
  });

  it('two projects with the same name are storable when ids differ', () => {
    const db = freshDb();
    const now = '2026-04-21T10:00:00.000Z';
    const insertProject = (id: string): void => {
      db.prepare(
        `INSERT INTO projects
           (id, name, workspace_path, status, created_at, last_touched_at)
         VALUES (?, 'example', '/tmp/x', 'active', ?, ?)`,
      ).run(id, now, now);
    };
    insertProject('01KP00000000000000000000A1');
    insertProject('01KP00000000000000000000A2');
    const rows = db.prepare(`SELECT id FROM projects WHERE name = 'example'`).all() as {
      id: string;
    }[];
    expect(rows).toHaveLength(2);
  });

  it('directives gains nullable project_id column + idx_directives_project index', () => {
    const db = freshDb();
    const cols = db.prepare('PRAGMA table_info(directives)').all() as ColumnInfo[];
    const projectId = cols.find((c) => c.name === 'project_id');
    expect(projectId, 'project_id column missing').toBeDefined();
    expect(projectId?.type).toBe('TEXT');
    expect(Boolean(projectId?.notnull)).toBe(false);
    const indexes = db.prepare('PRAGMA index_list(directives)').all() as IndexInfo[];
    expect(indexes.find((i) => i.name === 'idx_directives_project')).toBeDefined();
  });

  it('runs idempotently — applied migrations land exactly once', () => {
    const db = freshDb();
    runMigrations(db);
    runMigrations(db);
    const ids = (db.prepare('SELECT id FROM migrations ORDER BY id').all() as { id: number }[]).map(
      (r) => r.id,
    );
    expect(ids).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });
});

describe('migration 006 — backfill', () => {
  let workRoot: string;

  beforeEach(() => {
    workRoot = mkdtempSync(join(tmpdir(), 'factory5-mig006-'));
  });

  afterEach(() => {
    try {
      rmSync(workRoot, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  });

  /**
   * Insert a legacy projects row (the pre-006 schema, name-keyed). Uses
   * raw SQL because the current `projects` typed CRUD targets the new
   * shape and would 400 on a no-id insert.
   */
  function seedLegacyProject(
    db: BetterSqlite3.Database,
    name: string,
    workspacePath: string,
    createdAt = '2026-04-21T10:00:00.000Z',
  ): void {
    db.prepare(
      `INSERT INTO projects (name, workspace_path, status, created_at, last_touched_at)
       VALUES (?, ?, 'active', ?, ?)`,
    ).run(name, workspacePath, createdAt, createdAt);
  }

  function seedLegacyDirective(db: BetterSqlite3.Database, id: string, projectName: string): void {
    db.prepare(
      `INSERT INTO directives
         (id, source, principal, channel_ref, intent, payload_json, autonomy,
          created_at, status)
       VALUES (?, 'cli', 'me', 'r', 'build', ?, 'autonomous',
               '2026-04-21T10:00:00.000Z', 'pending')`,
    ).run(id, JSON.stringify({ project: projectName, workspace: '/tmp/x' }));
  }

  it('assigns a ULID and writes .factory/project.json for each legacy project', () => {
    const db = dbAtSchemaVersion5();
    const projectDir = join(workRoot, 'example');
    mkdirSync(projectDir, { recursive: true });
    seedLegacyProject(db, 'example', projectDir);

    runMigrations(db); // applies 006

    const projectJsonPath = join(projectDir, '.factory', 'project.json');
    expect(existsSync(projectJsonPath)).toBe(true);
    const written = JSON.parse(readFileSync(projectJsonPath, 'utf8')) as {
      id: string;
      name: string;
      factoryVersion: string;
    };
    expect(written.id).toMatch(ULID_RE);
    expect(written.name).toBe('example');
    expect(written.factoryVersion).toBe('0.x');

    const row = db.prepare(`SELECT id, name, last_workspace_path FROM projects`).get() as {
      id: string;
      name: string;
      last_workspace_path: string | null;
    };
    expect(row.id).toBe(written.id);
    expect(row.name).toBe('example');
    expect(row.last_workspace_path).toBeNull(); // file write succeeded → workspace is reachable
  });

  it('skips writing the file when the workspace path is missing; sets last_workspace_path', () => {
    const db = dbAtSchemaVersion5();
    const ghostPath = join(workRoot, 'never-existed');
    seedLegacyProject(db, 'ghost', ghostPath);

    runMigrations(db);

    expect(existsSync(join(ghostPath, '.factory', 'project.json'))).toBe(false);
    const row = db.prepare(`SELECT id, name, last_workspace_path FROM projects`).get() as {
      id: string;
      name: string;
      last_workspace_path: string | null;
    };
    expect(row.id).toMatch(ULID_RE);
    expect(row.last_workspace_path).toBe(ghostPath);
  });

  it('adopts an existing valid project.json instead of overwriting (retry safety)', () => {
    const db = dbAtSchemaVersion5();
    const projectDir = join(workRoot, 'pre-existing');
    const factoryDir = join(projectDir, '.factory');
    mkdirSync(factoryDir, { recursive: true });
    const existingId = '01KP99999999999999999999AA';
    const existingFile = {
      id: existingId,
      name: 'pre-existing',
      createdAt: '2026-01-01T00:00:00.000Z',
      factoryVersion: '0.x',
      metadata: { tag: 'placed-by-operator' },
    };
    writeFileSync(join(factoryDir, 'project.json'), JSON.stringify(existingFile, null, 2), 'utf8');
    seedLegacyProject(db, 'pre-existing', projectDir);

    runMigrations(db);

    const row = db.prepare('SELECT id FROM projects').get() as { id: string };
    expect(row.id).toBe(existingId);
    // The file content is untouched.
    const onDisk = JSON.parse(readFileSync(join(factoryDir, 'project.json'), 'utf8')) as {
      id: string;
      metadata: { tag: string };
    };
    expect(onDisk.id).toBe(existingId);
    expect(onDisk.metadata.tag).toBe('placed-by-operator');
  });

  it('translates findings_registry.project_id from basename to ULID', () => {
    const db = dbAtSchemaVersion5();
    const projectDir = join(workRoot, 'demo');
    mkdirSync(projectDir, { recursive: true });
    seedLegacyProject(db, 'demo', projectDir);
    db.prepare(
      `INSERT INTO findings_registry
         (project_id, project_path, finding_id, source, target, severity,
          status, description, advisory, created_at, updated_at)
       VALUES (?, ?, 'F001', 'reviewer', 'src/x.ts', 'HIGH', 'OPEN',
               'something', 0, ?, ?)`,
    ).run('demo', projectDir, '2026-04-21T10:00:00.000Z', '2026-04-21T10:00:00.000Z');

    runMigrations(db);

    const row = db.prepare('SELECT project_id FROM findings_registry').get() as {
      project_id: string;
    };
    expect(row.project_id).toMatch(ULID_RE);
    expect(row.project_id).not.toBe('demo');

    // The ULID matches what's now in projects.id and on disk.
    const projectRow = db.prepare(`SELECT id FROM projects WHERE name = 'demo'`).get() as {
      id: string;
    };
    expect(row.project_id).toBe(projectRow.id);
  });

  it('populates directives.project_id from payload_json.project', () => {
    const db = dbAtSchemaVersion5();
    const projectDir = join(workRoot, 'auth-service');
    mkdirSync(projectDir, { recursive: true });
    seedLegacyProject(db, 'auth-service', projectDir);
    seedLegacyDirective(db, '01KP00000000000000000000DA', 'auth-service');
    seedLegacyDirective(db, '01KP00000000000000000000DB', 'auth-service');
    // A directive without a project payload — must remain NULL.
    db.prepare(
      `INSERT INTO directives
         (id, source, principal, channel_ref, intent, payload_json, autonomy,
          created_at, status)
       VALUES ('01KP00000000000000000000DC', 'cli', 'me', 'r', 'chat', '{}',
               'chat', '2026-04-21T10:00:00.000Z', 'pending')`,
    ).run();

    runMigrations(db);

    const projectRow = db.prepare(`SELECT id FROM projects`).get() as { id: string };
    const updated = db.prepare('SELECT id, project_id FROM directives ORDER BY id').all() as {
      id: string;
      project_id: string | null;
    }[];
    expect(updated.find((r) => r.id === '01KP00000000000000000000DA')?.project_id).toBe(
      projectRow.id,
    );
    expect(updated.find((r) => r.id === '01KP00000000000000000000DB')?.project_id).toBe(
      projectRow.id,
    );
    expect(updated.find((r) => r.id === '01KP00000000000000000000DC')?.project_id).toBeNull();
  });

  it('translates learnings.source_project from name to ULID', () => {
    const db = dbAtSchemaVersion5();
    const projectDir = join(workRoot, 'pythonproj');
    mkdirSync(projectDir, { recursive: true });
    seedLegacyProject(db, 'pythonproj', projectDir);
    db.prepare(
      `INSERT INTO learnings (id, topic, lesson, source_project, created_at, times_applied)
       VALUES ('01KP00000000000000000000LA', 't', 'l', 'pythonproj',
               '2026-04-21T10:00:00.000Z', 0)`,
    ).run();
    db.prepare(
      `INSERT INTO learnings (id, topic, lesson, source_project, created_at, times_applied)
       VALUES ('01KP00000000000000000000LB', 't', 'l', NULL,
               '2026-04-21T10:00:00.000Z', 0)`,
    ).run();

    runMigrations(db);

    const projectRow = db.prepare('SELECT id FROM projects').get() as { id: string };
    const a = db
      .prepare(`SELECT source_project FROM learnings WHERE id = ?`)
      .get('01KP00000000000000000000LA') as { source_project: string };
    const b = db
      .prepare(`SELECT source_project FROM learnings WHERE id = ?`)
      .get('01KP00000000000000000000LB') as { source_project: string | null };
    expect(a.source_project).toBe(projectRow.id);
    expect(b.source_project).toBeNull();
  });

  it('leaves orphan findings_registry rows alone when project name is unknown', () => {
    const db = dbAtSchemaVersion5();
    db.prepare(
      `INSERT INTO findings_registry
         (project_id, project_path, finding_id, source, target, severity,
          status, description, advisory, created_at, updated_at)
       VALUES ('not-in-projects', '/tmp/orphan', 'F001', 'reviewer', 'x',
               'LOW', 'OPEN', 'orphan', 0, ?, ?)`,
    ).run('2026-04-21T10:00:00.000Z', '2026-04-21T10:00:00.000Z');

    runMigrations(db);

    const row = db.prepare('SELECT project_id FROM findings_registry').get() as {
      project_id: string;
    };
    expect(row.project_id).toBe('not-in-projects');
  });
});
