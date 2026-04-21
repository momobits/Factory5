import { newId, type Finding } from '@factory5/core';
import BetterSqlite3 from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';

import { runMigrations, currentSchemaVersion } from './migrations/index.js';
import * as directives from './queries/directives.js';
import * as events from './queries/events.js';
import * as findingsRegistry from './queries/findings-registry.js';
import * as projects from './queries/projects.js';

function freshDb(): BetterSqlite3.Database {
  const db = new BetterSqlite3(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

describe('migrations', () => {
  it('runs idempotently', () => {
    const db = freshDb();
    runMigrations(db);
    runMigrations(db);
    const count = (db.prepare('SELECT COUNT(*) AS c FROM migrations').get() as { c: number }).c;
    expect(count).toBe(currentSchemaVersion);
  });

  it('creates expected tables', () => {
    const db = freshDb();
    const rows = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all() as { name: string }[];
    const names = rows.map((r) => r.name);
    for (const expected of [
      'directives',
      'events_audit',
      'findings_registry',
      'learnings',
      'migrations',
      'model_usage',
      'outbound_messages',
      'pending_questions',
      'projects',
      'sessions',
      'tasks_inflight',
    ]) {
      expect(names).toContain(expected);
    }
  });
});

describe('directives queries', () => {
  let db: BetterSqlite3.Database;
  beforeEach(() => {
    db = freshDb();
  });

  it('insert + getById round-trips', () => {
    const d = {
      id: newId(),
      source: 'cli' as const,
      principal: 'me',
      channelRef: 's-1',
      intent: 'build' as const,
      payload: { project: 'x' },
      autonomy: 'assisted' as const,
      createdAt: new Date().toISOString(),
      status: 'pending' as const,
    };
    directives.insert(db, d);
    const got = directives.getById(db, d.id);
    expect(got).toBeDefined();
    expect(got?.id).toBe(d.id);
    expect(got?.intent).toBe('build');
  });

  it('claimNext picks oldest pending and updates status', async () => {
    const t0 = new Date('2026-01-01T00:00:00Z').toISOString();
    const t1 = new Date('2026-01-01T00:00:01Z').toISOString();

    const a = {
      id: newId(),
      source: 'cli' as const,
      principal: 'me',
      channelRef: 's-1',
      intent: 'build' as const,
      payload: {},
      autonomy: 'assisted' as const,
      createdAt: t0,
      status: 'pending' as const,
    };
    const b = { ...a, id: newId(), createdAt: t1 };
    directives.insert(db, a);
    directives.insert(db, b);

    const claimed = directives.claimNext(db, { claimedBy: 'brain-1' });
    expect(claimed?.id).toBe(a.id);
    expect(claimed?.status).toBe('claimed');
    expect(claimed?.claimedBy).toBe('brain-1');

    const claimed2 = directives.claimNext(db, { claimedBy: 'brain-1' });
    expect(claimed2?.id).toBe(b.id);

    const claimed3 = directives.claimNext(db, { claimedBy: 'brain-1' });
    expect(claimed3).toBeUndefined();
  });
});

describe('events queries', () => {
  it('append + recentByKind round-trips', () => {
    const db = freshDb();
    const e = {
      id: newId(),
      source: 'fs',
      body: {
        kind: 'fs.changed' as const,
        path: '/workspace/demo/src/api.py',
        type: 'modify' as const,
      },
      metadata: { foo: 'bar' },
      receivedAt: new Date().toISOString(),
    };
    events.append(db, e);
    const recent = events.recentByKind(db, 'fs.changed');
    expect(recent).toHaveLength(1);
    expect(recent[0]?.id).toBe(e.id);
    expect(recent[0]?.metadata['foo']).toBe('bar');
  });
});

describe('projects queries', () => {
  it('upsert + getById + listAll (id-keyed per ADR 0021)', () => {
    const db = freshDb();
    const now = new Date().toISOString();
    const id = newId();
    projects.upsert(db, {
      id,
      name: 'demo',
      workspacePath: '/tmp/demo',
      status: 'active',
      createdAt: now,
      lastTouchedAt: now,
    });
    const got = projects.getById(db, id);
    expect(got?.workspacePath).toBe('/tmp/demo');
    expect(got?.id).toBe(id);

    projects.upsert(db, {
      id,
      name: 'demo',
      workspacePath: '/tmp/demo',
      status: 'paused',
      createdAt: now,
      lastTouchedAt: new Date().toISOString(),
    });
    expect(projects.getById(db, id)?.status).toBe('paused');

    expect(projects.listAll(db)).toHaveLength(1);
  });

  it('two projects sharing a name are distinct rows when ids differ', () => {
    const db = freshDb();
    const now = new Date().toISOString();
    const idA = newId();
    const idB = newId();
    projects.upsert(db, {
      id: idA,
      name: 'example',
      workspacePath: '/c/Users/Momo/factory5-v5f-example-2/example',
      status: 'active',
      createdAt: now,
      lastTouchedAt: now,
    });
    projects.upsert(db, {
      id: idB,
      name: 'example',
      workspacePath: '/c/Users/Momo/factory5-v6c-example/example',
      status: 'active',
      createdAt: now,
      lastTouchedAt: now,
    });
    expect(projects.listAll(db)).toHaveLength(2);
    const byName = projects.findByName(db, 'example');
    expect(byName).toHaveLength(2);
    expect(new Set(byName.map((p) => p.id))).toEqual(new Set([idA, idB]));
  });

  it('lastWorkspacePath round-trips when set; absent when null', () => {
    const db = freshDb();
    const now = new Date().toISOString();
    const idA = newId();
    const idB = newId();
    projects.upsert(db, {
      id: idA,
      name: 'a',
      workspacePath: '/tmp/a',
      lastWorkspacePath: '/old/path/a',
      status: 'active',
      createdAt: now,
      lastTouchedAt: now,
    });
    projects.upsert(db, {
      id: idB,
      name: 'b',
      workspacePath: '/tmp/b',
      status: 'active',
      createdAt: now,
      lastTouchedAt: now,
    });
    expect(projects.getById(db, idA)?.lastWorkspacePath).toBe('/old/path/a');
    expect(projects.getById(db, idB)?.lastWorkspacePath).toBeUndefined();
  });
});

describe('findings_registry queries', () => {
  function seedFinding(
    db: BetterSqlite3.Database,
    projectId: string,
    findingId: string,
    overrides: Partial<Finding> = {},
    projectPath = `/tmp/${projectId}`,
    updatedAt = '2026-04-21T10:00:00.000Z',
  ): void {
    const f: Finding = {
      id: findingId,
      source: 'reviewer',
      target: 'src/x',
      severity: 'MEDIUM',
      status: 'OPEN',
      description: `${findingId} default desc`,
      createdAt: '2026-04-21T09:00:00.000Z',
      ...overrides,
    };
    findingsRegistry.upsert(db, { projectId, projectPath, finding: f, updatedAt });
  }

  it('upsert preserves created_at and overwrites mutable fields on conflict', () => {
    const db = freshDb();
    seedFinding(db, 'alpha', 'F001', {
      status: 'OPEN',
      description: 'first',
      createdAt: '2026-04-01T00:00:00.000Z',
    });
    seedFinding(db, 'alpha', 'F001', {
      status: 'FIXED',
      description: 'second',
      resolution: 'patched',
      resolvedAt: '2026-04-10T00:00:00.000Z',
      createdAt: '2026-04-05T00:00:00.000Z', // input carries later createdAt — must be ignored
    });
    const got = findingsRegistry.getByProjectAndId(db, 'alpha', 'F001');
    expect(got?.finding.status).toBe('FIXED');
    expect(got?.finding.description).toBe('second');
    expect(got?.finding.resolution).toBe('patched');
    expect(got?.finding.createdAt).toBe('2026-04-01T00:00:00.000Z');
  });

  it('list filters by severity and status', () => {
    const db = freshDb();
    seedFinding(db, 'alpha', 'F001', { severity: 'HIGH', status: 'OPEN' });
    seedFinding(db, 'alpha', 'F002', { severity: 'LOW', status: 'OPEN' });
    seedFinding(db, 'beta', 'F001', { severity: 'HIGH', status: 'FIXED' });
    const openHigh = findingsRegistry.list(db, { severity: 'HIGH', status: 'OPEN' });
    expect(openHigh).toHaveLength(1);
    expect(openHigh[0]?.projectId).toBe('alpha');
    const allHigh = findingsRegistry.list(db, { severity: 'HIGH' });
    expect(allHigh).toHaveLength(2);
  });

  it('list filters advisory: true vs false vs undefined', () => {
    const db = freshDb();
    seedFinding(db, 'alpha', 'F001', { source: 'reviewer' }); // blocking
    seedFinding(db, 'alpha', 'F002', { source: 'verifier', advisory: true }); // advisory
    const advisory = findingsRegistry.list(db, { advisory: true });
    const blocking = findingsRegistry.list(db, { advisory: false });
    const both = findingsRegistry.list(db, {});
    expect(advisory.map((e) => e.finding.id)).toEqual(['F002']);
    expect(blocking.map((e) => e.finding.id)).toEqual(['F001']);
    expect(both.map((e) => e.finding.id).sort()).toEqual(['F001', 'F002']);
  });

  it('list project filter — exact match + glob (*, ?)', () => {
    const db = freshDb();
    seedFinding(db, 'alpha', 'F001');
    seedFinding(db, 'alpha-two', 'F001');
    seedFinding(db, 'beta', 'F001');
    const exact = findingsRegistry.list(db, { project: 'alpha' });
    expect(exact.map((e) => e.projectId)).toEqual(['alpha']);
    const glob = findingsRegistry.list(db, { project: 'alpha*' });
    expect(glob.map((e) => e.projectId).sort()).toEqual(['alpha', 'alpha-two']);
    const questionMark = findingsRegistry.list(db, { project: 'bet?' });
    expect(questionMark.map((e) => e.projectId)).toEqual(['beta']);
  });

  it('list project filter escapes literal % and _ in the source', () => {
    const db = freshDb();
    seedFinding(db, 'my_project', 'F001');
    seedFinding(db, 'myXproject', 'F001');
    // Plain string without glob chars → exact match; the underscore must
    // be treated literally, not as SQL single-character wildcard.
    const got = findingsRegistry.list(db, { project: 'my_project' });
    expect(got.map((e) => e.projectId)).toEqual(['my_project']);
  });

  it('list orders by updated_at DESC and honours limit', () => {
    const db = freshDb();
    seedFinding(db, 'alpha', 'F001', undefined, undefined, '2026-04-21T10:00:00.000Z');
    seedFinding(db, 'alpha', 'F002', undefined, undefined, '2026-04-21T12:00:00.000Z');
    seedFinding(db, 'alpha', 'F003', undefined, undefined, '2026-04-21T11:00:00.000Z');
    const all = findingsRegistry.list(db, {});
    expect(all.map((e) => e.finding.id)).toEqual(['F002', 'F003', 'F001']);
    const capped = findingsRegistry.list(db, { limit: 2 });
    expect(capped).toHaveLength(2);
    expect(capped.map((e) => e.finding.id)).toEqual(['F002', 'F003']);
  });

  it('findByFindingId surfaces every project that raised the same F-ID', () => {
    const db = freshDb();
    seedFinding(db, 'alpha', 'F001');
    seedFinding(db, 'beta', 'F001');
    const got = findingsRegistry.findByFindingId(db, 'F001');
    expect(got.map((e) => e.projectId).sort()).toEqual(['alpha', 'beta']);
  });

  it('getByProjectAndId returns undefined on miss', () => {
    const db = freshDb();
    expect(findingsRegistry.getByProjectAndId(db, 'nope', 'F001')).toBeUndefined();
  });
});
