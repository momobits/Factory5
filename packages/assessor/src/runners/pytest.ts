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
 */

import { access } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { join } from 'node:path';

import { createLogger } from '@factory5/logger';

import { resolveOnPath, runSubprocess } from '../run.js';

const log = createLogger('assessor.pytest');

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
}

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

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function projectHasTests(projectPath: string): Promise<boolean> {
  for (const candidate of ['tests', 'test', 'src/tests']) {
    if (await fileExists(join(projectPath, candidate))) return true;
  }
  return false;
}

async function pickPython(override?: string): Promise<string | undefined> {
  if (override !== undefined && override.length > 0) return override;
  const pyw = await resolveOnPath('python');
  if (pyw !== undefined) return pyw;
  return resolveOnPath('python3');
}

/**
 * Run pytest against `projectPath`. Returns a structured result; does NOT
 * throw when tests fail (that's a test result, not a runner error).
 */
export async function runPytest(
  projectPath: string,
  opts: { pythonBin?: string; timeoutMs?: number } = {},
): Promise<PytestResult> {
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

  const python = await pickPython(opts.pythonBin);
  if (python === undefined) {
    return { ...empty, reason: 'python not on PATH' };
  }

  if (!(await projectHasTests(projectPath))) {
    return { ...empty, reason: 'no tests/ directory' };
  }

  log.debug({ projectPath, python }, 'invoking pytest');
  const res = await runSubprocess(python, ['-m', 'pytest', '-q', '--tb=short'], {
    cwd: projectPath,
    timeoutMs: opts.timeoutMs ?? 120_000,
  });

  if (res.exitCode === 5) {
    // pytest exit code 5 = no tests collected
    return {
      ...empty,
      available: true,
      exitCode: 5,
      durationMs: res.durationMs,
      rawTail: res.stdout.slice(-500),
      reason: 'no tests collected',
    };
  }

  const parsed = parseSummary(res.stdout);
  return {
    available: true,
    ...parsed,
    exitCode: res.exitCode,
    durationMs: res.durationMs,
    rawTail: res.stdout.slice(-500),
  };
}

export { parseSummary as parsePytestSummary };
