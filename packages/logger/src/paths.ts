/**
 * Cross-platform paths for factory5's runtime data (logs, SQLite DB, config).
 *
 * Linux / Mac: under `$HOME/.factory5/`
 * Windows:     under `%LOCALAPPDATA%\factory5\`
 *
 * Override either with the env var `FACTORY5_DATA_DIR` (one root for everything).
 * Override the logs dir specifically with `FACTORY5_LOG_DIR`.
 */

import { homedir } from 'node:os';
import { join } from 'node:path';
import { env, platform } from 'node:process';

/** Root data directory. Holds `factory.db`, `logs/`, `config.toml`, etc. */
export function dataDir(): string {
  const override = env['FACTORY5_DATA_DIR'];
  if (override !== undefined && override.length > 0) return override;

  if (platform === 'win32') {
    const localAppData = env['LOCALAPPDATA'] ?? join(homedir(), 'AppData', 'Local');
    return join(localAppData, 'factory5');
  }
  return join(homedir(), '.factory5');
}

/** Directory for log files. */
export function logsDir(): string {
  const override = env['FACTORY5_LOG_DIR'];
  if (override !== undefined && override.length > 0) return override;
  return join(dataDir(), 'logs');
}
