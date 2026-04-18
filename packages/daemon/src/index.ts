/**
 * @factory5/daemon — daemon process assembly.
 *
 * @packageDocumentation
 */

import { DEFAULT_DAEMON_HOST, DEFAULT_DAEMON_PORT } from '@factory5/core';
import { createLogger } from '@factory5/logger';

const log = createLogger('daemon');

export interface DaemonOptions {
  host?: string;
  port?: number;
}

export interface DaemonHandle {
  /** Bound port (may differ from requested if 0 was passed). */
  port: number;
  /** Stop the daemon gracefully. */
  stop(): Promise<void>;
}

/**
 * Start the daemon. Phase 3 implementation: spawn Fastify, register channels
 * and events, expose IPC routes. Until then, this is a stub that resolves
 * immediately so the binary can answer `--version` / `--help`.
 */
export async function startDaemon(opts: DaemonOptions = {}): Promise<DaemonHandle> {
  const host = opts.host ?? DEFAULT_DAEMON_HOST;
  const port = opts.port ?? DEFAULT_DAEMON_PORT;
  log.warn({ host, port }, 'startDaemon: stub — Phase 3 implementation pending');
  return {
    port,
    stop: async () => {
      log.info('stopDaemon: stub stop');
    },
  };
}

/** Convenience for symmetric API. */
export async function stopDaemon(handle: DaemonHandle): Promise<void> {
  await handle.stop();
}
