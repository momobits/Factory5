/**
 * @factory5/cli — Commander-based CLI surface.
 *
 * @packageDocumentation
 */

import { createLogger } from '@factory5/logger';
import { Command } from 'commander';

const log = createLogger('cli');

export interface BuildCliOptions {
  /** Override the binary name shown in --help. */
  name?: string;
  /** Override the version shown in --version. */
  version?: string;
}

/**
 * Build the Commander program. Apps call this and then `parseAsync(argv)`.
 *
 * Phase 0: --version, --help, and stubs for `init`, `build`, `status`,
 *          `daemon`, `logs`, `inspect`, `chat`.
 * Phase 1+: real implementations land subcommand-by-subcommand.
 */
export function buildCli(opts: BuildCliOptions = {}): Command {
  const program = new Command();
  program
    .name(opts.name ?? 'factory')
    .description('factory5 — autonomous (and human-directable) software builder')
    .version(opts.version ?? '0.0.1');

  program
    .command('init')
    .description('interactive first-time setup (writes ~/.factory5/config.toml)')
    .action(() => {
      log.info('init: stub — Phase 1');
      process.stdout.write('factory init: not yet implemented (Phase 1)\n');
    });

  program
    .command('build <project>')
    .description('build a project from its CLAUDE.md spec')
    .option('--autonomy <mode>', 'chat | assisted | autonomous', 'assisted')
    .action((project: string, opts: { autonomy: string }) => {
      log.info({ project, autonomy: opts.autonomy }, 'build: stub — Phase 1');
      process.stdout.write(
        `factory build ${project} --autonomy ${opts.autonomy}: not yet implemented (Phase 1)\n`,
      );
    });

  program
    .command('status')
    .description('show projects, active directives, daemon health')
    .action(() => {
      log.info('status: stub — Phase 1');
      process.stdout.write('factory status: not yet implemented (Phase 1)\n');
    });

  const daemon = program.command('daemon').description('daemon lifecycle');
  daemon
    .command('start')
    .description('start factoryd in the background')
    .action(() => {
      process.stdout.write('factory daemon start: not yet implemented (Phase 3)\n');
    });
  daemon
    .command('stop')
    .description('stop the running factoryd')
    .action(() => {
      process.stdout.write('factory daemon stop: not yet implemented (Phase 3)\n');
    });
  daemon
    .command('status')
    .description('show daemon health')
    .action(() => {
      process.stdout.write('factory daemon status: not yet implemented (Phase 3)\n');
    });
  daemon
    .command('logs')
    .description('tail daemon logs')
    .action(() => {
      process.stdout.write('factory daemon logs: not yet implemented (Phase 3)\n');
    });

  program
    .command('logs')
    .description('tail logs across all components')
    .option('--follow', 'live tail')
    .option('--component <name>', 'filter to a single component')
    .option('--directive <id>', 'stitch by directive correlation id')
    .action((opts: { follow?: boolean; component?: string; directive?: string }) => {
      log.info(opts, 'logs: stub — Phase 3');
      process.stdout.write('factory logs: not yet implemented (Phase 3)\n');
    });

  program
    .command('chat')
    .description('interactive chat against the brain')
    .action(() => {
      process.stdout.write('factory chat: not yet implemented (Phase 3)\n');
    });

  return program;
}
