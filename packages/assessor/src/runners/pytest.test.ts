/**
 * Tests for the ADR 0017 provisioning behaviour in the pytest runner:
 *   (a) .venv detection
 *   (b) requires-python version selection + demotion to PATH python
 *   (c) install step is run before pytest
 *   (d) install failure surfaces as provisioning.installOk=false, and the
 *       gate.build computation flips to false regardless of pytest's own
 *       exit code.
 *
 * Every test uses the injected deps surface on `pickPython` / `runPytest`
 * so no real subprocess is spawned and no filesystem state beyond tmpdir
 * is mutated.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { initLogger } from '@factory5/logger';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { computeGateResults } from '../assess.js';
import type { SubprocessResult } from '../run.js';
import {
  extractMinimumPythonVersion,
  pickPython,
  runPytest,
  type PickPythonDeps,
  type RunPytestDeps,
} from './pytest.js';

beforeAll(() => {
  initLogger({ processName: 'pytest-runner-test', noFile: true, noConsole: true });
});

// ---------------------------------------------------------------------------
// extractMinimumPythonVersion
// ---------------------------------------------------------------------------

describe('extractMinimumPythonVersion', () => {
  it('parses >= constraints with and without a range cap', () => {
    expect(extractMinimumPythonVersion('>=3.11')).toBe('3.11');
    expect(extractMinimumPythonVersion('>=3.11,<3.13')).toBe('3.11');
    expect(extractMinimumPythonVersion('>= 3.11')).toBe('3.11');
  });

  it('parses poetry ^, pep-440 ~=, and == constraints', () => {
    expect(extractMinimumPythonVersion('^3.11')).toBe('3.11');
    expect(extractMinimumPythonVersion('~=3.11.2')).toBe('3.11');
    expect(extractMinimumPythonVersion('==3.11')).toBe('3.11');
  });

  it('returns undefined when no recognised constraint is present', () => {
    expect(extractMinimumPythonVersion('whatever')).toBeUndefined();
    expect(extractMinimumPythonVersion('')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// pickPython
// ---------------------------------------------------------------------------

function fakeDeps(overrides: PickPythonDeps = {}): PickPythonDeps {
  return {
    platform: overrides.platform ?? 'linux',
    fileExists: overrides.fileExists ?? (async () => false),
    readTextFile: overrides.readTextFile ?? (async () => undefined),
    resolveOnPath: overrides.resolveOnPath ?? (async () => undefined),
    probe: overrides.probe ?? (async () => undefined),
  };
}

describe('pickPython', () => {
  it('prefers a project-local .venv over PATH python (Windows)', async () => {
    const expected = join('C:\\project', '.venv', 'Scripts', 'python.exe');
    const deps = fakeDeps({
      platform: 'win32',
      fileExists: async (p) => p === expected,
      probe: async (bin) => (bin === expected ? '3.11.9' : undefined),
    });
    const result = await pickPython('C:\\project', {}, deps);
    expect(result).toBeDefined();
    expect(result?.bin).toBe(expected);
    expect(result?.prefixArgs).toEqual([]);
    expect(result?.version).toBe('3.11.9');
    expect(result?.reason).toBe('.venv detected');
  });

  it('prefers a project-local .venv over PATH python (Unix)', async () => {
    const expected = join('/tmp/project', '.venv', 'bin', 'python');
    const deps = fakeDeps({
      platform: 'linux',
      fileExists: async (p) => p === expected,
      probe: async (bin) => (bin === expected ? '3.11.9' : undefined),
    });
    const result = await pickPython('/tmp/project', {}, deps);
    expect(result?.bin).toBe(expected);
    expect(result?.reason).toBe('.venv detected');
  });

  it('picks py -3.11 when pyproject requests >=3.11 and py -3.11 probes ok (Windows)', async () => {
    const deps = fakeDeps({
      platform: 'win32',
      readTextFile: async (p) =>
        p.endsWith('pyproject.toml') ? '[project]\nrequires-python = ">=3.11"\n' : undefined,
      resolveOnPath: async (name) => (name === 'py' ? 'C:\\Windows\\py.exe' : undefined),
      probe: async (bin, prefixArgs) => {
        if (bin === 'C:\\Windows\\py.exe' && prefixArgs[0] === '-3.11') return '3.11.9';
        return undefined;
      },
    });
    const result = await pickPython('C:\\project', {}, deps);
    expect(result?.bin).toBe('C:\\Windows\\py.exe');
    expect(result?.prefixArgs).toEqual(['-3.11']);
    expect(result?.version).toBe('3.11.9');
    expect(result?.demoted).toBeUndefined();
    expect(result?.reason).toContain('requires-python');
  });

  it('picks python3.11 when pyproject requests >=3.11 (Unix)', async () => {
    const deps = fakeDeps({
      platform: 'linux',
      readTextFile: async (p) =>
        p.endsWith('pyproject.toml') ? '[project]\nrequires-python = ">=3.11"\n' : undefined,
      resolveOnPath: async (name) => (name === 'python3.11' ? '/usr/bin/python3.11' : undefined),
      probe: async (bin) => (bin === '/usr/bin/python3.11' ? '3.11.9' : undefined),
    });
    const result = await pickPython('/tmp/project', {}, deps);
    expect(result?.bin).toBe('/usr/bin/python3.11');
    expect(result?.prefixArgs).toEqual([]);
    expect(result?.demoted).toBeUndefined();
  });

  it('demotes to PATH python (with warn) when requested version is unavailable', async () => {
    const deps = fakeDeps({
      platform: 'win32',
      readTextFile: async (p) =>
        p.endsWith('pyproject.toml') ? '[project]\nrequires-python = ">=3.11"\n' : undefined,
      resolveOnPath: async (name) => {
        if (name === 'py') return 'C:\\Windows\\py.exe';
        if (name === 'python') return 'C:\\Python310\\python.exe';
        return undefined;
      },
      probe: async (bin, prefixArgs) => {
        // py -3.11 unavailable
        if (bin === 'C:\\Windows\\py.exe' && prefixArgs[0] === '-3.11') return undefined;
        // PATH python is 3.10
        if (bin === 'C:\\Python310\\python.exe') return '3.10.6';
        return undefined;
      },
    });
    const result = await pickPython('C:\\project', {}, deps);
    expect(result?.bin).toBe('C:\\Python310\\python.exe');
    expect(result?.prefixArgs).toEqual([]);
    expect(result?.version).toBe('3.10.6');
    expect(result?.demoted).toEqual({ requestedVersion: '3.11' });
    expect(result?.reason).toContain('demoted');
  });

  it('returns undefined when nothing is available', async () => {
    const deps = fakeDeps({
      platform: 'linux',
    });
    const result = await pickPython('/tmp/project', {}, deps);
    expect(result).toBeUndefined();
  });

  it('honours opts.pythonBin override without probing other candidates', async () => {
    const deps = fakeDeps({
      platform: 'linux',
      probe: async (bin) => (bin === '/custom/py' ? '3.12.1' : undefined),
    });
    const result = await pickPython('/tmp/project', { pythonBin: '/custom/py' }, deps);
    expect(result?.bin).toBe('/custom/py');
    expect(result?.reason).toBe('opts.pythonBin');
  });
});

// ---------------------------------------------------------------------------
// runPytest — provisioning
// ---------------------------------------------------------------------------

function okExit(stdout = '', stderr = ''): SubprocessResult {
  return { stdout, stderr, exitCode: 0, durationMs: 5 };
}

function failExit(stderr: string): SubprocessResult {
  return { stdout: '', stderr, exitCode: 1, durationMs: 5 };
}

describe('runPytest provisioning', () => {
  let projectDir: string;

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), 'factory5-pytest-'));
    await mkdir(join(projectDir, 'tests'));
    await writeFile(join(projectDir, 'tests', 'test_stub.py'), '# placeholder\n');
    await writeFile(
      join(projectDir, 'pyproject.toml'),
      '[project]\nname = "p"\nversion = "0.1.0"\nrequires-python = ">=3.11"\n',
    );
  });

  afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true });
  });

  it('runs `pip install -e .` before invoking pytest', async () => {
    const calls: { bin: string; args: readonly string[] }[] = [];
    const deps: RunPytestDeps = {
      pickPython: async () => ({
        bin: '/usr/bin/python3.11',
        prefixArgs: [],
        version: '3.11.9',
        reason: 'test stub',
      }),
      hasPyproject: async () => true,
      pyprojectHasTestExtra: async () => false,
      fileExists: async () => true,
      runSubprocess: async (bin, args) => {
        calls.push({ bin, args: [...args] });
        if (args.includes('pytest')) return okExit('3 passed in 0.01s\n');
        return okExit();
      },
    };
    const result = await runPytest(projectDir, {}, deps);
    expect(calls.length).toBeGreaterThanOrEqual(2);
    expect(calls[0]?.args).toContain('pip');
    expect(calls[0]?.args).toContain('install');
    expect(calls[0]?.args).toContain('-e');
    expect(calls[0]?.args).toContain('.');
    const pytestCallIdx = calls.findIndex((c) => c.args.includes('pytest'));
    expect(pytestCallIdx).toBeGreaterThan(0);
    expect(result.provisioning?.installOk).toBe(true);
    expect(result.provisioning?.pythonPath).toBe('/usr/bin/python3.11');
    expect(result.provisioning?.pythonVersion).toBe('3.11.9');
    expect(result.passed).toBe(3);
  });

  it('invokes `-e .[test]` when pyproject declares an optional test extra', async () => {
    const calls: { bin: string; args: readonly string[] }[] = [];
    const deps: RunPytestDeps = {
      pickPython: async () => ({
        bin: '/usr/bin/python3.11',
        prefixArgs: [],
        version: '3.11.9',
        reason: 'test stub',
      }),
      hasPyproject: async () => true,
      pyprojectHasTestExtra: async () => true,
      fileExists: async () => true,
      runSubprocess: async (bin, args) => {
        calls.push({ bin, args: [...args] });
        if (args.includes('pytest')) return okExit('0 passed in 0.01s\n');
        return okExit();
      },
    };
    await runPytest(projectDir, {}, deps);
    expect(calls[0]?.args).toContain('.[test]');
  });

  it('falls back to `-e .` when `-e .[test]` fails', async () => {
    const calls: { bin: string; args: readonly string[] }[] = [];
    const deps: RunPytestDeps = {
      pickPython: async () => ({
        bin: '/usr/bin/python3.11',
        prefixArgs: [],
        version: '3.11.9',
        reason: 'test stub',
      }),
      hasPyproject: async () => true,
      pyprojectHasTestExtra: async () => true,
      fileExists: async () => true,
      runSubprocess: async (bin, args) => {
        calls.push({ bin, args: [...args] });
        if (args.includes('pytest')) return okExit('2 passed in 0.01s\n');
        if (args.includes('.[test]')) return failExit('ERROR: extra "test" not found\n');
        return okExit();
      },
    };
    const result = await runPytest(projectDir, {}, deps);
    const installCalls = calls.filter((c) => c.args.includes('install'));
    expect(installCalls.length).toBe(2);
    expect(installCalls[0]?.args).toContain('.[test]');
    expect(installCalls[1]?.args).toContain('.');
    expect(result.provisioning?.installOk).toBe(true);
  });

  it('surfaces install failure as provisioning.installOk=false with captured tail', async () => {
    const deps: RunPytestDeps = {
      pickPython: async () => ({
        bin: '/usr/bin/python3.11',
        prefixArgs: [],
        version: '3.11.9',
        reason: 'test stub',
      }),
      hasPyproject: async () => true,
      pyprojectHasTestExtra: async () => false,
      fileExists: async () => true,
      runSubprocess: async (_bin, args) => {
        if (args.includes('install'))
          return failExit(
            Array.from({ length: 60 }, (_, i) => `ERROR line ${String(i)}`).join('\n') + '\n',
          );
        // pytest call — with nothing installed it would exit 5 (no tests collected)
        return { stdout: '', stderr: '', exitCode: 5, durationMs: 5 };
      },
    };
    const result = await runPytest(projectDir, {}, deps);
    expect(result.provisioning?.installOk).toBe(false);
    expect(result.provisioning?.installSummary).toBeDefined();
    const summaryLines = result.provisioning?.installSummary?.split('\n') ?? [];
    // Keep the tail bounded at 40 lines
    expect(summaryLines.length).toBeLessThanOrEqual(41);
  });
});

// ---------------------------------------------------------------------------
// computeGateResults — gate.build must flip when install fails, regardless of
// pytest's own exit code.
// ---------------------------------------------------------------------------

describe('computeGateResults + provisioning', () => {
  const passingTests = { passed: 1, failed: 0, errors: 0, available: true };
  const imports = { ok: true };
  const modules = { existing: 1, missing: [] as string[] };
  const artifacts = {
    readme: true,
    license: true,
    gitignore: true,
    architecture: true,
    gitClean: true,
  };

  it('gate.build is true when install succeeded', () => {
    const result = computeGateResults(passingTests, imports, modules, artifacts, {
      pythonPath: '/usr/bin/python3.11',
      pythonVersion: '3.11.9',
      installOk: true,
    });
    expect(result.build).toBe(true);
    expect(result.verify).toBe(true);
  });

  it('gate.build is false when install failed even if imports happen to pass', () => {
    const result = computeGateResults(passingTests, imports, modules, artifacts, {
      pythonPath: '/usr/bin/python3.11',
      pythonVersion: '3.11.9',
      installOk: false,
      installSummary: 'ERROR: Could not install',
    });
    expect(result.build).toBe(false);
    expect(result.verify).toBe(false);
  });

  it('gate.build is true when provisioning is absent (no-tests path)', () => {
    const result = computeGateResults(
      { passed: 0, failed: 0, errors: 0, available: false },
      imports,
      modules,
      artifacts,
      undefined,
    );
    expect(result.build).toBe(true);
    // verify remains false because integration is false (no tests available)
    expect(result.integration).toBe(false);
  });
});
