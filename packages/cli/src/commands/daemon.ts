/**
 * `factory daemon start | stop | status | restart` — lifecycle control for
 * factoryd. The CLI talks to the daemon via two mechanisms:
 *
 *   - Pidfile (for liveness probing) under the factory data directory
 *     (`<repo>/.factory/` repo-local, else `~/.factory/` fallback, on all
 *     platforms). `FACTORY5_PIDFILE` overrides.
 *   - Localhost HTTP at `127.0.0.1:25295` (`@factory5/ipc` client) for a
 *     responsiveness check on `factory daemon status`.
 */

import { spawn } from 'node:child_process';
import { accessSync, constants as fsConstants, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import process, { exit, stdout } from 'node:process';
import { fileURLToPath } from 'node:url';

import { reapStalePidFile, readPidFile } from '@factory5/daemon';
import { loadDaemonEndpoint } from '@factory5/brain';
import { createDaemonClient } from '@factory5/ipc';
import { createLogger } from '@factory5/logger';
import type { Command } from 'commander';

const log = createLogger('cli.daemon');

/** Wait budget (ms) for the daemon to come up after `start`. */
const START_WAIT_BUDGET_MS = 5_000;
/** Wait budget (ms) for the daemon pidfile to disappear after `stop`. */
const STOP_WAIT_BUDGET_MS = 10_000;

/**
 * Resolve the factoryd binary. Looks for an env override first, then walks
 * up from this module's location to find `apps/factoryd/dist/main.js`
 * (production build) or `apps/factoryd/src/main.ts` (dev/tsx). Prefers
 * the compiled output when both exist.
 */
function resolveFactorydBin(): string {
  const override = process.env['FACTORY5_FACTORYD_BIN'];
  if (override !== undefined && override.length > 0 && existsSync(override)) {
    return override;
  }
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 12; i++) {
    const distPath = join(dir, 'apps', 'factoryd', 'dist', 'main.js');
    if (existsSync(distPath)) return distPath;
    const srcPath = join(dir, 'apps', 'factoryd', 'src', 'main.ts');
    if (existsSync(srcPath)) return srcPath;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    'cannot find factoryd binary — set FACTORY5_FACTORYD_BIN or run from the factory5 repo',
  );
}

function waitPidAppears(
  pollMs = 100,
  budgetMs = START_WAIT_BUDGET_MS,
): Promise<number | undefined> {
  return new Promise((resolvePromise) => {
    const started = Date.now();
    const tick = (): void => {
      const info = readPidFile();
      if (info?.alive === true) {
        resolvePromise(info.pid);
        return;
      }
      if (Date.now() - started > budgetMs) {
        resolvePromise(undefined);
        return;
      }
      setTimeout(tick, pollMs);
    };
    tick();
  });
}

function waitPidGone(pollMs = 100, budgetMs = STOP_WAIT_BUDGET_MS): Promise<boolean> {
  return new Promise((resolvePromise) => {
    const started = Date.now();
    const tick = (): void => {
      const info = readPidFile();
      if (info === undefined || info.alive === false) {
        resolvePromise(true);
        return;
      }
      if (Date.now() - started > budgetMs) {
        resolvePromise(false);
        return;
      }
      setTimeout(tick, pollMs);
    };
    tick();
  });
}

async function startDaemon(): Promise<void> {
  const existing = readPidFile();
  if (existing?.alive === true) {
    stdout.write(`factoryd already running (pid ${String(existing.pid)})\n`);
    return;
  }

  const bin = resolveFactorydBin();
  const isTs = bin.endsWith('.ts');
  // .ts binary → run via tsx (dev path); compiled .js → run via node.
  const runner = isTs ? 'tsx' : process.execPath;
  const args = isTs ? [bin, '--foreground'] : [bin, '--foreground'];

  // For .ts we need tsx on the path. We rely on pnpm-installed tsx; if
  // a user runs `factory daemon start` outside the repo, they need a
  // compiled factoryd — the error message nudges them.
  let resolvedBin = runner;
  if (isTs) {
    // Resolve tsx binary relative to bin's nearest node_modules/.bin.
    resolvedBin = resolveBinOnPath('tsx') ?? 'tsx';
  }

  log.info({ bin, runner: resolvedBin, args }, 'spawning factoryd');
  const child = spawn(resolvedBin, args, {
    detached: true,
    stdio: 'ignore',
    env: process.env,
  });
  child.unref();
  if (child.pid === undefined) {
    stdout.write('factoryd: spawn returned no PID\n');
    exit(1);
  }

  const pid = await waitPidAppears();
  if (pid === undefined) {
    stdout.write(
      'factoryd: started but did not appear in pidfile within 5s — check logs with `factory daemon logs`\n',
    );
    exit(2);
  }
  stdout.write(`factoryd started (pid ${String(pid)})\n`);
}

async function stopDaemon(): Promise<void> {
  const info = readPidFile();
  if (info === undefined) {
    stdout.write('factoryd: no pidfile — daemon not running\n');
    return;
  }
  if (info.alive !== true) {
    stdout.write(`factoryd: stale pidfile for pid ${String(info.pid)} — cleaning up\n`);
    return;
  }
  log.info({ pid: info.pid }, 'sending SIGTERM to factoryd');
  try {
    process.kill(info.pid, 'SIGTERM');
  } catch (err) {
    stdout.write(`factoryd: kill failed: ${(err as Error).message}\n`);
    exit(1);
  }
  const gone = await waitPidGone();
  if (!gone) {
    stdout.write(`factoryd: did not exit within 10s — consider \`kill -9 ${String(info.pid)}\`\n`);
    exit(2);
  }
  // Phase 13.4 / U034 — Windows maps SIGTERM to TerminateProcess (hard
  // kill), so factoryd's shutdown handler never runs and the pidfile
  // stays on disk. Belt-and-suspenders: unlink it ourselves if it still
  // contains the killed PID. The same-PID predicate inside
  // reapStalePidFile handles the race where a fresh daemon spawned and
  // wrote its own PID between waitPidGone() and our cleanup.
  reapStalePidFile(info.pid);
  stdout.write(`factoryd stopped (pid ${String(info.pid)})\n`);
}

async function printStatus(): Promise<void> {
  const info = readPidFile();
  if (info === undefined) {
    stdout.write('factoryd: not running (no pidfile)\n');
    return;
  }
  if (info.alive !== true) {
    stdout.write(`factoryd: stale pidfile owner ${String(info.pid)} is dead\n`);
    return;
  }
  stdout.write(`factoryd: running (pid ${String(info.pid)})\n`);

  const endpoint = await loadDaemonEndpoint();
  const client = createDaemonClient({ ...endpoint, timeoutMs: 2000 });
  try {
    const status = await client.status();
    stdout.write(`  version:   ${status.version}\n`);
    stdout.write(`  process:   ${status.process}\n`);
    stdout.write(
      `  uptime:    ${(status.uptimeMs / 1000).toFixed(0)}s (started ${status.startedAt})\n`,
    );
    if (status.channels.length === 0) {
      stdout.write('  channels:  (none registered)\n');
    } else {
      stdout.write('  channels:\n');
      for (const c of status.channels) {
        const suffix = c.lastError !== undefined ? ` — ${c.lastError}` : '';
        stdout.write(`    - ${c.id}: ${c.status}${suffix}\n`);
      }
    }
  } catch (err) {
    stdout.write(`  (could not reach IPC on 127.0.0.1:25295 — ${(err as Error).message})\n`);
  }
}

async function restartDaemon(): Promise<void> {
  await stopDaemon();
  await startDaemon();
}

/**
 * Resolve a binary from the nearest `node_modules/.bin` walking up from the
 * current script. Used to find `tsx` for the dev path.
 */
function resolveBinOnPath(name: string): string | undefined {
  const exts = process.platform === 'win32' ? ['.cmd', '.exe', ''] : [''];
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 12; i++) {
    for (const ext of exts) {
      const p = join(dir, 'node_modules', '.bin', `${name}${ext}`);
      try {
        accessSync(p, fsConstants.X_OK);
        return resolve(p);
      } catch {
        // continue
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

export function registerDaemonCommand(program: Command): void {
  const daemon = program.command('daemon').description('daemon lifecycle');

  daemon
    .command('start')
    .description('spawn a detached factoryd if none is running')
    .addHelpText(
      'after',
      `
Examples:
  factory daemon start
  FACTORY5_FACTORYD_BIN=/path/to/factoryd factory daemon start
`,
    )
    .action(async () => {
      try {
        await startDaemon();
      } catch (err) {
        stdout.write(`factory daemon start: error: ${(err as Error).message}\n`);
        exit(1);
      }
    });

  daemon
    .command('stop')
    .description('gracefully terminate the running factoryd')
    .addHelpText(
      'after',
      `
Examples:
  factory daemon stop
`,
    )
    .action(async () => {
      try {
        await stopDaemon();
      } catch (err) {
        stdout.write(`factory daemon stop: error: ${(err as Error).message}\n`);
        exit(1);
      }
    });

  daemon
    .command('status')
    .description('print daemon liveness + IPC status')
    .addHelpText(
      'after',
      `
Examples:
  factory daemon status                # pidfile + IPC probe + channel list
`,
    )
    .action(async () => {
      try {
        await printStatus();
      } catch (err) {
        stdout.write(`factory daemon status: error: ${(err as Error).message}\n`);
        exit(1);
      }
    });

  daemon
    .command('restart')
    .description('stop then start factoryd')
    .addHelpText(
      'after',
      `
Examples:
  factory daemon restart               # picks up config.toml + env changes
`,
    )
    .action(async () => {
      try {
        await restartDaemon();
      } catch (err) {
        stdout.write(`factory daemon restart: error: ${(err as Error).message}\n`);
        exit(1);
      }
    });
}
