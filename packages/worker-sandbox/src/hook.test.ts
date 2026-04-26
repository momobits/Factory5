/**
 * Tests for the pure hook runtime — the function that turns Claude
 * Code's stdin JSON + a parsed `WorkerSandboxConfig` into the exact
 * stdout / stderr / exitCode bytes the subprocess should emit.
 *
 * The thin script in `hook-runtime.ts` is unverified at unit-test time;
 * its only job is reading argv[2] + stdin and calling `runHook`.
 */

import { describe, expect, it } from 'vitest';

import { parseSandboxConfig, runHook } from './hook.js';
import type { HookOutput, WorkerSandboxConfig } from './types.js';

const FROZEN_TS = '2026-04-26T00:00:00.000Z';

const onWindows = process.platform === 'win32';
const WORKTREE = onWindows
  ? 'C:\\proj\\.factory\\worktrees\\task-X'
  : '/proj/.factory/worktrees/task-X';
const config: WorkerSandboxConfig = {
  workspaceRoots: [WORKTREE],
  readOnlyRoots: [onWindows ? 'C:\\proj\\.factory' : '/proj/.factory'],
  allowSymlinks: false,
};

function parseStdoutDecision(stdout: string): HookOutput {
  return JSON.parse(stdout.trim()) as HookOutput;
}

describe('runHook — happy paths', () => {
  it('Read in-scope → allow + exitCode 0 + audit line', () => {
    const stdinText = JSON.stringify({
      tool_name: 'Read',
      tool_input: {
        file_path: onWindows
          ? 'C:\\proj\\.factory\\worktrees\\task-X\\src\\main.ts'
          : '/proj/.factory/worktrees/task-X/src/main.ts',
      },
      cwd: WORKTREE,
      permission_mode: 'acceptEdits',
    });
    const result = runHook({ stdinText, config }, { nowIso: FROZEN_TS });
    expect(result.exitCode).toBe(0);
    const decision = parseStdoutDecision(result.stdout);
    expect(decision.hookSpecificOutput.permissionDecision).toBe('allow');
    expect(decision.hookSpecificOutput.hookEventName).toBe('PreToolUse');
    expect(result.stderr).toContain('factory5.worker.sandbox');
    expect(result.stderr).toContain('"event":"sandbox.gate"');
    expect(result.stderr).toContain('"decision":"allow"');
    expect(result.stderr).toContain(FROZEN_TS);
  });

  it('Read out-of-scope → deny + exitCode 0 + reason', () => {
    const stdinText = JSON.stringify({
      tool_name: 'Read',
      tool_input: { file_path: onWindows ? 'C:\\Users\\Momo\\.ssh\\id_rsa' : '/etc/passwd' },
      cwd: WORKTREE,
    });
    const result = runHook({ stdinText, config }, { nowIso: FROZEN_TS });
    expect(result.exitCode).toBe(0);
    const decision = parseStdoutDecision(result.stdout);
    expect(decision.hookSpecificOutput.permissionDecision).toBe('deny');
    expect(decision.hookSpecificOutput.permissionDecisionReason).toContain('outside the worker');
    expect(result.stderr).toContain('"decision":"deny"');
    expect(result.stderr).toContain('"reason":');
  });

  it('Bash → allow (not gated by hook)', () => {
    const stdinText = JSON.stringify({
      tool_name: 'Bash',
      tool_input: { command: 'cat /etc/passwd' },
      cwd: WORKTREE,
    });
    const result = runHook({ stdinText, config });
    expect(result.exitCode).toBe(0);
    expect(parseStdoutDecision(result.stdout).hookSpecificOutput.permissionDecision).toBe('allow');
  });

  it('Write to readOnlyRoots → deny (write asymmetry)', () => {
    const stdinText = JSON.stringify({
      tool_name: 'Write',
      tool_input: {
        file_path: onWindows ? 'C:\\proj\\.factory\\findings.json' : '/proj/.factory/findings.json',
      },
      cwd: WORKTREE,
    });
    const result = runHook({ stdinText, config });
    expect(result.exitCode).toBe(0);
    expect(parseStdoutDecision(result.stdout).hookSpecificOutput.permissionDecision).toBe('deny');
  });
});

describe('runHook — input-validation paths', () => {
  it('malformed JSON stdin → deny + exitCode 1', () => {
    const result = runHook({ stdinText: '{ this is not json', config });
    expect(result.exitCode).toBe(1);
    const decision = parseStdoutDecision(result.stdout);
    expect(decision.hookSpecificOutput.permissionDecision).toBe('deny');
    expect(decision.hookSpecificOutput.permissionDecisionReason).toContain('parse stdin');
    expect(result.stderr).toContain('"event":"sandbox.gate.error"');
  });

  it('stdin missing tool_name → deny + exitCode 1', () => {
    const stdinText = JSON.stringify({ cwd: WORKTREE, tool_input: {} });
    const result = runHook({ stdinText, config });
    expect(result.exitCode).toBe(1);
    expect(parseStdoutDecision(result.stdout).hookSpecificOutput.permissionDecision).toBe('deny');
  });

  it('stdin missing cwd → deny + exitCode 1', () => {
    const stdinText = JSON.stringify({ tool_name: 'Read', tool_input: { file_path: '/x' } });
    const result = runHook({ stdinText, config });
    expect(result.exitCode).toBe(1);
    expect(parseStdoutDecision(result.stdout).hookSpecificOutput.permissionDecision).toBe('deny');
  });

  it('null stdin → deny + exitCode 1', () => {
    const result = runHook({ stdinText: 'null', config });
    expect(result.exitCode).toBe(1);
    expect(parseStdoutDecision(result.stdout).hookSpecificOutput.permissionDecision).toBe('deny');
  });

  it('tool_input missing → coerced to empty object → deny on path-shaped tools', () => {
    const stdinText = JSON.stringify({ tool_name: 'Read', cwd: WORKTREE });
    const result = runHook({ stdinText, config });
    // Read with no file_path is "suspicious" — denied.
    expect(parseStdoutDecision(result.stdout).hookSpecificOutput.permissionDecision).toBe('deny');
  });
});

describe('parseSandboxConfig', () => {
  it('accepts a valid config', () => {
    const cfg = parseSandboxConfig({
      workspaceRoots: ['/a'],
      readOnlyRoots: ['/b'],
      allowSymlinks: false,
    });
    expect(cfg.workspaceRoots).toEqual(['/a']);
    expect(cfg.allowSymlinks).toBe(false);
  });

  it('rejects non-object input', () => {
    expect(() => parseSandboxConfig(null)).toThrow();
    expect(() => parseSandboxConfig('string')).toThrow();
    expect(() => parseSandboxConfig(42)).toThrow();
  });

  it('rejects missing workspaceRoots', () => {
    expect(() => parseSandboxConfig({ readOnlyRoots: [], allowSymlinks: false })).toThrow(
      /workspaceRoots/,
    );
  });

  it('rejects non-string entries in workspaceRoots', () => {
    expect(() =>
      parseSandboxConfig({ workspaceRoots: [1, 2], readOnlyRoots: [], allowSymlinks: false }),
    ).toThrow(/workspaceRoots/);
  });

  it('rejects missing allowSymlinks', () => {
    expect(() => parseSandboxConfig({ workspaceRoots: [], readOnlyRoots: [] })).toThrow(
      /allowSymlinks/,
    );
  });

  it('rejects non-boolean allowSymlinks', () => {
    expect(() =>
      parseSandboxConfig({
        workspaceRoots: [],
        readOnlyRoots: [],
        allowSymlinks: 'yes',
      }),
    ).toThrow(/allowSymlinks/);
  });
});

describe('runHook — output format', () => {
  it('stdout is newline-terminated JSON', () => {
    const stdinText = JSON.stringify({
      tool_name: 'Read',
      tool_input: { file_path: WORKTREE },
      cwd: WORKTREE,
    });
    const result = runHook({ stdinText, config });
    expect(result.stdout.endsWith('\n')).toBe(true);
    expect(() => JSON.parse(result.stdout.trim())).not.toThrow();
  });

  it('stderr audit line is newline-terminated', () => {
    const stdinText = JSON.stringify({
      tool_name: 'Read',
      tool_input: { file_path: WORKTREE },
      cwd: WORKTREE,
    });
    const result = runHook({ stdinText, config });
    expect(result.stderr.endsWith('\n')).toBe(true);
  });

  it('audit line has the expected schema', () => {
    const stdinText = JSON.stringify({
      tool_name: 'Read',
      tool_input: { file_path: WORKTREE },
      cwd: WORKTREE,
    });
    const result = runHook({ stdinText, config }, { nowIso: FROZEN_TS });
    const auditPrefix = 'factory5.worker.sandbox ';
    expect(result.stderr.startsWith(auditPrefix)).toBe(true);
    const parsed = JSON.parse(result.stderr.slice(auditPrefix.length).trim()) as Record<
      string,
      unknown
    >;
    expect(parsed.event).toBe('sandbox.gate');
    expect(parsed.tool).toBe('Read');
    expect(parsed.decision).toBe('allow');
    expect(parsed.ts).toBe(FROZEN_TS);
  });
});
