/**
 * pytest runner — invoked via `python -m pytest` with JSON-lite parsing of
 * the terminal summary line. We avoid adding `pytest-json-report` as a
 * required plugin and just parse pytest's stock terminal output.
 *
 * Two summary-line shapes are produced by pytest depending on mode:
 *   - banner (default / on failure):
 *       "===== 5 passed, 2 failed, 1 error in 0.42s ====="
 *   - bare (`-q` clean run):
 *       "33 passed in 0.07s"
 * Both are matched.
 *
 * ADR 0017 (Phase 5c): before invoking pytest we provision the interpreter
 * (preferring a project-local .venv, then an interpreter matching the
 * project's `requires-python` constraint, then PATH `python`) and run
 * `python -m pip install -e .[test]` so the built project's own dependencies
 * are on the import path.
 *
 * ADR 0017 Implementation Notes (Phase 5f, I006): the install site is always
 * a venv. Precedence: project `.venv/` → `<projectPath>/.factory/assessor-env/`
 * → base interpreter (fallback, logged warn). {@link ensureAssessorVenv}
 * sits between {@link pickPython} and the install step so `pip install -e .`
 * can no longer land in the user's site-packages and poison sibling
 * factory workspaces.
 */

import { constants as fsConstants } from 'node:fs';
import { access, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { platform as processPlatform } from 'node:process';

import { createLogger } from '@factory5/logger';
import { parse as parseToml } from 'smol-toml';

import { resolveOnPath, runSubprocess, type SubprocessResult } from '../run.js';

const log = createLogger('assessor.pytest');

// ---------------------------------------------------------------------------
// Summary parsing
// ---------------------------------------------------------------------------

function parseSummary(stdout: string): {
  passed: number;
  failed: number;
  errors: number;
  skipped: number;
} {
  const result = { passed: 0, failed: 0, errors: 0, skipped: 0 };
  // Match the last `... in Xs ...` line whether it has a `=====` banner or not.
  // `-q` mode emits a bare line: "33 passed in 0.07s"; default/failed runs
  // emit a banner: "========== 5 passed, 2 failed in 0.42s ==========".
  const all = stdout.split(/\r?\n/);
  let countsPart = '';
  for (let i = all.length - 1; i >= 0; i--) {
    const line = (all[i] ?? '').trim();
    if (line.length === 0) continue;
    const m = /^=*\s*(.*?)\s+in\s+[\d.]+s(?:\s*=*\s*)?$/.exec(line);
    if (m !== null) {
      countsPart = (m[1] ?? '').trim();
      break;
    }
  }
  if (countsPart.length === 0) return result;
  const parts = countsPart.split(',').map((p) => p.trim());
  for (const part of parts) {
    const m = /^(\d+)\s+(passed|failed|error|errors|skipped)/i.exec(part);
    if (m === null) continue;
    const n = Number(m[1]);
    const kind = (m[2] ?? '').toLowerCase();
    if (kind.startsWith('pass')) result.passed += n;
    else if (kind.startsWith('fail')) result.failed += n;
    else if (kind.startsWith('error')) result.errors += n;
    else if (kind.startsWith('skip')) result.skipped += n;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Python selection (ADR 0017)
// ---------------------------------------------------------------------------

/**
 * Extract the minimum Python version from a `requires-python` constraint.
 *
 * Examples:
 *   `">=3.11"`       -> `"3.11"`
 *   `">=3.11,<3.13"` -> `"3.11"`
 *   `"~=3.11.2"`     -> `"3.11"`
 *   `"^3.11"`        -> `"3.11"`
 *   `"==3.11"`       -> `"3.11"`
 *
 * Returns undefined for constraints we can't parse — the caller falls back
 * to PATH python and the warn log records it.
 */
export function extractMinimumPythonVersion(requires: string): string | undefined {
  const m = /(?:>=|~=|\^|==)\s*(\d+)\.(\d+)/.exec(requires);
  if (m === null) return undefined;
  const major = m[1];
  const minor = m[2];
  if (major === undefined || minor === undefined) return undefined;
  return `${major}.${minor}`;
}

/**
 * Check whether an installed Python version satisfies a minimum
 * `requires-python` constraint.
 *
 * @param venvVersion - The probed version from a venv interpreter, e.g.
 *   `"3.11.9"` (full triple) or `"3.11"` (major.minor only).
 * @param requiredMin - The minimum version extracted from the project's
 *   `requires-python` constraint via {@link extractMinimumPythonVersion},
 *   e.g. `"3.11"`.
 * @returns `true` if venv's major.minor is >= required's major.minor.
 *   Returns `false` for malformed inputs (safe default — caller falls
 *   through to recreate the venv rather than trust an unparseable version).
 */
export function venvSatisfiesConstraint(venvVersion: string, requiredMin: string): boolean {
  const venvMatch = /^(\d+)\.(\d+)/.exec(venvVersion);
  const requiredMatch = /^(\d+)\.(\d+)/.exec(requiredMin);
  if (venvMatch === null || requiredMatch === null) return false;
  const venvMajor = Number(venvMatch[1]);
  const venvMinor = Number(venvMatch[2]);
  const reqMajor = Number(requiredMatch[1]);
  const reqMinor = Number(requiredMatch[2]);
  if (venvMajor !== reqMajor) return venvMajor > reqMajor;
  return venvMinor >= reqMinor;
}

export interface PythonChoice {
  /** Binary to spawn. */
  bin: string;
  /** Args to prepend to every invocation (e.g. `['-3.11']` for the Windows `py` launcher). */
  prefixArgs: readonly string[];
  /** Version reported by `<bin> <prefixArgs> --version` (e.g. `3.11.9`), empty if probe was skipped or failed. */
  version: string;
  /** Human-readable reason this interpreter was chosen. */
  reason: string;
  /** Set when we requested a specific version but had to fall back to PATH python. */
  demoted?: { requestedVersion: string };
}

/**
 * Testing seam for {@link pickPython}. In production every field uses its
 * real IO default; tests inject fakes so no subprocess is spawned and no
 * file has to be mutated on disk.
 */
export interface PickPythonDeps {
  /** Probe an interpreter with `--version`. Return its version or undefined. */
  probe?: (bin: string, prefixArgs: readonly string[]) => Promise<string | undefined>;
  /** Resolve a name on PATH, as in {@link resolveOnPath}. */
  resolveOnPath?: (name: string) => Promise<string | undefined>;
  /** Check whether a file path exists. */
  fileExists?: (p: string) => Promise<boolean>;
  /** Read a file path as utf8, returning undefined on any error. */
  readTextFile?: (p: string) => Promise<string | undefined>;
  /** Override `process.platform`. Defaults to the real value. */
  platform?: NodeJS.Platform;
}

async function defaultFileExists(p: string): Promise<boolean> {
  try {
    await access(p, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function defaultReadTextFile(p: string): Promise<string | undefined> {
  try {
    return await readFile(p, 'utf8');
  } catch {
    return undefined;
  }
}

async function defaultProbe(
  bin: string,
  prefixArgs: readonly string[],
): Promise<string | undefined> {
  try {
    const res = await runSubprocess(bin, [...prefixArgs, '--version'], { timeoutMs: 10_000 });
    if (res.exitCode !== 0) return undefined;
    const combined = `${res.stdout}${res.stderr}`;
    const m = /Python\s+(\d+\.\d+\.\d+)/.exec(combined);
    return m?.[1] ?? '';
  } catch {
    return undefined;
  }
}

async function readRequiresPython(
  projectPath: string,
  deps: { readTextFile: (p: string) => Promise<string | undefined> },
): Promise<string | undefined> {
  const raw = await deps.readTextFile(join(projectPath, 'pyproject.toml'));
  if (raw === undefined) return undefined;
  try {
    const parsed = parseToml(raw) as { project?: { 'requires-python'?: unknown } };
    const r = parsed.project?.['requires-python'];
    return typeof r === 'string' ? r : undefined;
  } catch (err) {
    log.warn({ projectPath, error: String(err) }, 'pickPython: failed to parse pyproject.toml');
    return undefined;
  }
}

export interface PickPythonOptions {
  /** Override: use this binary as-is, no probe. */
  pythonBin?: string;
}

function resolveDeps(override: PickPythonDeps): Required<PickPythonDeps> {
  return {
    probe: override.probe ?? defaultProbe,
    resolveOnPath: override.resolveOnPath ?? resolveOnPath,
    fileExists: override.fileExists ?? defaultFileExists,
    readTextFile: override.readTextFile ?? defaultReadTextFile,
    platform: override.platform ?? processPlatform,
  };
}

/**
 * Select a Python interpreter for running tests against `projectPath`.
 *
 * Priority order (ADR 0017):
 *   1. Caller-provided `opts.pythonBin` — used as-is, no probe.
 *   2. Project-local virtual env (`<projectPath>/.venv/Scripts/python.exe`
 *      on Windows, `<projectPath>/.venv/bin/python` on Unix).
 *   3. `requires-python` from pyproject.toml: try `py -X.Y` on Windows /
 *      `pythonX.Y` on Unix for the minimum specified version.
 *   4. Fall back to `python` / `python3` on PATH. Emits a warn-level log
 *      line when we had to demote from a requires-python pin.
 *
 * Each candidate is probed with `<bin> --version`; the first that reports a
 * version wins.
 */
export async function pickPython(
  projectPath: string,
  opts: PickPythonOptions = {},
  depsOverride: PickPythonDeps = {},
): Promise<PythonChoice | undefined> {
  const deps = resolveDeps(depsOverride);

  if (opts.pythonBin !== undefined && opts.pythonBin.length > 0) {
    const v = await deps.probe(opts.pythonBin, []);
    return {
      bin: opts.pythonBin,
      prefixArgs: [],
      version: v ?? '',
      reason: 'opts.pythonBin',
    };
  }

  const venvPath =
    deps.platform === 'win32'
      ? join(projectPath, '.venv', 'Scripts', 'python.exe')
      : join(projectPath, '.venv', 'bin', 'python');
  if (await deps.fileExists(venvPath)) {
    const v = await deps.probe(venvPath, []);
    return {
      bin: venvPath,
      prefixArgs: [],
      version: v ?? '',
      reason: '.venv detected',
    };
  }

  const requires = await readRequiresPython(projectPath, deps);
  const requestedVersion =
    requires !== undefined ? extractMinimumPythonVersion(requires) : undefined;

  if (requestedVersion !== undefined) {
    if (deps.platform === 'win32') {
      const pyBin = await deps.resolveOnPath('py');
      if (pyBin !== undefined) {
        const v = await deps.probe(pyBin, [`-${requestedVersion}`]);
        if (v !== undefined) {
          return {
            bin: pyBin,
            prefixArgs: [`-${requestedVersion}`],
            version: v,
            reason: `requires-python=${requires} → py -${requestedVersion}`,
          };
        }
      }
    } else {
      const vBin = await deps.resolveOnPath(`python${requestedVersion}`);
      if (vBin !== undefined) {
        const v = await deps.probe(vBin, []);
        if (v !== undefined) {
          return {
            bin: vBin,
            prefixArgs: [],
            version: v,
            reason: `requires-python=${requires} → python${requestedVersion}`,
          };
        }
      }
    }
  }

  const fallback = (await deps.resolveOnPath('python')) ?? (await deps.resolveOnPath('python3'));
  if (fallback === undefined) return undefined;
  const v = await deps.probe(fallback, []);
  const choice: PythonChoice = {
    bin: fallback,
    prefixArgs: [],
    version: v ?? '',
    reason: 'python on PATH (fallback)',
  };
  if (requestedVersion !== undefined) {
    log.warn(
      {
        projectPath,
        requestedVersion,
        chosen: fallback,
        chosenVersion: v ?? 'unknown',
      },
      `pickPython: requires-python=${requires} unavailable; demoted to PATH python`,
    );
    choice.reason = `requires-python=${requires} unavailable; demoted to PATH python`;
    choice.demoted = { requestedVersion };
  }
  return choice;
}

// ---------------------------------------------------------------------------
// Per-project assessor venv (ADR 0017 impl. notes / I006 fix)
// ---------------------------------------------------------------------------

/**
 * Where the assessor's `pip install -e .` actually lands. Stable across
 * runs of the same project; regenerated on demand per-project.
 *
 * - `'project'`: a pre-existing `<projectPath>/.venv/` (user-controlled).
 *   {@link pickPython} already prefers this; {@link ensureAssessorVenv}
 *   keeps it in place.
 * - `'factory-managed'`: `<projectPath>/.factory/assessor-env/`. Created on
 *   demand, reused across incremental assesses within one workspace,
 *   gitignored via the existing `.factory/` guard.
 * - `'system'`: fallback — used only if `python -m venv` (and the
 *   optional `virtualenv` shim) both fail. Carries the pre-I006 risk of
 *   user-site pollution, so we log a warn and surface it up to
 *   `AssessResult.provisioning.venvSource` for operator attention.
 */
export type VenvSource = 'project' | 'factory-managed' | 'system';

export interface AssessorVenvChoice extends PythonChoice {
  venvSource: VenvSource;
}

/**
 * Testing seam for {@link ensureAssessorVenv}. Real IO by default; tests
 * inject fakes so no venv is actually created on disk and no subprocess
 * is spawned.
 */
export interface EnsureAssessorVenvDeps {
  fileExists?: (p: string) => Promise<boolean>;
  runSubprocess?: (
    bin: string,
    args: readonly string[],
    opts?: { cwd?: string; timeoutMs?: number; env?: Record<string, string> },
  ) => Promise<SubprocessResult>;
  probe?: (bin: string, prefixArgs: readonly string[]) => Promise<string | undefined>;
  resolveOnPath?: (name: string) => Promise<string | undefined>;
  platform?: NodeJS.Platform;
  /** Read text file for pyproject.toml inspection. Injected for tests. */
  readTextFile?: (p: string) => Promise<string | undefined>;
  /**
   * Remove a stale venv directory. Injected for tests so we can assert
   * the staleness path was taken without touching the filesystem.
   */
  rmDir?: (p: string) => Promise<void>;
}

function resolveEnsureVenvDeps(override: EnsureAssessorVenvDeps): Required<EnsureAssessorVenvDeps> {
  return {
    fileExists: override.fileExists ?? defaultFileExists,
    runSubprocess: override.runSubprocess ?? runSubprocess,
    probe: override.probe ?? defaultProbe,
    resolveOnPath: override.resolveOnPath ?? resolveOnPath,
    platform: override.platform ?? processPlatform,
    readTextFile: override.readTextFile ?? defaultReadTextFile,
    rmDir: override.rmDir ?? defaultRmDir,
  };
}

async function defaultRmDir(p: string): Promise<void> {
  await rm(p, { recursive: true, force: true });
}

function venvInterpreterPath(envPath: string, platform: NodeJS.Platform): string {
  return platform === 'win32'
    ? join(envPath, 'Scripts', 'python.exe')
    : join(envPath, 'bin', 'python');
}

/**
 * Ensure the assessor has an isolated Python env for `projectPath` and
 * return the interpreter to use for `pip install` / pytest / imports.
 *
 * Precedence:
 *   1. If `basePython` was already picked from a project `.venv/` (i.e.
 *      `pickPython` short-circuited on step 2), reuse it. The user's
 *      venv is authoritative.
 *   2. Otherwise resolve `<projectPath>/.factory/assessor-env/`:
 *      - If the venv's interpreter exists on disk, reuse it (cache hit
 *        across incremental assesses).
 *      - Else bootstrap via `<basePython> -m venv <envPath>` with
 *        `{ shell: false }`.
 *      - If `-m venv` fails and `virtualenv` is on PATH, retry via
 *        `virtualenv -p <basePython> <envPath>` (modern-Python hosts
 *        never hit this).
 *   3. Last resort: return `basePython` with `venvSource: 'system'` and
 *      log a warn so operators can install venv support. The install step
 *      still runs but carries the pre-I006 user-site-pollution risk.
 *
 * The returned choice has empty `prefixArgs` when a venv interpreter is
 * used — venv pythons are invoked directly, not via the `py` launcher.
 */
export async function ensureAssessorVenv(
  projectPath: string,
  basePython: PythonChoice,
  depsOverride: EnsureAssessorVenvDeps = {},
): Promise<AssessorVenvChoice> {
  const deps = resolveEnsureVenvDeps(depsOverride);

  // Step 1 — pickPython already landed on a project .venv/. Honour it.
  if (basePython.reason === '.venv detected') {
    return { ...basePython, venvSource: 'project' };
  }

  // Step 2 — factory-managed venv under .factory/assessor-env/.
  const envPath = join(projectPath, '.factory', 'assessor-env');
  const interpreterPath = venvInterpreterPath(envPath, deps.platform);

  if (await deps.fileExists(interpreterPath)) {
    const v = await deps.probe(interpreterPath, []);
    // Staleness check: if the project's `requires-python` constraint has
    // tightened since this venv was created (e.g., an agent bumped `>=3.11`
    // to `>=3.12`), the cached venv's Python may no longer satisfy it.
    // Tear it down and fall through to recreation rather than silently
    // running tests against an out-of-spec interpreter.
    const requires = await readRequiresPython(projectPath, deps);
    const requiredMin = requires !== undefined ? extractMinimumPythonVersion(requires) : undefined;
    const stale =
      requiredMin !== undefined &&
      v !== undefined &&
      v.length > 0 &&
      !venvSatisfiesConstraint(v, requiredMin);
    if (stale) {
      log.warn(
        {
          projectPath,
          envPath,
          venvVersion: v,
          requires,
          requiredMin,
        },
        `assessor-env: venv Python ${v} does not satisfy requires-python=${requires}; deleting and recreating`,
      );
      await deps.rmDir(envPath);
      // Fall through to the create path below.
    } else {
      log.debug(
        { projectPath, interpreter: interpreterPath, version: v ?? '' },
        'assessor-env: reusing existing venv',
      );
      return {
        bin: interpreterPath,
        prefixArgs: [],
        version: v ?? basePython.version,
        reason: '.factory/assessor-env reused',
        venvSource: 'factory-managed',
      };
    }
  }

  log.info(
    {
      projectPath,
      envPath,
      basePython: basePython.bin,
      basePrefix: basePython.prefixArgs,
      baseVersion: basePython.version,
    },
    'assessor-env: creating venv',
  );

  const venvRes = await deps.runSubprocess(
    basePython.bin,
    [...basePython.prefixArgs, '-m', 'venv', envPath],
    { cwd: projectPath, timeoutMs: 60_000 },
  );

  if (venvRes.exitCode === 0 && (await deps.fileExists(interpreterPath))) {
    const v = await deps.probe(interpreterPath, []);
    log.info(
      {
        projectPath,
        interpreter: interpreterPath,
        version: v ?? '',
        durationMs: venvRes.durationMs,
      },
      'assessor-env: venv created',
    );
    return {
      bin: interpreterPath,
      prefixArgs: [],
      version: v ?? basePython.version,
      reason: '.factory/assessor-env created',
      venvSource: 'factory-managed',
    };
  }

  log.warn(
    {
      projectPath,
      envPath,
      exitCode: venvRes.exitCode,
      stderrTail: tailLines(venvRes.stderr, 10),
    },
    'assessor-env: `python -m venv` failed; trying virtualenv fallback',
  );

  const virtualenvBin = await deps.resolveOnPath('virtualenv');
  if (virtualenvBin !== undefined) {
    const veRes = await deps.runSubprocess(virtualenvBin, ['-p', basePython.bin, envPath], {
      cwd: projectPath,
      timeoutMs: 60_000,
    });
    if (veRes.exitCode === 0 && (await deps.fileExists(interpreterPath))) {
      const v = await deps.probe(interpreterPath, []);
      log.info(
        { projectPath, interpreter: interpreterPath, version: v ?? '' },
        'assessor-env: venv created via virtualenv fallback',
      );
      return {
        bin: interpreterPath,
        prefixArgs: [],
        version: v ?? basePython.version,
        reason: '.factory/assessor-env created (virtualenv fallback)',
        venvSource: 'factory-managed',
      };
    }
    log.warn(
      { projectPath, envPath, exitCode: veRes.exitCode },
      'assessor-env: virtualenv fallback also failed',
    );
  }

  log.warn(
    { projectPath, basePython: basePython.bin },
    'assessor-env: no venv could be created; falling through to base interpreter (risks I006-style user-site pollution — install python -m venv support on the host)',
  );
  return { ...basePython, venvSource: 'system' };
}

// ---------------------------------------------------------------------------
// Shared assessor-env provisioning (ADR 0017)
// ---------------------------------------------------------------------------

export interface ProvisioningReport {
  pythonPath: string;
  pythonVersion: string;
  installOk: boolean;
  installSummary?: string;
  venvSource: VenvSource;
}

export interface AssessorEnv {
  /** The chosen interpreter — use `bin` + `prefixArgs` to invoke it. Carries `venvSource` for the install site. */
  choice: AssessorVenvChoice;
  /** Install state; mirrored into {@link PytestResult.provisioning} and {@link AssessResult.provisioning}. */
  provisioning: ProvisioningReport;
}

/**
 * Testing seam for {@link provisionAssessorEnv}. In production defaults to
 * the real pickPython / runSubprocess / fs helpers.
 */
export interface ProvisionEnvDeps {
  pickPython?: (projectPath: string, opts: PickPythonOptions) => Promise<PythonChoice | undefined>;
  ensureAssessorVenv?: (
    projectPath: string,
    basePython: PythonChoice,
  ) => Promise<AssessorVenvChoice>;
  runSubprocess?: (
    bin: string,
    args: readonly string[],
    opts?: { cwd?: string; timeoutMs?: number; env?: Record<string, string> },
  ) => Promise<SubprocessResult>;
  hasPyproject?: (projectPath: string) => Promise<boolean>;
  /**
   * Returns `test` if pyproject declares `[project.optional-dependencies.test]`,
   * `dev` if it declares `dev`, or undefined if neither. Fallback to plain
   * `-e .` when undefined. Retained as `pyprojectHasTestExtra` for existing
   * test-suite compatibility; defaults delegate to the real helper.
   */
  pyprojectPickExtra?: (projectPath: string) => Promise<string | undefined>;
  pyprojectHasTestExtra?: (projectPath: string) => Promise<boolean>;
}

async function projectHasPyproject(projectPath: string): Promise<boolean> {
  return defaultFileExists(join(projectPath, 'pyproject.toml'));
}

async function pyprojectPickExtra(projectPath: string): Promise<string | undefined> {
  const raw = await defaultReadTextFile(join(projectPath, 'pyproject.toml'));
  if (raw === undefined) return undefined;
  try {
    const parsed = parseToml(raw) as {
      project?: { 'optional-dependencies'?: Record<string, unknown> };
    };
    const extras = parsed.project?.['optional-dependencies'];
    if (extras === undefined) return undefined;
    // Prefer `test`, fall back to `dev` — these are the two widely-used
    // conventions for project-internal test deps.
    if (extras['test'] !== undefined) return 'test';
    if (extras['dev'] !== undefined) return 'dev';
    return undefined;
  } catch {
    return undefined;
  }
}

function tailLines(s: string, n: number): string {
  const lines = s.split(/\r?\n/);
  return lines.slice(-n).join('\n');
}

/**
 * Pick a Python interpreter and, when the project carries a pyproject.toml,
 * run `pip install -e .[test]` (or `-e .` fallback) so the project's declared
 * deps are on the import path. Returns the chosen interpreter plus an
 * `installOk` / `installSummary` report.
 *
 * Shared helper for {@link runPytest} and {@link checkPythonImports} — both
 * runners need the same interpreter + installed deps to agree on gate
 * outcomes (ADR 0017).
 */
export async function provisionAssessorEnv(
  projectPath: string,
  opts: { pythonBin?: string; installTimeoutMs?: number } = {},
  depsOverride: ProvisionEnvDeps = {},
): Promise<AssessorEnv | undefined> {
  const deps = {
    pickPython: depsOverride.pickPython ?? pickPython,
    ensureAssessorVenv: depsOverride.ensureAssessorVenv ?? ensureAssessorVenv,
    runSubprocess: depsOverride.runSubprocess ?? runSubprocess,
    hasPyproject: depsOverride.hasPyproject ?? projectHasPyproject,
    pyprojectPickExtra: depsOverride.pyprojectPickExtra ?? pyprojectPickExtra,
    // Test-only back-compat: older tests inject `pyprojectHasTestExtra`; if
    // present, interpret it as "pick `test` when true, `.` otherwise."
    pyprojectHasTestExtraLegacy: depsOverride.pyprojectHasTestExtra,
  };

  const basePick = await deps.pickPython(
    projectPath,
    opts.pythonBin !== undefined ? { pythonBin: opts.pythonBin } : {},
  );
  if (basePick === undefined) return undefined;

  log.info(
    {
      projectPath,
      chosen: basePick.bin,
      prefixArgs: basePick.prefixArgs,
      version: basePick.version,
      reason: basePick.reason,
      demoted: basePick.demoted,
    },
    'pickPython: chose interpreter',
  );

  // ADR 0017 impl. notes / I006: route installs through an isolated venv.
  const choice = await deps.ensureAssessorVenv(projectPath, basePick);
  log.info(
    {
      projectPath,
      bin: choice.bin,
      prefixArgs: choice.prefixArgs,
      version: choice.version,
      venvSource: choice.venvSource,
      reason: choice.reason,
    },
    'assessor-env: interpreter ready',
  );

  if (!(await deps.hasPyproject(projectPath))) {
    return {
      choice,
      provisioning: {
        pythonPath: choice.bin,
        pythonVersion: choice.version,
        installOk: true,
        venvSource: choice.venvSource,
      },
    };
  }

  const extraName =
    deps.pyprojectHasTestExtraLegacy !== undefined
      ? (await deps.pyprojectHasTestExtraLegacy(projectPath))
        ? 'test'
        : undefined
      : await deps.pyprojectPickExtra(projectPath);
  const target = extraName !== undefined ? `.[${extraName}]` : '.';
  const pipArgs = [
    ...choice.prefixArgs,
    '-m',
    'pip',
    'install',
    '-e',
    target,
    '--disable-pip-version-check',
    '--quiet',
  ];
  const installStarted = Date.now();
  log.info(
    { projectPath, python: choice.bin, target },
    'assessor-env: installing project (editable)',
  );
  const installRes = await deps.runSubprocess(choice.bin, pipArgs, {
    cwd: projectPath,
    timeoutMs: opts.installTimeoutMs ?? 180_000,
  });
  let installOk = installRes.exitCode === 0;
  let installSummary: string | undefined;
  if (!installOk && extraName !== undefined) {
    log.warn(
      { projectPath, target, exitCode: installRes.exitCode },
      `assessor-env: install -e .[${extraName}] failed; retrying with -e .`,
    );
    const retryArgs = [
      ...choice.prefixArgs,
      '-m',
      'pip',
      'install',
      '-e',
      '.',
      '--disable-pip-version-check',
      '--quiet',
    ];
    const retryRes = await deps.runSubprocess(choice.bin, retryArgs, {
      cwd: projectPath,
      timeoutMs: opts.installTimeoutMs ?? 180_000,
    });
    installOk = retryRes.exitCode === 0;
    if (!installOk) {
      installSummary = tailLines(`${retryRes.stdout}\n${retryRes.stderr}`, 40);
    }
  } else if (!installOk) {
    installSummary = tailLines(`${installRes.stdout}\n${installRes.stderr}`, 40);
  }
  log.info(
    { projectPath, installOk, durationMs: Date.now() - installStarted },
    installOk ? 'assessor-env: install complete' : 'assessor-env: install failed',
  );
  return {
    choice,
    provisioning: {
      pythonPath: choice.bin,
      pythonVersion: choice.version,
      installOk,
      ...(installSummary !== undefined ? { installSummary } : {}),
      venvSource: choice.venvSource,
    },
  };
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

export interface PytestResult {
  available: boolean;
  passed: number;
  failed: number;
  errors: number;
  skipped: number;
  exitCode: number | null;
  durationMs: number;
  rawTail: string;
  reason?: string;
  /**
   * Provisioning state when the runner provisioned the project env before
   * pytest (ADR 0017). Absent when the runner short-circuited before reaching
   * the install step (no tests/, no python on PATH).
   */
  provisioning?: ProvisioningReport;
}

/**
 * Testing seam for {@link runPytest}.
 */
export interface RunPytestDeps {
  provisionAssessorEnv?: (
    projectPath: string,
    opts: { pythonBin?: string; installTimeoutMs?: number },
  ) => Promise<AssessorEnv | undefined>;
  runSubprocess?: (
    bin: string,
    args: readonly string[],
    opts?: { cwd?: string; timeoutMs?: number; env?: Record<string, string> },
  ) => Promise<SubprocessResult>;
  fileExists?: (p: string) => Promise<boolean>;
  // Legacy seams retained for provisionAssessorEnv tests that inject pytest-runPytest-style deps.
  pickPython?: (projectPath: string, opts: PickPythonOptions) => Promise<PythonChoice | undefined>;
  ensureAssessorVenv?: (
    projectPath: string,
    basePython: PythonChoice,
  ) => Promise<AssessorVenvChoice>;
  hasPyproject?: (projectPath: string) => Promise<boolean>;
  pyprojectHasTestExtra?: (projectPath: string) => Promise<boolean>;
}

/**
 * Run pytest against `projectPath`. Returns a structured result; does NOT
 * throw when tests fail — that's a test result, not a runner error.
 *
 * ADR 0017: if no `env` is given, provisions one via
 * {@link provisionAssessorEnv} (pickPython + `pip install -e .[test]`).
 * Callers that share provisioning between runners (e.g.
 * {@link assess} → pytest + imports) should pass the shared `env` in so
 * install runs once.
 */
export async function runPytest(
  projectPath: string,
  opts: {
    pythonBin?: string;
    timeoutMs?: number;
    installTimeoutMs?: number;
    env?: AssessorEnv;
  } = {},
  depsOverride: RunPytestDeps = {},
): Promise<PytestResult> {
  const deps = {
    provisionAssessorEnv:
      depsOverride.provisionAssessorEnv ??
      ((pp: string, o: { pythonBin?: string; installTimeoutMs?: number }) => {
        const legacyDeps: ProvisionEnvDeps = {};
        if (depsOverride.pickPython !== undefined) legacyDeps.pickPython = depsOverride.pickPython;
        if (depsOverride.ensureAssessorVenv !== undefined)
          legacyDeps.ensureAssessorVenv = depsOverride.ensureAssessorVenv;
        if (depsOverride.runSubprocess !== undefined)
          legacyDeps.runSubprocess = depsOverride.runSubprocess;
        if (depsOverride.hasPyproject !== undefined)
          legacyDeps.hasPyproject = depsOverride.hasPyproject;
        if (depsOverride.pyprojectHasTestExtra !== undefined)
          legacyDeps.pyprojectHasTestExtra = depsOverride.pyprojectHasTestExtra;
        return provisionAssessorEnv(pp, o, legacyDeps);
      }),
    runSubprocess: depsOverride.runSubprocess ?? runSubprocess,
    fileExists: depsOverride.fileExists ?? defaultFileExists,
  };

  const empty: PytestResult = {
    available: false,
    passed: 0,
    failed: 0,
    errors: 0,
    skipped: 0,
    exitCode: null,
    durationMs: 0,
    rawTail: '',
  };

  const envOpts: { pythonBin?: string; installTimeoutMs?: number } = {};
  if (opts.pythonBin !== undefined) envOpts.pythonBin = opts.pythonBin;
  if (opts.installTimeoutMs !== undefined) envOpts.installTimeoutMs = opts.installTimeoutMs;
  const env = opts.env ?? (await deps.provisionAssessorEnv(projectPath, envOpts));
  if (env === undefined) {
    return { ...empty, reason: 'python not on PATH' };
  }
  const { choice, provisioning } = env;

  let testsPresent = false;
  for (const candidate of ['tests', 'test', 'src/tests']) {
    if (await deps.fileExists(join(projectPath, candidate))) {
      testsPresent = true;
      break;
    }
  }
  if (!testsPresent) {
    return { ...empty, reason: 'no tests/ directory', provisioning };
  }

  log.debug({ projectPath, python: choice.bin }, 'invoking pytest');
  const res = await deps.runSubprocess(
    choice.bin,
    [...choice.prefixArgs, '-m', 'pytest', '-q', '--tb=short'],
    {
      cwd: projectPath,
      timeoutMs: opts.timeoutMs ?? 120_000,
    },
  );

  if (res.exitCode === 5) {
    // pytest exit code 5 = no tests collected
    return {
      ...empty,
      available: true,
      exitCode: 5,
      durationMs: res.durationMs,
      rawTail: res.stdout.slice(-500),
      reason: 'no tests collected',
      provisioning,
    };
  }

  const parsed = parseSummary(res.stdout);
  return {
    available: true,
    ...parsed,
    exitCode: res.exitCode,
    durationMs: res.durationMs,
    rawTail: res.stdout.slice(-500),
    provisioning,
  };
}

export { parseSummary as parsePytestSummary };
