/**
 * Minimal subprocess runner used by assessor checks. Mirrors the pattern from
 * `@factory5/providers/claude-cli`: safe cross-platform spawn, captured
 * stdout/stderr, timeout-enforced.
 *
 * Internal to assessor — consumers should call the higher-level checks.
 */

import type { ChildProcess } from 'node:child_process';
import { spawn } from 'node:child_process';
import { constants as fsConstants } from 'node:fs';
import { access } from 'node:fs/promises';
import { delimiter, join } from 'node:path';
import { env, platform } from 'node:process';

import { killProcessTree } from '@factory5/core/proc';

export interface SubprocessResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  durationMs: number;
}

export interface SubprocessOptions {
  cwd?: string;
  timeoutMs?: number;
  env?: Record<string, string>;
}

function isWindowsBatch(bin: string): boolean {
  return platform === 'win32' && /\.(cmd|bat)$/i.test(bin);
}

function quoteForCmd(s: string): string {
  if (s.includes('\r') || s.includes('\n') || s.includes('\0')) {
    throw new Error('assessor.run: arg contains control characters');
  }
  if (s.length === 0) return '""';
  if (!/[\s"^&|<>()%!]/.test(s)) return s;
  const escaped = s.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1');
  return `"${escaped}"`;
}

export function runSubprocess(
  bin: string,
  args: readonly string[],
  opts: SubprocessOptions = {},
): Promise<SubprocessResult> {
  const timeoutMs = opts.timeoutMs ?? 120_000;

  let child: ChildProcess;
  if (isWindowsBatch(bin)) {
    const line = [quoteForCmd(bin), ...args.map(quoteForCmd)].join(' ');
    child = spawn(line, {
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      ...(opts.cwd !== undefined ? { cwd: opts.cwd } : {}),
      ...(opts.env !== undefined ? { env: { ...env, ...opts.env } } : {}),
    });
  } else {
    child = spawn(bin, [...args], {
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      ...(opts.cwd !== undefined ? { cwd: opts.cwd } : {}),
      ...(opts.env !== undefined ? { env: { ...env, ...opts.env } } : {}),
    });
  }

  return new Promise((resolve, reject) => {
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    const started = Date.now();
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      // Tree-kill: build/test launchers (pnpm, go, cargo, python, cmd.exe)
      // spawn deep child trees; child.kill alone orphans them (esp. on Windows).
      killProcessTree(child);
      reject(new Error(`assessor.run: ${bin} timed out after ${String(timeoutMs)}ms`));
    }, timeoutMs);

    child.stdout?.on('data', (c: Buffer) => stdoutChunks.push(c));
    child.stderr?.on('data', (c: Buffer) => stderrChunks.push(c));

    child.once('error', (err: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });

    child.once('close', (code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
        exitCode: code,
        durationMs: Date.now() - started,
      });
    });
  });
}

/**
 * Locate a binary on PATH. Returns the absolute path or undefined. On
 * Windows, probes PATHEXT for `.cmd`/`.exe`/...
 */
export async function resolveOnPath(name: string): Promise<string | undefined> {
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
      const candidate = join(dir, `${name}${ext}`);
      try {
        await access(candidate, fsConstants.F_OK);
        return candidate;
      } catch {
        /* next */
      }
    }
  }
  return undefined;
}
