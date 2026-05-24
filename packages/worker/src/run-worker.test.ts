import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { AgentRole, Task } from '@factory5/core';
import type {
  CategoryResolution,
  ModelProvider,
  ProviderRegistry,
  ProviderRequest,
  ProviderResponse,
  ProviderStreamChunk,
} from '@factory5/providers';

import { isToolUsingAgent, runWorker } from './run-worker.js';

describe('isToolUsingAgent', () => {
  it('returns true for scaffolder, builder, fixer', () => {
    expect(isToolUsingAgent('scaffolder')).toBe(true);
    expect(isToolUsingAgent('builder')).toBe(true);
    expect(isToolUsingAgent('fixer')).toBe(true);
  });

  it('returns false for read-only agents', () => {
    expect(isToolUsingAgent('triage')).toBe(false);
    expect(isToolUsingAgent('architect')).toBe(false);
    expect(isToolUsingAgent('planner')).toBe(false);
    expect(isToolUsingAgent('reviewer')).toBe(false);
    expect(isToolUsingAgent('investigator')).toBe(false);
    expect(isToolUsingAgent('verifier')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tier 15 / ADR 0034 — turnsUsed plumbing
// ---------------------------------------------------------------------------

const BASE_ULID = '01HXABCDEFGHJKMNPQRSTVWXY0';

function mkTask(overrides: Partial<Task> & { agent: AgentRole }): Task {
  return {
    id: BASE_ULID,
    planId: BASE_ULID.slice(0, -1) + 'P',
    title: 'test-task',
    agent: overrides.agent,
    category: 'planning',
    inputs: { files: [], context: '' },
    expectedOutputs: { files: [], signals: [] },
    dependsOn: [],
    status: 'pending',
    attempts: 0,
    ...overrides,
  };
}

interface FakeProviderOpts {
  /** Response text the read-only `call()` path returns. */
  responseText?: string;
  /** Optional numTurns to surface on the response (call) / terminal chunk (stream). */
  numTurns?: number;
  /** When set, `stream()` yields these chunks in order. */
  streamChunks?: ProviderStreamChunk[];
  /** When set, stream requests are captured here for assertion. */
  capturedStreamReqs?: ProviderRequest[];
}

function makeFakeRegistry(opts: FakeProviderOpts = {}): ProviderRegistry {
  const provider: ModelProvider = {
    id: 'fake',
    available: async () => true,
    call: async (_req: ProviderRequest): Promise<ProviderResponse> => {
      const response: ProviderResponse = {
        text: opts.responseText ?? '',
        usage: { inputTokens: 1, outputTokens: 1, costUsd: 0.001 },
        resolvedProvider: 'fake',
        resolvedModel: 'fake-model',
      };
      if (opts.numTurns !== undefined) response.numTurns = opts.numTurns;
      return response;
    },
    stream: async function* (req: ProviderRequest): AsyncIterable<ProviderStreamChunk> {
      if (opts.capturedStreamReqs !== undefined) opts.capturedStreamReqs.push(req);
      for (const chunk of opts.streamChunks ?? []) yield chunk;
    },
  };
  const resolution: CategoryResolution = {
    provider,
    model: 'fake-model',
    chainIndex: 0,
    category: 'planning',
  };
  return {
    resolve: async () => resolution,
  } as unknown as ProviderRegistry;
}

describe('runWorker — turnsUsed plumbing (Tier 15 / ADR 0034)', () => {
  let projectPath: string;

  beforeEach(async () => {
    projectPath = await mkdtemp(join(tmpdir(), 'factory5-runworker-t15-'));
  });

  afterEach(async () => {
    await rm(projectPath, { recursive: true, force: true }).catch(() => undefined);
  });

  it('threads provider numTurns into TaskResult.turnsUsed on the read-only path', async () => {
    const registry = makeFakeRegistry({
      responseText: 'ok',
      numTurns: 7,
    });
    const outcome = await runWorker({
      task: mkTask({ agent: 'planner' }),
      projectPath,
      registry,
      systemPrompt: 'system',
      userPrompt: 'user',
    });
    expect(outcome.result.exitCode).toBe(0);
    expect(outcome.result.turnsUsed).toBe(7);
    expect(outcome.usage?.response.numTurns).toBe(7);
  });

  it('omits turnsUsed on the read-only path when provider does not report numTurns', async () => {
    const registry = makeFakeRegistry({ responseText: 'ok' });
    const outcome = await runWorker({
      task: mkTask({ agent: 'planner' }),
      projectPath,
      registry,
      systemPrompt: 'system',
      userPrompt: 'user',
    });
    expect(outcome.result.exitCode).toBe(0);
    expect(outcome.result.turnsUsed).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// F4 / ADR 0034 §6 — poolRemainingTurns replaces task.maxTurns
// ---------------------------------------------------------------------------

describe('runWorker — poolRemainingTurns (F4 / ADR 0034 §6)', () => {
  let projectPath: string;

  beforeEach(async () => {
    projectPath = await mkdtemp(join(tmpdir(), 'factory5-runworker-f4-'));
  });

  afterEach(async () => {
    await rm(projectPath, { recursive: true, force: true }).catch(() => undefined);
  });

  it('passes poolRemainingTurns as maxTurns to the provider on the stream path', async () => {
    const capturedStreamReqs: ProviderRequest[] = [];
    const registry = makeFakeRegistry({
      streamChunks: [{ delta: 'done', usage: { inputTokens: 1, outputTokens: 1, costUsd: 0.001 } }],
      capturedStreamReqs,
    });
    await runWorker({
      task: mkTask({ agent: 'builder' }),
      projectPath,
      registry,
      systemPrompt: 'system',
      userPrompt: 'user',
      poolRemainingTurns: 142,
    });
    expect(capturedStreamReqs).toHaveLength(1);
    expect(capturedStreamReqs[0]?.maxTurns).toBe(142);
  });

  it('ignores task.maxTurns — does NOT pass it to the provider', async () => {
    const capturedStreamReqs: ProviderRequest[] = [];
    const registry = makeFakeRegistry({
      streamChunks: [{ delta: 'done', usage: { inputTokens: 1, outputTokens: 1, costUsd: 0.001 } }],
      capturedStreamReqs,
    });
    await runWorker({
      task: mkTask({ agent: 'builder', maxTurns: 60 }),
      projectPath,
      registry,
      systemPrompt: 'system',
      userPrompt: 'user',
    });
    expect(capturedStreamReqs).toHaveLength(1);
    expect(capturedStreamReqs[0]?.maxTurns).toBeUndefined();
  });

  it('omits maxTurns from provider request when poolRemainingTurns is undefined', async () => {
    const capturedStreamReqs: ProviderRequest[] = [];
    const registry = makeFakeRegistry({
      streamChunks: [{ delta: 'done', usage: { inputTokens: 1, outputTokens: 1, costUsd: 0.001 } }],
      capturedStreamReqs,
    });
    await runWorker({
      task: mkTask({ agent: 'builder' }),
      projectPath,
      registry,
      systemPrompt: 'system',
      userPrompt: 'user',
    });
    expect(capturedStreamReqs).toHaveLength(1);
    expect(capturedStreamReqs[0]?.maxTurns).toBeUndefined();
  });
});
