/**
 * Tier 12 / ADR 0032 §4 — budget-escalation tests.
 *
 * Unit-tests for the pure helpers + an integration covering the
 * askUser+answer round-trip path.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { newId, type Directive } from '@factory5/core';
import { initLogger } from '@factory5/logger';
import {
  directives as directivesQ,
  openDatabase,
  pendingQuestions,
  runMigrations,
  type Database,
} from '@factory5/state';

import {
  axisForAgent,
  BUDGET_ESCALATION_MARKER,
  escalateBudgetTrip,
  MAX_TURNS_CLAMP_MAX,
  MAX_TURNS_CLAMP_MIN,
  parseBudgetEscalationAnswer,
  renderBudgetEscalationQuestion,
  suggestedNextBucket,
} from './budget-escalation.js';

beforeAll(() => {
  initLogger({ processName: 'budget-escalation-test', noFile: true, noConsole: true });
});

function freshDb(): Database {
  const db = openDatabase(':memory:');
  runMigrations(db);
  return db;
}

function seedDirective(db: Database): Directive {
  const d: Directive = {
    id: newId(),
    source: 'cli',
    principal: 'tester',
    channelRef: 'sess-1',
    intent: 'build',
    payload: {},
    autonomy: 'autonomous',
    createdAt: new Date().toISOString(),
    status: 'running',
  };
  directivesQ.insert(db, d);
  return d;
}

describe('axisForAgent', () => {
  it('maps tool-using agents to their maxTurns axis', () => {
    expect(axisForAgent('scaffolder')).toBe('maxTurnsScaffolder');
    expect(axisForAgent('builder')).toBe('maxTurnsBuilder');
    expect(axisForAgent('fixer')).toBe('maxTurnsFixer');
  });

  it('returns undefined for read-only agents', () => {
    expect(axisForAgent('triage')).toBeUndefined();
    expect(axisForAgent('architect')).toBeUndefined();
    expect(axisForAgent('planner')).toBeUndefined();
    expect(axisForAgent('reviewer')).toBeUndefined();
    expect(axisForAgent('verifier')).toBeUndefined();
    expect(axisForAgent('investigator')).toBeUndefined();
  });
});

describe('suggestedNextBucket', () => {
  it('returns the next bucket strictly greater than current (scaffolder 80→120→160)', () => {
    expect(suggestedNextBucket('maxTurnsScaffolder', 40)).toBe(80);
    expect(suggestedNextBucket('maxTurnsScaffolder', 80)).toBe(120);
    expect(suggestedNextBucket('maxTurnsScaffolder', 100)).toBe(120);
    expect(suggestedNextBucket('maxTurnsScaffolder', 120)).toBe(160);
  });

  it('returns the next bucket for builder + fixer (80→160)', () => {
    expect(suggestedNextBucket('maxTurnsBuilder', 80)).toBe(160);
    expect(suggestedNextBucket('maxTurnsFixer', 100)).toBe(160);
  });

  it('returns undefined when already at or above the max bucket', () => {
    expect(suggestedNextBucket('maxTurnsScaffolder', 160)).toBeUndefined();
    expect(suggestedNextBucket('maxTurnsScaffolder', 200)).toBeUndefined();
    expect(suggestedNextBucket('maxTurnsBuilder', 160)).toBeUndefined();
    expect(suggestedNextBucket('maxTurnsFixer', 200)).toBeUndefined();
  });
});

describe('renderBudgetEscalationQuestion', () => {
  it('prefixes with the budget marker so auto-answer can pattern-match', () => {
    const q = renderBudgetEscalationQuestion({
      taskTitle: 'scaffold automl',
      axis: 'maxTurnsScaffolder',
      currentValue: 80,
      suggestedNext: 120,
    });
    expect(q.startsWith(BUDGET_ESCALATION_MARKER)).toBe(true);
  });

  it('embeds task title + axis + current + suggested next in prose', () => {
    const q = renderBudgetEscalationQuestion({
      taskTitle: 'scaffold automl',
      axis: 'maxTurnsScaffolder',
      currentValue: 80,
      suggestedNext: 120,
    });
    expect(q).toContain('scaffold automl');
    expect(q).toContain('maxTurnsScaffolder');
    expect(q).toContain('80');
    expect(q).toContain('120');
  });

  it('switches the bump hint when no next bucket exists', () => {
    const q = renderBudgetEscalationQuestion({
      taskTitle: 'fix things',
      axis: 'maxTurnsFixer',
      currentValue: 200,
      suggestedNext: undefined,
    });
    expect(q).toContain('no next bucket');
  });
});

describe('parseBudgetEscalationAnswer', () => {
  it("parses 'accept' as the suggested-next bump", () => {
    expect(parseBudgetEscalationAnswer('accept', 120)).toEqual({
      kind: 'accept',
      newValue: 120,
    });
  });

  it("case-insensitive 'ACCEPT' + whitespace tolerant", () => {
    expect(parseBudgetEscalationAnswer('  ACCEPT  ', 160)).toEqual({
      kind: 'accept',
      newValue: 160,
    });
  });

  it("parses 'abort' as operator abort", () => {
    expect(parseBudgetEscalationAnswer('abort', 120)).toEqual({
      kind: 'abort',
      reason: 'operator',
    });
  });

  it("parses 'custom <n>' and clamps to [10, 160]", () => {
    expect(parseBudgetEscalationAnswer('custom 100', 120)).toEqual({
      kind: 'custom',
      newValue: 100,
    });
    expect(parseBudgetEscalationAnswer('custom 5', 120)).toEqual({
      kind: 'custom',
      newValue: MAX_TURNS_CLAMP_MIN,
    });
    expect(parseBudgetEscalationAnswer('custom 999', 120)).toEqual({
      kind: 'custom',
      newValue: MAX_TURNS_CLAMP_MAX,
    });
  });

  it("falls back to abort/parse-failed for 'accept' when no suggested-next exists", () => {
    expect(parseBudgetEscalationAnswer('accept', undefined)).toEqual({
      kind: 'abort',
      reason: 'parse-failed',
    });
  });

  it('falls back to abort/parse-failed for garbled answers', () => {
    expect(parseBudgetEscalationAnswer('maybe later', 120)).toEqual({
      kind: 'abort',
      reason: 'parse-failed',
    });
    expect(parseBudgetEscalationAnswer('custom abc', 120)).toEqual({
      kind: 'abort',
      reason: 'parse-failed',
    });
  });
});

describe('escalateBudgetTrip — integration with askUser', () => {
  let db: Database;
  beforeEach(() => {
    db = freshDb();
  });
  afterEach(() => {
    db.close();
  });

  it("returns 'accept'+suggestedNext when the operator writes 'accept'", async () => {
    const d = seedDirective(db);
    const taskId = newId();

    // Kick the askUser poll in the background; pre-stamp the answer after
    // a beat so the helper resolves promptly.
    const pending = escalateBudgetTrip({
      db,
      directiveId: d.id,
      taskId,
      taskTitle: 'scaffold automl',
      axis: 'maxTurnsScaffolder',
      currentValue: 80,
      pollIntervalMs: 5,
    });
    // Wait a tick for the question row to land, then answer it.
    await new Promise((r) => setTimeout(r, 20));
    const open = pendingQuestions.openForDirective(db, d.id);
    expect(open).toHaveLength(1);
    pendingQuestions.answer(db, open[0]!.id, 'accept', new Date().toISOString());
    const outcome = await pending;
    expect(outcome).toEqual({ kind: 'accept', newValue: 120 });
  });

  it("returns 'abort/operator' when the operator writes 'abort'", async () => {
    const d = seedDirective(db);
    const taskId = newId();
    const pending = escalateBudgetTrip({
      db,
      directiveId: d.id,
      taskId,
      taskTitle: 'fix it',
      axis: 'maxTurnsFixer',
      currentValue: 80,
      pollIntervalMs: 5,
    });
    await new Promise((r) => setTimeout(r, 20));
    const open = pendingQuestions.openForDirective(db, d.id);
    pendingQuestions.answer(db, open[0]!.id, 'abort', new Date().toISOString());
    const outcome = await pending;
    expect(outcome).toEqual({ kind: 'abort', reason: 'operator' });
  });

  it("returns 'custom' with the clamped value when the operator writes 'custom 100'", async () => {
    const d = seedDirective(db);
    const taskId = newId();
    const pending = escalateBudgetTrip({
      db,
      directiveId: d.id,
      taskId,
      taskTitle: 'build app',
      axis: 'maxTurnsBuilder',
      currentValue: 80,
      pollIntervalMs: 5,
    });
    await new Promise((r) => setTimeout(r, 20));
    const open = pendingQuestions.openForDirective(db, d.id);
    pendingQuestions.answer(db, open[0]!.id, 'custom 110', new Date().toISOString());
    const outcome = await pending;
    expect(outcome).toEqual({ kind: 'custom', newValue: 110 });
  });

  it('stamps the question with the budget marker so auto-answer can pattern-match', async () => {
    const d = seedDirective(db);
    const taskId = newId();
    const pending = escalateBudgetTrip({
      db,
      directiveId: d.id,
      taskId,
      taskTitle: 'scaffold',
      axis: 'maxTurnsScaffolder',
      currentValue: 80,
      pollIntervalMs: 5,
    });
    await new Promise((r) => setTimeout(r, 20));
    const open = pendingQuestions.openForDirective(db, d.id);
    expect(open[0]?.question.startsWith(BUDGET_ESCALATION_MARKER)).toBe(true);
    expect(open[0]?.taskId).toBe(taskId);
    pendingQuestions.answer(db, open[0]!.id, 'abort', new Date().toISOString());
    await pending;
  });
});
