/**
 * `PreToolUse` hook runtime — invoked by Claude Code as a subprocess on
 * every gated tool call. Reads JSON from stdin (Claude Code's hook
 * input), reads the per-spawn sandbox config from `argv[2]`, runs
 * `evaluateToolCall`, and writes the decision JSON to stdout.
 *
 * Stderr carries a structured one-line audit record per call (denies +
 * allows). Claude Code surfaces hook stderr through the stream events;
 * the worker captures and replays through the `worker.sandbox` logger.
 *
 * Exit code:
 *   - `0` for any decision (allow OR deny — both are normal hook outcomes)
 *   - `1` only on internal hook errors (config-file missing, malformed
 *     stdin, etc.); Claude Code interprets non-zero as fail-closed.
 */

import { readFile } from 'node:fs/promises';

import { evaluateToolCall } from './evaluate-tool-call.js';
import type { HookInput, HookOutput, WorkerSandboxConfig } from './types.js';

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function emitOutput(decision: 'allow' | 'deny', reason: string): void {
  const out: HookOutput = {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: decision,
      permissionDecisionReason: reason,
    },
  };
  process.stdout.write(`${JSON.stringify(out)}\n`);
}

function emitAuditLine(record: Record<string, unknown>): void {
  const line = `factory5.worker.sandbox ${JSON.stringify({ ...record, ts: new Date().toISOString() })}\n`;
  process.stderr.write(line);
}

function fail(reason: string): never {
  // Defensive: write a deny decision AND exit non-zero. Claude Code's
  // fail-closed behaviour means a non-zero exit denies the call; the deny
  // JSON is belt-and-braces for hook implementations that read stdout
  // even on non-zero exit.
  emitOutput('deny', reason);
  emitAuditLine({ event: 'sandbox.gate.error', reason });
  process.exit(1);
}

async function main(): Promise<void> {
  const configPath = process.argv[2];
  if (configPath === undefined || configPath.length === 0) {
    fail('worker-sandbox hook: missing config path argument (argv[2])');
  }

  let config: WorkerSandboxConfig;
  try {
    const raw = await readFile(configPath, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !Array.isArray((parsed as { workspaceRoots?: unknown }).workspaceRoots) ||
      !Array.isArray((parsed as { readOnlyRoots?: unknown }).readOnlyRoots) ||
      typeof (parsed as { allowSymlinks?: unknown }).allowSymlinks !== 'boolean'
    ) {
      fail(`worker-sandbox hook: config at ${configPath} is malformed`);
    }
    config = parsed as WorkerSandboxConfig;
  } catch (err) {
    fail(`worker-sandbox hook: could not read config at ${configPath}: ${(err as Error).message}`);
  }

  const stdinText = await readStdin();
  let input: HookInput;
  try {
    const parsed: unknown = JSON.parse(stdinText);
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof (parsed as { tool_name?: unknown }).tool_name !== 'string' ||
      typeof (parsed as { cwd?: unknown }).cwd !== 'string'
    ) {
      fail('worker-sandbox hook: stdin is not a valid PreToolUse event');
    }
    input = parsed as HookInput;
  } catch (err) {
    fail(`worker-sandbox hook: could not parse stdin: ${(err as Error).message}`);
  }

  const result = evaluateToolCall({
    toolName: input.tool_name,
    toolInput: input.tool_input ?? {},
    cwd: input.cwd,
    config,
  });

  emitOutput(result.decision, result.reason);

  emitAuditLine({
    event: 'sandbox.gate',
    tool: input.tool_name,
    decision: result.decision,
    ...(result.resolvedPath !== undefined ? { path: result.resolvedPath } : {}),
    ...(result.decision === 'deny' ? { reason: result.reason } : {}),
  });
}

main().catch((err: unknown) => {
  fail(`worker-sandbox hook: unhandled error: ${(err as Error).message}`);
});
