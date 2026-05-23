import { Command } from 'commander';
import { describe, expect, it } from 'vitest';

import { addBudgetFlags, collectBudgetFlags } from './budget-flags.js';

/** Build a Commander instance with addBudgetFlags + a no-op action, parse argv, return options. */
function parseArgs(argv: readonly string[]): Record<string, unknown> {
  const program = new Command();
  program.exitOverride();
  let captured: Record<string, unknown> = {};
  const cmd = program.command('test').action((opts: Record<string, unknown>) => {
    captured = opts;
  });
  addBudgetFlags(cmd);
  program.parse(['node', 'cli', 'test', ...argv]);
  return captured;
}

describe('addBudgetFlags', () => {
  it('registers all eight axes as long flags (Phase 14.3 adds maxWikiReadinessAttempts)', () => {
    const program = new Command();
    const cmd = program.command('test');
    addBudgetFlags(cmd);
    const flagNames = cmd.options.map((o) => o.long);
    expect(flagNames).toEqual([
      '--max-usd',
      '--max-steps',
      '--ask-user-deadline-ms',
      '--max-turns-scaffolder',
      '--max-turns-builder',
      '--max-turns-fixer',
      '--max-usd-per-task',
      '--max-wiki-readiness-attempts',
    ]);
  });

  it('uses BUDGET_DEFAULTS explainers verbatim as descriptions (ADR 0032 §3)', () => {
    const program = new Command();
    const cmd = program.command('test');
    addBudgetFlags(cmd);
    const usd = cmd.options.find((o) => o.long === '--max-usd');
    expect(usd?.description).toContain('0 = unlimited');
    const scaffolder = cmd.options.find((o) => o.long === '--max-turns-scaffolder');
    expect(scaffolder?.description).toContain('scaffolder');
    expect(scaffolder?.description).toContain('Higher for projects with >10 modules');
  });

  it('parses --max-usd as a positive float', () => {
    const opts = parseArgs(['--max-usd', '5.50']);
    expect(opts['maxUsd']).toBe(5.5);
  });

  it('parses --max-usd-per-task as a positive float (Phase 13.6)', () => {
    const opts = parseArgs(['--max-usd-per-task', '1.25']);
    expect(opts['maxUsdPerTask']).toBe(1.25);
  });

  it('parses integer flags as integers', () => {
    const opts = parseArgs([
      '--max-steps',
      '100',
      '--ask-user-deadline-ms',
      '600000',
      '--max-turns-scaffolder',
      '160',
      '--max-turns-builder',
      '120',
      '--max-turns-fixer',
      '120',
    ]);
    expect(opts['maxSteps']).toBe(100);
    expect(opts['askUserDeadlineMs']).toBe(600_000);
    expect(opts['maxTurnsScaffolder']).toBe(160);
    expect(opts['maxTurnsBuilder']).toBe(120);
    expect(opts['maxTurnsFixer']).toBe(120);
  });

  it('rejects --max-usd of 0 (positive-only contract)', () => {
    expect(() => parseArgs(['--max-usd', '0'])).toThrow(/--max-usd/);
  });

  it('rejects --max-usd of -1', () => {
    expect(() => parseArgs(['--max-usd', '-1'])).toThrow(/--max-usd/);
  });

  it('rejects --max-steps of 0', () => {
    expect(() => parseArgs(['--max-steps', '0'])).toThrow(/--max-steps/);
  });

  it('rejects non-integer --max-turns-scaffolder', () => {
    expect(() => parseArgs(['--max-turns-scaffolder', '120.5'])).toThrow(/--max-turns-scaffolder/);
  });

  it('rejects garbage values', () => {
    expect(() => parseArgs(['--max-usd', 'forty-two'])).toThrow();
    expect(() => parseArgs(['--ask-user-deadline-ms', 'banana'])).toThrow();
  });

  it('leaves every axis undefined when no flag is passed', () => {
    const opts = parseArgs([]);
    expect(opts['maxUsd']).toBeUndefined();
    expect(opts['maxSteps']).toBeUndefined();
    expect(opts['askUserDeadlineMs']).toBeUndefined();
    expect(opts['maxTurnsScaffolder']).toBeUndefined();
    expect(opts['maxTurnsBuilder']).toBeUndefined();
    expect(opts['maxTurnsFixer']).toBeUndefined();
    expect(opts['maxUsdPerTask']).toBeUndefined();
    expect(opts['maxWikiReadinessAttempts']).toBeUndefined();
  });
});

describe('addBudgetFlags — Tier 14 axis (maxWikiReadinessAttempts)', () => {
  it('exposes --max-wiki-readiness-attempts with description mentioning architect', () => {
    const program = new Command();
    const cmd = program.command('test');
    addBudgetFlags(cmd);
    const opt = cmd.options.find((o) => o.long === '--max-wiki-readiness-attempts');
    expect(opt).toBeDefined();
    expect(opt?.description.toLowerCase()).toContain('architect');
  });

  it('parses integer values (--max-wiki-readiness-attempts 5 → maxWikiReadinessAttempts: 5)', () => {
    const opts = parseArgs(['--max-wiki-readiness-attempts', '5']);
    expect(opts['maxWikiReadinessAttempts']).toBe(5);
  });

  it('rejects float values (e.g. 3.5)', () => {
    expect(() => parseArgs(['--max-wiki-readiness-attempts', '3.5'])).toThrow(
      /--max-wiki-readiness-attempts/,
    );
  });
});

describe('collectBudgetFlags', () => {
  it('returns empty limits + empty budgets for empty options', () => {
    expect(collectBudgetFlags({})).toEqual({ limits: {}, budgets: {} });
  });

  it('routes maxUsd / maxSteps to limits (ADR 0020 path)', () => {
    expect(collectBudgetFlags({ maxUsd: 3, maxSteps: 50 })).toEqual({
      limits: { maxUsd: 3, maxSteps: 50 },
      budgets: {},
    });
  });

  it('routes the six Tier-12+13+14 axes to budgets (ADR 0032 §6 payload path)', () => {
    expect(
      collectBudgetFlags({
        askUserDeadlineMs: 600_000,
        maxTurnsScaffolder: 160,
        maxTurnsBuilder: 100,
        maxTurnsFixer: 100,
        maxUsdPerTask: 1.5,
        maxWikiReadinessAttempts: 5,
      }),
    ).toEqual({
      limits: {},
      budgets: {
        askUserDeadlineMs: 600_000,
        maxTurnsScaffolder: 160,
        maxTurnsBuilder: 100,
        maxTurnsFixer: 100,
        maxUsdPerTask: 1.5,
        maxWikiReadinessAttempts: 5,
      },
    });
  });

  it('routes maxUsdPerTask to budgets (Phase 13.6 — payload axis, not directive limit)', () => {
    expect(collectBudgetFlags({ maxUsdPerTask: 0.75 })).toEqual({
      limits: {},
      budgets: { maxUsdPerTask: 0.75 },
    });
  });

  it('splits a mixed set correctly', () => {
    expect(
      collectBudgetFlags({
        maxUsd: 2.5,
        maxTurnsScaffolder: 160,
      }),
    ).toEqual({
      limits: { maxUsd: 2.5 },
      budgets: { maxTurnsScaffolder: 160 },
    });
  });

  it('omits axes that were not provided', () => {
    const got = collectBudgetFlags({ maxSteps: 100 });
    expect(got.limits).toEqual({ maxSteps: 100 });
    expect(Object.keys(got.limits)).not.toContain('maxUsd');
    expect(Object.keys(got.budgets)).toHaveLength(0);
  });
});
