/**
 * Top-level `assess()` — runs every ground-truth check and returns a single
 * {@link AssessResult}. No LLM, no inference — only real subprocesses and
 * real file reads.
 *
 * Designed so the brain's verifier agent reads this and decides: ship, iterate,
 * or escalate.
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
import { runPytest } from './runners/pytest.js';
import type { AssessOptions, AssessResult } from './types.js';

const log = createLogger('assessor');

function buildGateResults(
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
): AssessResult['gateResults'] {
  const build = modules.missing.length === 0 && imports.ok;
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

  const [modules, imports, readme, license, gitignore, architecture, gitClean] = await Promise.all([
    checkModules(projectPath, expected),
    checkPythonImports(projectPath, expected, {
      ...(opts.pythonBin !== undefined ? { pythonBin: opts.pythonBin } : {}),
      ...(opts.runnerTimeoutMs !== undefined ? { timeoutMs: opts.runnerTimeoutMs } : {}),
    }),
    checkReadme(projectPath),
    checkLicense(projectPath),
    checkGitignore(projectPath),
    checkArchitectureDoc(projectPath),
    checkGitClean(projectPath),
  ]);

  let tests:
    | { available: boolean; passed: number; failed: number; errors: number; framework: string }
    | undefined;
  if (framework === 'none') {
    tests = { available: false, passed: 0, failed: 0, errors: 0, framework: 'none' };
  } else {
    const r = await runPytest(projectPath, {
      ...(opts.pythonBin !== undefined ? { pythonBin: opts.pythonBin } : {}),
      ...(opts.runnerTimeoutMs !== undefined ? { timeoutMs: opts.runnerTimeoutMs } : {}),
    });
    tests = {
      available: r.available,
      passed: r.passed,
      failed: r.failed,
      errors: r.errors,
      framework: r.available ? 'pytest' : 'none',
    };
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
    gateResults: buildGateResults(tests, imports, modules, {
      readme,
      license,
      gitignore,
      architecture,
      gitClean,
    }),
  };

  log.info(
    {
      projectPath,
      gate: result.gateResults,
      testsPassed: result.testsPassed,
      testsFailed: result.testsFailed,
    },
    'assess: complete',
  );

  return result;
}
