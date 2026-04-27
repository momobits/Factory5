---
id: I015
severity: MAJOR
area: '@factory5/logger'
status: RESOLVED
created: 2026-04-27
resolved: 2026-04-27
---

# File-sink logger silently disabled by transitive `createLogger` calls at module init

## Description

`<dataDir>/logs/factoryd-<YYYY-MM-DD>.log` does not materialise on disk
when factoryd runs, even though `apps/factoryd/src/main.ts:105` calls
`initLogger({ processName: 'factoryd' })` (which would build a file sink
under default `noFile: false`). Pretty-printed stdout is visible in the
foreground terminal, so multistream construction succeeds — only the
file destination is missing.

Discovered during 12.4 operator investigation. Operator searched
`~/.factory`, `~/.factory5`, `<repo>/.factory`, AppData — all empty.
`mkdirSync(logsDir, { recursive: true })` was assumed to be running
during `initLogger` because no exception bubbled up; the directory still
never appeared. Phase 13.1 — file as a major issue + regression test +
fix.

## Repro / evidence

Re-run on Windows 2026-04-27 from a clean tree:

```
$ rm -rf .factory/logs
$ npx tsx apps/factoryd/src/main.ts --foreground
{"level":"info","time":"…","pid":44104,"process":"unknown","component":"daemon.pidfile",…}
…
$ ls .factory/
config.toml  factory.db  factory.db-shm  factory.db-wal  factoryd.pid
# logs/ is NOT present
```

The smoking gun is `"process":"unknown"` in the JSON output. Production
code calls `initLogger({ processName: 'factoryd' })`, which would set
`process: "factoryd"` on every line. Seeing `"unknown"` means the root
logger was already initialised by the time `runForeground()` ran — the
explicit call returned the cached `rootLogger` and was a no-op.

## Hypothesis (CONFIRMED)

The root cause is interaction between Node's static-import semantics and
the `createLogger` auto-init fallback at
`packages/logger/src/logger.ts:118-123`:

```ts
export function createLogger(component: string): PinoLogger {
  if (rootLogger === undefined) {
    initLogger({ processName: env['FACTORY5_PROCESS_NAME'] ?? 'unknown', noFile: true });
  }
  …
}
```

The auto-init is meant for ad-hoc tests / standalone use. But every
package in the workspace (`@factory5/daemon`, `@factory5/state`,
`@factory5/brain`, `@factory5/wiki`, `@factory5/channels`, …) declares
`const log = createLogger('component.name')` **at module top level**.
50+ such call sites exist (`grep -rn '^const log = createLogger'
packages/`).

Sequence of events when `factoryd --foreground` boots:

1. Node statically imports `apps/factoryd/src/main.ts`.
2. That file's static imports cascade through `@factory5/daemon`,
   `@factory5/brain`, etc. Each module's body runs at import time.
3. The first transitive `const log = createLogger('daemon.pidfile')`
   (or similar) calls `createLogger`.
4. `rootLogger` is `undefined` → auto-init fires:
   `initLogger({ processName: 'unknown', noFile: true })`. **No file
   sink is built.**
5. All remaining transitive `createLogger` calls hit the now-defined
   `rootLogger` and bind to it. (Pino's `child()` snapshots the parent's
   streams via the prototype chain, so they inherit the no-file root.)
6. `main()` finally runs and `runForeground()` calls
   `initLogger({ processName: 'factoryd' })`.
7. `initLogger` sees `rootLogger !== undefined` and returns the
   auto-init root unchanged. **No-op. The explicit init is silently
   discarded.**

`mkdirSync(logsDir, …)` did NOT run during the auto-init (because
`opts.noFile === true`), and `runForeground`'s explicit call returned
before the `mkdirSync` line. Hence no `logs/` directory is ever created.

The bug is silent because:

- No exception is thrown.
- `pino.destination(...)` is never even constructed, so there's no
  SonicBoom 'error' event to propagate.
- Pretty-printed stdout works because the auto-init still built a
  console sink (`opts.noConsole` defaulted to `false`).

## Resolution

The fix lands in three coordinated changes inside
`packages/logger/src/logger.ts`:

1. **Track init mode** (`'unset' | 'auto' | 'explicit'`). When
   `initLogger` is called explicitly after the auto-init, **replace**
   the root logger instead of returning the auto-init root. Flush the
   auto-init root's pending writes first so any module-init log lines
   that reached `stdout` aren't lost.
2. **Make `createLogger` resolve lazily through a `Proxy`.** The
   wrapper resolves to a Pino child of _whatever the current root is_
   on each method call, caching the child but invalidating when the
   root identity changes. This means modules that grabbed `const log =
createLogger('foo')` at import time automatically pick up the
   explicit root once `runForeground` calls `initLogger`.
3. **Keep the auto-init fallback** for ad-hoc / test use, but only
   trigger it on the _first log call_ (not on `createLogger` itself).
   If the app calls `initLogger` explicitly before any log line is
   emitted, no auto-init fires at all.

Regression tests in `packages/logger/src/filesink-repro.test.ts`:

- `initLogger`, write a line, read the file off disk, assert content.
- Subprocess driver that mimics factoryd: invoke from a fresh
  `node`-spawned process, exit cleanly, verify the file landed.
- **The exact bug pattern**: `createLogger('foo')` at module top, THEN
  `initLogger({ processName: 'factoryd' })`, THEN
  `log.info(...)` — assert the file is written and `process: 'factoryd'`
  is on the line (i.e. the explicit init won, not the auto-init).
