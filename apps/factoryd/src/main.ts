#!/usr/bin/env node
/**
 * `factoryd` — daemon entry point.
 *
 * Initializes logging, starts the daemon, and waits for SIGINT/SIGTERM to
 * gracefully shut down. A simple `--version` / `--help` short-circuits.
 */

import { startDaemon, stopDaemon } from '@factory5/daemon';
import { createLogger, initLogger } from '@factory5/logger';
import process, { argv, exit, stdout } from 'node:process';

initLogger({ processName: 'factoryd' });
const log = createLogger('factoryd.main');

const VERSION = '0.0.1';

async function main(): Promise<void> {
  // Minimal flag parsing for --version / --help so the daemon answers
  // before doing anything heavy. Real CLI for daemon control lives in
  // `factory daemon ...` (the `factory` binary).
  const flag = argv[2];
  if (flag === '--version' || flag === '-v') {
    stdout.write(`${VERSION}\n`);
    return;
  }
  if (flag === '--help' || flag === '-h') {
    stdout.write(
      [
        'factoryd — factory5 daemon',
        '',
        'Usage:',
        '  factoryd                  start daemon in foreground',
        '  factoryd --version        print version',
        '  factoryd --help           show this message',
        '',
        'Daemon control: `factory daemon start|stop|status|logs|install`',
        '',
      ].join('\n'),
    );
    return;
  }

  const handle = await startDaemon();
  log.info({ port: handle.port }, 'factoryd started');

  // Graceful shutdown on signals.
  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info({ signal }, 'shutdown signal received');
    void stopDaemon(handle)
      .then(() => {
        log.info('factoryd stopped');
        exit(0);
      })
      .catch((err: unknown) => {
        log.error({ err }, 'shutdown failed');
        exit(1);
      });
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err: unknown) => {
  log.error({ err }, 'unhandled error');
  exit(1);
});
