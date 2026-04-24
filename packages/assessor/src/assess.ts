/**
 * Top-level `assess()` — runs every ground-truth check and returns a single
 * {@link AssessResult}. No LLM, no inference — only real subprocesses and
 * real file reads.
 *
 * ADR 0026 (Phase 10): language-pluggable. `AssessOptions.runtime` selects
 * a registered {@link RuntimeAssessor}; the runtime's `hostTools` are
 * pre-flighted via `resolveOnPath`; then its `runGate` produces the
 * runtime-specific slice of the result. Artifact / module / git checks
 * stay runtime-neutral in this file.
 */

import { createLogger } from '@factory5/logger';

import {
  checkArchitectureDoc,
  checkGitClean,
  checkGitignore,
  checkLicense,
  checkModules,
  checkReadme,
} from './artifacts.js';
import { resolveOnPath } from './run.js';
import { goRuntime } from './runtimes/go.js';
import { nodeRuntime } from './runtimes/node.js';
import { pythonRuntime } from './runtimes/python.js';
import type {
  AssessOptions,
  AssessResult,
  FailureMode,
  ProvisioningRecord,
  Runtime,
  RuntimeAssessor,
  RuntimeGateResult,
} from './types.js';

const log = createLogger('assessor');

const RUNTIMES: Partial<Record<Runtime, RuntimeAssessor>> = {
  python: pythonRuntime,
  node: nodeRuntime,
  go: goRuntime,
  // 'rust' lands in 10.6.
};

/**
 * Registered runtime for a given language. Exported so tests can assert the
 * dispatch table and (if needed) swap runtimes in unit tests.
 */
export function getRuntime(runtime: Runtime): RuntimeAssessor | undefined {
  return RUNTIMES[runtime];
}

/**
 * Pure computation of the three gate booleans. `assess()` composes every
 * runtime's `RuntimeGateResult` with the artifact checks before calling this.
 * Kept separate so the gate semantics stay unit-testable without spawning
 * subprocesses.
 *
 * Gate semantics:
 *   - `build` — source built + (env-owning runtimes) install succeeded + modules present
 *   - `integration` — tests ran and all passed (requires at least one test)
 *   - `verify` — build && integration && every artifact check is green && git clean
 */
export function computeGateResults(
  runtimeResult: Pick<
    RuntimeGateResult,
    'buildOk' | 'testsAvailable' | 'testsPassed' | 'testsFailed' | 'testsErrors'
  >,
  modules: { existing: number; missing: string[] },
  artifacts: {
    readme: boolean;
    license: boolean;
    gitignore: boolean;
    architecture: boolean;
    gitClean: boolean;
  },
): AssessResult['gateResults'] {
  const build = modules.missing.length === 0 && runtimeResult.buildOk;
  const integration =
    runtimeResult.testsAvailable &&
    runtimeResult.testsFailed === 0 &&
    runtimeResult.testsErrors === 0 &&
    runtimeResult.testsPassed > 0;
  const verify =
    build &&
    integration &&
    artifacts.readme &&
    artifacts.license &&
    artifacts.gitignore &&
    artifacts.architecture &&
    artifacts.gitClean;
  return { build, integration, verify };
}

/**
 * Probe each of the runtime's declared `hostTools` via `resolveOnPath`. Returns
 * the first missing tool, or `undefined` when every tool resolves. Python's
 * empty `hostTools` list makes this a no-op for that runtime.
 */
async function preflightHostTools(
  runtime: RuntimeAssessor,
): Promise<{ bin: string; installHint: string } | undefined> {
  for (const tool of runtime.hostTools) {
    const resolved = await resolveOnPath(tool.bin);
    if (resolved === undefined) {
      return { bin: tool.bin, installHint: tool.installHint };
    }
  }
  return undefined;
}

function hostMissingResult(
  runtime: Runtime,
  modules: { existing: number; missing: string[] },
  artifacts: {
    readme: boolean;
    license: boolean;
    gitignore: boolean;
    architecture: boolean;
    gitClean: boolean;
  },
): AssessResult {
  return {
    runtime,
    failureMode: 'ENV_HOST_MISSING_TOOL',
    modulesExisting: modules.existing,
    modulesMissing: modules.missing,
    testsPassed: 0,
    testsFailed: 0,
    testsErrors: 0,
    testFramework: 'none',
    importsOk: false,
    importErrors: [],
    hasReadme: artifacts.readme,
    hasLicense: artifacts.license,
    hasGitignore: artifacts.gitignore,
    hasArchitecture: artifacts.architecture,
    gitClean: artifacts.gitClean,
    gateResults: { build: false, integration: false, verify: false },
  };
}

export async function assess(opts: AssessOptions): Promise<AssessResult> {
  const { projectPath } = opts;
  const expected = opts.expectedModules ?? [];
  const framework = opts.testFramework ?? 'auto';
  const runtimeName: Runtime = opts.runtime ?? 'python';

  log.info(
    { projectPath, expectedModules: expected.length, framework, runtime: runtimeName },
    'assess: starting',
  );

  const runtime = getRuntime(runtimeName);
  if (runtime === undefined) {
    throw new Error(`assess: runtime '${runtimeName}' is not registered`);
  }

  // File-system only checks — run in parallel, cheap, runtime-agnostic.
  const [modules, readme, license, gitignore, architecture, gitClean] = await Promise.all([
    checkModules(projectPath, expected),
    checkReadme(projectPath),
    checkLicense(projectPath),
    checkGitignore(projectPath),
    checkArchitectureDoc(projectPath),
    checkGitClean(projectPath),
  ]);
  const artifacts = { readme, license, gitignore, architecture, gitClean };

  // Host-tool pre-flight (ADR 0026 §4). Short-circuits with
  // ENV_HOST_MISSING_TOOL before any project-subprocess spawn attempt.
  const missing = await preflightHostTools(runtime);
  if (missing !== undefined) {
    log.warn(
      { projectPath, runtime: runtimeName, missingTool: missing.bin, hint: missing.installHint },
      'assess: host tool missing; short-circuiting with ENV_HOST_MISSING_TOOL',
    );
    return hostMissingResult(runtimeName, modules, artifacts);
  }

  // `testFramework: 'none'` skips the runtime entirely — artifact-only pass.
  let runtimeResult: RuntimeGateResult;
  if (framework === 'none') {
    runtimeResult = {
      testFramework: 'none',
      testsAvailable: false,
      testsPassed: 0,
      testsFailed: 0,
      testsErrors: 0,
      buildOk: true,
      importErrors: [],
      importsOk: true,
    };
  } else {
    const gateOpts: {
      expectedModules?: readonly string[];
      runnerTimeoutMs?: number;
      pythonBin?: string;
    } = { expectedModules: expected };
    if (opts.runnerTimeoutMs !== undefined) gateOpts.runnerTimeoutMs = opts.runnerTimeoutMs;
    if (opts.pythonBin !== undefined) gateOpts.pythonBin = opts.pythonBin;
    runtimeResult = await runtime.runGate(projectPath, gateOpts);
  }

  const gateResults = computeGateResults(runtimeResult, modules, artifacts);

  // Failure-mode precedence: the runtime decides its own cause (ENV_SETUP /
  // BUILD / TEST); `assess()` only supplies ENV_HOST_MISSING_TOOL, which was
  // handled above. Artifact-only failures do not set failureMode — they flip
  // `gate.verify` but the primary build+test slice is fine.
  let failureMode: FailureMode | undefined = runtimeResult.failureMode;
  if (failureMode === undefined && !gateResults.build && modules.missing.length > 0) {
    // Modules missing on disk is a build-side failure even when the runtime's
    // own signal came back clean (e.g. a pure-diagnostic `testFramework: 'none'`).
    failureMode = 'BUILD_FAILURE';
  }

  const provisioning: ProvisioningRecord | undefined = runtimeResult.provisioning;

  const result: AssessResult = {
    runtime: runtimeName,
    ...(failureMode !== undefined ? { failureMode } : {}),
    modulesExisting: modules.existing,
    modulesMissing: modules.missing,
    testsPassed: runtimeResult.testsPassed,
    testsFailed: runtimeResult.testsFailed,
    testsErrors: runtimeResult.testsErrors,
    testFramework: runtimeResult.testFramework,
    importsOk: runtimeResult.importsOk,
    importErrors: [...runtimeResult.importErrors],
    hasReadme: readme,
    hasLicense: license,
    hasGitignore: gitignore,
    hasArchitecture: architecture,
    gitClean,
    gateResults,
    ...(provisioning !== undefined ? { provisioning } : {}),
  };

  log.info(
    {
      projectPath,
      runtime: runtimeName,
      gate: result.gateResults,
      testsPassed: result.testsPassed,
      testsFailed: result.testsFailed,
      importErrors: result.importErrors.slice(0, 5),
      ...(failureMode !== undefined ? { failureMode } : {}),
      ...(provisioning !== undefined
        ? {
            provisioning: {
              toolPath: provisioning.toolPath,
              toolVersion: provisioning.toolVersion,
              ...(provisioning.installOk !== undefined
                ? { installOk: provisioning.installOk }
                : {}),
              ...(provisioning.envSource !== undefined
                ? { envSource: provisioning.envSource }
                : {}),
              ...(provisioning.preflight !== undefined
                ? {
                    preflight: {
                      command: provisioning.preflight.command,
                      ok: provisioning.preflight.ok,
                    },
                  }
                : {}),
            },
          }
        : {}),
    },
    'assess: complete',
  );

  return result;
}
