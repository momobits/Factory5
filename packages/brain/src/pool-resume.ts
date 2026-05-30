/**
 * Tier 15 / ADR 0034 — chokidar watcher for `<project>/.factory/project.json`.
 *
 * When the operator (or the auto-increase loop) raises a pool cap in
 * `project.json`, re-checks any directives parked with
 * `blocked_reason.kind === 'pool-exhausted'` on that project and flips them
 * back to `'running'` if the recomputed cap now has headroom.
 *
 * The serve loop's 250 ms poll tick will re-claim flipped directives — no
 * doorbell wiring is needed here (that is a Tier 15.7 concern).
 *
 * Lifecycle:
 *   - `registerProject(projectPath)` — lazy-add when the first directive
 *     creates on this project.
 *   - `unregisterProject(projectPath)` — tear down when no active directives
 *     remain on the project.
 *   - `shutdown()` — close all active watchers (called on brain graceful stop).
 *
 * @packageDocumentation
 */

import { join } from 'node:path';

import chokidar, { type FSWatcher } from 'chokidar';

import type { BudgetAxis } from '@factory5/core/budgets';
import { loadOrCreateProjectMetadata } from '@factory5/wiki';
import type { Database } from '@factory5/state';
import type { Logger } from '@factory5/logger';

import {
  computePoolUsage,
  projectBudgetsFromMetadata,
  type ProjectBudgetsLike,
} from './pool-usage.js';

/** Default debounce window — prevents a rapid-save sequence from firing N re-checks. */
const DEFAULT_DEBOUNCE_MS = 250;

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

/** Dependencies injected into `createPoolResume`. */
export interface PoolResumeDeps {
  /** Open better-sqlite3 database (all migrations applied). */
  db: Database;
  /** Logger instance (or test stub). */
  log: Logger;
  /**
   * Override the chokidar factory.
   * Test injection only — production path uses `chokidar.watch(...)`.
   */
  watcherFactory?: (path: string) => FSWatcher;
  /**
   * Debounce window in milliseconds.
   * Defaults to 250. Set to 0 in tests for synchronous-ish behaviour.
   */
  debounceMs?: number;
  /**
   * Optional callback fired immediately after each re-check sweep completes.
   * Used in tests to count how many times the re-check ran.
   */
  onRecheck?: () => void;
}

/** Public interface returned by `createPoolResume`. */
export interface PoolResume {
  /** Register a project path and start watching its `project.json`. Idempotent. */
  registerProject(projectPath: string): Promise<void>;
  /** Tear down the watcher for a project path. No-op if not registered. */
  unregisterProject(projectPath: string): Promise<void>;
  /** Return the list of currently registered project paths. */
  activeWatchers(): string[];
  /** Close all active watchers. Called during brain graceful shutdown. */
  shutdown(): Promise<void>;
  /**
   * Wait for all in-flight recheck promises to settle.
   * Intended for tests that need to await async re-checks triggered by fake watchers.
   */
  flush(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Internal state per registered project
// ---------------------------------------------------------------------------

interface WatcherEntry {
  /** The chokidar FSWatcher instance. */
  watcher: FSWatcher;
  /** Pending debounce timer handle. */
  timer: ReturnType<typeof setTimeout> | undefined;
  /**
   * Promise for the currently-running recheck. Stored so callers (tests) can
   * await it and so a second rapid-change doesn't start a new recheck before
   * the prior one finishes.
   */
  recheckPromise: Promise<void> | undefined;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a pool-resume watcher manager.
 *
 * Returns a {@link PoolResume} handle with `registerProject` /
 * `unregisterProject` / `activeWatchers` / `shutdown`.
 */
export function createPoolResume(deps: PoolResumeDeps): PoolResume {
  const { db, log: logger, watcherFactory, debounceMs = DEFAULT_DEBOUNCE_MS, onRecheck } = deps;

  /** Map from projectPath → WatcherEntry. */
  const registry = new Map<string, WatcherEntry>();

  // ---- registerProject ----

  async function registerProject(projectPath: string): Promise<void> {
    if (registry.has(projectPath)) return;

    const target = join(projectPath, '.factory', 'project.json');

    const watcher: FSWatcher =
      watcherFactory !== undefined
        ? watcherFactory(target)
        : chokidar.watch(target, {
            ignoreInitial: true,
            awaitWriteFinish: { stabilityThreshold: 100 },
          });

    const entry: WatcherEntry = { watcher, timer: undefined, recheckPromise: undefined };
    registry.set(projectPath, entry);

    watcher.on('change', () => {
      if (entry.timer !== undefined) clearTimeout(entry.timer);
      entry.timer = setTimeout(() => {
        entry.timer = undefined;
        entry.recheckPromise = recheckParkedDirectives(projectPath).then(() => {
          entry.recheckPromise = undefined;
        });
      }, debounceMs);
    });

    watcher.on('error', (err: unknown) => {
      logger.warn({ err, projectPath }, 'pool-resume: watcher error');
    });

    logger.info({ projectPath }, 'pool-resume: watcher registered');
  }

  // ---- unregisterProject ----

  async function unregisterProject(projectPath: string): Promise<void> {
    const entry = registry.get(projectPath);
    if (entry === undefined) return;

    if (entry.timer !== undefined) {
      clearTimeout(entry.timer);
      entry.timer = undefined;
    }

    await entry.watcher.close();
    registry.delete(projectPath);
    logger.info({ projectPath }, 'pool-resume: watcher torn down');
  }

  // ---- activeWatchers ----

  function activeWatchers(): string[] {
    return Array.from(registry.keys());
  }

  // ---- shutdown ----

  async function shutdown(): Promise<void> {
    for (const projectPath of Array.from(registry.keys())) {
      await unregisterProject(projectPath);
    }
  }

  // ---- recheckParkedDirectives ----

  /**
   * Core re-check: load the updated `project.json`, find all pool-exhausted
   * directives for that project, and flip those with headroom back to running.
   */
  async function recheckParkedDirectives(projectPath: string): Promise<void> {
    let projectId: string;
    let projectBudgets: ProjectBudgetsLike;

    try {
      // Re-read project.json to get the current budgetDefaults + the project ULID.
      const metadata = await loadOrCreateProjectMetadata(projectPath, '');
      projectId = metadata.id;
      projectBudgets = projectBudgetsFromMetadata(metadata);
    } catch (err) {
      logger.warn({ err, projectPath }, 'pool-resume: failed to load project.json');
      return;
    } finally {
      onRecheck?.();
    }

    // Find all pool-exhausted directives scoped to this project.
    const parkedRows = db
      .prepare(
        `SELECT id FROM directives
         WHERE status = 'blocked'
           AND blocked_reason IS NOT NULL
           AND json_extract(blocked_reason, '$.kind') = 'pool-exhausted'
           AND project_id = ?`,
      )
      .all(projectId) as Array<{ id: string }>;

    for (const row of parkedRows) {
      let usage;
      try {
        usage = computePoolUsage(db, row.id, projectBudgets);
      } catch (err) {
        logger.warn({ err, directiveId: row.id }, 'pool-resume: computePoolUsage failed');
        continue;
      }

      const parkedReason = usage.parkedReason;
      if (parkedReason === undefined) continue;

      const axis = parkedReason.axis as BudgetAxis;
      const axisUsage = usage.perAxis[axis];
      if (axisUsage === undefined) continue;

      if (axisUsage.used < axisUsage.cap) {
        // Headroom present — flip back to running. The serve loop's 250 ms
        // poll will re-claim this directive on its next pass.
        db.prepare(
          `UPDATE directives
             SET status = 'running', blocked_reason = NULL
           WHERE id = ? AND status = 'blocked'`,
        ).run(row.id);

        logger.info(
          { directiveId: row.id, axis, newCap: axisUsage.cap, used: axisUsage.used },
          'pool-resume: directive re-enqueued after cap raise',
        );
      }
    }
  }

  // ---- flush ----

  async function flush(): Promise<void> {
    const promises = Array.from(registry.values())
      .map((e) => e.recheckPromise)
      .filter((p): p is Promise<void> => p !== undefined);
    await Promise.all(promises);
  }

  return { registerProject, unregisterProject, activeWatchers, shutdown, flush };
}
