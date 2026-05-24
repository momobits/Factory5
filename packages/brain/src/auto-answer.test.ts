/**
 * Tier 8 auto-answer dispatcher tests (ADR 0030).
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { newId, type Directive, type PendingQuestion } from '@factory5/core';
import { initLogger } from '@factory5/logger';
import type { CategoryResolution, ProviderRegistry } from '@factory5/providers';
import {
  directives as directivesQ,
  modelUsage,
  openDatabase,
  pendingQuestions,
  runMigrations,
  type Database,
} from '@factory5/state';

import { autoAnswerOne, buildAutoAnswerPrompt, runAutoAnswerSweep } from './auto-answer.js';
import { CRITIC_MARKER } from './architect-loop.js';

beforeAll(() => {
  initLogger({ processName: 'auto-answer-test', noFile: true, noConsole: true });
});

interface CallRecord {
  systemPrompt: string;
  userPrompt: string;
}

interface ScriptedProviderOptions {
  /** Sequence of responses; `null` means "throw on this call". */
  script: Array<string | null>;
  /** Optional usage override (defaults to zero). */
  usage?: { inputTokens: number; outputTokens: number; costUsd: number };
}

class ScriptedProvider {
  readonly id = 'scripted';
  readonly calls: CallRecord[] = [];
  private readonly script: Array<string | null>;
  private readonly usage: { inputTokens: number; outputTokens: number; costUsd: number };

  constructor(opts: ScriptedProviderOptions) {
    this.script = [...opts.script];
    this.usage = opts.usage ?? { inputTokens: 10, outputTokens: 5, costUsd: 0.001 };
  }

  available(): Promise<boolean> {
    return Promise.resolve(true);
  }

  call(req: { systemPrompt: string; messages: Array<{ role: string; content: string }> }): Promise<{
    text: string;
    usage: { inputTokens: number; outputTokens: number; costUsd: number };
    resolvedProvider: string;
    resolvedModel: string;
  }> {
    const userPrompt = req.messages.find((m) => m.role === 'user')?.content ?? '';
    this.calls.push({ systemPrompt: req.systemPrompt, userPrompt });
    const next = this.script.shift();
    if (next === undefined) throw new Error('scripted provider: out of responses');
    if (next === null) throw new Error('scripted provider: simulated failure');
    return Promise.resolve({
      text: next,
      usage: this.usage,
      resolvedProvider: this.id,
      resolvedModel: 'scripted-model',
    });
  }

  async *stream(): AsyncIterable<{ delta: string }> {
    yield { delta: 'unused' };
  }
}

function registryFor(provider: ScriptedProvider): ProviderRegistry {
  return {
    resolve(): Promise<CategoryResolution> {
      return Promise.resolve({
        provider: provider as unknown as CategoryResolution['provider'],
        model: 'scripted-model',
      });
    },
  } as unknown as ProviderRegistry;
}

function freshDb(): Database {
  const db = openDatabase(':memory:');
  runMigrations(db);
  return db;
}

function seedDirective(db: Database, status: Directive['status'] = 'running'): Directive {
  const d: Directive = {
    id: newId(),
    source: 'cli',
    principal: 'tester',
    channelRef: 'sess-1',
    intent: 'build',
    payload: { text: 'hello' },
    autonomy: 'autonomous',
    createdAt: new Date().toISOString(),
    status,
  };
  directivesQ.insert(db, d);
  return d;
}

function seedQuestion(
  db: Database,
  directiveId: string,
  overrides: Partial<PendingQuestion> = {},
): PendingQuestion {
  const q: PendingQuestion = {
    id: newId(),
    directiveId,
    question: 'jwt or session?',
    channel: 'cli',
    channelRef: 'sess-1',
    createdAt: new Date('2026-05-08T11:00:00.000Z').toISOString(),
    deadlineAt: new Date('2026-05-08T11:01:00.000Z').toISOString(),
    ...overrides,
    directiveId,
  };
  pendingQuestions.create(db, q);
  return q;
}

describe('autoAnswerOne', () => {
  let db: Database;

  beforeEach(() => {
    db = freshDb();
  });

  afterEach(() => {
    db.close();
  });

  it("happy path: claim wins, LLM succeeds, writes 'agent' + spend", async () => {
    const d = seedDirective(db);
    const q = seedQuestion(db, d.id);
    const provider = new ScriptedProvider({ script: ['use jwt; it is what the spec implies'] });
    await autoAnswerOne(q, {
      db,
      registry: registryFor(provider),
      now: () => Date.parse('2026-05-08T11:05:00.000Z'),
      retryBackoffMs: 0,
    });

    const after = pendingQuestions.getById(db, q.id);
    expect(after?.answeredBy).toBe('agent');
    expect(after?.answer).toBe('use jwt; it is what the spec implies');
    expect(after?.answeredAt).toBe('2026-05-08T11:05:00.000Z');

    // Spend recorded against the parent directive.
    const usage = modelUsage.listForDirective(db, d.id);
    expect(usage).toHaveLength(1);
    expect(usage[0]?.category).toBe('quick');
    expect(usage[0]?.provider).toBe('scripted');
  });

  it('retries once on first-call failure, then succeeds', async () => {
    const d = seedDirective(db);
    const q = seedQuestion(db, d.id);
    const provider = new ScriptedProvider({ script: [null, 'on retry it works'] });
    await autoAnswerOne(q, {
      db,
      registry: registryFor(provider),
      now: () => Date.parse('2026-05-08T11:05:00.000Z'),
      retryBackoffMs: 0,
    });

    expect(provider.calls).toHaveLength(2);
    const after = pendingQuestions.getById(db, q.id);
    expect(after?.answeredBy).toBe('agent');
    expect(after?.answer).toBe('on retry it works');
  });

  it("writes 'agent-failed' synthetic when both attempts fail", async () => {
    const d = seedDirective(db);
    const q = seedQuestion(db, d.id);
    const provider = new ScriptedProvider({ script: [null, null] });
    await autoAnswerOne(q, {
      db,
      registry: registryFor(provider),
      now: () => Date.parse('2026-05-08T11:05:00.000Z'),
      retryBackoffMs: 0,
    });

    expect(provider.calls).toHaveLength(2);
    const after = pendingQuestions.getById(db, q.id);
    expect(after?.answeredBy).toBe('agent-failed');
    expect(after?.answer).toMatch(/^\[auto-answer failed:/);
    // No spend recorded on the failed path.
    const usage = modelUsage.listForDirective(db, d.id);
    expect(usage).toHaveLength(0);
  });

  it("writes 'agent-failed' on persistent empty responses", async () => {
    const d = seedDirective(db);
    const q = seedQuestion(db, d.id);
    const provider = new ScriptedProvider({ script: ['', '   '] });
    await autoAnswerOne(q, {
      db,
      registry: registryFor(provider),
      now: () => Date.parse('2026-05-08T11:05:00.000Z'),
      retryBackoffMs: 0,
    });

    const after = pendingQuestions.getById(db, q.id);
    expect(after?.answeredBy).toBe('agent-failed');
    expect(after?.answer).toMatch(/empty response/);
  });

  it('claim lost (concurrent reply): no LLM call, no overwrite of human answer', async () => {
    const d = seedDirective(db);
    const q = seedQuestion(db, d.id);
    // Human races and answers BEFORE the dispatcher runs.
    pendingQuestions.answer(db, q.id, 'human picked session', '2026-05-08T11:04:59.000Z');

    const provider = new ScriptedProvider({ script: ['this should never get written'] });
    await autoAnswerOne(q, {
      db,
      registry: registryFor(provider),
      now: () => Date.parse('2026-05-08T11:05:00.000Z'),
      retryBackoffMs: 0,
    });

    // Provider was never called.
    expect(provider.calls).toHaveLength(0);
    const after = pendingQuestions.getById(db, q.id);
    expect(after?.answeredBy).toBe('user');
    expect(after?.answer).toBe('human picked session');
  });
});

describe('runAutoAnswerSweep', () => {
  let db: Database;

  beforeEach(() => {
    db = freshDb();
  });

  afterEach(() => {
    db.close();
  });

  it('returns immediately when no rows are past deadline', async () => {
    const d = seedDirective(db);
    seedQuestion(db, d.id, {
      deadlineAt: new Date('2099-01-01T00:00:00.000Z').toISOString(),
    });
    const provider = new ScriptedProvider({ script: ['unused'] });
    await runAutoAnswerSweep({
      db,
      registry: registryFor(provider),
      now: () => Date.parse('2026-05-08T11:05:00.000Z'),
    });
    expect(provider.calls).toHaveLength(0);
  });

  it('skips questions on terminal directives even when past deadline', async () => {
    const d = seedDirective(db, 'complete');
    seedQuestion(db, d.id);
    const provider = new ScriptedProvider({ script: ['unused'] });
    await runAutoAnswerSweep({
      db,
      registry: registryFor(provider),
      now: () => Date.parse('2026-05-08T11:05:00.000Z'),
    });
    expect(provider.calls).toHaveLength(0);
  });

  it('processes multiple past-deadline questions in order', async () => {
    const d = seedDirective(db);
    const q1 = seedQuestion(db, d.id, {
      question: 'first?',
      deadlineAt: '2026-05-08T11:00:30.000Z',
    });
    const q2 = seedQuestion(db, d.id, {
      question: 'second?',
      deadlineAt: '2026-05-08T11:00:45.000Z',
    });
    const provider = new ScriptedProvider({ script: ['ans1', 'ans2'] });
    await runAutoAnswerSweep({
      db,
      registry: registryFor(provider),
      now: () => Date.parse('2026-05-08T11:05:00.000Z'),
    });
    const a1 = pendingQuestions.getById(db, q1.id);
    const a2 = pendingQuestions.getById(db, q2.id);
    expect(a1?.answeredBy).toBe('agent');
    expect(a2?.answeredBy).toBe('agent');
    expect(new Set(provider.calls.map((c) => c.userPrompt))).toEqual(
      new Set([provider.calls[0]?.userPrompt ?? '', provider.calls[1]?.userPrompt ?? '']),
    );
  });
});

describe('autoAnswerOne — Tier 14 / ADR 0030 amendment [CRITIC] deterministic policy', () => {
  let db: Database;

  beforeEach(() => {
    db = freshDb();
  });

  afterEach(() => {
    db.close();
  });

  // Provider intentionally throws — the deterministic policy must NOT dispatch
  // an LLM call for [CRITIC] questions. Tests will fail if the provider is invoked.
  const noProviderCall = (): ProviderRegistry =>
    ({
      resolve(): Promise<CategoryResolution> {
        throw new Error('LLM dispatch should be skipped for [CRITIC] questions');
      },
    }) as unknown as ProviderRegistry;

  it("answers 'continue' deterministically — no LLM call", async () => {
    const d = seedDirective(db);
    const q = seedQuestion(db, d.id, {
      question: `${CRITIC_MARKER} Wiki-readiness exhausted after 3 attempts.\n\nLast severity: major\nSummary: modules missing\nFindings:\n  - [modules] no relationships`,
      options: ['continue', 'abort', 'extend-3'],
    });
    await autoAnswerOne(q, {
      db,
      registry: noProviderCall(),
      now: () => Date.parse('2026-05-23T10:00:00.000Z'),
      retryBackoffMs: 0,
    });
    const after = pendingQuestions.getById(db, q.id);
    expect(after?.answer).toBe('continue');
    expect(after?.answeredBy).toBe('agent');
  });

  it('preserves the advisory contract for the second exhaustion on the same directive', async () => {
    const d = seedDirective(db);
    // Second [CRITIC] exhaustion should still answer 'continue' (stateless policy,
    // unlike [BUDGET] which counts prior bumps per-task).
    const q1 = seedQuestion(db, d.id, {
      question: `${CRITIC_MARKER} first exhaustion`,
      options: ['continue', 'abort', 'extend-3'],
    });
    const q2 = seedQuestion(db, d.id, {
      question: `${CRITIC_MARKER} second exhaustion`,
      options: ['continue', 'abort', 'extend-3'],
    });
    await autoAnswerOne(q1, { db, registry: noProviderCall(), now: () => 1, retryBackoffMs: 0 });
    await autoAnswerOne(q2, { db, registry: noProviderCall(), now: () => 2, retryBackoffMs: 0 });
    expect(pendingQuestions.getById(db, q1.id)?.answer).toBe('continue');
    expect(pendingQuestions.getById(db, q2.id)?.answer).toBe('continue');
  });
});

describe('buildAutoAnswerPrompt', () => {
  it('includes question, directive, and past Q&A in the user prompt', () => {
    const directive: Directive = {
      id: 'D1',
      source: 'cli',
      principal: 'me',
      channelRef: 's1',
      intent: 'build',
      payload: { text: 'build a CLI' },
      autonomy: 'autonomous',
      createdAt: '2026-05-08T11:00:00.000Z',
      status: 'running',
    };
    const q: PendingQuestion = {
      id: 'Q1',
      directiveId: 'D1',
      question: 'jwt or session?',
      options: ['jwt', 'session'],
      channel: 'cli',
      channelRef: 's1',
      createdAt: '2026-05-08T11:00:00.000Z',
    };
    const pastQA = [{ question: 'language?', answer: 'TypeScript' }];

    const { systemPrompt, userPrompt } = buildAutoAnswerPrompt(q, directive, pastQA);

    expect(systemPrompt).toMatch(/answering a question on behalf of an absent human/i);
    expect(userPrompt).toContain('jwt or session?');
    expect(userPrompt).toContain('Options:');
    expect(userPrompt).toContain('1) jwt');
    expect(userPrompt).toContain('2) session');
    expect(userPrompt).toContain('Directive intent: build');
    expect(userPrompt).toContain('Directive autonomy: autonomous');
    expect(userPrompt).toContain('Past Q&A in this directive');
    expect(userPrompt).toContain('Q1: language?');
    expect(userPrompt).toContain('A1: TypeScript');
  });

  it('omits the options block when no options are given', () => {
    const directive: Directive = {
      id: 'D1',
      source: 'cli',
      principal: 'me',
      channelRef: 's1',
      intent: 'chat',
      payload: {},
      autonomy: 'chat',
      createdAt: '2026-05-08T11:00:00.000Z',
      status: 'running',
    };
    const q: PendingQuestion = {
      id: 'Q1',
      directiveId: 'D1',
      question: 'open-ended?',
      channel: 'cli',
      channelRef: 's1',
      createdAt: '2026-05-08T11:00:00.000Z',
    };
    const { userPrompt } = buildAutoAnswerPrompt(q, directive, []);
    expect(userPrompt).not.toContain('Options:');
    expect(userPrompt).not.toContain('Past Q&A');
  });
});
