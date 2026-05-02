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

| Sink           | When                                                     | Format                                                                           |
| -------------- | -------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Console        | always                                                   | pretty-printed colorized when stdout is a TTY; JSON otherwise (CI-friendly)      |
| File           | always                                                   | JSON to `<logsDir>/<process>-<date>.log`, daily rotation, 14-day retention       |
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

This package writes logs; the `factory` CLI surfaces them. Today `factory logs` is a stub — it prints a hint pointing at `~/.factory5/logs/` (or `%LOCALAPPDATA%\factory5\logs\` on Windows) and exits. Tail those files directly:

```bash
# Linux / Mac
tail -f ~/.factory5/logs/factoryd-*.log
tail -f ~/.factory5/logs/factory-*.log

# Windows (PowerShell)
Get-Content -Wait $env:LOCALAPPDATA\factory5\logs\factoryd-*.log
```

Each log line is one JSON object with stable component / correlation-id fields, so `jq` works for filtering:

```bash
jq 'select(.component == "brain.triage")' ~/.factory5/logs/factoryd-*.log
jq 'select(.directiveId == "01HQXM...")' ~/.factory5/logs/factoryd-*.log
```

The richer `factory logs --component / --directive / --follow` and a directive-scoped log-stitcher are tracked as planned UX in the upgrade roadmap.
