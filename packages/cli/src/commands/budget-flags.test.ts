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
  it('registers all six axes as long flags', () => {
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

  it('routes the four Tier-12 axes to budgets (ADR 0032 §6 payload path)', () => {
    expect(
      collectBudgetFlags({
        askUserDeadlineMs: 600_000,
        maxTurnsScaffolder: 160,
        maxTurnsBuilder: 100,
        maxTurnsFixer: 100,
      }),
    ).toEqual({
      limits: {},
      budgets: {
        askUserDeadlineMs: 600_000,
        maxTurnsScaffolder: 160,
        maxTurnsBuilder: 100,
        maxTurnsFixer: 100,
      },
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
