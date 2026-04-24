/**
 * Node/TypeScript runtime — env-assuming provisioner (ADR 0026 §1).
 *
 * Gate pipeline (ADR 0026 §2):
 *   1. Preflight — `pnpm install --frozen-lockfile` (drops `--frozen-lockfile`
 *      when no `pnpm-lock.yaml` is present, matching the ADR's fresh-scaffold
 *      edge case). Failure ⇒ `ENV_SETUP_FAILURE`.
 *   2. Build — `pnpm typecheck` when the `typecheck` script is declared in
 *      `package.json`, else `pnpm exec tsc --noEmit`. Failure ⇒ `BUILD_FAILURE`.
 *   3. Test — `pnpm test`. Output is parsed against vitest / jest / node:test
 *      summary shapes. Any non-zero counts on `failed` / `errors` or any
 *      non-zero exit code with tests present ⇒ `TEST_FAILURE`.
 *
 * No factory-managed env layer: `node_modules/` is the project's own artifact
 * and `pnpm-store/` (content-addressed) is pnpm-global. Mirroring Python's
 * `.factory/assessor-env/` here would duplicate pnpm's own deduplication.
 */

import { readFile } from 'node:fs/promises';
import { platform as processPlatform } from 'node:process';

import { createLogger } from '@factory5/logger';

import { resolveOnPath, runSubprocess, type SubprocessResult } from '../run.js';
import type {
  ProvisioningRecord,
  RuntimeAssessor,
  RuntimeGateOptions,
  RuntimeGateResult,
} from '../types.js';

const log = createLogger('assessor.node');

// ---------------------------------------------------------------------------
// Summary parsing
// ---------------------------------------------------------------------------

interface TestCounts {
  passed: number;
  failed: number;
  errors: number;
}

/**
 * Parse test summary output — covers vitest, jest, and node:test in that
 * priority. First match wins; all three runners produce stable banner lines
 * we can regex. Returns zeros when nothing parses — the caller then relies
 * on exit code alone.
 */
export function parseNodeTestSummary(stdout: string): TestCounts {
  const counts: TestCounts = { passed: 0, failed: 0, errors: 0 };
  const text = stdout.replace(/\x1b\[[0-9;]*m/g, ''); // strip ANSI
  const lines = text.split(/\r?\n/);

  // Vitest: "      Tests  12 passed (12)" / "      Tests  2 failed | 12 passed (14)"
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i] ?? '';
    if (!/\bTests\b/.test(line)) continue;
    const passed = /(\d+)\s+passed/.exec(line);
    const failed = /(\d+)\s+failed/.exec(line);
    const errors = /(\d+)\s+(errored|errors?)/i.exec(line);
    if (passed !== null || failed !== null || errors !== null) {
      if (passed !== null) counts.passed = Number(passed[1]);
      if (failed !== null) counts.failed = Number(failed[1]);
      if (errors !== null) counts.errors = Number(errors[1]);
      return counts;
    }
  }

  // Jest: "Tests:       2 failed, 12 passed, 14 total"
  for (const line of lines) {
    const m = /^Tests:\s+(.+?)\s+total/.exec(line.trim());
    if (m === null) continue;
    const segment = m[1] ?? '';
    const passed = /(\d+)\s+passed/.exec(segment);
    const failed = /(\d+)\s+failed/.exec(segment);
    if (passed !== null) counts.passed = Number(passed[1]);
    if (failed !== null) counts.failed = Number(failed[1]);
    return counts;
  }

  // node:test TAP: "# pass 14" / "# fail 0"
  let sawTap = false;
  for (const line of lines) {
    const pass = /^#\s+pass\s+(\d+)/.exec(line);
    const fail = /^#\s+fail\s+(\d+)/.exec(line);
    if (pass !== null) {
      counts.passed = Number(pass[1]);
      sawTap = true;
    } else if (fail !== null) {
      counts.failed = Number(fail[1]);
      sawTap = true;
    }
  }
  if (sawTap) return counts;

  return counts;
}

// ---------------------------------------------------------------------------
// package.json helpers
// ---------------------------------------------------------------------------

interface PackageJsonShape {
  scripts?: Record<string, string>;
  devDependencies?: Record<string, string>;
  dependencies?: Record<string, string>;
}

async function readPackageJson(projectPath: string): Promise<PackageJsonShape | undefined> {
  try {
    const raw = await readFile(`${projectPath}/package.json`, 'utf8');
    return JSON.parse(raw) as PackageJsonShape;
  } catch {
    return undefined;
  }
}

async function hasLockfile(projectPath: string): Promise<boolean> {
  try {
    await readFile(`${projectPath}/pnpm-lock.yaml`, 'utf8');
    return true;
  } catch {
    return false;
  }
}

function detectFramework(pkg: PackageJsonShape | undefined): string {
  const deps = { ...pkg?.devDependencies, ...pkg?.dependencies };
  if (deps['vitest'] !== undefined) return 'vitest';
  if (deps['jest'] !== undefined) return 'jest';
  if (deps['mocha'] !== undefined) return 'mocha';
  const script = pkg?.scripts?.['test'] ?? '';
  if (/\bnode\s+--test\b/.test(script)) return 'node:test';
  if (/\bvitest\b/.test(script)) return 'vitest';
  if (/\bjest\b/.test(script)) return 'jest';
  return 'unknown';
}

function firstWordVersion(s: string): string {
  const trimmed = s.trim().split(/\s+/)[0];
  return trimmed ?? '';
}

function tailLines(s: string, n: number): string {
  const lines = s.split(/\r?\n/);
  return lines.slice(-n).join('\n');
}

// ---------------------------------------------------------------------------
// Runtime
// ---------------------------------------------------------------------------

/**
 * Testing seam: all IO is defaulted to the real subprocess / fs helpers; unit
 * tests replace the defaults so we never spawn real pnpm / tsc during the
 * assessor's own test suite. The integration test under `test/node-e2e.test.ts`
 * exercises the real path against a seeded tmpdir project.
 */
export interface NodeRuntimeDeps {
  runSubprocess?: (
    bin: string,
    args: readonly string[],
    opts?: { cwd?: string; timeoutMs?: number; env?: Record<string, string> },
  ) => Promise<SubprocessResult>;
  resolveOnPath?: (name: string) => Promise<string | undefined>;
  readPackageJson?: (projectPath: string) => Promise<PackageJsonShape | undefined>;
  hasLockfile?: (projectPath: string) => Promise<boolean>;
  platform?: NodeJS.Platform;
}

function resolveDeps(override: NodeRuntimeDeps): Required<NodeRuntimeDeps> {
  return {
    runSubprocess: override.runSubprocess ?? runSubprocess,
    resolveOnPath: override.resolveOnPath ?? resolveOnPath,
    readPackageJson: override.readPackageJson ?? readPackageJson,
    hasLockfile: override.hasLockfile ?? hasLockfile,
    platform: override.platform ?? processPlatform,
  };
}

async function probeVersion(
  bin: string,
  deps: Required<NodeRuntimeDeps>,
  timeoutMs: number,
): Promise<string> {
  try {
    const res = await deps.runSubprocess(bin, ['--version'], { timeoutMs: 10_000 });
    if (res.exitCode === 0) return firstWordVersion(res.stdout || res.stderr);
  } catch {
    /* probe failures fall through */
  }
  log.debug({ bin, timeoutMs }, 'probeVersion: failed, returning empty version');
  return '';
}

export function buildNodeRuntime(depsOverride: NodeRuntimeDeps = {}): RuntimeAssessor {
  return {
    runtime: 'node',
    hostTools: [
      {
        bin: 'node',
        kind: 'interpreter',
        installHint: 'Install Node 20+ from https://nodejs.org',
      },
      {
        bin: 'pnpm',
        kind: 'pkg-manager',
        installHint: 'Enable via `corepack enable` (Node 20+) or install from https://pnpm.io',
      },
    ],

    async runGate(projectPath: string, opts: RuntimeGateOptions): Promise<RuntimeGateResult> {
      const deps = resolveDeps(depsOverride);
      const runnerTimeout = opts.runnerTimeoutMs ?? 120_000;

      const pkg = await deps.readPackageJson(projectPath);
      if (pkg === undefined) {
        log.warn({ projectPath }, 'node.runGate: package.json missing or unparseable');
        return {
          testFramework: 'none',
          testsAvailable: false,
          testsPassed: 0,
          testsFailed: 0,
          testsErrors: 0,
          buildOk: false,
          importErrors: [],
          importsOk: false,
          failureMode: 'BUILD_FAILURE',
        };
      }

      const pnpmBin = await deps.resolveOnPath('pnpm');
      const nodeBin = await deps.resolveOnPath('node');
      // Host-tool pre-flight runs in `assess()` before we get here, but a
      // concurrent PATH mutation could race; bail cleanly.
      if (pnpmBin === undefined || nodeBin === undefined) {
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

      const pnpmVersion = await probeVersion(pnpmBin, deps, 10_000);
      const nodeVersion = await probeVersion(nodeBin, deps, 10_000);
      log.info(
        { projectPath, pnpmBin, pnpmVersion, nodeBin, nodeVersion },
        'node.runGate: toolchain resolved',
      );

      // --- Preflight: pnpm install --- -----------------------------------
      const frozen = await deps.hasLockfile(projectPath);
      const installArgs = frozen ? ['install', '--frozen-lockfile'] : ['install'];
      log.info({ projectPath, frozen }, `node.runGate: pnpm ${installArgs.join(' ')}`);
      const installStarted = Date.now();
      const installRes = await deps.runSubprocess(pnpmBin, installArgs, {
        cwd: projectPath,
        timeoutMs: 300_000,
      });
      const installOk = installRes.exitCode === 0;
      const preflightCommand = `pnpm ${installArgs.join(' ')}`;
      log.info(
        { projectPath, exitCode: installRes.exitCode, durationMs: Date.now() - installStarted },
        installOk ? 'node.runGate: preflight complete' : 'node.runGate: preflight failed',
      );

      const provisioning: ProvisioningRecord = {
        runtime: 'node',
        toolPath: pnpmBin,
        toolVersion: pnpmVersion,
        preflight: {
          command: preflightCommand,
          ok: installOk,
          ...(installOk
            ? {}
            : { summary: tailLines(`${installRes.stdout}\n${installRes.stderr}`, 40) }),
        },
      };

      if (!installOk) {
        return {
          testFramework: 'none',
          testsAvailable: false,
          testsPassed: 0,
          testsFailed: 0,
          testsErrors: 0,
          buildOk: false,
          importErrors: [],
          importsOk: false,
          provisioning,
          failureMode: 'ENV_SETUP_FAILURE',
        };
      }

      // --- Build: typecheck --- ------------------------------------------
      const hasTypecheckScript = pkg.scripts?.['typecheck'] !== undefined;
      const buildArgs = hasTypecheckScript ? ['typecheck'] : ['exec', 'tsc', '--noEmit'];
      log.info({ projectPath, hasTypecheckScript }, `node.runGate: pnpm ${buildArgs.join(' ')}`);
      const buildRes = await deps.runSubprocess(pnpmBin, buildArgs, {
        cwd: projectPath,
        timeoutMs: runnerTimeout,
      });
      const buildOk = buildRes.exitCode === 0;
      log.info(
        { projectPath, exitCode: buildRes.exitCode, buildOk },
        buildOk ? 'node.runGate: build passed' : 'node.runGate: build failed',
      );

      if (!buildOk) {
        return {
          testFramework: detectFramework(pkg),
          testsAvailable: false,
          testsPassed: 0,
          testsFailed: 0,
          testsErrors: 0,
          buildOk: false,
          importErrors: [],
          importsOk: false,
          provisioning,
          failureMode: 'BUILD_FAILURE',
        };
      }

      // --- Test: pnpm test --- -------------------------------------------
      const framework = detectFramework(pkg);
      const hasTestScript = pkg.scripts?.['test'] !== undefined;
      if (!hasTestScript) {
        log.info({ projectPath }, 'node.runGate: no test script; integration gate will be false');
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

      const testStarted = Date.now();
      const testRes = await deps.runSubprocess(pnpmBin, ['test'], {
        cwd: projectPath,
        timeoutMs: runnerTimeout,
      });
      const counts = parseNodeTestSummary(testRes.stdout + '\n' + testRes.stderr);
      const testsAvailable = counts.passed + counts.failed + counts.errors > 0;
      const clean = testRes.exitCode === 0 && counts.failed === 0 && counts.errors === 0;
      log.info(
        {
          projectPath,
          exitCode: testRes.exitCode,
          framework,
          durationMs: Date.now() - testStarted,
          ...counts,
        },
        clean ? 'node.runGate: tests passed' : 'node.runGate: tests failed',
      );

      let failureMode: RuntimeGateResult['failureMode'];
      if (!testsAvailable && testRes.exitCode !== 0) {
        // Test script ran but we couldn't parse any counts and the exit was
        // non-zero — best evidence is a test-infrastructure error rather than
        // a clean build. Attribute as TEST_FAILURE.
        failureMode = 'TEST_FAILURE';
      } else if (!clean) {
        failureMode = 'TEST_FAILURE';
      }

      return {
        testFramework: testsAvailable ? framework : 'none',
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
export const nodeRuntime: RuntimeAssessor = buildNodeRuntime();
