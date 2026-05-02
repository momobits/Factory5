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
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  Events,
  GatewayIntentBits,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Interaction,
  type Message,
  type ModalSubmitInteraction,
  type RESTPostAPIApplicationCommandsJSONBody,
  type TextBasedChannel,
  type ThreadChannel,
} from 'discord.js';
import { z } from 'zod';

import { routeChatIntent, type ChatRoutedDispatch } from './chat-routing.js';
import {
  buildFactorySlashCommand,
  dispatchSlashInteraction,
  runChatRoutedDiscordCommand,
  type DiscordCommandContext,
} from './discord-commands.js';
import type { CommandHandlerContext } from './command-handlers.js';
import type { ChannelContext, ChannelPlugin, SendResult } from './types.js';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export const discordConfigSchema = z.object({
  /** Bot token (required). Stored in `config.toml` under `[channels.discord]`. */
  token: z.string().min(1, 'channels.discord.token is required'),
  /**
   * Discord application id — kept for completeness; the
   * `/factory` slash command is registered via
   * `client.application.commands.set()` after `Events.ClientReady`,
   * which reads the application from the live client rather than
   * this id, so the field is no longer load-bearing for registration.
   */
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
  /**
   * Skip slash-command registration on `ClientReady`. Set this when the
   * commands are managed out-of-band (e.g. a dedicated registrar script,
   * or when running multiple Discord plugin instances against the same
   * bot — registration is a global write so only one instance should do
   * it). Default `false` — registration runs unless suppressed.
   */
  skipSlashRegistration: z.boolean().default(false),
});

export type DiscordConfig = z.infer<typeof discordConfigSchema>;

// ---------------------------------------------------------------------------
// Pluggable client (for tests)
// ---------------------------------------------------------------------------

/**
 * A minimal contract the channel uses against discord.js. Most real usage
 * satisfies this via the stock `Client`; tests pass a stub that records
 * events and exposes a `simulateMessage` helper.
 *
 * Slash-command bits (`application`, `on('interactionCreate', …)`) are
 * optional — the message-only path remains intact even when a stub
 * doesn't implement them. `start()` skips slash registration / dispatch
 * when the surface is absent.
 */
export interface DiscordClientLike {
  user: { id: string; tag: string } | null;
  once(event: typeof Events.ClientReady, listener: () => void): void;
  on(event: 'messageCreate', listener: (msg: Message) => void | Promise<void>): void;
  on(
    event: 'interactionCreate',
    listener: (interaction: Interaction) => void | Promise<void>,
  ): void;
  off(event: 'messageCreate', listener: (msg: Message) => void | Promise<void>): void;
  off(
    event: 'interactionCreate',
    listener: (interaction: Interaction) => void | Promise<void>,
  ): void;
  login(token: string): Promise<string>;
  destroy(): Promise<void>;
  channels: {
    fetch(id: string): Promise<TextBasedChannel | ThreadChannel | null>;
  };
  /**
   * The application surface used to register slash commands. discord.js
   * populates `client.application` after `Events.ClientReady`. Optional
   * here so test stubs can omit it; the plugin treats `undefined` as
   * "skip slash registration / dispatch".
   */
  application?: {
    commands: {
      set(
        commands: ReadonlyArray<RESTPostAPIApplicationCommandsJSONBody>,
        guildId?: string,
      ): Promise<unknown>;
    };
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
// Pending-question button affordances (Phase 2.3)
// ---------------------------------------------------------------------------

/**
 * Custom-id prefixes for button + modal interactions. Discord caps custom
 * ids at 100 chars; ULIDs are 26, so `factory:question:<ulid>:answer` fits
 * comfortably.
 */
export const QUESTION_BUTTON_PREFIX = 'factory:question:';
export const ANSWER_MODAL_PREFIX = 'factory:answer:';
export const ANSWER_INPUT_ID = 'factory:answer-text';

export type QuestionButtonAction = 'answer' | 'skip' | 'escalate';

/**
 * Read the `metadata.questionId` annotation that {@link
 * brain/src/ask-user.ts} stamps on `ask_user` outbounds. Returns `undefined`
 * when the outbound carries no question — the bare-text send path stays
 * untouched. Exported so tests and the matching Telegram side can share
 * the parse rule.
 */
export function readQuestionMetadata(metadata: unknown): { questionId: string } | undefined {
  if (typeof metadata !== 'object' || metadata === null) return undefined;
  const m = metadata as Record<string, unknown>;
  if (m['kind'] !== 'ask_user') return undefined;
  const id = m['questionId'];
  return typeof id === 'string' && id.length > 0 ? { questionId: id } : undefined;
}

/** Build the Answer / Skip / Escalate row attached to an `ask_user` outbound. */
export function buildQuestionComponents(
  questionId: string,
): Array<ActionRowBuilder<ButtonBuilder>> {
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${QUESTION_BUTTON_PREFIX}${questionId}:answer`)
      .setLabel('Answer')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`${QUESTION_BUTTON_PREFIX}${questionId}:skip`)
      .setLabel('Skip')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`${QUESTION_BUTTON_PREFIX}${questionId}:escalate`)
      .setLabel('Escalate')
      .setStyle(ButtonStyle.Danger),
  );
  return [row];
}

/**
 * Modal shown when the operator taps the Answer button. The text input is
 * a multi-line paragraph capped at 2000 chars (Discord's hard limit). The
 * label is the question text truncated to 45 chars (Discord caps labels).
 */
export function buildAnswerModal(questionId: string, question: string): ModalBuilder {
  const labelText = question.length > 45 ? `${question.slice(0, 44)}…` : question;
  const input = new TextInputBuilder()
    .setCustomId(ANSWER_INPUT_ID)
    .setLabel(labelText.length > 0 ? labelText : 'Answer')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(2000);
  const row = new ActionRowBuilder<TextInputBuilder>().addComponents(input);
  return new ModalBuilder()
    .setCustomId(`${ANSWER_MODAL_PREFIX}${questionId}`)
    .setTitle('Answer factory question')
    .addComponents(row);
}

/** Decode `factory:question:<id>:<action>`. Returns `undefined` for non-matches. */
export function parseQuestionButtonId(
  customId: string,
): { questionId: string; action: QuestionButtonAction } | undefined {
  if (!customId.startsWith(QUESTION_BUTTON_PREFIX)) return undefined;
  const rest = customId.slice(QUESTION_BUTTON_PREFIX.length);
  const lastColon = rest.lastIndexOf(':');
  if (lastColon <= 0) return undefined;
  const questionId = rest.slice(0, lastColon);
  const action = rest.slice(lastColon + 1);
  if (action !== 'answer' && action !== 'skip' && action !== 'escalate') return undefined;
  return { questionId, action };
}

/** Decode `factory:answer:<id>` (the modal's customId). */
export function parseAnswerModalId(customId: string): { questionId: string } | undefined {
  if (!customId.startsWith(ANSWER_MODAL_PREFIX)) return undefined;
  const questionId = customId.slice(ANSWER_MODAL_PREFIX.length);
  return questionId.length > 0 ? { questionId } : undefined;
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
  private setProjectBudget: ChannelContext['setProjectBudget'] | undefined;
  private classifyIntent: ChannelContext['classifyIntent'] | undefined;
  private db: Database | undefined;
  private ownsDb = false;
  private messageHandler: ((msg: Message) => Promise<void>) | undefined;
  private interactionHandler: ((interaction: Interaction) => Promise<void>) | undefined;
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
    this.setProjectBudget = ctx.setProjectBudget;
    this.classifyIntent = ctx.classifyIntent;
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

    // Slash-command dispatch — registered before login so any interactions
    // arriving while ready races resolve cleanly. Tests whose stub omits
    // `interactionCreate` support naturally skip this leg.
    const interactionHandler = async (interaction: Interaction): Promise<void> =>
      this.handleInteraction(interaction);
    this.interactionHandler = interactionHandler;
    client.on('interactionCreate', interactionHandler);

    await client.login(this.config.token);
    await readyPromise;

    // Slash-command registration. `client.application` is populated after
    // `Events.ClientReady`; if the live shape doesn't include it (test
    // stub) or `skipSlashRegistration` is set, we leave registration to
    // the operator (or a dedicated registrar script).
    if (this.config.skipSlashRegistration !== true && client.application !== undefined) {
      try {
        const command = buildFactorySlashCommand();
        await client.application.commands.set([command], this.config.guildId);
        this.log?.info(
          {
            scope: this.config.guildId !== undefined ? 'guild' : 'global',
            guildId: this.config.guildId ?? null,
          },
          'discord: registered /factory slash command',
        );
      } catch (err) {
        // Don't fail start() — message-path inbound still works without
        // slash. Log loudly so operators see the registration error.
        this.log?.error(
          { err, guildId: this.config.guildId ?? null },
          'discord: slash-command registration failed; /factory will not work until next start',
        );
      }
    }

    this.log?.info(
      { userTag: client.user?.tag ?? '(unknown)', guildId: this.config.guildId ?? '(any)' },
      'discord: ready',
    );
  }

  async stop(): Promise<void> {
    if (this.client !== undefined && this.messageHandler !== undefined) {
      this.client.off('messageCreate', this.messageHandler);
    }
    if (this.client !== undefined && this.interactionHandler !== undefined) {
      this.client.off('interactionCreate', this.interactionHandler);
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
    this.messageHandler = undefined;
    this.interactionHandler = undefined;
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
      // Phase 2.3 — when the brain stamps `metadata.kind = 'ask_user'` on
      // an outbound (see brain/src/ask-user.ts), attach the
      // Answer/Skip/Escalate button row. The bare-text path stays
      // unchanged so non-question outbounds keep their current shape.
      const meta = readQuestionMetadata(msg.metadata);
      type SendablePayload =
        | string
        | { content: string; components: Array<ActionRowBuilder<ButtonBuilder>> };
      const sendable = channel as { send: (payload: SendablePayload) => Promise<{ id: string }> };
      const posted =
        meta !== undefined
          ? await sendable.send({
              content: msg.text,
              components: buildQuestionComponents(meta.questionId),
            })
          : await sendable.send(msg.text);
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

    // Phase 2.5 — when the prefix-detector picked `chat`, ask the brain's
    // triage to classify the free-form text. If it's actually a read-side
    // intent (status/spend/findings/resume) or a chat-shaped build with a
    // clear project token, run the matching command-handler and post the
    // formatted reply directly. The legacy "create chat directive" path
    // is the fallback.
    if (intent === 'chat' && this.classifyIntent !== undefined) {
      const dispatched = await this.maybeRouteChatIntent(message, text, threadOrRef);
      if (dispatched) return;
    }

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

  /**
   * Phase 2.5 — classify chat-shaped text and re-route it to a read-side
   * command when triage is confident enough. Returns `true` if the
   * message was handled (caller skips chat-directive creation).
   *
   * Failure modes are deliberately quiet: any throw from triage or
   * command dispatch logs a warn and returns `false` so the legacy
   * chat-directive path takes over.
   */
  private async maybeRouteChatIntent(
    message: Message,
    text: string,
    channelRef: string,
  ): Promise<boolean> {
    if (
      this.classifyIntent === undefined ||
      this.db === undefined ||
      this.log === undefined ||
      this.onInbound === undefined
    ) {
      return false;
    }
    let classification;
    try {
      classification = await this.classifyIntent(text);
    } catch (err) {
      this.log.warn({ err, text: text.slice(0, 200) }, 'discord: classifyIntent failed');
      return false;
    }
    const dispatch = routeChatIntent(classification, text);
    if (dispatch === undefined) return false;

    const handlerCtx: CommandHandlerContext = {
      db: this.db,
      log: this.log,
      source: 'discord',
      principal: message.author.id,
      channelRef,
      onInbound: this.onInbound,
      resolveProjectPath: this.resolveProjectPath,
      resolveBuildLimits: this.resolveBuildLimits,
      setProjectBudget: this.setProjectBudget,
    };

    let embed;
    try {
      embed = await runChatRoutedDiscordCommand(
        handlerCtx,
        this.db,
        dispatch as ChatRoutedDispatch,
      );
    } catch (err) {
      this.log.warn(
        { err, command: dispatch.command, intent: classification.intent },
        'discord: chat-routed command threw — falling back to chat directive',
      );
      return false;
    }
    this.log.info(
      {
        intent: classification.intent,
        confidence: classification.confidence,
        command: dispatch.command,
        userId: message.author.id,
      },
      'discord: chat re-routed to read-side command',
    );
    type Replyable = {
      reply: (payload: { embeds: unknown[] }) => Promise<{ id: string }>;
    };
    void (message as unknown as Replyable).reply({ embeds: [embed] }).catch((err: unknown) => {
      this.log?.warn({ err, command: dispatch.command }, 'discord: chat-routed reply failed');
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

  /** Testing helper: drive a slash interaction through the dispatcher. */
  async _simulateInteraction(interaction: Interaction): Promise<void> {
    await this.handleInteraction(interaction);
  }

  // ---- interaction dispatch ----

  /**
   * Routes any `interactionCreate` event. Branches:
   *
   * - chat-input commands → slash dispatch (Phase 2.1).
   * - buttons whose `customId` starts with `factory:question:` →
   *   pending-question button affordances (Phase 2.3). Answer opens a
   *   modal; Skip / Escalate write a synthetic answer immediately.
   * - modal submits whose `customId` starts with `factory:answer:` →
   *   the operator's typed answer is recorded via {@link
   *   pendingQuestions.answer}.
   *
   * Anything else (autocomplete, select menus, …) falls through silently.
   */
  private async handleInteraction(interaction: Interaction): Promise<void> {
    if (interaction.isChatInputCommand()) {
      await this.handleSlashCommand(interaction);
      return;
    }
    if (interaction.isButton()) {
      await this.handleQuestionButton(interaction);
      return;
    }
    if (interaction.isModalSubmit()) {
      await this.handleAnswerModalSubmit(interaction);
      return;
    }
  }

  private async handleSlashCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    if (this.db === undefined || this.log === undefined || this.onInbound === undefined) {
      return;
    }
    const config = this.config;
    if (config === undefined) return;
    const ctx: DiscordCommandContext = {
      db: this.db,
      log: this.log,
      user: { id: interaction.user.id, tag: interaction.user.tag },
      guildId: interaction.guildId ?? undefined,
      onInbound: this.onInbound,
      resolveProjectPath: this.resolveProjectPath,
      resolveBuildLimits: this.resolveBuildLimits,
      setProjectBudget: this.setProjectBudget,
      allowedUserIds: config.allowedUserIds,
    };
    await dispatchSlashInteraction(ctx, interaction);
  }

  private async handleQuestionButton(interaction: ButtonInteraction): Promise<void> {
    const parsed = parseQuestionButtonId(interaction.customId);
    if (parsed === undefined) return; // not one of ours
    if (this.db === undefined || this.log === undefined) return;

    const allow = this.config?.allowedUserIds ?? [];
    if (allow.length > 0 && !allow.includes(interaction.user.id)) {
      await interaction.reply({ content: '(not authorised)', ephemeral: true });
      return;
    }

    const question = pendingQuestions.getById(this.db, parsed.questionId);
    if (question === undefined) {
      await interaction.reply({ content: '(question not found)', ephemeral: true });
      return;
    }
    if (question.answeredAt !== undefined) {
      await interaction.reply({ content: '(question already answered)', ephemeral: true });
      return;
    }

    if (parsed.action === 'answer') {
      // The modal must be the FIRST acknowledgement of the interaction —
      // discord.js rejects a `showModal` after `reply`/`deferReply`.
      await interaction.showModal(buildAnswerModal(parsed.questionId, question.question));
      return;
    }

    // Skip / Escalate — synthetic answer, immediate ack.
    const synthetic = parsed.action === 'skip' ? '[skip]' : '[escalate]';
    pendingQuestions.answer(this.db, parsed.questionId, synthetic, new Date().toISOString());
    this.log.info(
      {
        questionId: parsed.questionId,
        directiveId: question.directiveId,
        action: parsed.action,
        userId: interaction.user.id,
      },
      'discord: pending question answered via button',
    );
    this.warnIfOrphaned(parsed.questionId, question.directiveId);
    await interaction.reply({
      content: parsed.action === 'skip' ? '(skipped)' : '(escalated)',
      ephemeral: true,
    });
  }

  private async handleAnswerModalSubmit(interaction: ModalSubmitInteraction): Promise<void> {
    const parsed = parseAnswerModalId(interaction.customId);
    if (parsed === undefined) return; // not one of ours
    if (this.db === undefined || this.log === undefined) return;

    const allow = this.config?.allowedUserIds ?? [];
    if (allow.length > 0 && !allow.includes(interaction.user.id)) {
      await interaction.reply({ content: '(not authorised)', ephemeral: true });
      return;
    }

    const text = interaction.fields.getTextInputValue(ANSWER_INPUT_ID).trim();
    if (text.length === 0) {
      await interaction.reply({ content: '(empty answer ignored)', ephemeral: true });
      return;
    }

    const question = pendingQuestions.getById(this.db, parsed.questionId);
    if (question === undefined) {
      await interaction.reply({ content: '(question not found)', ephemeral: true });
      return;
    }
    if (question.answeredAt !== undefined) {
      await interaction.reply({ content: '(question already answered)', ephemeral: true });
      return;
    }

    pendingQuestions.answer(this.db, parsed.questionId, text, new Date().toISOString());
    this.log.info(
      {
        questionId: parsed.questionId,
        directiveId: question.directiveId,
        userId: interaction.user.id,
      },
      'discord: pending question answered via modal',
    );
    this.warnIfOrphaned(parsed.questionId, question.directiveId);
    await interaction.reply({ content: '(answered)', ephemeral: true });
  }

  /**
   * Mirror the messageCreate / Telegram orphan-detection behaviour: when
   * the answer lands on a question whose linked task has already entered a
   * terminal state, the answer is preserved for forensic value but no
   * worker remains to consume it. Log loudly so the operator understands
   * why the build didn't resume. (ADR 0024 §4.)
   */
  private warnIfOrphaned(questionId: string, directiveId: string): void {
    if (this.db === undefined || this.log === undefined) return;
    const orphan = pendingQuestions.detectOrphanedAnswer(this.db, questionId);
    if (orphan !== undefined) {
      this.log.warn(
        {
          questionId,
          directiveId,
          taskId: orphan.taskId,
          taskStatus: orphan.taskStatus,
        },
        'discord: answer recorded for question whose task is terminal — no consumer remains',
      );
    }
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
