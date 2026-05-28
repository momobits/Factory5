/**
 * Tests for the ADR 0017 provisioning behaviour in the pytest runner:
 *   (a) .venv detection
 *   (b) requires-python version selection + demotion to PATH python
 *   (c) install step is run before pytest
 *   (d) install failure surfaces as provisioning.installOk=false, and the
 *       gate.build computation flips to false regardless of pytest's own
 *       exit code.
 *   (e) ensureAssessorVenv (Phase 5f / I006) — factory-managed per-project
 *       venv creation + reuse, with graceful fallback semantics.
 *
 * Every test uses the injected deps surface on `pickPython` / `runPytest` /
 * `ensureAssessorVenv` so no real subprocess is spawned and no filesystem
 * state beyond tmpdir is mutated.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { initLogger } from '@factory5/logger';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { computeGateResults } from '../assess.js';
import type { SubprocessResult } from '../run.js';
import {
  ensureAssessorVenv,
  extractMinimumPythonVersion,
  pickPython,
  runPytest,
  venvSatisfiesConstraint,
  type EnsureAssessorVenvDeps,
  type PickPythonDeps,
  type PythonChoice,
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
// venvSatisfiesConstraint
// ---------------------------------------------------------------------------

describe('venvSatisfiesConstraint', () => {
  it('passes when venv major.minor equals required', () => {
    expect(venvSatisfiesConstraint('3.11.9', '3.11')).toBe(true);
    expect(venvSatisfiesConstraint('3.11.0', '3.11')).toBe(true);
  });

  it('passes when venv major.minor is greater than required', () => {
    expect(venvSatisfiesConstraint('3.12.0', '3.11')).toBe(true);
    expect(venvSatisfiesConstraint('3.13.5', '3.11')).toBe(true);
    expect(venvSatisfiesConstraint('4.0.0', '3.11')).toBe(true);
  });

  it('fails when venv major.minor is less than required', () => {
    expect(venvSatisfiesConstraint('3.10.5', '3.11')).toBe(false);
    expect(venvSatisfiesConstraint('3.9.0', '3.12')).toBe(false);
    expect(venvSatisfiesConstraint('2.7.18', '3.0')).toBe(false);
  });

  it('returns false for malformed inputs (safe default)', () => {
    expect(venvSatisfiesConstraint('', '3.11')).toBe(false);
    expect(venvSatisfiesConstraint('3.11.9', '')).toBe(false);
    expect(venvSatisfiesConstraint('not-a-version', '3.11')).toBe(false);
    expect(venvSatisfiesConstraint('3.11.9', 'not-a-version')).toBe(false);
  });

  it('accepts major.minor format without patch', () => {
    expect(venvSatisfiesConstraint('3.11', '3.11')).toBe(true);
    expect(venvSatisfiesConstraint('3.11', '3.12')).toBe(false);
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
        reason: '.venv detected',
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
        reason: '.venv detected',
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
        reason: '.venv detected',
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
        reason: '.venv detected',
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
// ensureAssessorVenv — Phase 5f (I006) per-project isolated venv
// ---------------------------------------------------------------------------

function systemPick(overrides: Partial<PythonChoice> = {}): PythonChoice {
  return {
    bin: 'C:\\Windows\\py.exe',
    prefixArgs: ['-3.11'] as readonly string[],
    version: '3.11.9',
    reason: 'requires-python=>=3.11 → py -3.11',
    ...overrides,
  };
}

function venvPick(bin: string): PythonChoice {
  return { bin, prefixArgs: [], version: '3.11.9', reason: '.venv detected' };
}

describe('ensureAssessorVenv', () => {
  it('reuses a pre-existing project .venv without creating an assessor-env', async () => {
    const projectVenv = '/proj/.venv/bin/python';
    let spawnCount = 0;
    const deps: EnsureAssessorVenvDeps = {
      platform: 'linux',
      fileExists: async () => true,
      runSubprocess: async () => {
        spawnCount += 1;
        return { stdout: '', stderr: '', exitCode: 0, durationMs: 1 };
      },
      probe: async () => '3.11.9',
    };
    const result = await ensureAssessorVenv('/proj', venvPick(projectVenv), deps);
    expect(result.venvSource).toBe('project');
    expect(result.bin).toBe(projectVenv);
    expect(result.prefixArgs).toEqual([]);
    // Project .venv short-circuits before touching the factory dir.
    expect(spawnCount).toBe(0);
  });

  it('creates .factory/assessor-env/ via `python -m venv` when no project venv (Unix)', async () => {
    const expected = join('/proj', '.factory', 'assessor-env', 'bin', 'python');
    const spawnCalls: { bin: string; args: readonly string[] }[] = [];
    const existsAfter = new Set<string>();
    const deps: EnsureAssessorVenvDeps = {
      platform: 'linux',
      fileExists: async (p) => existsAfter.has(p),
      runSubprocess: async (bin, args) => {
        spawnCalls.push({ bin, args: [...args] });
        if (args.includes('venv')) existsAfter.add(expected);
        return { stdout: '', stderr: '', exitCode: 0, durationMs: 10 };
      },
      probe: async () => '3.11.9',
    };
    const result = await ensureAssessorVenv('/proj', systemPick(), deps);
    expect(result.venvSource).toBe('factory-managed');
    expect(result.bin).toBe(expected);
    expect(result.prefixArgs).toEqual([]);
    expect(spawnCalls.length).toBe(1);
    const createCall = spawnCalls[0];
    expect(createCall).toBeDefined();
    if (createCall !== undefined) {
      expect(createCall.bin).toBe('C:\\Windows\\py.exe');
      expect(createCall.args.slice(0, 3)).toEqual(['-3.11', '-m', 'venv']);
      // Target path = <projectPath>/.factory/assessor-env
      expect(createCall.args[3]).toBe(join('/proj', '.factory', 'assessor-env'));
    }
  });

  it('uses the Windows Scripts/python.exe path layout', async () => {
    const projectPath = 'C:\\proj';
    const expected = join(projectPath, '.factory', 'assessor-env', 'Scripts', 'python.exe');
    const existsAfter = new Set<string>();
    const deps: EnsureAssessorVenvDeps = {
      platform: 'win32',
      fileExists: async (p) => existsAfter.has(p),
      runSubprocess: async (_bin, args) => {
        if (args.includes('venv')) existsAfter.add(expected);
        return { stdout: '', stderr: '', exitCode: 0, durationMs: 10 };
      },
      probe: async () => '3.11.9',
    };
    const result = await ensureAssessorVenv(projectPath, systemPick(), deps);
    expect(result.venvSource).toBe('factory-managed');
    expect(result.bin).toBe(expected);
  });

  it('reuses an existing .factory/assessor-env/ interpreter without spawning', async () => {
    const expected = join('/proj', '.factory', 'assessor-env', 'bin', 'python');
    let spawnCount = 0;
    const deps: EnsureAssessorVenvDeps = {
      platform: 'linux',
      // The venv interpreter is already present from a prior assess call.
      fileExists: async (p) => p === expected,
      runSubprocess: async () => {
        spawnCount += 1;
        return { stdout: '', stderr: '', exitCode: 0, durationMs: 0 };
      },
      probe: async () => '3.11.9',
    };
    const result = await ensureAssessorVenv('/proj', systemPick(), deps);
    expect(result.venvSource).toBe('factory-managed');
    expect(result.bin).toBe(expected);
    expect(result.reason).toContain('reused');
    expect(spawnCount).toBe(0);
  });

  it('recreates the venv when stored interpreter no longer satisfies requires-python', async () => {
    const envPath = join('/proj', '.factory', 'assessor-env');
    const interpreterPath = join(envPath, 'bin', 'python');
    const existing = new Set<string>([interpreterPath]);
    let rmCalls = 0;
    const spawnCalls: { bin: string; args: readonly string[] }[] = [];
    const deps: EnsureAssessorVenvDeps = {
      platform: 'linux',
      fileExists: async (p) => existing.has(p),
      // Existing venv has Python 3.10; project now requires >=3.12 → STALE.
      probe: async () => '3.10.5',
      readTextFile: async (p) =>
        p.endsWith('pyproject.toml')
          ? '[project]\nname = "x"\nrequires-python = ">=3.12"\n'
          : undefined,
      rmDir: async (p) => {
        rmCalls += 1;
        expect(p).toBe(envPath);
        existing.delete(interpreterPath);
      },
      runSubprocess: async (bin, args) => {
        spawnCalls.push({ bin, args: [...args] });
        if (args.includes('venv')) existing.add(interpreterPath);
        return { stdout: '', stderr: '', exitCode: 0, durationMs: 10 };
      },
    };
    const result = await ensureAssessorVenv('/proj', systemPick(), deps);
    expect(rmCalls).toBe(1);
    expect(spawnCalls.length).toBe(1);
    expect(spawnCalls[0]?.args).toContain('venv');
    expect(result.venvSource).toBe('factory-managed');
    expect(result.reason).toContain('created');
  });

  it('keeps the existing venv when it still satisfies requires-python', async () => {
    const interpreterPath = join('/proj', '.factory', 'assessor-env', 'bin', 'python');
    let rmCalls = 0;
    let spawnCount = 0;
    const deps: EnsureAssessorVenvDeps = {
      platform: 'linux',
      fileExists: async (p) => p === interpreterPath,
      // 3.11.9 satisfies >=3.11 → reuse, no rm, no spawn.
      probe: async () => '3.11.9',
      readTextFile: async (p) =>
        p.endsWith('pyproject.toml')
          ? '[project]\nname = "x"\nrequires-python = ">=3.11"\n'
          : undefined,
      rmDir: async () => {
        rmCalls += 1;
      },
      runSubprocess: async () => {
        spawnCount += 1;
        return { stdout: '', stderr: '', exitCode: 0, durationMs: 0 };
      },
    };
    const result = await ensureAssessorVenv('/proj', systemPick(), deps);
    expect(rmCalls).toBe(0);
    expect(spawnCount).toBe(0);
    expect(result.reason).toContain('reused');
  });

  it('reuses the venv when pyproject.toml has no requires-python constraint', async () => {
    const interpreterPath = join('/proj', '.factory', 'assessor-env', 'bin', 'python');
    let rmCalls = 0;
    const deps: EnsureAssessorVenvDeps = {
      platform: 'linux',
      fileExists: async (p) => p === interpreterPath,
      // No constraint → staleness check can't decide → trust the cached venv.
      probe: async () => '3.10.5',
      readTextFile: async () => '[project]\nname = "x"\n',
      rmDir: async () => {
        rmCalls += 1;
      },
      runSubprocess: async () => ({ stdout: '', stderr: '', exitCode: 0, durationMs: 0 }),
    };
    const result = await ensureAssessorVenv('/proj', systemPick(), deps);
    expect(rmCalls).toBe(0);
    expect(result.reason).toContain('reused');
  });

  it('falls through to system base interpreter when venv creation fails and virtualenv is absent', async () => {
    const base = systemPick();
    const deps: EnsureAssessorVenvDeps = {
      platform: 'linux',
      fileExists: async () => false,
      runSubprocess: async () => ({
        stdout: '',
        stderr: 'Error: ensurepip is not available',
        exitCode: 1,
        durationMs: 5,
      }),
      probe: async () => '3.11.9',
      resolveOnPath: async () => undefined,
    };
    const result = await ensureAssessorVenv('/proj', base, deps);
    expect(result.venvSource).toBe('system');
    expect(result.bin).toBe(base.bin);
    expect(result.prefixArgs).toEqual(base.prefixArgs);
  });

  it('uses virtualenv fallback when `python -m venv` fails but virtualenv is on PATH', async () => {
    const expected = join('/proj', '.factory', 'assessor-env', 'bin', 'python');
    const spawnCalls: { bin: string; args: readonly string[] }[] = [];
    const existsAfter = new Set<string>();
    const deps: EnsureAssessorVenvDeps = {
      platform: 'linux',
      fileExists: async (p) => existsAfter.has(p),
      runSubprocess: async (bin, args) => {
        spawnCalls.push({ bin, args: [...args] });
        if (bin === '/usr/bin/virtualenv') {
          existsAfter.add(expected);
          return { stdout: '', stderr: '', exitCode: 0, durationMs: 10 };
        }
        // `python -m venv` leg fails.
        return { stdout: '', stderr: 'no ensurepip', exitCode: 1, durationMs: 5 };
      },
      probe: async () => '3.11.9',
      resolveOnPath: async (name) => (name === 'virtualenv' ? '/usr/bin/virtualenv' : undefined),
    };
    const result = await ensureAssessorVenv('/proj', systemPick(), deps);
    expect(result.venvSource).toBe('factory-managed');
    expect(result.bin).toBe(expected);
    // Two spawns: `-m venv` then virtualenv.
    expect(spawnCalls.length).toBe(2);
    expect(spawnCalls[1]?.bin).toBe('/usr/bin/virtualenv');
  });
});

// ---------------------------------------------------------------------------
// provisionAssessorEnv — end-to-end wiring (pickPython → ensureAssessorVenv →
// pip install). Exercises the full runPytest provisioning path without
// bypassing ensureAssessorVenv.
// ---------------------------------------------------------------------------

describe('provisionAssessorEnv wires ensureAssessorVenv', () => {
  let projectDir: string;

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), 'factory5-provision-'));
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

  it('installs via the factory-managed venv interpreter when no project .venv exists', async () => {
    const venvPython =
      process.platform === 'win32'
        ? join(projectDir, '.factory', 'assessor-env', 'Scripts', 'python.exe')
        : join(projectDir, '.factory', 'assessor-env', 'bin', 'python');
    const deps: RunPytestDeps = {
      // Base pick: system-interpreter (not a project venv) — forces the
      // factory-managed branch of ensureAssessorVenv.
      pickPython: async () => ({
        bin: '/usr/bin/python3.11',
        prefixArgs: [],
        version: '3.11.9',
        reason: 'requires-python=>=3.11 → python3.11',
      }),
      ensureAssessorVenv: async () => ({
        bin: venvPython,
        prefixArgs: [],
        version: '3.11.9',
        reason: '.factory/assessor-env created',
        venvSource: 'factory-managed',
      }),
      hasPyproject: async () => true,
      pyprojectHasTestExtra: async () => false,
      fileExists: async () => true,
      runSubprocess: async (bin, args) => {
        if (args.includes('pytest')) return okExit('1 passed in 0.01s\n');
        return okExit();
      },
    };
    const result = await runPytest(projectDir, {}, deps);
    expect(result.provisioning?.venvSource).toBe('factory-managed');
    expect(result.provisioning?.pythonPath).toBe(venvPython);
    expect(result.provisioning?.installOk).toBe(true);
  });

  it('propagates venvSource=project when the ensured venv is the user .venv', async () => {
    const projectVenv = '/proj/.venv/bin/python';
    const deps: RunPytestDeps = {
      pickPython: async () => ({
        bin: projectVenv,
        prefixArgs: [],
        version: '3.11.9',
        reason: '.venv detected',
      }),
      hasPyproject: async () => true,
      pyprojectHasTestExtra: async () => false,
      fileExists: async () => true,
      runSubprocess: async (_bin, args) => {
        if (args.includes('pytest')) return okExit('1 passed in 0.01s\n');
        return okExit();
      },
    };
    const result = await runPytest(projectDir, {}, deps);
    expect(result.provisioning?.venvSource).toBe('project');
    expect(result.provisioning?.pythonPath).toBe(projectVenv);
  });
});

// ---------------------------------------------------------------------------
// computeGateResults — gate.build must flip when install fails, regardless of
// pytest's own exit code.
// ---------------------------------------------------------------------------

describe('computeGateResults + provisioning', () => {
  // Post ADR-0026: `computeGateResults` takes a `RuntimeGateResult` slice
  // rather than splitting tests/imports/provisioning into separate args.
  // The runtime is now responsible for computing `buildOk` (and mapping
  // install-failure → buildOk=false internally); `computeGateResults`
  // just composes the three gate booleans from that slice + artifacts.
  const passingRuntime = {
    buildOk: true,
    testsAvailable: true,
    testsPassed: 1,
    testsFailed: 0,
    testsErrors: 0,
  };
  const modules = { existing: 1, missing: [] as string[] };
  const artifacts = {
    readme: true,
    license: true,
    gitignore: true,
    architecture: true,
    gitClean: true,
  };

  it('gate.build is true when the runtime reports buildOk + tests pass', () => {
    const result = computeGateResults(passingRuntime, modules, artifacts);
    expect(result.build).toBe(true);
    expect(result.verify).toBe(true);
  });

  it('gate.build is false when the runtime reports buildOk=false (e.g. install failed)', () => {
    const result = computeGateResults({ ...passingRuntime, buildOk: false }, modules, artifacts);
    expect(result.build).toBe(false);
    expect(result.verify).toBe(false);
  });

  it('gate.build is true when tests are unavailable (no-tests path still builds)', () => {
    const result = computeGateResults(
      { buildOk: true, testsAvailable: false, testsPassed: 0, testsFailed: 0, testsErrors: 0 },
      modules,
      artifacts,
    );
    expect(result.build).toBe(true);
    // verify remains false because integration is false (no tests available)
    expect(result.integration).toBe(false);
  });
});
