/**
 * List worktree directories under `<projectPath>/.factory/worktrees/` that
 * are not in the active task ID set. Used by the `factory cleanup` CLI
 * and the daemon resume endpoint to surface leftover worktrees from prior
 * failed runs so the operator can remove them.
 */

import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

import { WORKTREES_SUBDIR } from './worktree.js';

const TASK_PREFIX = 'task-';

/** A worktree directory whose task is no longer tracked in any active plan. */
export interface AbandonedWorktree {
  /** Absolute path to the worktree directory. */
  path: string;
  /** Task ID derived from the directory name (everything after `task-`). */
  taskId: string;
  /** Last-modified time on the worktree directory itself. */
  abandonedSince: Date;
}

/** Options for {@link listAbandonedWorktrees}. */
export interface ListAbandonedOptions {
  /** Absolute path to the project root. */
  projectPath: string;
  /** Task IDs currently active in the project's plan(s). Worktrees not in this set are flagged. */
  activeTaskIds: readonly string[];
}

/**
 * Returns all worktree directories under `<projectPath>/.factory/worktrees/`
 * whose task ID is not present in `activeTaskIds`.
 *
 * - If the worktrees directory does not exist, returns `[]` silently.
 * - Directories that do not start with the `task-` prefix are ignored.
 * - Files (non-directories) inside the worktrees folder are ignored.
 */
export async function listAbandonedWorktrees(
  opts: ListAbandonedOptions,
): Promise<AbandonedWorktree[]> {
  const worktreesDir = join(opts.projectPath, WORKTREES_SUBDIR);
  let entries: string[];
  try {
    entries = await readdir(worktreesDir);
  } catch {
    // Directory does not exist or is not readable — treat as no worktrees.
    return [];
  }

  const activeSet = new Set(opts.activeTaskIds);
  const result: AbandonedWorktree[] = [];

  for (const entry of entries) {
    if (!entry.startsWith(TASK_PREFIX)) continue;
    const taskId = entry.slice(TASK_PREFIX.length);
    if (activeSet.has(taskId)) continue;
    const fullPath = join(worktreesDir, entry);
    try {
      const s = await stat(fullPath);
      if (!s.isDirectory()) continue;
      result.push({ path: fullPath, taskId, abandonedSince: s.mtime });
    } catch {
      // Race: directory disappeared between readdir and stat — skip silently.
    }
  }
  return result;
}
