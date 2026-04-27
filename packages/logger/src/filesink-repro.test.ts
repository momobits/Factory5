/**
 * Regression coverage for I015 — file sink silently disabled by transitive
 * `createLogger` calls at module init.
 *
 * Pre-fix: any module that did `const log = createLogger('foo')` at top
 * level triggered `initLogger({ noFile: true })` as a fallback. By the
 * time the app's main called `initLogger({ processName: 'factoryd' })`,
 * the auto-init root was cached and the explicit call was a no-op.
 * Result: file sink never built, no `<dataDir>/logs/factoryd-*.log`,
 * and every JSON line tagged `"process":"unknown"` instead of
 * `"process":"factoryd"`.
 *
 * Post-fix: `createLogger` returns a Proxy that defers child binding
 * until first log call; `initLogger` replaces an auto-init root.
 *
 * Each test isolates module state via `__resetLoggerForTests` so the
 * suite can run repeatedly without leaking a previous test's root.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as LoggerModule from './logger.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const LOGGER_DIST_INDEX = resolve(HERE, '..', 'dist', 'index.js');

async function freshLoggerModule(): Promise<typeof LoggerModule> {
  vi.resetModules();
  return (await import('./logger.js')) as typeof LoggerModule;
}

async function waitForFile(
  dir: string,
  predicate: (files: string[]) => boolean,
  budgetMs = 3000,
): Promise<string[]> {
  const start = Date.now();
  while (Date.now() - start < budgetMs) {
    if (existsSync(dir)) {
      const files = readdirSync(dir);
      if (predicate(files)) return files;
    }
    await delay(50);
  }
  return existsSync(dir) ? readdirSync(dir) : [];
}

describe('I015 — file sink materializes on disk', () => {
  let tmpRoot: string;
  let prevLogDir: string | undefined;
  let prevLevel: string | undefined;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'f5-logger-repro-'));
    prevLogDir = process.env['FACTORY5_LOG_DIR'];
    prevLevel = process.env['FACTORY5_LOG_LEVEL'];
    process.env['FACTORY5_LOG_DIR'] = tmpRoot;
  });

  afterEach(() => {
    if (prevLogDir === undefined) delete process.env['FACTORY5_LOG_DIR'];
    else process.env['FACTORY5_LOG_DIR'] = prevLogDir;
    if (prevLevel === undefined) delete process.env['FACTORY5_LOG_LEVEL'];
    else process.env['FACTORY5_LOG_LEVEL'] = prevLevel;
  });

  it('writes a JSON line into <tmp>/factoryd-YYYY-MM-DD.log', async () => {
    const { initLogger, createLogger } = await freshLoggerModule();
    initLogger({ processName: 'factoryd', noConsole: true });
    const log = createLogger('repro');
    log.info({ marker: 'sentinel-1' }, 'hello');

    const files = await waitForFile(tmpRoot, (fs) =>
      fs.some(
        (f) => f.startsWith('factoryd-') && readFileSync(join(tmpRoot, f), 'utf8').length > 0,
      ),
    );
    expect(files.length).toBeGreaterThan(0);
    const path = join(tmpRoot, files[0]!);
    const contents = readFileSync(path, 'utf8');
    expect(contents).toContain('sentinel-1');
    expect(contents).toContain('"component":"repro"');
    expect(contents).toContain('"process":"factoryd"');
  });

  it('writes when only the file sink is enabled (no console at all)', async () => {
    const { initLogger, createLogger } = await freshLoggerModule();
    initLogger({ processName: 'factoryd', noConsole: true });
    const log = createLogger('repro');
    log.info({ marker: 'sentinel-2' }, 'second');

    const files = await waitForFile(tmpRoot, (fs) => fs.length > 0);
    expect(files.length).toBeGreaterThan(0);
  });

  it('writes when both pretty (TTY) console and file sink are enabled', async () => {
    const stdoutAny = process.stdout as { isTTY?: boolean };
    const prevTTY = stdoutAny.isTTY;
    stdoutAny.isTTY = true;
    try {
      const { initLogger, createLogger } = await freshLoggerModule();
      initLogger({ processName: 'factoryd' });
      const log = createLogger('repro');
      log.info({ marker: 'sentinel-3' }, 'third');

      const files = await waitForFile(tmpRoot, (fs) =>
        fs.some(
          (f) => f.startsWith('factoryd-') && readFileSync(join(tmpRoot, f), 'utf8').length > 0,
        ),
      );
      expect(files.length).toBeGreaterThan(0);
      const path = join(tmpRoot, files[0]!);
      expect(readFileSync(path, 'utf8')).toContain('sentinel-3');
    } finally {
      if (prevTTY === undefined) delete stdoutAny.isTTY;
      else stdoutAny.isTTY = prevTTY;
    }
  });
});

describe('I015 — exact regression: createLogger at module top, then initLogger, then log', () => {
  let tmpRoot: string;
  let prevLogDir: string | undefined;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'f5-logger-i015-'));
    prevLogDir = process.env['FACTORY5_LOG_DIR'];
    process.env['FACTORY5_LOG_DIR'] = tmpRoot;
  });

  afterEach(() => {
    if (prevLogDir === undefined) delete process.env['FACTORY5_LOG_DIR'];
    else process.env['FACTORY5_LOG_DIR'] = prevLogDir;
  });

  it('explicit initLogger after a module-init createLogger replaces the auto-init root', async () => {
    const { createLogger, initLogger } = await freshLoggerModule();
    // Mimic what happens when a transitive package declares a top-level
    // logger BEFORE the app's main() runs initLogger. Pre-fix: this call
    // triggered an auto-init with noFile:true; the later explicit init
    // was a no-op; logs were tagged "process":"unknown" and the file
    // sink was never built.
    const moduleInitLog = createLogger('module.init');
    // App boot — explicit init.
    initLogger({ processName: 'factoryd', noConsole: true });
    // Subsequent log calls must hit the explicit-init root.
    moduleInitLog.info({ marker: 'after-init' }, 'pretend production line');

    const files = await waitForFile(tmpRoot, (fs) =>
      fs.some(
        (f) => f.startsWith('factoryd-') && readFileSync(join(tmpRoot, f), 'utf8').length > 0,
      ),
    );
    if (files.length === 0) {
      throw new Error(`I015 regression: no factoryd-*.log in ${tmpRoot} (auto-init won the race)`);
    }
    const contents = readFileSync(join(tmpRoot, files[0]!), 'utf8');
    expect(contents).toContain('after-init');
    // The smoking gun: explicit init must win, so process tag is the
    // explicit one, not the auto-init's "unknown".
    expect(contents).toContain('"process":"factoryd"');
    expect(contents).not.toContain('"process":"unknown"');
  });

  it('a log line emitted before initLogger triggers auto-init; later initLogger still wins', async () => {
    const { createLogger, initLogger } = await freshLoggerModule();
    const log = createLogger('eager');
    // First log fires auto-init. File sink off; line goes to stdout.
    log.info({ marker: 'pre-init' }, 'before app boot');
    // App boots.
    initLogger({ processName: 'factoryd', noConsole: true });
    log.info({ marker: 'post-init' }, 'after app boot');

    const files = await waitForFile(tmpRoot, (fs) =>
      fs.some(
        (f) => f.startsWith('factoryd-') && readFileSync(join(tmpRoot, f), 'utf8').length > 0,
      ),
    );
    expect(files.length).toBeGreaterThan(0);
    const contents = readFileSync(join(tmpRoot, files[0]!), 'utf8');
    // The pre-init line went to the auto-init's console-only root and
    // is NOT in the file. The post-init line lands in the file.
    expect(contents).toContain('post-init');
    expect(contents).not.toContain('pre-init');
    expect(contents).toContain('"process":"factoryd"');
  });

  it('createLogger child loggers retain the component binding through a root replacement', async () => {
    const { createLogger, initLogger } = await freshLoggerModule();
    const log = createLogger('reused');
    initLogger({ processName: 'factoryd', noConsole: true });
    expect(log.bindings()['component']).toBe('reused');
    log.info({ id: 1 }, 'one');

    const files = await waitForFile(tmpRoot, (fs) =>
      fs.some(
        (f) => f.startsWith('factoryd-') && readFileSync(join(tmpRoot, f), 'utf8').length > 0,
      ),
    );
    expect(files.length).toBeGreaterThan(0);
    const contents = readFileSync(join(tmpRoot, files[0]!), 'utf8');
    expect(contents).toContain('"component":"reused"');
  });
});

describe('I015 — subprocess: factoryd-style end-to-end', () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'f5-logger-subproc-'));
  });

  it('mimics the daemon import-then-init order against the dist build', () => {
    // The smoking gun is detectable end-to-end: a fresh subprocess that
    // (a) creates a logger at "module top" via the `dist` bundle, then
    // (b) calls initLogger as the "app main" would, then (c) logs a line.
    // Pre-fix this would write nothing to disk. Post-fix the file is
    // there with `"process":"factoryd"`.
    const scriptPath = join(tmpRoot, 'driver.mjs');
    const distURL = pathToFileURL(LOGGER_DIST_INDEX).href;
    const script = [
      `process.env.FACTORY5_LOG_DIR = ${JSON.stringify(tmpRoot)};`,
      `import { initLogger, createLogger } from ${JSON.stringify(distURL)};`,
      // Module-top createLogger — the I015 ambush.
      `const moduleInitLog = createLogger('module.top');`,
      // App-main explicit init.
      `initLogger({ processName: 'factoryd', noConsole: true });`,
      `moduleInitLog.info({ marker: 'subproc-i015' }, 'production-shape line');`,
      `setTimeout(() => process.exit(0), 200);`,
    ].join('\n');
    writeFileSync(scriptPath, script);

    const r = spawnSync(process.execPath, [scriptPath], {
      stdio: 'pipe',
      encoding: 'utf8',
      timeout: 10_000,
    });
    expect(r.status, `subprocess failed: ${r.stderr}`).toBe(0);

    const files = readdirSync(tmpRoot).filter((f) => f.startsWith('factoryd-'));
    if (files.length === 0) {
      throw new Error(
        `I015 regression: no factoryd-*.log in ${tmpRoot}. dir contents: ${readdirSync(tmpRoot).join(', ')}. stderr: ${r.stderr}`,
      );
    }
    const contents = readFileSync(join(tmpRoot, files[0]!), 'utf8');
    expect(contents).toContain('subproc-i015');
    expect(contents).toContain('"process":"factoryd"');
    expect(contents).not.toContain('"process":"unknown"');
  });
});
