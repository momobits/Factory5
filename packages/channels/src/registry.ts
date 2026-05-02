/**
 * Channel registry — owns the set of `ChannelPlugin`s registered with the
 * daemon, drives their lifecycle, and fans outbound messages to the right
 * plugin for delivery.
 *
 * The registry is constructed with a list of plugins + their per-channel
 * config blocks. `start()` calls `plugin.start()` for each; `stop()` reverses.
 * Individual plugin failures are captured in `status` / `lastError` so
 * `/status` surfaces them without taking the whole daemon down.
 */

import type {
  ChannelId,
  Directive,
  DirectiveLimits,
  OutboundMessage,
  ProjectBudgetDefaults,
} from '@factory5/core';
import type { Logger } from '@factory5/logger';

import type { ChannelPlugin, IntentClassification, SendResult } from './types.js';

export type ChannelStatus = 'ready' | 'starting' | 'failed' | 'disabled';

export interface ChannelEntry {
  id: ChannelId;
  plugin: ChannelPlugin;
  status: ChannelStatus;
  lastError?: string;
}

export interface ChannelRegistryOptions {
  log: Logger;
  /** Plugins + config. Missing plugins do not appear in `/status`. */
  plugins: Array<{
    plugin: ChannelPlugin;
    /** Channel config block validated by the plugin's `configSchema`. */
    config?: unknown;
  }>;
  /** Called when a plugin reports an inbound `Directive`. */
  onInbound: (directive: Directive) => void | Promise<void>;
  /**
   * Optional project-name → absolute path resolver. Threaded through to
   * each plugin's `ChannelContext` so `/build <name>` inbound handlers
   * can produce directives with a pre-resolved `payload.projectPath`,
   * matching what the CLI does (see issue I011). When unset, plugins
   * fall back to passing the raw project name — the pre-I011 behaviour.
   */
  resolveProjectPath?: (name: string) => Promise<string>;
  /**
   * Optional resolver that merges project-tier `metadata.budgetDefaults`
   * with the instance `config.toml [budget.defaults]` tier and returns
   * the resulting `DirectiveLimits` (or `undefined` for unlimited).
   * Threaded through to each plugin's `ChannelContext` so inbound
   * `/build <name>` handlers can produce directives with the same
   * three-tier limits as `factory build` (issue I009 fix). When unset,
   * inbound `/build` directives carry no `limits` — the pre-fix path.
   */
  resolveBuildLimits?: (name: string) => Promise<DirectiveLimits | undefined>;
  /**
   * Optional per-project budget mutator. Threaded through to each
   * plugin's `ChannelContext` so chat surfaces (Discord
   * `/factory budget`, Telegram once 2.2 ships) can write
   * `metadata.budgetDefaults`. The daemon binds this to a closure over
   * `wiki.updateProjectMetadata`. When unset (tests / standalone scripts),
   * the slash-command path returns an "unwired" error rather than
   * partially writing state.
   */
  setProjectBudget?: (
    name: string,
    defaults: ProjectBudgetDefaults,
  ) => Promise<{ projectId: string; defaults: ProjectBudgetDefaults }>;
  /**
   * Optional triage classifier (Phase 2.5). When set, channels can ask
   * the brain to classify a free-form chat message before deciding
   * whether to create a chat directive vs. dispatch a read-side
   * command. Daemon binds this to a closure over `brain.triageDirective`
   * + the configured provider registry. When unset (tests / standalone
   * scripts), channels skip pre-classification and fall back to the
   * legacy "every non-slash message becomes intent=chat" path.
   */
  classifyIntent?: (text: string) => Promise<IntentClassification>;
}

/**
 * Read-only view the daemon's IPC server uses to build `/status` responses.
 */
export interface ChannelRegistryView {
  list(): ReadonlyArray<{
    id: ChannelId;
    status: ChannelStatus;
    lastError?: string;
  }>;
}

export class ChannelRegistry implements ChannelRegistryView {
  private readonly log: Logger;
  private readonly entries = new Map<ChannelId, ChannelEntry>();
  private readonly onInbound: ChannelRegistryOptions['onInbound'];
  private readonly configByPlugin: Map<ChannelPlugin, unknown>;
  private readonly resolveProjectPath: ChannelRegistryOptions['resolveProjectPath'];
  private readonly resolveBuildLimits: ChannelRegistryOptions['resolveBuildLimits'];
  private readonly setProjectBudget: ChannelRegistryOptions['setProjectBudget'];
  private readonly classifyIntent: ChannelRegistryOptions['classifyIntent'];

  constructor(opts: ChannelRegistryOptions) {
    this.log = opts.log;
    this.onInbound = opts.onInbound;
    this.resolveProjectPath = opts.resolveProjectPath;
    this.resolveBuildLimits = opts.resolveBuildLimits;
    this.setProjectBudget = opts.setProjectBudget;
    this.classifyIntent = opts.classifyIntent;
    this.configByPlugin = new Map(opts.plugins.map((p) => [p.plugin, p.config]));
    for (const { plugin } of opts.plugins) {
      this.entries.set(plugin.id, {
        id: plugin.id,
        plugin,
        status: 'disabled',
      });
    }
  }

  /** Current state of every registered channel. */
  list(): ReadonlyArray<{ id: ChannelId; status: ChannelStatus; lastError?: string }> {
    return [...this.entries.values()].map((e) => ({
      id: e.id,
      status: e.status,
      ...(e.lastError !== undefined ? { lastError: e.lastError } : {}),
    }));
  }

  /** Fetch a plugin by id (for test injection / delivery routing). */
  get(id: ChannelId): ChannelPlugin | undefined {
    return this.entries.get(id)?.plugin;
  }

  /** Bring every plugin online. Failures are captured, not thrown. */
  async start(): Promise<void> {
    for (const entry of this.entries.values()) {
      entry.status = 'starting';
      try {
        // Validate config via the plugin's schema. A plugin that doesn't
        // need config ships a permissive schema (e.g. `z.object({}).default({})`)
        // so this parse always succeeds.
        const rawConfig = this.configByPlugin.get(entry.plugin);
        const validated = entry.plugin.configSchema.parse(rawConfig ?? {});
        await entry.plugin.start(
          {
            log: this.log.child({ channel: entry.id }),
            onInbound: (d) => this.onInbound(d),
            ...(this.resolveProjectPath !== undefined
              ? { resolveProjectPath: this.resolveProjectPath }
              : {}),
            ...(this.resolveBuildLimits !== undefined
              ? { resolveBuildLimits: this.resolveBuildLimits }
              : {}),
            ...(this.setProjectBudget !== undefined
              ? { setProjectBudget: this.setProjectBudget }
              : {}),
            ...(this.classifyIntent !== undefined ? { classifyIntent: this.classifyIntent } : {}),
          },
          validated,
        );
        entry.status = 'ready';
        delete entry.lastError;
        this.log.info({ channel: entry.id }, 'channel: ready');
      } catch (err) {
        entry.status = 'failed';
        entry.lastError = err instanceof Error ? err.message : String(err);
        this.log.error({ err, channel: entry.id }, 'channel: start failed');
      }
    }
  }

  /** Take every plugin offline. */
  async stop(): Promise<void> {
    for (const entry of [...this.entries.values()].reverse()) {
      try {
        await entry.plugin.stop();
        entry.status = 'disabled';
        delete entry.lastError;
      } catch (err) {
        entry.lastError = err instanceof Error ? err.message : String(err);
        this.log.warn({ err, channel: entry.id }, 'channel: stop failed');
      }
    }
  }

  /**
   * Send an outbound message via the matching plugin. Returns the plugin's
   * `SendResult`; callers decide how to mark the row as delivered.
   */
  async send(msg: OutboundMessage): Promise<SendResult> {
    const entry = this.entries.get(msg.targetChannel);
    if (entry === undefined) {
      return { delivered: false, error: `no plugin registered for channel ${msg.targetChannel}` };
    }
    if (entry.status !== 'ready') {
      return {
        delivered: false,
        error: `channel ${msg.targetChannel} not ready (${entry.status})`,
      };
    }
    try {
      return await entry.plugin.send(msg);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.log.warn({ err, channel: entry.id, messageId: msg.id }, 'channel: send threw');
      return { delivered: false, error: message };
    }
  }
}

/**
 * Helper to build a logger'd registry with the standard options surface.
 */
export function createChannelRegistry(opts: ChannelRegistryOptions): ChannelRegistry {
  return new ChannelRegistry(opts);
}
