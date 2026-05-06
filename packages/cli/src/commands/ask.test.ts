/**
 * `factory ask "<question>"` — unit tests (Phase 4.4).
 *
 * Drives `runAsk` directly against an in-memory DB. The chat REPL's
 * outbound-poll dance is shared via `submitOneDirective` (chat.ts) — these
 * tests cover the four observable outcomes (`reply`, `timeout`,
 * `terminal-no-reply`) crossed with the two output modes (text, `--json`).
 *
 * Reply-arrival timing is simulated two ways:
 *   - Pre-seeded `outbound_messages` row — the first poll iteration drains it.
 *   - Notify injection — the test's `notify` hook flips the directive's
 *     status mid-flight so the helper short-circuits to terminal-no-reply.
 */

import { newId, type OutboundMessage } from '@factory5/core';
import { initLogger } from '@factory5/logger';
import {
  directives as directivesQ,
  openDatabase,
  outbound,
  runMigrations,
  type Database,
} from '@factory5/state';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { runAsk } from './ask.js';

beforeAll(() => {
  initLogger({ processName: 'cli-ask-test', noFile: true, noConsole: true });
});

function freshDb(): Database {
  const db = openDatabase(':memory:');
  runMigrations(db);
  return db;
}

/**
 * Pre-seed an outbound row so the next `outbound.listPending` poll picks it
 * up. Mirrors what a real chat reply landing in the queue looks like.
 */
function enqueueReply(db: Database, sessionId: string, text: string): void {
  const msg: OutboundMessage = {
    id: newId(),
    targetChannel: 'cli',
    targetRef: sessionId,
    text,
    createdAt: new Date().toISOString(),
    attempts: 0,
  };
  outbound.enqueue(db, msg);
}

describe('runAsk (Phase 4.4)', () => {
  let db: Database;

  beforeEach(() => {
    db = freshDb();
  });
  afterEach(() => {
    db.close();
  });

  it('plain mode: prints the reply text on its own line, exit 0', async () => {
    // The session id used inside runAsk is the `ask-<ulid>`; we route the
    // reply by tagging the queue row to whatever session id the helper
    // generates. Inject `notify` so we can capture the directive id and
    // enqueue the reply against the helper's session id.
    let reply: string | undefined;
    const result = await runAsk(
      { question: 'what is the answer?' },
      {
        db,
        pollIntervalMs: 10,
        turnTimeoutMs: 2000,
        notify: async (directiveId) => {
          // Look up the directive to recover its channelRef (= sessionId).
          const d = directivesQ.getById(db, directiveId);
          if (d !== undefined) enqueueReply(db, d.channelRef, '42');
        },
      },
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('42\n');
    void reply;
  });

  it('--json mode: emits a single JSON object on stdout, exit 0', async () => {
    const result = await runAsk(
      { question: 'what is the answer?', json: true },
      {
        db,
        pollIntervalMs: 10,
        turnTimeoutMs: 2000,
        notify: async (directiveId) => {
          const d = directivesQ.getById(db, directiveId);
          if (d !== undefined) enqueueReply(db, d.channelRef, '42');
        },
      },
    );
    expect(result.exitCode).toBe(0);
    const lines = result.stdout.trim().split('\n');
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]!) as {
      directive: string;
      reply: string;
      status: string;
    };
    expect(parsed.directive).toMatch(/^[0-9A-Z]{26}$/);
    expect(parsed.reply).toBe('42');
    expect(parsed.status).toBe('reply');
  });

  it('plain mode: timeout exits 1 and prints a "timed out" message', async () => {
    const result = await runAsk(
      { question: 'no one answers' },
      { db, pollIntervalMs: 10, turnTimeoutMs: 50 },
    );
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain('timed out');
  });

  it('--json mode: timeout emits { reply: null, status: "timeout" } and exit 1', async () => {
    const result = await runAsk(
      { question: 'no one answers', json: true },
      { db, pollIntervalMs: 10, turnTimeoutMs: 50 },
    );
    expect(result.exitCode).toBe(1);
    const parsed = JSON.parse(result.stdout.trim()) as {
      directive: string;
      reply: string | null;
      status: string;
    };
    expect(parsed.reply).toBeNull();
    expect(parsed.status).toBe('timeout');
  });

  it('plain mode: terminal-no-reply (directive failed mid-flight) exits 1', async () => {
    const result = await runAsk(
      { question: 'flips while running' },
      {
        db,
        pollIntervalMs: 10,
        turnTimeoutMs: 2000,
        notify: async (directiveId) => {
          // No outbound row enqueued; flip directive to failed instead.
          directivesQ.updateStatus(db, directiveId, 'failed');
        },
      },
    );
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain('failed');
  });

  it('--json mode: terminal-no-reply emits status="terminal-no-reply"', async () => {
    const result = await runAsk(
      { question: 'flips while running', json: true },
      {
        db,
        pollIntervalMs: 10,
        turnTimeoutMs: 2000,
        notify: async (directiveId) => {
          directivesQ.updateStatus(db, directiveId, 'complete');
        },
      },
    );
    expect(result.exitCode).toBe(1);
    const parsed = JSON.parse(result.stdout.trim()) as {
      directive: string;
      reply: string | null;
      status: string;
      directiveStatus?: string;
    };
    expect(parsed.reply).toBeNull();
    expect(parsed.status).toBe('terminal-no-reply');
    expect(parsed.directiveStatus).toBe('complete');
  });

  it('--json reply contains the resolved directive id', async () => {
    let captured: string | undefined;
    const result = await runAsk(
      { question: 'capture the id', json: true },
      {
        db,
        pollIntervalMs: 10,
        turnTimeoutMs: 2000,
        notify: async (directiveId) => {
          captured = directiveId;
          const d = directivesQ.getById(db, directiveId);
          if (d !== undefined) enqueueReply(db, d.channelRef, 'reply text');
        },
      },
    );
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout.trim()) as { directive: string };
    expect(parsed.directive).toBe(captured);
  });
});
