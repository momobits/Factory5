/**
 * Tests for the settings-file writer + the helpers that build it.
 *
 * `buildSandboxSettings` and `buildHookCommand` are pure; assert against
 * the literal shape Claude Code consumes. `writeWorktreeSandbox` writes
 * to a real tmpdir and the test reads back the JSON to verify the
 * round-trip.
 */

import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  buildHookCommand,
  buildSandboxSettings,
  getHookScriptPath,
  writeWorktreeSandbox,
} from './settings.js';
import type { WorkerSandboxConfig } from './types.js';

describe('buildHookCommand', () => {
  it('quotes every path so spaces survive shell parsing', () => {
    const cmd = buildHookCommand({
      nodeBinary: 'C:\\Program Files\\nodejs\\node.exe',
      hookScriptPath: 'D:\\path with spaces\\hook.js',
      configPath: 'E:\\config.json',
    });
    expect(cmd).toBe(
      '"C:\\Program Files\\nodejs\\node.exe" "D:\\path with spaces\\hook.js" "E:\\config.json"',
    );
  });

  it('produces a Linux-shape command line on Linux paths', () => {
    const cmd = buildHookCommand({
      nodeBinary: '/usr/local/bin/node',
      hookScriptPath: '/repo/dist/hook.js',
      configPath: '/repo/config.json',
    });
    expect(cmd).toBe('"/usr/local/bin/node" "/repo/dist/hook.js" "/repo/config.json"');
  });
});

describe('buildSandboxSettings', () => {
  const baseHookCommand = '"node" "/h.js" "/c.json"';

  it('produces permissions.deny with the static rule list', () => {
    const settings = buildSandboxSettings({
      hookCommand: baseHookCommand,
      additionalDirectories: [],
    });
    expect(Array.isArray(settings.permissions.deny)).toBe(true);
    expect(settings.permissions.deny.length).toBeGreaterThan(0);
    // Spot-check a few canonical danger zones.
    expect(settings.permissions.deny).toContain('Read(~/.ssh/**)');
    expect(settings.permissions.deny).toContain('Read(//etc/**)');
    expect(settings.permissions.deny).toContain('Read(C:/Windows/**)');
  });

  it('registers exactly one PreToolUse hook group', () => {
    const settings = buildSandboxSettings({
      hookCommand: baseHookCommand,
      additionalDirectories: [],
    });
    expect(settings.hooks.PreToolUse.length).toBe(1);
    const group = settings.hooks.PreToolUse[0];
    expect(group?.matcher).toBe('Read|Write|Edit|Glob|Grep');
    expect(group?.hooks.length).toBe(1);
    expect(group?.hooks[0]).toEqual({ type: 'command', command: baseHookCommand });
  });

  it('does NOT match Bash in the hook (Bash story per ADR 0028 §4)', () => {
    const settings = buildSandboxSettings({
      hookCommand: baseHookCommand,
      additionalDirectories: [],
    });
    expect(settings.hooks.PreToolUse[0]?.matcher).not.toMatch(/Bash/);
  });

  it('omits additionalDirectories when empty', () => {
    const settings = buildSandboxSettings({
      hookCommand: baseHookCommand,
      additionalDirectories: [],
    });
    expect(settings.additionalDirectories).toBeUndefined();
  });

  it('includes additionalDirectories when provided', () => {
    const settings = buildSandboxSettings({
      hookCommand: baseHookCommand,
      additionalDirectories: ['/repo/proj/.factory', '/repo/templates'],
    });
    expect(settings.additionalDirectories).toEqual(['/repo/proj/.factory', '/repo/templates']);
  });

  it('serialises to valid JSON', () => {
    const settings = buildSandboxSettings({
      hookCommand: baseHookCommand,
      additionalDirectories: ['/a'],
    });
    expect(() => JSON.stringify(settings)).not.toThrow();
    const reparsed = JSON.parse(JSON.stringify(settings)) as typeof settings;
    expect(reparsed).toEqual(settings);
  });

  it('includes Bash danger-pattern denies (Phase 12 Bash gap mitigation)', () => {
    const settings = buildSandboxSettings({
      hookCommand: baseHookCommand,
      additionalDirectories: [],
    });
    const bashRules = settings.permissions.deny.filter((r) => r.startsWith('Bash('));
    expect(bashRules.length).toBeGreaterThan(0);
    expect(bashRules.some((r) => r.includes('/etc/'))).toBe(true);
    expect(bashRules.some((r) => r.includes('.ssh/'))).toBe(true);
  });

  it('write-side static denies are narrow (no Write(~/**) blanket)', () => {
    // Regression: a broad Write(~/**) rule denies in-scope writes to the
    // worktree on Windows when the factory5 workspace lives under the
    // user's home directory (e.g. C:\Users\<name>\factory5-workspace\...).
    // The static deny list should mirror the read-side narrow patterns;
    // the PreToolUse hook is the actual write boundary.
    const settings = buildSandboxSettings({
      hookCommand: baseHookCommand,
      additionalDirectories: [],
    });
    expect(settings.permissions.deny).not.toContain('Write(~/**)');
    expect(settings.permissions.deny).not.toContain('Edit(~/**)');
    // Narrow patterns matching the read side should be present.
    expect(settings.permissions.deny).toContain('Write(~/.ssh/**)');
    expect(settings.permissions.deny).toContain('Write(~/.aws/**)');
    expect(settings.permissions.deny).toContain('Edit(~/.ssh/**)');
    expect(settings.permissions.deny).toContain('Edit(~/.aws/**)');
  });

  it('write/edit static denies have parity with read static denies under ~/', () => {
    // The read-side denies known credential/config paths under ~/. The
    // write/edit side should deny the same paths for symmetry — agents
    // shouldn't be able to write to a path they can't read.
    const settings = buildSandboxSettings({
      hookCommand: baseHookCommand,
      additionalDirectories: [],
    });
    const readUnderHome = settings.permissions.deny
      .filter((r) => r.startsWith('Read(~/'))
      .map((r) => r.slice('Read('.length));
    for (const path of readUnderHome) {
      expect(settings.permissions.deny).toContain(`Write(${path}`);
      expect(settings.permissions.deny).toContain(`Edit(${path}`);
    }
  });
});

describe('getHookScriptPath', () => {
  it('returns an absolute path ending with hook-runtime.js', () => {
    const path = getHookScriptPath();
    expect(path.endsWith('hook-runtime.js')).toBe(true);
    // path should be absolute — depends on platform but must not be relative.
    expect(path).not.toMatch(/^\.\.?[\\/]/);
  });
});

describe('writeWorktreeSandbox', () => {
  let worktreePath: string;

  beforeEach(async () => {
    worktreePath = await mkdtemp(join(tmpdir(), 'factory5-sandbox-test-'));
  });

  afterEach(async () => {
    await rm(worktreePath, { recursive: true, force: true }).catch(() => undefined);
  });

  const config: WorkerSandboxConfig = {
    workspaceRoots: ['/some/worktree'],
    readOnlyRoots: ['/some/proj/.factory'],
    allowSymlinks: false,
  };

  it('creates <worktree>/.claude/settings.local.json + factory5-sandbox-config.json', async () => {
    const written = await writeWorktreeSandbox(worktreePath, config, { nodeBinary: 'node' });
    expect(written.claudeDir).toBe(join(worktreePath, '.claude'));
    expect(written.settingsPath).toBe(join(worktreePath, '.claude', 'settings.local.json'));
    expect(written.configPath).toBe(join(worktreePath, '.claude', 'factory5-sandbox-config.json'));

    // Both files exist + parse cleanly.
    const settingsText = await readFile(written.settingsPath, 'utf8');
    const settings: unknown = JSON.parse(settingsText);
    expect(settings).toMatchObject({
      permissions: { deny: expect.any(Array) },
      hooks: { PreToolUse: expect.any(Array) },
    });

    const configText = await readFile(written.configPath, 'utf8');
    const reparsedConfig: unknown = JSON.parse(configText);
    expect(reparsedConfig).toEqual(config);
  });

  it('settings reference the config path in the hook command', async () => {
    const written = await writeWorktreeSandbox(worktreePath, config, { nodeBinary: 'node' });
    const settings = JSON.parse(await readFile(written.settingsPath, 'utf8')) as {
      hooks: { PreToolUse: { hooks: { command: string }[] }[] };
    };
    const hookCommand = settings.hooks.PreToolUse[0]?.hooks[0]?.command ?? '';
    expect(hookCommand).toContain(written.configPath);
  });

  it('settings reference the absolute hook script path', async () => {
    const written = await writeWorktreeSandbox(worktreePath, config, { nodeBinary: 'node' });
    const settings = JSON.parse(await readFile(written.settingsPath, 'utf8')) as {
      hooks: { PreToolUse: { hooks: { command: string }[] }[] };
    };
    const hookCommand = settings.hooks.PreToolUse[0]?.hooks[0]?.command ?? '';
    expect(hookCommand).toContain('hook-runtime.js');
  });

  it('additionalDirectories merges workspaceRoots + readOnlyRoots', async () => {
    const written = await writeWorktreeSandbox(worktreePath, config, { nodeBinary: 'node' });
    const settings = JSON.parse(await readFile(written.settingsPath, 'utf8')) as {
      additionalDirectories?: string[];
    };
    expect(settings.additionalDirectories).toEqual(['/some/worktree', '/some/proj/.factory']);
  });

  it('is idempotent — re-running overwrites without changing contents', async () => {
    const first = await writeWorktreeSandbox(worktreePath, config, { nodeBinary: 'node' });
    const firstSettings = await readFile(first.settingsPath, 'utf8');
    const second = await writeWorktreeSandbox(worktreePath, config, { nodeBinary: 'node' });
    const secondSettings = await readFile(second.settingsPath, 'utf8');
    expect(secondSettings).toBe(firstSettings);
    expect(second.settingsPath).toBe(first.settingsPath);
  });
});
