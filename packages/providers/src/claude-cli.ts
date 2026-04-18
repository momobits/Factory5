/**
 * Claude CLI provider — spawns the subscription-based `claude` CLI as a
 * subprocess. Implements the {@link ModelProvider} interface.
 *
 * The prompt (system + messages) is piped via stdin so we avoid the Windows
 * / cmd.exe argv-escaping problem for arbitrary multi-line content. Only
 * safe flag arguments travel on argv.
 *
 * Two execution modes:
 *   - `call()` uses `--output-format json` and parses a single result envelope.
 *     Used by read-only agents and for quick classifications.
 *   - `stream()` uses `--output-format stream-json --verbose`, parses NDJSON,
 *     and yields per-assistant-message chunks with a terminal usage chunk.
 *     Used by tool-using agents (scaffolder/builder/fixer) inside a per-task
 *     worktree. Honours `ProviderRequest.cwd`, `allowedTools`, and
 *     `permissionMode` (typically `'bypassPermissions'` for unattended work).
 *
 * Binary resolution (first match wins):
 *   1. Explicit `binaryPath` ctor option
 *   2. `FACTORY5_CLAUDE_CLI_PATH` env var
 *   3. `claude` on PATH (on Windows, probes PATHEXT for `.cmd`/`.exe`/etc.)
 */

import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { spawn } from 'node:child_process';
import { constants as fsConstants } from 'node:fs';
import { access } from 'node:fs/promises';
import { delimiter, join } from 'node:path';
import { env, platform } from 'node:process';
import { createInterface } from 'node:readline';

import { createLogger } from '@factory5/logger';
import { z } from 'zod';

import {
  eventToChunks,
  parseStreamJsonLine,
  resultIsError,
  usageFromResult,
} from './stream-events.js';
import type {
  ModelProvider,
  ProviderMessage,
  ProviderRequest,
  ProviderResponse,
  ProviderStreamChunk,
  ProviderUsage,
} from './types.js';

const log = createLogger('providers.claude-cli');

// ---------------------------------------------------------------------------
// JSON envelope — `claude -p --output-format json`
// ---------------------------------------------------------------------------

const usageSchema = z
  .object({
    input_tokens: z.number().int().nonnegative().optional(),
    output_tokens: z.number().int().nonnegative().optional(),
    cache_creation_input_tokens: z.number().int().nonnegative().optional(),
    cache_read_input_tokens: z.number().int().nonnegative().optional(),
  })
  .passthrough();

const claudeJsonResultSchema = z
  .object({
    type: z.literal('result'),
    subtype: z.string(),
    is_error: z.boolean().optional(),
    duration_ms: z.number().nonnegative().optional(),
    num_turns: z.number().int().nonnegative().optional(),
    result: z.string().optional(),
    session_id: z.string().optional(),
    cost_usd: z.number().nonnegative().optional(),
    total_cost_usd: z.number().nonnegative().optional(),
    usage: usageSchema.optional(),
    error: z.string().optional(),
  })
  .passthrough();

type ClaudeJsonResult = z.infer<typeof claudeJsonResultSchema>;

// ---------------------------------------------------------------------------
// Provider options
// ---------------------------------------------------------------------------

export interface ClaudeCliProviderOptions {
  /**
   * Override the binary path. If unset, falls back to
   * `FACTORY5_CLAUDE_CLI_PATH`, then to PATH lookup for `claude` (with
   * `.cmd`/`.exe`/... extension probing on Windows).
   */
  binaryPath?: string;
  /** Extra args passed to every invocation (e.g. `['--verbose']`). */
  extraArgs?: readonly string[];
  /** Default working directory for the spawn. Overridden per call by `ProviderRequest.cwd`. */
  cwd?: string;
  /** Hard timeout per call in ms. Default 10 minutes. */
  timeoutMs?: number;
  /** Hard timeout per stream() call. Defaults to `timeoutMs * 2` for tool-using sessions. */
  streamTimeoutMs?: number;
  /**
   * Default max agentic turns for `stream()` when tools are in play and the
   * {@link ProviderRequest.maxTurns} per-request override is unset. Raised
   * to 40 in ADR 0016 after the Phase 2 live run showed builder tasks
   * frequently hitting the prior 20-turn ceiling mid-TDD loop.
   */
  maxTurns?: number;
  /**
   * Disable the in-process cache for {@link ClaudeCliProvider.available}.
   * Default: cache indefinitely (call {@link ClaudeCliProvider.resetAvailability}
   * to clear).
   */
  noAvailabilityCache?: boolean;
}

// ---------------------------------------------------------------------------
// Binary resolver
// ---------------------------------------------------------------------------

async function resolveBinary(explicit?: string): Promise<string | undefined> {
  const candidates: string[] = [];
  if (explicit !== undefined && explicit.length > 0) candidates.push(explicit);
  const envOverride = env['FACTORY5_CLAUDE_CLI_PATH'];
  if (envOverride !== undefined && envOverride.length > 0) candidates.push(envOverride);

  for (const c of candidates) {
    if (await fileExists(c)) return c;
  }

  const pathDirs = (env['PATH'] ?? '').split(delimiter).filter((d) => d.length > 0);
  const exts =
    platform === 'win32'
      ? (env['PATHEXT'] ?? '.COM;.EXE;.BAT;.CMD')
          .split(';')
          .map((e) => e.trim())
          .filter((e) => e.length > 0)
      : [''];

  for (const dir of pathDirs) {
    for (const ext of exts) {
      const candidate = join(dir, `claude${ext}`);
      if (await fileExists(candidate)) return candidate;
    }
  }
  return undefined;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Safe Windows cmd.exe quoting — only used when we must spawn a `.cmd`/`.bat`
// ---------------------------------------------------------------------------

function quoteForCmd(s: string): string {
  if (s.includes('\r') || s.includes('\n') || s.includes('\0')) {
    throw new Error(
      `claude-cli: refuse to spawn via cmd.exe with arg containing control chars: ${JSON.stringify(s.slice(0, 32))}`,
    );
  }
  if (s.length === 0) return '""';
  if (!/[\s"^&|<>()%!]/.test(s)) return s;
  // Escape quotes + trailing backslashes per CommandLineToArgvW rules.
  const withEscapedQuotes = s.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1');
  return `"${withEscapedQuotes}"`;
}

function spawnClaude(
  bin: string,
  args: readonly string[],
  cwd?: string,
): ChildProcessWithoutNullStreams {
  const isWindowsBatch = platform === 'win32' && /\.(cmd|bat)$/i.test(bin);
  if (isWindowsBatch) {
    const line = [quoteForCmd(bin), ...args.map(quoteForCmd)].join(' ');
    return spawn(line, {
      shell: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      ...(cwd !== undefined ? { cwd } : {}),
    }) as ChildProcessWithoutNullStreams;
  }
  return spawn(bin, [...args], {
    shell: false,
    stdio: ['pipe', 'pipe', 'pipe'],
    ...(cwd !== undefined ? { cwd } : {}),
  });
}

// ---------------------------------------------------------------------------
// Prompt composition & arg construction
// ---------------------------------------------------------------------------

/**
 * Compose a single prompt string from a system prompt + message array.
 * Claude Code CLI in print mode (`-p`) takes one text blob; we prepend the
 * system preamble and tag each message with a role marker.
 */
export function composePromptText(
  systemPrompt: string,
  messages: readonly ProviderMessage[],
): string {
  const parts: string[] = [];
  const sys = systemPrompt.trim();
  if (sys.length > 0) {
    parts.push('=== SYSTEM ===');
    parts.push(sys);
    parts.push('');
  }
  for (const m of messages) {
    parts.push(`=== ${m.role.toUpperCase()} ===`);
    parts.push(m.content);
    parts.push('');
  }
  return parts.join('\n').trimEnd() + '\n';
}

/** Build argv for a given request / output format. */
export function buildClaudeArgs(
  req: ProviderRequest,
  extra: readonly string[],
  outputFormat: 'json' | 'stream-json' | 'text',
  opts: { maxTurns?: number } = {},
): string[] {
  const args: string[] = ['-p', '--output-format', outputFormat];
  if (req.model.length > 0) {
    args.push('--model', req.model);
  }
  if (outputFormat === 'stream-json') {
    args.push('--verbose');
  }
  if (req.allowedTools !== undefined && req.allowedTools.length > 0) {
    args.push('--allowedTools', req.allowedTools.join(','));
  }
  if (req.permissionMode !== undefined) {
    if (req.permissionMode === 'bypassPermissions') {
      // Most reliable cross-version flag for unattended operation inside a
      // worktree sandbox; `--permission-mode bypassPermissions` is not
      // recognised by some shipped CLI builds.
      args.push('--dangerously-skip-permissions');
    } else {
      args.push('--permission-mode', req.permissionMode);
    }
  }
  if (outputFormat === 'stream-json' && opts.maxTurns !== undefined) {
    args.push('--max-turns', String(opts.maxTurns));
  }
  return [...args, ...extra];
}

// ---------------------------------------------------------------------------
// JSON parsing & usage extraction
// ---------------------------------------------------------------------------

/**
 * Parse the single-envelope JSON from `claude -p --output-format json`.
 * Throws a descriptive error if the envelope is missing, malformed, or
 * represents an error condition.
 */
export function parseClaudeJsonResult(stdout: string): ClaudeJsonResult {
  const trimmed = stdout.trim();
  if (trimmed.length === 0) {
    throw new Error('claude-cli: empty stdout (no JSON envelope emitted)');
  }
  let raw: unknown;
  try {
    raw = JSON.parse(trimmed);
  } catch (err) {
    throw new Error(
      `claude-cli: could not parse JSON envelope (${(err as Error).message}); first 500 chars: ${trimmed.slice(0, 500)}`,
    );
  }
  return claudeJsonResultSchema.parse(raw);
}

export function extractUsage(r: ClaudeJsonResult): ProviderUsage {
  return {
    inputTokens: r.usage?.input_tokens ?? 0,
    outputTokens: r.usage?.output_tokens ?? 0,
    costUsd: r.total_cost_usd ?? r.cost_usd ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Run helper — collect stdout/stderr with timeout and optional stdin
// ---------------------------------------------------------------------------

interface RunOptions {
  timeoutMs: number;
  stdin?: string;
  signal?: AbortSignal;
}

interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  durationMs: number;
}

/** DOMException-like error used for abort rejections. Name = 'AbortError' so callers can feature-detect. */
class AbortError extends Error {
  override readonly name = 'AbortError';
}

function collectRun(child: ChildProcessWithoutNullStreams, opts: RunOptions): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    const started = Date.now();
    let settled = false;

    const killAndSettle = (err: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (opts.signal !== undefined) opts.signal.removeEventListener('abort', onAbort);
      try {
        child.kill('SIGKILL');
      } catch {
        /* ignore */
      }
      reject(err);
    };

    const onAbort = (): void => {
      killAndSettle(new AbortError('claude-cli: aborted by caller'));
    };

    const timer = setTimeout(() => {
      killAndSettle(new Error(`claude-cli: timed out after ${String(opts.timeoutMs)}ms`));
    }, opts.timeoutMs);

    if (opts.signal !== undefined) {
      if (opts.signal.aborted) {
        onAbort();
        return;
      }
      opts.signal.addEventListener('abort', onAbort, { once: true });
    }

    child.stdout.on('data', (c: Buffer) => stdoutChunks.push(c));
    child.stderr.on('data', (c: Buffer) => stderrChunks.push(c));

    child.once('error', (err: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (opts.signal !== undefined) opts.signal.removeEventListener('abort', onAbort);
      reject(err);
    });

    child.once('close', (code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (opts.signal !== undefined) opts.signal.removeEventListener('abort', onAbort);
      resolve({
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
        exitCode: code,
        durationMs: Date.now() - started,
      });
    });

    if (opts.stdin !== undefined) {
      child.stdin.on('error', (err: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (opts.signal !== undefined) opts.signal.removeEventListener('abort', onAbort);
        reject(err);
      });
      child.stdin.end(opts.stdin);
    } else {
      child.stdin.end();
    }
  });
}

// ---------------------------------------------------------------------------
// Streaming helper — yields chunks as NDJSON events arrive, kills on abort
// ---------------------------------------------------------------------------

type StreamQueueItem =
  | { kind: 'chunk'; chunk: ProviderStreamChunk }
  | { kind: 'end' }
  | { kind: 'error'; error: Error };

async function* streamClaude(
  child: ChildProcessWithoutNullStreams,
  opts: RunOptions,
): AsyncIterable<ProviderStreamChunk> {
  const queue: StreamQueueItem[] = [];
  let wake: (() => void) | undefined;
  let settled = false;

  const notify = (): void => {
    if (wake !== undefined) {
      const w = wake;
      wake = undefined;
      w();
    }
  };

  const finish = (item: StreamQueueItem): void => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    if (opts.signal !== undefined) opts.signal.removeEventListener('abort', onAbort);
    try {
      child.kill('SIGKILL');
    } catch {
      /* ignore */
    }
    queue.push(item);
    notify();
  };

  const onAbort = (): void => {
    finish({ kind: 'error', error: new AbortError('claude-cli: aborted by caller') });
  };

  const timer = setTimeout(() => {
    finish({
      kind: 'error',
      error: new Error(`claude-cli: stream timed out after ${String(opts.timeoutMs)}ms`),
    });
  }, opts.timeoutMs);

  if (opts.signal !== undefined) {
    if (opts.signal.aborted) {
      onAbort();
    } else {
      opts.signal.addEventListener('abort', onAbort, { once: true });
    }
  }

  const stderrChunks: Buffer[] = [];
  child.stderr.on('data', (c: Buffer) => stderrChunks.push(c));

  const rl = createInterface({ input: child.stdout, crlfDelay: Infinity });
  let sawResult = false;

  rl.on('line', (line) => {
    const event = parseStreamJsonLine(line);
    if (event === undefined) return;
    if (event.type === 'result') {
      sawResult = true;
      if (resultIsError(event)) {
        finish({
          kind: 'error',
          error: new Error(
            `claude-cli reported error (subtype=${event.subtype}): ${event.error ?? '<no error field>'}`,
          ),
        });
        return;
      }
      log.info(
        {
          usage: usageFromResult(event),
          cliDurationMs: event.duration_ms ?? null,
          numTurns: event.num_turns ?? null,
          sessionId: event.session_id ?? null,
        },
        'claude-cli stream complete',
      );
    }
    for (const chunk of eventToChunks(event)) {
      queue.push({ kind: 'chunk', chunk });
    }
    notify();
  });

  child.once('error', (err) => {
    finish({ kind: 'error', error: err });
  });

  child.once('close', (code) => {
    if (settled) return;
    if (code !== 0 && code !== null) {
      const stderr = Buffer.concat(stderrChunks).toString('utf8').slice(0, 2000);
      finish({
        kind: 'error',
        error: new Error(`claude-cli exited ${String(code)}: ${stderr || '<no stderr>'}`),
      });
      return;
    }
    if (!sawResult) {
      finish({
        kind: 'error',
        error: new Error('claude-cli: stream ended without a result event'),
      });
      return;
    }
    finish({ kind: 'end' });
  });

  if (opts.stdin !== undefined) {
    child.stdin.on('error', (err) => {
      finish({ kind: 'error', error: err });
    });
    child.stdin.end(opts.stdin);
  } else {
    child.stdin.end();
  }

  try {
    while (true) {
      while (queue.length > 0) {
        const item = queue.shift();
        if (item === undefined) break;
        if (item.kind === 'end') return;
        if (item.kind === 'error') throw item.error;
        yield item.chunk;
      }
      if (settled && queue.length === 0) return;
      await new Promise<void>((resolve) => {
        wake = resolve;
      });
    }
  } finally {
    // Consumer break / error / done — make sure the child is cleaned up.
    try {
      child.kill('SIGKILL');
    } catch {
      /* ignore */
    }
    clearTimeout(timer);
    if (opts.signal !== undefined) opts.signal.removeEventListener('abort', onAbort);
  }
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export class ClaudeCliProvider implements ModelProvider {
  readonly id = 'claude-cli';

  private readonly explicitBinary: string | undefined;
  private readonly extraArgs: readonly string[];
  private readonly defaultCwd: string | undefined;
  private readonly timeoutMs: number;
  private readonly streamTimeoutMs: number;
  private readonly maxTurns: number;
  private readonly noAvailabilityCache: boolean;

  private availabilityCache: boolean | undefined;
  private resolvedBinaryCache: string | undefined;

  constructor(opts: ClaudeCliProviderOptions = {}) {
    this.explicitBinary = opts.binaryPath;
    this.extraArgs = opts.extraArgs ?? [];
    this.defaultCwd = opts.cwd;
    this.timeoutMs = opts.timeoutMs ?? 10 * 60 * 1000;
    this.streamTimeoutMs = opts.streamTimeoutMs ?? this.timeoutMs * 2;
    this.maxTurns = opts.maxTurns ?? 40;
    this.noAvailabilityCache = opts.noAvailabilityCache ?? false;
  }

  /** Forget any cached availability / resolved binary. */
  resetAvailability(): void {
    this.availabilityCache = undefined;
    this.resolvedBinaryCache = undefined;
  }

  async available(): Promise<boolean> {
    if (!this.noAvailabilityCache && this.availabilityCache !== undefined) {
      return this.availabilityCache;
    }
    const bin = await this.getBinary();
    if (bin === undefined) {
      log.debug('claude binary not found on PATH');
      this.availabilityCache = false;
      return false;
    }
    try {
      const res = await collectRun(spawnClaude(bin, ['--version'], this.defaultCwd), {
        timeoutMs: 5000,
      });
      const ok = res.exitCode === 0;
      if (!ok) {
        log.debug(
          { bin, exitCode: res.exitCode, stderr: res.stderr.slice(0, 200) },
          'claude --version non-zero',
        );
      }
      this.availabilityCache = ok;
      return ok;
    } catch (err) {
      log.warn({ err, bin }, 'claude --version threw');
      this.availabilityCache = false;
      return false;
    }
  }

  async call(req: ProviderRequest): Promise<ProviderResponse> {
    const bin = await this.getBinary();
    if (bin === undefined) {
      throw new Error(
        'claude-cli: binary not found — install claude, set FACTORY5_CLAUDE_CLI_PATH, or pass binaryPath',
      );
    }
    const args = buildClaudeArgs(req, this.extraArgs, 'json');
    const promptText = composePromptText(req.systemPrompt, req.messages);
    const cwd = req.cwd ?? this.defaultCwd;

    log.debug(
      {
        model: req.model,
        args,
        cwd: cwd ?? null,
        promptBytes: Buffer.byteLength(promptText, 'utf8'),
      },
      'spawning claude -p (json)',
    );

    const child = spawnClaude(bin, args, cwd);
    const res = await collectRun(child, {
      timeoutMs: this.timeoutMs,
      stdin: promptText,
      ...(req.signal !== undefined ? { signal: req.signal } : {}),
    });

    if (res.exitCode !== 0) {
      throw new Error(
        `claude-cli exited ${String(res.exitCode)}: ${res.stderr.slice(0, 2000) || res.stdout.slice(0, 2000)}`,
      );
    }

    const parsed = parseClaudeJsonResult(res.stdout);
    if (parsed.is_error === true) {
      throw new Error(
        `claude-cli reported error (subtype=${parsed.subtype}): ${parsed.error ?? '<no error field>'}`,
      );
    }

    const usage = extractUsage(parsed);
    const text = parsed.result ?? '';

    log.info(
      {
        model: req.model,
        usage,
        durationMs: res.durationMs,
        cliDurationMs: parsed.duration_ms ?? null,
        sessionId: parsed.session_id ?? null,
      },
      'claude-cli call complete',
    );

    return {
      text,
      usage,
      resolvedProvider: this.id,
      resolvedModel: req.model,
    };
  }

  /**
   * Real streaming: spawns `claude -p --output-format stream-json --verbose`
   * and yields a {@link ProviderStreamChunk} per assistant text block. The
   * terminal chunk (from the `result` event) carries final usage. Honors
   * `req.signal` via kill-and-settle and enforces a hard timeout via
   * {@link ClaudeCliProviderOptions.streamTimeoutMs}.
   */
  async *stream(req: ProviderRequest): AsyncIterable<ProviderStreamChunk> {
    const bin = await this.getBinary();
    if (bin === undefined) {
      throw new Error(
        'claude-cli: binary not found — install claude, set FACTORY5_CLAUDE_CLI_PATH, or pass binaryPath',
      );
    }

    const effectiveMaxTurns =
      req.maxTurns !== undefined && req.maxTurns > 0 ? req.maxTurns : this.maxTurns;
    const args = buildClaudeArgs(req, this.extraArgs, 'stream-json', {
      maxTurns: effectiveMaxTurns,
    });
    const promptText = composePromptText(req.systemPrompt, req.messages);
    const cwd = req.cwd ?? this.defaultCwd;

    log.debug(
      {
        model: req.model,
        args,
        cwd: cwd ?? null,
        promptBytes: Buffer.byteLength(promptText, 'utf8'),
      },
      'spawning claude -p (stream-json)',
    );

    const child = spawnClaude(bin, args, cwd);
    const iter = streamClaude(child, {
      timeoutMs: this.streamTimeoutMs,
      stdin: promptText,
      ...(req.signal !== undefined ? { signal: req.signal } : {}),
    });
    for await (const chunk of iter) yield chunk;
  }

  private async getBinary(): Promise<string | undefined> {
    if (this.resolvedBinaryCache !== undefined) return this.resolvedBinaryCache;
    const bin = await resolveBinary(this.explicitBinary);
    if (bin !== undefined) this.resolvedBinaryCache = bin;
    return bin;
  }
}
