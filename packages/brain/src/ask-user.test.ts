/**
 * Unit tests for {@link askUser} / {@link escalateBlocked} — the brain's
 * pending-question primitives.
 */

import { describe, expect, it } from 'vitest';

import { DEFAULT_ASK_USER_DEADLINE_MS, newId } from '@factory5/core';
import {
  directives as directivesQ,
  openDatabase,
  outbound,
  pendingQuestions,
  runMigrations,
} from '@factory5/state';

import {
  askUser,
  defaultAskUserOutbound,
  defaultEscalateOutbound,
  escalateBlocked,
  openQuestionsForDirective,
} from './ask-user.js';

function freshDb(): ReturnType<typeof openDatabase> {
  const db = openDatabase(':memory:');
  runMigrations(db);
  return db;
}

function seedDirective(
  db: ReturnType<typeof openDatabase>,
  overrides: Partial<{ source: 'cli' | 'discord'; channelRef: string }> = {},
): string {
  const id = newId();
  directivesQ.insert(db, {
    id,
    source: overrides.source ?? 'cli',
    principal: 'tester',
    channelRef: overrides.channelRef ?? 'session-test',
    intent: 'chat',
    payload: { text: 'hi' },
    autonomy: 'chat',
    createdAt: new Date().toISOString(),
    status: 'running',
  });
  return id;
}

describe('askUser', () => {
  it('creates a pending_questions row, enqueues an outbound message, and resolves when answered', async () => {
    const db = freshDb();
    const directiveId = seedDirective(db);

    const pollIntervalMs = 20;
    const pending = askUser({
      db,
      directiveId,
      question: 'Pick a colour',
      options: ['red', 'blue'],
      pollIntervalMs,
    });

    // Let the helper create its row + outbound before we poke the answer.
    await new Promise((r) => setTimeout(r, pollIntervalMs * 2));
    const open = pendingQuestions.openForDirective(db, directiveId);
    expect(open).toHaveLength(1);
    const qId = open[0]?.id;
    expect(qId).toBeDefined();

    const outboundRows = outbound.listPending(db, 10);
    expect(outboundRows).toHaveLength(1);
    expect(outboundRows[0]?.targetChannel).toBe('cli');
    expect(outboundRows[0]?.targetRef).toBe('session-test');
    expect(outboundRows[0]?.text).toContain('Pick a colour');
    expect(outboundRows[0]?.text).toContain('red');
    expect(outboundRows[0]?.text).toContain('blue');
    expect(outboundRows[0]?.metadata).toMatchObject({ kind: 'ask_user' });

    pendingQuestions.answer(db, qId as string, 'blue', new Date().toISOString());

    const result = await pending;
    expect(result.answer).toBe('blue');
    expect(result.timedOut).toBe(false);
    expect(result.aborted).toBe(false);
    expect(result.rehydrated).toBe(false);
    expect(result.questionId).toBe(qId);

    db.close();
  });

  it('rehydrates a previously-answered question without re-asking', async () => {
    const db = freshDb();
    const directiveId = seedDirective(db);

    // Pre-seed an answered question row.
    const qId = newId();
    const now = new Date().toISOString();
    pendingQuestions.create(db, {
      id: qId,
      directiveId,
      question: 'Pick a colour',
      channel: 'cli',
      channelRef: 'session-test',
      createdAt: now,
      answeredAt: now,
      answer: 'green',
    });

    const beforeOutbound = outbound.listPending(db, 10).length;
    const res = await askUser({
      db,
      directiveId,
      question: 'Pick a colour',
      pollIntervalMs: 10,
    });
    expect(res.rehydrated).toBe(true);
    expect(res.answer).toBe('green');
    // No new outbound was enqueued.
    expect(outbound.listPending(db, 10).length).toBe(beforeOutbound);

    db.close();
  });

  it('resumes polling on an existing open question (brain restart path)', async () => {
    const db = freshDb();
    const directiveId = seedDirective(db);

    const qId = newId();
    pendingQuestions.create(db, {
      id: qId,
      directiveId,
      question: 'Continue?',
      channel: 'cli',
      channelRef: 'session-test',
      createdAt: new Date().toISOString(),
    });

    const pending = askUser({
      db,
      directiveId,
      question: 'Continue?',
      pollIntervalMs: 10,
    });

    // No new outbound should be enqueued (row already open).
    await new Promise((r) => setTimeout(r, 30));
    expect(outbound.listPending(db, 10)).toHaveLength(0);

    pendingQuestions.answer(db, qId, 'yes', new Date().toISOString());
    const res = await pending;
    expect(res.rehydrated).toBe(true);
    expect(res.answer).toBe('yes');
    expect(res.questionId).toBe(qId);
    db.close();
  });

  it('returns timedOut when the deadline passes without an answer', async () => {
    const db = freshDb();
    const directiveId = seedDirective(db);
    const deadline = new Date(Date.now() + 50).toISOString();

    const res = await askUser({
      db,
      directiveId,
      question: 'Quick?',
      deadlineAt: deadline,
      pollIntervalMs: 10,
    });
    expect(res.timedOut).toBe(true);
    expect(res.aborted).toBe(false);
    expect(res.answer).toBeUndefined();
    db.close();
  });

  describe('U038 — auto-answer in-flight grace window', () => {
    it("keeps polling past the deadline when the auto-answer claim sentinel ('[in flight]') is present", async () => {
      // Repro of the 2026-05-23 pythonetl race: deadline elapses while
      // the Tier 8 auto-answer dispatcher has claimed the row and is
      // mid-LLM-call. Pre-fix, askUser returned `timedOut: true` the
      // instant `Date.now() >= deadline` and the brain flipped the
      // directive to `blocked` 13 s before the auto-answer finalized.
      const db = freshDb();
      const directiveId = seedDirective(db);

      const qId = newId();
      const createdAt = new Date().toISOString();
      // Deadline 30 ms out — short enough the poll loop hits it quickly.
      const deadlineAt = new Date(Date.now() + 30).toISOString();
      pendingQuestions.create(db, {
        id: qId,
        directiveId,
        question: 'Will be auto-answered',
        channel: 'cli',
        channelRef: 'session-test',
        createdAt,
        deadlineAt,
      });

      // Simulate the auto-answer dispatcher claim BEFORE the poll loop
      // starts so the first peek at deadline sees the sentinel.
      const claimedAt = new Date(Date.now() + 5).toISOString();
      const won = pendingQuestions.claimForAutoAnswer(db, qId, claimedAt);
      expect(won).toBe(true);

      const pending = askUser({
        db,
        directiveId,
        question: 'Will be auto-answered',
        deadlineAt,
        pollIntervalMs: 5,
        // Generous grace window — the test resolves it by writing the
        // finalize within ~50 ms.
        gracePeriodMs: 500,
      });

      // Wait until well past the nominal deadline, then finalize.
      await new Promise((r) => setTimeout(r, 80));
      // Sanity: the row still carries the sentinel until we finalize.
      const mid = pendingQuestions.getById(db, qId);
      expect(mid?.answer).toBe('[in flight]');

      pendingQuestions.finalizeAutoAnswer(db, qId, 'skip', new Date().toISOString(), 'agent');

      const res = await pending;
      expect(res.timedOut).toBe(false);
      expect(res.aborted).toBe(false);
      expect(res.answer).toBe('skip');
      expect(res.questionId).toBe(qId);

      db.close();
    });

    it('still times out if the auto-answer never finalizes within the grace window', async () => {
      const db = freshDb();
      const directiveId = seedDirective(db);

      const qId = newId();
      const createdAt = new Date().toISOString();
      const deadlineAt = new Date(Date.now() + 30).toISOString();
      pendingQuestions.create(db, {
        id: qId,
        directiveId,
        question: 'Will hang forever',
        channel: 'cli',
        channelRef: 'session-test',
        createdAt,
        deadlineAt,
      });
      // Claim but never finalize.
      pendingQuestions.claimForAutoAnswer(db, qId, new Date(Date.now() + 5).toISOString());

      const t0 = Date.now();
      const res = await askUser({
        db,
        directiveId,
        question: 'Will hang forever',
        deadlineAt,
        pollIntervalMs: 5,
        // Short grace window — we expect timeout after ~80 ms total.
        gracePeriodMs: 50,
      });
      const elapsed = Date.now() - t0;

      expect(res.timedOut).toBe(true);
      expect(res.answer).toBeUndefined();
      // Grace window honored — must have run past the nominal 30 ms
      // deadline by at least the grace period before giving up.
      expect(elapsed).toBeGreaterThanOrEqual(60);

      db.close();
    });

    it('never surfaces the [in flight] sentinel as the answer', async () => {
      // Defense-in-depth: even before the deadline elapses, a poll tick
      // that happens to land between claim and finalize must NOT return
      // the placeholder as the real answer.
      const db = freshDb();
      const directiveId = seedDirective(db);

      const qId = newId();
      const createdAt = new Date().toISOString();
      // Plenty of headroom — no deadline pressure in this scenario.
      const deadlineAt = new Date(Date.now() + 60_000).toISOString();
      pendingQuestions.create(db, {
        id: qId,
        directiveId,
        question: 'Mid-claim peek',
        channel: 'cli',
        channelRef: 'session-test',
        createdAt,
        deadlineAt,
      });
      pendingQuestions.claimForAutoAnswer(db, qId, new Date().toISOString());

      const pending = askUser({
        db,
        directiveId,
        question: 'Mid-claim peek',
        deadlineAt,
        pollIntervalMs: 5,
      });

      // Wait several poll ticks so the loop has definitely seen the
      // sentinel-bearing row at least once.
      await new Promise((r) => setTimeout(r, 40));

      // Finalize with the real answer.
      pendingQuestions.finalizeAutoAnswer(db, qId, 'continue', new Date().toISOString(), 'agent');

      const res = await pending;
      expect(res.answer).toBe('continue');
      expect(res.answer).not.toBe('[in flight]');
      db.close();
    });
  });

  it('honours an AbortSignal', async () => {
    const db = freshDb();
    const directiveId = seedDirective(db);
    const ac = new AbortController();

    const pending = askUser({
      db,
      directiveId,
      question: 'Will be aborted',
      pollIntervalMs: 5,
      signal: ac.signal,
    });
    setTimeout(() => ac.abort(), 20);
    const res = await pending;
    expect(res.aborted).toBe(true);
    expect(res.timedOut).toBe(false);
    expect(res.answer).toBeUndefined();
    db.close();
  });

  it('uses a caller-supplied renderOutbound callback', async () => {
    const db = freshDb();
    const directiveId = seedDirective(db);
    const pending = askUser({
      db,
      directiveId,
      question: 'custom?',
      pollIntervalMs: 5,
      renderOutbound: (ctx) => `<q id=${ctx.questionId}>custom text</q>`,
    });
    await new Promise((r) => setTimeout(r, 20));
    const rows = outbound.listPending(db, 10);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.text).toContain('custom text');
    // Drain the helper.
    const open = pendingQuestions.openForDirective(db, directiveId);
    pendingQuestions.answer(db, open[0]?.id as string, 'ok', new Date().toISOString());
    await pending;
    db.close();
  });

  it('routes outbound to the directive origin (e.g. discord)', async () => {
    const db = freshDb();
    const directiveId = seedDirective(db, { source: 'discord', channelRef: '123#thread-abc' });
    const pending = askUser({
      db,
      directiveId,
      question: 'Discord question',
      pollIntervalMs: 5,
    });
    await new Promise((r) => setTimeout(r, 20));
    const rows = outbound.listPending(db, 10);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.targetChannel).toBe('discord');
    expect(rows[0]?.targetRef).toBe('123#thread-abc');

    const open = pendingQuestions.openForDirective(db, directiveId);
    pendingQuestions.answer(db, open[0]?.id as string, 'ok', new Date().toISOString());
    await pending;
    db.close();
  });

  describe('deadline_at stamping (Tier 8 / ADR 0030 / ADR 0036)', () => {
    it('falls back to DEFAULT_ASK_USER_DEADLINE_MS when no override is configured', async () => {
      // ADR 0036 retired the config.json deadline override. With no
      // projectBudgets passed (the unified budget path), the deadline is the
      // baked-in default.
      const db = freshDb();
      const directiveId = seedDirective(db);
      try {
        const fixedNow = Date.parse('2026-05-08T12:00:00.000Z');
        const expectedDeadline = new Date(fixedNow + DEFAULT_ASK_USER_DEADLINE_MS).toISOString();

        const pending = askUser({
          db,
          directiveId,
          question: 'No override?',
          pollIntervalMs: 5,
          now: () => fixedNow,
        });
        await new Promise((r) => setTimeout(r, 20));

        const open = pendingQuestions.openForDirective(db, directiveId);
        expect(open[0]?.deadlineAt).toBe(expectedDeadline);

        pendingQuestions.answer(db, open[0]?.id as string, 'go', new Date().toISOString());
        await pending;
      } finally {
        db.close();
      }
    });

    it('caller-provided deadlineAt wins over the default', async () => {
      const db = freshDb();
      const directiveId = seedDirective(db);
      try {
        const explicitDeadline = '2026-12-31T23:59:59.000Z';

        const pending = askUser({
          db,
          directiveId,
          question: 'Explicit deadline',
          pollIntervalMs: 5,
          deadlineAt: explicitDeadline,
        });
        await new Promise((r) => setTimeout(r, 20));

        const open = pendingQuestions.openForDirective(db, directiveId);
        expect(open[0]?.deadlineAt).toBe(explicitDeadline);

        pendingQuestions.answer(db, open[0]?.id as string, 'go', new Date().toISOString());
        await pending;
      } finally {
        db.close();
      }
    });
  });
});

describe('escalateBlocked', () => {
  it('formats the outbound as a structured "I am stuck" message', async () => {
    const db = freshDb();
    const directiveId = seedDirective(db);

    const pending = escalateBlocked({
      db,
      directiveId,
      reason: 'budget exhausted',
      attempted: ['retry x3', 'fallback provider'],
      suggestions: ['increase max_usd', 'narrow scope'],
      pollIntervalMs: 10,
    });

    await new Promise((r) => setTimeout(r, 30));
    const rows = outbound.listPending(db, 10);
    expect(rows).toHaveLength(1);
    const text = rows[0]?.text ?? '';
    expect(text).toContain("I'm stuck");
    expect(text).toContain('budget exhausted');
    expect(text).toContain('retry x3');
    expect(text).toContain('increase max_usd');

    const open = pendingQuestions.openForDirective(db, directiveId);
    pendingQuestions.answer(db, open[0]?.id as string, 'narrow scope', new Date().toISOString());
    const res = await pending;
    expect(res.answer).toBe('narrow scope');
    db.close();
  });
});

describe('defaultAskUserOutbound formatting', () => {
  it('renders without options when none are provided', () => {
    const text = defaultAskUserOutbound({
      questionId: 'Q1',
      directiveId: 'D1',
      question: 'Proceed?',
    });
    expect(text).toContain('(question Q1)');
    expect(text).toContain('Q: Proceed?');
    expect(text).not.toContain('Options:');
    expect(text).toContain('factory answer Q1');
  });

  it('renders options as a numbered list when provided', () => {
    const text = defaultAskUserOutbound({
      questionId: 'Q2',
      directiveId: 'D1',
      question: 'Which?',
      options: ['a', 'b'],
    });
    expect(text).toMatch(/Options:\n  1\) a\n  2\) b/);
  });
});

describe('defaultEscalateOutbound formatting', () => {
  it('includes reason, attempted, and suggestions', () => {
    const text = defaultEscalateOutbound({
      questionId: 'E1',
      directiveId: 'D1',
      question: 'ignored',
      reason: 'cycles',
      attempted: ['one', 'two'],
      suggestions: ['three'],
    });
    expect(text).toContain('(escalation E1)');
    expect(text).toContain('Reason: cycles');
    expect(text).toContain('- one');
    expect(text).toContain('- three');
  });
});

describe('openQuestionsForDirective', () => {
  it('lists open questions for a directive', () => {
    const db = freshDb();
    const directiveId = seedDirective(db);
    pendingQuestions.create(db, {
      id: newId(),
      directiveId,
      question: 'Q1?',
      channel: 'cli',
      channelRef: 'session',
      createdAt: new Date().toISOString(),
    });
    const open = openQuestionsForDirective(db, directiveId);
    expect(open).toHaveLength(1);
    db.close();
  });
});
