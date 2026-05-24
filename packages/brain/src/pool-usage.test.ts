/**
 * Unit tests for `computePoolUsage` (Tier 15 / ADR 0034).
 *
 * Uses an in-memory SQLite database with all migrations applied.
 * Verifies cap resolution, per-axis aggregation, status derivation,
 * parkedReason parsing, and graceful handling of edge cases.
 */

import { describe, it, expect, beforeEach } from 'vitest';

import { newId } from '@factory5/core';
import { computePoolUsage } from './pool-usage.js';
import { openDatabase, runMigrations, type Database } from '@factory5/state';
import { BUDGET_DEFAULTS } from '@factory5/core/budgets';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function freshDb(): Database {
  const db = openDatabase(':memory:');
  runMigrations(db);
  return db;
}

/** Insert a minimal directive row and return its id. */
function seedDirective(
  db: Database,
  id: string,
  opts: {
    status?: string;
    blockedReason?: string | null;
    payloadBudgets?: Record<string, number>;
  } = {},
): void {
  const payload =
    opts.payloadBudgets !== undefined ? JSON.stringify({ budgets: opts.payloadBudgets }) : '{}';
  const status = opts.status ?? 'running';
  const blockedReason = opts.blockedReason ?? null;
  db.prepare(
    `INSERT INTO directives
       (id, source, principal, channel_ref, intent, payload_json, autonomy,
        created_at, status, blocked_reason)
     VALUES (?, 'cli', 'test', 'test-ref', 'build', ?, 'autonomous', ?, ?, ?)`,
  ).run(id, payload, new Date().toISOString(), status, blockedReason);
}

/**
 * Insert a minimal task_inflight row.
 * `turnsUsed` is stored in result_json (post-Tier-15 field; optional).
 */
function seedTask(
  db: Database,
  opts: {
    id: string;
    directiveId: string;
    agent: string;
    turnsUsed?: number;
    status?: string;
  },
): void {
  const resultJson =
    opts.turnsUsed !== undefined
      ? JSON.stringify({
          exitCode: 0,
          turnsUsed: opts.turnsUsed,
          filesChanged: [],
          findingsRaised: [],
          signalsEmitted: [],
          durationMs: 1000,
        })
      : null;
  db.prepare(
    `INSERT INTO tasks_inflight
       (id, directive_id, plan_id, title, agent, category, status, attempts,
        started_at, finished_at, result_json)
     VALUES (?, ?, ?, ?, ?, 'deep', ?, 1, ?, ?, ?)`,
  ).run(
    opts.id,
    opts.directiveId,
    newId(), // plan_id — just needs to be TEXT, no separate plans table
    `task-${opts.id.slice(-4)}`,
    opts.agent,
    opts.status ?? 'complete',
    new Date().toISOString(),
    new Date().toISOString(),
    resultJson,
  );
}

/** Insert a model_usage row for directive-level cost/step tracking. */
function seedModelUsage(db: Database, directiveId: string, costUsd: number): void {
  db.prepare(
    `INSERT INTO model_usage
       (id, directive_id, provider, model, category, input_tokens, output_tokens,
        cost_usd, duration_ms, called_at)
     VALUES (?, ?, 'stub', 'stub', 'deep', 0, 0, ?, 100, ?)`,
  ).run(newId(), directiveId, costUsd, new Date().toISOString());
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const projectBudgets = {
  budgetDefaults: {
    maxUsd: 100,
    maxSteps: 500,
    maxTurnsScaffolder: 120,
    maxTurnsBuilder: 240,
    maxTurnsFixer: 80,
  },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('computePoolUsage', () => {
  let db: Database;

  beforeEach(() => {
    db = freshDb();
  });

  // ---- Basic zero-state ----

  it('returns 0 used for an empty directive (no tasks, no model_usage)', () => {
    const directiveId = newId();
    seedDirective(db, directiveId);

    const pool = computePoolUsage(db, directiveId, projectBudgets);

    expect(pool.perAxis.maxTurnsBuilder.used).toBe(0);
    expect(pool.perAxis.maxTurnsBuilder.cap).toBe(240);
    expect(pool.perAxis.maxTurnsBuilder.status).toBe('ok');
    expect(pool.perAxis.maxTurnsBuilder.tasks).toEqual([]);
    expect(pool.directiveId).toBe(directiveId);
    expect(pool.computedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  // ---- Turn aggregation ----

  it('sums turnsUsed across builder tasks', () => {
    const directiveId = newId();
    seedDirective(db, directiveId);

    seedTask(db, { id: newId(), directiveId, agent: 'builder', turnsUsed: 60 });
    seedTask(db, { id: newId(), directiveId, agent: 'builder', turnsUsed: 80 });
    seedTask(db, { id: newId(), directiveId, agent: 'builder', turnsUsed: 45 });

    const pool = computePoolUsage(db, directiveId, projectBudgets);

    expect(pool.perAxis.maxTurnsBuilder.used).toBe(60 + 80 + 45);
    expect(pool.perAxis.maxTurnsBuilder.tasks).toHaveLength(3);
    // contributions exist for each task; order not guaranteed so find by value
    const contribs = pool.perAxis.maxTurnsBuilder.tasks
      .map((t) => t.contribution)
      .sort((a, b) => a - b);
    expect(contribs).toEqual([45, 60, 80]);
  });

  it('isolates per-class — builder tasks do not count toward fixer pool', () => {
    const directiveId = newId();
    seedDirective(db, directiveId);

    seedTask(db, { id: newId(), directiveId, agent: 'builder', turnsUsed: 100 });
    seedTask(db, { id: newId(), directiveId, agent: 'fixer', turnsUsed: 50 });

    const pool = computePoolUsage(db, directiveId, projectBudgets);

    expect(pool.perAxis.maxTurnsBuilder.used).toBe(100);
    expect(pool.perAxis.maxTurnsFixer.used).toBe(50);
    expect(pool.perAxis.maxTurnsScaffolder.used).toBe(0);
  });

  it('treats missing turnsUsed in result_json as 0 (pre-Tier-15 task rows)', () => {
    const directiveId = newId();
    seedDirective(db, directiveId);

    // Task with no turnsUsed field
    seedTask(db, { id: newId(), directiveId, agent: 'builder' });

    const pool = computePoolUsage(db, directiveId, projectBudgets);

    expect(pool.perAxis.maxTurnsBuilder.used).toBe(0);
    expect(pool.perAxis.maxTurnsBuilder.tasks).toHaveLength(1);
    expect(pool.perAxis.maxTurnsBuilder.tasks[0].contribution).toBe(0);
  });

  // ---- USD and step aggregation ----

  it('rolls up USD across model_usage rows scoped to directive_id', () => {
    const directiveId = newId();
    seedDirective(db, directiveId);

    seedModelUsage(db, directiveId, 0.5);
    seedModelUsage(db, directiveId, 0.3);
    seedModelUsage(db, directiveId, 0.7);

    const pool = computePoolUsage(db, directiveId, projectBudgets);

    expect(pool.perAxis.maxUsd.used).toBeCloseTo(1.5, 5);
  });

  it('counts model_usage rows as steps (one row = one LLM call = one step)', () => {
    const directiveId = newId();
    seedDirective(db, directiveId);

    seedModelUsage(db, directiveId, 0.1);
    seedModelUsage(db, directiveId, 0.2);

    const pool = computePoolUsage(db, directiveId, projectBudgets);

    expect(pool.perAxis.maxSteps.used).toBe(2);
  });

  // ---- Cap resolution ----

  it('uses max(project, payload.budgets, BUDGET_DEFAULTS) for cap', () => {
    const directiveId = newId();
    // payload says maxTurnsBuilder = 500
    seedDirective(db, directiveId, { payloadBudgets: { maxTurnsBuilder: 500 } });

    const pool = computePoolUsage(db, directiveId, {
      budgetDefaults: { maxTurnsBuilder: 100 },
    });

    // max(project=100, payload=500, default=80) = 500
    expect(pool.perAxis.maxTurnsBuilder.cap).toBe(500);
  });

  it('falls back to BUDGET_DEFAULTS when neither project nor payload set the axis', () => {
    const directiveId = newId();
    seedDirective(db, directiveId);

    const pool = computePoolUsage(db, directiveId, { budgetDefaults: {} });

    expect(pool.perAxis.maxTurnsBuilder.cap).toBe(BUDGET_DEFAULTS.maxTurnsBuilder.value);
    expect(pool.perAxis.maxTurnsScaffolder.cap).toBe(BUDGET_DEFAULTS.maxTurnsScaffolder.value);
  });

  // ---- Status derivation ----

  it('flags status=exhausted when used >= cap', () => {
    const directiveId = newId();
    seedDirective(db, directiveId);

    // Exactly fill the cap (240 turns under cap 240)
    seedTask(db, { id: newId(), directiveId, agent: 'builder', turnsUsed: 240 });

    const pool = computePoolUsage(db, directiveId, projectBudgets);

    expect(pool.perAxis.maxTurnsBuilder.status).toBe('exhausted');
    expect(pool.perAxis.maxTurnsBuilder.pct).toBe(100);
  });

  it('flags status=warn when used >= 80% of cap but < cap', () => {
    const directiveId = newId();
    seedDirective(db, directiveId);

    // 200 turns out of 240 cap = 83.3%
    seedTask(db, { id: newId(), directiveId, agent: 'builder', turnsUsed: 200 });

    const pool = computePoolUsage(db, directiveId, projectBudgets);

    expect(pool.perAxis.maxTurnsBuilder.status).toBe('warn');
    expect(pool.perAxis.maxTurnsBuilder.pct).toBeGreaterThanOrEqual(80);
    expect(pool.perAxis.maxTurnsBuilder.pct).toBeLessThan(100);
  });

  it('flags status=ok when used < 80% of cap', () => {
    const directiveId = newId();
    seedDirective(db, directiveId);

    // 50 turns out of 240 cap = ~21%
    seedTask(db, { id: newId(), directiveId, agent: 'builder', turnsUsed: 50 });

    const pool = computePoolUsage(db, directiveId, projectBudgets);

    expect(pool.perAxis.maxTurnsBuilder.status).toBe('ok');
  });

  // ---- parkedReason ----

  it('returns parkedReason when directive is blocked with pool-exhausted JSON', () => {
    const directiveId = newId();
    seedDirective(db, directiveId, {
      status: 'blocked',
      blockedReason: JSON.stringify({
        kind: 'pool-exhausted',
        axis: 'maxTurnsBuilder',
        usedAtPark: 240,
        capAtPark: 240,
      }),
    });

    const pool = computePoolUsage(db, directiveId, projectBudgets);

    expect(pool.parkedReason).toBeDefined();
    expect(pool.parkedReason?.axis).toBe('maxTurnsBuilder');
    expect(pool.parkedReason?.usedAtPark).toBe(240);
    expect(pool.parkedReason?.capAtPark).toBe(240);
    // nextBumpTo = capAtPark + project default for maxTurnsBuilder = 240 + 240 = 480
    expect(pool.parkedReason?.nextBumpTo).toBe(240 + 240);
  });

  it('handles malformed blocked_reason gracefully (legacy free-text)', () => {
    const directiveId = newId();
    seedDirective(db, directiveId, {
      status: 'blocked',
      blockedReason: 'cancelled-from-web-ui',
    });

    const pool = computePoolUsage(db, directiveId, projectBudgets);

    expect(pool.parkedReason).toBeUndefined();
  });

  it('handles JSON blocked_reason with unknown kind gracefully', () => {
    const directiveId = newId();
    seedDirective(db, directiveId, {
      status: 'blocked',
      blockedReason: JSON.stringify({ kind: 'operator-override', reason: 'manual' }),
    });

    const pool = computePoolUsage(db, directiveId, projectBudgets);

    expect(pool.parkedReason).toBeUndefined();
  });

  it('throws when directive does not exist', () => {
    expect(() => computePoolUsage(db, 'DOESNOTEXIST00000000000000', projectBudgets)).toThrow(
      /not found/,
    );
  });
});
