/**
 * `factory ui-token` — round-trip + unit tests (Phase 13.2).
 *
 * Spins up the real daemon's IPC server on a random port, then drives
 * `runUiToken` with stub overrides for the pidfile + endpoint loader so
 * the test owns the entire I/O surface. The IPC client + daemon route
 * + CLI command are exercised end-to-end.
 */

import { initLogger } from '@factory5/logger';
import { Doorbell, startIpcServer } from '@factory5/daemon';
import type { IpcServerHandle } from '@factory5/daemon';
import { openDatabase, runMigrations, type Database } from '@factory5/state';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { UI_TOKEN_EXIT, runUiToken } from './ui-token.js';

beforeAll(() => {
  initLogger({ processName: 'cli-ui-token-test', noFile: true, noConsole: true });
});

const STARTED_AT = new Date('2026-04-27T12:00:00Z').toISOString();

function freshDb(): Database {
  const db = openDatabase(':memory:');
  runMigrations(db);
  return db;
}

interface CapturedStdout {
  write(chunk: string): boolean;
  text(): string;
}

function captureStdout(): CapturedStdout {
  let buf = '';
  return {
    write(chunk: string) {
      buf += chunk;
      return true;
    },
    text() {
      return buf;
    },
  };
}

async function startServer(opts: {
  uiAuthToken?: string;
  webUiStaticPath?: string;
}): Promise<{ handle: IpcServerHandle; db: Database }> {
  const db = freshDb();
  const doorbell = new Doorbell();
  const handle = await startIpcServer({
    host: '127.0.0.1',
    port: 0,
    db,
    doorbell,
    startedAt: STARTED_AT,
    version: '0.0.1',
    processName: 'factoryd-test',
    ...(opts.uiAuthToken !== undefined ? { uiAuthToken: opts.uiAuthToken } : {}),
    ...(opts.webUiStaticPath !== undefined ? { webUiStaticPath: opts.webUiStaticPath } : {}),
  });
  return { handle, db };
}

describe('factory ui-token (Phase 13.2)', () => {
  let handle: IpcServerHandle | undefined;
  let serverDb: Database | undefined;

  afterEach(async () => {
    if (handle !== undefined) {
      await handle.stop();
      handle = undefined;
    }
    if (serverDb !== undefined) {
      serverDb.close();
      serverDb = undefined;
    }
  });

  it('exits 2 with a friendly message when no daemon is running', async () => {
    const out = captureStdout();
    const code = await runUiToken({
      stdout: out,
      readPidFile: () => undefined,
    });
    expect(code).toBe(UI_TOKEN_EXIT.DAEMON_NOT_RUNNING);
    expect(out.text()).toContain('no running daemon');
    expect(out.text()).toContain('factory daemon start');
  });

  it('exits 2 when pidfile exists but the process is dead', async () => {
    const out = captureStdout();
    const code = await runUiToken({
      stdout: out,
      readPidFile: () => ({ pid: 99999, alive: false }),
    });
    expect(code).toBe(UI_TOKEN_EXIT.DAEMON_NOT_RUNNING);
    expect(out.text()).toContain('no running daemon');
  });

  it('round-trips against the real daemon: prints URL with token when SPA bundle present', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'cli-ui-token-bundle-'));
    try {
      await writeFile(join(tmp, 'index.html'), '<!doctype html>');
      ({ handle, db: serverDb } = await startServer({
        uiAuthToken: 'live-token-abcdef',
        webUiStaticPath: tmp,
      }));

      const out = captureStdout();
      const code = await runUiToken({
        stdout: out,
        readPidFile: () => ({ pid: process.pid, alive: true }),
        loadEndpoint: async () => ({ host: '127.0.0.1', port: handle!.boundPort }),
      });
      expect(code).toBe(UI_TOKEN_EXIT.OK);
      const text = out.text();
      expect(text).toMatch(/http:\/\/127\.0\.0\.1:\d+\/app\/\?t=live-token-abcdef/);
      // No "SPA bundle missing" hint when bundle is present.
      expect(text).not.toContain('SPA bundle missing');
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('round-trips against the real daemon: prints dev-server URL + hint when SPA bundle missing', async () => {
    ({ handle, db: serverDb } = await startServer({ uiAuthToken: 'live-token-no-bundle' }));

    const out = captureStdout();
    const code = await runUiToken({
      stdout: out,
      readPidFile: () => ({ pid: process.pid, alive: true }),
      loadEndpoint: async () => ({ host: '127.0.0.1', port: handle!.boundPort }),
    });
    expect(code).toBe(UI_TOKEN_EXIT.OK);
    const text = out.text();
    expect(text).toContain('http://localhost:4321/app/?t=live-token-no-bundle');
    expect(text).toContain('SPA bundle missing');
    expect(text).toContain('pnpm --filter factory-web build');
  });

  it('--token-only prints just the bare token, no URL, no hint', async () => {
    ({ handle, db: serverDb } = await startServer({ uiAuthToken: 'just-the-token-please' }));

    const out = captureStdout();
    const code = await runUiToken({
      stdout: out,
      tokenOnly: true,
      readPidFile: () => ({ pid: process.pid, alive: true }),
      loadEndpoint: async () => ({ host: '127.0.0.1', port: handle!.boundPort }),
    });
    expect(code).toBe(UI_TOKEN_EXIT.OK);
    expect(out.text()).toBe('just-the-token-please\n');
  });

  it('exits 3 with a friendly message when daemon is running but UI is disabled', async () => {
    ({ handle, db: serverDb } = await startServer({})); // no uiAuthToken — UI_DISABLED

    const out = captureStdout();
    const code = await runUiToken({
      stdout: out,
      readPidFile: () => ({ pid: process.pid, alive: true }),
      loadEndpoint: async () => ({ host: '127.0.0.1', port: handle!.boundPort }),
    });
    expect(code).toBe(UI_TOKEN_EXIT.UI_DISABLED);
    expect(out.text()).toContain('CLI-only');
  });

  it('exits 1 with a generic message when the daemon is unreachable mid-call', async () => {
    // Point the client at a port that nothing is listening on.
    const out = captureStdout();
    const code = await runUiToken({
      stdout: out,
      readPidFile: () => ({ pid: process.pid, alive: true }),
      loadEndpoint: async () => ({ host: '127.0.0.1', port: 1 }), // privileged + unbound
    });
    expect(code).toBe(UI_TOKEN_EXIT.GENERIC_FAILURE);
    expect(out.text()).toContain('failed to reach daemon');
  });
});
