import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { acquirePidFile, PidFileLockedError, readPidFile } from './pidfile.js';

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
});
