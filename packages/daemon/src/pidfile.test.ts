import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { acquirePidFile, PidFileLockedError, readPidFile, reapStalePidFile } from './pidfile.js';

describe('pidfile', () => {
  let dir: string;
  let pidPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'factory5-pidfile-'));
    pidPath = join(dir, 'factoryd.pid');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('acquires a fresh pidfile and release cleans up', () => {
    const h = acquirePidFile(pidPath);
    expect(h.pid).toBe(process.pid);
    expect(readFileSync(pidPath, 'utf8').trim()).toBe(String(process.pid));

    h.release();
    const after = readPidFile(pidPath);
    expect(after).toBeUndefined();
  });

  it('refuses to acquire when a live process owns the pidfile', () => {
    // Use our own PID as the "other owner" — guaranteed alive.
    writeFileSync(pidPath, `${String(process.pid)}\n`);

    // Temporarily pretend we're a different PID by monkey-patching — the
    // cleaner route is to just verify that a live foreign PID throws.
    const originalPid = process.pid;
    Object.defineProperty(process, 'pid', { value: originalPid + 99_999, configurable: true });
    try {
      expect(() => acquirePidFile(pidPath)).toThrow(PidFileLockedError);
    } finally {
      Object.defineProperty(process, 'pid', { value: originalPid, configurable: true });
    }
  });

  it('reaps a stale pidfile (dead owner)', () => {
    // PID 0 is never a valid process owner, so `kill(0, 0)` is treated as dead.
    // Use a PID that's almost certainly unused on the machine.
    writeFileSync(pidPath, '9\n');
    const h = acquirePidFile(pidPath);
    expect(h.pid).toBe(process.pid);
    expect(readFileSync(pidPath, 'utf8').trim()).toBe(String(process.pid));
    h.release();
  });

  it('release is a no-op if the pidfile no longer belongs to us', () => {
    const h = acquirePidFile(pidPath);
    // Someone overwrote our pidfile (another daemon started and reaped ours).
    writeFileSync(pidPath, '1\n');
    h.release();
    // The foreign pidfile is preserved.
    expect(readFileSync(pidPath, 'utf8').trim()).toBe('1');
  });

  it('readPidFile reports absent / present / liveness', () => {
    expect(readPidFile(pidPath)).toBeUndefined();
    const h = acquirePidFile(pidPath);
    const info = readPidFile(pidPath);
    expect(info?.pid).toBe(process.pid);
    expect(info?.alive).toBe(true);
    h.release();
  });

  // Phase 13.4 / U034 — `factory daemon stop` on Windows leaves a stale
  // pidfile because Node maps SIGTERM to TerminateProcess, hard-killing
  // factoryd before its release handler runs. reapStalePidFile is the
  // CLI-side belt-and-suspenders called post-`waitPidGone()`.

  it('reapStalePidFile unlinks when the pidfile still contains the killed PID', () => {
    writeFileSync(pidPath, '12345\n');
    const unlinked = reapStalePidFile(12345, pidPath);
    expect(unlinked).toBe(true);
    expect(readPidFile(pidPath)).toBeUndefined();
  });

  it('reapStalePidFile is a no-op when the pidfile is already absent', () => {
    const unlinked = reapStalePidFile(12345, pidPath);
    expect(unlinked).toBe(false);
    expect(readPidFile(pidPath)).toBeUndefined();
  });

  it('reapStalePidFile does NOT unlink when a different PID owns the pidfile (race-restart)', () => {
    // Operator runs `factory daemon stop` immediately followed by `start`; the
    // new daemon spawned and wrote its own PID before we got to the cleanup.
    // We must not clobber the new owner's pidfile.
    writeFileSync(pidPath, '99999\n');
    const unlinked = reapStalePidFile(12345, pidPath);
    expect(unlinked).toBe(false);
    expect(readFileSync(pidPath, 'utf8').trim()).toBe('99999');
  });

  it('reapStalePidFile is a no-op when the pidfile is unreadable / malformed', () => {
    writeFileSync(pidPath, 'not-a-number\n');
    const unlinked = reapStalePidFile(12345, pidPath);
    expect(unlinked).toBe(false);
    // We don't try to interpret malformed pidfiles — leave them for the next
    // acquirePidFile() call to reap via its existing stale-file path.
    expect(readFileSync(pidPath, 'utf8').trim()).toBe('not-a-number');
  });
});
