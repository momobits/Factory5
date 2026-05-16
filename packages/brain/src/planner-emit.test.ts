/**
 * Regression coverage for ADR 0031 — the planner's parse-failure paths must
 * surface a `log.line` event with `level: 'error'` and `attrs.detail` set to
 * the first 500 chars of the offending LLM response, so directive-detail's
 * activity panel renders the actual cause of a stop instead of staying silent.
 *
 * Two sites:
 *   1. `extractJsonObject` returns undefined  — planner emits and throws.
 *   2. `plannerJsonSchema.parse` throws ZodError — planner emits with the
 *      Zod issues (truncated to 3) and re-throws.
 *
 * Tests use a real `mkdtemp` project (CLAUDE.md + an empty wiki dir is enough)
 * and a `StubProvider` returning malformed responses. No DB; the planner skips
 * `recordUsage` when `opts.db` is undefined.
 */

import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { newId, type ModelCategory } from '@factory5/core';
import type { DirectiveStreamEvent } from '@factory5/ipc';
import { initLogger } from '@factory5/logger';
import { ProviderRegistry, StubProvider } from '@factory5/providers';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { runPlanner } from './planner.js';

beforeAll(() => {
  initLogger({ processName: 'planner-emit-test', noFile: true, noConsole: true });
});

interface Fixture {
  projectPath: string;
  events: DirectiveStreamEvent[];
  emit: (event: DirectiveStreamEvent) => void;
}

let workRoot: string;

beforeEach(() => {
  workRoot = mkdtempSync(join(tmpdir(), 'factory5-planner-emit-'));
});

afterEach(() => {
  try {
    rmSync(workRoot, { recursive: true, force: true });
  } catch {
    // Windows tmp cleanup will handle stragglers.
  }
});

function makeFixture(): Fixture {
  const projectPath = join(workRoot, 'project');
  mkdirSync(projectPath, { recursive: true });
  mkdirSync(join(projectPath, 'docs', 'knowledge'), { recursive: true });
  writeFileSync(
    join(projectPath, 'CLAUDE.md'),
    '# Project\n\nMinimum spec for the planner test.\n',
  );
  const events: DirectiveStreamEvent[] = [];
  const emit = (event: DirectiveStreamEvent): void => {
    events.push(event);
  };
  return { projectPath, events, emit };
}

function makeRegistry(stubText: string): ProviderRegistry {
  // Both fields point at the same text — the StubProvider routes to triageText
  // when the system prompt contains "triage", and the planner prompt happens
  // to mention it in a "do not use these roles" sentence. For these tests we
  // want the stub to return our fixture text regardless of which branch fires.
  const stub = new StubProvider({ id: 'stub', defaultText: stubText, triageText: stubText });
  const chains: Record<ModelCategory, { provider: string; model: string }[]> = {
    quick: [{ provider: 'stub', model: 'stub-model' }],
    planning: [{ provider: 'stub', model: 'stub-model' }],
    reasoning: [{ provider: 'stub', model: 'stub-model' }],
    deep: [{ provider: 'stub', model: 'stub-model' }],
    documentation: [{ provider: 'stub', model: 'stub-model' }],
  };
  return new ProviderRegistry({
    providers: { stub },
    fallbackChains: chains,
  });
}

describe('planner emit sites (ADR 0031)', () => {
  it('fires a `log.line` event on entry naming the resolved model', async () => {
    const fix = makeFixture();
    // Valid plan response so the run completes; we want to see the entry event.
    const validPlan = JSON.stringify({
      tasks: [
        {
          title: 'scaffold',
          agent: 'scaffolder',
          category: 'planning',
          inputs: { files: [], context: 'initial' },
          expectedOutputs: { files: ['package.json'], signals: [] },
          dependsOn: [],
        },
      ],
    });
    const registry = makeRegistry(validPlan);

    await runPlanner({
      registry,
      projectPath: fix.projectPath,
      directiveId: newId(),
      emit: fix.emit,
    });

    const entry = fix.events.find(
      (e) => e.type === 'log.line' && e.component === 'brain.planner' && e.msg.includes('calling'),
    );
    expect(entry).toBeDefined();
    if (entry?.type !== 'log.line') return;
    expect(entry.level).toBe('info');
    expect(entry.msg).toMatch(/^planner: calling /);
  });

  it('fires a `log.line` event on plan-written naming the task count', async () => {
    const fix = makeFixture();
    const validPlan = JSON.stringify({
      tasks: [
        {
          title: 'a',
          agent: 'scaffolder',
          category: 'planning',
          inputs: { files: [], context: '' },
          expectedOutputs: { files: ['a.ts'], signals: [] },
          dependsOn: [],
        },
        {
          title: 'b',
          agent: 'builder',
          category: 'deep',
          inputs: { files: [], context: '' },
          expectedOutputs: { files: ['b.ts'], signals: [] },
          dependsOn: [0],
        },
      ],
    });
    const registry = makeRegistry(validPlan);

    await runPlanner({
      registry,
      projectPath: fix.projectPath,
      directiveId: newId(),
      emit: fix.emit,
    });

    const written = fix.events.find(
      (e) => e.type === 'log.line' && e.component === 'brain.planner' && e.msg.includes('queued'),
    );
    expect(written).toBeDefined();
    if (written?.type !== 'log.line') return;
    expect(written.level).toBe('info');
    expect(written.msg).toBe('planner: 2 tasks queued');
  });

  it('emits an error `log.line` with first 500 chars in attrs.detail when the LLM returns no JSON', async () => {
    const fix = makeFixture();
    const garbage = 'Here is some prose without a JSON object. '.repeat(20);
    const registry = makeRegistry(garbage);
    const directiveId = newId();

    await expect(
      runPlanner({
        registry,
        projectPath: fix.projectPath,
        directiveId,
        emit: fix.emit,
      }),
    ).rejects.toThrow(/planner: response contained no JSON object/);

    const err = fix.events.find(
      (e) => e.type === 'log.line' && e.component === 'brain.planner' && e.msg.includes('no JSON'),
    );
    expect(err).toBeDefined();
    if (err?.type !== 'log.line') return;
    expect(err.directiveId).toBe(directiveId);
    expect(err.level).toBe('error');
    expect(err.msg).toBe('planner: no JSON in response');
    expect(err.attrs).toBeDefined();
    const detail = (err.attrs as Record<string, unknown>)['detail'];
    expect(typeof detail).toBe('string');
    expect((detail as string).length).toBeLessThanOrEqual(500);
    expect((detail as string).startsWith('Here is some prose')).toBe(true);
  });

  it('emits an error `log.line` with zodIssues + detail when the schema parse fails (tasks missing)', async () => {
    const fix = makeFixture();
    // Valid JSON but no `tasks` field — the same shape Sonnet returned for the
    // automl directive 01KRQ1RPE5SM6Q8AYSRHHAPG39 that drove ADR 0031.
    const malformed = JSON.stringify({ plan: { description: 'tasks nested incorrectly' } });
    const registry = makeRegistry(malformed);
    const directiveId = newId();

    await expect(
      runPlanner({
        registry,
        projectPath: fix.projectPath,
        directiveId,
        emit: fix.emit,
      }),
    ).rejects.toThrow();

    const err = fix.events.find(
      (e) =>
        e.type === 'log.line' &&
        e.component === 'brain.planner' &&
        e.msg.includes('schema parse failed'),
    );
    expect(err).toBeDefined();
    if (err?.type !== 'log.line') return;
    expect(err.directiveId).toBe(directiveId);
    expect(err.level).toBe('error');
    expect(err.msg).toBe('planner: schema parse failed');
    const attrs = err.attrs as Record<string, unknown>;
    const zodIssues = attrs['zodIssues'] as Array<Record<string, unknown>>;
    expect(Array.isArray(zodIssues)).toBe(true);
    expect(zodIssues.length).toBeGreaterThan(0);
    expect(zodIssues.length).toBeLessThanOrEqual(3);
    // The path on the first issue should reference 'tasks' (the field the LLM
    // omitted) — this is the canonical regression locking down the automl
    // failure mode.
    expect(zodIssues[0]?.['path']).toEqual(['tasks']);
    const detail = attrs['detail'];
    expect(typeof detail).toBe('string');
    expect((detail as string).startsWith('{"plan":')).toBe(true);
  });
});
