/**
 * Per-task git worktree allocation.
 *
 * Tool-using agents (scaffolder/builder/fixer) run inside an isolated worktree
 * so they can write files without stomping on other concurrent tasks. On
 * success the task branch is merged back into the project's main branch and
 * the worktree is removed; on failure the worktree is left in place for
 * post-mortem inspection.
 *
 * Layout:
 *   <projectPath>/                 # main working tree (default branch)
 *   <projectPath>/.factory/        # factory-scoped runtime state (gitignored)
 *   <projectPath>/.factory/worktrees/task-<taskId>/   # per-task worktree
 *
 * Branch naming: `factory/task-<shortId>` where shortId is the trailing 8
 * characters of the task ULID (collisions would require two tasks with ULIDs
 * sharing an 8-char suffix within the same project — vanishingly unlikely and,
 * if it happens, simple-git raises a deterministic "branch already exists"
 * which we surface).
 *
 * This module MUST stay free of `@factory5/brain` imports to keep the
 * dependency DAG acyclic.
 */

import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { createLogger } from '@factory5/logger';
import { simpleGit, type SimpleGit } from 'simple-git';

const log = createLogger('worker.worktree');

/** Relative path (from project root) where all per-task worktrees live. */
export const WORKTREES_SUBDIR = '.factory/worktrees';

/**
 * Per-project async mutex for the merge-back phase. Two sibling tasks that
 * finish concurrently both call `mergeAndRemove` against the same `.git/`;
 * on Windows the second `git merge` was observed to log success but never
 * advance `main`'s ref (I004). Chaining the merges per project eliminates
 * the race without restricting the rest of the pipeline.
 *
 * Keyed by the resolved (and on Windows lowercased) project path so `.`,
 * relative, and absolute forms collapse to the same entry.
 */
const projectMergeQueues = new Map<string, Promise<unknown>>();

function mergeQueueKey(projectPath: string): string {
  const abs = resolve(projectPath);
  return process.platform === 'win32' ? abs.toLowerCase() : abs;
}

export interface WorktreeHandle {
  /** Absolute path of the new worktree directory. */
  path: string;
  /** Branch name the worktree is checked out onto. */
  branch: string;
  /** Base branch the task branch forked from. */
  baseBranch: string;
}

export interface AllocateOptions {
  projectPath: string;
  taskId: string;
}

export interface CleanupOptions {
  projectPath: string;
  handle: WorktreeHandle;
  /**
   * `success` = merge task branch back into base, remove worktree, delete
   *   branch. `failure` = leave worktree and branch in place.
   */
  outcome: 'success' | 'failure';
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function isGitRepo(projectPath: string): Promise<boolean> {
  return pathExists(join(projectPath, '.git'));
}

async function ensureGitignoreExcludesFactory(projectPath: string): Promise<void> {
  const gitignorePath = join(projectPath, '.gitignore');
  const marker = '.factory/';
  let current = '';
  try {
    current = await readFile(gitignorePath, 'utf8');
  } catch {
    current = '';
  }
  // Normalize to line entries; match either `.factory/` or `.factory` forms.
  const lines = current.split(/\r?\n/).map((l) => l.trim());
  if (lines.some((l) => l === marker || l === '.factory')) return;
  const sep = current.length === 0 || current.endsWith('\n') ? '' : '\n';
  await writeFile(gitignorePath, `${current}${sep}${marker}\n`, 'utf8');
  log.info({ projectPath }, 'worktree: added .factory/ to .gitignore');
}

async function hasCommit(git: SimpleGit): Promise<boolean> {
  try {
    await git.raw(['rev-parse', '--verify', 'HEAD']);
    return true;
  } catch {
    return false;
  }
}

async function hasConfigValue(git: SimpleGit, key: string): Promise<boolean> {
  try {
    const v = (await git.raw(['config', '--get', key])).trim();
    return v.length > 0;
  } catch {
    return false;
  }
}

/**
 * Set a repo-local fallback for `user.email` / `user.name` if neither the
 * global nor any system-level config is present. Real users with git
 * configured are unaffected; fresh CI machines / newly provisioned dev
 * boxes don't silently fail their initial commit.
 */
async function ensureCommitterIdentity(git: SimpleGit): Promise<void> {
  if (!(await hasConfigValue(git, 'user.email'))) {
    await git.addConfig('user.email', 'factory@factory5.local');
  }
  if (!(await hasConfigValue(git, 'user.name'))) {
    await git.addConfig('user.name', 'factory5');
  }
}

/**
 * Return the current branch name of the project's main working tree.
 * Falls back to `main` if the repo was just initialized without a HEAD.
 */
async function currentBranch(git: SimpleGit): Promise<string> {
  try {
    const name = (await git.raw(['symbolic-ref', '--short', 'HEAD'])).trim();
    if (name.length > 0) return name;
  } catch {
    /* fallthrough */
  }
  try {
    const status = await git.status();
    if (status.current !== null && status.current.length > 0) return status.current;
  } catch {
    /* fallthrough */
  }
  return 'main';
}

/**
 * Idempotent: if the project is not a git repo, initialise it and create an
 * initial commit (staging every tracked-able file, with `.factory/` excluded).
 * Safe to call on every run.
 */
export async function ensureProjectRepo(projectPath: string): Promise<void> {
  if (!(await pathExists(projectPath))) {
    throw new Error(`worktree: project path does not exist: ${projectPath}`);
  }

  const git = simpleGit(projectPath);

  if (!(await isGitRepo(projectPath))) {
    log.info({ projectPath }, 'worktree: git init (project was not a repo)');
    // Pin `main` as the default branch so worktree branches have a deterministic base.
    await git.init(['--initial-branch=main']);
  }

  await ensureGitignoreExcludesFactory(projectPath);
  await ensureCommitterIdentity(git);

  if (!(await hasCommit(git))) {
    log.info({ projectPath }, 'worktree: creating initial commit');
    await git.add(['-A']);
    const status = await git.status();
    if (status.staged.length === 0 && status.created.length === 0) {
      await git.commit('factory: initialise repository', [], { '--allow-empty': null });
    } else {
      await git.commit('factory: initialise repository');
    }
  }
}

/**
 * Allocate a fresh worktree for a task. Creates the `factory/task-<id>`
 * branch off the project's current branch and `git worktree add`s it at
 * `<project>/.factory/worktrees/task-<id>/`.
 *
 * Throws if the worktree path already exists (indicates stale state from a
 * previous run — the caller should remove it or resume explicitly).
 */
export async function allocateWorktree(opts: AllocateOptions): Promise<WorktreeHandle> {
  await ensureProjectRepo(opts.projectPath);

  const git = simpleGit(opts.projectPath);
  const baseBranch = await currentBranch(git);
  const worktreePath = join(opts.projectPath, WORKTREES_SUBDIR, `task-${opts.taskId}`);
  const branch = branchNameFor(opts.taskId);

  if (await pathExists(worktreePath)) {
    throw new Error(`worktree: path already exists: ${worktreePath} — remove it or use resume`);
  }
  await mkdir(join(opts.projectPath, WORKTREES_SUBDIR), { recursive: true });

  log.info(
    { projectPath: opts.projectPath, taskId: opts.taskId, branch, baseBranch, worktreePath },
    'worktree: allocating',
  );

  // `git worktree add -b <branch> <path> <baseBranch>` creates the branch at
  // baseBranch's HEAD and checks it out into a new worktree.
  await git.raw(['worktree', 'add', '-b', branch, worktreePath, baseBranch]);

  return { path: worktreePath, branch, baseBranch };
}

/**
 * Verify that a merge actually advanced the base branch's tip. Detects the
 * silent-no-op merge failure where `git merge` returns exit 0 but the ref
 * never moves (observed under concurrent merges sharing `.git/index.lock`
 * on Windows — I004). Throws with both hashes when HEAD is unchanged.
 *
 * Returns the new HEAD hash on success.
 */
export async function verifyHeadAdvanced(
  git: SimpleGit,
  baseBranch: string,
  preMergeHead: string,
): Promise<string> {
  const postMergeHead = (await git.revparse([baseBranch])).trim();
  if (postMergeHead === preMergeHead) {
    throw new Error(
      `worktree: merge did not advance ${baseBranch} (HEAD still at ${preMergeHead}) — silent merge failure`,
    );
  }
  return postMergeHead;
}

/**
 * Merge the task's branch back into the base branch (`--no-ff` so each merge
 * is a distinct commit), then remove the worktree. On conflict the merge is
 * aborted and the worktree is left in place so the caller can inspect the
 * diff; the error is surfaced.
 *
 * Serialised per project via {@link projectMergeQueues}. See I004.
 */
async function mergeAndRemove(projectPath: string, handle: WorktreeHandle): Promise<void> {
  const key = mergeQueueKey(projectPath);
  const previous = projectMergeQueues.get(key) ?? Promise.resolve();
  // Wait for the previous merge on this project to settle (success OR failure)
  // before starting ours; one failed merge must not skip subsequent ones.
  const next = previous.catch(() => undefined).then(() => doMergeAndRemove(projectPath, handle));
  projectMergeQueues.set(key, next);
  try {
    await next;
  } finally {
    // Drop our entry only if no later caller has chained on top of us; this
    // avoids leaking a Map entry per merge while keeping the chain intact.
    if (projectMergeQueues.get(key) === next) {
      projectMergeQueues.delete(key);
    }
  }
}

async function doMergeAndRemove(projectPath: string, handle: WorktreeHandle): Promise<void> {
  const git = simpleGit(projectPath);
  const wtGit = simpleGit(handle.path);

  // Commit any stray changes inside the worktree so the branch moves.
  const status = await wtGit.status();
  if (status.files.length > 0) {
    log.info(
      { taskId: handle.branch, files: status.files.length },
      'worktree: committing outstanding agent changes before merge',
    );
    await wtGit.add(['-A']);
    await wtGit.commit(`factory: worker output (${handle.branch})`);
  }

  // Switch main repo to the base branch if it isn't already (merge requires it).
  const base = await currentBranch(git);
  if (base !== handle.baseBranch) {
    await git.raw(['checkout', handle.baseBranch]);
  }

  // If the worker produced no commits ahead of base, there's nothing to
  // merge. Skip rather than calling `git merge --no-ff` (which would no-op
  // with "Already up to date." and leave the verification check unable to
  // distinguish that from a silent failure).
  const aheadCount = (
    await git.raw(['rev-list', '--count', `${handle.baseBranch}..${handle.branch}`])
  ).trim();
  if (aheadCount === '0') {
    log.info(
      { taskId: handle.branch, baseBranch: handle.baseBranch },
      'worktree: branch has no new commits — skipping merge',
    );
  } else {
    const preMergeHead = (await git.revparse([handle.baseBranch])).trim();
    try {
      await git.raw(['merge', '--no-ff', '-m', `factory: merge ${handle.branch}`, handle.branch]);
    } catch (err) {
      // Abort the failed merge so the main working tree is clean; re-throw.
      try {
        await git.raw(['merge', '--abort']);
      } catch {
        /* ignore — nothing to abort */
      }
      throw new Error(
        `worktree: merge of ${handle.branch} into ${handle.baseBranch} failed (${(err as Error).message}) — worktree preserved for inspection`,
      );
    }
    // Defense-in-depth: simple-git occasionally returns cleanly from `git
    // merge` even when git left the repo mid-merge with conflicts
    // (observed during Phase 5 close-out on Windows, where the non-zero
    // exit of `git merge --no-ff` on BUILD.md conflicts was swallowed). If
    // `.git/MERGE_HEAD` exists post-command, the merge conflicted —
    // abort and raise so the worker marks the task failed (worktree is
    // preserved by the caller for inspection).
    const mergeHeadPath = join(projectPath, '.git', 'MERGE_HEAD');
    if (await pathExists(mergeHeadPath)) {
      try {
        await git.raw(['merge', '--abort']);
      } catch {
        /* ignore — best effort */
      }
      throw new Error(
        `worktree: merge of ${handle.branch} into ${handle.baseBranch} left repo in MERGING state (conflict swallowed by simple-git); aborted — worktree preserved for inspection`,
      );
    }
    const postMergeHead = await verifyHeadAdvanced(git, handle.baseBranch, preMergeHead);
    log.info(
      {
        taskId: handle.branch,
        baseBranch: handle.baseBranch,
        preMergeHead,
        postMergeHead,
      },
      'worktree: merge advanced base branch',
    );
  }

  // Remove the worktree directory via the porcelain command so git's metadata is pruned.
  await git.raw(['worktree', 'remove', '--force', handle.path]);
  try {
    await git.raw(['branch', '-D', handle.branch]);
  } catch {
    /* branch already removed by worktree remove in some git versions */
  }

  log.info({ taskId: handle.branch }, 'worktree: merged and removed');
}

/**
 * Release a worktree according to the task outcome. Success → merge back +
 * remove; failure → leave in place (logged, tracked, but not reclaimed) so a
 * human can diff the branch.
 */
export async function cleanupWorktree(opts: CleanupOptions): Promise<void> {
  if (opts.outcome === 'success') {
    await mergeAndRemove(opts.projectPath, opts.handle);
    return;
  }
  log.warn(
    {
      projectPath: opts.projectPath,
      worktreePath: opts.handle.path,
      branch: opts.handle.branch,
    },
    'worktree: task failed — leaving worktree in place for inspection',
  );
}

/**
 * Build the deterministic branch name for a task id. Exported so tests /
 * callers that need to reference the branch pre-allocation can match.
 */
export function branchNameFor(taskId: string): string {
  const short = taskId.slice(-8).toLowerCase();
  return `factory/task-${short}`;
}
