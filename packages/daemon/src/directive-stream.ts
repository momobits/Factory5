/**
 * In-memory per-directive event hub for the SSE stream
 * (`GET /api/v1/directives/:id/stream`, Phase 3 / Step 3.1).
 *
 * Producer side: the brain emits structured events at every state
 * transition (task lifecycle, spend updates, directive completion).
 * Consumer side: the SSE handler subscribes to a specific directive's
 * events and pumps them into the response stream.
 *
 * The hub lives in factoryd's process. The brain reaches it via an
 * `emitDirectiveEvent` callback in `BrainOptions` — daemon's
 * brain-supervisor wires the callback to {@link DirectiveStreamHub.emit}
 * so brain has no compile-time dependency on `@factory5/daemon`.
 *
 * Wire shape: `UPGRADE/specs/sse-directive-stream.md`.
 */

import type { DirectiveStreamEvent } from '@factory5/ipc';
import { createLogger } from '@factory5/logger';
import { directiveLogLines, type Database } from '@factory5/state';

const log = createLogger('daemon.directive-stream');

/**
 * Listener signature. Synchronous — the hub dispatches without awaiting
 * each subscriber so a slow consumer cannot backpressure the producer.
 * The SSE handler's listener is itself synchronous (a `reply.raw.write`
 * call), so this constraint is naturally satisfied.
 */
export type DirectiveEventListener = (event: DirectiveStreamEvent) => void;

/**
 * Per-directive event hub. One instance per running daemon.
 *
 *   - {@link emit} — push an event; every listener for that directive
 *     fires synchronously.
 *   - {@link subscribe} — add a listener; returns an unsubscribe fn.
 *   - {@link closeDirective} — drop every listener for a directive
 *     (called by the SSE handler after forwarding `directive.completed`,
 *     and by the brain supervisor when a directive reaches terminal
 *     state with no live consumer).
 *   - {@link shutdown} — drop every listener for every directive
 *     (called from `IpcServerHandle.stop()` so daemon close paths don't
 *     leak references through long-lived emitters).
 *   - {@link listenerCount} — diagnostic accessor for tests; not part
 *     of the production wiring.
 */
export class DirectiveStreamHub {
  private readonly listeners = new Map<string, Set<DirectiveEventListener>>();
  private readonly db: Database;

  /**
   * @param db Database handle. The hub tees `log.line` events to
   *   `directive_log_lines` (Tier 11 / migration 010) before fan-out
   *   so historic events survive page reload, multi-tab joins, and
   *   post-mortem visits to terminal directives. Other event types
   *   bypass persistence (`task.*`, `finding.*`, `spend.updated`,
   *   `directive.completed` already have authoritative DB rows
   *   elsewhere; this hub is only the persistence path for `log.line`).
   */
  constructor(db: Database) {
    this.db = db;
  }

  /**
   * Subscribe a listener to events for a single directive. Returns an
   * unsubscribe function the caller MUST invoke on disconnect — the SSE
   * handler does this from `request.raw.on('close', ...)`.
   *
   * Multiple listeners per directive are supported (a second dashboard
   * tab, a `curl -N` from the operator's terminal, etc.). Each
   * subscriber receives every event in arrival order.
   */
  subscribe(directiveId: string, listener: DirectiveEventListener): () => void {
    let set = this.listeners.get(directiveId);
    if (set === undefined) {
      set = new Set();
      this.listeners.set(directiveId, set);
    }
    set.add(listener);

    log.debug({ directiveId, listenerCount: set.size }, 'directive-stream: subscribed');

    return () => {
      const current = this.listeners.get(directiveId);
      if (current === undefined) return;
      current.delete(listener);
      if (current.size === 0) {
        this.listeners.delete(directiveId);
      }
      log.debug({ directiveId, listenerCount: current.size }, 'directive-stream: unsubscribed');
    };
  }

  /**
   * Push an event into the hub. Listeners for that event's directive
   * fire synchronously in subscription order. A throwing listener is
   * caught and logged so one broken consumer can't take down the
   * producer; remaining listeners still receive the event.
   *
   * Dispatching to a directive with no current listeners is a no-op
   * (silently drops the event). This is intentional — brain emission
   * sites don't gate on consumer presence; the SSE handler's backfill
   * on connect covers the "subscribed late" case for the events it
   * cares about.
   */
  emit(event: DirectiveStreamEvent): void {
    if (event.type === 'log.line') {
      // Tee log.line to disk BEFORE fan-out so a late subscriber's
      // replay+SSE join sees the same boundary as live listeners
      // currently in the loop. Persistence failure is non-fatal —
      // the SSE contract (ADR 0029) is fire-and-forget; one failing
      // INSERT should never block event delivery to live consumers.
      try {
        directiveLogLines.appendLogLine(this.db, {
          directiveId: event.directiveId,
          ts: event.ts,
          level: event.level,
          component: event.component,
          msg: event.msg,
          ...(event.attrs !== undefined ? { attrs: event.attrs } : {}),
        });
      } catch (err) {
        log.warn(
          { err, directiveId: event.directiveId },
          'directive-stream: log.line persistence failed (non-fatal)',
        );
      }
    }

    const set = this.listeners.get(event.directiveId);
    if (set === undefined) return;
    for (const listener of set) {
      try {
        listener(event);
      } catch (err) {
        log.warn(
          { err, directiveId: event.directiveId, type: event.type },
          'directive-stream: listener threw',
        );
      }
    }
  }

  /**
   * Drop every listener for a directive. Called by the SSE handler
   * after forwarding `directive.completed` to its client (each per-
   * request handler unsubscribes its own listener via the closure
   * returned from {@link subscribe} — this method covers the case
   * where the brain marks a directive terminal with no live consumer,
   * in which case the residual entry would otherwise linger in the
   * map until daemon shutdown).
   */
  closeDirective(directiveId: string): void {
    const removed = this.listeners.delete(directiveId);
    if (removed) {
      log.debug({ directiveId }, 'directive-stream: directive closed');
    }
  }

  /**
   * Drop every listener for every directive. Called from the daemon's
   * shutdown path so open EventEmitter references don't keep the
   * Fastify close from settling. Idempotent — calling on an already-
   * empty hub is a no-op.
   */
  shutdown(): void {
    if (this.listeners.size === 0) return;
    log.info(
      { directives: this.listeners.size },
      'directive-stream: shutdown — dropping listeners',
    );
    this.listeners.clear();
  }

  /**
   * Diagnostic — count of listeners for a directive. Used by tests to
   * confirm cleanup-on-disconnect actually unsubscribed. Returns 0 for
   * unknown directiveIds.
   */
  listenerCount(directiveId: string): number {
    return this.listeners.get(directiveId)?.size ?? 0;
  }

  /**
   * Diagnostic — count of distinct directives with at least one
   * listener. Used by tests to confirm shutdown / close behaviour.
   */
  directiveCount(): number {
    return this.listeners.size;
  }
}
