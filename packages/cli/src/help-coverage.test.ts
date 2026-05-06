/**
 * `factory <cmd> --help` coverage gate (Phase 4.6).
 *
 * Walks the Commander tree built by `buildCli()` and asserts every leaf
 * command's `--help` output includes an `Examples:` section. Plus the
 * top-level `factory --help` should point operators at the WORKFLOWS doc
 * via `addHelpText('afterAll', …)`.
 *
 * Single test gating every addHelpText call site — when a future command
 * is added to cli.ts without a worked example, this test fails with a
 * pointer to the missing surface rather than a silent doc gap.
 */

import { initLogger } from '@factory5/logger';
import type { Command } from 'commander';
import { beforeAll, describe, expect, it } from 'vitest';

import { buildCli } from './cli.js';

beforeAll(() => {
  initLogger({ processName: 'cli-help-coverage-test', noFile: true, noConsole: true });
});

/** Collect every Commander command that has an action (i.e., a runnable leaf). */
function collectLeaves(
  root: Command,
  acc: { path: string; cmd: Command }[] = [],
): {
  path: string;
  cmd: Command;
}[] {
  for (const child of root.commands) {
    const leafName = `${root.name()} ${child.name()}`;
    if (child.commands.length > 0) {
      // Group — recurse into nested subcommands.
      collectLeaves(child, acc);
    } else {
      acc.push({ path: leafName, cmd: child });
    }
  }
  return acc;
}

/**
 * Capture what Commander would write to stdout when the user runs
 * `--help` on this command. `helpInformation()` alone returns only the
 * auto-generated layout — `addHelpText` content fires on the
 * `afterHelp` / `afterAllHelp` events that `outputHelp()` emits.
 */
function getRenderedHelp(cmd: Command): string {
  let captured = '';
  const sink = (str: string): boolean => {
    captured += str;
    return true;
  };
  cmd.configureOutput({ writeOut: sink, writeErr: sink });
  cmd.outputHelp();
  return captured;
}

describe('--help coverage (Phase 4.6)', () => {
  it('every runnable command exposes an Examples: section in --help', () => {
    const program = buildCli({ name: 'factory', version: '0.0.0-test' });
    const leaves = collectLeaves(program);
    expect(leaves.length).toBeGreaterThan(0);

    const missing: string[] = [];
    for (const { path, cmd } of leaves) {
      const help = getRenderedHelp(cmd);
      if (!help.includes('Examples:')) {
        missing.push(path);
      }
    }

    expect(missing, `commands without an Examples: section: ${missing.join(', ')}`).toEqual([]);
  });

  it('top-level factory --help points operators at docs/WORKFLOWS.md', () => {
    const program = buildCli({ name: 'factory', version: '0.0.0-test' });
    const help = getRenderedHelp(program);
    expect(help.toLowerCase()).toContain('workflows');
  });
});
