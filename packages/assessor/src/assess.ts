/**
 * Top-level `assess()` — runs every ground-truth check and returns a single
 * {@link AssessResult}. No LLM, no inference — only real subprocesses and
 * real file reads.
 *
 * Designed so the brain's verifier agent reads this and decides: ship, iterate,
 * or escalate.
 *
 * ADR 0017: when tests are requested, provision the assessor env once
 * (pickPython + `pip install -e .[test]`) and share the chosen interpreter
 * with both pytest and the imports check so the two runners agree on gate
 * outcomes.
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
import { checkPythonImports } from './runners/imports.js';
import { provisionAssessorEnv, runPytest, type AssessorEnv } from './runners/pytest.js';
import type { AssessOptions, AssessResult } from './types.js';

const log = createLogger('assessor');

/**
 * Pure computation of the three gate booleans. Exported for unit-testing the
 * gate semantics (especially the ADR 0017 install-failure → gate.build=false
 * rule) without spinning up a real Python subprocess.
 */
export function computeGateResults(
  tests: { passed: number; failed: number; errors: number; available: boolean },
  imports: { ok: boolean },
  modules: { existing: number; missing: string[] },
  artifacts: {
    readme: boolean;
    license: boolean;
    gitignore: boolean;
    architecture: boolean;
    gitClean: boolean;
  },
  provisioning: AssessResult['provisioning'],
): AssessResult['gateResults'] {
  // gate.build requires that deps installed cleanly when we have a
  // provisioning record. Install failure means the built project's
  // dependency layer is broken regardless of whether the (stdlib-only)
  // imports happen to succeed.
  const installOk = provisioning === undefined || provisioning.installOk;
  const build = modules.missing.length === 0 && imports.ok && installOk;
  const integration =
    tests.available && tests.failed === 0 && tests.errors === 0 && tests.passed > 0;
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

export async function assess(opts: AssessOptions): Promise<AssessResult> {
  const { projectPath } = opts;
  const expected = opts.expectedModules ?? [];
  const framework = opts.testFramework ?? 'auto';

  log.info({ projectPath, expectedModules: expected.length, framework }, 'assess: starting');

  // File-system only checks — run in parallel, cheap.
  const [modules, readme, license, gitignore, architecture, gitClean] = await Promise.all([
    checkModules(projectPath, expected),
    checkReadme(projectPath),
    checkLicense(projectPath),
    checkGitignore(projectPath),
    checkArchitectureDoc(projectPath),
    checkGitClean(projectPath),
  ]);

  // ADR 0017: pick interpreter and run install ONCE, share across pytest +
  // imports runners. When `testFramework: 'none'` we skip provisioning (no
  // pip install on runs that won't invoke pytest).
  let env: AssessorEnv | undefined;
  if (framework !== 'none') {
    const provisionOpts: { pythonBin?: string } = {};
    if (opts.pythonBin !== undefined) provisionOpts.pythonBin = opts.pythonBin;
    env = await provisionAssessorEnv(projectPath, provisionOpts);
  }

  // Imports check uses the shared interpreter post-install, so
  // third-party-dep imports actually resolve.
  const importsOpts: {
    pythonBin?: string;
    timeoutMs?: number;
    interpreter?: AssessorEnv['choice'];
  } = {};
  if (env !== undefined) importsOpts.interpreter = env.choice;
  if (opts.pythonBin !== undefined) importsOpts.pythonBin = opts.pythonBin;
  if (opts.runnerTimeoutMs !== undefined) importsOpts.timeoutMs = opts.runnerTimeoutMs;
  const imports = await checkPythonImports(projectPath, expected, importsOpts);

  let tests:
    | { available: boolean; passed: number; failed: number; errors: number; framework: string }
    | undefined;
  let provisioning: AssessResult['provisioning'];
  if (framework === 'none') {
    tests = { available: false, passed: 0, failed: 0, errors: 0, framework: 'none' };
  } else {
    const pytestOpts: {
      pythonBin?: string;
      timeoutMs?: number;
      env?: AssessorEnv;
    } = {};
    if (env !== undefined) pytestOpts.env = env;
    if (opts.pythonBin !== undefined) pytestOpts.pythonBin = opts.pythonBin;
    if (opts.runnerTimeoutMs !== undefined) pytestOpts.timeoutMs = opts.runnerTimeoutMs;
    const r = await runPytest(projectPath, pytestOpts);
    tests = {
      available: r.available,
      passed: r.passed,
      failed: r.failed,
      errors: r.errors,
      framework: r.available ? 'pytest' : 'none',
    };
    if (r.provisioning !== undefined) provisioning = r.provisioning;
  }

  const importErrors = imports.details
    .filter((d) => !d.ok)
    .map((d) => `${d.module}: ${d.error ?? 'unknown error'}`);

  const result: AssessResult = {
    modulesExisting: modules.existing,
    modulesMissing: modules.missing,
    testsPassed: tests.passed,
    testsFailed: tests.failed,
    testsErrors: tests.errors,
    testFramework: tests.framework,
    importsOk: imports.ok,
    importErrors,
    hasReadme: readme,
    hasLicense: license,
    hasGitignore: gitignore,
    hasArchitecture: architecture,
    gitClean,
    gateResults: computeGateResults(
      tests,
      imports,
      modules,
      { readme, license, gitignore, architecture, gitClean },
      provisioning,
    ),
    ...(provisioning !== undefined ? { provisioning } : {}),
  };

  log.info(
    {
      projectPath,
      gate: result.gateResults,
      testsPassed: result.testsPassed,
      testsFailed: result.testsFailed,
      importErrors: result.importErrors.slice(0, 5),
      ...(result.provisioning !== undefined
        ? {
            provisioning: {
              pythonPath: result.provisioning.pythonPath,
              pythonVersion: result.provisioning.pythonVersion,
              installOk: result.provisioning.installOk,
              venvSource: result.provisioning.venvSource,
            },
          }
        : {}),
    },
    'assess: complete',
  );

  return result;
}
