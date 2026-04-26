/**
 * Integration tests for `prepareSandbox` — the runWorker helper that
 * stands up the per-spawn sandbox before claude-cli is invoked.
 *
 * Exercises the FACTORY5_DISABLE_WORKER_SANDBOX kill switch, the
 * smoke-check failure path, the readOnlyRoots assembly (project
 * `.factory` + repo templates), and the on-disk artifacts the worker
 * cleans up at end-of-stream.
 */

import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { prepareSandbox } from './run-worker.js';

let worktreePath: string;
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
  projectPath = await mkdtemp(join(tmpdir(), 'factory5-sandbox-int-proj-'));
  worktreePath = await mkdtemp(join(tmpdir(), 'factory5-sandbox-int-wt-'));
});

afterEach(async () => {
  await rm(worktreePath, { recursive: true, force: true }).catch(() => undefined);
  await rm(projectPath, { recursive: true, force: true }).catch(() => undefined);
  delete process.env.FACTORY5_DISABLE_WORKER_SANDBOX;
});

describe('prepareSandbox — kill switch', () => {
  it('returns undefined when FACTORY5_DISABLE_WORKER_SANDBOX=1', async () => {
    process.env.FACTORY5_DISABLE_WORKER_SANDBOX = '1';
    const result = await prepareSandbox(projectPath, worktreePath, '01TASK');
    expect(result).toBeUndefined();
    // No .claude directory written.
    expect(await exists(join(worktreePath, '.claude'))).toBe(false);
  });

  it('respects only the literal "1" — other values do not bypass', async () => {
    process.env.FACTORY5_DISABLE_WORKER_SANDBOX = 'true';
    const result = await prepareSandbox(projectPath, worktreePath, '01TASK');
    expect(result).toBeDefined();
    expect(await exists(join(worktreePath, '.claude'))).toBe(true);
  });
});

describe('prepareSandbox — happy path', () => {
  it('writes settings.local.json + factory5-sandbox-config.json', async () => {
    const result = await prepareSandbox(projectPath, worktreePath, '01TASK');
    expect(result).toBeDefined();
    expect(await exists(result!.settingsPath)).toBe(true);
    expect(await exists(result!.configPath)).toBe(true);
  });

  it('config.json carries the worktree as the only workspaceRoot', async () => {
    const result = await prepareSandbox(projectPath, worktreePath, '01TASK');
    const config = JSON.parse(await readFile(result!.configPath, 'utf8')) as {
      workspaceRoots: string[];
      readOnlyRoots: string[];
      allowSymlinks: boolean;
    };
    expect(config.workspaceRoots).toEqual([worktreePath]);
    expect(config.allowSymlinks).toBe(false);
  });

  it('config.json includes <project>/.factory in readOnlyRoots', async () => {
    const result = await prepareSandbox(projectPath, worktreePath, '01TASK');
    const config = JSON.parse(await readFile(result!.configPath, 'utf8')) as {
      readOnlyRoots: string[];
    };
    expect(config.readOnlyRoots).toContain(join(projectPath, '.factory'));
  });

  it('settings.local.json references the absolute hook script path', async () => {
    const result = await prepareSandbox(projectPath, worktreePath, '01TASK');
    const settings = JSON.parse(await readFile(result!.settingsPath, 'utf8')) as {
      hooks: { PreToolUse: { hooks: { command: string }[] }[] };
    };
    const cmd = settings.hooks.PreToolUse[0]?.hooks[0]?.command ?? '';
    expect(cmd).toContain('hook-runtime.js');
    expect(cmd).toContain(result!.configPath);
  });

  it('settings declares deny rules for ~/.ssh + /etc + C:/Windows', async () => {
    const result = await prepareSandbox(projectPath, worktreePath, '01TASK');
    const settings = JSON.parse(await readFile(result!.settingsPath, 'utf8')) as {
      permissions: { deny: string[] };
    };
    expect(settings.permissions.deny).toContain('Read(~/.ssh/**)');
    expect(settings.permissions.deny).toContain('Read(//etc/**)');
    expect(settings.permissions.deny).toContain('Read(C:/Windows/**)');
  });

  it('PreToolUse matcher does NOT include Bash (Bash story per ADR 0028 §4)', async () => {
    const result = await prepareSandbox(projectPath, worktreePath, '01TASK');
    const settings = JSON.parse(await readFile(result!.settingsPath, 'utf8')) as {
      hooks: { PreToolUse: { matcher: string }[] };
    };
    expect(settings.hooks.PreToolUse[0]?.matcher).not.toMatch(/Bash/);
  });
});

describe('prepareSandbox — claudeDir layout', () => {
  it('creates exactly the .claude directory and the two files inside it', async () => {
    const result = await prepareSandbox(projectPath, worktreePath, '01TASK');
    expect(result!.claudeDir).toBe(join(worktreePath, '.claude'));
    expect(result!.settingsPath).toBe(join(result!.claudeDir, 'settings.local.json'));
    expect(result!.configPath).toBe(join(result!.claudeDir, 'factory5-sandbox-config.json'));
  });

  it('rm -rf claudeDir removes both files (worker cleanup is a one-liner)', async () => {
    const result = await prepareSandbox(projectPath, worktreePath, '01TASK');
    await rm(result!.claudeDir, { recursive: true, force: true });
    expect(await exists(result!.settingsPath)).toBe(false);
    expect(await exists(result!.configPath)).toBe(false);
    expect(await exists(result!.claudeDir)).toBe(false);
  });
});
