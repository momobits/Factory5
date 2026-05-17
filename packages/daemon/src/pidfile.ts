/**
 * Pidfile acquire / release for `factoryd`.
 *
 * One daemon per host. We coordinate with a pidfile under the factory5 data
 * directory (`%LOCALAPPDATA%\factory5\factoryd.pid` on Windows,
 * `~/.factory5/factoryd.pid` elsewhere). The protocol:
 *
 * 1. If the pidfile does not exist, write our PID and claim it.
 * 2. If it does exist, read the PID and liveness-check it via `kill(pid, 0)`.
 *    Alive → throw {@link PidFileLockedError}. Dead → treat as stale, remove,
 *    retry.
 *
 * Release removes the pidfile only when it still contains our PID — so a
 * restarted daemon can't accidentally release its successor's pidfile.
 */

import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import process from 'node:process';

import { createLogger } from '@factory5/logger';
import { dataDir } from '@factory5/logger/paths';

const log = createLogger('daemon.pidfile');

/** Default pidfile path. Override via `FACTORY5_PIDFILE` env or an explicit argument. */
export function defaultPidFilePath(): string {
  const override = process.env['FACTORY5_PIDFILE'];
  if (override !== undefined && override.length > 0) return override;
  return join(dataDir(), 'factoryd.pid');
}

/**
 * Thrown by {@link acquirePidFile} when a live daemon already owns the pidfile.
 */
export class PidFileLockedError extends Error {
  override readonly name = 'PidFileLockedError';
  constructor(
    public readonly ownerPid: number,
    public readonly path: string,
  ) {
    super(`factoryd already running with PID ${String(ownerPid)} (pidfile: ${path})`);
  }
}

export interface PidFileHandle {
  /** Absolute path to the pidfile. */
  path: string;
  /** The PID we wrote (current process PID at acquire time). */
  pid: number;
  /** Release the pidfile. Only unlinks if the file still contains our PID. */
  release(): void;
}

/** True when `pid` points at a running process on this machine. */
function processAlive(p: number): boolean {
  if (!Number.isInteger(p) || p <= 0) return false;
  try {
    // kill(pid, 0) — signal 0 is a liveness probe; throws if the process is
    // gone. EPERM means the process exists but we can't signal it: still alive.
    process.kill(p, 0);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'EPERM') return true;
    return false;
  }
}

function readPidFromFile(path: string): number | undefined {
  try {
    const text = readFileSync(path, 'utf8').trim();
    const n = Number(text);
    return Number.isInteger(n) && n > 0 ? n : undefined;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return undefined;
    log.warn({ err, path }, 'pidfile unreadable — treating as stale');
    return undefined;
  }
}

function removeIfExists(path: string): void {
  try {
    unlinkSync(path);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') {
      throw new Error(`failed to remove pidfile ${path}: ${code ?? 'unknown'}`);
    }
  }
}

/**
 * Atomically claim the pidfile for this process.
 *
 * Stale pidfiles (owner process is gone) are reaped automatically. If the
 * owner is alive, throws {@link PidFileLockedError}. If a racing process wrote
 * the file between our stale-check and our `wx` open, we retry once.
 */
export function acquirePidFile(path = defaultPidFilePath()): PidFileHandle {
  mkdirSync(dirname(path), { recursive: true });
  const myPid = process.pid;

  for (let attempt = 0; attempt < 2; attempt++) {
    if (existsSync(path)) {
      const existing = readPidFromFile(path);
      if (existing !== undefined && existing !== myPid && processAlive(existing)) {
        throw new PidFileLockedError(existing, path);
      }
      log.info({ path, staleOwner: existing }, 'reaping stale pidfile');
      removeIfExists(path);
    }
    try {
      writeFileSync(path, `${String(myPid)}\n`, { flag: 'wx' });
      log.info({ path, pid: myPid }, 'pidfile acquired');
      return {
        path,
        pid: myPid,
        release: () => {
          const current = readPidFromFile(path);
          if (current !== myPid) {
            log.warn({ path, current, myPid }, 'pidfile not ours on release — skipping unlink');
            return;
          }
          try {
            unlinkSync(path);
            log.info({ path }, 'pidfile released');
          } catch (err) {
            const code = (err as NodeJS.ErrnoException).code;
            if (code !== 'ENOENT') log.warn({ err, path }, 'pidfile release failed');
          }
        },
      };
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'EEXIST') throw err;
      // Lost the race — another process wrote between our unlink and our wx-open.
      // Loop back and re-check: it might be a real owner now.
    }
  }
  throw new Error(`failed to acquire pidfile at ${path} after retry`);
}

/** Peek at the current pidfile owner. Returns `undefined` if absent or unreadable. */
export function readPidFile(
  path = defaultPidFilePath(),
): { pid: number; alive: boolean } | undefined {
  const pid = readPidFromFile(path);
  if (pid === undefined) return undefined;
  return { pid, alive: processAlive(pid) };
}

/**
 * Phase 13.4 / U034 — clean up a stale pidfile after the owning daemon is
 * known to be gone.
 *
 * Used by `factory daemon stop` to defensively unlink the pidfile when the
 * daemon's own shutdown handler couldn't release it. On Windows,
 * `process.kill(pid, 'SIGTERM')` is mapped to `TerminateProcess` — a hard
 * kill that bypasses the daemon's `release()` cleanup. The CLI calls this
 * after {@link readPidFile}'s `alive` flag flips to false, so the pidfile
 * doesn't sit on disk pointing at a dead PID until the next `daemon start`
 * auto-reaps it.
 *
 * The same-PID predicate handles the race-restart edge case: if a fresh
 * daemon spawned and wrote its own PID between `waitPidGone()` returning
 * and our cleanup call, the predicate skips the unlink so we don't clobber
 * the new owner's file.
 *
 * Malformed pidfile contents (non-integer) are left in place — let
 * {@link acquirePidFile}'s existing stale-file reaper handle them via its
 * `unreadable → treat as stale` path on the next acquire.
 *
 * @returns `true` if we unlinked the pidfile; `false` if it was absent,
 *          unreadable, or contained a different PID (race-restart).
 */
export function reapStalePidFile(expectedPid: number, path = defaultPidFilePath()): boolean {
  const current = readPidFromFile(path);
  if (current === undefined) return false;
  if (current !== expectedPid) return false;
  try {
    unlinkSync(path);
    log.info({ path, pid: expectedPid }, 'reaped stale pidfile after stop');
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return false;
    log.warn({ err, path, pid: expectedPid }, 'failed to reap stale pidfile');
    return false;
  }
}
