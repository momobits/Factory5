/**
 * End-to-end regression suite for the worker-subprocess `ask_user`
 * pipeline (ADR 0024 §6). Each describe block covers one of the four
 * scenarios the ADR calls out:
 *
 *   1. Happy path — inject `POST /worker/ask-user`, writer thread answers
 *      mid-poll, response carries the answer, task transitions
 *      `running` → `waiting_for_human` → `running`.
 *   2. Brain-restart mid-wait — seed a pre-existing wait, run the daemon's
 *      `recoverFromHumanWaits` startup pass, verify the row is aborted
 *      and any late answer is flagged by `detectOrphanedAnswer`.
 *   3. Two-workers correlation — two parallel injects under one directive
 *      with distinct task ids, two parallel answer writers, no crossover.
 *   4. Late-answer no-op — task is already `aborted`; the channel
 *      collector writes the answer anyway; the row is updated for
 *      forensic value and `detectOrphanedAnswer` flags the orphan.
 *
 * Composes `buildWorkerAskUserHandler` + `buildIpcServer` directly so the
 * tests exercise the real daemon route without spinning up pidfiles,
 * channels, brain supervisor, or the fs-watcher.
 */

import { newId, type Directive } from '@factory5/core';
import { initLogger, createLogger } from '@factory5/logger';
import {
  openDatabase,
  pendingQuestions,
  runMigrations,
  directives as directivesQ,
  tasksInflight,
  type Database,
} from '@factory5/state';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { Doorbell } from './doorbell.js';
import { buildWorkerAskUserHandler, recoverFromHumanWaits } from './index.js';
import { buildIpcServer } from './server.js';

beforeAll(() => {
  initLogger({ processName: 'worker-ask-user-regression', noFile: true, noConsole: true });
});

const STARTED_AT = new Date('2026-04-23T12:00:00Z').toISOString();
/** Fast poll cadence so answer-arrives-mid-wait scenarios finish in <100ms. */
const POLL_INTERVAL_MS = 5;

function freshDb(): Database {
  const db = openDatabase(':memory:');
  runMigrations(db);
  return db;
}

function seedDirective(db: Database): Directive {
  const directive: Directive = {
    id: newId(),
    source: 'cli',
    principal: 'regression',
    channelRef: 'session-1',
    intent: 'build',
    payload: {},
    autonomy: 'assisted',
    createdAt: new Date().toISOString(),
    status: 'running',
  };
  directivesQ.insert(db, directive);
  return directive;
}

function seedRunningTask(db: Database, directiveId: string): string {
  const id = newId();
  const now = new Date().toISOString();
  tasksInflight.register(db, {
    id,
    directiveId,
    planId: 'plan-1',
    title: 'regression-task',
    agent: 'builder',
    category: 'deep',
    status: 'running',
    attempts: 0,
    startedAt: now,
    lastHeartbeat: now,
  });
  return id;
}

function buildApp(db: Database): FastifyInstance {
  const handler = buildWorkerAskUserHandler({
    db,
    defaultDeadlineSeconds: 3600,
    pollIntervalMs: POLL_INTERVAL_MS,
  });
  return buildIpcServer({
    host: '127.0.0.1',
    port: 0,
    db,
    doorbell: new Doorbell(),
    startedAt: STARTED_AT,
    version: '0.0.1',
    processName: 'factoryd-test',
    workerAskUser: handler,
  });
}

/**
 * Poll `predicate` until it returns true or the timeout elapses. Used by
 * the happy-path and two-workers scenarios to observe the intermediate
 * `waiting_for_human` state before writing the answer.
 */
async function waitFor(predicate: () => boolean, timeoutMs = 500): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  throw new Error(`waitFor: predicate stayed false after ${timeoutMs.toString()}ms`);
}

interface WorkerAskUserBody {
  questionId: string;
  answer?: string;
  timedOut: boolean;
  aborted: boolean;
}

// ---------------------------------------------------------------------------
// Scenario 1 — happy path (ADR 0024 §6.1)
// ---------------------------------------------------------------------------

describe('worker ask-user regression — happy path (ADR 0024 §6.1)', () => {
  let db: Database;
  let app: FastifyInstance;

  beforeEach(() => {
    db = freshDb();
    app = buildApp(db);
  });

  afterEach(async () => {
    await app.close();
    db.close();
  });

  it('transitions running → waiting_for_human → running and returns the answer', async () => {
    const directive = seedDirective(db);
    const taskId = seedRunningTask(db, directive.id);

    // Kick off the request; the handler enters its poll loop asynchronously.
    const injectP = app.inject({
      method: 'POST',
      url: '/worker/ask-user',
      payload: { taskId, directiveId: directive.id, question: 'jwt or session?' },
    });

    // Observe the mid-flight waiting_for_human state before writing the answer.
    await waitFor(() => tasksInflight.getById(db, taskId)?.status === 'waiting_for_human');
    const waitingTask = tasksInflight.getById(db, taskId);
    expect(waitingTask?.status).toBe('waiting_for_human');
    expect(waitingTask?.waitingQuestionId).toBeDefined();
    const qId = waitingTask?.waitingQuestionId;
    if (qId === undefined) throw new Error('waitingQuestionId should be set');

    // Writer thread — a channel collector would do this after the operator replies.
    pendingQuestions.answer(db, qId, 'jwt', new Date().toISOString());

    const res = await injectP;
    expect(res.statusCode).toBe(200);
    const body = res.json() as WorkerAskUserBody;
    expect(body.questionId).toBe(qId);
    expect(body.answer).toBe('jwt');
    expect(body.timedOut).toBe(false);
    expect(body.aborted).toBe(false);

    const finalTask = tasksInflight.getById(db, taskId);
    expect(finalTask?.status).toBe('running');
    expect(finalTask?.waitingQuestionId).toBeUndefined();

    // No late-answer warning fires — the consumer (this handler) was alive.
    expect(pendingQuestions.detectOrphanedAnswer(db, qId)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Scenario 2 — brain-restart mid-wait (ADR 0024 §6.2)
// ---------------------------------------------------------------------------

describe('worker ask-user regression — brain-restart mid-wait (ADR 0024 §6.2)', () => {
  let db: Database;

  beforeEach(() => {
    db = freshDb();
  });

  afterEach(() => {
    db.close();
  });

  it('recoverFromHumanWaits aborts orphans; a later answer is flagged', () => {
    const directive = seedDirective(db);
    const taskId = seedRunningTask(db, directive.id);

    // Simulate the state a prior brain left behind when it died mid-poll.
    const qId = newId();
    const when = new Date('2026-04-23T12:30:00Z').toISOString();
    pendingQuestions.create(db, {
      id: qId,
      directiveId: directive.id,
      taskId,
      question: 'jwt or session?',
      channel: 'cli',
      channelRef: directive.channelRef,
      createdAt: when,
    });
    tasksInflight.markWaitingForHuman(db, taskId, qId, when);

    // Drive the startup recovery pass directly — `startDaemon` invokes
    // this before the brain supervisor boots.
    const recovered = recoverFromHumanWaits(db, createLogger('regression.recover'));
    expect(recovered).toBe(1);

    const recoveredTask = tasksInflight.getById(db, taskId);
    expect(recoveredTask?.status).toBe('aborted');
    expect(recoveredTask?.abortedReason).toBe('brain_restart_during_human_wait');
    expect(recoveredTask?.finishedAt).toBeDefined();

    // Idempotency: a second call recovers nothing once the orphans are gone.
    expect(recoverFromHumanWaits(db, createLogger('regression.recover'))).toBe(0);

    // Channel collector delivers the operator's answer after the task ended.
    const answeredAt = new Date('2026-04-23T12:45:00Z').toISOString();
    pendingQuestions.answer(db, qId, 'jwt', answeredAt);

    // Row update is preserved for forensic value.
    const row = pendingQuestions.getById(db, qId);
    expect(row?.answer).toBe('jwt');
    expect(row?.answeredAt).toBe(answeredAt);

    // detectOrphanedAnswer flags the late arrival against the aborted task.
    expect(pendingQuestions.detectOrphanedAnswer(db, qId)).toEqual({
      taskId,
      taskStatus: 'aborted',
    });
  });
});

// ---------------------------------------------------------------------------
// Scenario 3 — two-workers correlation (ADR 0024 §6.3)
// ---------------------------------------------------------------------------

describe('worker ask-user regression — two-workers correlation (ADR 0024 §6.3)', () => {
  let db: Database;
  let app: FastifyInstance;

  beforeEach(() => {
    db = freshDb();
    app = buildApp(db);
  });

  afterEach(async () => {
    await app.close();
    db.close();
  });

  it('parallel injects on one directive stay partitioned by taskId — no crossover', async () => {
    const directive = seedDirective(db);
    const taskA = seedRunningTask(db, directive.id);
    const taskB = seedRunningTask(db, directive.id);

    const injectA = app.inject({
      method: 'POST',
      url: '/worker/ask-user',
      payload: { taskId: taskA, directiveId: directive.id, question: 'A: jwt or session?' },
    });
    const injectB = app.inject({
      method: 'POST',
      url: '/worker/ask-user',
      payload: {
        taskId: taskB,
        directiveId: directive.id,
        question: 'B: postgres or sqlite?',
      },
    });

    // Both handlers should be waiting on their own question.
    await waitFor(() => {
      const a = tasksInflight.getById(db, taskA);
      const b = tasksInflight.getById(db, taskB);
      return a?.status === 'waiting_for_human' && b?.status === 'waiting_for_human';
    });

    const qA = tasksInflight.getById(db, taskA)?.waitingQuestionId;
    const qB = tasksInflight.getById(db, taskB)?.waitingQuestionId;
    if (qA === undefined || qB === undefined) throw new Error('both qIds should be set');
    expect(qA).not.toBe(qB);

    // Distinct writers answer each question — crossover would surface as
    // the wrong answer in one of the response bodies.
    const when = new Date().toISOString();
    pendingQuestions.answer(db, qA, 'answer-A', when);
    pendingQuestions.answer(db, qB, 'answer-B', when);

    const [resA, resB] = await Promise.all([injectA, injectB]);
    expect(resA.statusCode).toBe(200);
    expect(resB.statusCode).toBe(200);
    const bodyA = resA.json() as WorkerAskUserBody;
    const bodyB = resB.json() as WorkerAskUserBody;

    expect(bodyA.questionId).toBe(qA);
    expect(bodyA.answer).toBe('answer-A');
    expect(bodyB.questionId).toBe(qB);
    expect(bodyB.answer).toBe('answer-B');

    // Both tasks flipped back to running.
    expect(tasksInflight.getById(db, taskA)?.status).toBe('running');
    expect(tasksInflight.getById(db, taskB)?.status).toBe('running');

    // pending_questions.task_id partitions the rows correctly.
    expect(pendingQuestions.getById(db, qA)?.taskId).toBe(taskA);
    expect(pendingQuestions.getById(db, qB)?.taskId).toBe(taskB);
  });
});

// ---------------------------------------------------------------------------
// Scenario 4 — late-answer no-op (ADR 0024 §6.4)
// ---------------------------------------------------------------------------

describe('worker ask-user regression — late-answer no-op (ADR 0024 §6.4)', () => {
  let db: Database;

  beforeEach(() => {
    db = freshDb();
  });

  afterEach(() => {
    db.close();
  });

  it('channel collector writing to an already-terminal task flags orphan without side effects', () => {
    const directive = seedDirective(db);
    const taskId = seedRunningTask(db, directive.id);

    // Abort the task preemptively (e.g. directive budget exceeded before
    // the answer arrived).
    const abortedAt = new Date('2026-04-23T13:00:00Z').toISOString();
    tasksInflight.markAborted(db, taskId, 'budget_exhausted', abortedAt);

    // Seed the pending question the aborted task was waiting on.
    const qId = newId();
    pendingQuestions.create(db, {
      id: qId,
      directiveId: directive.id,
      taskId,
      question: 'stale question',
      channel: 'cli',
      channelRef: directive.channelRef,
      createdAt: new Date('2026-04-23T12:55:00Z').toISOString(),
    });

    // Channel collector delivers the operator's answer after the task ended.
    const answeredAt = new Date('2026-04-23T13:02:00Z').toISOString();
    pendingQuestions.answer(db, qId, 'too-late', answeredAt);

    // Row update is observable — forensic value preserved either way.
    const row = pendingQuestions.getById(db, qId);
    expect(row?.answer).toBe('too-late');
    expect(row?.answeredAt).toBe(answeredAt);

    // detectOrphanedAnswer flags the late arrival.
    expect(pendingQuestions.detectOrphanedAnswer(db, qId)).toEqual({
      taskId,
      taskStatus: 'aborted',
    });

    // Task's terminal state is unchanged — no resume is triggered (structurally,
    // no consumer exists to resume).
    const postTask = tasksInflight.getById(db, taskId);
    expect(postTask?.status).toBe('aborted');
    expect(postTask?.abortedReason).toBe('budget_exhausted');
    expect(postTask?.finishedAt).toBe(abortedAt);
  });
});
