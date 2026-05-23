import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { _resetCancellationRegistry, registerCancellation } from '@factory5/brain';
import { initLogger } from '@factory5/logger';
import {
  cancelDirectiveResponseSchema,
  directiveNotifyResponseSchema,
  IpcRequestError,
  reloadConfigResponseSchema,
  sendResponseSchema,
  statusResponseSchema,
  uiTokenResponseSchema,
} from '@factory5/ipc';
import { newId, type Directive, type Finding, type PendingQuestion } from '@factory5/core';
import {
  openDatabase,
  runMigrations,
  directiveLogLines,
  directives as directivesQ,
  findingsRegistry,
  modelUsage,
  outbound,
  pendingQuestions,
  projects as projectsQ,
  tasksInflight,
  type Database,
  type InflightTask,
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

describe('IPC server — GET /ui-token (Phase 13.2)', () => {
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
    const res = await app.inject({ method: 'GET', url: '/ui-token' });
    expect(res.statusCode).toBe(503);
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe('UI_DISABLED');
    await app.close();
  });

  it('returns 200 + token + url + hasStaticBundle:true when SPA bundle is configured', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'factory5-ui-token-'));
    try {
      await writeFile(join(tmp, 'index.html'), '<!doctype html>');
      const app = await buildIpcServer({
        ...baseOpts(),
        uiAuthToken: 'ui-token-xyz',
        webUiStaticPath: tmp,
      });
      const res = await app.inject({ method: 'GET', url: '/ui-token' });
      expect(res.statusCode).toBe(200);
      const parsed = uiTokenResponseSchema.parse(res.json());
      expect(parsed.token).toBe('ui-token-xyz');
      expect(parsed.hasStaticBundle).toBe(true);
      expect(parsed.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/app\/\?t=ui-token-xyz$/);
      await app.close();
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('returns hasStaticBundle:false + dev-server URL when SPA bundle missing', async () => {
    const app = await buildIpcServer({ ...baseOpts(), uiAuthToken: 'ui-token-no-bundle' });
    const res = await app.inject({ method: 'GET', url: '/ui-token' });
    expect(res.statusCode).toBe(200);
    const parsed = uiTokenResponseSchema.parse(res.json());
    expect(parsed.token).toBe('ui-token-no-bundle');
    expect(parsed.hasStaticBundle).toBe(false);
    expect(parsed.url).toBe('http://localhost:4321/app/?t=ui-token-no-bundle');
    await app.close();
  });

  it('does not require a bearer token (loopback-only is the auth boundary)', async () => {
    // Same threat model as `/status` — bearer-less is intentional. The
    // route's defense is the preHandler IP guard plus same-origin policy
    // on the response.
    const app = await buildIpcServer({ ...baseOpts(), uiAuthToken: 'ui-token-abc' });
    const res = await app.inject({
      method: 'GET',
      url: '/ui-token',
      // No Authorization header.
    });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it('rejects non-loopback requests', async () => {
    const app = await buildIpcServer({ ...baseOpts(), uiAuthToken: 'ui-token-net' });
    const res = await app.inject({
      method: 'GET',
      url: '/ui-token',
      remoteAddress: '10.0.0.5',
    });
    expect(res.statusCode).toBe(403);
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe('NON_LOCALHOST');
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

describe('IPC server — /api/v1/spend (ADR 0025, sub-step 9.6)', () => {
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

  function seedSpend(): { directiveId: string } {
    const d = testDirective();
    directivesQ.insert(db, d);
    modelUsage.record(db, {
      id: newId(),
      directiveId: d.id,
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      category: 'planning',
      mode: 'call',
      inputTokens: 100,
      outputTokens: 50,
      costUsd: 0.02,
      durationMs: 1200,
      calledAt: '2026-04-23T12:00:00.000Z',
    });
    modelUsage.record(db, {
      id: newId(),
      directiveId: d.id,
      provider: 'anthropic',
      model: 'claude-opus-4-7',
      category: 'deep',
      mode: 'stream',
      inputTokens: 500,
      outputTokens: 200,
      costUsd: 0.15,
      durationMs: 5000,
      calledAt: '2026-04-23T12:05:00.000Z',
    });
    return { directiveId: d.id };
  }

  it('GET /api/v1/spend returns 401 without bearer', async () => {
    const app = await buildIpcServer(baseOpts());
    const res = await app.inject({ method: 'GET', url: '/api/v1/spend' });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('GET /api/v1/spend returns all five rollups + echoed filter on empty db', async () => {
    const app = await buildIpcServer(baseOpts());
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/spend',
      headers: { authorization: `Bearer ${UI_TOKEN}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      perProject: unknown[];
      perDirective: unknown[];
      perDay: unknown[];
      perDayPerProject: unknown[];
      perModel: unknown[];
      filter: Record<string, unknown>;
    };
    expect(body.perProject).toEqual([]);
    expect(body.perDirective).toEqual([]);
    expect(body.perDay).toEqual([]);
    expect(body.perDayPerProject).toEqual([]);
    expect(body.perModel).toEqual([]);
    expect(body.filter).toEqual({});
    await app.close();
  });

  it('GET /api/v1/spend rolls up seeded usage', async () => {
    const { directiveId } = seedSpend();
    const app = await buildIpcServer(baseOpts());
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/spend',
      headers: { authorization: `Bearer ${UI_TOKEN}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      perProject: Array<{ totalUsd: number; callCount: number }>;
      perDirective: Array<{ directiveId: string; totalUsd: number; callCount: number }>;
      perDay: Array<{ date: string; totalUsd: number; callCount: number }>;
      perDayPerProject: Array<{
        date: string;
        projectId: string | null;
        display: string;
        totalUsd: number;
        callCount: number;
      }>;
      perModel: Array<{ provider: string; model: string; totalUsd: number }>;
    };
    expect(body.perDirective).toHaveLength(1);
    expect(body.perDirective[0]?.directiveId).toBe(directiveId);
    expect(body.perDirective[0]?.callCount).toBe(2);
    expect(body.perDirective[0]?.totalUsd).toBeCloseTo(0.17, 2);
    expect(body.perDay).toHaveLength(1);
    expect(body.perDay[0]?.date).toBe('2026-04-23');
    // The seeded directive has no project, so perDayPerProject collapses
    // both calls into a single (unassigned) cell on 2026-04-23.
    expect(body.perDayPerProject).toHaveLength(1);
    expect(body.perDayPerProject[0]?.date).toBe('2026-04-23');
    expect(body.perDayPerProject[0]?.projectId).toBeNull();
    expect(body.perDayPerProject[0]?.display).toBe('(unassigned)');
    expect(body.perDayPerProject[0]?.callCount).toBe(2);
    expect(body.perDayPerProject[0]?.totalUsd).toBeCloseTo(0.17, 2);
    expect(body.perModel).toHaveLength(2);
    expect(body.perModel.some((m) => m.model === 'claude-sonnet-4-6')).toBe(true);
    expect(body.perModel.some((m) => m.model === 'claude-opus-4-7')).toBe(true);
    await app.close();
  });

  it('GET /api/v1/spend applies since/until filter', async () => {
    seedSpend();
    const app = await buildIpcServer(baseOpts());
    const res = await app.inject({
      method: 'GET',
      // Window that excludes both seeded rows (they're at 12:00 + 12:05 UTC).
      url: '/api/v1/spend?since=2026-04-24T00:00:00Z&until=2026-04-25T00:00:00Z',
      headers: { authorization: `Bearer ${UI_TOKEN}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      perDirective: unknown[];
      filter: { since?: string; until?: string };
    };
    expect(body.perDirective).toEqual([]);
    expect(body.filter.since).toBe('2026-04-24T00:00:00Z');
    expect(body.filter.until).toBe('2026-04-25T00:00:00Z');
    await app.close();
  });

  it('GET /api/v1/spend returns 400 on invalid since (non-ISO)', async () => {
    const app = await buildIpcServer(baseOpts());
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/spend?since=yesterday',
      headers: { authorization: `Bearer ${UI_TOKEN}` },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe('SCHEMA_VALIDATION_FAILED');
    await app.close();
  });
});

describe('IPC server — /api/v1/findings (ADR 0025, sub-step 9.7)', () => {
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

  function seedFinding(
    projectId: string,
    overrides: Partial<Finding> = {},
    extra: { projectPath?: string; updatedAt?: string } = {},
  ): Finding {
    const f: Finding = {
      id: overrides.id ?? `F${String(Math.floor(Math.random() * 900) + 100)}`,
      source: 'verifier',
      target: 'src/x.ts',
      severity: 'MEDIUM',
      status: 'OPEN',
      description: 'test finding',
      createdAt: new Date().toISOString(),
      ...overrides,
    };
    findingsRegistry.upsert(db, {
      projectId,
      projectPath: extra.projectPath ?? `/tmp/projects/${projectId}`,
      finding: f,
      ...(extra.updatedAt !== undefined ? { updatedAt: extra.updatedAt } : {}),
    });
    return f;
  }

  it('GET /api/v1/findings returns 401 without bearer', async () => {
    const app = await buildIpcServer(baseOpts());
    const res = await app.inject({ method: 'GET', url: '/api/v1/findings' });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('GET /api/v1/findings returns empty items + echoed default limit', async () => {
    const app = await buildIpcServer(baseOpts());
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/findings',
      headers: { authorization: `Bearer ${UI_TOKEN}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { items: unknown[]; filter: { limit: number } };
    expect(body.items).toEqual([]);
    expect(body.filter.limit).toBe(100);
    await app.close();
  });

  it('GET /api/v1/findings returns all seeded entries, newest first', async () => {
    const projA = newId();
    seedFinding(projA, { id: 'F101' }, { updatedAt: '2026-04-22T12:00:00.000Z' });
    seedFinding(projA, { id: 'F102' }, { updatedAt: '2026-04-23T12:00:00.000Z' });
    const app = await buildIpcServer(baseOpts());
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/findings',
      headers: { authorization: `Bearer ${UI_TOKEN}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      items: Array<{ finding: { id: string } }>;
    };
    expect(body.items).toHaveLength(2);
    expect(body.items[0]?.finding.id).toBe('F102');
    expect(body.items[1]?.finding.id).toBe('F101');
    await app.close();
  });

  it('GET /api/v1/findings?severity=HIGH filters by severity', async () => {
    const proj = newId();
    seedFinding(proj, { id: 'F201', severity: 'LOW' });
    seedFinding(proj, { id: 'F202', severity: 'HIGH' });
    const app = await buildIpcServer(baseOpts());
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/findings?severity=HIGH',
      headers: { authorization: `Bearer ${UI_TOKEN}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      items: Array<{ finding: { id: string; severity: string } }>;
      filter: { severity: string };
    };
    expect(body.items).toHaveLength(1);
    expect(body.items[0]?.finding.id).toBe('F202');
    expect(body.filter.severity).toBe('HIGH');
    await app.close();
  });

  it('GET /api/v1/findings?status=VERIFIED filters by status', async () => {
    const proj = newId();
    seedFinding(proj, { id: 'F301', status: 'OPEN' });
    seedFinding(proj, {
      id: 'F302',
      status: 'VERIFIED',
      resolvedAt: new Date().toISOString(),
    });
    const app = await buildIpcServer(baseOpts());
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/findings?status=VERIFIED',
      headers: { authorization: `Bearer ${UI_TOKEN}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      items: Array<{ finding: { id: string; status: string } }>;
    };
    expect(body.items).toHaveLength(1);
    expect(body.items[0]?.finding.id).toBe('F302');
    await app.close();
  });

  it('GET /api/v1/findings?project=<id> scopes to that project', async () => {
    const projA = newId();
    const projB = newId();
    seedFinding(projA, { id: 'F401' });
    seedFinding(projB, { id: 'F402' });
    const app = await buildIpcServer(baseOpts());
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/findings?project=${projA}`,
      headers: { authorization: `Bearer ${UI_TOKEN}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      items: Array<{ projectId: string; finding: { id: string } }>;
    };
    expect(body.items).toHaveLength(1);
    expect(body.items[0]?.projectId).toBe(projA);
    expect(body.items[0]?.finding.id).toBe('F401');
    await app.close();
  });

  it('GET /api/v1/findings?advisory=true returns only advisory entries', async () => {
    const proj = newId();
    seedFinding(proj, { id: 'F501' }); // default: advisory undefined
    seedFinding(proj, { id: 'F502', advisory: true });
    const app = await buildIpcServer(baseOpts());
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/findings?advisory=true',
      headers: { authorization: `Bearer ${UI_TOKEN}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      items: Array<{ finding: { id: string; advisory?: boolean } }>;
      filter: { advisory: boolean };
    };
    expect(body.items).toHaveLength(1);
    expect(body.items[0]?.finding.id).toBe('F502');
    expect(body.filter.advisory).toBe(true);
    await app.close();
  });

  it('GET /api/v1/findings returns 400 on invalid severity', async () => {
    const app = await buildIpcServer(baseOpts());
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/findings?severity=URGENT',
      headers: { authorization: `Bearer ${UI_TOKEN}` },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe('SCHEMA_VALIDATION_FAILED');
    await app.close();
  });
});

describe('IPC server — POST /api/v1/pending-questions/:id/answer (ADR 0027, sub-step 11.2)', () => {
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

  function seedQuestionWithDirective(overrides: Partial<PendingQuestion> = {}): PendingQuestion {
    const directive = testDirective();
    directivesQ.insert(db, directive);
    const q: PendingQuestion = {
      id: newId(),
      directiveId: directive.id,
      question: 'jwt or session?',
      channel: 'cli',
      channelRef: 'session-1',
      createdAt: new Date().toISOString(),
      ...overrides,
    };
    pendingQuestions.create(db, q);
    return q;
  }

  it('returns 401 without bearer', async () => {
    const seeded = seedQuestionWithDirective();
    const app = await buildIpcServer(baseOpts());
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/pending-questions/${seeded.id}/answer`,
      payload: { answer: 'jwt' },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('returns 503 UI_DISABLED when uiAuthToken is not configured', async () => {
    const seeded = seedQuestionWithDirective();
    const app = await buildIpcServer({ ...baseOpts(), uiAuthToken: undefined });
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/pending-questions/${seeded.id}/answer`,
      headers: { authorization: `Bearer ${UI_TOKEN}` },
      payload: { answer: 'jwt' },
    });
    expect(res.statusCode).toBe(503);
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe('UI_DISABLED');
    await app.close();
  });

  it('returns 404 QUESTION_NOT_FOUND for unknown id', async () => {
    const app = await buildIpcServer(baseOpts());
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/pending-questions/${newId()}/answer`,
      headers: { authorization: `Bearer ${UI_TOKEN}` },
      payload: { answer: 'jwt' },
    });
    expect(res.statusCode).toBe(404);
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe('QUESTION_NOT_FOUND');
    await app.close();
  });

  it('returns 400 SCHEMA_VALIDATION_FAILED on empty answer', async () => {
    const seeded = seedQuestionWithDirective();
    const app = await buildIpcServer(baseOpts());
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/pending-questions/${seeded.id}/answer`,
      headers: { authorization: `Bearer ${UI_TOKEN}` },
      payload: { answer: '' },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe('SCHEMA_VALIDATION_FAILED');
    await app.close();
  });

  it('returns 400 SCHEMA_VALIDATION_FAILED on missing answer field', async () => {
    const seeded = seedQuestionWithDirective();
    const app = await buildIpcServer(baseOpts());
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/pending-questions/${seeded.id}/answer`,
      headers: { authorization: `Bearer ${UI_TOKEN}` },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe('SCHEMA_VALIDATION_FAILED');
    await app.close();
  });

  it('happy path: writes the answer and returns the updated question', async () => {
    const seeded = seedQuestionWithDirective();
    const app = await buildIpcServer(baseOpts());
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/pending-questions/${seeded.id}/answer`,
      headers: { authorization: `Bearer ${UI_TOKEN}` },
      payload: { answer: 'jwt' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      question: { id: string; answer?: string; answeredAt?: string };
    };
    expect(body.question.id).toBe(seeded.id);
    expect(body.question.answer).toBe('jwt');
    expect(body.question.answeredAt).toBeDefined();
    // SQLite write actually happened.
    const persisted = pendingQuestions.getById(db, seeded.id);
    expect(persisted?.answer).toBe('jwt');
    expect(persisted?.answeredAt).toBeDefined();
    await app.close();
  });

  it('idempotent re-POST with same answer is a 200 no-op', async () => {
    const seeded = seedQuestionWithDirective();
    const app = await buildIpcServer(baseOpts());
    const first = await app.inject({
      method: 'POST',
      url: `/api/v1/pending-questions/${seeded.id}/answer`,
      headers: { authorization: `Bearer ${UI_TOKEN}` },
      payload: { answer: 'jwt' },
    });
    expect(first.statusCode).toBe(200);
    const firstAnsweredAt = (first.json() as { question: { answeredAt: string } }).question
      .answeredAt;

    const second = await app.inject({
      method: 'POST',
      url: `/api/v1/pending-questions/${seeded.id}/answer`,
      headers: { authorization: `Bearer ${UI_TOKEN}` },
      payload: { answer: 'jwt' },
    });
    expect(second.statusCode).toBe(200);
    const body = second.json() as { question: { answer: string; answeredAt: string } };
    expect(body.question.answer).toBe('jwt');
    // answeredAt is preserved from the first write — no re-stamp.
    expect(body.question.answeredAt).toBe(firstAnsweredAt);
    await app.close();
  });

  it('different answer on already-answered question returns 409', async () => {
    const seeded = seedQuestionWithDirective();
    const app = await buildIpcServer(baseOpts());
    const first = await app.inject({
      method: 'POST',
      url: `/api/v1/pending-questions/${seeded.id}/answer`,
      headers: { authorization: `Bearer ${UI_TOKEN}` },
      payload: { answer: 'jwt' },
    });
    expect(first.statusCode).toBe(200);

    const second = await app.inject({
      method: 'POST',
      url: `/api/v1/pending-questions/${seeded.id}/answer`,
      headers: { authorization: `Bearer ${UI_TOKEN}` },
      payload: { answer: 'sessions' },
    });
    expect(second.statusCode).toBe(409);
    const body = second.json() as { error: { code: string } };
    expect(body.error.code).toBe('QUESTION_ALREADY_ANSWERED_DIFFERENTLY');
    // Original answer preserved.
    const persisted = pendingQuestions.getById(db, seeded.id);
    expect(persisted?.answer).toBe('jwt');
    await app.close();
  });

  it('records answer even when the linked task is terminal (orphan-tolerant per ADR 0024 §4)', async () => {
    const directive = testDirective();
    directivesQ.insert(db, directive);
    const orphanedTask: InflightTask = {
      id: newId(),
      directiveId: directive.id,
      planId: newId(),
      title: 'orphaned builder',
      agent: 'builder',
      category: 'tools',
      status: 'aborted',
      attempts: 1,
      abortedReason: 'brain_restart_during_human_wait',
    };
    tasksInflight.register(db, orphanedTask);
    const question: PendingQuestion = {
      id: newId(),
      directiveId: directive.id,
      taskId: orphanedTask.id,
      question: 'continue with workaround?',
      channel: 'cli',
      channelRef: 'session-1',
      createdAt: new Date().toISOString(),
    };
    pendingQuestions.create(db, question);

    const app = await buildIpcServer(baseOpts());
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/pending-questions/${question.id}/answer`,
      headers: { authorization: `Bearer ${UI_TOKEN}` },
      payload: { answer: 'yes' },
    });
    expect(res.statusCode).toBe(200);
    // Answer is recorded for forensic value even though no consumer remains.
    const persisted = pendingQuestions.getById(db, question.id);
    expect(persisted?.answer).toBe('yes');
    expect(persisted?.answeredAt).toBeDefined();
    await app.close();
  });
});

describe('IPC server — POST /api/v1/builds (ADR 0027, sub-step 11.3)', () => {
  let db: Database;
  let doorbell: Doorbell;
  let projectDir: string;

  beforeEach(async () => {
    db = freshDb();
    doorbell = new Doorbell();
    // Each test gets its own on-disk project — the build route writes
    // .factory/project.json via loadOrCreateProjectMetadata.
    projectDir = await mkdtemp(join(tmpdir(), 'factory5-build-route-'));
  });

  afterEach(async () => {
    db.close();
    await rm(projectDir, { recursive: true, force: true });
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

  it('returns 401 without bearer', async () => {
    const app = await buildIpcServer(baseOpts());
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/builds',
      payload: { project: projectDir },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('returns 503 UI_DISABLED when uiAuthToken is not configured', async () => {
    const app = await buildIpcServer({ ...baseOpts(), uiAuthToken: undefined });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/builds',
      headers: { authorization: `Bearer ${UI_TOKEN}` },
      payload: { project: projectDir },
    });
    expect(res.statusCode).toBe(503);
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe('UI_DISABLED');
    await app.close();
  });

  it('returns 400 SCHEMA_VALIDATION_FAILED on missing project', async () => {
    const app = await buildIpcServer(baseOpts());
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/builds',
      headers: { authorization: `Bearer ${UI_TOKEN}` },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe('SCHEMA_VALIDATION_FAILED');
    await app.close();
  });

  it('returns 400 SCHEMA_VALIDATION_FAILED on bad language enum', async () => {
    const app = await buildIpcServer(baseOpts());
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/builds',
      headers: { authorization: `Bearer ${UI_TOKEN}` },
      payload: { project: projectDir, language: 'kotlin' },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe('SCHEMA_VALIDATION_FAILED');
    await app.close();
  });

  it('returns 404 PROJECT_NOT_FOUND for an absolute path that does not exist', async () => {
    const app = await buildIpcServer(baseOpts());
    const ghostPath = join(tmpdir(), 'factory5-nonexistent-project-xyzzy');
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/builds',
      headers: { authorization: `Bearer ${UI_TOKEN}` },
      payload: { project: ghostPath },
    });
    expect(res.statusCode).toBe(404);
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe('PROJECT_NOT_FOUND');
    await app.close();
  });

  it('returns 404 PROJECT_NOT_FOUND for a bare name that does not match the workspace', async () => {
    const app = await buildIpcServer(baseOpts());
    // Bare name resolves under defaultWorkspace() → ~/factory5-workspace/<name>
    // which we don't create here; should miss the second resolver rung too.
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/builds',
      headers: { authorization: `Bearer ${UI_TOKEN}` },
      payload: { project: 'this-name-should-not-exist-anywhere-12345' },
    });
    expect(res.statusCode).toBe(404);
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe('PROJECT_NOT_FOUND');
    await app.close();
  });

  it('returns 422 PROJECT_METADATA_CORRUPT on an unparseable project.json', async () => {
    // Pre-seed a corrupt project.json so loadOrCreateProjectMetadata throws.
    const factoryDir = join(projectDir, '.factory');
    await mkdir(factoryDir, { recursive: true });
    await writeFile(join(factoryDir, 'project.json'), '{ this is not json');
    const app = await buildIpcServer(baseOpts());
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/builds',
      headers: { authorization: `Bearer ${UI_TOKEN}` },
      payload: { project: projectDir },
    });
    expect(res.statusCode).toBe(422);
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe('PROJECT_METADATA_CORRUPT');
    await app.close();
  });

  it('happy path: creates a directive, persists it, and rings the doorbell', async () => {
    let rung: { directiveId: string; reason: string } | undefined;
    doorbell.on('directive.new', (payload) => {
      rung = payload;
    });

    const app = await buildIpcServer(baseOpts());
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/builds',
      headers: { authorization: `Bearer ${UI_TOKEN}` },
      payload: {
        project: projectDir,
        language: 'node',
        autonomy: 'autonomous',
        limits: { maxUsd: 5, maxSteps: 100 },
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      directive: {
        id: string;
        intent: string;
        autonomy: string;
        status: string;
        projectId: string;
        payload: { project: string; projectPath: string; language: string };
        limits: { maxUsd: number; maxSteps: number };
      };
    };
    expect(body.directive.intent).toBe('build');
    expect(body.directive.autonomy).toBe('autonomous');
    expect(body.directive.status).toBe('pending');
    expect(body.directive.payload.projectPath).toBe(projectDir);
    expect(body.directive.payload.language).toBe('node');
    expect(body.directive.limits).toEqual({ maxUsd: 5, maxSteps: 100 });
    expect(body.directive.projectId).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);

    // Persisted in SQLite.
    const persisted = directivesQ.getById(db, body.directive.id);
    expect(persisted?.id).toBe(body.directive.id);
    expect(persisted?.status).toBe('pending');

    // Doorbell rang.
    expect(rung).toEqual({ directiveId: body.directive.id, reason: 'new' });
    await app.close();
  });

  it('happy path without limits: directive lands without limits set', async () => {
    const app = await buildIpcServer(baseOpts());
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/builds',
      headers: { authorization: `Bearer ${UI_TOKEN}` },
      payload: { project: projectDir },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { directive: { autonomy: string; limits?: unknown } };
    // CLI-default autonomy.
    expect(body.directive.autonomy).toBe('assisted');
    expect(body.directive.limits).toBeUndefined();
    await app.close();
  });

  it('Tier 12 / ADR 0032 §6: partial budgets persist to directive.payload.budgets', async () => {
    const app = await buildIpcServer(baseOpts());
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/builds',
      headers: { authorization: `Bearer ${UI_TOKEN}` },
      payload: {
        project: projectDir,
        budgets: { maxTurnsScaffolder: 160, askUserDeadlineMs: 600_000 },
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      directive: { payload: { budgets?: Record<string, number> } };
    };
    // Only the operator-overridden axes land — resolver fills the rest at
    // consumption time so resume inheritance preserves intent.
    expect(body.directive.payload.budgets).toEqual({
      maxTurnsScaffolder: 160,
      askUserDeadlineMs: 600_000,
    });
    await app.close();
  });

  it('Tier 12: omits payload.budgets entirely when body.budgets is empty', async () => {
    const app = await buildIpcServer(baseOpts());
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/builds',
      headers: { authorization: `Bearer ${UI_TOKEN}` },
      payload: { project: projectDir, budgets: {} },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { directive: { payload: { budgets?: unknown } } };
    expect(body.directive.payload.budgets).toBeUndefined();
    await app.close();
  });

  it('Tier 12: returns 400 SCHEMA_VALIDATION_FAILED on negative maxTurns', async () => {
    const app = await buildIpcServer(baseOpts());
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/builds',
      headers: { authorization: `Bearer ${UI_TOKEN}` },
      payload: { project: projectDir, budgets: { maxTurnsBuilder: -5 } },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe('SCHEMA_VALIDATION_FAILED');
    await app.close();
  });

  it('language fallback: reads metadata.language when body.language is absent (10.8 parity)', async () => {
    // Pre-seed project.json with metadata.language = 'rust'.
    const factoryDir = join(projectDir, '.factory');
    await mkdir(factoryDir, { recursive: true });
    const meta = {
      id: '01KQ0P14MZZPJRPA5RW929TTSJ',
      name: 'sample',
      createdAt: '2026-04-25T00:00:00.000Z',
      factoryVersion: '0.x',
      metadata: { language: 'rust' },
    };
    await writeFile(join(factoryDir, 'project.json'), JSON.stringify(meta, null, 2));

    const app = await buildIpcServer(baseOpts());
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/builds',
      headers: { authorization: `Bearer ${UI_TOKEN}` },
      payload: { project: projectDir },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      directive: { payload: { language?: string }; projectId: string };
    };
    expect(body.directive.payload.language).toBe('rust');
    // Project identity persisted from the seeded file (not freshly minted).
    expect(body.directive.projectId).toBe(meta.id);
    await app.close();
  });

  it('happy path persists the project to the registry', async () => {
    const app = await buildIpcServer(baseOpts());
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/builds',
      headers: { authorization: `Bearer ${UI_TOKEN}` },
      payload: { project: projectDir },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { directive: { projectId: string } };
    const project = projectsQ.getById(db, body.directive.projectId);
    expect(project?.workspacePath).toBe(projectDir);
    expect(project?.status).toBe('active');
    await app.close();
  });

  it('budget tier: directive picks up metadata.budgetDefaults when body.limits is absent', async () => {
    const factoryDir = join(projectDir, '.factory');
    await mkdir(factoryDir, { recursive: true });
    const meta = {
      id: '01KQ0P14MZZPJRPA5RW929TTSJ',
      name: 'sample',
      createdAt: '2026-04-25T00:00:00.000Z',
      factoryVersion: '0.x',
      metadata: { budgetDefaults: { maxUsd: 3.25, maxSteps: 75 } },
    };
    await writeFile(join(factoryDir, 'project.json'), JSON.stringify(meta, null, 2));

    const app = await buildIpcServer(baseOpts());
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/builds',
      headers: { authorization: `Bearer ${UI_TOKEN}` },
      payload: { project: projectDir },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      directive: { limits?: { maxUsd?: number; maxSteps?: number } };
    };
    expect(body.directive.limits).toEqual({ maxUsd: 3.25, maxSteps: 75 });
    await app.close();
  });

  it('budget tier: body.limits per-field overrides project-tier defaults', async () => {
    const factoryDir = join(projectDir, '.factory');
    await mkdir(factoryDir, { recursive: true });
    const meta = {
      id: '01KQ0P14MZZPJRPA5RW929TTSJ',
      name: 'sample',
      createdAt: '2026-04-25T00:00:00.000Z',
      factoryVersion: '0.x',
      metadata: { budgetDefaults: { maxUsd: 3.25, maxSteps: 75 } },
    };
    await writeFile(join(factoryDir, 'project.json'), JSON.stringify(meta, null, 2));

    const app = await buildIpcServer(baseOpts());
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/builds',
      headers: { authorization: `Bearer ${UI_TOKEN}` },
      payload: { project: projectDir, limits: { maxUsd: 9 } },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      directive: { limits?: { maxUsd?: number; maxSteps?: number } };
    };
    expect(body.directive.limits).toEqual({ maxUsd: 9, maxSteps: 75 });
    await app.close();
  });

  it('budget tier: configBudgetDefaults applies as the third tier (Phase 13.3 / I009)', async () => {
    // Pre-fix the route only merged body + project-tier; instance-config
    // `[budget.defaults]` was never threaded in. Phase 13.3 added the
    // `configBudgetDefaults` option so the route applies all three tiers
    // exactly like `factory build`.
    const app = await buildIpcServer({
      ...baseOpts(),
      configBudgetDefaults: { maxUsd: 1.5, maxSteps: 30 },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/builds',
      headers: { authorization: `Bearer ${UI_TOKEN}` },
      payload: { project: projectDir }, // No body.limits, no project meta — falls all the way through.
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      directive: { limits?: { maxUsd?: number; maxSteps?: number } };
    };
    expect(body.directive.limits).toEqual({ maxUsd: 1.5, maxSteps: 30 });
    await app.close();
  });

  it('budget tier: project-tier overrides config-tier per field (Phase 13.3)', async () => {
    const factoryDir = join(projectDir, '.factory');
    await mkdir(factoryDir, { recursive: true });
    const meta = {
      id: '01KQ0P14MZZPJRPA5RW929TTSJ',
      name: 'sample',
      createdAt: '2026-04-25T00:00:00.000Z',
      factoryVersion: '0.x',
      metadata: { budgetDefaults: { maxUsd: 5 } }, // Only maxUsd at project tier.
    };
    await writeFile(join(factoryDir, 'project.json'), JSON.stringify(meta, null, 2));

    const app = await buildIpcServer({
      ...baseOpts(),
      configBudgetDefaults: { maxUsd: 1, maxSteps: 30 }, // maxSteps comes from here.
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/builds',
      headers: { authorization: `Bearer ${UI_TOKEN}` },
      payload: { project: projectDir },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      directive: { limits?: { maxUsd?: number; maxSteps?: number } };
    };
    expect(body.directive.limits).toEqual({ maxUsd: 5, maxSteps: 30 });
    await app.close();
  });

  it('budget tier: body.limits overrides both lower tiers per field (Phase 13.3)', async () => {
    const factoryDir = join(projectDir, '.factory');
    await mkdir(factoryDir, { recursive: true });
    const meta = {
      id: '01KQ0P14MZZPJRPA5RW929TTSJ',
      name: 'sample',
      createdAt: '2026-04-25T00:00:00.000Z',
      factoryVersion: '0.x',
      metadata: { budgetDefaults: { maxUsd: 5, maxSteps: 100 } },
    };
    await writeFile(join(factoryDir, 'project.json'), JSON.stringify(meta, null, 2));

    const app = await buildIpcServer({
      ...baseOpts(),
      configBudgetDefaults: { maxUsd: 1, maxSteps: 10 },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/builds',
      headers: { authorization: `Bearer ${UI_TOKEN}` },
      payload: { project: projectDir, limits: { maxSteps: 999 } },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      directive: { limits?: { maxUsd?: number; maxSteps?: number } };
    };
    // body wins for maxSteps; project tier wins for maxUsd; config tier
    // unused when both higher tiers fill in.
    expect(body.directive.limits).toEqual({ maxUsd: 5, maxSteps: 999 });
    await app.close();
  });

  it('Phase 13.5: project metadata.budgetDefaults.maxTurnsScaffolder flows into directive.payload.budgets', async () => {
    // The project pins maxTurnsScaffolder=160 in its on-disk metadata; the
    // build body omits it. Phase 13.5's per-project default extension means
    // the resolved directive carries maxTurnsScaffolder=160 in payload.budgets
    // (which, combined with Phase 13.3's ceiling semantic in
    // resolveTaskMaxTurns, will FLOOR any planner emit above 160 down to 160).
    const factoryDir = join(projectDir, '.factory');
    await mkdir(factoryDir, { recursive: true });
    const meta = {
      id: '01KQ0P14MZZPJRPA5RW929TTSJ',
      name: 'sample',
      createdAt: '2026-04-25T00:00:00.000Z',
      factoryVersion: '0.x',
      metadata: {
        budgetDefaults: {
          maxTurnsScaffolder: 160,
          askUserDeadlineMs: 600_000,
        },
      },
    };
    await writeFile(join(factoryDir, 'project.json'), JSON.stringify(meta, null, 2));

    const app = await buildIpcServer(baseOpts());
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/builds',
      headers: { authorization: `Bearer ${UI_TOKEN}` },
      payload: { project: projectDir }, // no body.budgets — project tier should fill
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      directive: { payload: { budgets?: Record<string, number> } };
    };
    expect(body.directive.payload.budgets).toEqual({
      maxTurnsScaffolder: 160,
      askUserDeadlineMs: 600_000,
    });
    await app.close();
  });

  it('Phase 13.5: body.budgets overrides project metadata defaults per-axis', async () => {
    // Project pins maxTurnsScaffolder=160; body asks for 80. Body wins. The
    // project's askUserDeadlineMs=600_000 flows through because the body
    // didn't touch it — per-axis independence.
    const factoryDir = join(projectDir, '.factory');
    await mkdir(factoryDir, { recursive: true });
    const meta = {
      id: '01KQ0P14MZZPJRPA5RW929TTSJ',
      name: 'sample',
      createdAt: '2026-04-25T00:00:00.000Z',
      factoryVersion: '0.x',
      metadata: {
        budgetDefaults: {
          maxTurnsScaffolder: 160,
          askUserDeadlineMs: 600_000,
        },
      },
    };
    await writeFile(join(factoryDir, 'project.json'), JSON.stringify(meta, null, 2));

    const app = await buildIpcServer(baseOpts());
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/builds',
      headers: { authorization: `Bearer ${UI_TOKEN}` },
      payload: {
        project: projectDir,
        budgets: { maxTurnsScaffolder: 80 },
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      directive: { payload: { budgets?: Record<string, number> } };
    };
    expect(body.directive.payload.budgets).toEqual({
      maxTurnsScaffolder: 80, // body wins
      askUserDeadlineMs: 600_000, // project tier flows through (per-axis indep)
    });
    await app.close();
  });

  it('Tier 14 / Phase 14.9: body.budgets.maxWikiReadinessAttempts persists to directive.payload.budgets', async () => {
    const app = await buildIpcServer(baseOpts());
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/builds',
      headers: { authorization: `Bearer ${UI_TOKEN}` },
      payload: {
        project: projectDir,
        budgets: { maxWikiReadinessAttempts: 5 },
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      directive: { payload: { budgets?: Record<string, number> } };
    };
    expect(body.directive.payload.budgets).toEqual({ maxWikiReadinessAttempts: 5 });
    await app.close();
  });

  it('Tier 14 / Phase 14.9: maxWikiReadinessAttempts absent when operator omits it', async () => {
    const app = await buildIpcServer(baseOpts());
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/builds',
      headers: { authorization: `Bearer ${UI_TOKEN}` },
      payload: { project: projectDir },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { directive: { payload: { budgets?: Record<string, number> } } };
    expect(body.directive.payload.budgets?.maxWikiReadinessAttempts).toBeUndefined();
    await app.close();
  });
});

describe('IPC server — POST /api/v1/directives/:id/resume (Tier 10 — HTTP mirror of `factory resume`)', () => {
  let db: Database;
  let doorbell: Doorbell;
  let projectDir: string;

  beforeEach(async () => {
    db = freshDb();
    doorbell = new Doorbell();
    projectDir = await mkdtemp(join(tmpdir(), 'factory5-resume-route-'));
  });

  afterEach(async () => {
    db.close();
    await rm(projectDir, { recursive: true, force: true });
  });

  const UI_TOKEN = 'ui-secret-resume';

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

  const insertPriorDirective = (overrides: Partial<Directive> = {}): Directive => {
    const directive: Directive = {
      id: newId(),
      source: 'cli',
      principal: 'web-ui',
      channelRef: 'web-ui-prior',
      intent: 'build',
      payload: {
        project: 'sample',
        projectPath: projectDir,
        workspace: projectDir,
        language: 'node',
      },
      autonomy: 'autonomous',
      createdAt: new Date().toISOString(),
      status: 'failed',
      limits: { maxUsd: 5, maxSteps: 100 },
      ...overrides,
    };
    directivesQ.insert(db, directive);
    return directive;
  };

  it('returns 401 without bearer', async () => {
    const prior = insertPriorDirective();
    const app = await buildIpcServer(baseOpts());
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/directives/${prior.id}/resume`,
      payload: {},
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('returns 404 DIRECTIVE_NOT_FOUND when the prior id is unknown', async () => {
    const app = await buildIpcServer(baseOpts());
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/directives/${newId()}/resume`,
      headers: { authorization: `Bearer ${UI_TOKEN}` },
      payload: {},
    });
    expect(res.statusCode).toBe(404);
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe('DIRECTIVE_NOT_FOUND');
    await app.close();
  });

  it('returns 409 DIRECTIVE_NOT_TERMINAL when the prior is still running', async () => {
    const prior = insertPriorDirective({ status: 'running' });
    const app = await buildIpcServer(baseOpts());
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/directives/${prior.id}/resume`,
      headers: { authorization: `Bearer ${UI_TOKEN}` },
      payload: {},
    });
    expect(res.statusCode).toBe(409);
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe('DIRECTIVE_NOT_TERMINAL');
    await app.close();
  });

  it('returns 409 DIRECTIVE_NOT_TERMINAL when the prior is still pending', async () => {
    const prior = insertPriorDirective({ status: 'pending' });
    const app = await buildIpcServer(baseOpts());
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/directives/${prior.id}/resume`,
      headers: { authorization: `Bearer ${UI_TOKEN}` },
      payload: {},
    });
    expect(res.statusCode).toBe(409);
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe('DIRECTIVE_NOT_TERMINAL');
    await app.close();
  });

  it("returns 422 PROJECT_NOT_FOUND when the prior's projectPath no longer exists", async () => {
    const prior = insertPriorDirective({
      payload: {
        project: 'sample',
        projectPath: join(tmpdir(), 'factory5-nonexistent-resume-target-xyzzy'),
        workspace: tmpdir(),
      },
    });
    const app = await buildIpcServer(baseOpts());
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/directives/${prior.id}/resume`,
      headers: { authorization: `Bearer ${UI_TOKEN}` },
      payload: {},
    });
    expect(res.statusCode).toBe(422);
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe('PROJECT_NOT_FOUND');
    await app.close();
  });

  it('happy path: mints a child directive with parentDirectiveId + payload.resumeFrom + inherited fields', async () => {
    const projectId = newId();
    const prior = insertPriorDirective({ projectId });

    let rung: { directiveId: string; reason: string } | undefined;
    doorbell.on('directive.new', (payload) => {
      rung = payload;
    });

    const app = await buildIpcServer(baseOpts());
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/directives/${prior.id}/resume`,
      headers: { authorization: `Bearer ${UI_TOKEN}` },
      payload: {},
    });
    expect(res.statusCode).toBe(200);

    const body = res.json() as {
      directive: {
        id: string;
        intent: string;
        autonomy: string;
        status: string;
        projectId?: string;
        parentDirectiveId?: string;
        payload: {
          project: string;
          projectPath: string;
          resumeFrom: string;
          language?: string;
        };
        limits?: { maxUsd: number; maxSteps: number };
      };
    };
    expect(body.directive.intent).toBe('build');
    expect(body.directive.status).toBe('pending');
    expect(body.directive.autonomy).toBe('autonomous'); // inherited from prior
    expect(body.directive.parentDirectiveId).toBe(prior.id);
    expect(body.directive.payload.resumeFrom).toBe(prior.id);
    expect(body.directive.payload.projectPath).toBe(projectDir);
    expect(body.directive.payload.language).toBe('node'); // carried from prior
    expect(body.directive.projectId).toBe(projectId);
    expect(body.directive.limits).toEqual({ maxUsd: 5, maxSteps: 100 });

    // Persisted in SQLite + doorbell rang.
    const persisted = directivesQ.getById(db, body.directive.id);
    expect(persisted?.parentDirectiveId).toBe(prior.id);
    expect(rung).toEqual({ directiveId: body.directive.id, reason: 'new' });
    await app.close();
  });

  it('Tier 12 / ADR 0032 §6: resume inherits prior.payload.budgets verbatim', async () => {
    const prior = insertPriorDirective({
      payload: {
        project: 'sample',
        projectPath: projectDir,
        workspace: projectDir,
        language: 'node',
        budgets: { maxTurnsScaffolder: 160, askUserDeadlineMs: 600_000 },
      },
    });
    const app = await buildIpcServer(baseOpts());
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/directives/${prior.id}/resume`,
      headers: { authorization: `Bearer ${UI_TOKEN}` },
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      directive: { payload: { budgets?: Record<string, number> } };
    };
    expect(body.directive.payload.budgets).toEqual({
      maxTurnsScaffolder: 160,
      askUserDeadlineMs: 600_000,
    });
    await app.close();
  });

  it('Tier 12: body.budgets overrides prior.payload.budgets per-axis (merge semantics)', async () => {
    const prior = insertPriorDirective({
      payload: {
        project: 'sample',
        projectPath: projectDir,
        workspace: projectDir,
        budgets: { maxTurnsScaffolder: 120, maxTurnsBuilder: 80 },
      },
    });
    const app = await buildIpcServer(baseOpts());
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/directives/${prior.id}/resume`,
      headers: { authorization: `Bearer ${UI_TOKEN}` },
      payload: { budgets: { maxTurnsScaffolder: 160 } },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      directive: { payload: { budgets?: Record<string, number> } };
    };
    // Operator's override wins on the axis they set; the other axis is
    // inherited verbatim from the prior.
    expect(body.directive.payload.budgets).toEqual({
      maxTurnsScaffolder: 160,
      maxTurnsBuilder: 80,
    });
    await app.close();
  });

  it('Tier 12: body.limits overrides prior.limits per-field (merge semantics)', async () => {
    const prior = insertPriorDirective({ limits: { maxUsd: 5, maxSteps: 100 } });
    const app = await buildIpcServer(baseOpts());
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/directives/${prior.id}/resume`,
      headers: { authorization: `Bearer ${UI_TOKEN}` },
      payload: { limits: { maxUsd: 10 } },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { directive: { limits?: { maxUsd: number; maxSteps: number } } };
    // body.maxUsd overrides; prior.maxSteps inherits.
    expect(body.directive.limits).toEqual({ maxUsd: 10, maxSteps: 100 });
    await app.close();
  });

  it('body.autonomy override wins over the prior autonomy', async () => {
    const prior = insertPriorDirective({ autonomy: 'autonomous' });
    const app = await buildIpcServer(baseOpts());
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/directives/${prior.id}/resume`,
      headers: { authorization: `Bearer ${UI_TOKEN}` },
      payload: { autonomy: 'assisted' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { directive: { autonomy: string } };
    expect(body.directive.autonomy).toBe('assisted');
    await app.close();
  });

  it('happy path on a `complete` prior — still mints a child (re-run from a finished build)', async () => {
    const prior = insertPriorDirective({ status: 'complete' });
    const app = await buildIpcServer(baseOpts());
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/directives/${prior.id}/resume`,
      headers: { authorization: `Bearer ${UI_TOKEN}` },
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { directive: { parentDirectiveId?: string } };
    expect(body.directive.parentDirectiveId).toBe(prior.id);
    await app.close();
  });

  it('Tier 14 / Phase 14.9: resume inherits maxWikiReadinessAttempts verbatim from prior', async () => {
    const prior = insertPriorDirective({
      payload: {
        project: 'sample',
        projectPath: projectDir,
        workspace: projectDir,
        language: 'node',
        budgets: { maxWikiReadinessAttempts: 7, maxTurnsScaffolder: 120 },
      },
    });
    const app = await buildIpcServer(baseOpts());
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/directives/${prior.id}/resume`,
      headers: { authorization: `Bearer ${UI_TOKEN}` },
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      directive: { payload: { budgets?: Record<string, number> } };
    };
    // Both axes inherited verbatim from the prior — operator set neither on resume.
    expect(body.directive.payload.budgets).toEqual({
      maxWikiReadinessAttempts: 7,
      maxTurnsScaffolder: 120,
    });
    await app.close();
  });
});

describe('IPC server — GET /api/v1/directives/:id/logs (Tier 11 / U031)', () => {
  let db: Database;
  let doorbell: Doorbell;

  beforeEach(() => {
    db = freshDb();
    doorbell = new Doorbell();
  });

  afterEach(() => {
    db.close();
  });

  const UI_TOKEN = 'ui-secret-logs';

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

  const insertDirective = (overrides: Partial<Directive> = {}): Directive => {
    const directive: Directive = { ...testDirective(), status: 'running', ...overrides };
    directivesQ.insert(db, directive);
    return directive;
  };

  it('returns 401 without bearer', async () => {
    const directive = insertDirective();
    const app = await buildIpcServer(baseOpts());
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/directives/${directive.id}/logs`,
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('returns 404 DIRECTIVE_NOT_FOUND when the directive id is unknown', async () => {
    const app = await buildIpcServer(baseOpts());
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/directives/${newId()}/logs`,
      headers: { authorization: `Bearer ${UI_TOKEN}` },
    });
    expect(res.statusCode).toBe(404);
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe('DIRECTIVE_NOT_FOUND');
    await app.close();
  });

  it('happy path: returns persisted log lines for a real directive', async () => {
    const directive = insertDirective();
    directiveLogLines.appendLogLine(db, {
      directiveId: directive.id,
      ts: '2026-05-16T01:00:00.000Z',
      level: 'info',
      component: 'brain.triage',
      msg: 'classified as build',
    });
    directiveLogLines.appendLogLine(db, {
      directiveId: directive.id,
      ts: '2026-05-16T01:00:01.000Z',
      level: 'info',
      component: 'brain.architect',
      msg: 'wrote 13 wiki pages',
      attrs: { pages: 13 },
    });
    directiveLogLines.appendLogLine(db, {
      directiveId: directive.id,
      ts: '2026-05-16T01:00:02.000Z',
      level: 'error',
      component: 'brain.planner',
      msg: 'planner: schema parse failed',
    });

    const app = await buildIpcServer(baseOpts());
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/directives/${directive.id}/logs`,
      headers: { authorization: `Bearer ${UI_TOKEN}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      items: Array<{
        id: number;
        ts: string;
        level: string;
        component: string;
        msg: string;
        attrs?: Record<string, unknown>;
      }>;
      count: number;
      limit: number;
    };
    expect(body.count).toBe(3);
    expect(body.limit).toBe(5000);
    expect(body.items.map((i) => i.msg)).toEqual([
      'classified as build',
      'wrote 13 wiki pages',
      'planner: schema parse failed',
    ]);
    expect(body.items[1]?.attrs).toEqual({ pages: 13 });
    await app.close();
  });

  it('honours `since` (strict-greater-than) — matches the FE join-cursor contract', async () => {
    const directive = insertDirective();
    directiveLogLines.appendLogLine(db, {
      directiveId: directive.id,
      ts: '2026-05-16T01:00:00.000Z',
      level: 'info',
      component: 'brain.triage',
      msg: 'before',
    });
    directiveLogLines.appendLogLine(db, {
      directiveId: directive.id,
      ts: '2026-05-16T01:00:01.000Z',
      level: 'info',
      component: 'brain.triage',
      msg: 'cursor',
    });
    directiveLogLines.appendLogLine(db, {
      directiveId: directive.id,
      ts: '2026-05-16T01:00:02.000Z',
      level: 'info',
      component: 'brain.architect',
      msg: 'after',
    });

    const app = await buildIpcServer(baseOpts());
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/directives/${directive.id}/logs?since=2026-05-16T01:00:01.000Z`,
      headers: { authorization: `Bearer ${UI_TOKEN}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { items: Array<{ msg: string }>; count: number };
    expect(body.count).toBe(1);
    expect(body.items[0]?.msg).toBe('after');
    await app.close();
  });

  it('returns an empty list (200, count=0) for a real directive that emitted nothing', async () => {
    const directive = insertDirective();
    const app = await buildIpcServer(baseOpts());
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/directives/${directive.id}/logs`,
      headers: { authorization: `Bearer ${UI_TOKEN}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { items: unknown[]; count: number };
    expect(body.count).toBe(0);
    expect(body.items).toEqual([]);
    await app.close();
  });
});

describe('IPC server — POST /api/v1/chat/messages (Phase 3 / step 3.5)', () => {
  let db: Database;
  let doorbell: Doorbell;

  beforeEach(() => {
    db = freshDb();
    doorbell = new Doorbell();
  });

  afterEach(() => {
    db.close();
  });

  const UI_TOKEN = 'ui-secret-chat';

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

  it('returns 401 without bearer', async () => {
    const app = await buildIpcServer(baseOpts());
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/chat/messages',
      payload: { message: 'hi' },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('returns 503 UI_DISABLED when uiAuthToken is not configured', async () => {
    const app = await buildIpcServer({ ...baseOpts(), uiAuthToken: undefined });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/chat/messages',
      headers: { authorization: `Bearer ${UI_TOKEN}` },
      payload: { message: 'hi' },
    });
    expect(res.statusCode).toBe(503);
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe('UI_DISABLED');
    await app.close();
  });

  it('returns 400 SCHEMA_VALIDATION_FAILED on missing message', async () => {
    const app = await buildIpcServer(baseOpts());
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/chat/messages',
      headers: { authorization: `Bearer ${UI_TOKEN}` },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe('SCHEMA_VALIDATION_FAILED');
    await app.close();
  });

  it('returns 400 SCHEMA_VALIDATION_FAILED on empty message', async () => {
    const app = await buildIpcServer(baseOpts());
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/chat/messages',
      headers: { authorization: `Bearer ${UI_TOKEN}` },
      payload: { message: '' },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe('SCHEMA_VALIDATION_FAILED');
    await app.close();
  });

  it('returns 400 SCHEMA_VALIDATION_FAILED on message exceeding 8 KB', async () => {
    const app = await buildIpcServer(baseOpts());
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/chat/messages',
      headers: { authorization: `Bearer ${UI_TOKEN}` },
      payload: { message: 'x'.repeat(8193) },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe('SCHEMA_VALIDATION_FAILED');
    await app.close();
  });

  it('returns 400 SCHEMA_VALIDATION_FAILED on malformed conversationId', async () => {
    const app = await buildIpcServer(baseOpts());
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/chat/messages',
      headers: { authorization: `Bearer ${UI_TOKEN}` },
      payload: { message: 'hi', conversationId: 'not-a-ulid' },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe('SCHEMA_VALIDATION_FAILED');
    await app.close();
  });

  it('happy path: mints a chat directive, persists it, and rings the doorbell', async () => {
    let rung: { directiveId: string; reason: string } | undefined;
    doorbell.on('directive.new', (payload) => {
      rung = payload;
    });

    const app = await buildIpcServer(baseOpts());
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/chat/messages',
      headers: { authorization: `Bearer ${UI_TOKEN}` },
      payload: { message: "what's the status of the project?" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      directive: {
        id: string;
        source: string;
        principal: string;
        intent: string;
        autonomy: string;
        status: string;
        payload: { text: string; conversationId?: string };
      };
    };
    expect(body.directive.intent).toBe('chat');
    expect(body.directive.autonomy).toBe('chat');
    expect(body.directive.status).toBe('pending');
    expect(body.directive.source).toBe('cli');
    expect(body.directive.principal).toBe('web-ui');
    expect(body.directive.payload.text).toBe("what's the status of the project?");
    expect(body.directive.payload.conversationId).toBeUndefined();
    expect(body.directive.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);

    // Persisted in SQLite.
    const persisted = directivesQ.getById(db, body.directive.id);
    expect(persisted?.intent).toBe('chat');
    expect(persisted?.status).toBe('pending');

    // Doorbell rang so the brain's claim loop wakes up.
    expect(rung).toEqual({ directiveId: body.directive.id, reason: 'new' });
    await app.close();
  });

  it('happy path with conversationId: stores it on the directive payload', async () => {
    const app = await buildIpcServer(baseOpts());
    const conversationId = newId();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/chat/messages',
      headers: { authorization: `Bearer ${UI_TOKEN}` },
      payload: { message: 'follow-up question', conversationId },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      directive: { payload: { text: string; conversationId?: string } };
    };
    expect(body.directive.payload.conversationId).toBe(conversationId);
    expect(body.directive.payload.text).toBe('follow-up question');
    await app.close();
  });

  it('channelRef carries the request id so multi-tab sessions stay distinct', async () => {
    const app = await buildIpcServer(baseOpts());
    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/chat/messages',
      headers: { authorization: `Bearer ${UI_TOKEN}` },
      payload: { message: 'one' },
    });
    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/chat/messages',
      headers: { authorization: `Bearer ${UI_TOKEN}` },
      payload: { message: 'two' },
    });
    const a = first.json() as { directive: { id: string; channelRef: string } };
    const b = second.json() as { directive: { id: string; channelRef: string } };
    expect(a.directive.channelRef).toMatch(/^web-ui-/);
    expect(b.directive.channelRef).toMatch(/^web-ui-/);
    expect(a.directive.channelRef).not.toBe(b.directive.channelRef);
    expect(a.directive.id).not.toBe(b.directive.id);
    await app.close();
  });
});

describe('IPC server — PUT /api/v1/projects/:id/budget (ADR 0027, sub-step 11.4)', () => {
  let db: Database;
  let doorbell: Doorbell;
  let projectDir: string;

  beforeEach(async () => {
    db = freshDb();
    doorbell = new Doorbell();
    projectDir = await mkdtemp(join(tmpdir(), 'factory5-budget-route-'));
  });

  afterEach(async () => {
    db.close();
    await rm(projectDir, { recursive: true, force: true });
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

  /**
   * Seed a project on disk + a matching registry row. Returns the seeded
   * project's ULID so tests can target it via `:id`.
   */
  async function seedProject(seedMetadata: Record<string, unknown> = {}): Promise<string> {
    const factoryDir = join(projectDir, '.factory');
    await mkdir(factoryDir, { recursive: true });
    const id = newId();
    const meta = {
      id,
      name: 'sample',
      createdAt: '2026-04-25T00:00:00.000Z',
      factoryVersion: '0.x',
      metadata: seedMetadata,
    };
    await writeFile(join(factoryDir, 'project.json'), JSON.stringify(meta, null, 2));
    projectsQ.upsert(db, {
      id,
      name: 'sample',
      workspacePath: projectDir,
      status: 'active',
      createdAt: meta.createdAt,
      lastTouchedAt: meta.createdAt,
    });
    return id;
  }

  it('returns 401 without bearer', async () => {
    const id = await seedProject();
    const app = await buildIpcServer(baseOpts());
    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/projects/${id}/budget`,
      payload: { maxUsd: 5 },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('returns 503 UI_DISABLED when uiAuthToken is not configured', async () => {
    const id = await seedProject();
    const app = await buildIpcServer({ ...baseOpts(), uiAuthToken: undefined });
    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/projects/${id}/budget`,
      headers: { authorization: `Bearer ${UI_TOKEN}` },
      payload: { maxUsd: 5 },
    });
    expect(res.statusCode).toBe(503);
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe('UI_DISABLED');
    await app.close();
  });

  it('returns 400 SCHEMA_VALIDATION_FAILED on a negative value', async () => {
    const id = await seedProject();
    const app = await buildIpcServer(baseOpts());
    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/projects/${id}/budget`,
      headers: { authorization: `Bearer ${UI_TOKEN}` },
      payload: { maxUsd: -1 },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe('SCHEMA_VALIDATION_FAILED');
    await app.close();
  });

  it('returns 404 PROJECT_NOT_FOUND when the ULID is not in the registry', async () => {
    const app = await buildIpcServer(baseOpts());
    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/projects/${newId()}/budget`,
      headers: { authorization: `Bearer ${UI_TOKEN}` },
      payload: { maxUsd: 5 },
    });
    expect(res.statusCode).toBe(404);
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe('PROJECT_NOT_FOUND');
    await app.close();
  });

  it('returns 404 PROJECT_PATH_UNREADABLE when project.json no longer exists', async () => {
    const id = newId();
    projectsQ.upsert(db, {
      id,
      name: 'orphan',
      workspacePath: projectDir,
      status: 'active',
      createdAt: '2026-04-25T00:00:00.000Z',
      lastTouchedAt: '2026-04-25T00:00:00.000Z',
    });

    const app = await buildIpcServer(baseOpts());
    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/projects/${id}/budget`,
      headers: { authorization: `Bearer ${UI_TOKEN}` },
      payload: { maxUsd: 5 },
    });
    expect(res.statusCode).toBe(404);
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe('PROJECT_PATH_UNREADABLE');
    await app.close();
  });

  it('returns 422 PROJECT_METADATA_CORRUPT on a present-but-unparseable project.json', async () => {
    const id = newId();
    const factoryDir = join(projectDir, '.factory');
    await mkdir(factoryDir, { recursive: true });
    await writeFile(join(factoryDir, 'project.json'), '{ corrupt');
    projectsQ.upsert(db, {
      id,
      name: 'broken',
      workspacePath: projectDir,
      status: 'active',
      createdAt: '2026-04-25T00:00:00.000Z',
      lastTouchedAt: '2026-04-25T00:00:00.000Z',
    });

    const app = await buildIpcServer(baseOpts());
    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/projects/${id}/budget`,
      headers: { authorization: `Bearer ${UI_TOKEN}` },
      payload: { maxUsd: 5 },
    });
    expect(res.statusCode).toBe(422);
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe('PROJECT_METADATA_CORRUPT');
    await app.close();
  });

  it('happy path: round-trip — sets values, reads back via project.json', async () => {
    const id = await seedProject();
    const app = await buildIpcServer(baseOpts());
    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/projects/${id}/budget`,
      headers: { authorization: `Bearer ${UI_TOKEN}` },
      payload: { maxUsd: 4.5, maxSteps: 150 },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      projectId: string;
      budgetDefaults: { maxUsd?: number; maxSteps?: number };
    };
    expect(body.projectId).toBe(id);
    expect(body.budgetDefaults).toEqual({ maxUsd: 4.5, maxSteps: 150 });

    const { readFile } = await import('node:fs/promises');
    const onDisk = JSON.parse(
      await readFile(join(projectDir, '.factory', 'project.json'), 'utf8'),
    ) as { metadata: { budgetDefaults: unknown } };
    expect(onDisk.metadata.budgetDefaults).toEqual({ maxUsd: 4.5, maxSteps: 150 });
    await app.close();
  });

  it('PUT with partial body replaces the document — omitted field is removed', async () => {
    const id = await seedProject({ budgetDefaults: { maxUsd: 5, maxSteps: 100 } });
    const app = await buildIpcServer(baseOpts());
    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/projects/${id}/budget`,
      headers: { authorization: `Bearer ${UI_TOKEN}` },
      payload: { maxUsd: 9 },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { budgetDefaults: { maxUsd?: number; maxSteps?: number } };
    expect(body.budgetDefaults).toEqual({ maxUsd: 9 });
    expect(body.budgetDefaults.maxSteps).toBeUndefined();
    await app.close();
  });

  it('PUT empty body clears all defaults', async () => {
    const id = await seedProject({ budgetDefaults: { maxUsd: 5, maxSteps: 100 } });
    const app = await buildIpcServer(baseOpts());
    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/projects/${id}/budget`,
      headers: { authorization: `Bearer ${UI_TOKEN}` },
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { budgetDefaults: Record<string, unknown> };
    expect(body.budgetDefaults).toEqual({});
    await app.close();
  });

  it('preserves unrelated metadata.* fields (language) across the budget write', async () => {
    const id = await seedProject({ language: 'go' });
    const app = await buildIpcServer(baseOpts());
    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/projects/${id}/budget`,
      headers: { authorization: `Bearer ${UI_TOKEN}` },
      payload: { maxUsd: 2 },
    });
    expect(res.statusCode).toBe(200);
    const { readFile } = await import('node:fs/promises');
    const onDisk = JSON.parse(
      await readFile(join(projectDir, '.factory', 'project.json'), 'utf8'),
    ) as { metadata: { language?: string; budgetDefaults?: unknown } };
    expect(onDisk.metadata.language).toBe('go');
    expect(onDisk.metadata.budgetDefaults).toEqual({ maxUsd: 2 });
    await app.close();
  });
});

describe('IPC server — GET /api/v1/projects (ADR 0027, sub-step 11.5 — SPA prerequisite)', () => {
  let db: Database;
  let doorbell: Doorbell;
  let projectDir: string;

  beforeEach(async () => {
    db = freshDb();
    doorbell = new Doorbell();
    projectDir = await mkdtemp(join(tmpdir(), 'factory5-projects-list-'));
  });

  afterEach(async () => {
    db.close();
    await rm(projectDir, { recursive: true, force: true });
  });

  const UI_TOKEN = 'ui-secret-list';

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

  /**
   * Seed a project on disk + a matching registry row. Returns the seeded
   * project's ULID so tests can target it via `:id`. Mirrors the same
   * helper used by the PUT-budget describe block above.
   */
  async function seedProject(
    name: string,
    workspacePath: string,
    seedMetadata: Record<string, unknown> = {},
  ): Promise<string> {
    const factoryDir = join(workspacePath, '.factory');
    await mkdir(factoryDir, { recursive: true });
    const id = newId();
    const meta = {
      id,
      name,
      createdAt: '2026-04-25T00:00:00.000Z',
      factoryVersion: '0.x',
      metadata: seedMetadata,
    };
    await writeFile(join(factoryDir, 'project.json'), JSON.stringify(meta, null, 2));
    projectsQ.upsert(db, {
      id,
      name,
      workspacePath,
      status: 'active',
      createdAt: meta.createdAt,
      lastTouchedAt: meta.createdAt,
    });
    return id;
  }

  it('returns 401 without bearer', async () => {
    const app = await buildIpcServer(baseOpts());
    const res = await app.inject({ method: 'GET', url: '/api/v1/projects' });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('returns 503 UI_DISABLED when uiAuthToken is not configured', async () => {
    const app = await buildIpcServer({ ...baseOpts(), uiAuthToken: undefined });
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/projects',
      headers: { authorization: `Bearer ${UI_TOKEN}` },
    });
    expect(res.statusCode).toBe(503);
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe('UI_DISABLED');
    await app.close();
  });

  it('returns an empty list when no projects exist', async () => {
    const app = await buildIpcServer(baseOpts());
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/projects',
      headers: { authorization: `Bearer ${UI_TOKEN}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { items: unknown[] };
    expect(body.items).toEqual([]);
    await app.close();
  });

  it('returns registered projects, most-recently touched first', async () => {
    const dirA = await mkdtemp(join(tmpdir(), 'factory5-projects-list-a-'));
    const dirB = await mkdtemp(join(tmpdir(), 'factory5-projects-list-b-'));
    try {
      const idA = await seedProject('alpha', dirA);
      // Bump B's last_touched_at so it sorts first.
      const idB = await seedProject('bravo', dirB);
      projectsQ.upsert(db, {
        id: idB,
        name: 'bravo',
        workspacePath: dirB,
        status: 'active',
        createdAt: '2026-04-25T00:00:00.000Z',
        lastTouchedAt: '2026-04-26T00:00:00.000Z',
      });

      const app = await buildIpcServer(baseOpts());
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/projects',
        headers: { authorization: `Bearer ${UI_TOKEN}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { items: Array<{ id: string; name: string }> };
      expect(body.items).toHaveLength(2);
      expect(body.items[0]?.id).toBe(idB);
      expect(body.items[0]?.name).toBe('bravo');
      expect(body.items[1]?.id).toBe(idA);
      expect(body.items[1]?.name).toBe('alpha');
      await app.close();
    } finally {
      await rm(dirA, { recursive: true, force: true });
      await rm(dirB, { recursive: true, force: true });
    }
  });

  it('GET /:id returns 401 without bearer', async () => {
    const app = await buildIpcServer(baseOpts());
    const res = await app.inject({ method: 'GET', url: `/api/v1/projects/${newId()}` });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('GET /:id returns 404 PROJECT_NOT_FOUND on unknown ULID', async () => {
    const app = await buildIpcServer(baseOpts());
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${newId()}`,
      headers: { authorization: `Bearer ${UI_TOKEN}` },
    });
    expect(res.statusCode).toBe(404);
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe('PROJECT_NOT_FOUND');
    await app.close();
  });

  it('GET /:id extracts budgetDefaults + language from on-disk project.json metadata', async () => {
    const id = await seedProject('sample', projectDir, {
      budgetDefaults: { maxUsd: 7.5, maxSteps: 200 },
      language: 'rust',
    });
    const app = await buildIpcServer(baseOpts());
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${id}`,
      headers: { authorization: `Bearer ${UI_TOKEN}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      project: { id: string; name: string };
      budgetDefaults?: { maxUsd?: number; maxSteps?: number };
      language?: string;
    };
    expect(body.project.id).toBe(id);
    expect(body.project.name).toBe('sample');
    expect(body.budgetDefaults).toEqual({ maxUsd: 7.5, maxSteps: 200 });
    expect(body.language).toBe('rust');
    await app.close();
  });

  it('GET /:id omits budgetDefaults / language when project.json has no such fields', async () => {
    const id = await seedProject('bare', projectDir, {});
    const app = await buildIpcServer(baseOpts());
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${id}`,
      headers: { authorization: `Bearer ${UI_TOKEN}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      project: { id: string };
      budgetDefaults?: unknown;
      language?: unknown;
    };
    expect(body.project.id).toBe(id);
    expect(body.budgetDefaults).toBeUndefined();
    expect(body.language).toBeUndefined();
    await app.close();
  });

  it('GET /:id returns the registry row even when project.json is absent (soft fail)', async () => {
    const id = newId();
    projectsQ.upsert(db, {
      id,
      name: 'orphan',
      workspacePath: projectDir,
      status: 'active',
      createdAt: '2026-04-25T00:00:00.000Z',
      lastTouchedAt: '2026-04-25T00:00:00.000Z',
    });
    const app = await buildIpcServer(baseOpts());
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${id}`,
      headers: { authorization: `Bearer ${UI_TOKEN}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      project: { id: string; name: string };
      budgetDefaults?: unknown;
      language?: unknown;
    };
    expect(body.project.id).toBe(id);
    expect(body.project.name).toBe('orphan');
    expect(body.budgetDefaults).toBeUndefined();
    expect(body.language).toBeUndefined();
    await app.close();
  });

  it('GET /:id returns the registry row when project.json is corrupt (soft fail + warn log)', async () => {
    const id = newId();
    const factoryDir = join(projectDir, '.factory');
    await mkdir(factoryDir, { recursive: true });
    await writeFile(join(factoryDir, 'project.json'), '{ corrupt');
    projectsQ.upsert(db, {
      id,
      name: 'broken',
      workspacePath: projectDir,
      status: 'active',
      createdAt: '2026-04-25T00:00:00.000Z',
      lastTouchedAt: '2026-04-25T00:00:00.000Z',
    });
    const app = await buildIpcServer(baseOpts());
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${id}`,
      headers: { authorization: `Bearer ${UI_TOKEN}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      project: { id: string; name: string };
      budgetDefaults?: unknown;
      language?: unknown;
    };
    expect(body.project.id).toBe(id);
    expect(body.project.name).toBe('broken');
    expect(body.budgetDefaults).toBeUndefined();
    expect(body.language).toBeUndefined();
    await app.close();
  });
});

describe('IPC server — POST /directives/:id/cancel (Phase 2.4)', () => {
  let db: Database;
  let doorbell: Doorbell;

  beforeEach(() => {
    db = freshDb();
    doorbell = new Doorbell();
    _resetCancellationRegistry();
  });

  afterEach(() => {
    db.close();
    _resetCancellationRegistry();
  });

  it('flips a running directive to failed and returns abortFired=false when no controller is registered', async () => {
    const directive = testDirective();
    directivesQ.insert(db, directive);
    directivesQ.updateStatus(db, directive.id, 'running');

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
      url: `/directives/${directive.id}/cancel`,
      payload: { reason: 'changed my mind' },
    });
    expect(res.statusCode).toBe(200);
    const parsed = cancelDirectiveResponseSchema.parse(res.json());
    expect(parsed.directive.status).toBe('failed');
    expect(parsed.directive.blockedReason).toBe('changed my mind');
    expect(parsed.abortFired).toBe(false);

    // DB row should be updated.
    const fresh = directivesQ.getById(db, directive.id);
    expect(fresh?.status).toBe('failed');
    expect(fresh?.blockedReason).toBe('changed my mind');
    await app.close();
  });

  it('fires the brain-side AbortController and returns abortFired=true', async () => {
    const directive = testDirective();
    directivesQ.insert(db, directive);
    directivesQ.updateStatus(db, directive.id, 'running');

    // Pretend the brain claimed this directive (serve loop's
    // registerCancellation pattern).
    const handle = registerCancellation(directive.id);

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
      url: `/directives/${directive.id}/cancel`,
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    const parsed = cancelDirectiveResponseSchema.parse(res.json());
    expect(parsed.abortFired).toBe(true);
    expect(handle.signal.aborted).toBe(true);
    handle.release();
    await app.close();
  });

  it('defaults reason to "cancelled" when body.reason is omitted', async () => {
    const directive = testDirective();
    directivesQ.insert(db, directive);
    directivesQ.updateStatus(db, directive.id, 'running');

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
      url: `/directives/${directive.id}/cancel`,
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    const parsed = cancelDirectiveResponseSchema.parse(res.json());
    expect(parsed.directive.blockedReason).toBe('cancelled');
    await app.close();
  });

  it('returns 404 NOT_FOUND for an unknown directive id', async () => {
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
      url: `/directives/${newId()}/cancel`,
      payload: { reason: 'nope' },
    });
    expect(res.statusCode).toBe(404);
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe('NOT_FOUND');
    await app.close();
  });

  it('returns 409 ALREADY_TERMINAL for a terminal directive', async () => {
    const directive = testDirective();
    directivesQ.insert(db, directive);
    directivesQ.updateStatus(db, directive.id, 'complete');

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
      url: `/directives/${directive.id}/cancel`,
      payload: {},
    });
    expect(res.statusCode).toBe(409);
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe('ALREADY_TERMINAL');
    await app.close();
  });

  it('rejects non-loopback callers with 403 NON_LOCALHOST', async () => {
    const directive = testDirective();
    directivesQ.insert(db, directive);
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
      url: `/directives/${directive.id}/cancel`,
      payload: {},
      remoteAddress: '10.0.0.5',
    });
    expect(res.statusCode).toBe(403);
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe('NON_LOCALHOST');
    await app.close();
  });
});

describe('IPC server — POST /api/v1/directives/:id/cancel (Phase 3 / step 3.6)', () => {
  let db: Database;
  let doorbell: Doorbell;

  const UI_TOKEN = 'ui-secret-cancel';

  beforeEach(() => {
    db = freshDb();
    doorbell = new Doorbell();
    _resetCancellationRegistry();
  });

  afterEach(() => {
    db.close();
    _resetCancellationRegistry();
  });

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

  it('returns 401 UI_AUTH_REQUIRED without bearer', async () => {
    const directive = testDirective();
    directivesQ.insert(db, directive);
    directivesQ.updateStatus(db, directive.id, 'running');

    const app = await buildIpcServer(baseOpts());
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/directives/${directive.id}/cancel`,
      payload: {},
    });
    expect(res.statusCode).toBe(401);
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe('UI_AUTH_REQUIRED');

    // DB row stays running — auth-failed call must not mutate.
    expect(directivesQ.getById(db, directive.id)?.status).toBe('running');
    await app.close();
  });

  it('returns 503 UI_DISABLED when uiAuthToken is not configured', async () => {
    const directive = testDirective();
    directivesQ.insert(db, directive);
    directivesQ.updateStatus(db, directive.id, 'running');

    const app = await buildIpcServer({ ...baseOpts(), uiAuthToken: undefined });
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/directives/${directive.id}/cancel`,
      headers: { authorization: `Bearer ${UI_TOKEN}` },
      payload: {},
    });
    expect(res.statusCode).toBe(503);
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe('UI_DISABLED');

    // DB row stays running — disabled-surface call must not mutate.
    expect(directivesQ.getById(db, directive.id)?.status).toBe('running');
    await app.close();
  });

  it('happy path with bearer: flips status to failed and returns abortFired=true', async () => {
    const directive = testDirective();
    directivesQ.insert(db, directive);
    directivesQ.updateStatus(db, directive.id, 'running');
    const handle = registerCancellation(directive.id);

    const app = await buildIpcServer(baseOpts());
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/directives/${directive.id}/cancel`,
      headers: { authorization: `Bearer ${UI_TOKEN}` },
      payload: { reason: 'cancelled-from-web-ui' },
    });
    expect(res.statusCode).toBe(200);
    const parsed = cancelDirectiveResponseSchema.parse(res.json());
    expect(parsed.directive.status).toBe('failed');
    expect(parsed.directive.blockedReason).toBe('cancelled-from-web-ui');
    expect(parsed.abortFired).toBe(true);
    expect(handle.signal.aborted).toBe(true);

    handle.release();
    await app.close();
  });

  it('returns 404 NOT_FOUND for an unknown directive id (post-auth)', async () => {
    const app = await buildIpcServer(baseOpts());
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/directives/${newId()}/cancel`,
      headers: { authorization: `Bearer ${UI_TOKEN}` },
      payload: {},
    });
    expect(res.statusCode).toBe(404);
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe('NOT_FOUND');
    await app.close();
  });

  it('returns 409 ALREADY_TERMINAL for a terminal directive (post-auth)', async () => {
    const directive = testDirective();
    directivesQ.insert(db, directive);
    directivesQ.updateStatus(db, directive.id, 'complete');

    const app = await buildIpcServer(baseOpts());
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/directives/${directive.id}/cancel`,
      headers: { authorization: `Bearer ${UI_TOKEN}` },
      payload: {},
    });
    expect(res.statusCode).toBe(409);
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe('ALREADY_TERMINAL');
    await app.close();
  });

  it('the legacy /directives/:id/cancel route still works without a bearer (CLI path)', async () => {
    const directive = testDirective();
    directivesQ.insert(db, directive);
    directivesQ.updateStatus(db, directive.id, 'running');

    const app = await buildIpcServer(baseOpts());
    const res = await app.inject({
      method: 'POST',
      url: `/directives/${directive.id}/cancel`,
      payload: { reason: 'from-cli' },
    });
    expect(res.statusCode).toBe(200);
    const parsed = cancelDirectiveResponseSchema.parse(res.json());
    expect(parsed.directive.status).toBe('failed');
    expect(parsed.directive.blockedReason).toBe('from-cli');
    await app.close();
  });
});

describe('IPC server — POST /api/v1/projects (Phase 3 step 3.7)', () => {
  let db: Database;
  let doorbell: Doorbell;
  let workspaceDir: string;

  beforeEach(async () => {
    db = freshDb();
    doorbell = new Doorbell();
    // Each test gets its own workspace root — the route writes
    // `<workspace>/<name>/{CLAUDE.md, .factory/project.json}`.
    workspaceDir = await mkdtemp(join(tmpdir(), 'factory5-create-project-route-'));
  });

  afterEach(async () => {
    db.close();
    await rm(workspaceDir, { recursive: true, force: true });
  });

  const UI_TOKEN = 'ui-secret-create-project';

  const baseOpts = (): Parameters<typeof buildIpcServer>[0] => ({
    host: '127.0.0.1',
    port: 0,
    db,
    doorbell,
    startedAt: STARTED_AT,
    version: '0.0.1',
    processName: 'factoryd-test',
    uiAuthToken: UI_TOKEN,
    workspace: workspaceDir,
  });

  it('returns 401 without bearer', async () => {
    const app = await buildIpcServer(baseOpts());
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      payload: { name: 'demo', language: 'python' },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('returns 503 UI_DISABLED when uiAuthToken is not configured', async () => {
    const app = await buildIpcServer({ ...baseOpts(), uiAuthToken: undefined });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: { authorization: `Bearer ${UI_TOKEN}` },
      payload: { name: 'demo', language: 'python' },
    });
    expect(res.statusCode).toBe(503);
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe('UI_DISABLED');
    await app.close();
  });

  it('returns 400 SCHEMA_VALIDATION_FAILED on missing name', async () => {
    const app = await buildIpcServer(baseOpts());
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: { authorization: `Bearer ${UI_TOKEN}` },
      payload: { language: 'python' },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe('SCHEMA_VALIDATION_FAILED');
    await app.close();
  });

  it('returns 400 SCHEMA_VALIDATION_FAILED on invalid language enum', async () => {
    const app = await buildIpcServer(baseOpts());
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: { authorization: `Bearer ${UI_TOKEN}` },
      payload: { name: 'demo', language: 'kotlin' },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe('SCHEMA_VALIDATION_FAILED');
    await app.close();
  });

  it('happy path: scaffolds files on disk + inserts registry row', async () => {
    const app = await buildIpcServer(baseOpts());
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: { authorization: `Bearer ${UI_TOKEN}` },
      payload: { name: 'demo-py', language: 'python' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { id: string; path: string };
    expect(body.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(body.path).toBe(join(workspaceDir, 'demo-py'));

    // Filesystem: CLAUDE.md scaffold + .factory/project.json identity.
    const claudeMd = await readFile(join(body.path, 'CLAUDE.md'), 'utf8');
    expect(claudeMd).toMatch(/^# demo-py/);
    expect(claudeMd).toMatch(/Python 3\.11\+/);
    const meta = JSON.parse(
      await readFile(join(body.path, '.factory', 'project.json'), 'utf8'),
    ) as { id: string; metadata: { language?: string } };
    expect(meta.id).toBe(body.id);
    expect(meta.metadata.language).toBe('python');

    // Registry row inserted so GET /api/v1/projects sees it immediately.
    const persisted = projectsQ.getById(db, body.id);
    expect(persisted?.id).toBe(body.id);
    expect(persisted?.name).toBe('demo-py');
    expect(persisted?.workspacePath).toBe(body.path);

    await app.close();
  });

  it('returns 409 ALREADY_EXISTS when the project path already has identity', async () => {
    const app = await buildIpcServer(baseOpts());

    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: { authorization: `Bearer ${UI_TOKEN}` },
      payload: { name: 'taken', language: 'go' },
    });
    expect(first.statusCode).toBe(200);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: { authorization: `Bearer ${UI_TOKEN}` },
      payload: { name: 'taken', language: 'go' },
    });
    expect(res.statusCode).toBe(409);
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe('ALREADY_EXISTS');
    await app.close();
  });
});

// Workaround for unused-import lint when only types are referenced above.
void IpcRequestError;
