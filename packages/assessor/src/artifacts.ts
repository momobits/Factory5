/**
 * Required-artifact checks: README, LICENSE, .gitignore, architecture doc,
 * git clean status. All cheap file / git queries.
 */

import { readFile, access } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { join } from 'node:path';

import { resolveOnPath, runSubprocess } from './run.js';

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function anyOf(projectPath: string, names: readonly string[]): Promise<boolean> {
  for (const n of names) {
    if (await fileExists(join(projectPath, n))) return true;
  }
  return false;
}

export async function checkReadme(projectPath: string): Promise<boolean> {
  for (const n of ['README.md', 'README.rst', 'README.txt', 'readme.md']) {
    const p = join(projectPath, n);
    if (!(await fileExists(p))) continue;
    const content = await readFile(p, 'utf8');
    const nonEmptyLines = content.split('\n').filter((l) => l.trim().length > 0).length;
    if (nonEmptyLines >= 30) return true;
  }
  return false;
}

export async function checkLicense(projectPath: string): Promise<boolean> {
  return anyOf(projectPath, ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'COPYING']);
}

export async function checkGitignore(projectPath: string): Promise<boolean> {
  return fileExists(join(projectPath, '.gitignore'));
}

export async function checkArchitectureDoc(projectPath: string): Promise<boolean> {
  return anyOf(projectPath, [
    'docs/architecture.md',
    'docs/ARCHITECTURE.md',
    'docs/knowledge/architecture.md',
    'docs/knowledge/overview.md',
    'ARCHITECTURE.md',
  ]);
}

/**
 * `git status --porcelain` empty ⇒ tree clean. Returns `true` if the
 * directory is not a git repo (don't require git for assessor).
 */
export async function checkGitClean(projectPath: string): Promise<boolean> {
  const git = await resolveOnPath('git');
  if (git === undefined) return true;
  const res = await runSubprocess(git, ['-C', projectPath, 'status', '--porcelain'], {
    timeoutMs: 15_000,
  });
  if (res.exitCode !== 0) return true;
  return res.stdout.trim().length === 0;
}

/**
 * Check which of the expected modules actually exist on disk. Returns
 * count + missing list.
 */
export async function checkModules(
  projectPath: string,
  modulePaths: readonly string[],
): Promise<{ existing: number; missing: string[] }> {
  const missing: string[] = [];
  let existing = 0;
  for (const rel of modulePaths) {
    if (await fileExists(join(projectPath, rel))) existing += 1;
    else missing.push(rel);
  }
  return { existing, missing };
}
