/**
 * Python runtime — env-owning provisioner (ADR 0017 / 0026).
 *
 * Adapter over the pre-ADR-0026 runners (`runners/pytest.ts` + `runners/imports.ts`).
 * Composition:
 *   1. `provisionAssessorEnv` picks an interpreter, ensures a venv
 *      (`<project>/.venv` → `.factory/assessor-env/` → system fallback),
 *      and runs `pip install -e .[test]` (or `-e .`).
 *   2. `checkPythonImports` probes each expected module via the chosen
 *      interpreter.
 *   3. `runPytest` executes the test suite and parses the summary line.
 *
 * Translates the legacy `ProvisioningReport` (Python-shaped: `pythonPath`,
 * `pythonVersion`, `venvSource`) into the runtime-neutral
 * {@link ProvisioningRecord} surfaced on `AssessResult`.
 *
 * Host-tool declaration is empty because `pickPython` handles multi-bin
 * fallback internally (`python` / `python3` / `py -X.Y`); a missing
 * interpreter surfaces as `failureMode: 'ENV_HOST_MISSING_TOOL'` from this
 * module, not from the generic `assess()` pre-flight.
 */

import { createLogger } from '@factory5/logger';

import { checkPythonImports } from '../runners/imports.js';
import {
  provisionAssessorEnv,
  runPytest,
  type AssessorEnv,
  type ProvisioningReport,
} from '../runners/pytest.js';
import type {
  ProvisioningRecord,
  RuntimeAssessor,
  RuntimeGateOptions,
  RuntimeGateResult,
} from '../types.js';

const log = createLogger('assessor.python');

function toProvisioningRecord(r: ProvisioningReport): ProvisioningRecord {
  return {
    runtime: 'python',
    toolPath: r.pythonPath,
    toolVersion: r.pythonVersion,
    installOk: r.installOk,
    ...(r.installSummary !== undefined ? { installSummary: r.installSummary } : {}),
    envSource: r.venvSource,
  };
}

export const pythonRuntime: RuntimeAssessor = {
  runtime: 'python',
  // Python's interpreter picker walks `.venv` → `py -X.Y` → `python` / `python3`
  // on its own. Declaring a specific host tool here would short-circuit that
  // fallback; a missing interpreter surfaces via the gate result below.
  hostTools: [],

  async runGate(projectPath: string, opts: RuntimeGateOptions): Promise<RuntimeGateResult> {
    const expected = opts.expectedModules ?? [];

    // ADR 0017: one pickPython + install pass, shared with imports + pytest.
    const provisionOpts: { pythonBin?: string } = {};
    if (opts.pythonBin !== undefined) provisionOpts.pythonBin = opts.pythonBin;
    let env: AssessorEnv | undefined;
    try {
      env = await provisionAssessorEnv(projectPath, provisionOpts);
    } catch (err) {
      log.warn({ projectPath, err: String(err) }, 'python.runGate: provisionAssessorEnv threw');
      env = undefined;
    }

    // pickPython returns undefined when no interpreter at all is resolvable.
    // That's the Python-equivalent of `ENV_HOST_MISSING_TOOL`.
    if (env === undefined) {
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

    const provisioning = toProvisioningRecord(env.provisioning);

    // Imports check uses the shared post-install interpreter, so third-party
    // deps declared in pyproject.toml or requirements.txt actually resolve.
    const importsOpts: {
      pythonBin?: string;
      timeoutMs?: number;
      interpreter?: AssessorEnv['choice'];
    } = { interpreter: env.choice };
    if (opts.pythonBin !== undefined) importsOpts.pythonBin = opts.pythonBin;
    if (opts.runnerTimeoutMs !== undefined) importsOpts.timeoutMs = opts.runnerTimeoutMs;
    const imports = await checkPythonImports(projectPath, expected, importsOpts);
    const importErrors = imports.details
      .filter((d) => !d.ok)
      .map((d) => `${d.module}: ${d.error ?? 'unknown error'}`);

    // pytest itself.
    const pytestOpts: {
      pythonBin?: string;
      timeoutMs?: number;
      env?: AssessorEnv;
    } = { env };
    if (opts.pythonBin !== undefined) pytestOpts.pythonBin = opts.pythonBin;
    if (opts.runnerTimeoutMs !== undefined) pytestOpts.timeoutMs = opts.runnerTimeoutMs;
    const r = await runPytest(projectPath, pytestOpts);

    // Failure-mode precedence (ADR 0026 §3). Host-missing is impossible here
    // (we already returned above); install failure takes precedence over
    // build/test because the env must be healthy before compile/imports
    // outcomes are meaningful.
    let failureMode: RuntimeGateResult['failureMode'];
    if (provisioning.installOk === false) {
      failureMode = 'ENV_SETUP_FAILURE';
    } else if (!imports.ok) {
      failureMode = 'BUILD_FAILURE';
    } else if (r.available && (r.failed > 0 || r.errors > 0)) {
      failureMode = 'TEST_FAILURE';
    }

    const result: RuntimeGateResult = {
      testFramework: r.available ? 'pytest' : 'none',
      testsAvailable: r.available,
      testsPassed: r.passed,
      testsFailed: r.failed,
      testsErrors: r.errors,
      buildOk: imports.ok && provisioning.installOk !== false,
      importErrors,
      importsOk: imports.ok,
      provisioning,
      ...(failureMode !== undefined ? { failureMode } : {}),
    };
    return result;
  },
};
