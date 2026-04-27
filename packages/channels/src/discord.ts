/**
 * Discord channel plugin (`id: 'discord'`).
 *
 * Wraps `discord.js` with the {@link ChannelPlugin} contract:
 *
 *   - `start(config)` logs the bot in, waits for `ClientReady`, and registers
 *     a `messageCreate` listener. Inbound messages are normalised to
 *     {@link Directive} rows and published via `ctx.onInbound`.
 *   - `send(msg)` routes an outbound message by parsing `targetRef` as
 *     `<channelId>#<threadOrMessageId>`. Threads are fetched via
 *     `client.channels.fetch` (threads are channels in discord.js).
 *   - `stop()` destroys the client.
 *
 * ## Thread discipline
 *
 * Every directive created from an initial mention starts a new thread so
 * concurrent directives don't interleave in the host channel. Follow-up
 * messages posted in that thread either:
 *
 *   - answer an open {@link PendingQuestion} whose `channelRef` matches the
 *     thread (the brain's `askUser` is unblocked), or
 *   - post a fresh directive with the same thread as its `channelRef` so
 *     the history stays attached.
 *
 * ## Config
 *
 * See {@link discordConfigSchema}. `token` + `applicationId` are required.
 * `guildId` scopes the bot to a single guild; omit to accept from any guild
 * the bot has been invited to. `allowedUserIds` is an allow-list by user id
 * (empty / omitted = any user the Discord permission system already lets
 * through).
 *
 * ## Test injection
 *
 * {@link createDiscordChannel} takes an optional `clientFactory` so unit
 * tests can feed in a stub client instead of calling the live Discord API.
 */

import {
  newId,
  type Directive,
  type DirectiveLimits,
  type Intent,
  type OutboundMessage,
} from '@factory5/core';
import type { Logger } from '@factory5/logger';
import { openDatabase, pendingQuestions, type Database } from '@factory5/state';
import {
  ChannelType,
  Client,
  Events,
  GatewayIntentBits,
  type Message,
  type TextBasedChannel,
  type ThreadChannel,
} from 'discord.js';
import { z } from 'zod';

import type { ChannelContext, ChannelPlugin, SendResult } from './types.js';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export const discordConfigSchema = z.object({
  /** Bot token (required). Stored in `config.toml` under `[channels.discord]`. */
  token: z.string().min(1, 'channels.discord.token is required'),
  /** Discord application id — used by future slash-command wiring. */
  applicationId: z.string().min(1).optional(),
  /** Restrict the bot to a single guild. */
  guildId: z.string().min(1).optional(),
  /** Default channel to post into for directives that don't originate from a thread. */
  defaultChannelId: z.string().min(1).optional(),
  /** Allow-list of Discord user ids. Empty ⇒ anyone. */
  allowedUserIds: z.array(z.string().min(1)).default([]),
  /**
   * Prefix for build directives. Anything mentioning the bot whose text
   * (post-mention-strip) starts with this string is parsed as
   * `intent=build`. Default `/build`.
   */
  buildPrefix: z.string().default('/build'),
});

export type DiscordConfig = z.infer<typeof discordConfigSchema>;

// ---------------------------------------------------------------------------
// Pluggable client (for tests)
// ---------------------------------------------------------------------------

/**
 * A minimal contract the channel uses against discord.js. Most real usage
 * satisfies this via the stock `Client`; tests pass a stub that records
 * events and exposes a `simulateMessage` helper.
 */
export interface DiscordClientLike {
  user: { id: string; tag: string } | null;
  once(event: typeof Events.ClientReady, listener: () => void): void;
  on(event: 'messageCreate', listener: (msg: Message) => void | Promise<void>): void;
  off(event: 'messageCreate', listener: (msg: Message) => void | Promise<void>): void;
  login(token: string): Promise<string>;
  destroy(): Promise<void>;
  channels: {
    fetch(id: string): Promise<TextBasedChannel | ThreadChannel | null>;
  };
}

export type DiscordClientFactory = () => DiscordClientLike;

/** Default factory — constructs a real `discord.js` Client with the intents we need. */
export function defaultDiscordClientFactory(): DiscordClientLike {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });
  return client as unknown as DiscordClientLike;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse `targetRef` produced by the inbound handler into `{ channelId,
 * threadId?  }`. Accepts both bare channel ids (`123`) and the compound
 * `<channelId>#<threadOrMessageId>` form we emit for thread-scoped
 * directives.
 */
export function parseDiscordRef(ref: string): { channelId: string; threadId?: string } {
  const hashIdx = ref.indexOf('#');
  if (hashIdx < 0) return { channelId: ref };
  const channelId = ref.slice(0, hashIdx);
  const threadId = ref.slice(hashIdx + 1);
  return threadId.length > 0 ? { channelId, threadId } : { channelId };
}

/** Strip a leading bot-mention (`<@id>` or `<@!id>`) from the message text. */
export function stripBotMention(text: string, botId: string): string {
  const mention = `<@${botId}>`;
  const nickMention = `<@!${botId}>`;
  let out = text.trim();
  if (out.startsWith(mention)) out = out.slice(mention.length).trim();
  else if (out.startsWith(nickMention)) out = out.slice(nickMention.length).trim();
  return out;
}

/**
 * Compute the compound `channelRef` for a directive originating from this
 * Discord message. Uses the parent channel id plus the thread id if the
 * message is already in a thread; otherwise we'll pass just the channel id
 * and the caller (start handler) decides whether to create a thread.
 */
export function channelRefFor(message: Message): string {
  // discord.js threads expose `parentId` (the parent channel); non-threads
  // keep `parentId = null` and use their own channel id.
  const parent = message.channel.isThread() ? message.channel.parentId : message.channelId;
  const threadOrMsg = message.channel.isThread() ? message.channelId : message.id;
  return `${parent ?? message.channelId}#${threadOrMsg}`;
}

// ---------------------------------------------------------------------------
// Channel plugin
// ---------------------------------------------------------------------------

export interface DiscordChannelOptions {
  /** Override the underlying client (tests). */
  clientFactory?: DiscordClientFactory;
  /**
   * Database accessor. Normally the plugin opens the default factory db
   * inside `start()` so it can look up {@link PendingQuestion} rows without
   * threading the handle through channel ctx. Tests pass an explicit handle.
   */
  db?: Database;
}

export class DiscordChannel implements ChannelPlugin {
  readonly id = 'discord' as const;
  readonly capabilities = {
    inbound: true,
    outbound: true,
    threading: true,
    interactive: true,
    fileAttachments: false,
  };
  readonly configSchema = discordConfigSchema;

  private readonly clientFactory: DiscordClientFactory;
  private readonly externalDb: Database | undefined;
  private client: DiscordClientLike | undefined;
  private config: DiscordConfig | undefined;
  private log: Logger | undefined;
  private onInbound: ChannelContext['onInbound'] | undefined;
  private resolveProjectPath: ChannelContext['resolveProjectPath'] | undefined;
  private resolveBuildLimits: ChannelContext['resolveBuildLimits'] | undefined;
  private db: Database | undefined;
  private ownsDb = false;
  private messageHandler: ((msg: Message) => Promise<void>) | undefined;
  private ready = false;

  constructor(opts: DiscordChannelOptions = {}) {
    this.clientFactory = opts.clientFactory ?? defaultDiscordClientFactory;
    this.externalDb = opts.db;
  }

  async start(ctx: ChannelContext, rawConfig: unknown): Promise<void> {
    this.log = ctx.log;
    this.onInbound = ctx.onInbound;
    this.resolveProjectPath = ctx.resolveProjectPath;
    this.resolveBuildLimits = ctx.resolveBuildLimits;
    this.config = discordConfigSchema.parse(rawConfig);

    if (this.externalDb !== undefined) {
      this.db = this.externalDb;
    } else {
      this.db = openDatabase();
      this.ownsDb = true;
    }

    const client = this.clientFactory();
    this.client = client;

    const readyPromise = new Promise<void>((resolve) => {
      client.once(Events.ClientReady, () => {
        this.ready = true;
        resolve();
      });
    });

    const handler = async (message: Message): Promise<void> => this.handleMessage(message);
    this.messageHandler = handler;
    client.on('messageCreate', handler);

    await client.login(this.config.token);
    await readyPromise;

    this.log?.info(
      { userTag: client.user?.tag ?? '(unknown)', guildId: this.config.guildId ?? '(any)' },
      'discord: ready',
    );
  }

  async stop(): Promise<void> {
    if (this.client !== undefined && this.messageHandler !== undefined) {
      this.client.off('messageCreate', this.messageHandler);
    }
    if (this.client !== undefined) {
      try {
        await this.client.destroy();
      } catch (err) {
        this.log?.warn({ err }, 'discord: client destroy threw');
      }
    }
    if (this.ownsDb && this.db !== undefined) {
      this.db.close();
    }
    this.client = undefined;
    this.db = undefined;
    this.ready = false;
    this.log?.info('discord: stopped');
  }

  async send(msg: OutboundMessage): Promise<SendResult> {
    if (!this.ready || this.client === undefined) {
      return { delivered: false, error: 'discord: not ready' };
    }
    const { channelId, threadId } = parseDiscordRef(msg.targetRef);
    const targetId = threadId ?? channelId;
    try {
      const channel = (await this.client.channels.fetch(targetId)) as TextBasedChannel | null;
      if (channel === null) {
        return { delivered: false, error: `discord: channel ${targetId} not found` };
      }
      if (!('send' in channel) || typeof channel.send !== 'function') {
        return { delivered: false, error: `discord: channel ${targetId} is not sendable` };
      }
      const posted = await (channel as { send: (text: string) => Promise<{ id: string }> }).send(
        msg.text,
      );
      return { delivered: true, externalId: posted.id };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.log?.warn({ err, targetRef: msg.targetRef }, 'discord: send threw');
      return { delivered: false, error: message };
    }
  }

  // ---- inbound ----

  private async handleMessage(message: Message): Promise<void> {
    // Ignore our own messages + bots.
    if (message.author.bot) return;
    // Guild scoping.
    if (this.config?.guildId !== undefined && message.guildId !== this.config.guildId) return;
    // Allow-list.
    const allow = this.config?.allowedUserIds ?? [];
    if (allow.length > 0 && !allow.includes(message.author.id)) {
      this.log?.debug({ userId: message.author.id }, 'discord: user not in allowlist — ignoring');
      return;
    }

    const botId = this.client?.user?.id;
    const isMention = botId !== undefined && message.mentions.has(botId);
    const text =
      botId !== undefined ? stripBotMention(message.content, botId) : message.content.trim();

    // If the message is in a thread with an open pending question, treat as answer.
    if (message.channel.isThread() && this.db !== undefined) {
      const answered = this.maybeAnswerPendingQuestion(message, text);
      if (answered) return;
    }

    // Mentions = directive source.
    if (!isMention && !message.channel.isThread()) return;
    if (!isMention && message.channel.isThread()) {
      // In-thread follow-up without mention: treat as a chat directive tied to
      // the thread so the brain can continue the conversation.
      // (If the thread had an open question it would've been handled above.)
    }

    const intent = this.detectIntent(text);
    const threadOrRef = await this.ensureThreadRef(message);

    if (this.onInbound === undefined || this.db === undefined) return;

    // For build intent, resolve project name to absolute workspace path
    // before enqueueing — parallels the Telegram change (issue I011).
    let payload: Record<string, unknown>;
    let resolvedProjectName: string | undefined;
    if (intent === 'build') {
      const buildPayload = this.parseBuildPayload(text);
      const projectName = buildPayload['project'];
      if (typeof projectName === 'string') resolvedProjectName = projectName;
      if (typeof projectName === 'string' && this.resolveProjectPath !== undefined) {
        try {
          const projectPath = await this.resolveProjectPath(projectName);
          payload = { ...buildPayload, projectPath };
        } catch (err) {
          this.log?.warn(
            { err, projectName },
            'discord: resolveProjectPath failed — falling back to raw name',
          );
          payload = buildPayload;
        }
      } else {
        payload = buildPayload;
      }
    } else {
      payload = { text };
    }

    // Three-tier budget resolution for inbound /build (issue I009 fix).
    // Mirrors the Telegram path: the daemon binds resolveBuildLimits to a
    // closure that merges project metadata with config defaults; without
    // it (tests, standalone scripts) the directive carries no `limits`.
    let limits: DirectiveLimits | undefined;
    if (
      intent === 'build' &&
      resolvedProjectName !== undefined &&
      this.resolveBuildLimits !== undefined
    ) {
      try {
        limits = await this.resolveBuildLimits(resolvedProjectName);
      } catch (err) {
        this.log?.warn(
          { err, projectName: resolvedProjectName },
          'discord: resolveBuildLimits failed — directive will run uncapped',
        );
      }
    }

    const directive: Directive = {
      id: newId(),
      source: 'discord',
      principal: message.author.id,
      channelRef: threadOrRef,
      intent,
      payload,
      autonomy: intent === 'build' ? 'autonomous' : 'chat',
      createdAt: new Date().toISOString(),
      status: 'pending',
      ...(limits !== undefined ? { limits } : {}),
    };

    try {
      await this.onInbound(directive);
      this.log?.info(
        {
          directiveId: directive.id,
          intent,
          channelRef: threadOrRef,
          principal: directive.principal,
        },
        'discord: inbound directive',
      );
    } catch (err) {
      this.log?.error({ err, directiveId: directive.id }, 'discord: onInbound threw');
    }
  }

  /**
   * If the message's thread has an open pending question, record the
   * message text as the answer and acknowledge back into the thread.
   * Returns `true` if it handled the message as an answer.
   */
  private maybeAnswerPendingQuestion(message: Message, text: string): boolean {
    if (!message.channel.isThread() || this.db === undefined) return false;
    const threadId = message.channelId;
    // Look up by channelRef LIKE `%#<threadId>` — we don't have the
    // directiveId on the message alone.
    const rows = this.db
      .prepare(
        `SELECT id, directive_id AS directiveId
           FROM pending_questions
          WHERE channel = 'discord'
            AND channel_ref LIKE ?
            AND answered_at IS NULL
          ORDER BY created_at ASC
          LIMIT 1`,
      )
      .all(`%#${threadId}`) as Array<{ id: string; directiveId: string }>;
    const row = rows[0];
    if (row === undefined) return false;
    pendingQuestions.answer(this.db, row.id, text, new Date().toISOString());
    this.log?.info(
      {
        questionId: row.id,
        directiveId: row.directiveId,
        threadId,
      },
      'discord: answered pending question from thread reply',
    );
    // ADR 0024 §4 — if the linked task is already terminal (orphaned by a
    // brain restart, or aborted for other reasons), the answer is preserved
    // for forensic value but no consumer is alive to use it. Surface as warn
    // so operators understand why the build didn't resume.
    const orphan = pendingQuestions.detectOrphanedAnswer(this.db, row.id);
    if (orphan !== undefined) {
      this.log?.warn(
        {
          questionId: row.id,
          taskId: orphan.taskId,
          taskStatus: orphan.taskStatus,
          threadId,
        },
        'discord: answer recorded for question whose task is terminal — no consumer remains',
      );
    }
    // Fire-and-forget ack — failures here don't invalidate the answer.
    void message.reply(`(answered question ${row.id})`).catch((err: unknown) => {
      this.log?.warn({ err, questionId: row.id }, 'discord: answer ack failed');
    });
    return true;
  }

  private detectIntent(text: string): Intent {
    const prefix = this.config?.buildPrefix ?? '/build';
    const trimmed = text.trim();
    if (trimmed.toLowerCase().startsWith(prefix.toLowerCase())) return 'build';
    return 'chat';
  }

  private parseBuildPayload(text: string): Record<string, unknown> {
    const prefix = this.config?.buildPrefix ?? '/build';
    const payloadText = text.slice(prefix.length).trim();
    // Accept either `project-name` or `project-name -- extra spec text`.
    const sepIdx = payloadText.indexOf(' -- ');
    const project = sepIdx < 0 ? payloadText : payloadText.slice(0, sepIdx).trim();
    const spec = sepIdx < 0 ? undefined : payloadText.slice(sepIdx + 4).trim();
    const out: Record<string, unknown> = {};
    if (project.length > 0) out['project'] = project;
    if (spec !== undefined && spec.length > 0) out['spec'] = spec;
    // Fall back to the raw text so the brain has something to triage even
    // if the user wrote something unusual.
    out['text'] = text;
    return out;
  }

  /**
   * Make sure the directive has a thread `channelRef`. If the triggering
   * message is already in a thread, reuse it; otherwise start one on the
   * mention message so follow-up conversation stays threaded.
   */
  private async ensureThreadRef(message: Message): Promise<string> {
    if (message.channel.isThread()) {
      const parent = message.channel.parentId ?? message.channel.id;
      return `${parent}#${message.channel.id}`;
    }
    // Try to create a thread on this message; fall back to the message ref
    // if the channel doesn't support threads (DMs, voice, etc.).
    const channel = message.channel;
    if (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement) {
      return channelRefFor(message);
    }
    try {
      const startable = message as unknown as {
        startThread: (opts: { name: string; autoArchiveDuration: number }) => Promise<{
          id: string;
        }>;
      };
      const threadName = buildThreadName(message.content);
      const thread = await startable.startThread({ name: threadName, autoArchiveDuration: 1440 });
      return `${message.channelId}#${thread.id}`;
    } catch (err) {
      this.log?.warn(
        { err, messageId: message.id },
        'discord: startThread failed, using message ref',
      );
      return channelRefFor(message);
    }
  }

  /** Testing helper: drive a message through the handler directly. */
  async _simulateMessage(message: Message): Promise<void> {
    await this.handleMessage(message);
  }
}

/** Trim message text into a ≤100-char thread name (Discord's hard limit). */
export function buildThreadName(text: string): string {
  const base = `factory: ${text.replace(/\s+/g, ' ').trim()}`;
  if (base.length <= 100) return base;
  return `${base.slice(0, 97)}...`;
}

/** Factory: returns a fresh Discord plugin instance. */
export function createDiscordChannel(opts?: DiscordChannelOptions): DiscordChannel {
  return new DiscordChannel(opts);
}

// Re-export a precise Zod type alias so consumers (tests + daemon wiring)
// can statically refer to the validated config.
export type { DiscordConfig as DiscordPluginConfig };
