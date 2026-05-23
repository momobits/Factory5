/**
 * Tests for `runWikiCritic` — the brain stage that evaluates an architect's
 * wiki output and returns a structured `WikiCritique`.
 *
 * Uses in-memory fake helpers rather than the real provider stack so these
 * run without tokens and without live I/O.
 */

import { openDatabase, runMigrations, type Database } from '@factory5/state';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { runWikiCritic } from './critic.js';

// ---------------------------------------------------------------------------
// Logger init — suppresses noise in test output
// ---------------------------------------------------------------------------

import { initLogger } from '@factory5/logger';

beforeAll(() => {
  initLogger({ processName: 'critic-test', noFile: true, noConsole: true });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Passing critique JSON the fake LLM returns. */
const PASSING_JSON = JSON.stringify({
  passes: true,
  severity: 'pass',
  findings: [],
  summary: 'wiki satisfies the directive',
});

/** Failing critique JSON with one finding. */
const FAILING_JSON = JSON.stringify({
  passes: false,
  severity: 'major',
  findings: [{ aspect: 'modules', gap: 'no relationships', suggestion: 'add section' }],
  summary: 'modules missing',
});

interface FakeRegistryOpts {
  /** Text the fake provider returns as `response.text`. */
  response: string;
  /** If set, the resolved category is appended here on each `resolve()` call. */
  captureCategoryTo?: string[];
  /** If set, the full `ProviderRequest` is appended here on each `call()`. */
  captureTo?: unknown[];
  /** If set, `{ userPrompt }` is appended here on each `call()`. */
  capturePromptTo?: { userPrompt: string }[];
}

/**
 * Build a minimal fake `ProviderRegistry` whose single provider returns a
 * fixed response string. All shapes match the real `ProviderRegistry` /
 * `CategoryResolution` / `ProviderResponse` contracts.
 */
function makeFakeRegistry(opts: FakeRegistryOpts) {
  return {
    resolve: async (category: string) => {
      opts.captureCategoryTo?.push(category);
      return {
        provider: {
          id: 'fake',
          call: async (req: {
            systemPrompt: string;
            messages: { role: string; content: string }[];
          }) => {
            if (opts.captureTo !== undefined) opts.captureTo.push(req);
            if (opts.capturePromptTo !== undefined) {
              opts.capturePromptTo.push({
                userPrompt: req.messages.map((m) => m.content).join('\n'),
              });
            }
            return {
              text: opts.response,
              usage: { inputTokens: 10, outputTokens: 5, costUsd: 0.001 },
              resolvedProvider: 'fake',
              resolvedModel: 'fake-model',
            };
          },
          available: async () => true,
          stream: async function* () {
            yield { delta: '', usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 } };
          },
        },
        model: 'fake-model',
        chainIndex: 0,
        category,
      };
    },
  };
}

/** Open an in-memory SQLite DB with migrations applied. */
function freshDb(): Database {
  const db = openDatabase(':memory:');
  runMigrations(db);
  return db;
}

/** Seed a directive row so FK constraints pass. */
function seedDirective(db: Database, id: string): void {
  const existing = (db.prepare('SELECT id FROM directives WHERE id = ?').get(id) ?? undefined) as
    | { id: string }
    | undefined;
  if (existing !== undefined) return;
  db.prepare(
    `INSERT INTO directives
         (id, source, principal, channel_ref, intent, payload_json, autonomy, created_at, status)
       VALUES (?, 'cli', 'u', 'r', 'build', '{}', 'autonomous', ?, 'pending')`,
  ).run(id, new Date().toISOString());
}

/** Minimal WikiPage fixture. */
const FAKE_PAGE = {
  slug: 'overview.md',
  path: '/fake/proj/docs/knowledge/overview.md',
  content: '# Overview\n\nA todo CLI.',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('runWikiCritic', () => {
  // Clean up env override between tests so the prompt-loader cache doesn't bleed.
  afterEach(() => {
    delete process.env['FACTORY5_PROMPTS_ROOT'];
    // Reset module-level cache by clearing the module cache isn't easy in ESM;
    // use FACTORY5_PROMPTS_ROOT in beforeEach instead when needed.
  });

  // 1. Happy path — passing critique
  it('parses a passing critique and emits info log with "critic" in the message', async () => {
    const registry = makeFakeRegistry({ response: PASSING_JSON });
    const emitted: unknown[] = [];
    const emit = vi.fn((event: unknown) => emitted.push(event));

    const result = await runWikiCritic({
      registry: registry as Parameters<typeof runWikiCritic>[0]['registry'],
      projectPath: '/fake/proj',
      directiveBody: 'build a tiny CLI todo app',
      claudeMd: '# Project\n\nA todo app.',
      pages: [FAKE_PAGE],
      directiveId: '01TESTDIRECTIVE00000000000',
      emit: emit as Parameters<typeof runWikiCritic>[0]['emit'],
    });

    expect(result.passes).toBe(true);
    expect(result.severity).toBe('pass');
    expect(result.findings).toHaveLength(0);
    // Emit should have been called at least once with an info log.line referencing 'critic'
    const logEvents = emitted.filter(
      (e): e is { type: string; level: string; component: string; msg: string } =>
        typeof e === 'object' && e !== null && (e as { type: string }).type === 'log.line',
    );
    const infoEvents = logEvents.filter((e) => e.level === 'info');
    expect(infoEvents.length).toBeGreaterThan(0);
    expect(
      infoEvents.some(
        (e) => e.component === 'brain.critic' || e.msg.toLowerCase().includes('critic'),
      ),
    ).toBe(true);
  });

  // 2. Failing critique — findings array length and severity preserved
  it('parses a failing critique with findings and emits warn log', async () => {
    const registry = makeFakeRegistry({ response: FAILING_JSON });
    const emitted: unknown[] = [];
    const emit = vi.fn((event: unknown) => emitted.push(event));

    const result = await runWikiCritic({
      registry: registry as Parameters<typeof runWikiCritic>[0]['registry'],
      projectPath: '/fake/proj',
      directiveBody: 'x',
      claudeMd: '# x',
      pages: [FAKE_PAGE],
      directiveId: '01FAILINGCRITIC000000000000',
      emit: emit as Parameters<typeof runWikiCritic>[0]['emit'],
    });

    expect(result.passes).toBe(false);
    expect(result.findings).toHaveLength(1);
    expect(result.severity).toBe('major');
    // Should emit a warn-level log
    const warnEvents = emitted.filter(
      (e): e is { type: string; level: string } =>
        typeof e === 'object' && e !== null && (e as { type: string }).type === 'log.line',
    );
    expect(warnEvents.some((e) => e.level === 'warn')).toBe(true);
  });

  // 3. Schema parse failure — malformed JSON → error thrown + error emitted
  it('throws on malformed JSON and emits error log with detail', async () => {
    const registry = makeFakeRegistry({ response: 'not json at all' });
    const emitted: unknown[] = [];
    const emit = vi.fn((event: unknown) => emitted.push(event));

    await expect(
      runWikiCritic({
        registry: registry as Parameters<typeof runWikiCritic>[0]['registry'],
        projectPath: '/fake/proj',
        directiveBody: 'x',
        claudeMd: '# x',
        pages: [FAKE_PAGE],
        directiveId: '01ERRNOJSON000000000000000',
        emit: emit as Parameters<typeof runWikiCritic>[0]['emit'],
      }),
    ).rejects.toThrow();

    const errorEvents = emitted.filter(
      (e): e is { type: string; level: string; attrs?: { detail?: unknown } } =>
        typeof e === 'object' && e !== null && (e as { type: string }).type === 'log.line',
    );
    expect(errorEvents.some((e) => e.level === 'error')).toBe(true);
    const errEvent = errorEvents.find((e) => e.level === 'error');
    expect(errEvent?.attrs).toBeDefined();
    expect(typeof (errEvent?.attrs as { detail?: unknown })?.detail).toBe('string');
  });

  // 4. Zod-fail JSON — valid JSON but missing required field
  it('throws on schema-valid JSON that fails Zod (missing summary field)', async () => {
    const badJson = JSON.stringify({ passes: true, severity: 'pass', findings: [] }); // missing summary
    const registry = makeFakeRegistry({ response: badJson });

    await expect(
      runWikiCritic({
        registry: registry as Parameters<typeof runWikiCritic>[0]['registry'],
        projectPath: '/fake/proj',
        directiveBody: 'x',
        claudeMd: '# x',
        pages: [FAKE_PAGE],
      }),
    ).rejects.toThrow();
  });

  // 5. Empty pages — throws before LLM call
  it('throws /no pages/i error and never calls the LLM when pages is empty', async () => {
    const calls: unknown[] = [];
    const registry = makeFakeRegistry({ response: '{}', captureTo: calls });

    await expect(
      runWikiCritic({
        registry: registry as Parameters<typeof runWikiCritic>[0]['registry'],
        projectPath: '/fake/proj',
        directiveBody: 'x',
        claudeMd: '# x',
        pages: [],
      }),
    ).rejects.toThrow(/no pages/i);

    expect(calls).toHaveLength(0);
  });

  // 6. Prompt shape — directive body, CLAUDE.md, wiki pages all appear in user prompt
  it('includes directive body, CLAUDE.md, and wiki page content in the user prompt', async () => {
    const captured: { userPrompt: string }[] = [];
    const registry = makeFakeRegistry({
      response: JSON.stringify({ passes: true, severity: 'pass', findings: [], summary: 'ok' }),
      capturePromptTo: captured,
    });

    await runWikiCritic({
      registry: registry as Parameters<typeof runWikiCritic>[0]['registry'],
      projectPath: '/fake/proj',
      directiveBody: 'BUILD_A_CLI_TODO_APP',
      claudeMd: 'CLAUDE_MD_MARKER',
      pages: [{ slug: 'overview.md', path: '/x/overview.md', content: 'WIKI_PAGE_MARKER_CONTENT' }],
    });

    expect(captured).toHaveLength(1);
    const prompt = captured[0]!.userPrompt;
    expect(prompt).toContain('BUILD_A_CLI_TODO_APP');
    expect(prompt).toContain('CLAUDE_MD_MARKER');
    expect(prompt).toContain('WIKI_PAGE_MARKER_CONTENT');
  });

  // 7. Spend recorded — recordUsage is called with category and a directiveId
  it('records usage for the LLM call (db row is written)', async () => {
    const db = freshDb();
    const directiveId = '01CRITICUSAGE000000000000';
    seedDirective(db, directiveId);

    const registry = makeFakeRegistry({
      response: JSON.stringify({ passes: true, severity: 'pass', findings: [], summary: 'ok' }),
    });

    await runWikiCritic({
      registry: registry as Parameters<typeof runWikiCritic>[0]['registry'],
      projectPath: '/fake/proj',
      directiveBody: 'x',
      claudeMd: '# x',
      pages: [FAKE_PAGE],
      db,
      directiveId,
    });

    // model_usage should have a row for this directiveId
    const rows = db
      .prepare('SELECT * FROM model_usage WHERE directive_id = ?')
      .all(directiveId) as { category: string }[];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]!.category).toBe('reasoning'); // default critic category
  });

  // 8. Config category override — config.agents.critic = 'deep'
  it('resolves category from config.agents.critic when set', async () => {
    const resolved: string[] = [];
    const registry = makeFakeRegistry({
      response: JSON.stringify({ passes: true, severity: 'pass', findings: [], summary: 'ok' }),
      captureCategoryTo: resolved,
    });

    await runWikiCritic({
      registry: registry as Parameters<typeof runWikiCritic>[0]['registry'],
      projectPath: '/fake/proj',
      directiveBody: 'x',
      claudeMd: '# x',
      pages: [FAKE_PAGE],
      config: { agents: { critic: 'deep' } },
    });

    expect(resolved[0]).toBe('deep');
  });

  // 9. Default category — no config → 'reasoning'
  it("defaults model category to 'reasoning' when config is absent", async () => {
    const resolved: string[] = [];
    const registry = makeFakeRegistry({
      response: JSON.stringify({ passes: true, severity: 'pass', findings: [], summary: 'ok' }),
      captureCategoryTo: resolved,
    });

    await runWikiCritic({
      registry: registry as Parameters<typeof runWikiCritic>[0]['registry'],
      projectPath: '/fake/proj',
      directiveBody: 'x',
      claudeMd: '# x',
      pages: [FAKE_PAGE],
    });

    expect(resolved[0]).toBe('reasoning');
  });

  // 10. Budget assertion — assertBudget is called with agent = 'critic'
  it("asserts budget before LLM call with agent='critic'", async () => {
    const db = freshDb();
    const directiveId = '01CRITICBUDGET00000000000';
    seedDirective(db, directiveId);

    // Set a very high maxUsd so the budget doesn't trip, but assertBudget is still called.
    const registry = makeFakeRegistry({
      response: JSON.stringify({ passes: true, severity: 'pass', findings: [], summary: 'ok' }),
    });

    // Two cases: (1) high ceiling, call succeeds and assertBudget passed;
    // (2) seed spend exceeding maxUsd, assertBudget throws before any LLM call.
    await expect(
      runWikiCritic({
        registry: registry as Parameters<typeof runWikiCritic>[0]['registry'],
        projectPath: '/fake/proj',
        directiveBody: 'x',
        claudeMd: '# x',
        pages: [FAKE_PAGE],
        db,
        directiveId,
        limits: { maxUsd: 1000 }, // high enough not to trip
      }),
    ).resolves.toBeDefined();

    // Also verify that with a very tight budget it does trip (assertBudget is wired)
    const db2 = freshDb();
    const did2 = '01CRITICBUDGET20000000000';
    seedDirective(db2, did2);

    // Seed many expensive calls so the running total is huge.
    const { newId } = await import('@factory5/core');
    const { modelUsage } = await import('@factory5/state');
    for (let i = 0; i < 3; i++) {
      modelUsage.record(db2, {
        id: newId(),
        directiveId: did2,
        provider: 'stub',
        model: 'stub',
        category: 'reasoning',
        inputTokens: 1000,
        outputTokens: 500,
        costUsd: 10.0,
        durationMs: 100,
        calledAt: new Date().toISOString(),
        mode: 'call',
      });
    }

    // Now spentSoFar = 30, ceiling = 1 → should throw BudgetExceededError
    await expect(
      runWikiCritic({
        registry: registry as Parameters<typeof runWikiCritic>[0]['registry'],
        projectPath: '/fake/proj',
        directiveBody: 'x',
        claudeMd: '# x',
        pages: [FAKE_PAGE],
        db: db2,
        directiveId: did2,
        limits: { maxUsd: 1 },
      }),
    ).rejects.toThrow(/budget_exceeded/i);
  });
});
