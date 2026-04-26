/**
 * Gate function for the worker filesystem-scoping sandbox (ADR 0028).
 *
 * `evaluateToolCall` reduces a Claude Code `PreToolUse` event to an
 * `allow` / `deny` decision. It is the single source of truth for the
 * write-vs-read asymmetry in §5 of the ADR:
 *
 *   - Write-class (`Write`, `Edit`):  `workspaceRoots` only.
 *   - Read-class  (`Read`, `Glob`, `Grep`): `workspaceRoots ∪ readOnlyRoots`.
 *   - `Bash`: not matched by the hook; gated separately by `cwd` pinning
 *     + static command-pattern denies in `permissions.deny`.
 *
 * Pure relative to its inputs: callers may inject `isSymlink` in tests
 * (defaults to `fs.lstatSync` at the call site).
 */

import { lstatSync } from 'node:fs';

import { pathInsideAny, resolveAgainst } from './path-prefix.js';
import type { EvaluationResult, WorkerSandboxConfig } from './types.js';

export interface EvaluateInput {
  toolName: string;
  toolInput: Record<string, unknown>;
  cwd: string;
  config: WorkerSandboxConfig;
}

export interface EvaluateOptions {
  /**
   * Override the symlink check. Defaults to a `fs.lstatSync` wrapper
   * that returns `false` on missing files (the prefix check still
   * applies). Tests inject a fake to avoid touching the filesystem.
   */
  isSymlink?: (absolutePath: string) => boolean;
}

const WRITE_TOOLS = new Set(['Write', 'Edit']);
const READ_TOOLS = new Set(['Read', 'Glob', 'Grep']);

/**
 * Pull the candidate filesystem path from the tool's input shape. Returns
 * `undefined` when the tool isn't a path-shaped tool, or when the input
 * doesn't carry a path field we recognise.
 */
function extractCandidatePath(
  toolName: string,
  toolInput: Record<string, unknown>,
): string | undefined {
  // Read / Write / Edit all use `file_path`.
  if (toolName === 'Read' || toolName === 'Write' || toolName === 'Edit') {
    const v = toolInput['file_path'];
    return typeof v === 'string' && v.length > 0 ? v : undefined;
  }
  // Glob's `pattern` is path-glob shape; `path` (if present) is the search root.
  if (toolName === 'Glob') {
    const path = toolInput['path'];
    if (typeof path === 'string' && path.length > 0) return path;
    const pattern = toolInput['pattern'];
    if (typeof pattern === 'string' && pattern.length > 0) {
      // Best-effort fixed-prefix extraction — substring up to first glob meta.
      const meta = pattern.search(/[*?[]/);
      const fixed = meta === -1 ? pattern : pattern.slice(0, meta);
      return fixed.length > 0 ? fixed : '.';
    }
    return undefined;
  }
  // Grep uses `path` (default cwd if absent).
  if (toolName === 'Grep') {
    const path = toolInput['path'];
    return typeof path === 'string' && path.length > 0 ? path : '.';
  }
  return undefined;
}

function defaultIsSymlinkSync(absolutePath: string): boolean {
  try {
    return lstatSync(absolutePath).isSymbolicLink();
  } catch {
    // Non-existent file → not a symlink. The path-prefix check still applies;
    // if the LLM tries to Write to a non-existent path inside the worktree
    // that's normal and should be allowed.
    return false;
  }
}

/**
 * Apply the path-prefix algebra to a tool call. Returns `allow` when the
 * call is in scope, `deny` with a reason otherwise. The `reason` lists
 * the allowed roots so the LLM can adapt; it deliberately does NOT list
 * deny rules (no information that helps craft an evasion).
 */
export function evaluateToolCall(
  input: EvaluateInput,
  opts: EvaluateOptions = {},
): EvaluationResult {
  // Tools we don't gate via the hook (Bash, MCP, anything else) are allowed
  // through the hook layer — `permissions.deny` rules in the settings file
  // catch the obvious Bash danger patterns.
  if (!WRITE_TOOLS.has(input.toolName) && !READ_TOOLS.has(input.toolName)) {
    return { decision: 'allow', reason: `Tool ${input.toolName} not gated by sandbox hook` };
  }

  const candidate = extractCandidatePath(input.toolName, input.toolInput);
  if (candidate === undefined) {
    // Fail-closed: a path-shaped tool with no path field is suspicious.
    return {
      decision: 'deny',
      reason: `Tool ${input.toolName} called without a parseable path argument`,
    };
  }

  const absolutePath = resolveAgainst(input.cwd, candidate);

  // Symlink rejection — applied before the prefix check so a symlink at an
  // in-scope path that points out-of-scope still denies.
  if (!input.config.allowSymlinks) {
    const isSymlink = opts.isSymlink ?? defaultIsSymlinkSync;
    if (isSymlink(absolutePath)) {
      return {
        decision: 'deny',
        reason: `Symlink at ${absolutePath} denied by sandbox (allowSymlinks=false). Allowed write roots: ${formatRoots(input.config.workspaceRoots)}. Allowed read roots: ${formatRoots([...input.config.workspaceRoots, ...input.config.readOnlyRoots])}.`,
        resolvedPath: absolutePath,
      };
    }
  }

  const isWrite = WRITE_TOOLS.has(input.toolName);
  const allowedRoots = isWrite
    ? input.config.workspaceRoots
    : [...input.config.workspaceRoots, ...input.config.readOnlyRoots];

  if (pathInsideAny(absolutePath, allowedRoots)) {
    return { decision: 'allow', reason: 'in-scope', resolvedPath: absolutePath };
  }

  const writeRootsList = formatRoots(input.config.workspaceRoots);
  const readRootsList = formatRoots([
    ...input.config.workspaceRoots,
    ...input.config.readOnlyRoots,
  ]);

  return {
    decision: 'deny',
    reason: `Tool use blocked: ${input.toolName} on ${absolutePath} is outside the worker's filesystem sandbox. Allowed write roots: ${writeRootsList}. Allowed read roots: ${readRootsList}. The attempt was logged for audit.`,
    resolvedPath: absolutePath,
  };
}

function formatRoots(roots: readonly string[]): string {
  if (roots.length === 0) return '(none)';
  return roots.map((r) => `"${r}"`).join(', ');
}
