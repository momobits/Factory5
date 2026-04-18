#!/usr/bin/env node
/**
 * `factory` — CLI + brain entry point.
 *
 * Initializes logging, builds the Commander program, parses argv, and exits.
 * Long-running modes (`factory chat`, `factory serve`) keep the process alive
 * until they finish or are signaled.
 */

import { buildCli } from '@factory5/cli';
import { createLogger, initLogger } from '@factory5/logger';
import { argv, exit } from 'node:process';

initLogger({ processName: 'factory' });
const log = createLogger('factory.main');

async function main(): Promise<void> {
  const program = buildCli({ name: 'factory', version: '0.0.1' });
  await program.parseAsync(argv);
}

main().catch((err: unknown) => {
  log.error({ err }, 'unhandled error');
  exit(1);
});
