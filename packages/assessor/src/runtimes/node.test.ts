/**
 * Node runtime — seam-injected unit tests covering every scenario the
 * Phase 9 findings UI must render:
 *   - green gate (preflight ok, build ok, tests ok)
 *   - ENV_SETUP_FAILURE (pnpm install exits non-zero)
 *   - BUILD_FAILURE (tsc / typecheck exits non-zero)
 *   - TEST_FAILURE (pnpm test runs but reports failed counts)
 *   - ENV_HOST_MISSING_TOOL (pnpm or node missing from PATH)
 *   - no-test-script short-circuit (buildOk=true, testsAvailable=false)
 *
 * The integration-level story (real pnpm install + real tsc + real vitest
 * against a seeded tmpdir project) lives in `test/node-e2e.test.ts` and in
 * 10.3's live validation.
 */

import { beforeAll, describe, expect, it } from 'vitest';

import { initLogger } from '@factory5/logger';

import type { SubprocessResult } from '../run.js';

import { buildNodeRuntime, parseNodeTestSummary, type NodeRuntimeDeps } from './node.js';

beforeAll(() => {
  initLogger({ processName: 'node-runtime-test', noFile: true });
});

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function ok(stdout = '', stderr = ''): SubprocessResult {
  return { stdout, stderr, exitCode: 0, durationMs: 1 };
}

function fail(stdout = '', stderr = ''): SubprocessResult {
  return { stdout, stderr, exitCode: 1, durationMs: 1 };
}

interface Call {
  bin: string;
  args: readonly string[];
  cwd?: string;
}

interface Scenario {
  /** Scripted response per call. Keyed by predicate over `(bin, args)`. */
  handler: (call: Call) => SubprocessResult;
  hasLockfile?: boolean;
  pkg?: {
    scripts?: Record<string, string>;
    devDependencies?: Record<string, string>;
    dependencies?: Record<string, string>;
  };
  resolveOnPath?: (name: string) => string | undefined;
}

function seam(scenario: Scenario, calls: Call[]): NodeRuntimeDeps {
  return {
    runSubprocess: async (bin, args, opts) => {
      const call: Call = {
        bin,
        args: [...args],
        ...(opts?.cwd !== undefined ? { cwd: opts.cwd } : {}),
      };
      calls.push(call);
      return scenario.handler(call);
    },
    resolveOnPath: async (name) => {
      const fn = scenario.resolveOnPath ?? ((n) => `/usr/local/bin/${n}`);
      return fn(name);
    },
    readPackageJson: async () =>
      scenario.pkg ?? { scripts: { test: 'vitest run', typecheck: 'tsc --noEmit' } },
    hasLockfile: async () => scenario.hasLockfile ?? true,
    platform: 'linux',
  };
}

// ---------------------------------------------------------------------------
// parseNodeTestSummary
// ---------------------------------------------------------------------------

describe('parseNodeTestSummary', () => {
  it('parses vitest banner (all-pass)', () => {
    const out = `
 RUN  v2.0.5
 ✓ src/foo.test.ts (3)

 Test Files  1 passed (1)
      Tests  14 passed (14)
   Start at  12:00:00
   Duration  280ms
`;
    expect(parseNodeTestSummary(out)).toEqual({ passed: 14, failed: 0, errors: 0 });
  });

  it('parses vitest banner (mixed)', () => {
    const out = `
 Test Files  1 failed | 2 passed (3)
      Tests  2 failed | 12 passed (14)
`;
    expect(parseNodeTestSummary(out)).toEqual({ passed: 12, failed: 2, errors: 0 });
  });

  it('parses jest banner', () => {
    const out = `
Test Suites: 1 failed, 2 passed, 3 total
Tests:       2 failed, 12 passed, 14 total
Snapshots:   0 total
Time:        0.512s
`;
    expect(parseNodeTestSummary(out)).toEqual({ passed: 12, failed: 2, errors: 0 });
  });

  it('parses node:test TAP', () => {
    const out = `
# ok 14
# tests 14
# pass 14
# fail 0
`;
    expect(parseNodeTestSummary(out)).toEqual({ passed: 14, failed: 0, errors: 0 });
  });

  it('returns zeros for unparseable output', () => {
    expect(parseNodeTestSummary('no match here')).toEqual({ passed: 0, failed: 0, errors: 0 });
  });
});

// ---------------------------------------------------------------------------
// runGate — happy path + failure-mode matrix
// ---------------------------------------------------------------------------

describe('nodeRuntime.runGate', () => {
  const project = '/tmp/node-proj';

  it('green gate: preflight ok, typecheck ok, tests pass', async () => {
    const calls: Call[] = [];
    const rt = buildNodeRuntime(
      seam(
        {
          handler: (c) => {
            if (c.args[0] === '--version') return ok('v20.11.0\n');
            if (c.args[0] === 'install') return ok();
            if (c.args[0] === 'typecheck') return ok();
            if (c.args[0] === 'test') return ok('      Tests  5 passed (5)\n');
            return ok();
          },
        },
        calls,
      ),
    );

    const r = await rt.runGate(project, {});

    expect(r.failureMode).toBeUndefined();
    expect(r.buildOk).toBe(true);
    expect(r.testsAvailable).toBe(true);
    expect(r.testsPassed).toBe(5);
    expect(r.testsFailed).toBe(0);
    expect(r.testFramework).toBe('vitest');
    expect(r.provisioning?.runtime).toBe('node');
    expect(r.provisioning?.preflight?.ok).toBe(true);
    expect(r.provisioning?.preflight?.command).toBe('pnpm install --frozen-lockfile');

    // Call sequence: probe node + pnpm versions, then install → typecheck → test.
    const pipeline = calls.filter((c) => c.args[0] !== '--version').map((c) => c.args[0]);
    expect(pipeline).toEqual(['install', 'typecheck', 'test']);
  });

  it('drops --frozen-lockfile when pnpm-lock.yaml is absent', async () => {
    const calls: Call[] = [];
    const rt = buildNodeRuntime(
      seam(
        {
          hasLockfile: false,
          handler: (c) => {
            if (c.args[0] === '--version') return ok('v20.11.0\n');
            if (c.args[0] === 'install') return ok();
            if (c.args[0] === 'typecheck') return ok();
            if (c.args[0] === 'test') return ok('      Tests  1 passed (1)\n');
            return ok();
          },
        },
        calls,
      ),
    );

    const r = await rt.runGate(project, {});
    expect(r.failureMode).toBeUndefined();
    const install = calls.find((c) => c.args[0] === 'install');
    expect(install?.args).toEqual(['install']);
    expect(r.provisioning?.preflight?.command).toBe('pnpm install');
  });

  it('falls back to `pnpm exec tsc --noEmit` when no typecheck script is declared', async () => {
    const calls: Call[] = [];
    const rt = buildNodeRuntime(
      seam(
        {
          pkg: { scripts: { test: 'vitest run' }, devDependencies: { vitest: '^2.0.0' } },
          handler: (c) => {
            if (c.args[0] === '--version') return ok('v20.11.0\n');
            if (c.args[0] === 'install') return ok();
            if (c.args[0] === 'exec' && c.args[1] === 'tsc') return ok();
            if (c.args[0] === 'test') return ok('      Tests  1 passed (1)\n');
            return ok();
          },
        },
        calls,
      ),
    );

    const r = await rt.runGate(project, {});
    expect(r.failureMode).toBeUndefined();
    const build = calls.find(
      (c) => c.args[0] === 'exec' && c.args[1] === 'tsc' && c.args[2] === '--noEmit',
    );
    expect(build).toBeDefined();
  });

  it('ENV_SETUP_FAILURE: pnpm install exits non-zero', async () => {
    const rt = buildNodeRuntime(
      seam(
        {
          handler: (c) => {
            if (c.args[0] === '--version') return ok('v20.11.0\n');
            if (c.args[0] === 'install')
              return fail('', 'ERR_PNPM_LOCKFILE_MISSING_DEP something is wrong');
            return ok();
          },
        },
        [],
      ),
    );

    const r = await rt.runGate(project, {});
    expect(r.failureMode).toBe('ENV_SETUP_FAILURE');
    expect(r.buildOk).toBe(false);
    expect(r.provisioning?.preflight?.ok).toBe(false);
    expect(r.provisioning?.preflight?.summary).toContain('ERR_PNPM_LOCKFILE');
  });

  it('BUILD_FAILURE: typecheck exits non-zero', async () => {
    const rt = buildNodeRuntime(
      seam(
        {
          handler: (c) => {
            if (c.args[0] === '--version') return ok('v20.11.0\n');
            if (c.args[0] === 'install') return ok();
            if (c.args[0] === 'typecheck') return fail('src/foo.ts(3,5): error TS2322');
            return ok();
          },
        },
        [],
      ),
    );

    const r = await rt.runGate(project, {});
    expect(r.failureMode).toBe('BUILD_FAILURE');
    expect(r.buildOk).toBe(false);
    expect(r.testsAvailable).toBe(false);
    expect(r.provisioning?.preflight?.ok).toBe(true);
  });

  it('TEST_FAILURE: tests ran and some failed', async () => {
    const rt = buildNodeRuntime(
      seam(
        {
          handler: (c) => {
            if (c.args[0] === '--version') return ok('v20.11.0\n');
            if (c.args[0] === 'install') return ok();
            if (c.args[0] === 'typecheck') return ok();
            if (c.args[0] === 'test') return fail('      Tests  2 failed | 12 passed (14)\n', '');
            return ok();
          },
        },
        [],
      ),
    );

    const r = await rt.runGate(project, {});
    expect(r.failureMode).toBe('TEST_FAILURE');
    expect(r.buildOk).toBe(true);
    expect(r.testsAvailable).toBe(true);
    expect(r.testsPassed).toBe(12);
    expect(r.testsFailed).toBe(2);
  });

  it('ENV_HOST_MISSING_TOOL: pnpm disappears between preflight and runGate', async () => {
    const rt = buildNodeRuntime(
      seam(
        {
          resolveOnPath: (n) => (n === 'pnpm' ? undefined : `/usr/local/bin/${n}`),
          handler: () => ok(),
        },
        [],
      ),
    );

    const r = await rt.runGate(project, {});
    expect(r.failureMode).toBe('ENV_HOST_MISSING_TOOL');
    expect(r.buildOk).toBe(false);
    expect(r.provisioning).toBeUndefined();
  });

  it('BUILD_FAILURE: package.json missing or unparseable', async () => {
    const rt = buildNodeRuntime({
      runSubprocess: async () => ok(),
      resolveOnPath: async () => '/usr/local/bin/pnpm',
      readPackageJson: async () => undefined,
      hasLockfile: async () => false,
      platform: 'linux',
    });

    const r = await rt.runGate(project, {});
    expect(r.failureMode).toBe('BUILD_FAILURE');
  });

  it('no test script: buildOk=true, testsAvailable=false, no failureMode', async () => {
    const rt = buildNodeRuntime(
      seam(
        {
          pkg: { scripts: { typecheck: 'tsc --noEmit' }, devDependencies: {} },
          handler: (c) => {
            if (c.args[0] === '--version') return ok('v20.11.0\n');
            if (c.args[0] === 'install') return ok();
            if (c.args[0] === 'typecheck') return ok();
            return ok();
          },
        },
        [],
      ),
    );

    const r = await rt.runGate(project, {});
    expect(r.failureMode).toBeUndefined();
    expect(r.buildOk).toBe(true);
    expect(r.testsAvailable).toBe(false);
    expect(r.testFramework).toBe('none');
  });

  it('reports hostTools for pre-flight', () => {
    const rt = buildNodeRuntime();
    const names = rt.hostTools.map((t) => t.bin);
    expect(names).toContain('node');
    expect(names).toContain('pnpm');
  });
});
