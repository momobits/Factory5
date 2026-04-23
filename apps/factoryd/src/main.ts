#!/usr/bin/env node
/**
 * `factoryd` — daemon entry point.
 *
 * Two launch modes:
 *
 *   --foreground   (default) run the daemon in the current process and wait
 *                  for SIGINT/SIGTERM. Logs go to stdout + factory5 log file.
 *   --daemonize    spawn a detached child running `--foreground`, print the
 *                  child PID, and exit 0. Works identically on Windows and
 *                  Unix (Windows has no fork; detached spawn is the portable
 *                  equivalent).
 *
 * Real daemon control (status/stop/logs) lives in `factory daemon ...`.
 */

import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import process, { argv, execPath, exit, stdout } from 'node:process';

import { loadDaemonEndpoint } from '@factory5/brain';
import { startDaemon, stopDaemon, PidFileLockedError } from '@factory5/daemon';
import { createLogger, initLogger } from '@factory5/logger';

const VERSION = '0.0.1';

interface Parsed {
  mode: 'foreground' | 'daemonize';
  showVersion: boolean;
  showHelp: boolean;
}

function parseArgs(args: readonly string[]): Parsed {
  let mode: Parsed['mode'] = 'foreground';
  let showVersion = false;
  let showHelp = false;
  for (const a of args) {
    if (a === '-v' || a === '--version') showVersion = true;
    else if (a === '-h' || a === '--help') showHelp = true;
    else if (a === '--foreground') mode = 'foreground';
    else if (a === '--daemonize') mode = 'daemonize';
    // Unknown flags are ignored — the daemon's knobs are the CLI's concern.
  }
  return { mode, showVersion, showHelp };
}

function printHelp(): void {
  stdout.write(
    [
      'factoryd — factory5 daemon',
      '',
      'Usage:',
      '  factoryd [--foreground]   run daemon in this process (default)',
      '  factoryd --daemonize      spawn a detached daemon and exit',
      '  factoryd --version        print version',
      '  factoryd --help           show this message',
      '',
      'Control: `factory daemon start|stop|status|restart`',
      '',
    ].join('\n'),
  );
}

/** Spawn a detached `factoryd --foreground` and return its PID. */
function spawnDetached(): number {
  // argv[1] is the script factoryd itself was invoked with (dist/main.js in
  // production, main.ts under tsx in dev). We relaunch the same script.
  const scriptPath = argv[1];
  if (scriptPath === undefined) {
    throw new Error('cannot daemonize: argv[1] is undefined');
  }
  const child = spawn(execPath, [scriptPath, '--foreground'], {
    detached: true,
    stdio: 'ignore',
    // Clear the parent's --daemonize flag from env in case a wrapper re-reads it.
    env: process.env,
  });
  child.unref();
  if (child.pid === undefined) {
    throw new Error('cannot daemonize: spawn returned no PID');
  }
  return child.pid;
}

async function runForeground(): Promise<void> {
  initLogger({ processName: 'factoryd' });
  const log = createLogger('factoryd.main');

  let handle: Awaited<ReturnType<typeof startDaemon>>;
  try {
    const endpoint = await loadDaemonEndpoint();
    // Per-startup bearer token for `/worker/ask-user` (ADR 0024 §3). Workers
    // spawned by the brain receive this via env so only they can hit the
    // worker-namespaced IPC routes; rotates each restart so a leaked token
    // can't outlive the daemon process. 24 random bytes → 48 hex chars.
    const workerAuthToken = randomBytes(24).toString('hex');
    process.env['FACTORY5_WORKER_AUTH_TOKEN'] = workerAuthToken;
    handle = await startDaemon({
      host: endpoint.host,
      port: endpoint.port,
      workerAuthToken,
    });
  } catch (err) {
    if (err instanceof PidFileLockedError) {
      stdout.write(`factoryd: ${err.message}\n`);
      log.error(
        { ownerPid: err.ownerPid, pidFile: err.path },
        'pidfile locked — another daemon is running',
      );
      exit(2);
    }
    log.error({ err }, 'factoryd: start failed');
    exit(1);
  }
  log.info({ port: handle.port, pid: handle.pid }, 'factoryd started');

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

async function main(): Promise<void> {
  const parsed = parseArgs(argv.slice(2));
  if (parsed.showVersion) {
    stdout.write(`${VERSION}\n`);
    return;
  }
  if (parsed.showHelp) {
    printHelp();
    return;
  }

  if (parsed.mode === 'daemonize') {
    // The parent prints diagnostics; the detached child runs the actual daemon.
    try {
      const childPid = spawnDetached();
      stdout.write(`factoryd started (pid ${String(childPid)})\n`);
      exit(0);
    } catch (err) {
      stdout.write(`factoryd: daemonize failed: ${(err as Error).message}\n`);
      exit(1);
    }
  }

  await runForeground();
}

main().catch((err: unknown) => {
  // Logger may not be initialised yet on certain early failures.
  const msg = err instanceof Error ? err.message : String(err);
  stdout.write(`factoryd: unhandled error: ${msg}\n`);
  exit(1);
});
