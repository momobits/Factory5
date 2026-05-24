/**
 * Unit tests for `createPoolResume` (Tier 15 / ADR 0034).
 *
 * Uses an in-memory SQLite DB for all state assertions.
 * Chokidar is injected via the `watcherFactory` dep so tests run without real
 * filesystem watchers. The fake watcher exposes a `triggerChange()` helper
 * that fires the `'change'` event synchronously, letting tests advance time
 * with `vi.runAllTimersAsync()`.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { newId } from '@factory5/core';
import { openDatabase, runMigrations, type Database } from '@factory5/state';

import { createPoolResume } from './pool-resume.js';

// ---------------------------------------------------------------------------
// Fake FSWatcher
// ---------------------------------------------------------------------------

/** Minimal FSWatcher stand-in that holds a `triggerChange()` helper. */
class FakeWatcher extends EventEmitter {
  closed = false;
  async close(): Promise<void> {
    this.closed = true;
    this.removeAllListeners();
  }
  /** Simulate a filesystem `change` event on the watched file. */
  triggerChange(path = 'project.json'): void {
    this.emit('change', path);
  }
}

/** Build a fake `watcherFactory` that returns a controllable `FakeWatcher`. */
function makeFakeWatcherFactory(): {
  factory: (path: string) => FakeWatcher;
  /** All watchers created so far, keyed by the path passed to the factory. */
  created: Map<string, FakeWatcher>;
} {
  const created = new Map<string, FakeWatcher>();
  const factory = (path: string): FakeWatcher => {
    const w = new FakeWatcher();
    created.set(path, w);
    return w;
  };
  return { factory, created };
}

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

function freshDb(): Database {
  const db = openDatabase(':memory:');
  runMigrations(db);
  return db;
}

/**
 * Insert a minimal directive row.
 * `projectId` is required for the pool-resume join path.
 */
function seedDirective(
  db: Database,
  opts: {
    id?: string;
    projectId: string;
    status?: string;
    blockedReason?: string | null;
    payloadBudgets?: Record<string, number>;
  },
): string {
  const id = opts.id ?? newId();
  const status = opts.status ?? 'blocked';
  const blockedReason = opts.blockedReason ?? null;
  const payload = JSON.stringify({ budgets: opts.payloadBudgets ?? {} });
  db.prepare(
    `INSERT INTO directives
       (id, source, principal, channel_ref, intent, payload_json, autonomy,
        created_at, status, blocked_reason, project_id)
     VALUES (?, 'cli', 'test', 'test-ref', 'build', ?, 'autonomous', ?, ?, ?, ?)`,
  ).run(id, payload, new Date().toISOString(), status, blockedReason, opts.projectId);
  return id;
}

/** Build a pool-exhausted blocked_reason JSON for a given axis. */
function poolExhaustedReason(axis: string, usedAtPark = 240, capAtPark = 240): string {
  return JSON.stringify({ kind: 'pool-exhausted', axis, usedAtPark, capAtPark });
}

/**
 * Seed a tasks_inflight row so that `computePoolUsage` sees real `turnsUsed`
 * for a given agent class. Required when a test needs `used > 0` in the DB.
 */
function seedTask(
  db: Database,
  opts: {
    directiveId: string;
    agent: string;
    turnsUsed: number;
  },
): void {
  const taskId = newId();
  const planId = newId();
  const resultJson = JSON.stringify({ exitCode: 0, turnsUsed: opts.turnsUsed });
  db.prepare(
    `INSERT INTO tasks_inflight
       (id, directive_id, plan_id, title, agent, category, status, attempts,
        started_at, finished_at, result_json)
     VALUES (?, ?, ?, 'task', ?, 'deep', 'complete', 1, ?, ?, ?)`,
  ).run(
    taskId,
    opts.directiveId,
    planId,
    opts.agent,
    new Date().toISOString(),
    new Date().toISOString(),
    resultJson,
  );
}

/** Write a minimal project.json with optional budgetDefaults. */
async function writeProjectJson(
  projectPath: string,
  opts: { id?: string; budgetDefaults?: Record<string, number> } = {},
): Promise<string> {
  await mkdir(join(projectPath, '.factory'), { recursive: true });
  const projectId = opts.id ?? newId();
  const meta = {
    id: projectId,
    name: 'test-project',
    createdAt: new Date().toISOString(),
    factoryVersion: '0.x',
    metadata: {
      ...(opts.budgetDefaults !== undefined ? { budgetDefaults: opts.budgetDefaults } : {}),
    },
  };
  await writeFile(join(projectPath, '.factory', 'project.json'), JSON.stringify(meta, null, 2));
  return projectId;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('pool-resume', () => {
  let db: Database;
  let projectPath: string;
  const fakeLog = { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() };

  beforeEach(async () => {
    vi.useFakeTimers();
    db = freshDb();
    projectPath = await mkdtemp(join(tmpdir(), 'factory5-poolresume-'));
    fakeLog.info.mockClear();
    fakeLog.warn.mockClear();
    fakeLog.debug.mockClear();
    fakeLog.error.mockClear();
  });

  afterEach(async () => {
    vi.useRealTimers();
    await rm(projectPath, { recursive: true, force: true });
  });

  // ---- Registration ----

  it('activeWatchers() is empty before any project is registered', () => {
    const { factory } = makeFakeWatcherFactory();
    const pr = createPoolResume({
      db,
      log: fakeLog as any,
      watcherFactory: factory,
      debounceMs: 0,
    });
    expect(pr.activeWatchers()).toHaveLength(0);
  });

  it('lazy-adds watcher on registerProject', async () => {
    const { factory } = makeFakeWatcherFactory();
    const pr = createPoolResume({
      db,
      log: fakeLog as any,
      watcherFactory: factory,
      debounceMs: 0,
    });
    await pr.registerProject(projectPath);
    expect(pr.activeWatchers()).toHaveLength(1);
    expect(pr.activeWatchers()[0]).toBe(projectPath);
    await pr.shutdown();
  });

  it('tears down watcher on unregisterProject', async () => {
    const { factory, created } = makeFakeWatcherFactory();
    const pr = createPoolResume({
      db,
      log: fakeLog as any,
      watcherFactory: factory,
      debounceMs: 0,
    });
    await pr.registerProject(projectPath);
    const target = join(projectPath, '.factory', 'project.json');
    const watcher = created.get(target);
    expect(watcher).toBeDefined();

    await pr.unregisterProject(projectPath);
    expect(pr.activeWatchers()).toHaveLength(0);
    expect(watcher!.closed).toBe(true);
  });

  // ---- Re-check on change ----

  it('flips parked directive to running when project.json cap is raised above used', async () => {
    // Write project.json with low cap (below used, so directive stays parked initially)
    const projectId = await writeProjectJson(projectPath, {
      budgetDefaults: { maxTurnsBuilder: 240 },
    });

    // Seed a parked directive for that project (used=240, cap=240 → exhausted)
    const directiveId = seedDirective(db, {
      projectId,
      status: 'blocked',
      blockedReason: poolExhaustedReason('maxTurnsBuilder', 240, 240),
    });

    const { factory, created } = makeFakeWatcherFactory();
    const pr = createPoolResume({
      db,
      log: fakeLog as any,
      watcherFactory: factory,
      debounceMs: 0,
    });

    await pr.registerProject(projectPath);

    // Operator raises cap in project.json
    await writeProjectJson(projectPath, {
      id: projectId,
      budgetDefaults: { maxTurnsBuilder: 500 },
    });

    // Trigger the watcher change event
    const target = join(projectPath, '.factory', 'project.json');
    const watcher = created.get(target)!;
    watcher.triggerChange();

    // Advance timers to flush debounce (debounceMs=0 → immediate), then await async recheck
    await vi.runAllTimersAsync();
    await pr.flush();

    const row = db
      .prepare('SELECT status, blocked_reason FROM directives WHERE id = ?')
      .get(directiveId) as { status: string; blocked_reason: string | null };
    expect(row.status).toBe('running');
    expect(row.blocked_reason).toBeNull();

    await pr.shutdown();
  });

  it('leaves parked directive blocked when raised cap is still below used', async () => {
    // Write project.json where cap (100) is still below used (240)
    const projectId = await writeProjectJson(projectPath, {
      budgetDefaults: { maxTurnsBuilder: 100 },
    });

    const directiveId = seedDirective(db, {
      projectId,
      status: 'blocked',
      blockedReason: poolExhaustedReason('maxTurnsBuilder', 240, 240),
    });

    // Seed actual builder tasks so computePoolUsage sees used=240 in the DB.
    // Without tasks, used would be 0 and the directive would flip incorrectly.
    seedTask(db, { directiveId, agent: 'builder', turnsUsed: 240 });

    const { factory, created } = makeFakeWatcherFactory();
    const pr = createPoolResume({
      db,
      log: fakeLog as any,
      watcherFactory: factory,
      debounceMs: 0,
    });

    await pr.registerProject(projectPath);

    // Cap is only raised to 100 — still below the 240 used
    const target = join(projectPath, '.factory', 'project.json');
    const watcher = created.get(target)!;
    watcher.triggerChange();
    await vi.runAllTimersAsync();
    await pr.flush();

    const row = db.prepare('SELECT status FROM directives WHERE id = ?').get(directiveId) as {
      status: string;
    };
    expect(row.status).toBe('blocked');

    await pr.shutdown();
  });

  it('flips multiple parked directives on the same project in one watcher tick', async () => {
    const projectId = await writeProjectJson(projectPath, {
      budgetDefaults: { maxTurnsBuilder: 500 },
    });

    // Three parked directives on the same project
    const ids = [
      seedDirective(db, {
        projectId,
        blockedReason: poolExhaustedReason('maxTurnsBuilder', 240, 240),
      }),
      seedDirective(db, {
        projectId,
        blockedReason: poolExhaustedReason('maxTurnsBuilder', 240, 240),
      }),
      seedDirective(db, {
        projectId,
        blockedReason: poolExhaustedReason('maxTurnsBuilder', 240, 240),
      }),
    ];

    const { factory, created } = makeFakeWatcherFactory();
    const pr = createPoolResume({
      db,
      log: fakeLog as any,
      watcherFactory: factory,
      debounceMs: 0,
    });

    await pr.registerProject(projectPath);

    const target = join(projectPath, '.factory', 'project.json');
    created.get(target)!.triggerChange();
    await vi.runAllTimersAsync();
    await pr.flush();

    for (const id of ids) {
      const row = db.prepare('SELECT status FROM directives WHERE id = ?').get(id) as {
        status: string;
      };
      expect(row.status).toBe('running');
    }

    await pr.shutdown();
  });

  it('does not affect directives on other projects', async () => {
    const projectIdA = await writeProjectJson(projectPath, {
      budgetDefaults: { maxTurnsBuilder: 500 },
    });

    // Project B — a different temp directory
    const projectPathB = await mkdtemp(join(tmpdir(), 'factory5-poolresume-b-'));
    try {
      const projectIdB = await writeProjectJson(projectPathB, {
        budgetDefaults: { maxTurnsBuilder: 100 }, // still below used=240
      });

      const idA = seedDirective(db, {
        projectId: projectIdA,
        blockedReason: poolExhaustedReason('maxTurnsBuilder', 240, 240),
      });
      const idB = seedDirective(db, {
        projectId: projectIdB,
        blockedReason: poolExhaustedReason('maxTurnsBuilder', 240, 240),
      });

      const { factory, created } = makeFakeWatcherFactory();
      const pr = createPoolResume({
        db,
        log: fakeLog as any,
        watcherFactory: factory,
        debounceMs: 0,
      });

      // Only register project A
      await pr.registerProject(projectPath);

      const target = join(projectPath, '.factory', 'project.json');
      created.get(target)!.triggerChange();
      await vi.runAllTimersAsync();
      await pr.flush();

      // Project A's directive should be flipped
      const rowA = db.prepare('SELECT status FROM directives WHERE id = ?').get(idA) as {
        status: string;
      };
      expect(rowA.status).toBe('running');

      // Project B's directive must remain parked
      const rowB = db.prepare('SELECT status FROM directives WHERE id = ?').get(idB) as {
        status: string;
      };
      expect(rowB.status).toBe('blocked');

      await pr.shutdown();
    } finally {
      await rm(projectPathB, { recursive: true, force: true });
    }
  });

  it('debounces rapid project.json writes — re-check fires at most once', async () => {
    const projectId = await writeProjectJson(projectPath, {
      budgetDefaults: { maxTurnsBuilder: 500 },
    });

    const directiveId = seedDirective(db, {
      projectId,
      blockedReason: poolExhaustedReason('maxTurnsBuilder', 240, 240),
    });

    // Use debounceMs=50 so we can track call count
    let recheckCount = 0;
    const { factory, created } = makeFakeWatcherFactory();
    const pr = createPoolResume({
      db,
      log: fakeLog as any,
      watcherFactory: factory,
      debounceMs: 50,
      onRecheck: () => {
        recheckCount++;
      },
    });

    await pr.registerProject(projectPath);

    const target = join(projectPath, '.factory', 'project.json');
    const watcher = created.get(target)!;

    // Fire 5 rapid changes
    for (let i = 0; i < 5; i++) {
      watcher.triggerChange();
    }

    // Advance timer past debounce window
    await vi.advanceTimersByTimeAsync(100);
    await pr.flush();

    const row = db.prepare('SELECT status FROM directives WHERE id = ?').get(directiveId) as {
      status: string;
    };
    expect(row.status).toBe('running');
    // At most 1 recheck should have fired (not 5)
    expect(recheckCount).toBe(1);

    await pr.shutdown();
  });

  it('handles malformed project.json gracefully — logs warn and does not throw', async () => {
    // Write invalid JSON to project.json
    await mkdir(join(projectPath, '.factory'), { recursive: true });
    await writeFile(join(projectPath, '.factory', 'project.json'), '{ not valid json !!!');

    const { factory, created } = makeFakeWatcherFactory();
    const pr = createPoolResume({
      db,
      log: fakeLog as any,
      watcherFactory: factory,
      debounceMs: 0,
    });

    await pr.registerProject(projectPath);

    const target = join(projectPath, '.factory', 'project.json');
    created.get(target)!.triggerChange();
    await vi.runAllTimersAsync();
    await pr.flush();

    // Should log a warn and not throw
    expect(fakeLog.warn).toHaveBeenCalledWith(
      expect.objectContaining({ projectPath }),
      expect.stringContaining('pool-resume'),
    );

    await pr.shutdown();
  });
});
