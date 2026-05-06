/**
 * Commands not yet implemented — print a helpful message + the phase they
 * land in. Kept in one file so they're easy to delete as they graduate.
 */

import { stdout } from 'node:process';

import type { Command } from 'commander';

export function registerStubCommands(program: Command): void {
  program
    .command('logs')
    .description('tail logs across all components')
    .option('--follow', 'live tail')
    .option('--component <name>', 'filter to a single component')
    .option('--directive <id>', 'stitch by directive correlation id')
    .addHelpText(
      'after',
      `
Examples:
  # stub — placeholder; tail the files directly for now
  tail -F ~/.factory5/logs/factory.log
  grep -F 01KQ…ULID ~/.factory5/logs/*.log              # stitch by directive
`,
    )
    .action(() => {
      stdout.write('factory logs: not yet implemented (tail the files under ~/.factory5/logs/)\n');
    });
}
