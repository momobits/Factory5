/**
 * Unit tests for `triageDirective`.
 *
 * Focused regression coverage for the cwd-isolation fix (post-Tier-15):
 * `triageDirective` must pass `cwd` to the provider so claude-cli cannot
 * inherit factoryd's own repo dir. See {@link resolveLlmCwd}.
 */

import { tmpdir } from 'node:os';

import { initLogger } from '@factory5/logger';
import { beforeAll, describe, expect, it } from 'vitest';

import { makeFakeRegistry } from './test-helpers.js';
import { triageDirective } from './triage.js';

beforeAll(() => {
  initLogger({ processName: 'triage-test', noFile: true, noConsole: true });
});

const VALID_TRIAGE_JSON = JSON.stringify({
  intent: 'build',
  confidence: 0.95,
  reasoning: 'unambiguous build request',
});

describe('triageDirective — cwd isolation (post-Tier-15 fix)', () => {
  it('passes opts.projectPath as req.cwd to the provider', async () => {
    const captured: Array<{ cwd?: string }> = [];
    const registry = makeFakeRegistry({
      response: VALID_TRIAGE_JSON,
      captureTo: captured,
    });

    await triageDirective('build me a CLI', {
      registry: registry as Parameters<typeof triageDirective>[1]['registry'],
      projectPath: '/work/some-project',
    });

    expect(captured).toHaveLength(1);
    expect(captured[0]?.cwd).toBe('/work/some-project');
  });

  it('falls back to os.tmpdir() when projectPath is omitted (defensive isolation)', async () => {
    const captured: Array<{ cwd?: string }> = [];
    const registry = makeFakeRegistry({
      response: VALID_TRIAGE_JSON,
      captureTo: captured,
    });

    await triageDirective('hello', {
      registry: registry as Parameters<typeof triageDirective>[1]['registry'],
    });

    expect(captured).toHaveLength(1);
    expect(captured[0]?.cwd).toBe(tmpdir());
    // Guard against the pythonetl-resume bug: never undefined.
    expect(captured[0]?.cwd).toBeDefined();
  });
});
