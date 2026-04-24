import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { appendBuildLog } from '@factory5/wiki';
import { simpleGit } from 'simple-git';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  WORKTREES_SUBDIR,
  allocateWorktree,
  branchNameFor,
  cleanupWorktree,
  ensureProjectRepo,
  prePurgeDepDirs,
  verifyHeadAdvanced,
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

describe('prePurgeDepDirs (I013)', () => {
  it('removes node_modules when present', async () => {
    const nm = join(projectPath, 'node_modules', 'pkg');
    await mkdir(nm, { recursive: true });
    await writeFile(join(nm, 'index.js'), 'x', 'utf8');
    await prePurgeDepDirs(projectPath);
    expect(await exists(join(projectPath, 'node_modules'))).toBe(false);
  });

  it('also removes .venv and __pycache__ when present', async () => {
    await mkdir(join(projectPath, '.venv', 'lib'), { recursive: true });
    await writeFile(join(projectPath, '.venv', 'lib', 'pyvenv.cfg'), 'x', 'utf8');
    await mkdir(join(projectPath, '__pycache__'), { recursive: true });
    await writeFile(join(projectPath, '__pycache__', 'm.cpython.pyc'), 'x', 'utf8');
    await prePurgeDepDirs(projectPath);
    expect(await exists(join(projectPath, '.venv'))).toBe(false);
    expect(await exists(join(projectPath, '__pycache__'))).toBe(false);
  });

  it('is a no-op when none of the dep dirs exist', async () => {
    await expect(prePurgeDepDirs(projectPath)).resolves.toBeUndefined();
  });
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

  it('cleanup success removes the worktree even when worker left node_modules behind (I013)', async () => {
    // Regression: a Node-project worker that ran `pnpm install` inside its
    // worktree leaves a heavy `node_modules/` tree there. On Windows
    // `git worktree remove --force` then fails with "Directory not empty"
    // because git's --force does not override OS-level deletion refusals.
    // The cleanup path must rimraf node_modules first.
    const taskId = 'NODEMODS123456789ABCDEFGHJ';
    const handle = await allocateWorktree({ projectPath, taskId });
    await writeFile(join(handle.path, 'package.json'), '{"name":"t"}', 'utf8');
    // Simulate a `pnpm install` outcome: a node_modules tree with at least one
    // nested file. `node_modules` is gitignored by default in
    // `ensureProjectRepo`'s gitignore additions only for `.factory/`, so we
    // also commit a .gitignore to keep node_modules untracked here.
    await writeFile(join(handle.path, '.gitignore'), 'node_modules/\n', 'utf8');
    const nm = join(handle.path, 'node_modules', 'fake-pkg');
    await mkdir(nm, { recursive: true });
    await writeFile(join(nm, 'index.js'), 'module.exports = 1;\n', 'utf8');

    await cleanupWorktree({ projectPath, handle, outcome: 'success' });

    expect(await exists(handle.path)).toBe(false);
    expect(await exists(join(projectPath, 'package.json'))).toBe(true);
    expect(await exists(join(projectPath, 'node_modules'))).toBe(false);
  });

  it('cleanup failure preserves the worktree in place', async () => {
    const taskId = 'X1234567890ABCDEFGHJKMNPQR';
    const handle = await allocateWorktree({ projectPath, taskId });

    await cleanupWorktree({ projectPath, handle, outcome: 'failure' });

    expect(await exists(handle.path)).toBe(true);
  });

  it('cleanup success on a branch with no new commits removes worktree without throwing', async () => {
    // Worker subprocess that wrote nothing → branch tip == baseBranch tip.
    // Must not trigger the post-merge HEAD verification (no merge happened).
    const taskId = 'NOOP1234567890ABCDEFGHJKL';
    const handle = await allocateWorktree({ projectPath, taskId });

    await cleanupWorktree({ projectPath, handle, outcome: 'success' });

    expect(await exists(handle.path)).toBe(false);
    const git = simpleGit(projectPath);
    const branches = await git.branch();
    expect(branches.all).not.toContain(handle.branch);
  });

  it('two concurrent successful cleanups on the same project both land in main (I004)', async () => {
    // Regression test for I004 — without per-project merge serialisation the
    // second sibling's merge was logged "merged and removed" but never
    // recorded in main's reflog on Windows. The mechanical test (both files
    // present, both branches removed, both worker commits reachable from
    // main) holds even when the underlying file-lock race doesn't fire on
    // the test host.
    const taskA = '01ABCDEFGHJKMNPQRS-AAAAAAAA';
    const taskB = '01ABCDEFGHJKMNPQRS-BBBBBBBB';

    const handleA = await allocateWorktree({ projectPath, taskId: taskA });
    const handleB = await allocateWorktree({ projectPath, taskId: taskB });

    await writeFile(join(handleA.path, 'a.txt'), 'A content\n', 'utf8');
    await writeFile(join(handleB.path, 'b.txt'), 'B content\n', 'utf8');

    await Promise.all([
      cleanupWorktree({ projectPath, handle: handleA, outcome: 'success' }),
      cleanupWorktree({ projectPath, handle: handleB, outcome: 'success' }),
    ]);

    expect(await exists(join(projectPath, 'a.txt'))).toBe(true);
    expect(await exists(join(projectPath, 'b.txt'))).toBe(true);
    expect(await exists(handleA.path)).toBe(false);
    expect(await exists(handleB.path)).toBe(false);

    const git = simpleGit(projectPath);
    const branches = await git.branch();
    expect(branches.all).not.toContain(handleA.branch);
    expect(branches.all).not.toContain(handleB.branch);

    // Initial commit + worker-A commit + merge-A commit + worker-B commit +
    // merge-B commit = 5 reachable from main.
    const log = await git.log({ maxCount: 20 });
    expect(log.total).toBe(5);
  });

  it('a failing cleanup does not poison subsequent merges on the same project', async () => {
    // The mutex chains via `.catch(() => undefined)` so one failed merge
    // can't skip the next caller's work. Simulate by making cleanup A fail
    // (force its worktree dir to disappear so the porcelain `worktree
    // remove` step throws), then verify cleanup B still lands.
    const taskA = '01ABCDEFGHJKMNPQRS-CCCCCCCC';
    const taskB = '01ABCDEFGHJKMNPQRS-DDDDDDDD';

    const handleA = await allocateWorktree({ projectPath, taskId: taskA });
    const handleB = await allocateWorktree({ projectPath, taskId: taskB });

    await writeFile(join(handleA.path, 'a.txt'), 'A\n', 'utf8');
    await writeFile(join(handleB.path, 'b.txt'), 'B\n', 'utf8');

    // Wipe handleA's worktree dir out from under git to force the cleanup
    // path to throw after the merge (the merge itself can succeed because
    // the branch ref is still valid, but `worktree remove --force` errors
    // when the directory it expects has gone missing).
    // Use a separate sibling directory so we hit a real failure in cleanup
    // A while leaving B intact.
    const cleanupAPromise = cleanupWorktree({
      projectPath,
      handle: { ...handleA, path: join(projectPath, '.factory/worktrees/does-not-exist') },
      outcome: 'success',
    });
    const cleanupBPromise = cleanupWorktree({
      projectPath,
      handle: handleB,
      outcome: 'success',
    });

    const results = await Promise.allSettled([cleanupAPromise, cleanupBPromise]);
    expect(results[0].status).toBe('rejected');
    expect(results[1].status).toBe('fulfilled');

    // Cleanup B must have completed despite A's failure.
    expect(await exists(join(projectPath, 'b.txt'))).toBe(true);
    const git = simpleGit(projectPath);
    const branches = await git.branch();
    expect(branches.all).not.toContain(handleB.branch);
  });

  it('appendBuildLog between task and cleanup does not dirty main (I005)', async () => {
    // Regression for I005. `persistFindings` in run-worker.ts calls
    // appendBuildLog(projectPath, …) after the claude stream finishes and
    // before cleanupWorktree runs. Pre-fix, BUILD.md lived at the project
    // root and was tracked by git — the write left main's working tree
    // with uncommitted changes and the next `git merge --no-ff` aborted
    // with "Your local changes to the following files would be overwritten
    // by merge: BUILD.md". Post-fix, BUILD.md lives under .factory/ (already
    // gitignored), so appendBuildLog leaves main clean and the merge
    // proceeds.
    const taskId = 'I005AAAA1234567890ABCDEFGH';
    const handle = await allocateWorktree({ projectPath, taskId });
    await writeFile(join(handle.path, 'feature.txt'), 'hello\n', 'utf8');

    await appendBuildLog(projectPath, `builder (task ${taskId}) raised 1 finding(s)`);

    const git = simpleGit(projectPath);
    const statusBefore = await git.status();
    expect(statusBefore.files).toEqual([]);

    await cleanupWorktree({ projectPath, handle, outcome: 'success' });

    expect(await exists(handle.path)).toBe(false);
    expect(await exists(join(projectPath, 'feature.txt'))).toBe(true);
    const branches = await git.branch();
    expect(branches.all).not.toContain(handle.branch);
  });
});

describe('verifyHeadAdvanced', () => {
  it('throws when HEAD is unchanged', async () => {
    await ensureProjectRepo(projectPath);
    const git = simpleGit(projectPath);
    const head = (await git.revparse(['main'])).trim();
    await expect(verifyHeadAdvanced(git, 'main', head)).rejects.toThrow(/did not advance/);
  });

  it('returns the new HEAD when the branch has moved', async () => {
    await ensureProjectRepo(projectPath);
    const git = simpleGit(projectPath);
    const before = (await git.revparse(['main'])).trim();
    await writeFile(join(projectPath, 'second.txt'), 'second\n', 'utf8');
    await git.add(['-A']);
    await git.commit('second');
    const after = await verifyHeadAdvanced(git, 'main', before);
    expect(after).not.toBe(before);
    expect(after).toMatch(/^[0-9a-f]{40}$/);
  });
});
