/**
 * Python import check — for each expected module path under the project,
 * run `python -c "import <module>"` and collect errors.
 *
 * Module paths are converted from `src/foo/bar.py` → `src.foo.bar` by
 * stripping the `.py` extension and replacing separators with dots. If the
 * path doesn't look like a Python module, the check is skipped.
 *
 * ADR 0017: accepts a shared `interpreter` (PythonChoice) so that the
 * assessor's imports + pytest runners agree on which Python they're probing
 * (and, crucially, hit the venv/requires-python interpreter rather than the
 * host PATH default).
 */

import { createLogger } from '@factory5/logger';

import { resolveOnPath, runSubprocess } from '../run.js';
import type { PythonChoice } from './pytest.js';

const log = createLogger('assessor.imports');

export interface ImportCheckResult {
  ok: boolean;
  /** One entry per check attempted. */
  details: { module: string; ok: boolean; error?: string }[];
}

function pathToModule(rel: string): string | undefined {
  const normalized = rel.replace(/\\/g, '/');
  if (!normalized.endsWith('.py')) return undefined;
  const stem = normalized.slice(0, -3);
  if (stem.endsWith('/__init__')) return stem.slice(0, -'/__init__'.length).replace(/\//g, '.');
  return stem.replace(/\//g, '.');
}

interface ResolvedInterpreter {
  bin: string;
  prefixArgs: readonly string[];
}

async function pickInterpreter(opts: {
  pythonBin?: string;
  interpreter?: PythonChoice;
}): Promise<ResolvedInterpreter | undefined> {
  if (opts.interpreter !== undefined) {
    return { bin: opts.interpreter.bin, prefixArgs: opts.interpreter.prefixArgs };
  }
  if (opts.pythonBin !== undefined && opts.pythonBin.length > 0) {
    return { bin: opts.pythonBin, prefixArgs: [] };
  }
  const fallback = (await resolveOnPath('python')) ?? (await resolveOnPath('python3'));
  if (fallback === undefined) return undefined;
  return { bin: fallback, prefixArgs: [] };
}

/**
 * Run `python -c "import <module>"` for each module path. Returns aggregate
 * ok + per-module detail. Modules with non-`.py` paths are silently skipped.
 *
 * When `opts.interpreter` is given (set by `assess()` via
 * {@link provisionAssessorEnv}), the check runs against the shared
 * interpreter — same one pytest uses — so the two runners agree on gate
 * outcomes. Fallback ordering: explicit `interpreter` → explicit `pythonBin`
 * → `python`/`python3` on PATH.
 */
export async function checkPythonImports(
  projectPath: string,
  modulePaths: readonly string[],
  opts: { pythonBin?: string; timeoutMs?: number; interpreter?: PythonChoice } = {},
): Promise<ImportCheckResult> {
  const details: ImportCheckResult['details'] = [];
  if (modulePaths.length === 0) {
    return { ok: true, details };
  }

  const interpOpts: { pythonBin?: string; interpreter?: PythonChoice } = {};
  if (opts.pythonBin !== undefined) interpOpts.pythonBin = opts.pythonBin;
  if (opts.interpreter !== undefined) interpOpts.interpreter = opts.interpreter;
  const interp = await pickInterpreter(interpOpts);
  if (interp === undefined) {
    return {
      ok: false,
      details: modulePaths.map((m) => ({ module: m, ok: false, error: 'python not on PATH' })),
    };
  }

  for (const rel of modulePaths) {
    const mod = pathToModule(rel);
    if (mod === undefined) continue;

    const res = await runSubprocess(interp.bin, [...interp.prefixArgs, '-c', `import ${mod}`], {
      cwd: projectPath,
      timeoutMs: opts.timeoutMs ?? 30_000,
      env: { PYTHONDONTWRITEBYTECODE: '1' },
    });

    if (res.exitCode === 0) {
      details.push({ module: mod, ok: true });
    } else {
      const firstLine =
        res.stderr
          .trim()
          .split('\n')
          .filter((l) => l.length > 0)
          .pop() ?? 'unknown';
      details.push({ module: mod, ok: false, error: firstLine });
    }
  }

  const ok = details.every((d) => d.ok);
  log.debug(
    { projectPath, total: details.length, failed: details.filter((d) => !d.ok).length },
    'import check complete',
  );
  return { ok, details };
}

export { pathToModule };
