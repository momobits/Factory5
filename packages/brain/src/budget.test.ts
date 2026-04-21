import { newId } from '@factory5/core';
import {
  modelUsage,
  openDatabase,
  runMigrations,
  type Database,
  type UsageMode,
} from '@factory5/state';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  BudgetExceededError,
  DEFAULT_CATEGORY_COST,
  assertBudget,
  estimateCostFor,
  formatBlockedReason,
} from './budget.js';

function freshDb(): Database {
  const db = openDatabase(':memory:');
  runMigrations(db);
  return db;
}

function ensureDirective(db: Database, id: string): void {
  const existing = (db.prepare('SELECT id FROM directives WHERE id = ?').get(id) ?? undefined) as
    | { id: string }
    | undefined;
  if (existing !== undefined) return;
  db.prepare(
    `INSERT INTO directives
       (id, source, principal, channel_ref, intent, payload_json, autonomy, created_at, status)
     VALUES (?, 'cli', 'u', 'r', 'build', '{}', 'autonomous', ?, 'pending')`,
  ).run(id, '2026-04-21T00:00:00.000Z');
}

function seedCall(
  db: Database,
  directiveId: string,
  costUsd: number,
  i: number,
  mode: UsageMode = 'stream',
  opts: { error?: string } = {},
): void {
  ensureDirective(db, directiveId);
  modelUsage.record(db, {
    id: newId(),
    directiveId,
    provider: 'stub',
    model: 'stub',
    category: 'reasoning',
    inputTokens: 0,
    outputTokens: 0,
    costUsd,
    durationMs: 0,
    calledAt: new Date(1_714_000_000_000 + i * 1_000).toISOString(),
    mode,
    ...(opts.error !== undefined ? { error: opts.error } : {}),
  });
}

describe('estimateCostFor', () => {
  it('returns the baked-in default when fewer than 2 samples exist', () => {
    const db = freshDb();
    expect(estimateCostFor(db, 'reasoning', 'stream')).toBeCloseTo(
      DEFAULT_CATEGORY_COST.reasoning.stream,
    );
    // One sample is still "cold" — one outlier would dominate the mean.
    seedCall(db, 'd1', 10.0, 0);
    expect(estimateCostFor(db, 'reasoning', 'stream')).toBeCloseTo(
      DEFAULT_CATEGORY_COST.reasoning.stream,
    );
  });

  it('returns the rolling average once there are 2+ samples', () => {
    const db = freshDb();
    seedCall(db, 'd1', 1.0, 0);
    seedCall(db, 'd1', 3.0, 1);
    expect(estimateCostFor(db, 'reasoning', 'stream')).toBeCloseTo(2.0);
  });

  it('buckets by mode — call vs stream do not pool', () => {
    const db = freshDb();
    seedCall(db, 'd1', 0.05, 0, 'call');
    seedCall(db, 'd1', 0.15, 1, 'call');
    seedCall(db, 'd1', 2.0, 2, 'stream');
    seedCall(db, 'd1', 3.0, 3, 'stream');
    expect(estimateCostFor(db, 'reasoning', 'call')).toBeCloseTo(0.1);
    expect(estimateCostFor(db, 'reasoning', 'stream')).toBeCloseTo(2.5);
  });

  it('excludes error rows from the rolling average', () => {
    const db = freshDb();
    seedCall(db, 'd1', 2.0, 0);
    seedCall(db, 'd1', 2.0, 1);
    seedCall(db, 'd1', 0.01, 2, 'stream', { error: 'subprocess died' });
    expect(estimateCostFor(db, 'reasoning', 'stream')).toBeCloseTo(2.0);
  });
});

describe('assertBudget', () => {
  let db: Database;
  beforeEach(() => {
    db = freshDb();
  });

  it('is a no-op when both maxUsd and maxSteps are undefined', () => {
    ensureDirective(db, 'd1');
    expect(() =>
      assertBudget({
        db,
        directiveId: 'd1',
        category: 'reasoning',
        mode: 'stream',
        agent: 'builder',
      }),
    ).not.toThrow();
  });

  it('throws budget_exceeded_steps when the next call would overshoot maxSteps', () => {
    ensureDirective(db, 'd1');
    // Seed 3 calls, set maxSteps=3 → 4th call would trip.
    seedCall(db, 'd1', 0.5, 0);
    seedCall(db, 'd1', 0.5, 1);
    seedCall(db, 'd1', 0.5, 2);
    try {
      assertBudget({
        db,
        directiveId: 'd1',
        maxSteps: 3,
        category: 'reasoning',
        mode: 'stream',
        agent: 'builder',
      });
      expect.fail('expected BudgetExceededError');
    } catch (err) {
      expect(err).toBeInstanceOf(BudgetExceededError);
      if (err instanceof BudgetExceededError) {
        expect(err.detail.kind).toBe('budget_exceeded_steps');
        expect(err.detail.ceiling).toBe(3);
        expect(err.detail.callsMadeSoFar).toBe(3);
      }
    }
  });

  it('throws budget_exceeded_usd when spent + estimate > maxUsd', () => {
    ensureDirective(db, 'd1');
    // Seed enough samples so the estimator uses rolling avg ($2.0 per call).
    seedCall(db, 'd1', 2.0, 0);
    seedCall(db, 'd1', 2.0, 1);
    // totalCostForDirective = $4; ceiling = $5; estimate = $2 → 4+2 > 5 trips.
    try {
      assertBudget({
        db,
        directiveId: 'd1',
        maxUsd: 5.0,
        category: 'reasoning',
        mode: 'stream',
        agent: 'builder',
      });
      expect.fail('expected BudgetExceededError');
    } catch (err) {
      expect(err).toBeInstanceOf(BudgetExceededError);
      if (err instanceof BudgetExceededError) {
        expect(err.detail.kind).toBe('budget_exceeded_usd');
        expect(err.detail.ceiling).toBe(5.0);
        expect(err.detail.spentSoFar).toBeCloseTo(4.0);
        expect(err.detail.estimatedCost).toBeCloseTo(2.0);
      }
    }
  });

  it('permits a call that fits under maxUsd after the estimate', () => {
    ensureDirective(db, 'd1');
    seedCall(db, 'd1', 1.0, 0);
    seedCall(db, 'd1', 1.0, 1);
    // Spent $2, estimate $1, ceiling $5 → 2+1=3 < 5. Allowed.
    expect(() =>
      assertBudget({
        db,
        directiveId: 'd1',
        maxUsd: 5.0,
        category: 'reasoning',
        mode: 'stream',
        agent: 'builder',
      }),
    ).not.toThrow();
  });

  it('uses baked-in defaults at cold-start, which can alone trip a very low ceiling', () => {
    ensureDirective(db, 'd1');
    // No prior calls. Estimator returns DEFAULT_CATEGORY_COST.reasoning.stream ($1.5).
    // Spent=0, estimate=$1.5, ceiling=$1.0 → 0+1.5 > 1 trips.
    try {
      assertBudget({
        db,
        directiveId: 'd1',
        maxUsd: 1.0,
        category: 'reasoning',
        mode: 'stream',
        agent: 'builder',
      });
      expect.fail('expected BudgetExceededError');
    } catch (err) {
      expect(err).toBeInstanceOf(BudgetExceededError);
    }
  });

  it('prefers the steps ceiling when both would trip (steps is checked first)', () => {
    ensureDirective(db, 'd1');
    seedCall(db, 'd1', 10.0, 0);
    // maxUsd=$5 (spent=10, would trip) AND maxSteps=1 (1 call, next would be 2nd).
    try {
      assertBudget({
        db,
        directiveId: 'd1',
        maxUsd: 5.0,
        maxSteps: 1,
        category: 'reasoning',
        mode: 'stream',
        agent: 'builder',
      });
      expect.fail('expected BudgetExceededError');
    } catch (err) {
      expect(err).toBeInstanceOf(BudgetExceededError);
      if (err instanceof BudgetExceededError) {
        expect(err.detail.kind).toBe('budget_exceeded_steps');
      }
    }
  });
});

describe('formatBlockedReason', () => {
  it('formats the usd variant with spent / ceiling / est / calls / agent', () => {
    const s = formatBlockedReason({
      kind: 'budget_exceeded_usd',
      ceiling: 3,
      spentSoFar: 2.5,
      estimatedCost: 0.8,
      callsMadeSoFar: 4,
      category: 'reasoning',
      mode: 'stream',
      agent: 'builder',
    });
    expect(s).toMatch(/^budget_exceeded_usd:/);
    expect(s).toContain('spent=$2.5000');
    expect(s).toContain('ceiling=$3.00');
    expect(s).toContain('est=$0.8000');
    expect(s).toContain('calls=4');
    expect(s).toContain('agent=builder');
  });

  it('formats the steps variant with calls/ceiling ratio and agent', () => {
    const s = formatBlockedReason({
      kind: 'budget_exceeded_steps',
      ceiling: 40,
      spentSoFar: 40,
      estimatedCost: 0,
      callsMadeSoFar: 40,
      category: 'planning',
      mode: 'call',
      agent: 'planner',
    });
    expect(s).toMatch(/^budget_exceeded_steps:/);
    expect(s).toContain('calls=40/40');
    expect(s).toContain('agent=planner');
  });
});
