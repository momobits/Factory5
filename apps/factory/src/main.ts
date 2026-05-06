#!/usr/bin/env node
/**
 * `factory` — CLI + brain entry point.
 *
 * Initializes logging, builds the Commander program, parses argv, and exits.
 * Long-running modes (`factory chat`, `factory serve`) keep the process alive
 * until they finish or are signaled.
 *
 * Help/version paths skip starting pino's async sonic-boom transport. Without
 * the skip, Commander's `process.exit()` after `--help` / `--version` fires
 * before sonic-boom finishes its initial open, and the on-exit-leak-free hook
 * throws "sonic boom is not ready yet" on every `factory <cmd> --help`. The
 * argv sniff is conservative (matches `--help` / `-h` / `--version` / `-V`
 * anywhere in argv, or no args at all) so any path that ends in synchronous
 * help / version output stays cosmetic-clean.
 */

import { buildCli } from '@factory5/cli';
import { createLogger, initLogger } from '@factory5/logger';
import { argv, exit } from 'node:process';

const argvFlags = argv.slice(2);
const isHelpish =
  argvFlags.length === 0 ||
  argvFlags.some((a) => a === '-h' || a === '--help' || a === '-V' || a === '--version');

initLogger({
  processName: 'factory',
  ...(isHelpish ? { noFile: true, noConsole: true } : {}),
});
const log = createLogger('factory.main');

async function main(): Promise<void> {
  const program = buildCli({ name: 'factory', version: '0.0.1' });
  await program.parseAsync(argv);
}

main().catch((err: unknown) => {
  log.error({ err }, 'unhandled error');
  exit(1);
});
