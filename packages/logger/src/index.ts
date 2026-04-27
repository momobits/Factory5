/**
 * @factory5/logger — structured logging for all factory5 components.
 *
 * Use {@link createLogger} everywhere; never use `console.log`. The lint rule
 * `no-console` is set to `error` everywhere except this package.
 *
 * @packageDocumentation
 */

export {
  createLogger,
  initLogger,
  getRootLogger,
  withBuildSink,
  __resetLoggerForTests,
} from './logger.js';
export type { Logger, LoggerOptions, BuildSinkHandle } from './logger.js';
export { logsDir, dataDir } from './paths.js';
