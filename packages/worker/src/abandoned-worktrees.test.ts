import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { listAbandonedWorktrees } from './abandoned-worktrees.js';

describe('listAbandonedWorktrees', () => {
  let projectPath: string;

  beforeEach(async () => {
    projectPath = await mkdtemp(join(tmpdir(), 'factory5-abandoned-'));
  });

  afterEach(async () => {
    await rm(projectPath, { recursive: true, force: true }).catch(() => undefined);
  });

  it('returns empty when no worktrees directory on disk', async () => {
    const result = await listAbandonedWorktrees({ projectPath, activeTaskIds: [] });
    expect(result).toEqual([]);
  });

  it('returns empty when worktrees directory exists but is empty', async () => {
    await mkdir(join(projectPath, '.factory', 'worktrees'), { recursive: true });
    const result = await listAbandonedWorktrees({ projectPath, activeTaskIds: [] });
    expect(result).toEqual([]);
  });

  it('flags worktree directories not in activeTaskIds', async () => {
    await mkdir(join(projectPath, '.factory', 'worktrees', 'task-01ABANDONED'), { recursive: true });
    await mkdir(join(projectPath, '.factory', 'worktrees', 'task-01ACTIVE'), { recursive: true });
    const result = await listAbandonedWorktrees({
      projectPath,
      activeTaskIds: ['01ACTIVE'],
    });
    expect(result.length).toBe(1);
    expect(result[0]?.path).toContain('task-01ABANDONED');
    expect(result[0]?.taskId).toBe('01ABANDONED');
    expect(result[0]?.abandonedSince).toBeInstanceOf(Date);
  });

  it('ignores non-task- prefixed directories', async () => {
    await mkdir(join(projectPath, '.factory', 'worktrees', 'task-01REAL'), { recursive: true });
    await mkdir(join(projectPath, '.factory', 'worktrees', 'README.md'), { recursive: true });
    await mkdir(join(projectPath, '.factory', 'worktrees', 'random-junk'), { recursive: true });
    const result = await listAbandonedWorktrees({
      projectPath,
      activeTaskIds: [],
    });
    expect(result.length).toBe(1);
    expect(result[0]?.taskId).toBe('01REAL');
  });
});
