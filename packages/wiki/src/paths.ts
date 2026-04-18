/**
 * Path helpers for the per-project state layout.
 *
 * All paths are joined with `node:path` to stay cross-platform.
 */

import { join } from 'node:path';

export interface ProjectPaths {
  root: string;
  claudeMd: string;
  buildMd: string;
  docs: string;
  knowledge: string;
  factory: string;
  findings: string;
  plan: string;
  planJson: string;
  checkpoints: string;
  worktrees: string;
  logs: string;
  runs: string;
}

/**
 * Compute all managed paths for a project rooted at `projectPath`. Does not
 * touch the filesystem.
 */
export function projectPaths(projectPath: string): ProjectPaths {
  const factory = join(projectPath, '.factory');
  return {
    root: projectPath,
    claudeMd: join(projectPath, 'CLAUDE.md'),
    buildMd: join(projectPath, 'BUILD.md'),
    docs: join(projectPath, 'docs'),
    knowledge: join(projectPath, 'docs', 'knowledge'),
    factory,
    findings: join(factory, 'findings.json'),
    plan: join(factory, 'plan.md'),
    planJson: join(factory, 'plan.json'),
    checkpoints: join(factory, 'checkpoints'),
    worktrees: join(factory, 'worktrees'),
    logs: join(factory, 'logs'),
    runs: join(factory, 'runs'),
  };
}
