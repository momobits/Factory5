/**
 * In-process doorbell — a typed EventEmitter used by the daemon's IPC
 * server to wake the brain's claim loop and by channels to announce
 * inbound directives / messages.
 *
 * All daemon subsystems live in the same process for Phase 3, so an
 * `EventEmitter` is sufficient. The SQLite bus remains the durable truth;
 * the doorbell just shortcuts latency from "poll interval" to "immediate".
 */

import { EventEmitter } from 'node:events';

export interface DoorbellEvents {
  /**
   * A directive has been inserted or updated and may need attention.
   * Reason mirrors {@link DirectiveNotifyRequest['reason']}.
   */
  'directive.new': (payload: {
    directiveId: string;
    reason: 'new' | 'priority' | 'cancelled';
  }) => void;
  /** Outbound queue has a fresh row. */
  'outbound.new': (payload: { messageId: string }) => void;
  /** Configuration was reloaded; subsystems should refresh caches. */
  'config.reloaded': () => void;
}

/**
 * Thin strongly-typed wrapper over `EventEmitter`. Gives subsystems a small,
 * documented surface rather than the raw emitter sprawl.
 */
export class Doorbell {
  private readonly emitter = new EventEmitter();

  on<E extends keyof DoorbellEvents>(event: E, listener: DoorbellEvents[E]): void {
    this.emitter.on(event, listener as (...args: unknown[]) => void);
  }

  off<E extends keyof DoorbellEvents>(event: E, listener: DoorbellEvents[E]): void {
    this.emitter.off(event, listener as (...args: unknown[]) => void);
  }

  emit<E extends keyof DoorbellEvents>(event: E, ...args: Parameters<DoorbellEvents[E]>): void {
    this.emitter.emit(event, ...args);
  }

  /** Remove every listener. Call during shutdown so subsystems unwire cleanly. */
  clear(): void {
    this.emitter.removeAllListeners();
  }
}
