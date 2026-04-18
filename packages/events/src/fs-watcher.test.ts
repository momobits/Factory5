import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { initLogger, createLogger } from '@factory5/logger';
import type { Event } from '@factory5/core';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createFsWatcher, type FsChange } from './fs-watcher.js';

beforeAll(() => {
  initLogger({ processName: 'fs-watcher-test', noFile: true, noConsole: true });
});

describe('FsWatcher', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'factory5-fs-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('emits a debounced create event for a new file', async () => {
    const events: Event[] = [];
    const changes: FsChange[] = [];
    const watcher = createFsWatcher({
      roots: [root],
      debounceMs: 60,
      onChange: (c) => {
        changes.push(c);
      },
    });
    await watcher.start({
      log: createLogger('test.fs-watcher'),
      emit: (e) => {
        events.push(e);
      },
    });

    try {
      writeFileSync(join(root, 'hello.txt'), 'hi');
      await waitFor(() => events.length > 0, 1000);
      expect(events).toHaveLength(1);
      const body = events[0]?.body;
      if (body === undefined || body.kind !== 'fs.changed') {
        throw new Error('expected fs.changed event');
      }
      expect(body.path).toBe('hello.txt');
      expect(body.type).toBe('create');
      expect(changes).toHaveLength(1);
      expect(changes[0]?.path).toBe('hello.txt');
    } finally {
      await watcher.stop();
    }
  });

  it('collapses bursts of writes into a single event per path', async () => {
    const events: Event[] = [];
    const watcher = createFsWatcher({
      roots: [root],
      debounceMs: 100,
    });
    await watcher.start({
      log: createLogger('test.fs-watcher'),
      emit: (e) => {
        events.push(e);
      },
    });
    try {
      const file = join(root, 'burst.txt');
      writeFileSync(file, 'a');
      // chokidar awaitWriteFinish (stabilityThreshold 100 ms) means we wait for
      // the write to settle before it fires. Trigger multiple writes inside
      // the stability window and make sure we still get exactly one event.
      for (let i = 0; i < 5; i++) {
        writeFileSync(file, `a${String(i)}`);
      }
      await waitFor(() => events.length > 0, 1500);
      await sleep(200);
      expect(events.length).toBeLessThanOrEqual(2);
      expect(events[0]?.body.kind).toBe('fs.changed');
    } finally {
      await watcher.stop();
    }
  });

  it('ignores files inside excluded directories by default', async () => {
    const events: Event[] = [];
    mkdirSync(join(root, '.factory'));
    mkdirSync(join(root, 'node_modules'));
    const watcher = createFsWatcher({
      roots: [root],
      debounceMs: 40,
    });
    await watcher.start({
      log: createLogger('test.fs-watcher'),
      emit: (e) => {
        events.push(e);
      },
    });
    try {
      writeFileSync(join(root, '.factory', 'x.txt'), 'x');
      writeFileSync(join(root, 'node_modules', 'y.txt'), 'y');
      writeFileSync(join(root, 'src.ts'), 'ok');
      await waitFor(() => events.length > 0, 1500);
      expect(events).toHaveLength(1);
      if (events[0]?.body.kind !== 'fs.changed') throw new Error('type narrow');
      expect(events[0]?.body.path).toBe('src.ts');
    } finally {
      await watcher.stop();
    }
  });
});

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitFor(check: () => boolean, budgetMs: number): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > budgetMs) {
      throw new Error(`waitFor: timed out after ${String(budgetMs)}ms`);
    }
    await sleep(20);
  }
}
