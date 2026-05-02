/**
 * `factory cancel <id>` — round-trip + unit tests (Phase 2.4).
 *
 * Same shape as `ui-token.test.ts`: spin up the real daemon's IPC server
 * on a random port, drive `runCancel` with a stub pidfile + endpoint
 * loader so the test owns the I/O surface. Exercises the daemon-mediated
 * path AND the DB-direct fallback.
 */

import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { _resetCancellationRegistry, registerCancellation } from '@factory5/brain';
import { newId, type Directive } from '@factory5/core';
import { Doorbell, startIpcServer } from '@factory5/daemon';
import type { IpcServerHandle } from '@factory5/daemon';
import { initLogger } from '@factory5/logger';
import {
  directives as directivesQ,
  openDatabase,
  runMigrations,
  type Database,
} from '@factory5/state';

import { CANCEL_EXIT, runCancel } from './cancel.js';

beforeAll(() => {
  initLogger({ processName: 'cli-cancel-test', noFile: true, noConsole: true });
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

function testDirective(): Directive {
  return {
    id: newId(),
    source: 'cli',
    principal: 'me',
    channelRef: 'ref-1',
    intent: 'build',
    payload: {},
    autonomy: 'assisted',
    createdAt: new Date().toISOString(),
    status: 'pending',
  };
}

async function startServer(db: Database): Promise<IpcServerHandle> {
  const doorbell = new Doorbell();
  return startIpcServer({
    host: '127.0.0.1',
    port: 0,
    db,
    doorbell,
    startedAt: STARTED_AT,
    version: '0.0.1',
    processName: 'factoryd-test',
  });
}

describe('factory cancel (Phase 2.4)', () => {
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
    _resetCancellationRegistry();
  });

  it('IPC happy path: daemon flips the row to failed and the brain controller fires', async () => {
    serverDb = freshDb();
    const directive = testDirective();
    directivesQ.insert(serverDb, directive);
    directivesQ.updateStatus(serverDb, directive.id, 'running');
    handle = await startServer(serverDb);

    // Pretend the brain claimed it (serve loop's registerCancellation pattern).
    const cancelHandle = registerCancellation(directive.id);

    const out = captureStdout();
    const code = await runCancel({
      directiveId: directive.id,
      reason: 'because',
      stdout: out,
      readPidFile: () => ({ pid: process.pid, alive: true }),
      loadEndpoint: async () => ({ host: '127.0.0.1', port: handle!.boundPort }),
    });

    expect(code).toBe(CANCEL_EXIT.OK);
    const text = out.text();
    expect(text).toMatch(/→ failed/);
    expect(text).toContain('worker abort signalled');
    expect(text).toContain('because');
    expect(cancelHandle.signal.aborted).toBe(true);

    const fresh = directivesQ.getById(serverDb, directive.id);
    expect(fresh?.status).toBe('failed');
    expect(fresh?.blockedReason).toBe('because');
    cancelHandle.release();
  });

  it('IPC: prints "no in-flight worker" when the brain registry has no controller for this id', async () => {
    serverDb = freshDb();
    const directive = testDirective();
    directivesQ.insert(serverDb, directive);
    directivesQ.updateStatus(serverDb, directive.id, 'running');
    handle = await startServer(serverDb);

    const out = captureStdout();
    const code = await runCancel({
      directiveId: directive.id,
      stdout: out,
      readPidFile: () => ({ pid: process.pid, alive: true }),
      loadEndpoint: async () => ({ host: '127.0.0.1', port: handle!.boundPort }),
    });

    expect(code).toBe(CANCEL_EXIT.OK);
    expect(out.text()).toContain('no in-flight worker');
  });

  it('IPC: returns NOT_FOUND for an unknown id', async () => {
    serverDb = freshDb();
    handle = await startServer(serverDb);

    const out = captureStdout();
    const code = await runCancel({
      directiveId: newId(),
      stdout: out,
      readPidFile: () => ({ pid: process.pid, alive: true }),
      loadEndpoint: async () => ({ host: '127.0.0.1', port: handle!.boundPort }),
    });

    expect(code).toBe(CANCEL_EXIT.NOT_FOUND);
    expect(out.text()).toContain('not found');
  });

  it('IPC: returns ALREADY_TERMINAL for a terminal directive', async () => {
    serverDb = freshDb();
    const directive = testDirective();
    directivesQ.insert(serverDb, directive);
    directivesQ.updateStatus(serverDb, directive.id, 'complete');
    handle = await startServer(serverDb);

    const out = captureStdout();
    const code = await runCancel({
      directiveId: directive.id,
      stdout: out,
      readPidFile: () => ({ pid: process.pid, alive: true }),
      loadEndpoint: async () => ({ host: '127.0.0.1', port: handle!.boundPort }),
    });

    expect(code).toBe(CANCEL_EXIT.ALREADY_TERMINAL);
    expect(out.text()).toContain('already complete');
  });

  it('DB-direct fallback: no daemon running → writes the row directly', async () => {
    const cliDb = freshDb();
    const directive = testDirective();
    directivesQ.insert(cliDb, directive);
    directivesQ.updateStatus(cliDb, directive.id, 'running');

    const out = captureStdout();
    const code = await runCancel({
      directiveId: directive.id,
      reason: 'manual',
      stdout: out,
      readPidFile: () => undefined,
      db: cliDb,
    });

    expect(code).toBe(CANCEL_EXIT.OK);
    const text = out.text();
    expect(text).toMatch(/→ failed/);
    expect(text).toContain('DB-direct write only');
    const fresh = directivesQ.getById(cliDb, directive.id);
    expect(fresh?.status).toBe('failed');
    expect(fresh?.blockedReason).toBe('manual');
    cliDb.close();
  });

  it('DB-direct fallback: returns NOT_FOUND for unknown id', async () => {
    const cliDb = freshDb();
    const out = captureStdout();
    const code = await runCancel({
      directiveId: newId(),
      stdout: out,
      readPidFile: () => undefined,
      db: cliDb,
    });
    expect(code).toBe(CANCEL_EXIT.NOT_FOUND);
    expect(out.text()).toContain('not found');
    cliDb.close();
  });

  it('IPC unreachable: falls through to DB-direct rather than failing hard', async () => {
    const cliDb = freshDb();
    const directive = testDirective();
    directivesQ.insert(cliDb, directive);
    directivesQ.updateStatus(cliDb, directive.id, 'running');

    const out = captureStdout();
    const code = await runCancel({
      directiveId: directive.id,
      stdout: out,
      // Pidfile lies — pretends the daemon is up at a port nothing's listening on.
      readPidFile: () => ({ pid: process.pid, alive: true }),
      loadEndpoint: async () => ({ host: '127.0.0.1', port: 1 }),
      db: cliDb,
    });

    expect(code).toBe(CANCEL_EXIT.OK);
    const text = out.text();
    expect(text).toContain('daemon unreachable');
    expect(text).toContain('DB-direct write only');
    const fresh = directivesQ.getById(cliDb, directive.id);
    expect(fresh?.status).toBe('failed');
    cliDb.close();
  });
});
