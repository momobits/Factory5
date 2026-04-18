import { initLogger } from '@factory5/logger';
import {
  directiveNotifyResponseSchema,
  reloadConfigResponseSchema,
  sendResponseSchema,
  statusResponseSchema,
} from '@factory5/ipc';
import { newId, type Directive } from '@factory5/core';
import {
  openDatabase,
  runMigrations,
  directives as directivesQ,
  outbound,
  type Database,
} from '@factory5/state';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { Doorbell } from './doorbell.js';
import { buildIpcServer } from './server.js';

beforeAll(() => {
  initLogger({ processName: 'ipc-test', noFile: true, noConsole: true });
});

const STARTED_AT = new Date('2026-04-18T12:00:00Z').toISOString();

function freshDb(): Database {
  const db = openDatabase(':memory:');
  runMigrations(db);
  return db;
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

describe('IPC server', () => {
  let db: Database;
  let doorbell: Doorbell;

  beforeEach(() => {
    db = freshDb();
    doorbell = new Doorbell();
  });

  afterEach(() => {
    db.close();
  });

  it('GET /healthz returns 200 with { ok: true }', async () => {
    const app = buildIpcServer({
      host: '127.0.0.1',
      port: 0,
      db,
      doorbell,
      startedAt: STARTED_AT,
      version: '0.0.1',
      processName: 'factoryd-test',
    });
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    await app.close();
  });

  it('GET /status matches StatusResponse schema (empty channels)', async () => {
    const app = buildIpcServer({
      host: '127.0.0.1',
      port: 0,
      db,
      doorbell,
      startedAt: STARTED_AT,
      version: '0.0.1',
      processName: 'factoryd-test',
    });
    const res = await app.inject({ method: 'GET', url: '/status' });
    expect(res.statusCode).toBe(200);
    const parsed = statusResponseSchema.parse(res.json());
    expect(parsed.pid).toBe(process.pid);
    expect(parsed.channels).toEqual([]);
    expect(parsed.uptimeMs).toBeGreaterThanOrEqual(0);
    await app.close();
  });

  it('GET /status reports channels from the registry', async () => {
    const app = buildIpcServer({
      host: '127.0.0.1',
      port: 0,
      db,
      doorbell,
      startedAt: STARTED_AT,
      version: '0.0.1',
      processName: 'factoryd-test',
      channels: {
        list: () => [
          { id: 'cli', status: 'ready' },
          { id: 'discord', status: 'failed', lastError: 'token invalid' },
        ],
      },
    });
    const res = await app.inject({ method: 'GET', url: '/status' });
    const parsed = statusResponseSchema.parse(res.json());
    expect(parsed.channels).toHaveLength(2);
    expect(parsed.channels[0]?.status).toBe('ready');
    expect(parsed.channels[1]?.lastError).toBe('token invalid');
    await app.close();
  });

  it('POST /send enqueues an outbound message and emits outbound.new', async () => {
    let emitted: string | undefined;
    doorbell.on('outbound.new', ({ messageId }) => {
      emitted = messageId;
    });
    const app = buildIpcServer({
      host: '127.0.0.1',
      port: 0,
      db,
      doorbell,
      startedAt: STARTED_AT,
      version: '0.0.1',
      processName: 'factoryd-test',
    });
    const res = await app.inject({
      method: 'POST',
      url: '/send',
      payload: {
        targetChannel: 'cli',
        targetRef: 'session-1',
        text: 'hello',
      },
    });
    expect(res.statusCode).toBe(200);
    const parsed = sendResponseSchema.parse(res.json());
    expect(parsed.delivered).toBe(false);
    expect(parsed.messageId).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(emitted).toBe(parsed.messageId);

    // Queued in SQLite for a future channel delivery.
    const pending = outbound.listPending(db);
    expect(pending).toHaveLength(1);
    expect(pending[0]?.text).toBe('hello');
    await app.close();
  });

  it('POST /directives/notify rings the doorbell for existing directives', async () => {
    const directive = testDirective();
    directivesQ.insert(db, directive);

    let rung: { directiveId: string; reason: string } | undefined;
    doorbell.on('directive.new', (payload) => {
      rung = payload;
    });

    const app = buildIpcServer({
      host: '127.0.0.1',
      port: 0,
      db,
      doorbell,
      startedAt: STARTED_AT,
      version: '0.0.1',
      processName: 'factoryd-test',
    });
    const res = await app.inject({
      method: 'POST',
      url: '/directives/notify',
      payload: { directiveId: directive.id, reason: 'new' },
    });
    expect(res.statusCode).toBe(200);
    const parsed = directiveNotifyResponseSchema.parse(res.json());
    expect(parsed.acknowledged).toBe(true);
    expect(rung).toEqual({ directiveId: directive.id, reason: 'new' });
    await app.close();
  });

  it('POST /directives/notify 404s on unknown directive (with error envelope)', async () => {
    const app = buildIpcServer({
      host: '127.0.0.1',
      port: 0,
      db,
      doorbell,
      startedAt: STARTED_AT,
      version: '0.0.1',
      processName: 'factoryd-test',
    });
    const res = await app.inject({
      method: 'POST',
      url: '/directives/notify',
      payload: { directiveId: newId(), reason: 'new' },
    });
    expect(res.statusCode).toBe(404);
    const body = res.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe('DIRECTIVE_NOT_FOUND');
    await app.close();
  });

  it('POST /reload-config emits config.reloaded and returns envelope', async () => {
    let reloaded = false;
    doorbell.on('config.reloaded', () => {
      reloaded = true;
    });
    const app = buildIpcServer({
      host: '127.0.0.1',
      port: 0,
      db,
      doorbell,
      startedAt: STARTED_AT,
      version: '0.0.1',
      processName: 'factoryd-test',
    });
    const res = await app.inject({ method: 'POST', url: '/reload-config' });
    expect(res.statusCode).toBe(200);
    const parsed = reloadConfigResponseSchema.parse(res.json());
    expect(parsed.reloaded).toBe(true);
    expect(parsed.warnings).toEqual([]);
    expect(reloaded).toBe(true);
    await app.close();
  });

  it('POST /send rejects non-loopback requests', async () => {
    const app = buildIpcServer({
      host: '127.0.0.1',
      port: 0,
      db,
      doorbell,
      startedAt: STARTED_AT,
      version: '0.0.1',
      processName: 'factoryd-test',
    });
    const res = await app.inject({
      method: 'POST',
      url: '/send',
      payload: { targetChannel: 'cli', targetRef: 'session-1', text: 'hi' },
      remoteAddress: '10.0.0.5',
    });
    expect(res.statusCode).toBe(403);
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe('NON_LOCALHOST');
    await app.close();
  });

  it('POST /send returns 400 with error envelope on schema violation', async () => {
    const app = buildIpcServer({
      host: '127.0.0.1',
      port: 0,
      db,
      doorbell,
      startedAt: STARTED_AT,
      version: '0.0.1',
      processName: 'factoryd-test',
    });
    const res = await app.inject({
      method: 'POST',
      url: '/send',
      payload: { targetChannel: 'fax', targetRef: '', text: 'hi' },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe('SCHEMA_VALIDATION_FAILED');
    await app.close();
  });
});
