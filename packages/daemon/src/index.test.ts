import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { initLogger } from '@factory5/logger';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { startDaemon } from './index.js';

beforeAll(() => {
  initLogger({ processName: 'daemon-test', noFile: true, noConsole: true });
});

/**
 * Options baseline used by every test in this file. Binds the IPC server to
 * an ephemeral port so parallel test runs don't collide on 25295, and uses an
 * in-memory DB so no disk state leaks between tests.
 */
function baseOpts(pidPath: string) {
  return {
    dbPath: ':memory:',
    pidFilePath: pidPath,
    port: 0,
    // These integration tests just exercise the lifecycle wiring: no brain,
    // no fs watcher, no background outbound polling against the temp DB.
    noBrain: true,
    noFsWatcher: true,
    noOutboundWorker: true,
    // Never read the user's real ~/.factory/config.toml — otherwise a user
    // with a Discord token configured would have these tests try to log into
    // Discord with live credentials on every run.
    noConfigFile: true,
  } as const;
}

describe('startDaemon', () => {
  let tmp: string;
  let pidPath: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'factory5-daemon-'));
    pidPath = join(tmp, 'factoryd.pid');
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('start + stop is clean with in-memory DB and isolated pidfile', async () => {
    const handle = await startDaemon(baseOpts(pidPath));
    expect(handle.pid).toBe(process.pid);
    expect(typeof handle.startedAt).toBe('string');
    expect(handle.port).toBeGreaterThan(0);
    await handle.stop();
    // Idempotent.
    await handle.stop();
  });

  it('refuses to start when a live daemon owns the pidfile', async () => {
    const first = await startDaemon(baseOpts(pidPath));
    const realPid = process.pid;
    Object.defineProperty(process, 'pid', { value: realPid + 99_999, configurable: true });
    try {
      await expect(startDaemon(baseOpts(pidPath))).rejects.toMatchObject({
        name: 'PidFileLockedError',
      });
    } finally {
      Object.defineProperty(process, 'pid', { value: realPid, configurable: true });
    }
    await first.stop();
  });

  it('pidfile is released after stop so a successor can start', async () => {
    const first = await startDaemon(baseOpts(pidPath));
    await first.stop();

    const second = await startDaemon(baseOpts(pidPath));
    await second.stop();
  });

  it('can start without the IPC server', async () => {
    const handle = await startDaemon({
      ...baseOpts(pidPath),
      noIpc: true,
    });
    // noIpc path: port is whatever the caller asked for (0 here).
    expect(handle.pid).toBe(process.pid);
    await handle.stop();
  });

  it('IPC server responds to /healthz when wired into the daemon', async () => {
    const handle = await startDaemon(baseOpts(pidPath));
    const res = await fetch(`http://127.0.0.1:${String(handle.port)}/healthz`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    await handle.stop();
  });
});
