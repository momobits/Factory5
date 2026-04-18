/**
 * `EventSource` — uniform contract for any source that observes the outside
 * world (GitHub, git, filesystem, webhooks, tmux, ...).
 *
 * Each source emits typed `Event` objects via the supplied `emit` callback.
 * The daemon writes them to `events_audit` and (when appropriate) materializes
 * them as directives.
 */

import type { Event } from '@factory5/core';
import type { Logger } from '@factory5/logger';

export interface EventSourceContext {
  log: Logger;
  /** Called by the source when a new event is observed. Idempotent at the source's level. */
  emit: (e: Event) => void | Promise<void>;
}

export interface EventSource {
  /** Stable name like "github-poll", "git-poll". */
  name: string;
  /** Bring the source online. Idempotent. Config is source-specific. */
  start(ctx: EventSourceContext, config?: unknown): Promise<void>;
  /** Take the source offline. Idempotent. */
  stop(): Promise<void>;
}
