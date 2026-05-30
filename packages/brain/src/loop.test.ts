/**
 * Unit tests for the small SSE-emit helpers exported from `loop.ts`. The
 * surrounding `runInline` orchestrator is exercised end-to-end by the
 * integration tests under `packages/daemon` and the agent-phase eval
 * runners — this file just covers the pure-function helpers in
 * isolation so the chat-path emission shape is pinned even when the
 * upstream provider stack is mocked out elsewhere.
 *
 * Tier 14 architect-critic integration tests are in the second describe block
 * below. They mock all module-level dependencies of `runInline` so the
 * architect→critic→planner path can be exercised without real providers.
 */

import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { WikiCritique } from '@factory5/core';
import { newId } from '@factory5/core';
import type { DirectiveStreamEvent } from '@factory5/ipc';
import { initLogger } from '@factory5/logger';
import {
  directives as directivesQ,
  openDatabase,
  runMigrations,
  type Database,
} from '@factory5/state';
import { isToolUsingAgent } from '@factory5/worker';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildGraphMigrationTask, emitLogLine } from './loop.js';

describe('buildGraphMigrationTask', () => {
  it('uses a tool-using agent so the worker actually writes + commits the seed', () => {
    const task = buildGraphMigrationTask(newId());
    // The migration is worthless unless the worker routes it through runTooling
    // (worktree + commit). A read-only agent (e.g. architect) routes to
    // runReadOnly and silently seeds nothing — this pins the cross-package
    // contract with @factory5/worker's isToolUsingAgent.
    expect(isToolUsingAgent(task.agent)).toBe(true);
  });

  it('declares the schema + templates as expected outputs and carries the migration title', () => {
    const task = buildGraphMigrationTask(newId());
    expect(task.title).toContain('Migrate to knowledge graph');
    expect(task.expectedOutputs.files).toContain('docs/knowledge/_schema.md');
    expect(task.dependsOn).toEqual([]);
  });
});

describe('emitLogLine', () => {
  it('is silent when no emitter is wired', () => {
    expect(() =>
      emitLogLine(undefined, '01HZZZZZZZZZZZZZZZZZZZZZZA', 'info', 'brain.chat', 'hello'),
    ).not.toThrow();
  });

  it('forwards a well-formed log.line event to the emitter', () => {
    const events: DirectiveStreamEvent[] = [];
    const emit = vi.fn((event: DirectiveStreamEvent) => events.push(event));

    emitLogLine(emit, '01HZZZZZZZZZZZZZZZZZZZZZZA', 'info', 'brain.chat', 'hello world');

    expect(emit).toHaveBeenCalledTimes(1);
    expect(events).toHaveLength(1);
    const event = events[0]!;
    expect(event.type).toBe('log.line');
    if (event.type !== 'log.line') return; // narrows for the expects below
    expect(event.directiveId).toBe('01HZZZZZZZZZZZZZZZZZZZZZZA');
    expect(event.level).toBe('info');
    expect(event.component).toBe('brain.chat');
    expect(event.msg).toBe('hello world');
    expect(event.attrs).toBeUndefined();
    // ts must parse as a real ISO-with-offset instant.
    expect(new Date(event.ts).toISOString()).toBe(event.ts);
  });

  it('passes through an attrs payload when supplied', () => {
    const events: DirectiveStreamEvent[] = [];
    const emit = (event: DirectiveStreamEvent): void => {
      events.push(event);
    };

    emitLogLine(emit, '01HZZZZZZZZZZZZZZZZZZZZZZB', 'warn', 'brain.triage', 'low confidence', {
      intent: 'chat',
      confidence: 0.42,
    });

    expect(events).toHaveLength(1);
    const event = events[0]!;
    expect(event.type).toBe('log.line');
    if (event.type !== 'log.line') return;
    expect(event.attrs).toEqual({ intent: 'chat', confidence: 0.42 });
  });

  it('omits the attrs field entirely when it is undefined (not just absent-key)', () => {
    let captured: DirectiveStreamEvent | undefined;
    const emit = (event: DirectiveStreamEvent): void => {
      captured = event;
    };

    emitLogLine(emit, '01HZZZZZZZZZZZZZZZZZZZZZZC', 'debug', 'brain.test', 'no attrs');

    expect(captured).toBeDefined();
    if (captured === undefined || captured.type !== 'log.line') return;
    expect(Object.prototype.hasOwnProperty.call(captured, 'attrs')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tier 14 architect-critic integration (loop.ts wiring)
// ---------------------------------------------------------------------------
// These tests exercise the architect block of runInline after Task 8 wiring:
// runArchitectWithCritique replaces the bare runArchitect call, and the
// WikiReadinessAbortError path flips the directive to 'blocked'.
//
// Strategy: mock all heavy module-level dependencies so no real LLM calls,
// no real file I/O beyond a minimal temp project dir.
// ---------------------------------------------------------------------------

vi.mock('./architect-loop.js', () => ({
  runArchitectWithCritique: vi.fn(),
  WikiReadinessAbortError: class WikiReadinessAbortError extends Error {
    constructor(public readonly lastCritique: WikiCritique) {
      super(`wiki-readiness aborted by operator: ${lastCritique.summary}`);
      this.name = 'WikiReadinessAbortError';
    }
  },
  CRITIC_MARKER: '[CRITIC]',
}));

vi.mock('./architect.js', () => ({
  runArchitect: vi.fn(),
}));

vi.mock('./critic.js', () => ({
  runWikiCritic: vi.fn(),
}));

vi.mock('./planner.js', () => ({
  runPlanner: vi.fn(),
}));

vi.mock('./pool.js', () => ({
  runPlanPool: vi.fn(),
}));

vi.mock('@factory5/assessor', () => ({
  assess: vi.fn(),
}));

vi.mock('./triage.js', () => ({
  triageDirective: vi.fn(),
}));

vi.mock('./provider-config.js', () => ({
  buildRegistryFromDisk: vi.fn(),
}));

vi.mock('./config.js', () => ({
  loadConfig: vi.fn().mockResolvedValue(undefined),
}));

describe('serve loop — Tier 14 architect-critic integration', () => {
  let db: Database;
  let projectDir: string;
  let directiveId: string;

  beforeAll(() => {
    initLogger({ processName: 'loop-tier14-test', noFile: true, noConsole: true });
  });

  beforeEach(async () => {
    db = openDatabase(':memory:');
    runMigrations(db);

    // Minimal project dir with CLAUDE.md so readWiki/appendBuildLog don't
    // blow up on missing dirs. The mocks intercept the LLM-touching paths.
    projectDir = mkdtempSync(join(tmpdir(), 'factory5-loop-tier14-'));
    writeFileSync(join(projectDir, 'CLAUDE.md'), '# Test\n');
    const factoryDir = join(projectDir, '.factory');
    mkdirSync(factoryDir, { recursive: true });

    directiveId = newId();
    directivesQ.insert(db, {
      id: directiveId,
      source: 'cli',
      principal: 'tester',
      channelRef: 'test-ref',
      intent: 'build',
      payload: { projectPath: projectDir },
      autonomy: 'autonomous',
      createdAt: new Date().toISOString(),
      status: 'pending',
    });

    // Reset all mocks before each test so call counts are fresh.
    vi.resetAllMocks();

    // Wire the mocked modules. Import lazily via dynamic import so the
    // vi.mock hoisting has already replaced the modules.
    const architectLoop = await import('./architect-loop.js');
    const plannerMod = await import('./planner.js');
    const poolMod = await import('./pool.js');
    const assessorMod = await import('@factory5/assessor');
    const triageMod = await import('./triage.js');
    const providerMod = await import('./provider-config.js');

    // Default: assessor passes, pool returns empty tasks, planner gives a plan.
    (assessorMod.assess as ReturnType<typeof vi.fn>).mockResolvedValue({
      gateResults: { build: true, integration: true, verify: true },
      testsPassed: 0,
      testsFailed: 0,
      testFramework: 'auto',
      runtime: 'node',
    });
    (poolMod.runPlanPool as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (plannerMod.runPlanner as ReturnType<typeof vi.fn>).mockResolvedValue({
      plan: {
        id: newId(),
        directiveId,
        projectPath: projectDir,
        tasks: [],
        createdAt: new Date().toISOString(),
        status: 'draft',
      },
    });
    (triageMod.triageDirective as ReturnType<typeof vi.fn>).mockResolvedValue({
      intent: 'build',
      confidence: 0.99,
    });
    (providerMod.buildRegistryFromDisk as ReturnType<typeof vi.fn>).mockResolvedValue({
      resolve: vi.fn(),
    });

    // Default: happy-path architect loop — passes on attempt 1.
    const passingCritique: WikiCritique = {
      passes: true,
      severity: 'pass',
      findings: [],
      summary: 'ok',
    };
    const archResult = {
      projectPath: projectDir,
      pages: [
        {
          slug: 'overview.md',
          path: join(projectDir, 'docs/knowledge/overview.md'),
          content: '# x',
        },
      ],
      rawResponse: '',
    };
    (architectLoop.runArchitectWithCritique as ReturnType<typeof vi.fn>).mockResolvedValue({
      architectResult: archResult,
      critique: passingCritique,
      attempts: 1,
      exhausted: false,
    });
  });

  afterEach(async () => {
    try {
      db.close();
    } catch {
      /* ignore */
    }
    try {
      rmSync(projectDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  it('happy path: critic passes attempt 1 → planner runs, directive completes', async () => {
    const { runBrain } = await import('./loop.js');
    const architectLoop = await import('./architect-loop.js');
    const plannerMod = await import('./planner.js');

    const handle = await runBrain({ mode: 'inline', directiveId, db });
    await handle.done;

    expect(architectLoop.runArchitectWithCritique).toHaveBeenCalledTimes(1);
    expect(plannerMod.runPlanner).toHaveBeenCalledTimes(1);
  });

  it('retry path: critic fails attempt 1, passes attempt 2 → planner runs', async () => {
    const { runBrain } = await import('./loop.js');
    const architectLoop = await import('./architect-loop.js');
    const plannerMod = await import('./planner.js');

    const archResult = {
      projectPath: projectDir,
      pages: [
        {
          slug: 'overview.md',
          path: join(projectDir, 'docs/knowledge/overview.md'),
          content: '# x',
        },
      ],
      rawResponse: '',
    };
    // The wrapper itself handles the retry internally — from loop.ts perspective
    // it just calls runArchitectWithCritique once and gets back attempts: 2.
    (architectLoop.runArchitectWithCritique as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      architectResult: archResult,
      critique: { passes: true, severity: 'pass', findings: [], summary: 'ok (attempt 2)' },
      attempts: 2,
      exhausted: false,
    });

    const handle = await runBrain({ mode: 'inline', directiveId, db });
    await handle.done;

    expect(architectLoop.runArchitectWithCritique).toHaveBeenCalledTimes(1);
    expect(plannerMod.runPlanner).toHaveBeenCalledTimes(1);
  });

  it('exhaustion-continue: wrapper exhausted but continues → planner runs', async () => {
    const { runBrain } = await import('./loop.js');
    const architectLoop = await import('./architect-loop.js');
    const plannerMod = await import('./planner.js');

    const archResult = {
      projectPath: projectDir,
      pages: [
        {
          slug: 'overview.md',
          path: join(projectDir, 'docs/knowledge/overview.md'),
          content: '# x',
        },
      ],
      rawResponse: '',
    };
    const lastCritique: WikiCritique = {
      passes: false,
      severity: 'major',
      findings: [{ aspect: 'modules', gap: 'g', suggestion: 's' }],
      summary: 'wiki not ready',
    };
    // exhausted: true means operator chose 'continue' — loop.ts should proceed to planner.
    (architectLoop.runArchitectWithCritique as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      architectResult: archResult,
      critique: lastCritique,
      attempts: 3,
      exhausted: true,
    });

    const handle = await runBrain({ mode: 'inline', directiveId, db });
    await handle.done;

    expect(architectLoop.runArchitectWithCritique).toHaveBeenCalledTimes(1);
    // Planner must still run — exhausted-continue is not a block.
    expect(plannerMod.runPlanner).toHaveBeenCalledTimes(1);
  });

  it('exhaustion-abort: WikiReadinessAbortError → directive status becomes blocked', async () => {
    const { runBrain } = await import('./loop.js');
    const architectLoop = await import('./architect-loop.js');
    const plannerMod = await import('./planner.js');

    const lastCritique: WikiCritique = {
      passes: false,
      severity: 'blocking',
      findings: [{ aspect: 'overview', gap: 'missing', suggestion: 'add an overview page' }],
      summary: 'wiki not ready: no overview',
    };

    // Throw the abort error — simulates operator choosing 'abort'.
    const { WikiReadinessAbortError } = architectLoop as unknown as {
      WikiReadinessAbortError: new (c: WikiCritique) => Error & { lastCritique: WikiCritique };
    };
    (architectLoop.runArchitectWithCritique as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new WikiReadinessAbortError(lastCritique),
    );

    const handle = await runBrain({ mode: 'inline', directiveId, db });
    const result = await handle.done;

    // Planner must NOT run.
    expect(plannerMod.runPlanner).not.toHaveBeenCalled();

    // Directive must be blocked.
    expect(result).toBeDefined();
    if (result !== undefined && typeof result === 'object' && 'terminalStatus' in result) {
      expect((result as { terminalStatus: string }).terminalStatus).toBe('blocked');
    }
    const updated = directivesQ.getById(db, directiveId);
    expect(updated?.status).toBe('blocked');
  });
});
