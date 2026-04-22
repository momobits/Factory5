/**
 * Cross-platform paths for factory5's runtime data (logs, SQLite DB, config).
 *
 * Resolution precedence for {@link dataDir}:
 *
 *   1. `FACTORY5_DATA_DIR` env var — explicit override (for CI, systemd
 *      services, or any context where cwd-based discovery is wrong).
 *   2. Walk up from `process.cwd()` looking for a `.factory/` directory
 *      that contains `config.toml`. That marks an **instance root** —
 *      the same convention Git uses with `.git/`. This is how a dev
 *      switches between factory instances: `cd` into the instance tree
 *      and everything follows.
 *   3. Fallback: `~/.factory/` on all platforms (e.g. `C:\Users\<user>\
 *      .factory\` on Windows). Preserves the "one implicit instance"
 *      behaviour for users who never set up a repo-local dir.
 *
 * Logs go under `<dataDir>/logs/` by default; override with
 * `FACTORY5_LOG_DIR` if needed.
 */

import { statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { cwd, env } from 'node:process';

/** Directory name that marks a factory instance root. */
export const INSTANCE_DIR_NAME = '.factory';

/** Upper bound on the cwd-walk — defends against pathological trees. */
const MAX_WALK_DEPTH = 32;

/**
 * Walk up from `startDir` looking for an `INSTANCE_DIR_NAME` directory
 * that contains `config.toml`. Returns the instance root (absolute
 * path) on success, `undefined` otherwise. Exposed for tests.
 */
export function discoverInstanceFromCwd(startDir: string = cwd()): string | undefined {
  let dir = startDir;
  for (let i = 0; i < MAX_WALK_DEPTH; i++) {
    const candidate = join(dir, INSTANCE_DIR_NAME);
    try {
      statSync(join(candidate, 'config.toml'));
      return candidate;
    } catch {
      // Either the directory doesn't exist or config.toml isn't there —
      // either way, this level isn't an instance root; walk up.
    }
    const parent = dirname(dir);
    if (parent === dir) break; // reached filesystem root
    dir = parent;
  }
  return undefined;
}

/** Root data directory. Holds `factory.db`, `logs/`, `config.toml`, etc. */
export function dataDir(): string {
  const override = env['FACTORY5_DATA_DIR'];
  if (override !== undefined && override.length > 0) return override;

  const discovered = discoverInstanceFromCwd();
  if (discovered !== undefined) return discovered;

  return join(homedir(), INSTANCE_DIR_NAME);
}

/** Directory for log files. */
export function logsDir(): string {
  const override = env['FACTORY5_LOG_DIR'];
  if (override !== undefined && override.length > 0) return override;
  return join(dataDir(), 'logs');
}
