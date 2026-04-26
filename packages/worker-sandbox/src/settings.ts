/**
 * Per-spawn settings file writer.
 *
 * Writes `<worktree>/.claude/settings.local.json` + `<worktree>/.claude/factory5-sandbox-config.json`
 * before claude-cli is spawned. Claude Code picks `settings.local.json` up
 * automatically (highest non-managed precedence below CLI flags) — there
 * is no `--settings` flag, so the file location is fixed.
 *
 * The settings file declares:
 *
 *   - `permissions.deny` — coarse-grained absolute path patterns for
 *     obvious danger zones (`~/.ssh`, `/etc`, `C:/Windows`, …) plus a
 *     small Bash-pattern denylist for the Phase 12 Bash-gap mitigation
 *     (ADR 0028 §4).
 *   - `additionalDirectories` — the read-extension allowlist (`<project>/.factory`,
 *     repo templates dir). With `--permission-mode acceptEdits`, edits
 *     auto-approve within `cwd ∪ additionalDirectories`; the hook then
 *     enforces the affirmative algebra on top.
 *   - `hooks.PreToolUse` — the gate. Matches `Read|Write|Edit|Glob|Grep`
 *     (intentionally not `Bash` — see §4) and invokes our hook script
 *     with the absolute path to the per-spawn sandbox config.
 *
 * The accompanying `factory5-sandbox-config.json` carries the parsed
 * `WorkerSandboxConfig` for the hook to read at every invocation.
 *
 * Both files live under `<worktree>/.claude/`; the worker removes them
 * (and the empty `.claude/` directory) at the end of the stream so the
 * `git add -A` inside `mergeAndRemove` does not pick them up.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { WorkerSandboxConfig } from './types.js';

const SETTINGS_FILENAME = 'settings.local.json';
const CONFIG_FILENAME = 'factory5-sandbox-config.json';
const CLAUDE_DIR = '.claude';

/** Hook matcher — gate fs-shaped tools, not Bash (Bash story per ADR 0028 §4). */
const HOOK_MATCHER = 'Read|Write|Edit|Glob|Grep';

/**
 * Static deny rules — the belt to the hook's braces. Catches obvious
 * danger zones cross-platform even if the hook script crashes or is
 * misconfigured.
 *
 * Path patterns follow Claude Code's permission-rule syntax:
 *   - `~/path` — home-directory relative
 *   - `//path` — absolute filesystem root (Linux/macOS)
 *   - `C:/path` — drive-rooted (Windows)
 */
const STATIC_DENY_RULES: readonly string[] = [
  // Linux / macOS danger zones.
  'Read(//etc/**)',
  'Read(//proc/**)',
  'Read(//sys/**)',
  'Read(//root/**)',
  'Read(~/.ssh/**)',
  'Read(~/.aws/**)',
  'Read(~/.gnupg/**)',
  'Read(~/.config/**)',
  'Read(~/.netrc)',
  // Windows danger zones.
  'Read(C:/Windows/**)',
  'Read(C:/Users/*/.ssh/**)',
  'Read(C:/Users/*/AppData/**)',
  // Edits + writes outside cwd: belt-and-braces for the affirmative hook.
  'Edit(~/**)',
  'Edit(//etc/**)',
  'Edit(C:/Windows/**)',
  'Write(~/**)',
  'Write(//etc/**)',
  'Write(C:/Windows/**)',
  // Bash gap mitigation per ADR 0028 §4 — heuristic, leaky, but catches
  // the LLM's lazy patterns. NOT a substitute for OS-level sandboxing.
  'Bash(* /etc/*)',
  'Bash(* ~/.ssh/*)',
  'Bash(* ~/.aws/*)',
  'Bash(* ~/.gnupg/*)',
  'Bash(* ~/.netrc*)',
];

interface ClaudeSettingsHookEntry {
  type: 'command';
  command: string;
}

interface ClaudeSettingsHookGroup {
  matcher: string;
  hooks: readonly ClaudeSettingsHookEntry[];
}

interface ClaudeSettings {
  permissions: {
    deny: readonly string[];
  };
  additionalDirectories?: readonly string[];
  hooks: {
    PreToolUse: readonly ClaudeSettingsHookGroup[];
  };
}

/**
 * Build the JSON object claude-cli will read from `<worktree>/.claude/settings.local.json`.
 *
 * Pure: no fs / process.env reads. Tests assert against the literal
 * shape.
 */
export function buildSandboxSettings(opts: {
  hookCommand: string;
  additionalDirectories: readonly string[];
}): ClaudeSettings {
  const settings: ClaudeSettings = {
    permissions: { deny: STATIC_DENY_RULES },
    hooks: {
      PreToolUse: [
        {
          matcher: HOOK_MATCHER,
          hooks: [{ type: 'command', command: opts.hookCommand }],
        },
      ],
    },
  };
  if (opts.additionalDirectories.length > 0) {
    settings.additionalDirectories = opts.additionalDirectories;
  }
  return settings;
}

/**
 * Serialise the hook command line for the settings file. Quotes every
 * path with double quotes so paths containing spaces survive both Linux
 * `sh -c` and Windows `cmd.exe` shell parsing. Uses `process.execPath`
 * so the hook always runs under the same Node binary as the worker
 * (no PATH lookup at hook-spawn time).
 */
export function buildHookCommand(opts: {
  nodeBinary: string;
  hookScriptPath: string;
  configPath: string;
}): string {
  return `"${opts.nodeBinary}" "${opts.hookScriptPath}" "${opts.configPath}"`;
}

/**
 * Absolute path to the compiled hook-runtime script (`dist/hook-runtime.js`).
 * Workers reference this when assembling the hook command line.
 *
 * Uses `import.meta.url` — survives pnpm hoisting layouts whether the
 * package is installed as a workspace symlink or a real `node_modules/`
 * entry. Mirrors `@factory5/worker-mcp/getServerScriptPath`.
 */
export function getHookScriptPath(): string {
  const here = fileURLToPath(import.meta.url);
  return join(dirname(here), 'hook-runtime.js');
}

export interface WrittenSandbox {
  /** Absolute path to the settings file we wrote. */
  settingsPath: string;
  /** Absolute path to the sandbox config we wrote. */
  configPath: string;
  /** Absolute path to the `.claude/` directory we created (or pre-existing). */
  claudeDir: string;
}

/**
 * Materialise the per-spawn sandbox into the worktree. Writes both
 * `.claude/settings.local.json` and `.claude/factory5-sandbox-config.json`.
 * Returns the paths so the caller can clean up at end-of-stream.
 *
 * Idempotent — re-writes both files unconditionally.
 */
export async function writeWorktreeSandbox(
  worktreePath: string,
  config: WorkerSandboxConfig,
  opts: { nodeBinary: string },
): Promise<WrittenSandbox> {
  const claudeDir = join(worktreePath, CLAUDE_DIR);
  await mkdir(claudeDir, { recursive: true });
  const configPath = join(claudeDir, CONFIG_FILENAME);
  const settingsPath = join(claudeDir, SETTINGS_FILENAME);

  await writeFile(configPath, JSON.stringify(config, null, 2), 'utf8');

  const hookCommand = buildHookCommand({
    nodeBinary: opts.nodeBinary,
    hookScriptPath: getHookScriptPath(),
    configPath,
  });
  const additionalDirectories = [...config.workspaceRoots, ...config.readOnlyRoots];
  const settings = buildSandboxSettings({ hookCommand, additionalDirectories });
  await writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf8');

  return { settingsPath, configPath, claudeDir };
}
