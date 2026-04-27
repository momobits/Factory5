import { newId, type OutboundMessage } from '@factory5/core';
import { createLogger, initLogger } from '@factory5/logger';
import {
  directives as directivesQ,
  openDatabase,
  outbound,
  pendingQuestions,
  runMigrations,
  type Database,
} from '@factory5/state';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { Doorbell } from './doorbell.js';
import { startOutboundWorker, type OutboundDeliveryResult } from './outbound-worker.js';

beforeAll(() => {
  initLogger({ processName: 'outbound-test', noFile: true, noConsole: true });
});

function freshDb(): Database {
  const db = openDatabase(':memory:');
  runMigrations(db);
  return db;
}

function queued(targetRef: string, text: string): OutboundMessage {
  return {
    id: newId(),
    targetChannel: 'cli',
    targetRef,
    text,
    createdAt: new Date().toISOString(),
    attempts: 0,
  };
}

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

describe('outbound worker', () => {
  let db: Database;
  let doorbell: Doorbell;
  const log = createLogger('test.outbound');

  beforeEach(() => {
    db = freshDb();
    doorbell = new Doorbell();
  });

  afterEach(() => {
    db.close();
  });

  it('delivers a queued message on the next pass and stamps delivered_at', async () => {
    outbound.enqueue(db, queued('sess-1', 'hello'));
    const deliver = vi.fn(
      async (): Promise<OutboundDeliveryResult> => ({ delivered: true, externalId: 'ext-1' }),
    );
    const w = startOutboundWorker({
      log,
      db,
      doorbell,
      deliver,
      pollIntervalMs: 20,
    });
    await sleep(80);
    await w.stop();

    expect(deliver).toHaveBeenCalledTimes(1);
    expect(outbound.listPending(db)).toHaveLength(0);
  });

  it('records a failure and increments attempts when the channel defers', async () => {
    const msg = queued('sess-1', 'hi');
    outbound.enqueue(db, msg);
    const deliver = vi.fn(
      async (): Promise<OutboundDeliveryResult> => ({
        delivered: false,
        error: 'no live session',
      }),
    );
    const w = startOutboundWorker({
      log,
      db,
      doorbell,
      deliver,
      pollIntervalMs: 20,
    });
    await sleep(60);
    await w.stop();

    const pending = outbound.listPending(db);
    expect(pending).toHaveLength(1);
    expect(pending[0]?.attempts).toBeGreaterThanOrEqual(1);
    expect(pending[0]?.lastError).toBe('no live session');
  });

  it('doorbell ring shortcuts the poll interval', async () => {
    let delivered = 0;
    const deliver = async (): Promise<OutboundDeliveryResult> => {
      delivered += 1;
      return { delivered: true };
    };
    const w = startOutboundWorker({
      log,
      db,
      doorbell,
      deliver,
      pollIntervalMs: 10_000,
    });
    // No messages yet — worker parked.
    await sleep(20);
    expect(delivered).toBe(0);

    outbound.enqueue(db, queued('sess-1', 'now'));
    doorbell.emit('outbound.new', { messageId: 'whatever' });

    const start = Date.now();
    while (delivered === 0 && Date.now() - start < 500) {
      await sleep(10);
    }
    expect(delivered).toBe(1);
    await w.stop();
  });

  it('honors maxAttempts — messages past the cap are skipped', async () => {
    // Pre-seed a message with attempts already at the cap.
    const msg = { ...queued('sess-1', 'dead'), attempts: 5 };
    outbound.enqueue(db, msg);

    const deliver = vi.fn(async (): Promise<OutboundDeliveryResult> => ({ delivered: true }));
    const w = startOutboundWorker({
      log,
      db,
      doorbell,
      deliver,
      pollIntervalMs: 20,
      maxAttempts: 5,
    });
    await sleep(60);
    await w.stop();

    expect(deliver).not.toHaveBeenCalled();
    // Row is still pending — no automatic dead-letter.
    expect(outbound.listPending(db)).toHaveLength(1);
  });

  it('stop() is idempotent and drains the current pass', async () => {
    const deliver = async (): Promise<OutboundDeliveryResult> => ({ delivered: true });
    const w = startOutboundWorker({ log, db, doorbell, deliver, pollIntervalMs: 20 });
    await w.stop();
    await w.stop();
  });

  it('stamps bot_message_id on the linked pending question (I012)', async () => {
    // When an outbound carries `metadata.questionId` (askUser/escalateBlocked
    // path) and the channel returns an externalId, the worker must record
    // that externalId on `pending_questions.bot_message_id` so the channel
    // matcher can later disambiguate Reply-feature answers.
    const directiveId = newId();
    const questionId = newId();
    directivesQ.insert(db, {
      id: directiveId,
      source: 'telegram',
      principal: '555',
      channelRef: '555#10',
      intent: 'build',
      payload: { project: 'p' },
      autonomy: 'autonomous',
      createdAt: new Date().toISOString(),
      status: 'running',
    });
    pendingQuestions.create(db, {
      id: questionId,
      directiveId,
      question: 'q',
      channel: 'telegram',
      channelRef: '555#10',
      createdAt: new Date().toISOString(),
    });
    const msg: OutboundMessage = {
      id: newId(),
      directiveId,
      targetChannel: 'telegram',
      targetRef: '555#10',
      text: 'q',
      metadata: { kind: 'ask_user', questionId },
      createdAt: new Date().toISOString(),
      attempts: 0,
    };
    outbound.enqueue(db, msg);
    const deliver = async (): Promise<OutboundDeliveryResult> => ({
      delivered: true,
      externalId: '200',
    });
    const w = startOutboundWorker({ log, db, doorbell, deliver, pollIntervalMs: 20 });
    await sleep(80);
    await w.stop();

    const stamped = pendingQuestions.getById(db, questionId);
    expect(stamped?.botMessageId).toBe('200');
  });

  it('skips the stamp when the outbound has no questionId metadata', async () => {
    // Most outbounds (chat replies, status messages, budget warnings) don't
    // carry questionId. Delivery should succeed without touching
    // pending_questions at all.
    outbound.enqueue(db, queued('555#10', 'plain reply'));
    const deliver = vi.fn(
      async (): Promise<OutboundDeliveryResult> => ({ delivered: true, externalId: '300' }),
    );
    const w = startOutboundWorker({ log, db, doorbell, deliver, pollIntervalMs: 20 });
    await sleep(60);
    await w.stop();

    expect(deliver).toHaveBeenCalledTimes(1);
    expect(outbound.listPending(db)).toHaveLength(0);
    // No question rows were touched (none existed).
  });
});
