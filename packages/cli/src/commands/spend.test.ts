import { newId } from '@factory5/core';
import {
  directives,
  modelUsage,
  openDatabase,
  projects,
  runMigrations,
  type Database,
} from '@factory5/state';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { parseWindowArg, resolveProjectRef, runSpend } from './spend.js';

function freshDb(): Database {
  const db = openDatabase(':memory:');
  runMigrations(db);
  return db;
}

function seedProject(
  db: Database,
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
  });
  return { id, name };
}

function seedDirective(
  db: Database,
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

function seedUsage(
  db: Database,
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
    ...(overrides.mode !== undefined ? { mode: overrides.mode } : {}),
  });
  return id;
}

describe('parseWindowArg', () => {
  const FIXED_NOW = Date.parse('2026-04-21T12:00:00.000Z');
  const now = (): number => FIXED_NOW;

  it('resolves `Nd` as now-minus-N-days', () => {
    expect(parseWindowArg('7d', now)).toBe('2026-04-14T12:00:00.000Z');
  });

  it('resolves `Nh` as now-minus-N-hours', () => {
    expect(parseWindowArg('6h', now)).toBe('2026-04-21T06:00:00.000Z');
  });

  it('resolves `Nm` as now-minus-N-minutes', () => {
    expect(parseWindowArg('30m', now)).toBe('2026-04-21T11:30:00.000Z');
  });

  it('resolves a bare ISO date to that day 00:00 UTC', () => {
    expect(parseWindowArg('2026-04-10', now)).toBe('2026-04-10T00:00:00.000Z');
  });

  it('round-trips a full ISO datetime', () => {
    expect(parseWindowArg('2026-04-10T14:00:00Z', now)).toBe('2026-04-10T14:00:00.000Z');
  });

  it('rejects garbage input', () => {
    expect(parseWindowArg('tomorrow', now)).toBeUndefined();
    expect(parseWindowArg('', now)).toBeUndefined();
    expect(parseWindowArg('5', now)).toBeUndefined();
  });
});

describe('resolveProjectRef', () => {
  let db: Database;
  beforeEach(() => {
    db = freshDb();
  });
  afterEach(() => {
    db.close();
  });

  it('matches by full ULID', () => {
    const p = seedProject(db, { name: 'alpha' });
    const result = resolveProjectRef(db, p.id);
    expect(result).toEqual({ id: p.id });
  });

  it('matches by name when unique', () => {
    const p = seedProject(db, { name: 'alpha' });
    expect(resolveProjectRef(db, 'alpha')).toEqual({ id: p.id });
  });

  it('matches by id suffix (case-insensitive)', () => {
    const p = seedProject(db, { name: 'alpha' });
    const suffix = p.id.slice(-6).toLowerCase();
    expect(resolveProjectRef(db, suffix)).toEqual({ id: p.id });
  });

  it('returns a disambiguation error when a name matches two projects', () => {
    seedProject(db, { name: 'example', workspacePath: '/tmp/a/example' });
    seedProject(db, { name: 'example', workspacePath: '/tmp/b/example' });
    const result = resolveProjectRef(db, 'example');
    expect(result).not.toHaveProperty('id');
    if ('error' in result) {
      expect(result.error).toContain('ambiguous');
      expect(result.error).toContain('2 matches');
      expect(result.matches).toHaveLength(2);
    }
  });

  it('returns a not-found error when no project matches', () => {
    seedProject(db, { name: 'alpha' });
    const result = resolveProjectRef(db, 'nonsense');
    expect(result).not.toHaveProperty('id');
    if ('error' in result) {
      expect(result.error).toContain('no project matches');
    }
  });
});

describe('runSpend', () => {
  let db: Database;
  const FIXED_NOW = Date.parse('2026-04-21T12:00:00.000Z');
  const now = (): number => FIXED_NOW;

  beforeEach(() => {
    db = freshDb();
  });
  afterEach(() => {
    db.close();
  });

  it('rejects unknown --group-by with exit 2', () => {
    const result = runSpend(db, { groupBy: 'bogus' }, now);
    expect(result.exitCode).toBe(2);
    expect(result.stdout).toContain('invalid --group-by');
  });

  it('rejects invalid --since with exit 2', () => {
    const result = runSpend(db, { since: 'tomorrow' }, now);
    expect(result.exitCode).toBe(2);
    expect(result.stdout).toContain('invalid --since');
  });

  it('rejects invalid --until with exit 2', () => {
    const result = runSpend(db, { until: 'whenever' }, now);
    expect(result.exitCode).toBe(2);
    expect(result.stdout).toContain('invalid --until');
  });

  it('surfaces ambiguous --project with exit 2', () => {
    seedProject(db, { name: 'example', workspacePath: '/tmp/a/example' });
    seedProject(db, { name: 'example', workspacePath: '/tmp/b/example' });
    const result = runSpend(db, { project: 'example' }, now);
    expect(result.exitCode).toBe(2);
    expect(result.stdout).toContain('ambiguous');
  });

  it('reports empty window without error', () => {
    const result = runSpend(db, {}, now);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('no spend');
  });

  it('default group-by is project and includes a TOTAL line', () => {
    const pa = seedProject(db, { name: 'alpha' });
    const pb = seedProject(db, { name: 'beta' });
    const da = seedDirective(db, { projectId: pa.id });
    const dbd = seedDirective(db, { projectId: pb.id });
    seedUsage(db, 0, { directiveId: da, costUsd: 1.0 });
    seedUsage(db, 1, { directiveId: da, costUsd: 0.5 });
    seedUsage(db, 2, { directiveId: dbd, costUsd: 2.0 });

    const result = runSpend(db, {}, now);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('PROJECT');
    expect(result.stdout).toContain('alpha');
    expect(result.stdout).toContain('beta');
    // Totals line: 3 calls, $3.50.
    expect(result.stdout).toContain('TOTAL');
    expect(result.stdout).toContain('3 calls');
    expect(result.stdout).toContain('$3.5000');
  });

  it('--group-by directive renders per-directive rows', () => {
    const p = seedProject(db, { name: 'alpha' });
    const d1 = seedDirective(db, { projectId: p.id });
    const d2 = seedDirective(db, { projectId: p.id });
    seedUsage(db, 0, { directiveId: d1, costUsd: 1.0, calledAt: '2026-04-21T08:00:00.000Z' });
    seedUsage(db, 1, { directiveId: d1, costUsd: 0.5, calledAt: '2026-04-21T08:30:00.000Z' });
    seedUsage(db, 2, { directiveId: d2, costUsd: 2.0, calledAt: '2026-04-21T09:00:00.000Z' });

    const result = runSpend(db, { groupBy: 'directive' }, now);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('DIRECTIVE');
    expect(result.stdout).toContain(d1);
    expect(result.stdout).toContain(d2);
    expect(result.stdout).toContain('alpha');
    // Short ISO: 'YYYY-MM-DD HH:MMZ'.
    expect(result.stdout).toContain('2026-04-21 08:00Z');
    expect(result.stdout).toContain('2026-04-21 09:00Z');
  });

  it('--group-by day renders one row per UTC calendar date', () => {
    const d = seedDirective(db);
    seedUsage(db, 0, { directiveId: d, costUsd: 1.0, calledAt: '2026-04-10T12:00:00.000Z' });
    seedUsage(db, 1, { directiveId: d, costUsd: 2.0, calledAt: '2026-04-11T12:00:00.000Z' });

    const result = runSpend(db, { groupBy: 'day' }, now);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('2026-04-10');
    expect(result.stdout).toContain('2026-04-11');
    expect(result.stdout).toContain('DATE');
  });

  it('--group-by model groups by provider/model and orders by spend desc', () => {
    const d = seedDirective(db);
    seedUsage(db, 0, {
      directiveId: d,
      provider: 'claude-cli',
      model: 'claude-opus-4-7',
      costUsd: 2.0,
    });
    seedUsage(db, 1, {
      directiveId: d,
      provider: 'claude-cli',
      model: 'claude-sonnet-4-6',
      costUsd: 0.5,
    });

    const result = runSpend(db, { groupBy: 'model' }, now);
    expect(result.exitCode).toBe(0);
    // Highest-spend first.
    const opusIdx = result.stdout.indexOf('claude-opus-4-7');
    const sonnetIdx = result.stdout.indexOf('claude-sonnet-4-6');
    expect(opusIdx).toBeGreaterThan(-1);
    expect(sonnetIdx).toBeGreaterThan(-1);
    expect(opusIdx).toBeLessThan(sonnetIdx);
  });

  it('--since narrows to the recent window (relative)', () => {
    const d = seedDirective(db);
    // "now" is 2026-04-21T12:00Z. --since 7d → 2026-04-14T12:00Z.
    seedUsage(db, 0, { directiveId: d, costUsd: 1.0, calledAt: '2026-04-10T00:00:00.000Z' }); // filtered
    seedUsage(db, 1, { directiveId: d, costUsd: 2.0, calledAt: '2026-04-20T00:00:00.000Z' }); // kept

    const result = runSpend(db, { groupBy: 'day', since: '7d' }, now);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).not.toContain('2026-04-10');
    expect(result.stdout).toContain('2026-04-20');
    expect(result.stdout).toContain('$2.0000');
  });

  it('--project filters rows to one project', () => {
    const pa = seedProject(db, { name: 'alpha' });
    const pb = seedProject(db, { name: 'beta' });
    const da = seedDirective(db, { projectId: pa.id });
    const dbd = seedDirective(db, { projectId: pb.id });
    seedUsage(db, 0, { directiveId: da, costUsd: 1.0 });
    seedUsage(db, 1, { directiveId: dbd, costUsd: 4.0 });

    const result = runSpend(db, { groupBy: 'day', project: 'alpha' }, now);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('$1.0000');
    expect(result.stdout).not.toContain('$4.0000');
  });

  it('--json emits NDJSON with no trailing totals object', () => {
    const p = seedProject(db, { name: 'alpha' });
    const d = seedDirective(db, { projectId: p.id });
    seedUsage(db, 0, { directiveId: d, costUsd: 1.0 });
    seedUsage(db, 1, { directiveId: d, costUsd: 0.5 });

    const result = runSpend(db, { json: true }, now);
    expect(result.exitCode).toBe(0);
    const lines = result.stdout.trim().split('\n');
    expect(lines).toHaveLength(1);
    const row = JSON.parse(lines[0] as string) as {
      projectId: string;
      projectName: string;
      display: string;
      totalUsd: number;
      callCount: number;
      directiveCount: number;
    };
    expect(row.projectId).toBe(p.id);
    expect(row.projectName).toBe('alpha');
    expect(row.totalUsd).toBeCloseTo(1.5);
    expect(row.callCount).toBe(2);
    expect(row.directiveCount).toBe(1);
    expect(row.display).toMatch(/^alpha \(…/);
  });

  it('--limit caps returned rows (clamped at 1000)', () => {
    for (let i = 0; i < 3; i++) {
      const p = seedProject(db, { name: `proj-${String(i)}` });
      const d = seedDirective(db, { projectId: p.id });
      seedUsage(db, i * 10, { directiveId: d, costUsd: (i + 1) * 0.1 });
    }

    const result = runSpend(db, { limit: '2' }, now);
    expect(result.exitCode).toBe(0);
    // Three projects seeded; limited to 2 → one of them absent.
    const matches = result.stdout.match(/proj-\d/g) ?? [];
    expect(matches.length).toBe(2);

    // limit clamped to ≥1 for nonsense values.
    const zero = runSpend(db, { limit: '0' }, now);
    expect(zero.exitCode).toBe(0);
    const oneMatches = zero.stdout.match(/proj-\d/g) ?? [];
    expect(oneMatches.length).toBe(1);
  });
});
