/**
 * Public types for the worker filesystem-scoping gate.
 *
 * See ADR 0028 — Worker-sandbox contract.
 */

/**
 * Per-spawn sandbox configuration.
 *
 * `workspaceRoots` are paths the worker may both read and write. In the
 * Phase-12 default this is `[<worktree>]` only — exactly one entry, the
 * per-task worktree allocated by `@factory5/worker`.
 *
 * `readOnlyRoots` are paths the worker may read but not write. In the
 * default this is `[<projectPath>/.factory, <repoTemplatesDir>]` so the
 * worker can read prior plans, prior findings, and `project.json` without
 * being able to write outside its worktree.
 *
 * `allowSymlinks` defaults to `false` — symlinks are rejected without
 * dereferencing. Set `true` only when a build's dependency layout
 * requires it (e.g. default-mode `pnpm install` produces a symlink farm
 * pointing at the global store outside the worktree). When `true`, the
 * gate currently allows the symlink call but does not re-prefix-check
 * the target — that tightening is a follow-up.
 */
export interface WorkerSandboxConfig {
  workspaceRoots: readonly string[];
  readOnlyRoots: readonly string[];
  allowSymlinks: boolean;
}

/** Tool name keys we gate via the `PreToolUse` hook. `Bash` is excluded. */
export const GATED_TOOL_NAMES = ['Read', 'Write', 'Edit', 'Glob', 'Grep'] as const;

export type GatedToolName = (typeof GATED_TOOL_NAMES)[number];

/** Subset of Claude Code's hook input shape we consume. */
export interface HookInput {
  /** Tool name (e.g., `Read`, `Bash`). */
  tool_name: string;
  /** Tool argument shape varies per tool — we read `file_path` / `pattern` / `path`. */
  tool_input: Record<string, unknown>;
  /** Worker's cwd as Claude Code sees it (the worktree). */
  cwd: string;
  /** Claude Code permission mode — passed through but not used by our algebra. */
  permission_mode?: string;
}

/** Decision returned by `evaluateToolCall`. */
export interface EvaluationResult {
  decision: 'allow' | 'deny';
  /** Human-readable reason. Surfaced to the LLM via `permissionDecisionReason`. */
  reason: string;
  /** The absolute path the algebra resolved (for audit logging). */
  resolvedPath?: string;
}

/** Hook output shape Claude Code expects on stdout. */
export interface HookOutput {
  hookSpecificOutput: {
    hookEventName: 'PreToolUse';
    permissionDecision: 'allow' | 'deny';
    permissionDecisionReason: string;
  };
}
