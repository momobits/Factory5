/**
 * Python import check — for each expected module path under the project,
 * run `python -c "import <module>"` and collect errors.
 *
 * Module paths are converted from `src/foo/bar.py` → `src.foo.bar` by
 * stripping the `.py` extension and replacing separators with dots. If the
 * path doesn't look like a Python module, the check is skipped.
 */

import { createLogger } from '@factory5/logger';

import { resolveOnPath, runSubprocess } from '../run.js';

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

async function pickPython(override?: string): Promise<string | undefined> {
  if (override !== undefined && override.length > 0) return override;
  return (await resolveOnPath('python')) ?? (await resolveOnPath('python3'));
}

/**
 * Run `python -c "import <module>"` for each module path. Returns aggregate
 * ok + per-module detail. Modules with non-`.py` paths are silently skipped.
 */
export async function checkPythonImports(
  projectPath: string,
  modulePaths: readonly string[],
  opts: { pythonBin?: string; timeoutMs?: number } = {},
): Promise<ImportCheckResult> {
  const details: ImportCheckResult['details'] = [];
  if (modulePaths.length === 0) {
    return { ok: true, details };
  }

  const python = await pickPython(opts.pythonBin);
  if (python === undefined) {
    return {
      ok: false,
      details: modulePaths.map((m) => ({ module: m, ok: false, error: 'python not on PATH' })),
    };
  }

  for (const rel of modulePaths) {
    const mod = pathToModule(rel);
    if (mod === undefined) continue;

    const res = await runSubprocess(python, ['-c', `import ${mod}`], {
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
