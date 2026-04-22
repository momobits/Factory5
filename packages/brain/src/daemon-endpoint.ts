/**
 * Resolve the daemon bind endpoint (host + port) for this instance.
 *
 * Precedence, from highest to lowest:
 *
 *   1. `FACTORY5_DAEMON_HOST` / `FACTORY5_DAEMON_PORT` env vars —
 *      runtime override for CI, Docker mounts, or temp smokes.
 *   2. `[daemon]` block in the instance's `config.toml`. Persistent
 *      per-instance setting; unique values per instance enable
 *      parallel factories (ADR 0023).
 *   3. `DEFAULT_DAEMON_HOST` / `DEFAULT_DAEMON_PORT` from `@factory5/core`
 *      — one-factory fallback, same behaviour as pre-addendum.
 *
 * Used by `factoryd` at bind time and by CLI commands that instantiate
 * a {@link DaemonClient}. Both sides resolve the same way so "point at
 * this instance" means "use this endpoint" without threading host/port
 * through every callsite.
 */

import { env } from 'node:process';

import { DEFAULT_DAEMON_HOST, DEFAULT_DAEMON_PORT } from '@factory5/core';

import { loadConfig } from './config.js';

export interface DaemonEndpoint {
  host: string;
  port: number;
}

/** Parse an int env var; throws on malformed so misconfiguration is loud. */
function parseIntEnv(name: string, raw: string): number {
  const trimmed = raw.trim();
  const n = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(n) || String(n) !== trimmed || n <= 0 || n > 65535) {
    throw new Error(`${name} must be an integer port (1–65535); got ${JSON.stringify(raw)}`);
  }
  return n;
}

/**
 * Resolve the daemon endpoint. Reads config.toml's `[daemon]` block
 * lazily; on parse error falls back to env + defaults rather than
 * aborting — callers still see _some_ endpoint and can surface the
 * config error separately. Env vars always win over config.
 */
export async function loadDaemonEndpoint(): Promise<DaemonEndpoint> {
  const envHost = env['FACTORY5_DAEMON_HOST'];
  const envPortRaw = env['FACTORY5_DAEMON_PORT'];

  let cfgHost: string | undefined;
  let cfgPort: number | undefined;
  try {
    const cfg = await loadConfig();
    cfgHost = cfg?.daemon.host;
    cfgPort = cfg?.daemon.port;
  } catch {
    // Silent fallback — the caller can surface config errors via a
    // separate loadConfig() if they care. Endpoint resolution must
    // not fail just because the config file is broken.
  }

  return {
    host: envHost !== undefined && envHost.length > 0 ? envHost : (cfgHost ?? DEFAULT_DAEMON_HOST),
    port:
      envPortRaw !== undefined && envPortRaw.length > 0
        ? parseIntEnv('FACTORY5_DAEMON_PORT', envPortRaw)
        : (cfgPort ?? DEFAULT_DAEMON_PORT),
  };
}
