import type { ChildProcess } from 'node:child_process';
import type { spawn } from 'node:child_process';

import { describe, expect, it, vi } from 'vitest';

import { killProcessTree } from './proc.js';

/** Minimal ChildProcess stand-in with a spy `kill`. */
function fakeChild(pid: number | undefined): { kill: ReturnType<typeof vi.fn> } & ChildProcess {
  return { pid, kill: vi.fn() } as unknown as { kill: ReturnType<typeof vi.fn> } & ChildProcess;
}

/** A spawn spy whose return value carries the `.on` killProcessTree attaches. */
function fakeSpawn(): ReturnType<typeof vi.fn> {
  return vi.fn(() => ({ on: vi.fn() }));
}

describe('killProcessTree', () => {
  it('on Windows runs `taskkill /pid <pid> /T /F` and also signals the child', () => {
    const child = fakeChild(4321);
    const spawnFn = fakeSpawn();
    killProcessTree(child, { platform: 'win32', spawnFn: spawnFn as unknown as typeof spawn });
    expect(spawnFn).toHaveBeenCalledWith(
      'taskkill',
      ['/pid', '4321', '/T', '/F'],
      expect.objectContaining({ shell: false }),
    );
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
  });

  it('on POSIX signals only the direct child (no taskkill)', () => {
    const child = fakeChild(4321);
    const spawnFn = fakeSpawn();
    killProcessTree(child, {
      platform: 'linux',
      spawnFn: spawnFn as unknown as typeof spawn,
      signal: 'SIGTERM',
    });
    expect(spawnFn).not.toHaveBeenCalled();
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('skips taskkill when the child has no pid', () => {
    const child = fakeChild(undefined);
    const spawnFn = fakeSpawn();
    killProcessTree(child, { platform: 'win32', spawnFn: spawnFn as unknown as typeof spawn });
    expect(spawnFn).not.toHaveBeenCalled();
  });

  it('never throws when child.kill throws (already exited)', () => {
    const child = fakeChild(1);
    child.kill.mockImplementation(() => {
      throw new Error('process already exited');
    });
    expect(() => killProcessTree(child, { platform: 'linux' })).not.toThrow();
  });
});
