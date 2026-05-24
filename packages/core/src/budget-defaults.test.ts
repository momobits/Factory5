import { describe, expect, it } from 'vitest';

import {
  BUDGET_AXES,
  BUDGET_DEFAULTS,
  budgetsSchema,
  resolveBudgets,
  type AxisType,
  type Budgets,
} from './budget-defaults.js';

describe('BUDGET_DEFAULTS', () => {
  it('covers every axis declared in BUDGET_AXES', () => {
    for (const axis of BUDGET_AXES) {
      expect(BUDGET_DEFAULTS[axis]).toBeDefined();
      expect(typeof BUDGET_DEFAULTS[axis].value).toBe('number');
      expect(typeof BUDGET_DEFAULTS[axis].explainer).toBe('string');
      expect(BUDGET_DEFAULTS[axis].explainer.length).toBeGreaterThan(0);
      expect(typeof BUDGET_DEFAULTS[axis].type).toBe('string');
      expect(typeof BUDGET_DEFAULTS[axis].autoIncreaseEligible).toBe('boolean');
    }
  });

  it('declares the twelve operator-facing axes (ADR 0035 canonical table)', () => {
    expect([...BUDGET_AXES]).toEqual([
      'maxUsd',
      'maxSteps',
      'maxTurnsScaffolder',
      'maxTurnsBuilder',
      'maxTurnsFixer',
      'maxTotalTurns',
      'maxUsdPerTask',
      'maxRetriesPerTask',
      'askUserDeadlineMs',
      'maxWikiReadinessAttempts',
      'maxWallClockMinutes',
      'maxConcurrentTasks',
    ]);
    expect(BUDGET_AXES.length).toBe(12);
  });

  it('uses 0 as the "unlimited" sentinel for pool/per-directive axes with unlimited semantics', () => {
    expect(BUDGET_DEFAULTS.maxUsd.value).toBe(0);
    expect(BUDGET_DEFAULTS.maxSteps.value).toBe(0);
    expect(BUDGET_DEFAULTS.maxTotalTurns.value).toBe(0);
    expect(BUDGET_DEFAULTS.maxUsdPerTask.value).toBe(0);
    expect(BUDGET_DEFAULTS.maxWallClockMinutes.value).toBe(0);
  });

  it('seeds askUserDeadlineMs to 5 minutes matching ADR 0030 §2', () => {
    expect(BUDGET_DEFAULTS.askUserDeadlineMs.value).toBe(300_000);
  });

  it('seeds per-agent-class turn pool caps from the established baselines', () => {
    expect(BUDGET_DEFAULTS.maxTurnsScaffolder.value).toBe(120);
    expect(BUDGET_DEFAULTS.maxTurnsBuilder.value).toBe(80);
    expect(BUDGET_DEFAULTS.maxTurnsFixer.value).toBe(80);
  });

  it('seeds new axes with expected defaults', () => {
    expect(BUDGET_DEFAULTS.maxRetriesPerTask.value).toBe(3);
    expect(BUDGET_DEFAULTS.maxConcurrentTasks.value).toBe(4);
  });

  it('classifies every axis with a valid AxisType', () => {
    const validTypes: AxisType[] = ['pool', 'per-task', 'per-question', 'per-directive'];
    for (const axis of BUDGET_AXES) {
      expect(validTypes).toContain(BUDGET_DEFAULTS[axis].type);
    }
  });

  it('marks pool axes as auto-increase eligible', () => {
    expect(BUDGET_DEFAULTS.maxUsd.autoIncreaseEligible).toBe(true);
    expect(BUDGET_DEFAULTS.maxSteps.autoIncreaseEligible).toBe(true);
    expect(BUDGET_DEFAULTS.maxTurnsScaffolder.autoIncreaseEligible).toBe(true);
    expect(BUDGET_DEFAULTS.maxTurnsBuilder.autoIncreaseEligible).toBe(true);
    expect(BUDGET_DEFAULTS.maxTurnsFixer.autoIncreaseEligible).toBe(true);
    expect(BUDGET_DEFAULTS.maxTotalTurns.autoIncreaseEligible).toBe(true);
  });

  it('marks per-task and per-question axes as NOT auto-increase eligible', () => {
    expect(BUDGET_DEFAULTS.maxUsdPerTask.autoIncreaseEligible).toBe(false);
    expect(BUDGET_DEFAULTS.maxRetriesPerTask.autoIncreaseEligible).toBe(false);
    expect(BUDGET_DEFAULTS.askUserDeadlineMs.autoIncreaseEligible).toBe(false);
    expect(BUDGET_DEFAULTS.maxConcurrentTasks.autoIncreaseEligible).toBe(false);
  });

  it('marks maxWikiReadinessAttempts and maxWallClockMinutes as auto-increase eligible', () => {
    expect(BUDGET_DEFAULTS.maxWikiReadinessAttempts.autoIncreaseEligible).toBe(true);
    expect(BUDGET_DEFAULTS.maxWallClockMinutes.autoIncreaseEligible).toBe(true);
  });
});

describe('budgetsSchema', () => {
  it('accepts an empty object — every axis optional', () => {
    expect(budgetsSchema.parse({})).toEqual({});
  });

  it('accepts a single-axis override', () => {
    expect(budgetsSchema.parse({ maxTurnsScaffolder: 160 })).toEqual({
      maxTurnsScaffolder: 160,
    });
  });

  it('accepts the full 12-axis set populated', () => {
    const all: Budgets = {
      maxUsd: 5.5,
      maxSteps: 100,
      maxTurnsScaffolder: 160,
      maxTurnsBuilder: 100,
      maxTurnsFixer: 100,
      maxTotalTurns: 500,
      maxUsdPerTask: 1.5,
      maxRetriesPerTask: 5,
      askUserDeadlineMs: 600_000,
      maxWikiReadinessAttempts: 3,
      maxWallClockMinutes: 60,
      maxConcurrentTasks: 8,
    };
    expect(budgetsSchema.parse(all)).toEqual(all);
  });

  it('accepts 0 for axes with unlimited sentinel semantics', () => {
    expect(
      budgetsSchema.parse({
        maxUsd: 0,
        maxSteps: 0,
        maxUsdPerTask: 0,
        maxTotalTurns: 0,
        maxRetriesPerTask: 0,
        maxWikiReadinessAttempts: 0,
        maxWallClockMinutes: 0,
      }),
    ).toEqual({
      maxUsd: 0,
      maxSteps: 0,
      maxUsdPerTask: 0,
      maxTotalTurns: 0,
      maxRetriesPerTask: 0,
      maxWikiReadinessAttempts: 0,
      maxWallClockMinutes: 0,
    });
  });

  it('accepts a fractional maxUsdPerTask (USD with decimals)', () => {
    expect(budgetsSchema.parse({ maxUsdPerTask: 0.75 })).toEqual({ maxUsdPerTask: 0.75 });
  });

  it('rejects negative maxUsdPerTask', () => {
    expect(() => budgetsSchema.parse({ maxUsdPerTask: -1 })).toThrow();
  });

  it('rejects negative maxUsd', () => {
    expect(() => budgetsSchema.parse({ maxUsd: -1 })).toThrow();
  });

  it('rejects negative maxSteps', () => {
    expect(() => budgetsSchema.parse({ maxSteps: -1 })).toThrow();
  });

  it('rejects non-integer maxSteps', () => {
    expect(() => budgetsSchema.parse({ maxSteps: 1.5 })).toThrow();
  });

  it('rejects non-integer maxTurnsScaffolder', () => {
    expect(() => budgetsSchema.parse({ maxTurnsScaffolder: 120.5 })).toThrow();
  });

  it('rejects zero askUserDeadlineMs (positive-only)', () => {
    expect(() => budgetsSchema.parse({ askUserDeadlineMs: 0 })).toThrow();
  });

  it('rejects zero maxTurns axes (positive-only)', () => {
    expect(() => budgetsSchema.parse({ maxTurnsBuilder: 0 })).toThrow();
  });

  it('rejects zero maxConcurrentTasks (positive-only — need at least 1 slot)', () => {
    expect(() => budgetsSchema.parse({ maxConcurrentTasks: 0 })).toThrow();
  });

  it('accepts a fractional maxUsd (USD with decimals)', () => {
    expect(budgetsSchema.parse({ maxUsd: 0.5 })).toEqual({ maxUsd: 0.5 });
  });

  it('accepts the new per-directive axes', () => {
    expect(budgetsSchema.parse({ maxWallClockMinutes: 120 })).toEqual({
      maxWallClockMinutes: 120,
    });
    expect(budgetsSchema.parse({ maxConcurrentTasks: 2 })).toEqual({
      maxConcurrentTasks: 2,
    });
  });

  it('accepts the new per-task axis maxRetriesPerTask', () => {
    expect(budgetsSchema.parse({ maxRetriesPerTask: 5 })).toEqual({
      maxRetriesPerTask: 5,
    });
  });

  it('accepts maxTotalTurns as a nonnegative integer', () => {
    expect(budgetsSchema.parse({ maxTotalTurns: 0 })).toEqual({ maxTotalTurns: 0 });
    expect(budgetsSchema.parse({ maxTotalTurns: 1000 })).toEqual({ maxTotalTurns: 1000 });
  });

  it('rejects negative maxTotalTurns', () => {
    expect(() => budgetsSchema.parse({ maxTotalTurns: -1 })).toThrow();
  });
});

describe('resolveBudgets', () => {
  it('returns all defaults when input is omitted', () => {
    expect(resolveBudgets()).toEqual({
      maxUsd: 0,
      maxSteps: 0,
      maxTurnsScaffolder: 120,
      maxTurnsBuilder: 80,
      maxTurnsFixer: 80,
      maxTotalTurns: 0,
      maxUsdPerTask: 0,
      maxRetriesPerTask: 3,
      askUserDeadlineMs: 300_000,
      maxWikiReadinessAttempts: 3,
      maxWallClockMinutes: 0,
      maxConcurrentTasks: 4,
    });
  });

  it('returns all defaults when input is empty object', () => {
    expect(resolveBudgets({})).toEqual({
      maxUsd: 0,
      maxSteps: 0,
      maxTurnsScaffolder: 120,
      maxTurnsBuilder: 80,
      maxTurnsFixer: 80,
      maxTotalTurns: 0,
      maxUsdPerTask: 0,
      maxRetriesPerTask: 3,
      askUserDeadlineMs: 300_000,
      maxWikiReadinessAttempts: 3,
      maxWallClockMinutes: 0,
      maxConcurrentTasks: 4,
    });
  });

  it('overrides exactly one axis and defaults the rest', () => {
    expect(resolveBudgets({ maxTurnsScaffolder: 160 })).toEqual({
      maxUsd: 0,
      maxSteps: 0,
      maxTurnsScaffolder: 160,
      maxTurnsBuilder: 80,
      maxTurnsFixer: 80,
      maxTotalTurns: 0,
      maxUsdPerTask: 0,
      maxRetriesPerTask: 3,
      askUserDeadlineMs: 300_000,
      maxWikiReadinessAttempts: 3,
      maxWallClockMinutes: 0,
      maxConcurrentTasks: 4,
    });
  });

  it('respects 0 as an explicit "unlimited" override (not a falsy default-trigger)', () => {
    const resolved = resolveBudgets({ maxUsd: 0, maxSteps: 0 });
    expect(resolved.maxUsd).toBe(0);
    expect(resolved.maxSteps).toBe(0);
  });

  it('returns every axis present (complete object guarantee)', () => {
    const resolved = resolveBudgets({});
    for (const axis of BUDGET_AXES) {
      expect(resolved[axis]).toBeDefined();
      expect(typeof resolved[axis]).toBe('number');
    }
  });

  it('preserves a full override unchanged', () => {
    const full: Budgets = {
      maxUsd: 10,
      maxSteps: 500,
      maxTurnsScaffolder: 160,
      maxTurnsBuilder: 160,
      maxTurnsFixer: 160,
      maxTotalTurns: 1000,
      maxUsdPerTask: 2.5,
      maxRetriesPerTask: 5,
      askUserDeadlineMs: 600_000,
      maxWikiReadinessAttempts: 5,
      maxWallClockMinutes: 120,
      maxConcurrentTasks: 8,
    };
    expect(resolveBudgets(full)).toEqual(full);
  });

  it('resolves new axes from BUDGET_DEFAULTS when absent', () => {
    const resolved = resolveBudgets({});
    expect(resolved.maxTotalTurns).toBe(0);
    expect(resolved.maxRetriesPerTask).toBe(3);
    expect(resolved.maxWallClockMinutes).toBe(0);
    expect(resolved.maxConcurrentTasks).toBe(4);
  });

  it('keeps operator values for new axes when present', () => {
    const resolved = resolveBudgets({
      maxTotalTurns: 500,
      maxRetriesPerTask: 10,
      maxWallClockMinutes: 60,
      maxConcurrentTasks: 2,
    });
    expect(resolved.maxTotalTurns).toBe(500);
    expect(resolved.maxRetriesPerTask).toBe(10);
    expect(resolved.maxWallClockMinutes).toBe(60);
    expect(resolved.maxConcurrentTasks).toBe(2);
  });
});
