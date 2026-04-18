# @factory5/logger

Pino-based structured logger. **Required** for all factory5 logging — `console.log` is lint-banned everywhere except this package.

## Usage

```ts
import { createLogger } from '@factory5/logger';

const log = createLogger('brain.triage');

log.info({ directiveId: 'd-123' }, 'classifying directive');
log.warn({ provider: 'claude-cli', error: err }, 'provider unavailable, falling back');
log.error({ err }, 'unrecoverable failure');

// Child loggers carry context to every log line:
const taskLog = log.child({ taskId: 't-456', directiveId: 'd-123' });
taskLog.info('task started');
// → all subsequent lines include taskId and directiveId
```

## Topology

- **Root logger** is initialized once per process via `initLogger()` (called by app entry points)
- **Component loggers** via `createLogger(name)` return children of root with a stable `component` field
- **Correlation IDs** (`directiveId`, `taskId`, `sessionId`) are passed via `logger.child({ ... })`

## Sinks

| Sink | When | Format |
|---|---|---|
| Console | always | pretty-printed colorized when stdout is a TTY; JSON otherwise (CI-friendly) |
| File | always | JSON to `<logsDir>/<process>-<date>.log`, daily rotation, 14-day retention |
| Per-build file | when `withBuildSink({ projectPath, buildId })` is called | JSON mirror of brain logs into `<projectPath>/.factory/logs/build-<buildId>.log` |

`<logsDir>` is platform-aware:
- Linux/Mac: `~/.factory5/logs/`
- Windows: `%LOCALAPPDATA%\factory5\logs\`

Override with env `FACTORY5_LOG_DIR`.

## Levels

`trace | debug | info | warn | error | fatal`

Default minimum level is `info`. Override per process with `FACTORY5_LOG_LEVEL`. Override per component with `FACTORY5_LOG_LEVEL_<COMPONENT>` (e.g., `FACTORY5_LOG_LEVEL_BRAIN_TRIAGE=debug`).

## Conventions

- **Component names** use dotted hierarchy: `brain.triage`, `daemon.discord`, `worker.builder`
- **Always log structured data first**, then message: `log.info({ taskId, durationMs }, 'task complete')`
- **Errors** go in the `err` field: `log.error({ err }, 'failed')` — Pino's serializers expand stack traces
- **Never log secrets.** API keys, tokens, OAuth credentials must never appear in log fields. Use redaction if a field might contain them.

## Operator interface

(Implemented by `apps/factory` CLI; this package provides the substrate.)

```bash
factory logs                              # tail recent logs across all components
factory logs --component brain --follow   # live tail brain logs
factory logs --directive 01HQXM... --level warn+
factory inspect 01HQXM...                 # all logs for a directive across processes
```
