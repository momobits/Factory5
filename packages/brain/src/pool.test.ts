import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Finding, Task } from '@factory5/core';
import { newId } from '@factory5/core';
import type { DirectiveStreamEvent } from '@factory5/ipc';
import { openDatabase, runMigrations, tasksInflight, type Database } from '@factory5/state';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  bumpProjectCap,
  defaultConcurrency,
  emitFindingCreated,
  parkOrAutoIncrease,
  topoSortTasks,
} from './pool.js';
import type { ProjectBudgetsLike } from './pool-usage.js';

const BASE_ULID = '01HXABCDEFGHJKMNPQRSTVWXY0';
const SAMPLE_DIRECTIVE_ID = '01HZZZZZZZZZZZZZZZZZZZZZZA';

function mkTask(idSuffix: number, dependsOn: string[] = []): Task {
  const id = (BASE_ULID.slice(0, -1) + idSuffix.toString()).toUpperCase();
  return {
    id,
    planId: BASE_ULID.slice(0, -1) + 'P',
    title: `task-${idSuffix}`,
    agent: 'builder',
    category: 'deep',
    inputs: { files: [], context: '' },
    expectedOutputs: { files: [], signals: [] },
    dependsOn,
    status: 'pending',
    attempts: 0,
  };
}

function mkFinding(overrides: Partial<Finding> = {}): Finding {
  const base: Finding = {
    id: 'F001',
    source: 'builder',
    target: 'src/widget.ts',
    severity: 'major',
    status: 'OPEN',
    description: 'function exits non-zero on empty input',
    createdAt: '2026-05-03T16:30:00.000Z',
  };
  return { ...base, ...overrides };
}

describe('topoSortTasks', () => {
  it('returns tasks in dependency order', () => {
    const a = mkTask(1, []);
    const b = mkTask(2, [a.id]);
    const c = mkTask(3, [a.id, b.id]);
    const order = topoSortTasks([c, b, a]);
    expect(order.map((t) => t.id)).toEqual([a.id, b.id, c.id]);
  });

  it('throws on a dependency cycle', () => {
    const a = mkTask(1, []);
    const b = mkTask(2, [a.id]);
    // cycle: a -> b -> a
    const aCyclic = { ...a, dependsOn: [b.id] };
    expect(() => topoSortTasks([aCyclic, b])).toThrow(/cycle/i);
  });

  it('tolerates unknown deps (treats them as no-op edges)', () => {
    const a = mkTask(1, ['ZZZZZZZZZZZZZZZZZZZZZZZZZZ']);
    const order = topoSortTasks([a]);
    expect(order.map((t) => t.id)).toEqual([a.id]);
  });
});

describe('defaultConcurrency', () => {
  it('returns a positive integer capped at 4', () => {
    const c = defaultConcurrency();
    expect(c).toBeGreaterThanOrEqual(1);
    expect(c).toBeLessThanOrEqual(4);
    expect(Number.isInteger(c)).toBe(true);
  });
});

describe('emitFindingCreated', () => {
  it('is silent when no emitter is wired', () => {
    expect(() => emitFindingCreated(undefined, SAMPLE_DIRECTIVE_ID, mkFinding())).not.toThrow();
  });

  it('forwards a well-formed finding.created event with advisory=false when finding.advisory is undefined', () => {
    const events: DirectiveStreamEvent[] = [];
    const emit = vi.fn((event: DirectiveStreamEvent) => events.push(event));

    emitFindingCreated(emit, SAMPLE_DIRECTIVE_ID, mkFinding());

    expect(emit).toHaveBeenCalledTimes(1);
    expect(events).toHaveLength(1);
    const event = events[0]!;
    expect(event.type).toBe('finding.created');
    if (event.type !== 'finding.created') return; // narrow
    expect(event.findingId).toBe('F001');
    expect(event.directiveId).toBe(SAMPLE_DIRECTIVE_ID);
    expect(event.severity).toBe('major');
    expect(event.status).toBe('OPEN');
    expect(event.source).toBe('builder');
    expect(event.target).toBe('src/widget.ts');
    expect(event.description).toBe('function exits non-zero on empty input');
    expect(event.advisory).toBe(false);
  });

  it('forwards advisory=true when the finding carries advisory: true', () => {
    const events: DirectiveStreamEvent[] = [];
    const emit = (event: DirectiveStreamEvent): void => {
      events.push(event);
    };

    emitFindingCreated(
      emit,
      SAMPLE_DIRECTIVE_ID,
      mkFinding({
        id: 'F042',
        source: 'verifier',
        severity: 'minor',
        advisory: true,
      }),
    );

    expect(events).toHaveLength(1);
    const event = events[0]!;
    expect(event.type).toBe('finding.created');
    if (event.type !== 'finding.created') return;
    expect(event.findingId).toBe('F042');
    expect(event.source).toBe('verifier');
    expect(event.severity).toBe('minor');
    expect(event.advisory).toBe(true);
  });

  it('emits one event per call (caller drives the per-finding loop)', () => {
    const events: DirectiveStreamEvent[] = [];
    const emit = (event: DirectiveStreamEvent): void => {
      events.push(event);
    };

    const findings: Finding[] = [
      mkFinding({ id: 'F001', target: 'src/a.ts' }),
      mkFinding({ id: 'F002', target: 'src/b.ts', advisory: true }),
      mkFinding({ id: 'F003', target: 'src/c.ts', severity: 'critical' }),
    ];
    for (const f of findings) emitFindingCreated(emit, SAMPLE_DIRECTIVE_ID, f);

    expect(events).toHaveLength(3);
    const ids = events.flatMap((e) => (e.type === 'finding.created' ? [e.findingId] : []));
    expect(ids).toEqual(['F001', 'F002', 'F003']);
  });
});

// ---------------------------------------------------------------------------
// Tier 15 / ADR 0034 — pool-driven dispatcher helpers
// ---------------------------------------------------------------------------

function freshDb(): Database {
  const db = openDatabase(':memory:');
  runMigrations(db);
  return db;
}

function seedDirective(
  db: Database,
  id: string,
  opts: { status?: string; blockedReason?: string | null } = {},
): void {
  db.prepare(
    `INSERT INTO directives
       (id, source, principal, channel_ref, intent, payload_json, autonomy,
        created_at, status, blocked_reason)
     VALUES (?, 'cli', 'test', 'test-ref', 'build', '{}', 'autonomous', ?, ?, ?)`,
  ).run(id, new Date().toISOString(), opts.status ?? 'running', opts.blockedReason ?? null);
}

async function writeProjectJson(
  projectPath: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  const dir = join(projectPath, '.factory');
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, 'project.json'),
    JSON.stringify(
      {
        id: '01KSBR000000000000000000PR',
        name: 'pool-test',
        createdAt: '2026-05-24T00:00:00.000Z',
        factoryVersion: '0.x',
        metadata,
      },
      null,
      2,
    ),
    'utf8',
  );
}

describe('bumpProjectCap', () => {
  let projectPath: string;
  beforeEach(async () => {
    projectPath = await mkdtemp(join(tmpdir(), 'factory5-pool-bump-'));
  });
  afterEach(async () => {
    await rm(projectPath, { recursive: true, force: true });
  });

  it('writes the new cap into project.json metadata.budgetDefaults', async () => {
    await writeProjectJson(projectPath, { budgetDefaults: { maxTurnsBuilder: 80 } });
    await bumpProjectCap(projectPath, 'maxTurnsBuilder', 160);
    const raw = await readFile(join(projectPath, '.factory', 'project.json'), 'utf8');
    const parsed = JSON.parse(raw);
    expect(parsed.metadata.budgetDefaults.maxTurnsBuilder).toBe(160);
  });

  it('preserves other budgetDefaults axes on write', async () => {
    await writeProjectJson(projectPath, {
      budgetDefaults: { maxTurnsBuilder: 80, maxTurnsScaffolder: 120, maxUsd: 50 },
    });
    await bumpProjectCap(projectPath, 'maxTurnsBuilder', 160);
    const raw = await readFile(join(projectPath, '.factory', 'project.json'), 'utf8');
    const parsed = JSON.parse(raw);
    expect(parsed.metadata.budgetDefaults.maxTurnsBuilder).toBe(160);
    expect(parsed.metadata.budgetDefaults.maxTurnsScaffolder).toBe(120);
    expect(parsed.metadata.budgetDefaults.maxUsd).toBe(50);
  });

  it('preserves unrelated metadata keys on write', async () => {
    await writeProjectJson(projectPath, {
      budgetDefaults: { maxTurnsBuilder: 80 },
      language: 'python',
      customKey: 'custom-value',
    });
    await bumpProjectCap(projectPath, 'maxTurnsBuilder', 160);
    const raw = await readFile(join(projectPath, '.factory', 'project.json'), 'utf8');
    const parsed = JSON.parse(raw);
    expect(parsed.metadata.language).toBe('python');
    expect(parsed.metadata.customKey).toBe('custom-value');
  });
});

describe('parkOrAutoIncrease', () => {
  let projectPath: string;
  let db: Database;

  beforeEach(async () => {
    db = freshDb();
    projectPath = await mkdtemp(join(tmpdir(), 'factory5-pool-park-'));
    await writeProjectJson(projectPath, {
      budgetDefaults: { maxTurnsBuilder: 80 },
    });
  });

  afterEach(async () => {
    await rm(projectPath, { recursive: true, force: true });
  });

  it('parks the directive with structured blocked_reason when auto-increase is off (default)', async () => {
    const directiveId = newId();
    seedDirective(db, directiveId);
    const projectBudgets: ProjectBudgetsLike = { budgetDefaults: { maxTurnsBuilder: 80 } };
    const events: DirectiveStreamEvent[] = [];

    const result = await parkOrAutoIncrease({
      db,
      directiveId,
      projectPath,
      axis: 'maxTurnsBuilder',
      pool: { perAxis: { maxTurnsBuilder: { used: 80, cap: 80 } } as never },
      projectBudgets,
      emit: (e) => events.push(e),
    });

    expect(result.kind).toBe('parked');
    const row = db
      .prepare(`SELECT status, blocked_reason FROM directives WHERE id = ?`)
      .get(directiveId) as { status: string; blocked_reason: string };
    expect(row.status).toBe('blocked');
    const reason = JSON.parse(row.blocked_reason);
    expect(reason.kind).toBe('pool-exhausted');
    expect(reason.axis).toBe('maxTurnsBuilder');
    expect(reason.usedAtPark).toBe(80);
    expect(reason.capAtPark).toBe(80);
    // Park log line emitted.
    const warn = events.find((e) => e.type === 'log.line' && e.level === 'warn');
    expect(warn).toBeDefined();
  });

  it('auto-bumps the project cap when autoIncreaseBudgets=true and below ceiling', async () => {
    const directiveId = newId();
    seedDirective(db, directiveId);
    const projectBudgets: ProjectBudgetsLike = {
      budgetDefaults: { maxTurnsBuilder: 80 },
      autoIncreaseBudgets: true,
      autoIncreaseCeilingMultiplier: 5,
    };
    const events: DirectiveStreamEvent[] = [];

    const result = await parkOrAutoIncrease({
      db,
      directiveId,
      projectPath,
      axis: 'maxTurnsBuilder',
      pool: { perAxis: { maxTurnsBuilder: { used: 80, cap: 80 } } as never },
      projectBudgets,
      emit: (e) => events.push(e),
    });

    expect(result.kind).toBe('bumped');
    if (result.kind === 'bumped') {
      expect(result.oldCap).toBe(80);
      // +BUDGET_DEFAULTS.maxTurnsBuilder.value = 80 → 160
      expect(result.newCap).toBe(160);
    }
    // Directive is NOT parked when we auto-bumped.
    const row = db.prepare(`SELECT status FROM directives WHERE id = ?`).get(directiveId) as {
      status: string;
    };
    expect(row.status).toBe('running');
    // project.json was updated.
    const raw = await readFile(join(projectPath, '.factory', 'project.json'), 'utf8');
    expect(JSON.parse(raw).metadata.budgetDefaults.maxTurnsBuilder).toBe(160);
  });

  it('parks instead of bumping when current cap is at or above the safety ceiling', async () => {
    const directiveId = newId();
    seedDirective(db, directiveId);
    // ceiling = projectCap * multiplier = 80 * 5 = 400
    // Already-bumped to 400 — next bump would cross ceiling, so park.
    await writeProjectJson(projectPath, {
      budgetDefaults: { maxTurnsBuilder: 80 },
    });
    const projectBudgets: ProjectBudgetsLike = {
      budgetDefaults: { maxTurnsBuilder: 80 },
      autoIncreaseBudgets: true,
      autoIncreaseCeilingMultiplier: 5,
    };

    const result = await parkOrAutoIncrease({
      db,
      directiveId,
      projectPath,
      axis: 'maxTurnsBuilder',
      pool: { perAxis: { maxTurnsBuilder: { used: 400, cap: 400 } } as never },
      projectBudgets,
    });

    expect(result.kind).toBe('parked');
    const row = db.prepare(`SELECT status FROM directives WHERE id = ?`).get(directiveId) as {
      status: string;
    };
    expect(row.status).toBe('blocked');
  });

  it('uses default multiplier of 5 when autoIncreaseCeilingMultiplier is unset', async () => {
    const directiveId = newId();
    seedDirective(db, directiveId);
    const projectBudgets: ProjectBudgetsLike = {
      budgetDefaults: { maxTurnsBuilder: 80 },
      autoIncreaseBudgets: true,
      // autoIncreaseCeilingMultiplier intentionally omitted
    };

    // ceiling = 80 * 5 = 400. Currently at 320 — bump would land 400 (== ceiling).
    // Since `currentCap < ceiling` strict, 320 < 400 → bump.
    const result = await parkOrAutoIncrease({
      db,
      directiveId,
      projectPath,
      axis: 'maxTurnsBuilder',
      pool: { perAxis: { maxTurnsBuilder: { used: 320, cap: 320 } } as never },
      projectBudgets,
    });

    expect(result.kind).toBe('bumped');
    if (result.kind === 'bumped') {
      expect(result.newCap).toBe(400);
    }
  });

  it('writes parkedReason with correct usedAtPark and capAtPark for non-trivial values', async () => {
    const directiveId = newId();
    seedDirective(db, directiveId);
    const projectBudgets: ProjectBudgetsLike = { budgetDefaults: { maxTurnsBuilder: 80 } };

    await parkOrAutoIncrease({
      db,
      directiveId,
      projectPath,
      axis: 'maxTurnsBuilder',
      pool: { perAxis: { maxTurnsBuilder: { used: 95, cap: 100 } } as never },
      projectBudgets,
    });

    const row = db
      .prepare(`SELECT blocked_reason FROM directives WHERE id = ?`)
      .get(directiveId) as { blocked_reason: string };
    const reason = JSON.parse(row.blocked_reason);
    expect(reason.usedAtPark).toBe(95);
    expect(reason.capAtPark).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// Regression test — auto-bump recursion UNIQUE constraint fix (Tier 15.7)
// ---------------------------------------------------------------------------

describe('auto-bump recursion: deleteById prevents UNIQUE constraint on re-register', () => {
  /**
   * Reproduces the exact SQLite sequence that `executeTaskWithBudgetGuard`
   * performs when `parkOrAutoIncrease` returns `'bumped'`:
   *
   *   1. register(task)          — first attempt, row inserted
   *   2. markFailed(task)        — pool was exhausted; mark failed (UPDATE)
   *   3. deleteById(task)        — NEW: clear the row so re-register works
   *   4. register(task, +1)      — second attempt; must not throw UNIQUE error
   *
   * Without step 3, step 4 throws `SqliteError: UNIQUE constraint failed:
   * tasks_inflight.id` and the auto-bump feature ships silently broken.
   */
  it('allows re-register of the same task id after markFailed + deleteById', () => {
    const db = freshDb();
    const directiveId = newId();
    seedDirective(db, directiveId);

    const taskId = newId();
    const baseTask = {
      id: taskId,
      directiveId,
      planId: 'plan-1',
      title: 'builder-task',
      agent: 'builder' as const,
      category: 'deep' as const,
      status: 'running' as const,
      attempts: 0,
      startedAt: '2026-05-24T00:00:00.000Z',
      lastHeartbeat: '2026-05-24T00:00:00.000Z',
    };

    // Step 1: first attempt — register the task.
    tasksInflight.register(db, baseTask);
    expect(tasksInflight.getById(db, taskId)?.attempts).toBe(0);
    expect(tasksInflight.getById(db, taskId)?.status).toBe('running');

    // Step 2: pool exhausted — mark the row failed (mirrors pool.ts behaviour).
    const failResult = {
      exitCode: 1,
      filesChanged: [],
      findingsRaised: [],
      signalsEmitted: [],
      error: 'pool exhausted on maxTurnsBuilder at cap 80 — directive parked',
      errorSubtype: 'pool-exhausted' as const,
      durationMs: 0,
    };
    tasksInflight.markFailed(db, taskId, failResult, '2026-05-24T00:00:01.000Z');
    expect(tasksInflight.getById(db, taskId)?.status).toBe('failed');

    // Step 3: deleteById — remove the stale failed row (the fix).
    tasksInflight.deleteById(db, taskId);
    expect(tasksInflight.getById(db, taskId)).toBeUndefined();

    // Step 4: second attempt — re-register with incremented attempts; must
    // not throw a UNIQUE constraint error.
    expect(() =>
      tasksInflight.register(db, {
        ...baseTask,
        status: 'running',
        attempts: 1,
        startedAt: '2026-05-24T00:00:02.000Z',
        lastHeartbeat: '2026-05-24T00:00:02.000Z',
      }),
    ).not.toThrow();

    // The row now reflects the second attempt.
    const row = tasksInflight.getById(db, taskId);
    expect(row).toBeDefined();
    expect(row?.status).toBe('running');
    expect(row?.attempts).toBe(1);
  });

  it('without deleteById the re-register throws UNIQUE constraint (documents the bug)', () => {
    const db = freshDb();
    const directiveId = newId();
    seedDirective(db, directiveId);

    const taskId = newId();
    const base = {
      id: taskId,
      directiveId,
      planId: 'plan-1',
      title: 'builder-task',
      agent: 'builder' as const,
      category: 'deep' as const,
      status: 'running' as const,
      attempts: 0,
      startedAt: '2026-05-24T00:00:00.000Z',
      lastHeartbeat: '2026-05-24T00:00:00.000Z',
    };

    // Simulate first attempt.
    tasksInflight.register(db, base);
    tasksInflight.markFailed(
      db,
      taskId,
      {
        exitCode: 1,
        filesChanged: [],
        findingsRaised: [],
        signalsEmitted: [],
        durationMs: 0,
      },
      '2026-05-24T00:00:01.000Z',
    );

    // Without deleteById, re-registering the same id fails with UNIQUE error.
    expect(() => tasksInflight.register(db, { ...base, attempts: 1 })).toThrow(
      /UNIQUE constraint failed/i,
    );
  });
});
