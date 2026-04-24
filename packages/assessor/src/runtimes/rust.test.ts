/**
 * Rust runtime — seam-injected unit tests.
 *
 * Mirrors `go.test.ts` coverage: green / BUILD_FAILURE / TEST_FAILURE /
 * ENV_HOST_MISSING_TOOL / zero-tests path. No real `cargo` subprocess.
 */

import { beforeAll, describe, expect, it } from 'vitest';

import { initLogger } from '@factory5/logger';

import type { SubprocessResult } from '../run.js';

import { buildRustRuntime, parseCargoTestSummary, type RustRuntimeDeps } from './rust.js';

beforeAll(() => {
  initLogger({ processName: 'rust-runtime-test', noFile: true });
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

function seam(scenario: Scenario, calls: Call[]): RustRuntimeDeps {
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
// parseCargoTestSummary
// ---------------------------------------------------------------------------

describe('parseCargoTestSummary', () => {
  it('parses a single test-result line (green)', () => {
    const out = `
running 3 tests
test tests::add_works ... ok
test tests::sub_works ... ok
test tests::mul_works ... ok

test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
`;
    const s = parseCargoTestSummary(out);
    expect(s.sawResult).toBe(true);
    expect(s.passed).toBe(3);
    expect(s.failed).toBe(0);
  });

  it('parses a failed test-result line', () => {
    const out = `
running 3 tests
test tests::add_works ... ok
test tests::sub_works ... ok
test tests::mul_works ... FAILED

test result: FAILED. 2 passed; 1 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
`;
    const s = parseCargoTestSummary(out);
    expect(s.sawResult).toBe(true);
    expect(s.passed).toBe(2);
    expect(s.failed).toBe(1);
  });

  it('aggregates counts across multiple targets (unit + integration + doc)', () => {
    const out = `
test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s

Running target/debug/deps/integration-abc

test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s

running 1 doctest
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
`;
    const s = parseCargoTestSummary(out);
    expect(s.sawResult).toBe(true);
    expect(s.passed).toBe(6);
    expect(s.failed).toBe(0);
  });

  it('returns sawResult=false for compile-error output', () => {
    const out = `
error[E0425]: cannot find value \`undefined\` in this scope
 --> src/lib.rs:3:5
  |
3 |     undefined
  |     ^^^^^^^^^ not found in this scope

error: aborting due to previous error
`;
    const s = parseCargoTestSummary(out);
    expect(s.sawResult).toBe(false);
    expect(s.passed).toBe(0);
    expect(s.failed).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// runGate — scenario matrix
// ---------------------------------------------------------------------------

describe('rustRuntime.runGate', () => {
  const project = '/tmp/rust-proj';

  it('green gate: cargo test exits 0 with passing summary', async () => {
    const calls: Call[] = [];
    const rt = buildRustRuntime(
      seam(
        {
          handler: (c) => {
            if (c.args[0] === '--version') return ok('cargo 1.77.2 (abcdef 2024-03-01)\n');
            if (c.args[0] === 'test')
              return ok(
                '\ntest tests::adds ... ok\n\ntest result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s\n',
              );
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
    expect(r.testsPassed).toBe(1);
    expect(r.testsFailed).toBe(0);
    expect(r.testFramework).toBe('cargo-test');
    expect(r.provisioning?.runtime).toBe('rust');
    expect(r.provisioning?.toolVersion).toContain('cargo 1.77.2');

    const pipeline = calls.filter((c) => c.args[0] !== '--version').map((c) => c.args.join(' '));
    expect(pipeline).toEqual(['test']);
  });

  it('BUILD_FAILURE: cargo test exits non-zero with no test-result line', async () => {
    const rt = buildRustRuntime(
      seam(
        {
          handler: (c) => {
            if (c.args[0] === '--version') return ok('cargo 1.77.2\n');
            if (c.args[0] === 'test')
              return fail(
                '',
                'error[E0425]: cannot find value `undefined` in this scope\nerror: aborting due to previous error\n',
              );
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
    expect(r.provisioning?.preflight?.summary).toContain('cannot find value');
  });

  it('TEST_FAILURE: test-result line with failed > 0', async () => {
    const rt = buildRustRuntime(
      seam(
        {
          handler: (c) => {
            if (c.args[0] === '--version') return ok('cargo 1.77.2\n');
            if (c.args[0] === 'test')
              return fail(
                '\ntest tests::boom ... FAILED\n\ntest result: FAILED. 2 passed; 1 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s\n',
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
    expect(r.testsPassed).toBe(2);
    expect(r.testsFailed).toBe(1);
  });

  it('ENV_HOST_MISSING_TOOL: cargo missing', async () => {
    const rt = buildRustRuntime(
      seam(
        {
          resolveOnPath: (n) => (n === 'cargo' ? undefined : `/usr/local/bin/${n}`),
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
    const rt = buildRustRuntime();
    const names = rt.hostTools.map((t) => t.bin);
    expect(names).toContain('cargo');
  });
});
