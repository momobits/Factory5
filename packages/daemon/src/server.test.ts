import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { initLogger } from '@factory5/logger';
import {
  directiveNotifyResponseSchema,
  IpcRequestError,
  reloadConfigResponseSchema,
  sendResponseSchema,
  statusResponseSchema,
} from '@factory5/ipc';
import { newId, type Directive, type PendingQuestion } from '@factory5/core';
import {
  openDatabase,
  runMigrations,
  directives as directivesQ,
  outbound,
  pendingQuestions,
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
    const app = await buildIpcServer({
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
    const app = await buildIpcServer({
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
    const app = await buildIpcServer({
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
    const app = await buildIpcServer({
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

    const app = await buildIpcServer({
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
    const app = await buildIpcServer({
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
    const app = await buildIpcServer({
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
    const app = await buildIpcServer({
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
    const app = await buildIpcServer({
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

describe('IPC server — POST /worker/ask-user (ADR 0024)', () => {
  let db: Database;
  let doorbell: Doorbell;

  beforeEach(() => {
    db = freshDb();
    doorbell = new Doorbell();
  });

  afterEach(() => {
    db.close();
  });

  async function makeApp(overrides: {
    workerAskUser?: (req: unknown) => Promise<unknown>;
    workerAuthToken?: string;
  }) {
    return buildIpcServer({
      host: '127.0.0.1',
      port: 0,
      db,
      doorbell,
      startedAt: STARTED_AT,
      version: '0.0.1',
      processName: 'factoryd-test',
      ...(overrides.workerAskUser !== undefined
        ? {
            workerAskUser: overrides.workerAskUser as Parameters<
              typeof buildIpcServer
            >[0]['workerAskUser'],
          }
        : {}),
      ...(overrides.workerAuthToken !== undefined
        ? { workerAuthToken: overrides.workerAuthToken }
        : {}),
    });
  }

  function validRequestBody(): {
    taskId: string;
    directiveId: string;
    question: string;
  } {
    return {
      taskId: newId(),
      directiveId: newId(),
      question: 'jwt or session?',
    };
  }

  it('happy path: handler is invoked, response is returned', async () => {
    const questionId = newId();
    const handler = async (): Promise<{
      questionId: string;
      answer: string;
      timedOut: boolean;
      aborted: boolean;
    }> => ({ questionId, answer: 'jwt', timedOut: false, aborted: false });
    const app = await makeApp({ workerAskUser: handler });
    const res = await app.inject({
      method: 'POST',
      url: '/worker/ask-user',
      payload: validRequestBody(),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { questionId: string; answer: string };
    expect(body.questionId).toBe(questionId);
    expect(body.answer).toBe('jwt');
    await app.close();
  });

  it('happy path: timed-out response (no answer)', async () => {
    const questionId = newId();
    const handler = async (): Promise<{
      questionId: string;
      timedOut: boolean;
      aborted: boolean;
    }> => ({ questionId, timedOut: true, aborted: false });
    const app = await makeApp({ workerAskUser: handler });
    const res = await app.inject({
      method: 'POST',
      url: '/worker/ask-user',
      payload: validRequestBody(),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      questionId: string;
      answer?: string;
      timedOut: boolean;
    };
    expect(body.questionId).toBe(questionId);
    expect(body.timedOut).toBe(true);
    expect(body.answer).toBeUndefined();
    await app.close();
  });

  it('returns 503 WORKER_ASK_USER_DISABLED when handler is not configured', async () => {
    const app = await makeApp({});
    const res = await app.inject({
      method: 'POST',
      url: '/worker/ask-user',
      payload: validRequestBody(),
    });
    expect(res.statusCode).toBe(503);
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe('WORKER_ASK_USER_DISABLED');
    await app.close();
  });

  it('returns 401 WORKER_AUTH_REQUIRED when token is set and bearer is missing', async () => {
    const handler = async (): Promise<{
      questionId: string;
      answer: string;
      timedOut: boolean;
      aborted: boolean;
    }> => ({ questionId: newId(), answer: 'jwt', timedOut: false, aborted: false });
    const app = await makeApp({ workerAskUser: handler, workerAuthToken: 'secret-token-xyz' });
    const res = await app.inject({
      method: 'POST',
      url: '/worker/ask-user',
      payload: validRequestBody(),
    });
    expect(res.statusCode).toBe(401);
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe('WORKER_AUTH_REQUIRED');
    await app.close();
  });

  it('returns 401 when bearer token is wrong', async () => {
    const handler = async (): Promise<{
      questionId: string;
      answer: string;
      timedOut: boolean;
      aborted: boolean;
    }> => ({ questionId: newId(), answer: 'jwt', timedOut: false, aborted: false });
    const app = await makeApp({ workerAskUser: handler, workerAuthToken: 'secret-token-xyz' });
    const res = await app.inject({
      method: 'POST',
      url: '/worker/ask-user',
      headers: { authorization: 'Bearer wrong-token-here' },
      payload: validRequestBody(),
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('accepts the request when bearer token matches', async () => {
    const handler = async (): Promise<{
      questionId: string;
      answer: string;
      timedOut: boolean;
      aborted: boolean;
    }> => ({ questionId: newId(), answer: 'jwt', timedOut: false, aborted: false });
    const app = await makeApp({ workerAskUser: handler, workerAuthToken: 'secret-token-xyz' });
    const res = await app.inject({
      method: 'POST',
      url: '/worker/ask-user',
      headers: { authorization: 'Bearer secret-token-xyz' },
      payload: validRequestBody(),
    });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it('returns 400 SCHEMA_VALIDATION_FAILED when taskId is missing', async () => {
    const handler = async (): Promise<{
      questionId: string;
      answer: string;
      timedOut: boolean;
      aborted: boolean;
    }> => ({ questionId: newId(), answer: 'x', timedOut: false, aborted: false });
    const app = await makeApp({ workerAskUser: handler });
    const res = await app.inject({
      method: 'POST',
      url: '/worker/ask-user',
      payload: { directiveId: newId(), question: 'pick one' },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe('SCHEMA_VALIDATION_FAILED');
    await app.close();
  });

  it('returns 401 before parsing body — unauthenticated callers cannot probe schema', async () => {
    const handler = async (): Promise<{
      questionId: string;
      answer: string;
      timedOut: boolean;
      aborted: boolean;
    }> => ({ questionId: newId(), answer: 'x', timedOut: false, aborted: false });
    const app = await makeApp({ workerAskUser: handler, workerAuthToken: 'secret-token-xyz' });
    const res = await app.inject({
      method: 'POST',
      url: '/worker/ask-user',
      payload: { utterly: 'malformed' },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('propagates IpcRequestError from the handler as a typed envelope', async () => {
    const handler = async (): Promise<never> => {
      throw new IpcRequestError(404, 'TASK_NOT_FOUND', 'no such task');
    };
    const app = await makeApp({ workerAskUser: handler });
    const res = await app.inject({
      method: 'POST',
      url: '/worker/ask-user',
      payload: validRequestBody(),
    });
    expect(res.statusCode).toBe(404);
    const body = res.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe('TASK_NOT_FOUND');
    expect(body.error.message).toBe('no such task');
    await app.close();
  });
});

describe('IPC server — GET /api/v1/status (ADR 0025)', () => {
  let db: Database;
  let doorbell: Doorbell;

  beforeEach(() => {
    db = freshDb();
    doorbell = new Doorbell();
  });

  afterEach(() => {
    db.close();
  });

  const baseOpts = (): Parameters<typeof buildIpcServer>[0] => ({
    host: '127.0.0.1',
    port: 0,
    db,
    doorbell,
    startedAt: STARTED_AT,
    version: '0.0.1',
    processName: 'factoryd-test',
  });

  it('returns 503 UI_DISABLED when uiAuthToken is not configured', async () => {
    const app = await buildIpcServer(baseOpts());
    const res = await app.inject({ method: 'GET', url: '/api/v1/status' });
    expect(res.statusCode).toBe(503);
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe('UI_DISABLED');
    await app.close();
  });

  it('returns 401 UI_AUTH_REQUIRED when bearer is missing', async () => {
    const app = await buildIpcServer({ ...baseOpts(), uiAuthToken: 'ui-secret-xyz' });
    const res = await app.inject({ method: 'GET', url: '/api/v1/status' });
    expect(res.statusCode).toBe(401);
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe('UI_AUTH_REQUIRED');
    await app.close();
  });

  it('returns 401 when bearer is wrong', async () => {
    const app = await buildIpcServer({ ...baseOpts(), uiAuthToken: 'ui-secret-xyz' });
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/status',
      headers: { authorization: 'Bearer wrong-token' },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('returns 200 with StatusResponse shape when bearer matches', async () => {
    const app = await buildIpcServer({ ...baseOpts(), uiAuthToken: 'ui-secret-xyz' });
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/status',
      headers: { authorization: 'Bearer ui-secret-xyz' },
    });
    expect(res.statusCode).toBe(200);
    const parsed = statusResponseSchema.parse(res.json());
    expect(parsed.pid).toBe(process.pid);
    expect(parsed.process).toBe('factoryd-test');
    expect(parsed.channels).toEqual([]);
    await app.close();
  });

  it('rejects non-loopback requests before checking bearer', async () => {
    const app = await buildIpcServer({ ...baseOpts(), uiAuthToken: 'ui-secret-xyz' });
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/status',
      headers: { authorization: 'Bearer ui-secret-xyz' },
      remoteAddress: '10.0.0.5',
    });
    expect(res.statusCode).toBe(403);
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe('NON_LOCALHOST');
    await app.close();
  });
});

describe('IPC server — /app/* static serve (ADR 0025)', () => {
  let db: Database;
  let doorbell: Doorbell;

  beforeEach(() => {
    db = freshDb();
    doorbell = new Doorbell();
  });

  afterEach(() => {
    db.close();
  });

  it('serves index.html from webUiStaticPath when set', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'factory5-ui-'));
    try {
      await writeFile(join(tmp, 'index.html'), '<!doctype html><html>hi</html>');
      const app = await buildIpcServer({
        host: '127.0.0.1',
        port: 0,
        db,
        doorbell,
        startedAt: STARTED_AT,
        version: '0.0.1',
        processName: 'factoryd-test',
        webUiStaticPath: tmp,
      });
      const res = await app.inject({ method: 'GET', url: '/app/index.html' });
      expect(res.statusCode).toBe(200);
      expect(res.body).toContain('<html>hi</html>');
      await app.close();
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('returns 404 for /app/* when webUiStaticPath is unset', async () => {
    const app = await buildIpcServer({
      host: '127.0.0.1',
      port: 0,
      db,
      doorbell,
      startedAt: STARTED_AT,
      version: '0.0.1',
      processName: 'factoryd-test',
    });
    const res = await app.inject({ method: 'GET', url: '/app/index.html' });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('static serve does not require a bearer (shell is open; /api/v1/* is gated)', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'factory5-ui-'));
    try {
      await writeFile(join(tmp, 'index.html'), '<!doctype html>');
      const app = await buildIpcServer({
        host: '127.0.0.1',
        port: 0,
        db,
        doorbell,
        startedAt: STARTED_AT,
        version: '0.0.1',
        processName: 'factoryd-test',
        webUiStaticPath: tmp,
        uiAuthToken: 'ui-secret-xyz',
      });
      const res = await app.inject({ method: 'GET', url: '/app/index.html' });
      expect(res.statusCode).toBe(200);
      await app.close();
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('static serve still respects the loopback preHandler', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'factory5-ui-'));
    try {
      await writeFile(join(tmp, 'index.html'), '<!doctype html>');
      const app = await buildIpcServer({
        host: '127.0.0.1',
        port: 0,
        db,
        doorbell,
        startedAt: STARTED_AT,
        version: '0.0.1',
        processName: 'factoryd-test',
        webUiStaticPath: tmp,
      });
      const res = await app.inject({
        method: 'GET',
        url: '/app/index.html',
        remoteAddress: '10.0.0.5',
      });
      expect(res.statusCode).toBe(403);
      await app.close();
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});

describe('IPC server — /api/v1/directives (ADR 0025, sub-step 9.4)', () => {
  let db: Database;
  let doorbell: Doorbell;

  beforeEach(() => {
    db = freshDb();
    doorbell = new Doorbell();
  });

  afterEach(() => {
    db.close();
  });

  const UI_TOKEN = 'ui-secret-xyz';

  function seedDirectives(n: number, overrides: Partial<Directive> = {}): Directive[] {
    const out: Directive[] = [];
    for (let i = 0; i < n; i++) {
      const d: Directive = {
        ...testDirective(),
        // stagger createdAt so ORDER BY DESC is deterministic
        createdAt: new Date(2026, 3, 23, 12, 0, i).toISOString(),
        ...overrides,
      };
      directivesQ.insert(db, d);
      out.push(d);
    }
    return out;
  }

  const baseOpts = (): Parameters<typeof buildIpcServer>[0] => ({
    host: '127.0.0.1',
    port: 0,
    db,
    doorbell,
    startedAt: STARTED_AT,
    version: '0.0.1',
    processName: 'factoryd-test',
    uiAuthToken: UI_TOKEN,
  });

  it('GET /api/v1/directives returns 401 without bearer', async () => {
    const app = await buildIpcServer(baseOpts());
    const res = await app.inject({ method: 'GET', url: '/api/v1/directives' });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('GET /api/v1/directives returns 503 UI_DISABLED when token unset', async () => {
    const app = await buildIpcServer({
      ...baseOpts(),
      uiAuthToken: undefined,
    });
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/directives',
      headers: { authorization: `Bearer ${UI_TOKEN}` },
    });
    expect(res.statusCode).toBe(503);
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe('UI_DISABLED');
    await app.close();
  });

  it('GET /api/v1/directives returns newest first, default limit 20', async () => {
    const seeded = seedDirectives(3);
    const app = await buildIpcServer(baseOpts());
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/directives',
      headers: { authorization: `Bearer ${UI_TOKEN}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      items: Array<{ id: string }>;
      total: number;
      limit: number;
      offset: number;
    };
    expect(body.total).toBe(3);
    expect(body.limit).toBe(20);
    expect(body.offset).toBe(0);
    expect(body.items.map((d) => d.id)).toEqual(seeded.map((d) => d.id).reverse());
    await app.close();
  });

  it('GET /api/v1/directives honours limit + offset', async () => {
    const seeded = seedDirectives(5);
    const app = await buildIpcServer(baseOpts());
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/directives?limit=2&offset=1',
      headers: { authorization: `Bearer ${UI_TOKEN}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { items: Array<{ id: string }>; total: number };
    expect(body.total).toBe(5);
    // newest-first: [4, 3, 2, 1, 0]; offset 1, limit 2 → [3, 2]
    expect(body.items.map((d) => d.id)).toEqual([seeded[3]?.id, seeded[2]?.id]);
    await app.close();
  });

  it('GET /api/v1/directives filters by status', async () => {
    seedDirectives(2, { status: 'pending' });
    const [running] = seedDirectives(1, { status: 'running' });
    const app = await buildIpcServer(baseOpts());
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/directives?status=running',
      headers: { authorization: `Bearer ${UI_TOKEN}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { items: Array<{ id: string; status: string }>; total: number };
    expect(body.total).toBe(1);
    expect(body.items[0]?.id).toBe(running?.id);
    expect(body.items[0]?.status).toBe('running');
    await app.close();
  });

  it('GET /api/v1/directives returns 400 on invalid limit', async () => {
    const app = await buildIpcServer(baseOpts());
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/directives?limit=9999',
      headers: { authorization: `Bearer ${UI_TOKEN}` },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe('SCHEMA_VALIDATION_FAILED');
    await app.close();
  });

  it('GET /api/v1/directives/:id returns 404 for unknown id', async () => {
    const app = await buildIpcServer(baseOpts());
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/directives/${newId()}`,
      headers: { authorization: `Bearer ${UI_TOKEN}` },
    });
    expect(res.statusCode).toBe(404);
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe('DIRECTIVE_NOT_FOUND');
    await app.close();
  });

  it('GET /api/v1/directives/:id returns directive + timeline', async () => {
    const [directive] = seedDirectives(1);
    if (directive === undefined) throw new Error('seed failed');
    const app = await buildIpcServer(baseOpts());
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/directives/${directive.id}`,
      headers: { authorization: `Bearer ${UI_TOKEN}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      directive: { id: string };
      timeline: {
        tasks: unknown[];
        openQuestions: unknown[];
        modelUsage: { totalCostUsd: number; callCount: number };
      };
    };
    expect(body.directive.id).toBe(directive.id);
    expect(body.timeline.tasks).toEqual([]);
    expect(body.timeline.openQuestions).toEqual([]);
    expect(body.timeline.modelUsage).toEqual({ totalCostUsd: 0, callCount: 0 });
    await app.close();
  });

  it('GET /api/v1/directives/:id returns 401 without bearer', async () => {
    const [directive] = seedDirectives(1);
    if (directive === undefined) throw new Error('seed failed');
    const app = await buildIpcServer(baseOpts());
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/directives/${directive.id}`,
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});

describe('IPC server — /api/v1/pending-questions (ADR 0025, sub-step 9.5)', () => {
  let db: Database;
  let doorbell: Doorbell;

  beforeEach(() => {
    db = freshDb();
    doorbell = new Doorbell();
  });

  afterEach(() => {
    db.close();
  });

  const UI_TOKEN = 'ui-secret-xyz';

  const baseOpts = (): Parameters<typeof buildIpcServer>[0] => ({
    host: '127.0.0.1',
    port: 0,
    db,
    doorbell,
    startedAt: STARTED_AT,
    version: '0.0.1',
    processName: 'factoryd-test',
    uiAuthToken: UI_TOKEN,
  });

  function seedQuestions(
    count: number,
    overrides: Partial<PendingQuestion> = {},
  ): PendingQuestion[] {
    const out: PendingQuestion[] = [];
    for (let i = 0; i < count; i++) {
      // Each question needs a real directive row (FK). Either the caller
      // supplied a shared directiveId (assumed already-inserted) or we mint
      // one per question.
      let directiveId = overrides.directiveId;
      if (directiveId === undefined) {
        const d = testDirective();
        directivesQ.insert(db, d);
        directiveId = d.id;
      }
      const q: PendingQuestion = {
        id: newId(),
        directiveId,
        question: `question ${i}`,
        channel: 'cli',
        channelRef: 'session-1',
        createdAt: new Date(2026, 3, 23, 12, 0, i).toISOString(),
        ...overrides,
        directiveId,
      };
      pendingQuestions.create(db, q);
      out.push(q);
    }
    return out;
  }

  it('GET /api/v1/pending-questions returns 401 without bearer', async () => {
    const app = await buildIpcServer(baseOpts());
    const res = await app.inject({ method: 'GET', url: '/api/v1/pending-questions' });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('GET /api/v1/pending-questions defaults to status=open', async () => {
    const seeded = seedQuestions(3);
    const first = seeded[0];
    if (first === undefined) throw new Error('seed failed');
    pendingQuestions.answer(db, first.id, 'yes', new Date().toISOString());
    const app = await buildIpcServer(baseOpts());
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/pending-questions',
      headers: { authorization: `Bearer ${UI_TOKEN}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      items: Array<{ id: string }>;
      total: number;
      status: string;
    };
    expect(body.status).toBe('open');
    expect(body.total).toBe(2);
    expect(body.items.find((q) => q.id === first.id)).toBeUndefined();
    await app.close();
  });

  it('GET /api/v1/pending-questions?status=answered filters to answered', async () => {
    const seeded = seedQuestions(2);
    const first = seeded[0];
    if (first === undefined) throw new Error('seed failed');
    pendingQuestions.answer(db, first.id, 'x', new Date().toISOString());
    const app = await buildIpcServer(baseOpts());
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/pending-questions?status=answered',
      headers: { authorization: `Bearer ${UI_TOKEN}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { items: Array<{ id: string }>; total: number };
    expect(body.total).toBe(1);
    expect(body.items[0]?.id).toBe(first.id);
    await app.close();
  });

  it('GET /api/v1/pending-questions?status=all returns both', async () => {
    const seeded = seedQuestions(3);
    const first = seeded[0];
    if (first === undefined) throw new Error('seed failed');
    pendingQuestions.answer(db, first.id, 'x', new Date().toISOString());
    const app = await buildIpcServer(baseOpts());
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/pending-questions?status=all',
      headers: { authorization: `Bearer ${UI_TOKEN}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { total: number };
    expect(body.total).toBe(3);
    await app.close();
  });

  it('GET /api/v1/pending-questions?directiveId= scopes to that directive', async () => {
    // Seed a shared directive first so the FK holds for the targeted questions.
    const sharedDirective = testDirective();
    directivesQ.insert(db, sharedDirective);
    seedQuestions(2, { directiveId: sharedDirective.id });
    seedQuestions(3); // other directives, minted per-question
    const app = await buildIpcServer(baseOpts());
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/pending-questions?directiveId=${sharedDirective.id}&status=all`,
      headers: { authorization: `Bearer ${UI_TOKEN}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      items: Array<{ directiveId: string }>;
      total: number;
    };
    expect(body.total).toBe(2);
    expect(body.items.every((q) => q.directiveId === sharedDirective.id)).toBe(true);
    await app.close();
  });

  it('GET /api/v1/pending-questions/:id returns 404 for unknown id', async () => {
    const app = await buildIpcServer(baseOpts());
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/pending-questions/${newId()}`,
      headers: { authorization: `Bearer ${UI_TOKEN}` },
    });
    expect(res.statusCode).toBe(404);
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe('QUESTION_NOT_FOUND');
    await app.close();
  });

  it('GET /api/v1/pending-questions/:id returns the question envelope', async () => {
    const [seeded] = seedQuestions(1);
    if (seeded === undefined) throw new Error('seed failed');
    const app = await buildIpcServer(baseOpts());
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/pending-questions/${seeded.id}`,
      headers: { authorization: `Bearer ${UI_TOKEN}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { question: { id: string; question: string } };
    expect(body.question.id).toBe(seeded.id);
    expect(body.question.question).toBe(seeded.question);
    await app.close();
  });
});
