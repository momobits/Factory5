/**
 * Pure runtime for the `PreToolUse` hook.
 *
 * `runHook` parses Claude Code's hook-input JSON, runs `evaluateToolCall`,
 * and produces the stdout / stderr / exitCode the hook script writes
 * back. No fs / process IO — that lives in `hook-runtime.ts` (the
 * subprocess entry).
 *
 * Splitting the runtime this way lets us unit-test every branch of the
 * hook contract (in-scope, out-of-scope, malformed input, missing
 * fields) in-process, without spawning a Node subprocess per test.
 */

import { evaluateToolCall } from './evaluate-tool-call.js';
import type { HookInput, HookOutput, WorkerSandboxConfig } from './types.js';

export interface RunHookInput {
  /** Raw JSON text Claude Code wrote to the hook's stdin. */
  stdinText: string;
  /** Already-parsed `WorkerSandboxConfig` (the script reads it from disk). */
  config: WorkerSandboxConfig;
}

export interface RunHookOutput {
  /** The decision JSON to write to stdout (newline-terminated). */
  stdout: string;
  /** Structured audit line to write to stderr (newline-terminated). */
  stderr: string;
  /** Exit code — 0 for any decision (allow / deny), 1 only on internal errors. */
  exitCode: 0 | 1;
}

function emitDecisionJson(decision: 'allow' | 'deny', reason: string): string {
  const out: HookOutput = {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: decision,
      permissionDecisionReason: reason,
    },
  };
  return `${JSON.stringify(out)}\n`;
}

function emitAuditLine(record: Record<string, unknown>, ts: string): string {
  return `factory5.worker.sandbox ${JSON.stringify({ ...record, ts })}\n`;
}

function isHookInput(value: unknown): value is HookInput {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as { tool_name?: unknown; tool_input?: unknown; cwd?: unknown };
  if (typeof obj.tool_name !== 'string' || obj.tool_name.length === 0) return false;
  if (typeof obj.cwd !== 'string') return false;
  // tool_input may be undefined / null; coerced below.
  return true;
}

/**
 * Apply the hook contract to a parsed input + config. Pure: returns the
 * exact bytes the script should write to stdout/stderr. The caller (the
 * subprocess script) is responsible for the actual IO.
 *
 * Tests inject `nowIso` for deterministic audit-line assertions.
 */
export function runHook(input: RunHookInput, opts: { nowIso?: string } = {}): RunHookOutput {
  const ts = opts.nowIso ?? new Date().toISOString();

  let parsedStdin: unknown;
  try {
    parsedStdin = JSON.parse(input.stdinText);
  } catch (err) {
    const reason = `worker-sandbox hook: could not parse stdin: ${(err as Error).message}`;
    return {
      stdout: emitDecisionJson('deny', reason),
      stderr: emitAuditLine({ event: 'sandbox.gate.error', reason }, ts),
      exitCode: 1,
    };
  }

  if (!isHookInput(parsedStdin)) {
    const reason = 'worker-sandbox hook: stdin is not a valid PreToolUse event';
    return {
      stdout: emitDecisionJson('deny', reason),
      stderr: emitAuditLine({ event: 'sandbox.gate.error', reason }, ts),
      exitCode: 1,
    };
  }

  const toolInput =
    typeof parsedStdin.tool_input === 'object' && parsedStdin.tool_input !== null
      ? (parsedStdin.tool_input as Record<string, unknown>)
      : {};

  const result = evaluateToolCall({
    toolName: parsedStdin.tool_name,
    toolInput,
    cwd: parsedStdin.cwd,
    config: input.config,
  });

  const auditRecord: Record<string, unknown> = {
    event: 'sandbox.gate',
    tool: parsedStdin.tool_name,
    decision: result.decision,
  };
  if (result.resolvedPath !== undefined) auditRecord.path = result.resolvedPath;
  if (result.decision === 'deny') auditRecord.reason = result.reason;

  return {
    stdout: emitDecisionJson(result.decision, result.reason),
    stderr: emitAuditLine(auditRecord, ts),
    exitCode: 0,
  };
}

/**
 * Validate a `WorkerSandboxConfig` parsed from JSON. Returns the typed
 * config or throws with a descriptive message. Used by `hook-runtime.ts`
 * after reading the per-spawn config file.
 */
export function parseSandboxConfig(raw: unknown): WorkerSandboxConfig {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('config is not an object');
  }
  const obj = raw as {
    workspaceRoots?: unknown;
    readOnlyRoots?: unknown;
    allowSymlinks?: unknown;
  };
  if (
    !Array.isArray(obj.workspaceRoots) ||
    !obj.workspaceRoots.every((r) => typeof r === 'string')
  ) {
    throw new Error('workspaceRoots must be a string[]');
  }
  if (!Array.isArray(obj.readOnlyRoots) || !obj.readOnlyRoots.every((r) => typeof r === 'string')) {
    throw new Error('readOnlyRoots must be a string[]');
  }
  if (typeof obj.allowSymlinks !== 'boolean') {
    throw new Error('allowSymlinks must be a boolean');
  }
  return {
    workspaceRoots: obj.workspaceRoots,
    readOnlyRoots: obj.readOnlyRoots,
    allowSymlinks: obj.allowSymlinks,
  };
}
