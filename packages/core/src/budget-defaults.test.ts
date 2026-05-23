import { describe, expect, it } from 'vitest';

import {
  BUDGET_AXES,
  BUDGET_DEFAULTS,
  budgetsSchema,
  resolveBudgets,
  type Budgets,
} from './budget-defaults.js';

describe('BUDGET_DEFAULTS', () => {
  it('covers every axis declared in BUDGET_AXES', () => {
    for (const axis of BUDGET_AXES) {
      expect(BUDGET_DEFAULTS[axis]).toBeDefined();
      expect(typeof BUDGET_DEFAULTS[axis].value).toBe('number');
      expect(typeof BUDGET_DEFAULTS[axis].explainer).toBe('string');
      expect(BUDGET_DEFAULTS[axis].explainer.length).toBeGreaterThan(0);
    }
  });

  it('declares the eight operator-facing axes (ADR 0032 §1 + Phase 13.6 maxUsdPerTask + Phase 14.3 maxWikiReadinessAttempts)', () => {
    expect([...BUDGET_AXES]).toEqual([
      'maxUsd',
      'maxSteps',
      'askUserDeadlineMs',
      'maxTurnsScaffolder',
      'maxTurnsBuilder',
      'maxTurnsFixer',
      'maxUsdPerTask',
      'maxWikiReadinessAttempts',
    ]);
  });

  it('uses 0 as the "unlimited" sentinel for maxUsd, maxSteps, and maxUsdPerTask', () => {
    expect(BUDGET_DEFAULTS.maxUsd.value).toBe(0);
    expect(BUDGET_DEFAULTS.maxSteps.value).toBe(0);
    expect(BUDGET_DEFAULTS.maxUsdPerTask.value).toBe(0);
  });

  it('seeds askUserDeadlineMs to 5 minutes matching ADR 0030 §2', () => {
    expect(BUDGET_DEFAULTS.askUserDeadlineMs.value).toBe(300_000);
  });

  it('seeds per-task turn caps from the post-fa2f800 + Tier-12 baselines', () => {
    expect(BUDGET_DEFAULTS.maxTurnsScaffolder.value).toBe(120);
    expect(BUDGET_DEFAULTS.maxTurnsBuilder.value).toBe(80);
    expect(BUDGET_DEFAULTS.maxTurnsFixer.value).toBe(80);
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

  it('accepts the full set populated', () => {
    const all: Budgets = {
      maxUsd: 5.5,
      maxSteps: 100,
      askUserDeadlineMs: 600_000,
      maxTurnsScaffolder: 160,
      maxTurnsBuilder: 100,
      maxTurnsFixer: 100,
      maxUsdPerTask: 1.5,
      maxWikiReadinessAttempts: 3,
    };
    expect(budgetsSchema.parse(all)).toEqual(all);
  });

  it('accepts 0 for maxUsd, maxSteps, and maxUsdPerTask (unlimited sentinel)', () => {
    expect(budgetsSchema.parse({ maxUsd: 0, maxSteps: 0, maxUsdPerTask: 0 })).toEqual({
      maxUsd: 0,
      maxSteps: 0,
      maxUsdPerTask: 0,
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

  it('accepts a fractional maxUsd (USD with decimals)', () => {
    expect(budgetsSchema.parse({ maxUsd: 0.5 })).toEqual({ maxUsd: 0.5 });
  });
});

describe('BUDGET_AXES — 8th axis maxWikiReadinessAttempts', () => {
  it('includes maxWikiReadinessAttempts at length 8', () => {
    expect(BUDGET_AXES).toContain('maxWikiReadinessAttempts');
    expect(BUDGET_AXES.length).toBe(8);
  });

  it('default value is 3 with explainer mentioning architect+critic cycles', () => {
    expect(BUDGET_DEFAULTS.maxWikiReadinessAttempts.value).toBe(3);
    expect(BUDGET_DEFAULTS.maxWikiReadinessAttempts.explainer.toLowerCase()).toContain('architect');
    expect(BUDGET_DEFAULTS.maxWikiReadinessAttempts.explainer.toLowerCase()).toContain('critic');
  });

  it('budgetsSchema accepts an integer value', () => {
    expect(() => budgetsSchema.parse({ maxWikiReadinessAttempts: 5 })).not.toThrow();
  });

  it('budgetsSchema rejects negative', () => {
    expect(() => budgetsSchema.parse({ maxWikiReadinessAttempts: -1 })).toThrow();
  });

  it('budgetsSchema accepts 0 (unlimited sentinel)', () => {
    expect(() => budgetsSchema.parse({ maxWikiReadinessAttempts: 0 })).not.toThrow();
  });

  it('resolveBudgets fills the default when absent', () => {
    expect(resolveBudgets({}).maxWikiReadinessAttempts).toBe(3);
  });

  it('resolveBudgets keeps the operator value when present', () => {
    expect(resolveBudgets({ maxWikiReadinessAttempts: 5 }).maxWikiReadinessAttempts).toBe(5);
  });
});

describe('resolveBudgets', () => {
  it('returns all defaults when input is omitted', () => {
    expect(resolveBudgets()).toEqual({
      maxUsd: 0,
      maxSteps: 0,
      askUserDeadlineMs: 300_000,
      maxTurnsScaffolder: 120,
      maxTurnsBuilder: 80,
      maxTurnsFixer: 80,
      maxUsdPerTask: 0,
      maxWikiReadinessAttempts: 3,
    });
  });

  it('returns all defaults when input is empty object', () => {
    expect(resolveBudgets({})).toEqual({
      maxUsd: 0,
      maxSteps: 0,
      askUserDeadlineMs: 300_000,
      maxTurnsScaffolder: 120,
      maxTurnsBuilder: 80,
      maxTurnsFixer: 80,
      maxUsdPerTask: 0,
      maxWikiReadinessAttempts: 3,
    });
  });

  it('overrides exactly one axis and defaults the rest', () => {
    expect(resolveBudgets({ maxTurnsScaffolder: 160 })).toEqual({
      maxUsd: 0,
      maxSteps: 0,
      askUserDeadlineMs: 300_000,
      maxTurnsScaffolder: 160,
      maxTurnsBuilder: 80,
      maxTurnsFixer: 80,
      maxUsdPerTask: 0,
      maxWikiReadinessAttempts: 3,
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
      askUserDeadlineMs: 600_000,
      maxTurnsScaffolder: 160,
      maxTurnsBuilder: 160,
      maxTurnsFixer: 160,
      maxUsdPerTask: 2.5,
      maxWikiReadinessAttempts: 5,
    };
    expect(resolveBudgets(full)).toEqual(full);
  });
});
