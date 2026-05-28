/**
 * Python dead-code scanner. Uses a subprocess invocation of Python's
 * AST module to collect public symbol definitions, imports, and calls
 * across the project's package files. Symbols that are public (no
 * underscore prefix), not exposed via __all__ or entry_points, and
 * not called by any other module in the package are flagged.
 *
 * Subprocess invocation keeps the analyzer logic in Python (the only
 * language with an AST library we can trust for Python source).
 */

import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';

import { glob } from 'glob';

import { createLogger } from '@factory5/logger';

import type { PartialFinding } from './schema-check.js';

const log = createLogger('coherence-validator.dead-code');

/** Options for the Python dead-code scanner. */
export interface DeadCodeOptions {
  projectPath: string;
  packageGlobs: readonly string[];
  exposedVia: ReadonlyArray<{ kind: string; source: string }>;
  excludeGlobs: readonly string[];
}

const ANALYZER_PY = `
import ast, json, sys

class V(ast.NodeVisitor):
    def __init__(self):
        self.public_defs = []
        self.imports = []
        self.calls = []
        self.all_list = None

    def visit_FunctionDef(self, node):
        if not node.name.startswith('_'):
            self.public_defs.append((node.name, node.lineno))
        self.generic_visit(node)

    def visit_AsyncFunctionDef(self, node):
        if not node.name.startswith('_'):
            self.public_defs.append((node.name, node.lineno))
        self.generic_visit(node)

    def visit_ClassDef(self, node):
        if not node.name.startswith('_'):
            self.public_defs.append((node.name, node.lineno))
        self.generic_visit(node)

    def visit_Assign(self, node):
        for t in node.targets:
            if isinstance(t, ast.Name) and t.id == '__all__':
                if isinstance(node.value, (ast.List, ast.Tuple)):
                    self.all_list = [e.value for e in node.value.elts if isinstance(e, ast.Constant)]
        self.generic_visit(node)

    def visit_ImportFrom(self, node):
        if node.module is not None:
            for alias in node.names:
                self.imports.append(node.module + '.' + alias.name)
        self.generic_visit(node)

    def visit_Call(self, node):
        if isinstance(node.func, ast.Attribute):
            parts = []
            n = node.func
            while isinstance(n, ast.Attribute):
                parts.insert(0, n.attr)
                n = n.value
            if isinstance(n, ast.Name): parts.insert(0, n.id)
            self.calls.append('.'.join(parts))
        elif isinstance(node.func, ast.Name):
            self.calls.append(node.func.id)
        self.generic_visit(node)

paths = json.loads(sys.stdin.read())
out = {}
for p in paths:
    try:
        src = open(p, 'r', encoding='utf-8').read()
        tree = ast.parse(src, p)
        v = V(); v.visit(tree)
        out[p] = {'public_defs': v.public_defs, 'imports': v.imports, 'calls': v.calls, 'all_list': v.all_list}
    except Exception as e:
        out[p] = {'error': str(e)}

print(json.dumps(out))
`;

interface SymbolInfo {
  public_defs: Array<[string, number]>;
  imports: string[];
  calls: string[];
  all_list: string[] | null;
  error?: string;
}

async function runAnalyzer(
  pythonBin: string,
  paths: readonly string[],
): Promise<Record<string, SymbolInfo>> {
  return new Promise((resolveFn, rejectFn) => {
    const child = spawn(pythonBin, ['-c', ANALYZER_PY], { shell: false });
    let stdout = '';
    let stderr = '';
    child.stdin.write(JSON.stringify(paths));
    child.stdin.end();
    child.stdout.on('data', (b: Buffer) => {
      stdout += b.toString('utf8');
    });
    child.stderr.on('data', (b: Buffer) => {
      stderr += b.toString('utf8');
    });
    child.on('close', (code) => {
      if (code !== 0) {
        rejectFn(new Error(`python analyzer exit ${String(code)}: ${stderr.slice(0, 500)}`));
        return;
      }
      try {
        resolveFn(JSON.parse(stdout) as Record<string, SymbolInfo>);
      } catch (err) {
        rejectFn(err as Error);
      }
    });
    child.on('error', rejectFn);
  });
}

async function collectExposedSymbols(
  opts: DeadCodeOptions,
  analysis: Record<string, SymbolInfo>,
): Promise<Set<string>> {
  const exposed = new Set<string>();

  for (const source of opts.exposedVia) {
    if (source.kind === 'explicit_export' && source.source === '__all__') {
      for (const info of Object.values(analysis)) {
        if (info.all_list !== null) {
          for (const name of info.all_list) exposed.add(name);
        }
      }
    } else if (source.kind === 'entry_points' && source.source === 'pyproject.toml::project.scripts') {
      try {
        const text = await readFile(resolve(opts.projectPath, 'pyproject.toml'), 'utf8');
        const scripts = text.match(/\[project\.scripts\]\s*\n([^[]*)/);
        if (scripts !== null) {
          const lines = (scripts[1] ?? '').split(/\r?\n/);
          for (const line of lines) {
            const m = line.match(/^\s*\S+\s*=\s*"[^"]+:(\w+)"/);
            if (m !== null && m[1] !== undefined) exposed.add(m[1]);
          }
        }
      } catch {
        /* no pyproject — skip */
      }
    } else if (source.kind === 'feature_surface') {
      // Stub: would parse features/*.md documented_in. Future enhancement.
    }
  }

  return exposed;
}

/**
 * Scans Python package files for public symbols that are not used
 * anywhere in the package (dead code).
 *
 * @param opts - Options including project path, package globs, exposure declarations, and exclusions.
 * @returns Array of partial findings for each dead symbol detected.
 */
export async function checkDeadCodePython(opts: DeadCodeOptions): Promise<PartialFinding[]> {
  const allPaths = new Set<string>();
  for (const pattern of opts.packageGlobs) {
    const matched = await glob(pattern, {
      cwd: opts.projectPath,
      absolute: true,
      ignore: [...opts.excludeGlobs],
    });
    for (const p of matched) allPaths.add(p);
  }

  if (allPaths.size === 0) return [];

  const analysis = await runAnalyzer('python', [...allPaths]);
  const exposed = await collectExposedSymbols(opts, analysis);

  // Build sets of all called names + imported targets across the package.
  const calledNames = new Set<string>();
  const importedTargets = new Set<string>();
  for (const info of Object.values(analysis)) {
    for (const c of info.calls) {
      const last = c.split('.').pop() ?? '';
      calledNames.add(last);
    }
    for (const i of info.imports) {
      const last = i.split('.').pop() ?? '';
      importedTargets.add(last);
    }
  }

  const findings: PartialFinding[] = [];
  for (const [absPath, info] of Object.entries(analysis)) {
    if (info.error !== undefined) continue;
    for (const [symbolName, line] of info.public_defs) {
      if (exposed.has(symbolName)) continue;
      if (calledNames.has(symbolName)) continue;
      if (importedTargets.has(symbolName)) continue;
      const relPath = relative(opts.projectPath, absPath).split('\\').join('/');
      findings.push({
        category: 'dead-code',
        severity: 'low',
        title: `Public symbol ${symbolName} appears unused`,
        why: `Defined in ${relPath}:${String(line)} but no other module in the package imports or calls it, and it is not exposed via __all__ or entry_points.`,
        suggested_fix: `Either wire it up (write a caller) or remove it. If it's a public API surface, declare it in __all__ or reference it from a feature's documented_in.`,
        auto_fixable: false,
        location: { file: relPath, line },
      });
    }
  }

  log.debug(
    { projectPath: opts.projectPath, candidateCount: findings.length },
    'dead-code: scan complete',
  );
  return findings;
}
