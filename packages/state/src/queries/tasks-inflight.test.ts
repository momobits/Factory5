import { newId } from '@factory5/core';
import BetterSqlite3 from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

import { runMigrations } from '../migrations/index.js';
import * as directives from './directives.js';
import * as pendingQuestions from './pending-questions.js';
import * as tasksInflight from './tasks-inflight.js';
import { isTerminalStatus, type InflightTask } from './tasks-inflight.js';

function freshDb(): BetterSqlite3.Database {
  const db = new BetterSqlite3(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

function seedDirective(db: BetterSqlite3.Database): string {
  const id = newId();
  directives.insert(db, {
    id,
    source: 'cli',
    principal: 'me',
    channelRef: 'r1',
    intent: 'build',
    payload: {},
    autonomy: 'autonomous',
    createdAt: new Date().toISOString(),
    status: 'pending',
  });
  return id;
}

function seedRunningTask(db: BetterSqlite3.Database, directiveId: string): string {
  const id = newId();
  const task: InflightTask = {
    id,
    directiveId,
    planId: 'plan-1',
    title: 'task-1',
    agent: 'builder',
    category: 'deep',
    status: 'running',
    attempts: 0,
    startedAt: new Date().toISOString(),
    lastHeartbeat: new Date().toISOString(),
  };
  tasksInflight.register(db, task);
  return id;
}

describe('tasks-inflight — terminal-status helper', () => {
  it('flags complete/failed/blocked/aborted as terminal', () => {
    expect(isTerminalStatus('complete')).toBe(true);
    expect(isTerminalStatus('failed')).toBe(true);
    expect(isTerminalStatus('blocked')).toBe(true);
    expect(isTerminalStatus('aborted')).toBe(true);
  });

  it('does NOT flag pending/running/waiting_for_human as terminal', () => {
    expect(isTerminalStatus('pending')).toBe(false);
    expect(isTerminalStatus('running')).toBe(false);
    expect(isTerminalStatus('waiting_for_human')).toBe(false);
  });
});

describe('tasks-inflight — getById', () => {
  it('returns the task with new columns nullable when unset', () => {
    const db = freshDb();
    const dId = seedDirective(db);
    const tId = seedRunningTask(db, dId);
    const task = tasksInflight.getById(db, tId);
    expect(task).toBeDefined();
    expect(task?.id).toBe(tId);
    expect(task?.status).toBe('running');
    expect(task?.waitingQuestionId).toBeUndefined();
    expect(task?.abortedReason).toBeUndefined();
  });

  it('returns undefined for unknown id', () => {
    const db = freshDb();
    expect(tasksInflight.getById(db, newId())).toBeUndefined();
  });
});

describe('tasks-inflight — markWaitingForHuman', () => {
  it('flips running → waiting_for_human and stores the question id', () => {
    const db = freshDb();
    const dId = seedDirective(db);
    const tId = seedRunningTask(db, dId);
    const qId = newId();
    tasksInflight.markWaitingForHuman(db, tId, qId, '2026-04-23T10:00:00.000Z');
    const task = tasksInflight.getById(db, tId);
    expect(task?.status).toBe('waiting_for_human');
    expect(task?.waitingQuestionId).toBe(qId);
    expect(task?.lastHeartbeat).toBe('2026-04-23T10:00:00.000Z');
  });

  it("is a no-op when the task isn't currently running (won't downgrade aborted)", () => {
    const db = freshDb();
    const dId = seedDirective(db);
    const tId = seedRunningTask(db, dId);
    tasksInflight.markAborted(db, tId, 'test', '2026-04-23T10:00:00.000Z');
    const qId = newId();
    tasksInflight.markWaitingForHuman(db, tId, qId, '2026-04-23T11:00:00.000Z');
    const task = tasksInflight.getById(db, tId);
    expect(task?.status).toBe('aborted');
    expect(task?.waitingQuestionId).toBeUndefined();
  });
});

describe('tasks-inflight — markRunningAfterAnswer', () => {
  it('flips waiting_for_human → running and clears the question id', () => {
    const db = freshDb();
    const dId = seedDirective(db);
    const tId = seedRunningTask(db, dId);
    tasksInflight.markWaitingForHuman(db, tId, newId(), '2026-04-23T10:00:00.000Z');
    tasksInflight.markRunningAfterAnswer(db, tId, '2026-04-23T10:05:00.000Z');
    const task = tasksInflight.getById(db, tId);
    expect(task?.status).toBe('running');
    expect(task?.waitingQuestionId).toBeUndefined();
    expect(task?.lastHeartbeat).toBe('2026-04-23T10:05:00.000Z');
  });

  it('is a no-op for tasks already aborted by orphan recovery (race-safe)', () => {
    const db = freshDb();
    const dId = seedDirective(db);
    const tId = seedRunningTask(db, dId);
    tasksInflight.markWaitingForHuman(db, tId, newId(), '2026-04-23T10:00:00.000Z');
    tasksInflight.markAborted(
      db,
      tId,
      'brain_restart_during_human_wait',
      '2026-04-23T10:01:00.000Z',
    );
    tasksInflight.markRunningAfterAnswer(db, tId, '2026-04-23T10:02:00.000Z');
    const task = tasksInflight.getById(db, tId);
    expect(task?.status).toBe('aborted');
  });
});

describe('tasks-inflight — markAborted', () => {
  it('writes status, reason, and finished_at', () => {
    const db = freshDb();
    const dId = seedDirective(db);
    const tId = seedRunningTask(db, dId);
    tasksInflight.markAborted(db, tId, 'test_reason', '2026-04-23T10:00:00.000Z');
    const task = tasksInflight.getById(db, tId);
    expect(task?.status).toBe('aborted');
    expect(task?.abortedReason).toBe('test_reason');
    expect(task?.finishedAt).toBe('2026-04-23T10:00:00.000Z');
  });
});

describe('tasks-inflight — findOrphanedHumanWaits', () => {
  it('returns only tasks currently in waiting_for_human', () => {
    const db = freshDb();
    const dId = seedDirective(db);
    const tWait = seedRunningTask(db, dId);
    tasksInflight.markWaitingForHuman(db, tWait, newId(), '2026-04-23T10:00:00.000Z');
    const tRunning = seedRunningTask(db, dId); // stays running
    const tAborted = seedRunningTask(db, dId);
    tasksInflight.markAborted(db, tAborted, 'x', '2026-04-23T10:00:00.000Z');

    const orphans = tasksInflight.findOrphanedHumanWaits(db);
    expect(orphans).toHaveLength(1);
    expect(orphans[0]?.id).toBe(tWait);
    // sanity: ensure other rows didn't accidentally appear
    expect(orphans.map((o) => o.id)).not.toContain(tRunning);
    expect(orphans.map((o) => o.id)).not.toContain(tAborted);
  });

  it('returns empty when nothing is waiting', () => {
    const db = freshDb();
    expect(tasksInflight.findOrphanedHumanWaits(db)).toEqual([]);
  });
});

describe('pendingQuestions.detectOrphanedAnswer', () => {
  it('returns task info when the linked task is terminal', () => {
    const db = freshDb();
    const dId = seedDirective(db);
    const tId = seedRunningTask(db, dId);
    tasksInflight.markAborted(db, tId, 'test', '2026-04-23T10:00:00.000Z');
    const qId = newId();
    pendingQuestions.create(db, {
      id: qId,
      directiveId: dId,
      taskId: tId,
      question: 'q?',
      channel: 'cli',
      channelRef: 'r1',
      createdAt: '2026-04-23T09:00:00.000Z',
    });
    pendingQuestions.answer(db, qId, 'a', '2026-04-23T11:00:00.000Z');
    const orphan = pendingQuestions.detectOrphanedAnswer(db, qId);
    expect(orphan).toEqual({ taskId: tId, taskStatus: 'aborted' });
  });

  it('returns undefined when the task is still running', () => {
    const db = freshDb();
    const dId = seedDirective(db);
    const tId = seedRunningTask(db, dId);
    const qId = newId();
    pendingQuestions.create(db, {
      id: qId,
      directiveId: dId,
      taskId: tId,
      question: 'q?',
      channel: 'cli',
      channelRef: 'r1',
      createdAt: '2026-04-23T09:00:00.000Z',
    });
    pendingQuestions.answer(db, qId, 'a', '2026-04-23T11:00:00.000Z');
    expect(pendingQuestions.detectOrphanedAnswer(db, qId)).toBeUndefined();
  });

  it('returns undefined for brain-originated questions (no taskId)', () => {
    const db = freshDb();
    const dId = seedDirective(db);
    const qId = newId();
    pendingQuestions.create(db, {
      id: qId,
      directiveId: dId,
      question: 'q?',
      channel: 'cli',
      channelRef: 'r1',
      createdAt: '2026-04-23T09:00:00.000Z',
    });
    pendingQuestions.answer(db, qId, 'a', '2026-04-23T11:00:00.000Z');
    expect(pendingQuestions.detectOrphanedAnswer(db, qId)).toBeUndefined();
  });

  it('treats a missing task row as orphaned (forensic-safe default)', () => {
    const db = freshDb();
    const dId = seedDirective(db);
    const fakeTaskId = newId();
    const qId = newId();
    pendingQuestions.create(db, {
      id: qId,
      directiveId: dId,
      taskId: fakeTaskId,
      question: 'q?',
      channel: 'cli',
      channelRef: 'r1',
      createdAt: '2026-04-23T09:00:00.000Z',
    });
    pendingQuestions.answer(db, qId, 'a', '2026-04-23T11:00:00.000Z');
    const orphan = pendingQuestions.detectOrphanedAnswer(db, qId);
    expect(orphan).toEqual({ taskId: fakeTaskId, taskStatus: 'aborted' });
  });
});
