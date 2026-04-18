/**
 * `ChannelPlugin` — uniform contract for any inbound/outbound message channel
 * (CLI, Discord, Telegram, web, ...).
 *
 * Each channel runs inside the daemon process. Inbound messages are
 * normalized into `Directive` rows in SQLite; outbound messages are pulled
 * from `outbound_messages` and sent via the channel's `send` method.
 */

import type { ChannelId, Directive, OutboundMessage } from '@factory5/core';
import type { Logger } from '@factory5/logger';
import type { ZodSchema } from 'zod';

export interface ChannelCapabilities {
  /** Channel can ingest messages (push directives in). */
  inbound: boolean;
  /** Channel can deliver messages (push replies out). */
  outbound: boolean;
  /** Channel supports threaded conversations / replies. */
  threading: boolean;
  /** Channel supports interactive turn-taking (`ask_user`). */
  interactive: boolean;
  /** Channel supports file attachments. */
  fileAttachments: boolean;
}

export interface ChannelContext {
  /** Per-channel log prefix. */
  log: Logger;
  /**
   * Called by the channel when an inbound message arrives. The channel is
   * responsible for normalizing platform messages into a `Directive`.
   */
  onInbound: (d: Directive) => void | Promise<void>;
}

export interface SendResult {
  delivered: boolean;
  externalId?: string;
  error?: string;
}

export interface ChannelPlugin {
  /** Unique id matching `ChannelId` enum in `@factory5/core`. */
  id: ChannelId;
  /** What this channel can and can't do. */
  capabilities: ChannelCapabilities;
  /** Zod schema for the channel's config block in the user's `config.toml`. */
  configSchema: ZodSchema;
  /** Bring the channel online. Idempotent. */
  start(ctx: ChannelContext, config: unknown): Promise<void>;
  /** Take the channel offline. Idempotent. */
  stop(): Promise<void>;
  /** Deliver an outbound message. */
  send(msg: OutboundMessage): Promise<SendResult>;
}
