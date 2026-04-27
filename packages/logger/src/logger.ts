/**
 * Pino-based logger with per-component children, file + console sinks,
 * and per-build sink mirroring.
 *
 * Init contract — read this before changing the boot semantics:
 *
 *   - `initLogger(opts)` is the *explicit* boot. Apps call it once at
 *     startup before any log line is emitted.
 *   - `createLogger(component)` may be called at module top level. It
 *     returns a lazy `Proxy` that doesn't bind to the root logger
 *     until the first log call. By that time the app has had its
 *     chance to call `initLogger` explicitly.
 *   - If the app forgets and a log line fires before `initLogger`,
 *     a *fallback auto-init* kicks in with `noFile: true` and process
 *     name `unknown` — useful for ad-hoc / test scripts but never the
 *     intended production state.
 *   - If `initLogger(opts)` is called *after* an auto-init has already
 *     happened, it **replaces** the root and the existing
 *     `createLogger`-returned proxies pick up the new root on their
 *     next call. This is what fixes I015 (file sink silently disabled
 *     by transitive top-level `createLogger` calls).
 *
 * Pre-I015 behaviour: `createLogger` itself triggered auto-init.
 * Because every workspace package declares `const log =
 * createLogger('component')` at module top level, the auto-init
 * (which runs with `noFile: true`) always won the race against the
 * app's explicit `initLogger({ processName: 'factoryd' })` call,
 * leaving the file sink permanently disabled in production.
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
type InitMode = 'unset' | 'auto' | 'explicit';
let initMode: InitMode = 'unset';

function buildRootLogger(opts: LoggerOptions): PinoLogger {
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

  return streams.length > 0 ? pino(baseOptions, multistream(streams)) : pino(baseOptions);
}

/**
 * Initialize the root logger explicitly. Apps (`apps/factory/src/main.ts`,
 * `apps/factoryd/src/main.ts`) call this once on startup.
 *
 * If a previous auto-init (triggered by a log line that fired before this
 * call) has already built a root, this **replaces** that root. Any
 * `createLogger`-returned proxies pick up the new root on their next
 * call, so the explicit-init streams (notably the file sink) take effect.
 *
 * Idempotent: a second explicit `initLogger` call returns the existing
 * root unchanged.
 */
export function initLogger(opts: LoggerOptions): PinoLogger {
  if (initMode === 'explicit') return rootLogger!;
  if (rootLogger !== undefined && typeof rootLogger.flush === 'function') {
    try {
      rootLogger.flush();
    } catch {
      // Auto-init root was console-only; flushing is best-effort. The new
      // root takes over regardless.
    }
  }
  rootLogger = buildRootLogger(opts);
  initMode = 'explicit';
  return rootLogger;
}

function autoInitLogger(): PinoLogger {
  if (rootLogger !== undefined) return rootLogger;
  rootLogger = buildRootLogger({
    processName: env['FACTORY5_PROCESS_NAME'] ?? 'unknown',
    noFile: true,
  });
  initMode = 'auto';
  return rootLogger;
}

/** Get the root logger. Throws if neither `initLogger` nor an auto-init has run. */
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
 * The returned logger is a `Proxy` that resolves to a Pino child of the
 * current root logger on first access. If `initLogger` is called after
 * the proxy is created (the typical app boot order, since modules
 * declare `const log = createLogger('foo')` at top level), the proxy
 * automatically picks up the explicit root on its next call. See I015
 * for the failure mode this defends against.
 *
 * @example
 * ```ts
 * const log = createLogger('brain.triage');
 * log.info({ directiveId }, 'classifying');
 * ```
 */
export function createLogger(component: string): PinoLogger {
  const overrideKey = `FACTORY5_LOG_LEVEL_${component.toUpperCase().replace(/\./g, '_')}`;

  let cachedChild: PinoLogger | undefined;
  let cachedRoot: PinoLogger | undefined;

  const resolve = (): PinoLogger => {
    const root = rootLogger ?? autoInitLogger();
    if (root !== cachedRoot) {
      cachedChild = root.child({ component });
      cachedRoot = root;
      const override = env[overrideKey];
      if (override !== undefined && override.length > 0) {
        cachedChild.level = override;
      }
    }
    return cachedChild!;
  };

  return new Proxy({} as PinoLogger, {
    get(_target, prop, _receiver) {
      const real = resolve() as unknown as Record<string | symbol, unknown>;
      const value = real[prop];
      if (typeof value === 'function') {
        return (value as (...args: unknown[]) => unknown).bind(real);
      }
      return value;
    },
    set(_target, prop, value) {
      const real = resolve() as unknown as Record<string | symbol, unknown>;
      real[prop] = value;
      return true;
    },
    has(_target, prop) {
      const real = resolve() as unknown as Record<string | symbol, unknown>;
      return prop in real;
    },
    ownKeys(_target) {
      return Reflect.ownKeys(resolve() as unknown as object);
    },
    getOwnPropertyDescriptor(_target, prop) {
      return Reflect.getOwnPropertyDescriptor(resolve() as unknown as object, prop);
    },
  });
}

/**
 * Reset module-level state. Test-only. Production code never calls this.
 * Lets test suites that toggle init flavours run cleanly without leaking
 * a previous suite's root into the next.
 */
export function __resetLoggerForTests(): void {
  rootLogger = undefined;
  initMode = 'unset';
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
