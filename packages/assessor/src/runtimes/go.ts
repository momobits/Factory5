/**
 * Go runtime — env-assuming provisioner (ADR 0026 §1 / §2).
 *
 * Gate pipeline:
 *   1. Host-tool pre-flight ensures `go` resolves on PATH. (Runs in
 *      `assess()` before this module is entered; a safety-net probe runs
 *      at the top of `runGate` to handle concurrent PATH mutation.)
 *   2. No preflight — `go build` fetches modules transparently via
 *      `$GOPATH/pkg/mod`. No factory-managed env layer (ADR 0026 §1 "why").
 *   3. Build — `go build ./...`. Non-zero ⇒ `BUILD_FAILURE`.
 *   4. Test presence detection — `go test -list '.*' ./...` listing no tests
 *      flips `testsAvailable: false` so `gate.integration` stays false on
 *      zero-test projects (ADR 0026 §2 edge case: `go test ./...` exits 0
 *      with no tests, which would otherwise falsely pass the gate).
 *   5. Test — `go test ./...`. Summary parsed from `--- PASS:` / `--- FAIL:`
 *      lines per the stock Go testing output shape.
 */

import { platform as processPlatform } from 'node:process';

import { createLogger } from '@factory5/logger';

import { resolveOnPath, runSubprocess, type SubprocessResult } from '../run.js';
import type {
  ProvisioningRecord,
  RuntimeAssessor,
  RuntimeGateOptions,
  RuntimeGateResult,
} from '../types.js';

const log = createLogger('assessor.go');

// ---------------------------------------------------------------------------
// Summary parsing
// ---------------------------------------------------------------------------

interface TestCounts {
  passed: number;
  failed: number;
  errors: number;
}

/**
 * Parse `go test ./...` output. Go's stock testing output emits one
 * `--- PASS: TestName (0.00s)` line per pass and `--- FAIL: TestName` per
 * failure (subtests included: `--- PASS: TestName/subtest`). Compile errors
 * surface as `FAIL\texample.com/pkg [build failed]` without per-test lines;
 * those are attributed to `BUILD_FAILURE` via exit code, not this parser.
 */
export function parseGoTestSummary(stdout: string): TestCounts {
  const counts: TestCounts = { passed: 0, failed: 0, errors: 0 };
  const lines = stdout.split(/\r?\n/);
  for (const line of lines) {
    // Subtests under `t.Run(...)` emit indented `    --- PASS: Parent/sub` lines;
    // count them too.
    const trimmed = line.trimStart();
    if (/^---\s+PASS:/.test(trimmed)) counts.passed += 1;
    else if (/^---\s+FAIL:/.test(trimmed)) counts.failed += 1;
  }
  return counts;
}

/**
 * `go test -list '.*' ./...` prints one test-name per line for every
 * discovered test, plus `ok  <pkg> 0.001s` footers per package. Empty
 * output (or only footers) means no tests exist.
 */
export function countListedGoTests(stdout: string): number {
  let count = 0;
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    // Skip package footers like `ok  example.com/pkg 0.001s` or
    // `?   example.com/pkg [no test files]`.
    if (/^(ok|FAIL|\?)\s+/.test(trimmed)) continue;
    // Test names start with Test / Benchmark / Example / Fuzz per the
    // testing package's discovery rules.
    if (/^(Test|Benchmark|Example|Fuzz)/.test(trimmed)) count += 1;
  }
  return count;
}

function tailLines(s: string, n: number): string {
  const lines = s.split(/\r?\n/);
  return lines.slice(-n).join('\n');
}

function firstWordVersion(s: string): string {
  const trimmed = s.trim().split(/\s+/).slice(0, 3).join(' ');
  return trimmed;
}

// ---------------------------------------------------------------------------
// Runtime
// ---------------------------------------------------------------------------

/**
 * Testing seam. All IO defaults to the real helpers; unit tests override so
 * no `go` subprocess spawns during the assessor's own test suite.
 */
export interface GoRuntimeDeps {
  runSubprocess?: (
    bin: string,
    args: readonly string[],
    opts?: { cwd?: string; timeoutMs?: number; env?: Record<string, string> },
  ) => Promise<SubprocessResult>;
  resolveOnPath?: (name: string) => Promise<string | undefined>;
  platform?: NodeJS.Platform;
}

function resolveDeps(override: GoRuntimeDeps): Required<GoRuntimeDeps> {
  return {
    runSubprocess: override.runSubprocess ?? runSubprocess,
    resolveOnPath: override.resolveOnPath ?? resolveOnPath,
    platform: override.platform ?? processPlatform,
  };
}

async function probeGoVersion(goBin: string, deps: Required<GoRuntimeDeps>): Promise<string> {
  try {
    const res = await deps.runSubprocess(goBin, ['version'], { timeoutMs: 10_000 });
    if (res.exitCode === 0) return firstWordVersion(res.stdout);
  } catch {
    /* probe failures fall through */
  }
  return '';
}

export function buildGoRuntime(depsOverride: GoRuntimeDeps = {}): RuntimeAssessor {
  return {
    runtime: 'go',
    hostTools: [
      {
        bin: 'go',
        kind: 'toolchain',
        installHint: 'Install Go 1.21+ from https://go.dev/dl/',
      },
    ],

    async runGate(projectPath: string, opts: RuntimeGateOptions): Promise<RuntimeGateResult> {
      const deps = resolveDeps(depsOverride);
      const runnerTimeout = opts.runnerTimeoutMs ?? 120_000;

      const goBin = await deps.resolveOnPath('go');
      if (goBin === undefined) {
        return {
          testFramework: 'none',
          testsAvailable: false,
          testsPassed: 0,
          testsFailed: 0,
          testsErrors: 0,
          buildOk: false,
          importErrors: [],
          importsOk: false,
          failureMode: 'ENV_HOST_MISSING_TOOL',
        };
      }

      const goVersion = await probeGoVersion(goBin, deps);
      log.info({ projectPath, goBin, goVersion }, 'go.runGate: toolchain resolved');

      const provisioning: ProvisioningRecord = {
        runtime: 'go',
        toolPath: goBin,
        toolVersion: goVersion,
      };

      // --- Build: go build ./... --------------------------------------
      log.info({ projectPath }, 'go.runGate: go build ./...');
      const buildStarted = Date.now();
      const buildRes = await deps.runSubprocess(goBin, ['build', './...'], {
        cwd: projectPath,
        timeoutMs: runnerTimeout,
      });
      const buildOk = buildRes.exitCode === 0;
      log.info(
        {
          projectPath,
          exitCode: buildRes.exitCode,
          durationMs: Date.now() - buildStarted,
          buildOk,
        },
        buildOk ? 'go.runGate: build passed' : 'go.runGate: build failed',
      );

      if (!buildOk) {
        return {
          testFramework: 'go-test',
          testsAvailable: false,
          testsPassed: 0,
          testsFailed: 0,
          testsErrors: 0,
          buildOk: false,
          importErrors: [],
          importsOk: false,
          provisioning: {
            ...provisioning,
            preflight: {
              command: 'go build ./...',
              ok: false,
              summary: tailLines(`${buildRes.stdout}\n${buildRes.stderr}`, 40),
            },
          },
          failureMode: 'BUILD_FAILURE',
        };
      }

      // --- Test presence detection -----------------------------------
      // `go test ./...` exits 0 even when no `_test.go` files exist, so
      // we explicitly list tests first and gate `integration` on a
      // non-empty discovery set.
      const listRes = await deps.runSubprocess(goBin, ['test', '-list', '.*', './...'], {
        cwd: projectPath,
        timeoutMs: runnerTimeout,
      });
      const listed = listRes.exitCode === 0 ? countListedGoTests(listRes.stdout) : 0;
      log.info(
        { projectPath, listedTests: listed },
        listed === 0 ? 'go.runGate: no tests discovered' : 'go.runGate: tests discovered',
      );

      if (listed === 0) {
        return {
          testFramework: 'none',
          testsAvailable: false,
          testsPassed: 0,
          testsFailed: 0,
          testsErrors: 0,
          buildOk: true,
          importErrors: [],
          importsOk: true,
          provisioning,
        };
      }

      // --- Test: go test ./... ---------------------------------------
      const testStarted = Date.now();
      const testRes = await deps.runSubprocess(goBin, ['test', './...'], {
        cwd: projectPath,
        timeoutMs: runnerTimeout,
      });
      const counts = parseGoTestSummary(testRes.stdout + '\n' + testRes.stderr);
      const clean = testRes.exitCode === 0 && counts.failed === 0;
      log.info(
        {
          projectPath,
          exitCode: testRes.exitCode,
          durationMs: Date.now() - testStarted,
          ...counts,
        },
        clean ? 'go.runGate: tests passed' : 'go.runGate: tests failed',
      );

      const testsAvailable = counts.passed + counts.failed > 0;
      let failureMode: RuntimeGateResult['failureMode'];
      if (!clean) {
        failureMode = 'TEST_FAILURE';
      }

      return {
        testFramework: 'go-test',
        testsAvailable,
        testsPassed: counts.passed,
        testsFailed: counts.failed,
        testsErrors: counts.errors,
        buildOk: true,
        importErrors: [],
        importsOk: true,
        provisioning,
        ...(failureMode !== undefined ? { failureMode } : {}),
      };
    },
  };
}

/** Real-IO singleton — wire into `assess()` dispatch. */
export const goRuntime: RuntimeAssessor = buildGoRuntime();
