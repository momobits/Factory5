/**
 * Pino-based logger with per-component children, file + console sinks,
 * and per-build sink mirroring.
 */

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { env, pid, stdout } from 'node:process';

import type { DestinationStream, Logger as PinoLogger, LoggerOptions as PinoOptions } from 'pino';
import pino, { multistream } from 'pino';

import { logsDir } from './paths.js';

/** Re-export of Pino's logger type for callers that need the full surface. */
export type Logger = PinoLogger;

/** Config for the root logger. Apps call {@link initLogger} once at startup. */
export interface LoggerOptions {
  /** Process name used in file paths and the `process` log field. */
  processName: 'factory' | 'factoryd' | 'worker' | string;
  /** Default minimum level. Defaults to env `FACTORY5_LOG_LEVEL` then `'info'`. */
  level?: string;
  /** Disable file sink (useful in tests). Defaults to `false`. */
  noFile?: boolean;
  /** Disable console sink (useful in tests). Defaults to `false`. */
  noConsole?: boolean;
}

let rootLogger: PinoLogger | undefined;

/**
 * Initialize the root logger. Must be called once per process before any
 * `createLogger` call. Apps (`apps/factory/src/main.ts`,
 * `apps/factoryd/src/main.ts`) call this immediately on startup.
 */
export function initLogger(opts: LoggerOptions): PinoLogger {
  if (rootLogger !== undefined) return rootLogger;

  const level = opts.level ?? env['FACTORY5_LOG_LEVEL'] ?? 'info';
  const dir = logsDir();
  if (opts.noFile !== true) {
    mkdirSync(dir, { recursive: true });
  }

  const today = new Date().toISOString().slice(0, 10);
  const filePath = join(dir, `${opts.processName}-${today}.log`);

  const streams: { level: string; stream: DestinationStream }[] = [];

  if (opts.noConsole !== true) {
    if (stdout.isTTY) {
      // Pretty-printed for humans
      const pretty = pino.transport({
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:HH:MM:ss.l',
          ignore: 'pid,hostname',
          messageFormat: '[{component}] {msg}',
        },
      });
      streams.push({ level, stream: pretty });
    } else {
      // JSON for CI / non-TTY
      streams.push({ level, stream: stdout });
    }
  }

  if (opts.noFile !== true) {
    const fileStream = pino.destination({
      dest: filePath,
      sync: false,
      mkdir: true,
    });
    streams.push({ level, stream: fileStream });
  }

  const baseOptions: PinoOptions = {
    level,
    base: {
      pid,
      process: opts.processName,
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level: (label) => ({ level: label }),
    },
    serializers: pino.stdSerializers,
  };

  rootLogger = streams.length > 0 ? pino(baseOptions, multistream(streams)) : pino(baseOptions);

  return rootLogger;
}

/** Get the root logger. Throws if `initLogger` has not been called. */
export function getRootLogger(): PinoLogger {
  if (rootLogger === undefined) {
    throw new Error('logger not initialized — call initLogger({ processName }) at app startup');
  }
  return rootLogger;
}

/**
 * Create a component logger. Components are dotted strings like
 * `brain.triage`, `daemon.discord`, `worker.builder`.
 *
 * Per-component log levels can be set via env: `FACTORY5_LOG_LEVEL_BRAIN_TRIAGE=debug`
 * (uppercase, dots → underscores).
 *
 * @example
 * ```ts
 * const log = createLogger('brain.triage');
 * log.info({ directiveId }, 'classifying');
 * ```
 */
export function createLogger(component: string): PinoLogger {
  if (rootLogger === undefined) {
    // Auto-init with sensible defaults — apps SHOULD call initLogger explicitly,
    // but if a library is loaded standalone (e.g., tests), don't crash.
    initLogger({ processName: env['FACTORY5_PROCESS_NAME'] ?? 'unknown', noFile: true });
  }
  const root = getRootLogger();
  const overrideKey = `FACTORY5_LOG_LEVEL_${component.toUpperCase().replace(/\./g, '_')}`;
  const override = env[overrideKey];
  const child = root.child({ component });
  if (override !== undefined && override.length > 0) {
    child.level = override;
  }
  return child;
}

/**
 * Handle for a per-build sink mirror. Call `close()` when the build ends.
 */
export interface BuildSinkHandle {
  /** Close the per-build file stream. */
  close(): void;
  /** Path to the per-build log file. */
  path: string;
}

/**
 * Add an additional sink that mirrors brain log lines into a project's
 * `.factory/logs/build-<buildId>.log` for the duration of a build.
 *
 * Returns a handle whose `close()` should be called when the build ends.
 *
 * Note: this is a stub for v0. The full implementation will require either
 * upstream Pino support for adding streams to an existing logger, or wrapping
 * `createLogger` to fan-out. Tracked for Phase 1.
 */
export function withBuildSink(_opts: { projectPath: string; buildId: string }): BuildSinkHandle {
  // TODO(phase-1): implement mirror-stream attachment.
  return {
    close: () => undefined,
    path: '',
  };
}
