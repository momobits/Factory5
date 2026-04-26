/**
 * Go runtime — seam-injected unit tests.
 *
 * Mirrors `node.test.ts` scenario coverage (green / BUILD_FAILURE /
 * TEST_FAILURE / ENV_HOST_MISSING_TOOL / no-tests path). No real `go`
 * subprocess spawns.
 */

import { beforeAll, describe, expect, it } from 'vitest';

import { initLogger } from '@factory5/logger';

import type { SubprocessResult } from '../run.js';

import {
  buildGoRuntime,
  countListedGoTests,
  parseGoTestSummary,
  type GoRuntimeDeps,
} from './go.js';

beforeAll(() => {
  initLogger({ processName: 'go-runtime-test', noFile: true });
});

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
  handler: (call: Call) => SubprocessResult;
  resolveOnPath?: (name: string) => string | undefined;
}

function seam(scenario: Scenario, calls: Call[]): GoRuntimeDeps {
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
    platform: 'linux',
  };
}

// ---------------------------------------------------------------------------
// parseGoTestSummary
// ---------------------------------------------------------------------------

describe('parseGoTestSummary', () => {
  it('counts PASS / FAIL lines from stock go test output', () => {
    const out = `
=== RUN   TestAdd
--- PASS: TestAdd (0.00s)
=== RUN   TestSub
--- FAIL: TestSub (0.00s)
    main_test.go:15: expected 3, got 4
=== RUN   TestMul
--- PASS: TestMul (0.00s)
FAIL
FAIL    example.com/mymod    0.002s
FAIL
`;
    expect(parseGoTestSummary(out)).toEqual({ passed: 2, failed: 1, errors: 0 });
  });

  it('counts subtests (t.Run) as separate passes', () => {
    const out = `
--- PASS: TestParent (0.00s)
    --- PASS: TestParent/sub_one (0.00s)
    --- PASS: TestParent/sub_two (0.00s)
PASS
ok      example.com/mymod    0.001s
`;
    expect(parseGoTestSummary(out).passed).toBe(3);
  });

  it('returns zeros for output without PASS/FAIL lines', () => {
    expect(parseGoTestSummary('just compile errors')).toEqual({
      passed: 0,
      failed: 0,
      errors: 0,
    });
  });
});

describe('countListedGoTests', () => {
  it('counts test names, skipping ok/FAIL footers', () => {
    const out = `
TestAdd
TestSub
ok      example.com/mymod    0.000s
TestMul
?       example.com/otherpkg [no test files]
`;
    expect(countListedGoTests(out)).toBe(3);
  });

  it('returns 0 when only package footers are present', () => {
    const out = `
ok      example.com/mymod    0.000s
?       example.com/otherpkg [no test files]
`;
    expect(countListedGoTests(out)).toBe(0);
  });

  it('accepts Benchmark / Example / Fuzz names', () => {
    const out = `
TestAdd
BenchmarkAdd
ExampleAdd
FuzzAdd
`;
    expect(countListedGoTests(out)).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// runGate — scenario matrix
// ---------------------------------------------------------------------------

describe('goRuntime.runGate', () => {
  const project = '/tmp/go-proj';

  it('green gate: build ok, tests listed, tests pass', async () => {
    const calls: Call[] = [];
    const rt = buildGoRuntime(
      seam(
        {
          handler: (c) => {
            if (c.args[0] === 'version') return ok('go version go1.22.1 linux/amd64\n');
            if (c.args[0] === 'build') return ok();
            if (c.args[0] === 'test' && c.args.includes('-list'))
              return ok('TestAdd\nTestSub\nok  example.com/mymod  0.000s\n');
            if (c.args[0] === 'test')
              return ok('--- PASS: TestAdd (0.00s)\n--- PASS: TestSub (0.00s)\nPASS\nok\n');
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
    expect(r.testsPassed).toBe(2);
    expect(r.testsFailed).toBe(0);
    expect(r.testFramework).toBe('go-test');
    expect(r.provisioning?.runtime).toBe('go');
    expect(r.provisioning?.toolVersion).toContain('go1.22.1');

    const pipeline = calls.filter((c) => c.args[0] !== 'version').map((c) => c.args.join(' '));
    expect(pipeline).toEqual(['build ./...', 'test -list .* ./...', 'test -v -count=1 ./...']);
  });

  it('BUILD_FAILURE: go build exits non-zero', async () => {
    const rt = buildGoRuntime(
      seam(
        {
          handler: (c) => {
            if (c.args[0] === 'version') return ok('go version go1.22.1 linux/amd64\n');
            if (c.args[0] === 'build')
              return fail('', './main.go:3:1: expected declaration, got "}"');
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
    expect(r.provisioning?.preflight?.ok).toBe(false);
    expect(r.provisioning?.preflight?.summary).toContain('expected declaration');
  });

  it('TEST_FAILURE: tests run and some fail', async () => {
    const rt = buildGoRuntime(
      seam(
        {
          handler: (c) => {
            if (c.args[0] === 'version') return ok('go version go1.22.1 linux/amd64\n');
            if (c.args[0] === 'build') return ok();
            if (c.args[0] === 'test' && c.args.includes('-list')) return ok('TestAdd\nTestBoom\n');
            if (c.args[0] === 'test')
              return fail(
                '--- PASS: TestAdd (0.00s)\n--- FAIL: TestBoom (0.00s)\nFAIL\nFAIL example.com/mymod\n',
              );
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
    expect(r.testsPassed).toBe(1);
    expect(r.testsFailed).toBe(1);
  });

  it('no-tests path: build ok, no tests discovered → testsAvailable=false, no failureMode', async () => {
    const rt = buildGoRuntime(
      seam(
        {
          handler: (c) => {
            if (c.args[0] === 'version') return ok('go version go1.22.1 linux/amd64\n');
            if (c.args[0] === 'build') return ok();
            if (c.args[0] === 'test' && c.args.includes('-list'))
              return ok(
                '?       example.com/mymod [no test files]\n?       example.com/other [no test files]\n',
              );
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

  it('ENV_HOST_MISSING_TOOL: go vanishes between preflight and runGate', async () => {
    const rt = buildGoRuntime(
      seam(
        {
          resolveOnPath: (n) => (n === 'go' ? undefined : `/usr/local/bin/${n}`),
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

  it('reports hostTools for pre-flight', () => {
    const rt = buildGoRuntime();
    const names = rt.hostTools.map((t) => t.bin);
    expect(names).toContain('go');
  });
});
