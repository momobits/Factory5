# @factory5/worker-sandbox

Worker filesystem-scoping gate. Implements the worker-sandbox contract pinned by [ADR 0028](../../docs/decisions/0028-worker-sandbox-contract.md): path-prefix algebra + Claude Code `PreToolUse` hook + per-spawn `settings.local.json` writer.

## Why

Tool-using workers spawn the Claude Code CLI inside a per-task worktree (ADR 0008). Without scoping, the LLM's `Read` / `Write` / `Edit` / `Glob` / `Grep` tools have host-wide filesystem access — `Read('/etc/passwd')` works, `Read('../../node_modules/...')` reaches the parent factory5 checkout, `Write('~/.bashrc')` lands. ADR 0028 closes that surface using Claude Code's native gates: a `permissions.deny` block in `<worktree>/.claude/settings.local.json` for obvious danger zones, plus a `PreToolUse` hook that runs the affirmative path-prefix algebra (Windows case-insensitive, UNC, symlinks, `..` traversal) on every call.

## Public API

```ts
import {
  type WorkerSandboxConfig,
  evaluateToolCall,
  pathInsideAny,
  writeWorktreeSandbox,
  getHookScriptPath,
} from '@factory5/worker-sandbox';
```

- `WorkerSandboxConfig` — `{ workspaceRoots, readOnlyRoots, allowSymlinks }`. Workspace roots are read+write; readOnly roots are read-only; symlinks rejected by default.
- `evaluateToolCall({ toolName, toolInput, cwd, config })` — the gate function. Pure relative to its inputs (defaults to `fs.lstatSync` for symlink detection; tests inject `isSymlink`). Returns `{ decision: 'allow' | 'deny', reason }`.
- `pathInsideAny(absolutePath, roots, opts)` — primitive prefix-check (case-insensitive on Windows).
- `writeWorktreeSandbox(worktreePath, config)` — writes `<worktree>/.claude/settings.local.json` + `<worktree>/.claude/factory5-sandbox-config.json`. Returns the paths so callers can clean up at end-of-stream. Idempotent.
- `getHookScriptPath()` — absolute path to the compiled `dist/hook-runtime.js` script that the settings file references as the `PreToolUse` hook command.

## Hook script

The compiled `dist/hook-runtime.js` is invoked by Claude Code as a subprocess on every `Read` / `Write` / `Edit` / `Glob` / `Grep` tool call. Reads JSON over stdin (Claude Code's hook input contract — `tool_name`, `tool_input`, `cwd`, etc.), reads its sandbox config from the path in `argv[2]`, runs `evaluateToolCall`, and writes the decision JSON to stdout.

`Bash` is intentionally **not** matched by the hook (see ADR 0028 §4) — Bash is gated by `cwd` pinning + a small set of static command-pattern denies in the same settings file.

## Audit trail

Denies log structured lines to stderr (one per call) for the `worker.sandbox` channel. The Claude Code stream surfaces hook stderr; the worker captures and replays through the existing `worker` logger.

## Cross-platform

The path-prefix algebra is unit-tested against the matrix in ADR 0028 §2:

| Case           | Linux/macOS              | Windows                                                      |
| -------------- | ------------------------ | ------------------------------------------------------------ |
| Prefix match   | byte-equal               | case-insensitive (lowercased both sides)                     |
| Path separator | `/`                      | `\` and `/` accepted; normalised to `/` for compare          |
| Drive letter   | n/a                      | `C:/` and `c:/` prefix-equal                                 |
| `..` traversal | `path.resolve` collapses | same                                                         |
| UNC            | n/a                      | `\\server\share\…` allowlist requires same server+share      |
| Symlink        | `lstat`-checked, denied  | reparse points (junctions, mklink) — `lstat`-checked, denied |
| Trailing slash | `/foo` and `/foo/` equal | same                                                         |

## Reversibility

Set `FACTORY5_DISABLE_WORKER_SANDBOX=1` in the worker's environment to bypass the gate at spawn time (worker falls back to `permissionMode: 'bypassPermissions'`). For 12.4 live-validation A/B + emergency rollback. ADR 0028 — Reversibility section.
