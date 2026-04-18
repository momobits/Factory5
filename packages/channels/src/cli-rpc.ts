/**
 * CLI-RPC channel — the daemon-side adapter for the `factory` CLI.
 *
 * The `factory` CLI writes directives directly into the SQLite bus and then
 * rings `POST /directives/notify`. On the outbound side, the brain queues
 * messages with `targetChannel = 'cli'`; this plugin's `send()` checks for
 * a *connected session* (a `factory chat` REPL that registered a callback
 * via {@link CliRpcChannel.registerSession}). If present, the listener is
 * invoked live and the plugin reports `delivered: true`. Otherwise `send`
 * returns `delivered: false` so the row stays in the outbound queue for
 * a disconnected CLI to poll and read later.
 *
 * Phase 3 scope: in-process delivery only. An SSE/SSW transport can layer
 * over this plugin later without changing the contract.
 */

import type { OutboundMessage } from '@factory5/core';
import type { Logger } from '@factory5/logger';
import { z } from 'zod';

import type { ChannelContext, ChannelPlugin, SendResult } from './types.js';

/** Callback the CLI-side session registers to receive messages live. */
export type SessionListener = (msg: OutboundMessage) => void | Promise<void>;

/** Zod schema for the channel config — currently empty; room to grow. */
export const cliRpcConfigSchema = z.object({}).default({});

export class CliRpcChannel implements ChannelPlugin {
  readonly id = 'cli' as const;
  readonly capabilities = {
    inbound: true,
    outbound: true,
    threading: false,
    interactive: true,
    fileAttachments: false,
  };
  readonly configSchema = cliRpcConfigSchema;

  private log: Logger | undefined;
  private readonly sessions = new Map<string, SessionListener>();
  private started = false;

  async start(ctx: ChannelContext): Promise<void> {
    this.log = ctx.log;
    this.started = true;
    this.log.info('cli-rpc: started');
    return Promise.resolve();
  }

  async stop(): Promise<void> {
    this.sessions.clear();
    this.started = false;
    this.log?.info('cli-rpc: stopped');
    return Promise.resolve();
  }

  async send(msg: OutboundMessage): Promise<SendResult> {
    if (!this.started) {
      return { delivered: false, error: 'cli-rpc not started' };
    }
    const listener = this.sessions.get(msg.targetRef);
    if (listener === undefined) {
      this.log?.debug(
        { messageId: msg.id, targetRef: msg.targetRef },
        'cli-rpc: no live session — leaving row in outbound queue for CLI to poll',
      );
      return { delivered: false, error: 'no live session' };
    }
    try {
      await listener(msg);
      this.log?.debug({ messageId: msg.id, targetRef: msg.targetRef }, 'cli-rpc: delivered');
      return { delivered: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.log?.warn(
        { err, messageId: msg.id, targetRef: msg.targetRef },
        'cli-rpc: listener threw',
      );
      return { delivered: false, error: message };
    }
  }

  /** Register a live `factory chat` session to receive pushed messages. */
  registerSession(sessionRef: string, listener: SessionListener): () => void {
    this.sessions.set(sessionRef, listener);
    this.log?.info({ sessionRef }, 'cli-rpc: session registered');
    return () => this.unregisterSession(sessionRef);
  }

  unregisterSession(sessionRef: string): void {
    if (this.sessions.delete(sessionRef)) {
      this.log?.info({ sessionRef }, 'cli-rpc: session unregistered');
    }
  }

  /** Test/observability helper: list active session refs. */
  activeSessions(): readonly string[] {
    return [...this.sessions.keys()];
  }
}

/** Factory: returns a fresh CLI-RPC plugin instance. */
export function createCliRpcChannel(): CliRpcChannel {
  return new CliRpcChannel();
}
