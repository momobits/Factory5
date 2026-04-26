/**
 * `PreToolUse` hook runtime — invoked by Claude Code as a subprocess on
 * every gated tool call. Reads JSON from stdin (Claude Code's hook
 * input), reads the per-spawn sandbox config from `argv[2]`, runs the
 * pure `runHook` to produce decision + audit bytes, and writes them to
 * stdout / stderr.
 *
 * Exit code:
 *   - `0` for any decision (allow OR deny — both are normal hook outcomes)
 *   - `1` only on internal hook errors (config-file missing, malformed
 *     stdin, etc.); Claude Code interprets non-zero as fail-closed.
 *
 * Side-effect-free runtime lives in `./hook.ts` so every contract branch
 * is unit-tested in-process.
 */

import { readFile } from 'node:fs/promises';

import { parseSandboxConfig, runHook } from './hook.js';

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function failClosed(reason: string): never {
  // Defensive: emit a deny decision JSON to stdout AND a non-zero exit
  // so any hook-implementation that reads stdout-on-non-zero still sees
  // the deny. Claude Code's fail-closed convention does the rest.
  process.stdout.write(
    `${JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: reason,
      },
    })}\n`,
  );
  process.stderr.write(
    `factory5.worker.sandbox ${JSON.stringify({ event: 'sandbox.gate.error', reason, ts: new Date().toISOString() })}\n`,
  );
  process.exit(1);
}

async function main(): Promise<void> {
  const configPath = process.argv[2];
  if (configPath === undefined || configPath.length === 0) {
    failClosed('worker-sandbox hook: missing config path argument (argv[2])');
  }

  let config;
  try {
    const raw = await readFile(configPath, 'utf8');
    config = parseSandboxConfig(JSON.parse(raw));
  } catch (err) {
    failClosed(
      `worker-sandbox hook: could not read config at ${configPath}: ${(err as Error).message}`,
    );
  }

  const stdinText = await readStdin();
  const result = runHook({ stdinText, config });
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  process.exit(result.exitCode);
}

main().catch((err: unknown) => {
  failClosed(`worker-sandbox hook: unhandled error: ${(err as Error).message}`);
});
