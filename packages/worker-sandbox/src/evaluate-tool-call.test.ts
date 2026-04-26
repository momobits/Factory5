/**
 * Tests for the gate function — the write-vs-read asymmetry, the
 * F001 replay (worker tries to read out-of-scope from parent project),
 * cross-platform out-of-scope cases, and the symlink rejection branch.
 */

import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { evaluateToolCall } from './evaluate-tool-call.js';
import type { WorkerSandboxConfig } from './types.js';

const onWindows = process.platform === 'win32';

/** Build a typical Phase 12 config for a project at `<projectPath>` with worktree `<worktreePath>`. */
function makeConfig(projectPath: string, worktreePath: string): WorkerSandboxConfig {
  return {
    workspaceRoots: [worktreePath],
    readOnlyRoots: [join(projectPath, '.factory'), '/repo/templates'],
    allowSymlinks: false,
  };
}

const PROJECT = onWindows ? 'C:\\repo\\proj' : '/repo/proj';
const WORKTREE = onWindows
  ? 'C:\\repo\\proj\\.factory\\worktrees\\task-01ABC'
  : '/repo/proj/.factory/worktrees/task-01ABC';

const NEVER_SYMLINK = (): boolean => false;

describe('evaluateToolCall — write-vs-read asymmetry (ADR 0028 §5)', () => {
  const config = makeConfig(PROJECT, WORKTREE);

  it('Read inside the worktree → allow', () => {
    const result = evaluateToolCall(
      {
        toolName: 'Read',
        toolInput: { file_path: join(WORKTREE, 'src', 'main.ts') },
        cwd: WORKTREE,
        config,
      },
      { isSymlink: NEVER_SYMLINK },
    );
    expect(result.decision).toBe('allow');
  });

  it('Read inside readOnlyRoots → allow', () => {
    const result = evaluateToolCall(
      {
        toolName: 'Read',
        toolInput: { file_path: join(PROJECT, '.factory', 'findings.json') },
        cwd: WORKTREE,
        config,
      },
      { isSymlink: NEVER_SYMLINK },
    );
    expect(result.decision).toBe('allow');
  });

  it('Write inside the worktree → allow', () => {
    const result = evaluateToolCall(
      {
        toolName: 'Write',
        toolInput: { file_path: join(WORKTREE, 'BUILD.md') },
        cwd: WORKTREE,
        config,
      },
      { isSymlink: NEVER_SYMLINK },
    );
    expect(result.decision).toBe('allow');
  });

  it('Edit inside the worktree → allow', () => {
    const result = evaluateToolCall(
      {
        toolName: 'Edit',
        toolInput: { file_path: join(WORKTREE, 'src', 'main.ts') },
        cwd: WORKTREE,
        config,
      },
      { isSymlink: NEVER_SYMLINK },
    );
    expect(result.decision).toBe('allow');
  });

  it('Write into readOnlyRoots → deny (write asymmetry)', () => {
    const result = evaluateToolCall(
      {
        toolName: 'Write',
        toolInput: { file_path: join(PROJECT, '.factory', 'findings.json') },
        cwd: WORKTREE,
        config,
      },
      { isSymlink: NEVER_SYMLINK },
    );
    expect(result.decision).toBe('deny');
    expect(result.reason).toContain('outside the worker');
  });

  it('Edit into readOnlyRoots → deny (write asymmetry)', () => {
    const result = evaluateToolCall(
      {
        toolName: 'Edit',
        toolInput: { file_path: join(PROJECT, '.factory', 'findings.json') },
        cwd: WORKTREE,
        config,
      },
      { isSymlink: NEVER_SYMLINK },
    );
    expect(result.decision).toBe('deny');
  });
});

describe('evaluateToolCall — F001 replay scenario (parent-checkout reads denied)', () => {
  const config = makeConfig(PROJECT, WORKTREE);

  it('reading a sibling file in the project (not in .factory) is denied', () => {
    // The project's own README.md is NOT in any allowed root: workspaceRoots
    // is the worktree only; readOnlyRoots is project/.factory + templates.
    const result = evaluateToolCall(
      {
        toolName: 'Read',
        toolInput: { file_path: join(PROJECT, 'README.md') },
        cwd: WORKTREE,
        config,
      },
      { isSymlink: NEVER_SYMLINK },
    );
    expect(result.decision).toBe('deny');
  });

  it('reading the parent factory5 checkout is denied', () => {
    // The verifier-hallucination case: worker traverses upward into the
    // factory5 build that hosts the project workspace.
    const factory5 = onWindows
      ? 'C:\\repo\\factory5\\node_modules\\foo'
      : '/repo/factory5/node_modules/foo';
    const result = evaluateToolCall(
      {
        toolName: 'Read',
        toolInput: { file_path: factory5 },
        cwd: WORKTREE,
        config,
      },
      { isSymlink: NEVER_SYMLINK },
    );
    expect(result.decision).toBe('deny');
  });

  it('relative path traversal that escapes the worktree (and .factory) is denied', () => {
    // From task-01ABC the `..` chain is: worktrees → .factory → proj.
    // Three levels up + README.md lands at <project>/README.md, which is
    // NOT in workspaceRoots (worktree only) and NOT in readOnlyRoots
    // (project/.factory + repo/templates) — out of scope, denied.
    const result = evaluateToolCall(
      {
        toolName: 'Read',
        toolInput: { file_path: '../../../README.md' },
        cwd: WORKTREE,
        config,
      },
      { isSymlink: NEVER_SYMLINK },
    );
    expect(result.decision).toBe('deny');
  });

  it('relative .. that lands inside .factory IS allowed (read-only-root reach)', () => {
    // Sanity check the algebra: `../../findings.json` from task-01ABC
    // resolves to <project>/.factory/findings.json — in readOnlyRoots,
    // so reads succeed (writes still fail per the asymmetry).
    const result = evaluateToolCall(
      {
        toolName: 'Read',
        toolInput: { file_path: '../../findings.json' },
        cwd: WORKTREE,
        config,
      },
      { isSymlink: NEVER_SYMLINK },
    );
    expect(result.decision).toBe('allow');
  });

  it('relative path within the worktree is allowed (sanity)', () => {
    const result = evaluateToolCall(
      {
        toolName: 'Read',
        toolInput: { file_path: 'src/main.ts' },
        cwd: WORKTREE,
        config,
      },
      { isSymlink: NEVER_SYMLINK },
    );
    expect(result.decision).toBe('allow');
  });
});

describe('evaluateToolCall — cross-platform out-of-scope (ADR 0028 §3)', () => {
  const config = makeConfig(PROJECT, WORKTREE);

  it.skipIf(onWindows)('Linux: Read(/etc/passwd) → deny', () => {
    const result = evaluateToolCall(
      {
        toolName: 'Read',
        toolInput: { file_path: '/etc/passwd' },
        cwd: WORKTREE,
        config,
      },
      { isSymlink: NEVER_SYMLINK },
    );
    expect(result.decision).toBe('deny');
    expect(result.reason).toContain('/etc/passwd');
  });

  it.skipIf(!onWindows)('Windows: Read(hosts file) → deny', () => {
    const result = evaluateToolCall(
      {
        toolName: 'Read',
        toolInput: { file_path: 'C:/Windows/System32/drivers/etc/hosts' },
        cwd: WORKTREE,
        config,
      },
      { isSymlink: NEVER_SYMLINK },
    );
    expect(result.decision).toBe('deny');
  });

  it.skipIf(!onWindows)('Windows: Read(~\\.ssh\\id_rsa equivalent) → deny', () => {
    // Using a concrete absolute path the algebra would reject.
    const result = evaluateToolCall(
      {
        toolName: 'Read',
        toolInput: { file_path: 'C:/Users/Momo/.ssh/id_rsa' },
        cwd: WORKTREE,
        config,
      },
      { isSymlink: NEVER_SYMLINK },
    );
    expect(result.decision).toBe('deny');
  });
});

describe('evaluateToolCall — symlink rejection (ADR 0028 §2)', () => {
  const config = makeConfig(PROJECT, WORKTREE);

  it('a symlink is denied even if the path itself is in scope', () => {
    const result = evaluateToolCall(
      {
        toolName: 'Read',
        toolInput: { file_path: join(WORKTREE, 'node_modules', 'foo') },
        cwd: WORKTREE,
        config,
      },
      { isSymlink: () => true },
    );
    expect(result.decision).toBe('deny');
    expect(result.reason).toContain('Symlink');
  });

  it('an in-scope non-symlink is allowed', () => {
    const result = evaluateToolCall(
      {
        toolName: 'Read',
        toolInput: { file_path: join(WORKTREE, 'src', 'main.ts') },
        cwd: WORKTREE,
        config,
      },
      { isSymlink: () => false },
    );
    expect(result.decision).toBe('allow');
  });

  it('symlink check skipped when allowSymlinks=true', () => {
    const looseConfig: WorkerSandboxConfig = { ...config, allowSymlinks: true };
    const result = evaluateToolCall(
      {
        toolName: 'Read',
        toolInput: { file_path: join(WORKTREE, 'node_modules', 'foo') },
        cwd: WORKTREE,
        config: looseConfig,
      },
      { isSymlink: () => true },
    );
    expect(result.decision).toBe('allow');
  });
});

describe('evaluateToolCall — non-gated tools fall through', () => {
  const config = makeConfig(PROJECT, WORKTREE);

  it('Bash is not gated by the hook (returns allow)', () => {
    const result = evaluateToolCall(
      {
        toolName: 'Bash',
        toolInput: { command: 'cat /etc/passwd' },
        cwd: WORKTREE,
        config,
      },
      { isSymlink: NEVER_SYMLINK },
    );
    expect(result.decision).toBe('allow');
    expect(result.reason).toContain('not gated');
  });

  it('an unknown tool returns allow (defers to permissions.deny in settings)', () => {
    const result = evaluateToolCall(
      {
        toolName: 'CustomTool',
        toolInput: {},
        cwd: WORKTREE,
        config,
      },
      { isSymlink: NEVER_SYMLINK },
    );
    expect(result.decision).toBe('allow');
  });

  it('mcp__factory5-ask-user__ask_user is not gated', () => {
    const result = evaluateToolCall(
      {
        toolName: 'mcp__factory5-ask-user__ask_user',
        toolInput: { question: 'something' },
        cwd: WORKTREE,
        config,
      },
      { isSymlink: NEVER_SYMLINK },
    );
    expect(result.decision).toBe('allow');
  });
});

describe('evaluateToolCall — input validation', () => {
  const config = makeConfig(PROJECT, WORKTREE);

  it('Read with no file_path → deny (suspicious)', () => {
    const result = evaluateToolCall(
      {
        toolName: 'Read',
        toolInput: {},
        cwd: WORKTREE,
        config,
      },
      { isSymlink: NEVER_SYMLINK },
    );
    expect(result.decision).toBe('deny');
    expect(result.reason).toContain('without a parseable path');
  });

  it('Glob with `path` field uses that as the candidate', () => {
    const result = evaluateToolCall(
      {
        toolName: 'Glob',
        toolInput: { path: WORKTREE, pattern: '**/*.ts' },
        cwd: WORKTREE,
        config,
      },
      { isSymlink: NEVER_SYMLINK },
    );
    expect(result.decision).toBe('allow');
  });

  it('Glob with no `path` falls back to fixed-prefix of `pattern`', () => {
    const result = evaluateToolCall(
      {
        toolName: 'Glob',
        toolInput: { pattern: 'src/**/*.ts' },
        cwd: WORKTREE,
        config,
      },
      { isSymlink: NEVER_SYMLINK },
    );
    expect(result.decision).toBe('allow');
  });

  it('Glob with bare `**` resolves to `.` (cwd) and is allowed', () => {
    const result = evaluateToolCall(
      {
        toolName: 'Glob',
        toolInput: { pattern: '**/*.ts' },
        cwd: WORKTREE,
        config,
      },
      { isSymlink: NEVER_SYMLINK },
    );
    expect(result.decision).toBe('allow');
  });

  it('Grep with `path` field uses that as the candidate', () => {
    const result = evaluateToolCall(
      {
        toolName: 'Grep',
        toolInput: { pattern: 'foo', path: '/etc' },
        cwd: WORKTREE,
        config,
      },
      { isSymlink: NEVER_SYMLINK },
    );
    expect(result.decision).toBe('deny');
  });

  it('Grep with no `path` defaults to cwd → allowed', () => {
    const result = evaluateToolCall(
      {
        toolName: 'Grep',
        toolInput: { pattern: 'foo' },
        cwd: WORKTREE,
        config,
      },
      { isSymlink: NEVER_SYMLINK },
    );
    expect(result.decision).toBe('allow');
  });
});

describe('evaluateToolCall — reason field surface', () => {
  const config = makeConfig(PROJECT, WORKTREE);

  it('deny reason names the resolved path', () => {
    const offending = join(PROJECT, 'README.md');
    const result = evaluateToolCall(
      {
        toolName: 'Read',
        toolInput: { file_path: offending },
        cwd: WORKTREE,
        config,
      },
      { isSymlink: NEVER_SYMLINK },
    );
    expect(result.decision).toBe('deny');
    expect(result.reason).toContain(offending);
  });

  it('deny reason lists allowed roots, not deny rules (no evasion hints)', () => {
    const result = evaluateToolCall(
      {
        toolName: 'Read',
        toolInput: { file_path: join(PROJECT, 'README.md') },
        cwd: WORKTREE,
        config,
      },
      { isSymlink: NEVER_SYMLINK },
    );
    expect(result.reason).toContain('Allowed write roots');
    expect(result.reason).toContain('Allowed read roots');
    expect(result.reason).not.toMatch(/deny rule|evasion|blocked-pattern/i);
  });
});
