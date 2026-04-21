/**
 * Regression for ADR 0020 step 7a.7 — "synthetic build hits the
 * `max_usd` ceiling → clean escalation (not a mid-task half-failure)".
 *
 * We pre-seed the directive's `model_usage` history so the rolling
 * average + running total push the NEXT projected call over the
 * configured `maxUsd`. `runPlanPool` then refuses to dispatch the
 * first task, marks every pending task blocked, re-raises
 * `BudgetExceededError` — never touches the stub provider.
 *
 * The ask is: no `tasks_inflight` rows left running, plan persisted
 * with `status = abandoned`, and the error's blocked-reason string
 * usefully names the ceiling and the spent amount. If this ever
 * starts running the stub, the dispatch-time check silently slipped.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { newId, type Plan, type Task } from '@factory5/core';
import { buildStubRegistry } from '@factory5/brain';
import {
  modelUsage,
  openDatabase,
  runMigrations,
  tasksInflight,
  type Database,
} from '@factory5/state';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { BudgetExceededError } from './budget.js';
import { runPlanPool } from './pool.js';

function freshDb(): Database {
  const db = openDatabase(':memory:');
  runMigrations(db);
  return db;
}

function ensureDirective(
  db: Database,
  id: string,
  limits: { maxUsd?: number; maxSteps?: number } = {},
): void {
  db.prepare(
    `INSERT INTO directives
       (id, source, principal, channel_ref, intent, payload_json, autonomy,
        created_at, status, max_usd, max_steps)
     VALUES (?, 'cli', 'u', 'r', 'build', '{}', 'autonomous', ?, 'pending', ?, ?)`,
  ).run(id, '2026-04-21T00:00:00.000Z', limits.maxUsd ?? null, limits.maxSteps ?? null);
}

function mkTask(suffix: string, dependsOn: string[] = []): Task {
  return {
    id: `01HXABCDEFGHJKMNPQRSTVWXY${suffix}`,
    planId: '01HXABCDEFGHJKMNPQRSTVWXYP',
    title: `task-${suffix}`,
    agent: 'builder',
    category: 'deep',
    inputs: { files: [], context: '' },
    expectedOutputs: { files: [`file-${suffix}.ts`], signals: [] },
    dependsOn,
    status: 'pending',
    attempts: 0,
  };
}

let projectPath: string;

beforeEach(async () => {
  projectPath = await mkdtemp(join(tmpdir(), 'factory5-budget-reg-'));
});

afterEach(async () => {
  await rm(projectPath, { recursive: true, force: true });
});

describe('runPlanPool — budget-exceeded regression (ADR 0020, step 7a.7)', () => {
  it('refuses to dispatch when pre-call estimate pushes spend past maxUsd', async () => {
    const db = freshDb();
    const registry = buildStubRegistry();
    const directiveId = '01KPR00000000000000000REG1';
    ensureDirective(db, directiveId, { maxUsd: 3.0 });

    // Pre-seed 2 rows at $2 each for (deep, stream) so:
    //   - `modelUsage.averageCostByCategory('deep','stream')` = $2
    //   - `modelUsage.totalCostForDirective(directiveId)` = $4
    //   - estimator returns the $2 rolling average (>= 2 samples)
    // First task dispatch: $4 + $2 = $6 > $3 ceiling → trip.
    for (let i = 0; i < 2; i++) {
      modelUsage.record(db, {
        id: newId(),
        directiveId,
        provider: 'stub',
        model: 'stub',
        category: 'deep',
        mode: 'stream',
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 2.0,
        durationMs: 0,
        calledAt: new Date(1_714_000_000_000 + i * 1_000).toISOString(),
      });
    }

    const plan: Plan = {
      id: '01HXABCDEFGHJKMNPQRSTVWXYP',
      directiveId,
      projectPath,
      tasks: [mkTask('1'), mkTask('2'), mkTask('3')],
      createdAt: '2026-04-21T00:00:00.000Z',
      status: 'ready',
    };

    let caught: unknown;
    try {
      await runPlanPool({
        plan,
        registry,
        db,
        directiveId,
        limits: { maxUsd: 3.0 },
        concurrency: 2,
      });
    } catch (err) {
      caught = err;
    }

    // The pool re-raises after draining — confirm shape and detail.
    expect(caught).toBeInstanceOf(BudgetExceededError);
    if (caught instanceof BudgetExceededError) {
      expect(caught.detail.kind).toBe('budget_exceeded_usd');
      expect(caught.detail.ceiling).toBe(3.0);
      expect(caught.detail.spentSoFar).toBeCloseTo(4.0);
      expect(caught.detail.estimatedCost).toBeCloseTo(2.0);
      expect(caught.detail.agent).toBe('builder');
      expect(caught.message).toMatch(/^budget_exceeded_usd:/);
    }

    // Pool wrote an abandoned plan.json — none of the tasks ran.
    const { readPlan } = await import('@factory5/wiki');
    const persisted = await readPlan(projectPath);
    expect(persisted?.status).toBe('abandoned');

    // No tasks_inflight rows were ever registered — the dispatch bailed
    // BEFORE any runWorker call, which is the whole point of pre-call
    // enforcement. If this ever populates, we've slipped into a
    // post-call tripwire mode that violates the ADR's contract.
    const running = db
      .prepare('SELECT COUNT(*) AS c FROM tasks_inflight WHERE directive_id = ?')
      .get(directiveId) as { c: number };
    expect(running.c).toBe(0);
  });

  it('refuses to dispatch when the step count would exceed maxSteps', async () => {
    const db = freshDb();
    const registry = buildStubRegistry();
    const directiveId = '01KPR00000000000000000REG2';
    ensureDirective(db, directiveId, { maxSteps: 2 });

    // 2 prior calls — next dispatch would be call #3, trips maxSteps=2.
    for (let i = 0; i < 2; i++) {
      modelUsage.record(db, {
        id: newId(),
        directiveId,
        provider: 'stub',
        model: 'stub',
        category: 'deep',
        mode: 'stream',
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0.01,
        durationMs: 0,
        calledAt: new Date(1_714_000_000_000 + i * 1_000).toISOString(),
      });
    }

    const plan: Plan = {
      id: '01HXABCDEFGHJKMNPQRSTVWXYQ',
      directiveId,
      projectPath,
      tasks: [mkTask('7')],
      createdAt: '2026-04-21T00:00:00.000Z',
      status: 'ready',
    };

    let caught: unknown;
    try {
      await runPlanPool({
        plan,
        registry,
        db,
        directiveId,
        limits: { maxSteps: 2 },
      });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(BudgetExceededError);
    if (caught instanceof BudgetExceededError) {
      expect(caught.detail.kind).toBe('budget_exceeded_steps');
      expect(caught.detail.ceiling).toBe(2);
      expect(caught.detail.callsMadeSoFar).toBe(2);
    }

    // Historical sanity: tasksInflight.* never saw a row for the aborted task.
    const running = tasksInflight
      ? (db.prepare('SELECT COUNT(*) AS c FROM tasks_inflight').get() as { c: number })
      : { c: -1 };
    expect(running.c).toBe(0);
  });

  it('dispatches normally when limits are defined but not breached', async () => {
    const db = freshDb();
    const registry = buildStubRegistry();
    const directiveId = '01KPR00000000000000000REG3';
    ensureDirective(db, directiveId, { maxUsd: 100.0, maxSteps: 100 });

    // No prior spend; estimator falls back to DEFAULT_CATEGORY_COST.deep.stream = $2.
    // 0 + 2 < 100 — should not trip.
    const plan: Plan = {
      id: '01HXABCDEFGHJKMNPQRSTVWXYR',
      directiveId,
      projectPath,
      tasks: [mkTask('9')],
      createdAt: '2026-04-21T00:00:00.000Z',
      status: 'ready',
    };

    // The stub provider will be invoked for the one task. runWorker will
    // try to allocate a worktree; that requires the project dir to be a
    // git repo. We don't care whether the task succeeds — only that the
    // pool does NOT throw BudgetExceededError. If the worker fails for
    // unrelated reasons (no git repo), the test still passes on that
    // criterion.
    let budgetError: BudgetExceededError | undefined;
    try {
      await runPlanPool({
        plan,
        registry,
        db,
        directiveId,
        limits: { maxUsd: 100.0, maxSteps: 100 },
      });
    } catch (err) {
      if (err instanceof BudgetExceededError) budgetError = err;
      // Other errors are fine — we only care that BudgetExceededError
      // did not fire.
    }
    expect(budgetError).toBeUndefined();
  });
});
