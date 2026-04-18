import { newId } from '@factory5/core';
import BetterSqlite3 from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';

import { runMigrations, currentSchemaVersion } from './migrations/index.js';
import * as directives from './queries/directives.js';
import * as events from './queries/events.js';
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
      source: 'github',
      body: {
        kind: 'github.issue.opened' as const,
        repo: 'owner/name',
        number: 1,
        title: 't',
        author: 'u',
        body: 'b',
      },
      metadata: { foo: 'bar' },
      receivedAt: new Date().toISOString(),
    };
    events.append(db, e);
    const recent = events.recentByKind(db, 'github.issue.opened');
    expect(recent).toHaveLength(1);
    expect(recent[0]?.id).toBe(e.id);
    expect(recent[0]?.metadata['foo']).toBe('bar');
  });
});

describe('projects queries', () => {
  it('upsert + getByName + listAll', () => {
    const db = freshDb();
    const now = new Date().toISOString();
    projects.upsert(db, {
      name: 'demo',
      workspacePath: '/tmp/demo',
      status: 'active',
      createdAt: now,
      lastTouchedAt: now,
    });
    const got = projects.getByName(db, 'demo');
    expect(got?.workspacePath).toBe('/tmp/demo');

    projects.upsert(db, {
      name: 'demo',
      workspacePath: '/tmp/demo',
      status: 'paused',
      createdAt: now,
      lastTouchedAt: new Date().toISOString(),
    });
    expect(projects.getByName(db, 'demo')?.status).toBe('paused');

    expect(projects.listAll(db)).toHaveLength(1);
  });
});
