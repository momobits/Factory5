/**
 * End-to-end tests for `GET /api/v1/directives/:id/stream`.
 *
 * Uses a real bound socket (via `app.listen({ port: 0 })`) and
 * Node's native `fetch` streaming body — `app.inject()` buffers the
 * full response and can't observe SSE chunks as they arrive.
 */

import { newId, type Directive, type TaskResult } from '@factory5/core';
import { initLogger } from '@factory5/logger';
import {
  openDatabase,
  runMigrations,
  directives as directivesQ,
  tasksInflight,
  type Database,
} from '@factory5/state';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { DirectiveStreamHub } from './directive-stream.js';
import { Doorbell } from './doorbell.js';
import { buildIpcServer } from './server.js';

beforeAll(() => {
  initLogger({ processName: 'sse-test', noFile: true, noConsole: true });
});

const STARTED_AT = new Date('2026-04-18T12:00:00Z').toISOString();
const UI_TOKEN = 'ui-token-for-sse-tests';

function freshDb(): Database {
  const db = openDatabase(':memory:');
  runMigrations(db);
  return db;
}

function testDirective(overrides: Partial<Directive> = {}): Directive {
  return {
    id: newId(),
    source: 'cli',
    principal: 'tester',
    channelRef: 'ref-1',
    intent: 'build',
    payload: {},
    autonomy: 'assisted',
    createdAt: new Date().toISOString(),
    status: 'running',
    ...overrides,
  };
}

interface ServerHandle {
  url: string;
  app: Awaited<ReturnType<typeof buildIpcServer>>;
  hub: DirectiveStreamHub;
  db: Database;
  stop: () => Promise<void>;
}

async function startServer(opts: {
  db: Database;
  uiAuthToken?: string | undefined;
  heartbeatMs?: number;
}): Promise<ServerHandle> {
  const hub = new DirectiveStreamHub(opts.db);
  const app = await buildIpcServer({
    host: '127.0.0.1',
    port: 0,
    db: opts.db,
    doorbell: new Doorbell(),
    startedAt: STARTED_AT,
    version: '0.0.1',
    processName: 'factoryd-sse-test',
    uiAuthToken: opts.uiAuthToken,
    directiveStream: hub,
    ...(opts.heartbeatMs !== undefined ? { directiveStreamHeartbeatMs: opts.heartbeatMs } : {}),
  });
  await app.listen({ host: '127.0.0.1', port: 0 });
  const addr = app.server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${String(addr.port)}`,
    app,
    hub,
    db: opts.db,
    stop: async () => {
      hub.shutdown();
      await app.close();
    },
  };
}

interface ParsedEvent {
  type: string;
  data: unknown;
}

interface KeepaliveLine {
  keepalive: true;
}

type SseLine = ParsedEvent | KeepaliveLine;

/**
 * Pull SSE events one at a time from a streaming `fetch` response. The
 * generator yields parsed events as they arrive; the test caller decides
 * how many to consume before disconnecting.
 *
 * Tracks both real `event:` blocks AND `:keepalive` comment lines so
 * heartbeat tests can observe them.
 */
async function* readSse(body: ReadableStream<Uint8Array>): AsyncGenerator<SseLine, void, void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffered = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) return;
    buffered += decoder.decode(value, { stream: true });
    let blank = buffered.indexOf('\n\n');
    while (blank >= 0) {
      const block = buffered.slice(0, blank);
      buffered = buffered.slice(blank + 2);
      if (block.startsWith(':')) {
        yield { keepalive: true };
      } else {
        const lines = block.split('\n');
        let type: string | undefined;
        let data: string | undefined;
        for (const line of lines) {
          if (line.startsWith('event: ')) type = line.slice(7);
          else if (line.startsWith('data: ')) data = line.slice(6);
        }
        if (type !== undefined && data !== undefined) {
          yield { type, data: JSON.parse(data) };
        }
      }
      blank = buffered.indexOf('\n\n');
    }
  }
}

/**
 * Open the SSE stream and return helpers to pull events / cancel. Auth
 * via `?t=` by default; pass `useHeader: true` to use the Bearer header.
 */
async function openStream(
  server: ServerHandle,
  directiveId: string,
  opts: { useHeader?: boolean; token?: string; signal?: AbortSignal } = {},
): Promise<{
  response: Response;
  events: AsyncGenerator<SseLine, void, void>;
}> {
  const token = opts.token ?? UI_TOKEN;
  const headers: Record<string, string> = { Accept: 'text/event-stream' };
  let url = `${server.url}/api/v1/directives/${directiveId}/stream`;
  if (opts.useHeader === true) {
    headers['Authorization'] = `Bearer ${token}`;
  } else {
    url += `?t=${encodeURIComponent(token)}`;
  }
  const fetchInit: RequestInit = { headers };
  if (opts.signal !== undefined) fetchInit.signal = opts.signal;
  const response = await fetch(url, fetchInit);
  const body = response.body;
  if (body === null) throw new Error('response has no body');
  return { response, events: readSse(body) };
}

/** Pull the next event from the generator with a timeout. */
async function nextEvent(
  events: AsyncGenerator<SseLine, void, void>,
  timeoutMs = 2000,
): Promise<SseLine> {
  const next = events.next();
  const timer = new Promise<never>((_, reject) => {
    const t = setTimeout(() => reject(new Error('SSE event timeout')), timeoutMs);
    if (typeof t.unref === 'function') t.unref();
  });
  const result = await Promise.race([next, timer]);
  if (result.done === true) throw new Error('SSE stream ended unexpectedly');
  return result.value;
}

/** Pull events until either a predicate matches or the stream ends. */
async function consumeUntil(
  events: AsyncGenerator<SseLine, void, void>,
  predicate: (ev: SseLine) => boolean,
  timeoutMs = 2000,
): Promise<SseLine[]> {
  const out: SseLine[] = [];
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const remaining = Math.max(50, deadline - Date.now());
    const ev = await nextEvent(events, remaining);
    out.push(ev);
    if (predicate(ev)) return out;
  }
  throw new Error('predicate not satisfied within timeout');
}

function isEvent(ev: SseLine, type: string): ev is ParsedEvent {
  return 'type' in ev && ev.type === type;
}

describe('GET /api/v1/directives/:id/stream — auth', () => {
  let db: Database;
  let server: ServerHandle;

  beforeEach(async () => {
    db = freshDb();
  });

  afterEach(async () => {
    await server?.stop();
    db.close();
  });

  it('503 UI_DISABLED when no UI auth token is configured', async () => {
    server = await startServer({ db, uiAuthToken: undefined });
    const directive = testDirective();
    directivesQ.insert(db, directive);
    const res = await fetch(`${server.url}/api/v1/directives/${directive.id}/stream?t=anything`);
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('UI_DISABLED');
  });

  it('401 when bearer is missing', async () => {
    server = await startServer({ db, uiAuthToken: UI_TOKEN });
    const directive = testDirective();
    directivesQ.insert(db, directive);
    const res = await fetch(`${server.url}/api/v1/directives/${directive.id}/stream`);
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('UI_AUTH_REQUIRED');
  });

  it('401 when ?t= bearer is wrong', async () => {
    server = await startServer({ db, uiAuthToken: UI_TOKEN });
    const directive = testDirective();
    directivesQ.insert(db, directive);
    const res = await fetch(`${server.url}/api/v1/directives/${directive.id}/stream?t=wrong-token`);
    expect(res.status).toBe(401);
  });

  it('200 with Authorization: Bearer header', async () => {
    server = await startServer({ db, uiAuthToken: UI_TOKEN });
    const directive = testDirective({ status: 'complete' });
    directivesQ.insert(db, directive);
    const ctrl = new AbortController();
    const { response, events } = await openStream(server, directive.id, {
      useHeader: true,
      signal: ctrl.signal,
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    // Drain a couple of events (backfill spend + directive.completed) so the
    // stream cleanly closes before the test ends.
    await consumeUntil(events, (ev) => isEvent(ev, 'directive.completed'));
    ctrl.abort();
  });

  it('200 with ?t= query param', async () => {
    server = await startServer({ db, uiAuthToken: UI_TOKEN });
    const directive = testDirective({ status: 'complete' });
    directivesQ.insert(db, directive);
    const ctrl = new AbortController();
    const { response, events } = await openStream(server, directive.id, {
      signal: ctrl.signal,
    });
    expect(response.status).toBe(200);
    await consumeUntil(events, (ev) => isEvent(ev, 'directive.completed'));
    ctrl.abort();
  });
});

describe('GET /api/v1/directives/:id/stream — directive lookup', () => {
  let db: Database;
  let server: ServerHandle;

  beforeEach(() => {
    db = freshDb();
  });

  afterEach(async () => {
    await server?.stop();
    db.close();
  });

  it('404 when the directive does not exist', async () => {
    server = await startServer({ db, uiAuthToken: UI_TOKEN });
    const res = await fetch(`${server.url}/api/v1/directives/${newId()}/stream?t=${UI_TOKEN}`);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('DIRECTIVE_NOT_FOUND');
  });
});

describe('GET /api/v1/directives/:id/stream — backfill on connect', () => {
  let db: Database;
  let server: ServerHandle;

  beforeEach(() => {
    db = freshDb();
  });

  afterEach(async () => {
    await server?.stop();
    db.close();
  });

  it('replays in-flight tasks as task.started events plus a baseline spend', async () => {
    server = await startServer({ db, uiAuthToken: UI_TOKEN });
    const directive = testDirective();
    directivesQ.insert(db, directive);
    const taskId = newId();
    tasksInflight.register(db, {
      id: taskId,
      directiveId: directive.id,
      planId: newId(),
      title: 'Architect the wiki',
      agent: 'architect',
      category: 'planning',
      status: 'running',
      attempts: 1,
      startedAt: new Date('2026-05-03T09:00:00Z').toISOString(),
    });

    const ctrl = new AbortController();
    const { events } = await openStream(server, directive.id, { signal: ctrl.signal });

    const ev1 = await nextEvent(events);
    expect(isEvent(ev1, 'task.started')).toBe(true);
    expect((ev1 as ParsedEvent).data).toMatchObject({
      taskId,
      directiveId: directive.id,
      title: 'Architect the wiki',
      agent: 'architect',
      category: 'planning',
    });

    const ev2 = await nextEvent(events);
    expect(isEvent(ev2, 'spend.updated')).toBe(true);
    expect((ev2 as ParsedEvent).data).toMatchObject({
      directiveId: directive.id,
      totalCostUsd: 0,
      callCount: 0,
      deltaUsd: 0,
    });

    ctrl.abort();
  });

  it('replays a terminal task as task.started + task.completed', async () => {
    server = await startServer({ db, uiAuthToken: UI_TOKEN });
    const directive = testDirective();
    directivesQ.insert(db, directive);
    const taskId = newId();
    const startedAt = new Date('2026-05-03T09:00:00Z').toISOString();
    const finishedAt = new Date('2026-05-03T09:05:00Z').toISOString();
    tasksInflight.register(db, {
      id: taskId,
      directiveId: directive.id,
      planId: newId(),
      title: 'Plan the build',
      agent: 'planner',
      category: 'planning',
      status: 'running',
      attempts: 1,
      startedAt,
    });
    const result: TaskResult = {
      exitCode: 0,
      filesChanged: ['plan.md'],
      findingsRaised: [],
      signalsEmitted: [],
      durationMs: 1234,
    };
    tasksInflight.markComplete(db, taskId, result, finishedAt);

    const ctrl = new AbortController();
    const { events } = await openStream(server, directive.id, { signal: ctrl.signal });

    const ev1 = await nextEvent(events);
    expect(isEvent(ev1, 'task.started')).toBe(true);
    expect((ev1 as ParsedEvent).data).toMatchObject({ taskId, startedAt });

    const ev2 = await nextEvent(events);
    expect(isEvent(ev2, 'task.completed')).toBe(true);
    expect((ev2 as ParsedEvent).data).toMatchObject({
      taskId,
      status: 'complete',
      exitCode: 0,
      finishedAt,
      error: null,
    });

    ctrl.abort();
  });

  it('emits directive.completed and closes for an already-terminal directive', async () => {
    server = await startServer({ db, uiAuthToken: UI_TOKEN });
    const directive = testDirective({ status: 'complete' });
    directivesQ.insert(db, directive);
    const ctrl = new AbortController();
    const { events } = await openStream(server, directive.id, { signal: ctrl.signal });

    const consumed = await consumeUntil(events, (ev) => isEvent(ev, 'directive.completed'));
    const final = consumed[consumed.length - 1] as ParsedEvent;
    expect(final.type).toBe('directive.completed');
    expect(final.data).toMatchObject({
      directiveId: directive.id,
      status: 'complete',
      blockedReason: null,
    });

    // Stream should close on its own; the next .next() resolves with done=true.
    const after = await events.next();
    expect(after.done).toBe(true);
  });

  it('forwards blockedReason on a blocked terminal directive', async () => {
    server = await startServer({ db, uiAuthToken: UI_TOKEN });
    const directive = testDirective({
      status: 'blocked',
      blockedReason: 'budget_exceeded:max_usd',
    });
    directivesQ.insert(db, directive);
    const ctrl = new AbortController();
    const { events } = await openStream(server, directive.id, { signal: ctrl.signal });

    const consumed = await consumeUntil(events, (ev) => isEvent(ev, 'directive.completed'));
    const final = consumed[consumed.length - 1] as ParsedEvent;
    expect(final.data).toMatchObject({
      status: 'blocked',
      blockedReason: 'budget_exceeded:max_usd',
    });
  });
});

describe('GET /api/v1/directives/:id/stream — live emission', () => {
  let db: Database;
  let server: ServerHandle;

  beforeEach(() => {
    db = freshDb();
  });

  afterEach(async () => {
    await server?.stop();
    db.close();
  });

  it('forwards a hub.emit through to the connected client', async () => {
    server = await startServer({ db, uiAuthToken: UI_TOKEN });
    const directive = testDirective();
    directivesQ.insert(db, directive);
    const ctrl = new AbortController();
    const { events } = await openStream(server, directive.id, { signal: ctrl.signal });

    // Drain backfill (only spend, since no tasks).
    const backfill = await nextEvent(events);
    expect(isEvent(backfill, 'spend.updated')).toBe(true);

    const taskId = newId();
    server.hub.emit({
      type: 'task.started',
      taskId,
      directiveId: directive.id,
      title: 'Live task',
      agent: 'builder',
      category: 'reasoning',
      startedAt: new Date().toISOString(),
    });

    const live = await nextEvent(events);
    expect(isEvent(live, 'task.started')).toBe(true);
    expect((live as ParsedEvent).data).toMatchObject({ taskId, title: 'Live task' });

    ctrl.abort();
  });

  it('closes the stream after a directive.completed live event', async () => {
    server = await startServer({ db, uiAuthToken: UI_TOKEN });
    const directive = testDirective();
    directivesQ.insert(db, directive);
    const ctrl = new AbortController();
    const { events } = await openStream(server, directive.id, { signal: ctrl.signal });

    // Drain backfill.
    await nextEvent(events);

    server.hub.emit({
      type: 'directive.completed',
      directiveId: directive.id,
      status: 'complete',
      blockedReason: null,
    });

    const live = await nextEvent(events);
    expect(isEvent(live, 'directive.completed')).toBe(true);

    // Server-side close — the next read returns done=true.
    const after = await events.next();
    expect(after.done).toBe(true);
  });

  it('only delivers events for the subscribed directive', async () => {
    server = await startServer({ db, uiAuthToken: UI_TOKEN });
    const a = testDirective();
    const b = testDirective();
    directivesQ.insert(db, a);
    directivesQ.insert(db, b);
    const ctrl = new AbortController();
    const { events } = await openStream(server, a.id, { signal: ctrl.signal });

    // Drain a's backfill.
    await nextEvent(events);

    // Emit on B; we should NOT see it on A's stream.
    server.hub.emit({
      type: 'task.started',
      taskId: newId(),
      directiveId: b.id,
      title: 'Wrong directive',
      agent: 'builder',
      category: 'reasoning',
      startedAt: new Date().toISOString(),
    });

    // Now emit on A and confirm we see only A's event.
    const aTaskId = newId();
    server.hub.emit({
      type: 'task.started',
      taskId: aTaskId,
      directiveId: a.id,
      title: 'Right directive',
      agent: 'builder',
      category: 'reasoning',
      startedAt: new Date().toISOString(),
    });

    const ev = await nextEvent(events);
    expect((ev as ParsedEvent).data).toMatchObject({ taskId: aTaskId });

    ctrl.abort();
  });
});

describe('GET /api/v1/directives/:id/stream — heartbeat + cleanup', () => {
  let db: Database;
  let server: ServerHandle;

  beforeEach(() => {
    db = freshDb();
  });

  afterEach(async () => {
    await server?.stop();
    db.close();
  });

  it('emits a :keepalive comment line on idle (with a small heartbeat interval)', async () => {
    server = await startServer({ db, uiAuthToken: UI_TOKEN, heartbeatMs: 100 });
    const directive = testDirective();
    directivesQ.insert(db, directive);
    const ctrl = new AbortController();
    const { events } = await openStream(server, directive.id, { signal: ctrl.signal });

    // Drain backfill.
    await nextEvent(events);

    // Wait long enough for at least one heartbeat to fire.
    const ev = await nextEvent(events, 1000);
    expect('keepalive' in ev).toBe(true);

    ctrl.abort();
  });

  it('unsubscribes on client disconnect (hub.listenerCount returns to 0)', async () => {
    server = await startServer({ db, uiAuthToken: UI_TOKEN });
    const directive = testDirective();
    directivesQ.insert(db, directive);
    const ctrl = new AbortController();
    const { events } = await openStream(server, directive.id, { signal: ctrl.signal });

    // Drain backfill so we know the handler reached the subscribe step.
    await nextEvent(events);
    expect(server.hub.listenerCount(directive.id)).toBe(1);

    ctrl.abort();
    // Wait for the close handler to run on the server.
    await waitFor(() => server.hub.listenerCount(directive.id) === 0, 2000);
    expect(server.hub.listenerCount(directive.id)).toBe(0);
  });
});

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error('waitFor: predicate did not become true within timeout');
}
