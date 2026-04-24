/**
 * Rust runtime — env-assuming provisioner (ADR 0026 §1 / §2).
 *
 * Gate pipeline:
 *   1. Host-tool pre-flight ensures `cargo` resolves (done in `assess()`).
 *   2. No preflight — `cargo` manages `$CARGO_HOME/registry` + `target/`
 *      transparently. No factory-managed env layer (ADR 0026 §1 "why").
 *   3. Build + Test — `cargo test`. The single command compiles then runs
 *      the test binary, so ADR 0026 §2's "build command subsumed by test"
 *      holds. Outcome distinguished by output shape:
 *        - Non-zero exit AND no `test result:` line ⇒ `BUILD_FAILURE`
 *          (compile didn't reach test execution).
 *        - Non-zero exit AND any `failed` count > 0 ⇒ `TEST_FAILURE`.
 *        - Zero exit with `passed` counts parsed ⇒ green.
 *
 * Summary parser aggregates across multiple `test result:` lines (cargo
 * emits one per binary target — unit tests + integration tests + doc
 * tests each produce their own).
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

const log = createLogger('assessor.rust');

// ---------------------------------------------------------------------------
// Summary parsing
// ---------------------------------------------------------------------------

interface TestCounts {
  passed: number;
  failed: number;
  errors: number;
}

interface CargoSummary extends TestCounts {
  /** Did at least one `test result:` line appear? Used to distinguish BUILD vs TEST failure. */
  sawResult: boolean;
}

/**
 * Parse `cargo test` output. Each test target emits a line of the shape
 * `test result: ok. N passed; M failed; K ignored; L measured; F filtered out; ...`
 * (the `ok.` flips to `FAILED.` on any non-zero `failed` count). Multiple
 * lines appear when the crate has unit + integration + doc tests; we
 * aggregate across them.
 */
export function parseCargoTestSummary(stdout: string): CargoSummary {
  const counts: CargoSummary = { passed: 0, failed: 0, errors: 0, sawResult: false };
  const lines = stdout.split(/\r?\n/);
  for (const line of lines) {
    const m =
      /test result:\s*(?:ok|FAILED)\.\s*(\d+)\s+passed;\s*(\d+)\s+failed(?:;\s*(\d+)\s+ignored)?/.exec(
        line,
      );
    if (m === null) continue;
    counts.sawResult = true;
    counts.passed += Number(m[1]);
    counts.failed += Number(m[2]);
  }
  return counts;
}

function tailLines(s: string, n: number): string {
  const lines = s.split(/\r?\n/);
  return lines.slice(-n).join('\n');
}

function firstWordVersion(s: string): string {
  // `cargo --version` prints e.g. `cargo 1.77.2 (abcdef 2024-03-01)`.
  const trimmed = s.trim().split(/\s+/).slice(0, 2).join(' ');
  return trimmed;
}

// ---------------------------------------------------------------------------
// Runtime
// ---------------------------------------------------------------------------

/** Testing seam — unit tests replace these so no real `cargo` spawns. */
export interface RustRuntimeDeps {
  runSubprocess?: (
    bin: string,
    args: readonly string[],
    opts?: { cwd?: string; timeoutMs?: number; env?: Record<string, string> },
  ) => Promise<SubprocessResult>;
  resolveOnPath?: (name: string) => Promise<string | undefined>;
  platform?: NodeJS.Platform;
}

function resolveDeps(override: RustRuntimeDeps): Required<RustRuntimeDeps> {
  return {
    runSubprocess: override.runSubprocess ?? runSubprocess,
    resolveOnPath: override.resolveOnPath ?? resolveOnPath,
    platform: override.platform ?? processPlatform,
  };
}

async function probeCargoVersion(
  cargoBin: string,
  deps: Required<RustRuntimeDeps>,
): Promise<string> {
  try {
    const res = await deps.runSubprocess(cargoBin, ['--version'], { timeoutMs: 10_000 });
    if (res.exitCode === 0) return firstWordVersion(res.stdout);
  } catch {
    /* probe failures fall through */
  }
  return '';
}

export function buildRustRuntime(depsOverride: RustRuntimeDeps = {}): RuntimeAssessor {
  return {
    runtime: 'rust',
    hostTools: [
      {
        bin: 'cargo',
        kind: 'toolchain',
        installHint: 'Install Rust via https://rustup.rs/ (ships cargo)',
      },
    ],

    async runGate(projectPath: string, opts: RuntimeGateOptions): Promise<RuntimeGateResult> {
      const deps = resolveDeps(depsOverride);
      const runnerTimeout = opts.runnerTimeoutMs ?? 180_000;

      const cargoBin = await deps.resolveOnPath('cargo');
      if (cargoBin === undefined) {
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

      const cargoVersion = await probeCargoVersion(cargoBin, deps);
      log.info({ projectPath, cargoBin, cargoVersion }, 'rust.runGate: toolchain resolved');

      const provisioning: ProvisioningRecord = {
        runtime: 'rust',
        toolPath: cargoBin,
        toolVersion: cargoVersion,
      };

      // --- Build + Test: cargo test ---------------------------------
      log.info({ projectPath }, 'rust.runGate: cargo test');
      const testStarted = Date.now();
      const testRes = await deps.runSubprocess(cargoBin, ['test'], {
        cwd: projectPath,
        timeoutMs: runnerTimeout,
      });
      const summary = parseCargoTestSummary(testRes.stdout + '\n' + testRes.stderr);
      const buildOk = summary.sawResult; // at least one test-result line ⇒ compile reached test execution
      log.info(
        {
          projectPath,
          exitCode: testRes.exitCode,
          durationMs: Date.now() - testStarted,
          passed: summary.passed,
          failed: summary.failed,
          sawResult: summary.sawResult,
        },
        buildOk && summary.failed === 0 && testRes.exitCode === 0
          ? 'rust.runGate: tests passed'
          : buildOk
            ? 'rust.runGate: tests failed'
            : 'rust.runGate: build failed',
      );

      if (!buildOk) {
        return {
          testFramework: 'cargo-test',
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
              command: 'cargo test',
              ok: false,
              summary: tailLines(`${testRes.stdout}\n${testRes.stderr}`, 40),
            },
          },
          failureMode: 'BUILD_FAILURE',
        };
      }

      const testsAvailable = summary.passed + summary.failed > 0;
      const clean = testRes.exitCode === 0 && summary.failed === 0;
      let failureMode: RuntimeGateResult['failureMode'];
      if (!clean) failureMode = 'TEST_FAILURE';

      return {
        testFramework: 'cargo-test',
        testsAvailable,
        testsPassed: summary.passed,
        testsFailed: summary.failed,
        testsErrors: summary.errors,
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
export const rustRuntime: RuntimeAssessor = buildRustRuntime();
