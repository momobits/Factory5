/**
 * Filesystem watcher event source.
 *
 * For each registered project's `workspacePath`, a chokidar watcher emits
 * `fs.changed` events. Bursts of changes (think `npm install`, batch-save)
 * are debounced per-path so downstream consumers don't get flooded. Common
 * churn directories are ignored by default (`.factory/`, `node_modules/`,
 * `.git/`, `dist/`, `.next/`, `build/`).
 *
 * The watcher writes each event to `events_audit` via the supplied `emit`
 * callback; the daemon can also turn them into signals on open build
 * directives if it wants to (wired by the daemon, not by this source).
 */

import { relative, resolve } from 'node:path';

import { newId } from '@factory5/core';
import type { Logger } from '@factory5/logger';
import chokidar, { type FSWatcher } from 'chokidar';

import type { EventSource, EventSourceContext } from './types.js';

/** Directory / suffix fragments excluded from watching. Matched against any
 * path segment (cross-platform) — chokidar@4's glob-based ignored path on
 * Windows does not always match POSIX-style `**` patterns reliably. */
export const DEFAULT_IGNORE_SEGMENTS: readonly string[] = [
  '.factory',
  'node_modules',
  '.git',
  'dist',
  '.next',
  'build',
];
export const DEFAULT_IGNORE_SUFFIXES: readonly string[] = ['.log'];

/** Build the ignore predicate used by chokidar. */
function defaultIgnorePredicate(
  segments: readonly string[],
  suffixes: readonly string[],
): (path: string) => boolean {
  const segSet = new Set(segments);
  return (path: string): boolean => {
    const parts = path.split(/[\\/]/);
    for (const p of parts) {
      if (segSet.has(p)) return true;
    }
    for (const s of suffixes) {
      if (path.endsWith(s)) return true;
    }
    return false;
  };
}

/** Callback the daemon registers to supply the current project roots. */
export type ProjectRootsProvider = () => readonly string[];

export interface FsWatcherOptions {
  /** Roots to watch — absolute paths. */
  roots: readonly string[] | ProjectRootsProvider;
  /** Debounce window per path in ms. Default 500. */
  debounceMs?: number;
  /**
   * Extra path segments to ignore on top of {@link DEFAULT_IGNORE_SEGMENTS}.
   * Matched against any path part (cross-platform safe).
   */
  extraIgnoreSegments?: readonly string[];
  /**
   * Extra suffixes (e.g. `'.tmp'`) to ignore on top of
   * {@link DEFAULT_IGNORE_SUFFIXES}.
   */
  extraIgnoreSuffixes?: readonly string[];
  /**
   * Optional callback fired for each emitted event. Exposed for the daemon
   * so it can post the change as a signal against the project's open
   * directive. Receives the same event the source emits to the audit log.
   */
  onChange?: (evt: FsChange) => void | Promise<void>;
}

export interface FsChange {
  path: string;
  type: 'create' | 'modify' | 'delete';
  root: string;
}

type ChangeKind = 'create' | 'modify' | 'delete';

interface PendingChange {
  kind: ChangeKind;
  root: string;
  timer: NodeJS.Timeout;
}

export class FsWatcher implements EventSource {
  readonly name = 'fs-watcher';
  private watcher: FSWatcher | undefined;
  private log: Logger | undefined;
  private readonly pending = new Map<string, PendingChange>();
  private readonly debounceMs: number;
  private readonly rootsProvider: () => readonly string[];
  private readonly ignorePredicate: (path: string) => boolean;
  private readonly onChange: FsWatcherOptions['onChange'];
  private emit: EventSourceContext['emit'] | undefined;

  constructor(opts: FsWatcherOptions) {
    this.debounceMs = opts.debounceMs ?? 500;
    this.rootsProvider =
      typeof opts.roots === 'function' ? opts.roots : () => opts.roots as readonly string[];
    const segments = [...DEFAULT_IGNORE_SEGMENTS, ...(opts.extraIgnoreSegments ?? [])];
    const suffixes = [...DEFAULT_IGNORE_SUFFIXES, ...(opts.extraIgnoreSuffixes ?? [])];
    this.ignorePredicate = defaultIgnorePredicate(segments, suffixes);
    this.onChange = opts.onChange;
  }

  async start(ctx: EventSourceContext): Promise<void> {
    this.log = ctx.log;
    this.emit = ctx.emit;
    const roots = [...new Set(this.rootsProvider().map((r) => resolve(r)))];
    if (roots.length === 0) {
      this.log.info('fs-watcher: no project roots — watcher is idle');
      return;
    }
    this.log.info({ roots }, 'fs-watcher: starting');
    this.watcher = chokidar.watch(roots, {
      ignored: this.ignorePredicate,
      ignoreInitial: true,
      persistent: true,
      awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 },
    });
    this.watcher.on('add', (p) => this.schedule(p, 'create'));
    this.watcher.on('change', (p) => this.schedule(p, 'modify'));
    this.watcher.on('unlink', (p) => this.schedule(p, 'delete'));
    this.watcher.on('error', (err: unknown) => {
      this.log?.warn({ err }, 'fs-watcher: error');
    });
    // chokidar ready event — useful signal for tests.
    await new Promise<void>((resolveReady) => {
      this.watcher?.once('ready', () => resolveReady());
    });
    this.log.info('fs-watcher: ready');
  }

  async stop(): Promise<void> {
    for (const { timer } of this.pending.values()) clearTimeout(timer);
    this.pending.clear();
    if (this.watcher !== undefined) {
      await this.watcher.close();
      this.watcher = undefined;
    }
    this.log?.info('fs-watcher: stopped');
  }

  private schedule(path: string, kind: ChangeKind): void {
    const root = this.matchRoot(path);
    if (root === undefined) return;
    const existing = this.pending.get(path);
    if (existing !== undefined) clearTimeout(existing.timer);
    const timer = setTimeout(() => {
      this.pending.delete(path);
      this.fire(path, kind, root);
    }, this.debounceMs);
    // Keep Node alive while we're watching; unref-ing would make the process
    // exit when nothing else is pending.
    this.pending.set(path, { kind, root, timer });
  }

  private fire(path: string, kind: ChangeKind, root: string): void {
    const relPath = relative(root, path).split(/[\\/]/).join('/');
    const evt: FsChange = { path: relPath, type: kind, root };
    this.log?.debug({ evt }, 'fs-watcher: fire');
    if (this.emit !== undefined) {
      const event = {
        id: newId(),
        source: 'fs-watcher',
        body: {
          kind: 'fs.changed' as const,
          path: relPath,
          type: kind,
        },
        metadata: { root },
        receivedAt: new Date().toISOString(),
      };
      void Promise.resolve(this.emit(event)).catch((err: unknown) => {
        this.log?.warn({ err }, 'fs-watcher: emit rejected');
      });
    }
    if (this.onChange !== undefined) {
      void Promise.resolve(this.onChange(evt)).catch((err: unknown) => {
        this.log?.warn({ err }, 'fs-watcher: onChange rejected');
      });
    }
  }

  private matchRoot(path: string): string | undefined {
    const abs = resolve(path);
    const roots = this.rootsProvider();
    for (const r of roots) {
      const absRoot = resolve(r);
      if (abs === absRoot || abs.startsWith(absRoot + '\\') || abs.startsWith(absRoot + '/')) {
        return absRoot;
      }
    }
    return undefined;
  }
}

/** Factory: returns a fresh FsWatcher. */
export function createFsWatcher(opts: FsWatcherOptions): FsWatcher {
  return new FsWatcher(opts);
}
