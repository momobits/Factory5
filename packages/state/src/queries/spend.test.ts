import { newId } from '@factory5/core';
import BetterSqlite3 from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';

import { runMigrations } from '../migrations/index.js';
import * as directives from './directives.js';
import * as modelUsage from './model-usage.js';
import * as projects from './projects.js';
import * as spend from './spend.js';

function freshDb(): BetterSqlite3.Database {
  const db = new BetterSqlite3(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

/**
 * Insert a project row via the typed helper so the test exercises the same
 * Zod-validated path production code uses (`wiki.loadOrCreateProjectMetadata`
 * → `projects.upsert`).
 */
function seedProject(
  db: BetterSqlite3.Database,
  overrides: Partial<Parameters<typeof projects.upsert>[1]> = {},
): { id: string; name: string } {
  const id = overrides.id ?? newId();
  const name = overrides.name ?? 'example';
  projects.upsert(db, {
    id,
    name,
    workspacePath: overrides.workspacePath ?? `/tmp/${name}`,
    status: overrides.status ?? 'active',
    createdAt: overrides.createdAt ?? '2026-04-21T00:00:00.000Z',
    lastTouchedAt: overrides.lastTouchedAt ?? '2026-04-21T00:00:00.000Z',
    ...(overrides.lastWorkspacePath !== undefined
      ? { lastWorkspacePath: overrides.lastWorkspacePath }
      : {}),
    ...(overrides.metadata !== undefined ? { metadata: overrides.metadata } : {}),
  });
  return { id, name };
}

/**
 * Insert a directive row via the typed helper. Returns the id so the caller
 * can hang `model_usage` off it.
 */
function seedDirective(
  db: BetterSqlite3.Database,
  overrides: Partial<Parameters<typeof directives.insert>[1]> = {},
): string {
  const id = overrides.id ?? newId();
  directives.insert(db, {
    id,
    source: overrides.source ?? 'cli',
    principal: overrides.principal ?? 'me',
    channelRef: overrides.channelRef ?? 's-1',
    intent: overrides.intent ?? 'build',
    payload: overrides.payload ?? { project: 'example' },
    autonomy: overrides.autonomy ?? 'autonomous',
    createdAt: overrides.createdAt ?? '2026-04-21T00:00:00.000Z',
    status: overrides.status ?? 'pending',
    ...(overrides.projectId !== undefined ? { projectId: overrides.projectId } : {}),
  });
  return id;
}

/**
 * Insert a `model_usage` row with sensible defaults. Callers override just
 * the fields that matter for their assertion. `calledAt` defaults derive
 * from a monotonic offset so later calls in a test naturally land after
 * earlier calls (MIN / MAX / ordering tests).
 */
function seedUsage(
  db: BetterSqlite3.Database,
  i: number,
  overrides: Partial<Omit<modelUsage.UsageRecord, 'id'>> = {},
): string {
  const id = newId();
  modelUsage.record(db, {
    id,
    provider: overrides.provider ?? 'claude-cli',
    model: overrides.model ?? 'claude-opus-4-7',
    category: overrides.category ?? 'reasoning',
    inputTokens: overrides.inputTokens ?? 1000,
    outputTokens: overrides.outputTokens ?? 5000,
    costUsd: overrides.costUsd ?? 0.5,
    durationMs: overrides.durationMs ?? 10_000,
    calledAt: overrides.calledAt ?? new Date(1_714_000_000_000 + i * 1_000).toISOString(),
    ...(overrides.directiveId !== undefined ? { directiveId: overrides.directiveId } : {}),
    ...(overrides.taskId !== undefined ? { taskId: overrides.taskId } : {}),
    ...(overrides.mode !== undefined ? { mode: overrides.mode } : {}),
    ...(overrides.error !== undefined ? { error: overrides.error } : {}),
  });
  return id;
}

describe('spend.formatProjectDisplay', () => {
  it('returns (unassigned) when id is null', () => {
    expect(spend.formatProjectDisplay('example', null)).toBe('(unassigned)');
    expect(spend.formatProjectDisplay(null, null)).toBe('(unassigned)');
  });

  it('formats name + last-4 of ULID in ADR 0021 §5 shape', () => {
    // ADR §1 shows ULID 01KPRHNEX1T3VR3S4ZTTSJ8F0M (last 4 = 8F0M). The §5
    // display example uses a different ULID suffix; the rule is "last 4",
    // applied uniformly here.
    expect(spend.formatProjectDisplay('example', '01KPRHNEX1T3VR3S4ZTTSJ8F0M')).toBe(
      'example (…8F0M)',
    );
  });

  it('falls back to (unknown) when id is present but name is null (defensive)', () => {
    expect(spend.formatProjectDisplay(null, '01KPRHNEX1T3VR3S4ZTTSJ8F0M')).toBe(
      '(unknown) (…8F0M)',
    );
  });
});

describe('spend.perProject', () => {
  let db: BetterSqlite3.Database;
  beforeEach(() => {
    db = freshDb();
  });

  it('returns empty array for an empty database', () => {
    expect(spend.perProject(db)).toEqual([]);
  });

  it('groups model_usage by directives.project_id and sums cost_usd', () => {
    const pa = seedProject(db, { name: 'alpha' });
    const pb = seedProject(db, { name: 'beta' });
    const da1 = seedDirective(db, { projectId: pa.id });
    const da2 = seedDirective(db, { projectId: pa.id });
    const db1 = seedDirective(db, { projectId: pb.id });
    seedUsage(db, 0, { directiveId: da1, costUsd: 1.0 });
    seedUsage(db, 1, { directiveId: da1, costUsd: 0.5 });
    seedUsage(db, 2, { directiveId: da2, costUsd: 0.25 });
    seedUsage(db, 3, { directiveId: db1, costUsd: 2.0 });

    const rows = spend.perProject(db);
    expect(rows).toHaveLength(2);

    // Ordering: totalUsd DESC — beta ($2) before alpha ($1.75).
    expect(rows[0]?.projectId).toBe(pb.id);
    expect(rows[0]?.projectName).toBe('beta');
    expect(rows[0]?.totalUsd).toBeCloseTo(2.0);
    expect(rows[0]?.callCount).toBe(1);
    expect(rows[0]?.directiveCount).toBe(1);

    expect(rows[1]?.projectId).toBe(pa.id);
    expect(rows[1]?.projectName).toBe('alpha');
    expect(rows[1]?.totalUsd).toBeCloseTo(1.75);
    expect(rows[1]?.callCount).toBe(3);
    expect(rows[1]?.directiveCount).toBe(2);
  });

  it('ADR 0021 regression: two projects sharing basename appear as distinct rows', () => {
    // Both named "example" but with different ULIDs — the collision I008
    // documented under the pre-migration name-keyed schema.
    const p1 = seedProject(db, { name: 'example', workspacePath: '/tmp/ws1/example' });
    const p2 = seedProject(db, { name: 'example', workspacePath: '/tmp/ws2/example' });
    const d1 = seedDirective(db, { projectId: p1.id });
    const d2 = seedDirective(db, { projectId: p2.id });
    seedUsage(db, 0, { directiveId: d1, costUsd: 1.5 });
    seedUsage(db, 1, { directiveId: d2, costUsd: 2.0 });

    const rows = spend.perProject(db);
    expect(rows).toHaveLength(2);
    const byId = new Map(rows.map((r) => [r.projectId, r]));
    expect(byId.get(p1.id)?.totalUsd).toBeCloseTo(1.5);
    expect(byId.get(p2.id)?.totalUsd).toBeCloseTo(2.0);
    // Both carry the same human-name; the display disambiguates via ULID suffix.
    expect(byId.get(p1.id)?.display).toMatch(/^example \(…[0-9A-HJKMNP-TV-Z]{4}\)$/);
    expect(byId.get(p2.id)?.display).toMatch(/^example \(…[0-9A-HJKMNP-TV-Z]{4}\)$/);
    expect(byId.get(p1.id)?.display).not.toBe(byId.get(p2.id)?.display);
  });

  it('collapses directive-less and project-less usage into a single (unassigned) bucket', () => {
    const p = seedProject(db, { name: 'alpha' });
    const d = seedDirective(db, { projectId: p.id });
    const dNoProject = seedDirective(db); // no projectId → chat/system-style directive
    seedUsage(db, 0, { directiveId: d, costUsd: 1.0 });
    seedUsage(db, 1, { directiveId: dNoProject, costUsd: 0.25 });
    // Orphan usage row — no directive_id at all.
    seedUsage(db, 2, { costUsd: 0.1 });

    const rows = spend.perProject(db);
    expect(rows).toHaveLength(2);
    const unassigned = rows.find((r) => r.projectId === null);
    const alpha = rows.find((r) => r.projectId === p.id);
    expect(unassigned?.totalUsd).toBeCloseTo(0.35);
    expect(unassigned?.callCount).toBe(2);
    expect(unassigned?.display).toBe('(unassigned)');
    expect(alpha?.totalUsd).toBeCloseTo(1.0);
    expect(alpha?.display).toMatch(/^alpha \(…/);
  });

  it('directiveCount ignores NULL directive_id rows inside the (unassigned) bucket', () => {
    seedUsage(db, 0, { costUsd: 0.1 });
    seedUsage(db, 1, { costUsd: 0.2 });
    const rows = spend.perProject(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.projectId).toBeNull();
    // COUNT(DISTINCT NULL) is 0 — two NULL rows still attribute no distinct directives.
    expect(rows[0]?.directiveCount).toBe(0);
    expect(rows[0]?.callCount).toBe(2);
  });

  it('applies since / until / projectId filters', () => {
    const pa = seedProject(db, { name: 'alpha' });
    const pb = seedProject(db, { name: 'beta' });
    const da = seedDirective(db, { projectId: pa.id });
    const dbd = seedDirective(db, { projectId: pb.id });
    seedUsage(db, 0, { directiveId: da, costUsd: 1.0, calledAt: '2026-04-01T00:00:00.000Z' });
    seedUsage(db, 1, { directiveId: da, costUsd: 2.0, calledAt: '2026-04-10T00:00:00.000Z' });
    seedUsage(db, 2, { directiveId: dbd, costUsd: 4.0, calledAt: '2026-04-15T00:00:00.000Z' });

    // since — inclusive lower bound.
    const after = spend.perProject(db, { since: '2026-04-10T00:00:00.000Z' });
    expect(after.reduce((a, r) => a + r.totalUsd, 0)).toBeCloseTo(6.0);

    // until — exclusive upper bound.
    const before = spend.perProject(db, { until: '2026-04-15T00:00:00.000Z' });
    expect(before.reduce((a, r) => a + r.totalUsd, 0)).toBeCloseTo(3.0);

    // projectId — restricts to one project.
    const alphaOnly = spend.perProject(db, { projectId: pa.id });
    expect(alphaOnly).toHaveLength(1);
    expect(alphaOnly[0]?.totalUsd).toBeCloseTo(3.0);

    // Compound filter.
    const alphaRecent = spend.perProject(db, {
      projectId: pa.id,
      since: '2026-04-10T00:00:00.000Z',
    });
    expect(alphaRecent[0]?.totalUsd).toBeCloseTo(2.0);
  });
});

describe('spend.perDirective', () => {
  let db: BetterSqlite3.Database;
  beforeEach(() => {
    db = freshDb();
  });

  it('returns empty array for an empty database', () => {
    expect(spend.perDirective(db)).toEqual([]);
  });

  it('matches totalCostForDirective per directive — consistency check', () => {
    const p = seedProject(db, { name: 'alpha' });
    const d1 = seedDirective(db, { projectId: p.id });
    const d2 = seedDirective(db, { projectId: p.id });
    seedUsage(db, 0, { directiveId: d1, costUsd: 1.0 });
    seedUsage(db, 1, { directiveId: d1, costUsd: 0.5 });
    seedUsage(db, 2, { directiveId: d2, costUsd: 0.25 });

    const rows = spend.perDirective(db);
    const byId = new Map(rows.map((r) => [r.directiveId, r]));
    expect(byId.get(d1)?.totalUsd).toBeCloseTo(modelUsage.totalCostForDirective(db, d1));
    expect(byId.get(d2)?.totalUsd).toBeCloseTo(modelUsage.totalCostForDirective(db, d2));
    expect(byId.get(d1)?.callCount).toBe(2);
    expect(byId.get(d2)?.callCount).toBe(1);
  });

  it('excludes orphan (NULL directive_id) rows', () => {
    const d = seedDirective(db);
    seedUsage(db, 0, { directiveId: d, costUsd: 0.5 });
    seedUsage(db, 1, { costUsd: 0.2 }); // NULL directive_id

    const rows = spend.perDirective(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.directiveId).toBe(d);
    expect(rows[0]?.totalUsd).toBeCloseTo(0.5);
  });

  it('exposes firstCalledAt / lastCalledAt and orders by lastCalledAt DESC', () => {
    const d1 = seedDirective(db);
    const d2 = seedDirective(db);
    seedUsage(db, 0, { directiveId: d1, calledAt: '2026-04-10T00:00:00.000Z' });
    seedUsage(db, 1, { directiveId: d1, calledAt: '2026-04-12T00:00:00.000Z' });
    seedUsage(db, 2, { directiveId: d2, calledAt: '2026-04-11T00:00:00.000Z' });

    const rows = spend.perDirective(db);
    expect(rows).toHaveLength(2);
    // d1 last-called 2026-04-12 → above d2 (last-called 2026-04-11).
    expect(rows[0]?.directiveId).toBe(d1);
    expect(rows[0]?.firstCalledAt).toBe('2026-04-10T00:00:00.000Z');
    expect(rows[0]?.lastCalledAt).toBe('2026-04-12T00:00:00.000Z');
    expect(rows[1]?.directiveId).toBe(d2);
    expect(rows[1]?.firstCalledAt).toBe('2026-04-11T00:00:00.000Z');
    expect(rows[1]?.lastCalledAt).toBe('2026-04-11T00:00:00.000Z');
  });

  it('carries project context onto each row; null for directives without a project', () => {
    const p = seedProject(db, { name: 'alpha' });
    const d1 = seedDirective(db, { projectId: p.id });
    const d2 = seedDirective(db); // no project
    seedUsage(db, 0, { directiveId: d1, costUsd: 1.0 });
    seedUsage(db, 1, { directiveId: d2, costUsd: 0.1 });

    const rows = spend.perDirective(db);
    const byId = new Map(rows.map((r) => [r.directiveId, r]));
    expect(byId.get(d1)?.projectId).toBe(p.id);
    expect(byId.get(d1)?.projectName).toBe('alpha');
    expect(byId.get(d2)?.projectId).toBeNull();
    expect(byId.get(d2)?.projectName).toBeNull();
  });

  it('applies since / until / projectId filters', () => {
    const pa = seedProject(db, { name: 'alpha' });
    const pb = seedProject(db, { name: 'beta' });
    const da = seedDirective(db, { projectId: pa.id });
    const dbd = seedDirective(db, { projectId: pb.id });
    seedUsage(db, 0, { directiveId: da, costUsd: 1.0, calledAt: '2026-04-01T00:00:00.000Z' });
    seedUsage(db, 1, { directiveId: dbd, costUsd: 4.0, calledAt: '2026-04-15T00:00:00.000Z' });

    const recent = spend.perDirective(db, { since: '2026-04-10T00:00:00.000Z' });
    expect(recent).toHaveLength(1);
    expect(recent[0]?.directiveId).toBe(dbd);

    const alphaOnly = spend.perDirective(db, { projectId: pa.id });
    expect(alphaOnly).toHaveLength(1);
    expect(alphaOnly[0]?.directiveId).toBe(da);
  });
});

describe('spend.perDay', () => {
  let db: BetterSqlite3.Database;
  beforeEach(() => {
    db = freshDb();
  });

  it('returns empty array for an empty database', () => {
    expect(spend.perDay(db)).toEqual([]);
  });

  it('groups by UTC calendar date of called_at', () => {
    seedUsage(db, 0, { costUsd: 1.0, calledAt: '2026-04-10T05:00:00.000Z' });
    seedUsage(db, 1, { costUsd: 0.5, calledAt: '2026-04-10T23:59:00.000Z' });
    seedUsage(db, 2, { costUsd: 2.0, calledAt: '2026-04-11T00:01:00.000Z' });

    const rows = spend.perDay(db);
    expect(rows).toHaveLength(2);
    // Ordering: date DESC.
    expect(rows[0]?.date).toBe('2026-04-11');
    expect(rows[0]?.totalUsd).toBeCloseTo(2.0);
    expect(rows[0]?.callCount).toBe(1);
    expect(rows[1]?.date).toBe('2026-04-10');
    expect(rows[1]?.totalUsd).toBeCloseTo(1.5);
    expect(rows[1]?.callCount).toBe(2);
  });

  it('applies since / until filters', () => {
    seedUsage(db, 0, { costUsd: 1.0, calledAt: '2026-04-01T00:00:00.000Z' });
    seedUsage(db, 1, { costUsd: 2.0, calledAt: '2026-04-10T00:00:00.000Z' });
    seedUsage(db, 2, { costUsd: 4.0, calledAt: '2026-04-20T00:00:00.000Z' });

    const rows = spend.perDay(db, {
      since: '2026-04-05T00:00:00.000Z',
      until: '2026-04-15T00:00:00.000Z',
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.date).toBe('2026-04-10');
    expect(rows[0]?.totalUsd).toBeCloseTo(2.0);
  });

  it('projectId filter restricts to matching directives only', () => {
    const pa = seedProject(db, { name: 'alpha' });
    const pb = seedProject(db, { name: 'beta' });
    const da = seedDirective(db, { projectId: pa.id });
    const dbd = seedDirective(db, { projectId: pb.id });
    seedUsage(db, 0, { directiveId: da, costUsd: 1.0, calledAt: '2026-04-10T00:00:00.000Z' });
    seedUsage(db, 1, { directiveId: dbd, costUsd: 3.0, calledAt: '2026-04-10T00:00:00.000Z' });

    const rows = spend.perDay(db, { projectId: pa.id });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.totalUsd).toBeCloseTo(1.0);
  });
});

describe('spend.perModel', () => {
  let db: BetterSqlite3.Database;
  beforeEach(() => {
    db = freshDb();
  });

  it('returns empty array for an empty database', () => {
    expect(spend.perModel(db)).toEqual([]);
  });

  it('groups by (provider, model) and orders by totalUsd DESC', () => {
    seedUsage(db, 0, {
      provider: 'claude-cli',
      model: 'claude-opus-4-7',
      costUsd: 2.0,
    });
    seedUsage(db, 1, {
      provider: 'claude-cli',
      model: 'claude-opus-4-7',
      costUsd: 1.0,
    });
    seedUsage(db, 2, {
      provider: 'claude-cli',
      model: 'claude-sonnet-4-6',
      costUsd: 0.5,
    });
    seedUsage(db, 3, {
      provider: 'claude-cli',
      model: 'claude-haiku-4-5',
      costUsd: 0.05,
    });

    const rows = spend.perModel(db);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({
      provider: 'claude-cli',
      model: 'claude-opus-4-7',
      callCount: 2,
    });
    expect(rows[0]?.totalUsd).toBeCloseTo(3.0);
    expect(rows[1]?.model).toBe('claude-sonnet-4-6');
    expect(rows[2]?.model).toBe('claude-haiku-4-5');
  });

  it('segregates same-model names across different providers', () => {
    seedUsage(db, 0, { provider: 'provider-a', model: 'shared-name', costUsd: 1.0 });
    seedUsage(db, 1, { provider: 'provider-b', model: 'shared-name', costUsd: 2.0 });

    const rows = spend.perModel(db);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => `${r.provider}/${r.model}`).sort()).toEqual([
      'provider-a/shared-name',
      'provider-b/shared-name',
    ]);
  });

  it('applies since / until / projectId filters', () => {
    const pa = seedProject(db, { name: 'alpha' });
    const pb = seedProject(db, { name: 'beta' });
    const da = seedDirective(db, { projectId: pa.id });
    const dbd = seedDirective(db, { projectId: pb.id });
    seedUsage(db, 0, {
      directiveId: da,
      model: 'm1',
      costUsd: 1.0,
      calledAt: '2026-04-01T00:00:00.000Z',
    });
    seedUsage(db, 1, {
      directiveId: da,
      model: 'm2',
      costUsd: 2.0,
      calledAt: '2026-04-15T00:00:00.000Z',
    });
    seedUsage(db, 2, {
      directiveId: dbd,
      model: 'm1',
      costUsd: 4.0,
      calledAt: '2026-04-15T00:00:00.000Z',
    });

    const recent = spend.perModel(db, { since: '2026-04-10T00:00:00.000Z' });
    // m1 ($4 from beta) + m2 ($2 from alpha). No m1 from alpha (before since).
    const totals = new Map(recent.map((r) => [r.model, r.totalUsd]));
    expect(totals.get('m1')).toBeCloseTo(4.0);
    expect(totals.get('m2')).toBeCloseTo(2.0);

    const alphaOnly = spend.perModel(db, { projectId: pa.id });
    const alphaTotals = new Map(alphaOnly.map((r) => [r.model, r.totalUsd]));
    expect(alphaTotals.get('m1')).toBeCloseTo(1.0);
    expect(alphaTotals.get('m2')).toBeCloseTo(2.0);
  });
});
