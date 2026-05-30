/**
 * Cross-platform process-tree termination.
 *
 * `child.kill()` only signals the direct child. Long-running commands the
 * assessor/validator run (`pytest`, `pnpm test`, `go test`, `cargo test`,
 * `claude -p`) spawn their own grandchildren (test runners, compilers, dev
 * servers). On a timeout we want the *whole tree* gone, not just the launcher.
 *
 * This is its own sub-path module (`@factory5/core/proc`) so importing it never
 * pulls `node:child_process` into the main `@factory5/core` entry or the web
 * SSR bundle — same isolation rationale as `@factory5/core/budgets`.
 */

import { spawn, type ChildProcess } from 'node:child_process';

/** Options for {@link killProcessTree}; the injectables exist for tests. */
export interface KillProcessTreeOptions {
  /** Signal sent to the direct child. Default `'SIGKILL'`. */
  signal?: NodeJS.Signals;
  /** Override the detected platform (test injection). */
  platform?: NodeJS.Platform;
  /** Override `child_process.spawn` (test injection). */
  spawnFn?: typeof spawn;
}

/**
 * Terminate a spawned child **and its descendants**, cross-platform.
 *
 * - **Windows**: Node maps `child.kill()` to `TerminateProcess`, which kills
 *   only the named process and orphans its tree. We additionally run
 *   `taskkill /pid <pid> /T /F` to walk and force-kill the whole tree
 *   (`/T` includes the `cmd.exe` intermediary in `shell: true` spawns).
 * - **POSIX**: full group-kill requires the child to have been spawned with
 *   `detached: true` (so it leads its own process group); that opt-in is a
 *   spawn-site decision, so here we fall back to signalling the direct child —
 *   identical to the prior `child.kill(signal)` behavior, no regression.
 *
 * Best-effort and never throws: a child that already exited, a missing pid, or
 * a `taskkill` failure is swallowed (the caller's `close` listener is the
 * authoritative settle path).
 */
export function killProcessTree(child: ChildProcess, opts: KillProcessTreeOptions = {}): void {
  const platform = opts.platform ?? process.platform;
  const signal = opts.signal ?? 'SIGKILL';
  const spawnFn = opts.spawnFn ?? spawn;
  const pid = child.pid;

  if (platform === 'win32' && pid !== undefined) {
    try {
      const tk = spawnFn('taskkill', ['/pid', String(pid), '/T', '/F'], {
        stdio: 'ignore',
        shell: false,
      });
      // Best-effort: don't let a taskkill spawn error become an unhandled event.
      tk.on('error', () => undefined);
    } catch {
      /* taskkill unavailable — fall through to the direct kill below */
    }
  }

  try {
    child.kill(signal);
  } catch {
    /* already exited */
  }
}
