import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { simpleGit } from 'simple-git';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  WORKTREES_SUBDIR,
  allocateWorktree,
  branchNameFor,
  cleanupWorktree,
  ensureProjectRepo,
} from './worktree.js';

let projectPath: string;

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

beforeEach(async () => {
  projectPath = await mkdtemp(join(tmpdir(), 'factory5-wt-'));
  await writeFile(join(projectPath, 'README.md'), '# project\n', 'utf8');
});

afterEach(async () => {
  await rm(projectPath, { recursive: true, force: true }).catch(() => undefined);
});

describe('branchNameFor', () => {
  it('uses the trailing 8 chars of the taskId, lowercased', () => {
    expect(branchNameFor('01HXABCDEFGHJKMNPQRSTVWXYZ')).toBe('factory/task-rstvwxyz');
    expect(branchNameFor('AAAA1234567890')).toBe('factory/task-34567890');
  });
});

describe('ensureProjectRepo', () => {
  it('initialises a git repo + makes an initial commit', async () => {
    await ensureProjectRepo(projectPath);
    const git = simpleGit(projectPath);
    const head = await git.revparse(['HEAD']);
    expect(head).toMatch(/^[0-9a-f]{40}$/);
  });

  it('is idempotent (no new commits on re-invocation)', async () => {
    await ensureProjectRepo(projectPath);
    const git = simpleGit(projectPath);
    const before = (await git.log()).total;
    await ensureProjectRepo(projectPath);
    await ensureProjectRepo(projectPath);
    const after = (await git.log()).total;
    expect(after).toBe(before);
  });

  it('adds .factory/ to .gitignore', async () => {
    await ensureProjectRepo(projectPath);
    const gitignore = await readFile(join(projectPath, '.gitignore'), 'utf8');
    expect(gitignore).toMatch(/\.factory\/?/);
  });

  it('does not duplicate .factory/ when .gitignore already contains it', async () => {
    await writeFile(join(projectPath, '.gitignore'), 'node_modules\n.factory/\n', 'utf8');
    await ensureProjectRepo(projectPath);
    const gitignore = await readFile(join(projectPath, '.gitignore'), 'utf8');
    const matches = gitignore.match(/^\.factory\/?$/gm);
    expect(matches).not.toBeNull();
    expect((matches as RegExpMatchArray).length).toBe(1);
  });
});

describe('allocateWorktree + cleanupWorktree', () => {
  it('creates a worktree at .factory/worktrees/task-<id>/ on a new branch', async () => {
    const taskId = 'ABCDEFGHJKMNPQRSTVWXYZ1234';
    const handle = await allocateWorktree({ projectPath, taskId });
    expect(handle.path).toBe(join(projectPath, WORKTREES_SUBDIR, `task-${taskId}`));
    expect(handle.branch).toBe(branchNameFor(taskId));
    expect(handle.baseBranch).toBe('main');
    expect(await exists(handle.path)).toBe(true);

    const wtGit = simpleGit(handle.path);
    const current = (await wtGit.raw(['symbolic-ref', '--short', 'HEAD'])).trim();
    expect(current).toBe(handle.branch);
  });

  it('throws when the worktree path already exists', async () => {
    const taskId = 'Z1234567890ABCDEFGHJKMNPQR';
    await allocateWorktree({ projectPath, taskId });
    await expect(allocateWorktree({ projectPath, taskId })).rejects.toThrow(/already exists/);
  });

  it('cleanup success merges branch back and removes the worktree', async () => {
    const taskId = 'Y1234567890ABCDEFGHJKMNPQR';
    const handle = await allocateWorktree({ projectPath, taskId });
    await writeFile(join(handle.path, 'feature.txt'), 'hello', 'utf8');

    await cleanupWorktree({ projectPath, handle, outcome: 'success' });

    expect(await exists(handle.path)).toBe(false);
    expect(await exists(join(projectPath, 'feature.txt'))).toBe(true);
    const git = simpleGit(projectPath);
    const branches = await git.branch();
    expect(branches.all).not.toContain(handle.branch);
  });

  it('cleanup failure preserves the worktree in place', async () => {
    const taskId = 'X1234567890ABCDEFGHJKMNPQR';
    const handle = await allocateWorktree({ projectPath, taskId });

    await cleanupWorktree({ projectPath, handle, outcome: 'failure' });

    expect(await exists(handle.path)).toBe(true);
  });
});
