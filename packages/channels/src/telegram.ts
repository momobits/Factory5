/**
 * Telegram channel plugin (`id: 'telegram'`).
 *
 * Wraps Telegram's Bot API via raw HTTP (no SDK) with the
 * {@link ChannelPlugin} contract:
 *
 *   - `start(config)` probes `/getMe`, then launches a long-polling loop
 *     against `/getUpdates` on a background promise. Each inbound message
 *     is normalised to a {@link Directive} and published via
 *     `ctx.onInbound`.
 *   - `send(msg)` posts via `/sendMessage`. `targetRef` is the chat id,
 *     optionally suffixed with `#<messageId>` to thread the reply via
 *     `reply_to_message_id` — the closest thing Telegram has to a Discord
 *     thread.
 *   - `stop()` aborts the poll loop and waits for it to drain.
 *
 * ## Private chats vs groups
 *
 * In private chats (`chat.type === 'private'`) every non-bot message is
 * treated as inbound for this bot. In groups / supergroups the bot only
 * processes messages that either `@<username>`-mention the bot or reply
 * to a bot message — the bot would otherwise react to every message in
 * the group.
 *
 * ## Pending questions
 *
 * A message whose `reply_to_message_id` matches the message we recorded
 * for an open {@link PendingQuestion} (via the directive's `channelRef
 * = <chatId>#<messageId>`) is recorded as the answer and acknowledged
 * back into the chat; no new directive is emitted.
 *
 * ## Polling discipline
 *
 * The loop maintains an `offset` cursor (last `update_id + 1`) so each
 * update is delivered exactly once per bot token. On network / 5xx
 * errors it backs off (1s → 2s → 4s, cap 30s). A Telegram conflict
 * (HTTP 409 — another process is polling the same bot) logs an error
 * and exits the loop; `start()` should be called in exactly one
 * daemon instance per token.
 *
 * ## Test injection
 *
 * {@link createTelegramChannel} accepts:
 *   - `apiFactory?: () => TelegramApi` — stub the HTTP layer
 *   - `autoPoll?: boolean` — default `true`; tests set `false` and
 *     drive messages via {@link TelegramChannel._simulateUpdate}.
 */

import {
  newId,
  type AutonomyMode,
  type Directive,
  type Intent,
  type OutboundMessage,
} from '@factory5/core';
import type { Logger } from '@factory5/logger';
import { openDatabase, pendingQuestions, type Database } from '@factory5/state';
import { z } from 'zod';

import { FACTORY_SUBCOMMANDS, type FactorySubcommand } from './discord-commands.js';
import {
  PROJECT_LANGUAGES,
  runBudget,
  runBuild,
  runCancel,
  runFindings,
  runResume,
  runSpend,
  runStatus,
  type BudgetData,
  type BuildData,
  type BuildInput,
  type CancelData,
  type CancelInput,
  type CommandHandlerContext,
  type CommandResult,
  type FindingsData,
  type FindingsInput,
  type ProjectLanguage,
  type ResumeData,
  type ResumeInput,
  type SpendData,
  type SpendInput,
  type StatusData,
  type StatusInput,
  type BudgetInput,
} from './command-handlers.js';
import type { ChannelContext, ChannelPlugin, SendResult } from './types.js';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export const telegramConfigSchema = z.object({
  /** Bot token from @BotFather. Required. */
  botToken: z.string().min(1, 'channels.telegram.botToken is required'),
  /**
   * Allow-list of chat ids. Empty / omitted ⇒ any chat the bot can reach.
   * Private chats: the starter's id. Groups / supergroups: the group's
   * (negative) id. Channels: the channel id.
   */
  allowedChatIds: z.array(z.number().int()).default([]),
  /**
   * Prefix for build directives — same shape as Discord.
   * `/build <name>` or `/build <name> -- <spec>`.
   */
  buildPrefix: z.string().default('/build'),
  /**
   * Long-poll timeout passed to `getUpdates` in seconds. 0 disables
   * long-polling (every request returns immediately). 30s is Telegram's
   * sweet spot — connection stays open until an update arrives or the
   * window expires.
   */
  pollTimeoutSec: z.number().int().min(0).max(60).default(30),
  /**
   * Recorded at HALT clearance (7c.1) and preserved so live tests can
   * target the known-good chat directly. Not read by the runtime.
   */
  testChatId: z.number().int().optional(),
});

export type TelegramConfig = z.infer<typeof telegramConfigSchema>;

// ---------------------------------------------------------------------------
// Telegram API — partial shapes (only what we consume)
// ---------------------------------------------------------------------------

/**
 * Shape of a single message in a Telegram `Update`. The Bot API returns
 * far more fields than this — we only type what the plugin reads.
 */
export interface TelegramMessage {
  message_id: number;
  from?: {
    id: number;
    is_bot: boolean;
    username?: string;
    first_name?: string;
  };
  chat: {
    id: number;
    type: 'private' | 'group' | 'supergroup' | 'channel';
    title?: string;
    username?: string;
  };
  date: number;
  text?: string;
  entities?: ReadonlyArray<{
    type: string;
    offset: number;
    length: number;
    user?: { id: number };
  }>;
  reply_to_message?: {
    message_id: number;
    from?: { id: number; is_bot: boolean };
  };
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
}

export interface TelegramBotIdentity {
  id: number;
  is_bot: true;
  username: string;
  first_name?: string;
}

/**
 * One entry in the bot's BotFather command list — what `setMyCommands`
 * registers and `/` autocomplete shows the operator. `command` is the
 * lowercase command name without the leading slash; `description` shows
 * up next to it in the menu.
 */
export interface TelegramBotCommandSpec {
  command: string;
  description: string;
}

/**
 * Minimal contract the plugin uses against the Bot API. The default
 * implementation wraps `fetch`; tests supply a stub that queues updates
 * in-memory and records outbound calls.
 */
export interface TelegramApi {
  getMe(): Promise<TelegramBotIdentity>;
  getUpdates(opts: {
    offset?: number;
    timeoutSec: number;
    allowedUpdates?: ReadonlyArray<string>;
    signal: AbortSignal;
  }): Promise<ReadonlyArray<TelegramUpdate>>;
  sendMessage(opts: {
    chatId: number;
    text: string;
    replyToMessageId?: number;
    /**
     * Telegram's `parse_mode`. `HTML` is the safer of the two formatting
     * modes — only `<`, `>`, `&` need escaping inside text — so the slash
     * dispatcher uses it for tabular replies. `MarkdownV2` is supported
     * by the API but not used by this plugin yet.
     */
    parseMode?: 'HTML' | 'MarkdownV2';
  }): Promise<{ message_id: number }>;
  /**
   * Register the bot's command list (Phase 2.2). Optional in the contract
   * so test stubs can omit it; the plugin treats `undefined` as "skip
   * registration on start". The default HTTP impl always provides it.
   */
  setMyCommands?: (opts: { commands: ReadonlyArray<TelegramBotCommandSpec> }) => Promise<true>;
}

export type TelegramApiFactory = (botToken: string) => TelegramApi;

// ---------------------------------------------------------------------------
// Default HTTP impl
// ---------------------------------------------------------------------------

const TELEGRAM_API_BASE = 'https://api.telegram.org';

interface TelegramResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
}

async function callTelegram<T>(
  botToken: string,
  method: string,
  params: Record<string, unknown> | undefined,
  signal: AbortSignal | undefined,
  networkTimeoutMs: number,
): Promise<T> {
  const url = `${TELEGRAM_API_BASE}/bot${botToken}/${method}`;
  // POST with an empty {} when no params — Telegram accepts either. This
  // sidesteps TS's exactOptionalPropertyTypes on `RequestInit.body`.
  const body = JSON.stringify(params ?? {});
  const controller = new AbortController();
  const onAbort = (): void => controller.abort(signal?.reason);
  if (signal !== undefined) {
    if (signal.aborted) controller.abort(signal.reason);
    else signal.addEventListener('abort', onAbort, { once: true });
  }
  const timer = setTimeout(
    () => controller.abort(new Error('telegram: request timeout')),
    networkTimeoutMs,
  );
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      signal: controller.signal,
    });
    const json = (await res.json()) as TelegramResponse<T>;
    if (!json.ok || json.result === undefined) {
      throw new Error(
        `telegram: ${method} failed (code=${String(json.error_code ?? res.status)}): ${json.description ?? res.statusText}`,
      );
    }
    return json.result;
  } finally {
    clearTimeout(timer);
    if (signal !== undefined) signal.removeEventListener('abort', onAbort);
  }
}

/** Default factory — returns a {@link TelegramApi} that hits api.telegram.org. */
export function defaultTelegramApiFactory(botToken: string): TelegramApi {
  return {
    async getMe() {
      return callTelegram<TelegramBotIdentity>(botToken, 'getMe', undefined, undefined, 10_000);
    },
    async getUpdates({ offset, timeoutSec, allowedUpdates, signal }) {
      // Telegram caps long-poll at 50s; round-trip budget is +10s.
      const networkBudgetMs = (timeoutSec + 10) * 1000;
      const params: Record<string, unknown> = { timeout: timeoutSec };
      if (offset !== undefined) params['offset'] = offset;
      if (allowedUpdates !== undefined) params['allowed_updates'] = allowedUpdates;
      return callTelegram<ReadonlyArray<TelegramUpdate>>(
        botToken,
        'getUpdates',
        params,
        signal,
        networkBudgetMs,
      );
    },
    async sendMessage({ chatId, text, replyToMessageId, parseMode }) {
      const params: Record<string, unknown> = { chat_id: chatId, text };
      if (replyToMessageId !== undefined) params['reply_to_message_id'] = replyToMessageId;
      if (parseMode !== undefined) params['parse_mode'] = parseMode;
      return callTelegram<{ message_id: number }>(
        botToken,
        'sendMessage',
        params,
        undefined,
        10_000,
      );
    },
    async setMyCommands({ commands }) {
      return callTelegram<true>(botToken, 'setMyCommands', { commands }, undefined, 10_000);
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse `targetRef` into `{ chatId, replyToMessageId? }`. Accepts
 * `<chatId>` or `<chatId>#<messageId>`. Throws on non-integer chat id.
 */
export function parseTelegramRef(ref: string): { chatId: number; replyToMessageId?: number } {
  const hashIdx = ref.indexOf('#');
  const chatStr = hashIdx < 0 ? ref : ref.slice(0, hashIdx);
  const replyStr = hashIdx < 0 ? '' : ref.slice(hashIdx + 1);
  const chatId = Number.parseInt(chatStr, 10);
  if (!Number.isFinite(chatId) || String(chatId) !== chatStr.trim()) {
    throw new Error(`telegram: invalid chat id in ref ${JSON.stringify(ref)}`);
  }
  if (replyStr.length === 0) return { chatId };
  const replyToMessageId = Number.parseInt(replyStr, 10);
  if (!Number.isFinite(replyToMessageId) || String(replyToMessageId) !== replyStr) {
    throw new Error(`telegram: invalid reply-to id in ref ${JSON.stringify(ref)}`);
  }
  return { chatId, replyToMessageId };
}

/**
 * Compute the `channelRef` for a directive originating from this Telegram
 * message: `<chatId>#<messageId>` so follow-up replies can be threaded
 * back to it via `reply_to_message_id`. Named distinctly from Discord's
 * `channelRefFor` to avoid a barrel-export name collision.
 */
export function telegramChannelRefFor(message: TelegramMessage): string {
  return `${String(message.chat.id)}#${String(message.message_id)}`;
}

/**
 * Strip a leading `@<username>` mention from the message text. Discord
 * strips `<@id>`; Telegram's equivalent is `@<bot_username>`. Named
 * distinctly from Discord's helper to avoid a barrel-export name
 * collision.
 */
export function stripTelegramMention(text: string, botUsername: string): string {
  const mention = `@${botUsername}`;
  let out = text.trim();
  if (out.toLowerCase().startsWith(mention.toLowerCase())) {
    out = out.slice(mention.length).trim();
  }
  return out;
}

/**
 * Decide whether a group / supergroup message is directed at the bot.
 * True iff it either:
 *   - has a `mention` entity whose text matches `@<botUsername>`, or
 *   - has a `text_mention` entity pointing at the bot id, or
 *   - is a direct reply to a bot message.
 */
export function isDirectedAtBot(
  message: TelegramMessage,
  botId: number,
  botUsername: string,
): boolean {
  const text = message.text ?? '';
  const entities = message.entities ?? [];
  for (const e of entities) {
    if (e.type === 'mention') {
      const slice = text.slice(e.offset, e.offset + e.length);
      if (slice.toLowerCase() === `@${botUsername.toLowerCase()}`) return true;
    }
    if (e.type === 'text_mention' && e.user?.id === botId) return true;
  }
  if (message.reply_to_message?.from?.id === botId) return true;
  return false;
}

/**
 * Sleep that resolves early if the signal aborts. Returns `true` if
 * completed, `false` if aborted.
 */
function delayOrAbort(ms: number, signal: AbortSignal): Promise<boolean> {
  if (ms <= 0) return Promise.resolve(!signal.aborted);
  if (signal.aborted) return Promise.resolve(false);
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve(true);
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      resolve(false);
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

// ---------------------------------------------------------------------------
// Channel plugin
// ---------------------------------------------------------------------------

export interface TelegramChannelOptions {
  /** Override the Telegram API client (tests). */
  apiFactory?: TelegramApiFactory;
  /**
   * If `false`, `start()` does not launch the long-polling loop. Tests
   * use this to drive updates via {@link TelegramChannel._simulateUpdate}.
   * Default `true`.
   */
  autoPoll?: boolean;
  /**
   * Database accessor. Normally the plugin opens the default factory db
   * inside `start()`; tests pass an explicit handle. Same shape as
   * DiscordChannelOptions.
   */
  db?: Database;
}

export class TelegramChannel implements ChannelPlugin {
  readonly id = 'telegram' as const;
  readonly capabilities = {
    inbound: true,
    outbound: true,
    threading: true,
    interactive: true,
    fileAttachments: false,
  };
  readonly configSchema = telegramConfigSchema;

  private readonly apiFactory: TelegramApiFactory;
  private readonly autoPoll: boolean;
  private readonly externalDb: Database | undefined;

  private api: TelegramApi | undefined;
  private config: TelegramConfig | undefined;
  private botIdentity: TelegramBotIdentity | undefined;
  private log: Logger | undefined;
  private onInbound: ChannelContext['onInbound'] | undefined;
  private resolveProjectPath: ChannelContext['resolveProjectPath'] | undefined;
  private resolveBuildLimits: ChannelContext['resolveBuildLimits'] | undefined;
  private setProjectBudget: ChannelContext['setProjectBudget'] | undefined;
  private db: Database | undefined;
  private ownsDb = false;
  private abortController: AbortController | undefined;
  private pollPromise: Promise<void> | undefined;
  private offset: number | undefined;
  private ready = false;

  constructor(opts: TelegramChannelOptions = {}) {
    this.apiFactory = opts.apiFactory ?? defaultTelegramApiFactory;
    this.autoPoll = opts.autoPoll ?? true;
    this.externalDb = opts.db;
  }

  async start(ctx: ChannelContext, rawConfig: unknown): Promise<void> {
    this.log = ctx.log;
    this.onInbound = ctx.onInbound;
    this.resolveProjectPath = ctx.resolveProjectPath;
    this.resolveBuildLimits = ctx.resolveBuildLimits;
    this.setProjectBudget = ctx.setProjectBudget;
    this.config = telegramConfigSchema.parse(rawConfig);

    if (this.externalDb !== undefined) {
      this.db = this.externalDb;
    } else {
      this.db = openDatabase();
      this.ownsDb = true;
    }

    this.api = this.apiFactory(this.config.botToken);
    this.botIdentity = await this.api.getMe();
    this.log.info(
      { username: this.botIdentity.username, botId: this.botIdentity.id },
      'telegram: identity verified',
    );

    // Phase 2.2 — register the bot's BotFather command list. Tests with
    // stubs that omit `setMyCommands` skip silently; the default HTTP
    // factory always provides it. Failures here are logged but do not
    // abort start() — the inbound parser still recognises the seven
    // commands even if the `/` autocomplete menu is stale.
    if (this.api.setMyCommands !== undefined) {
      try {
        await this.api.setMyCommands({ commands: FACTORY_TELEGRAM_COMMANDS });
        this.log.info(
          { count: FACTORY_TELEGRAM_COMMANDS.length },
          'telegram: setMyCommands registered',
        );
      } catch (err) {
        this.log.error(
          { err },
          'telegram: setMyCommands failed; `/` menu will be stale until next start',
        );
      }
    }

    this.abortController = new AbortController();
    if (this.autoPoll) {
      this.pollPromise = this.runPollLoop();
    }
    this.ready = true;
  }

  async stop(): Promise<void> {
    this.ready = false;
    this.abortController?.abort();
    if (this.pollPromise !== undefined) {
      try {
        await this.pollPromise;
      } catch (err) {
        this.log?.warn({ err }, 'telegram: poll loop rejected on stop');
      }
      this.pollPromise = undefined;
    }
    if (this.ownsDb && this.db !== undefined) {
      this.db.close();
    }
    this.db = undefined;
    this.api = undefined;
    this.abortController = undefined;
    this.log?.info('telegram: stopped');
  }

  async send(msg: OutboundMessage): Promise<SendResult> {
    if (!this.ready || this.api === undefined) {
      return { delivered: false, error: 'telegram: not ready' };
    }
    let parsed: { chatId: number; replyToMessageId?: number };
    try {
      parsed = parseTelegramRef(msg.targetRef);
    } catch (err) {
      return {
        delivered: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
    try {
      const result = await this.api.sendMessage({
        chatId: parsed.chatId,
        text: msg.text,
        ...(parsed.replyToMessageId !== undefined
          ? { replyToMessageId: parsed.replyToMessageId }
          : {}),
      });
      return { delivered: true, externalId: String(result.message_id) };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.log?.warn({ err, targetRef: msg.targetRef }, 'telegram: send threw');
      return { delivered: false, error: message };
    }
  }

  // ---- inbound ----

  /** Long-polling loop. Exits cleanly on abort; logs + backs off on errors. */
  private async runPollLoop(): Promise<void> {
    if (
      this.api === undefined ||
      this.config === undefined ||
      this.abortController === undefined ||
      this.log === undefined
    ) {
      return;
    }
    const signal = this.abortController.signal;
    let backoffMs = 0;
    while (!signal.aborted) {
      if (backoffMs > 0) {
        const cont = await delayOrAbort(backoffMs, signal);
        if (!cont) break;
      }
      try {
        const updates = await this.api.getUpdates({
          ...(this.offset !== undefined ? { offset: this.offset } : {}),
          timeoutSec: this.config.pollTimeoutSec,
          allowedUpdates: ['message'],
          signal,
        });
        backoffMs = 0;
        for (const update of updates) {
          try {
            await this.handleUpdate(update);
          } catch (err) {
            this.log.error({ err, updateId: update.update_id }, 'telegram: handleUpdate threw');
          }
          this.offset = update.update_id + 1;
        }
      } catch (err) {
        if (signal.aborted) break;
        const prev = backoffMs;
        backoffMs = Math.min(prev > 0 ? prev * 2 : 1000, 30_000);
        this.log.warn({ err, backoffMs }, 'telegram: getUpdates failed — backing off');
      }
    }
    this.log.info('telegram: poll loop exited');
  }

  private async handleUpdate(update: TelegramUpdate): Promise<void> {
    const message = update.message;
    if (message === undefined) return; // edited / non-message updates ignored for now
    await this.handleMessage(message);
  }

  private async handleMessage(message: TelegramMessage): Promise<void> {
    if (
      this.log === undefined ||
      this.config === undefined ||
      this.botIdentity === undefined ||
      this.db === undefined ||
      this.onInbound === undefined
    ) {
      return;
    }
    // Ignore messages from bots (including our own echoes).
    if (message.from?.is_bot === true) return;
    // Text-only for now; attachments are surfaced later.
    if (message.text === undefined || message.text.length === 0) return;

    // Chat allow-list (empty = anyone).
    const allowed = this.config.allowedChatIds;
    if (allowed.length > 0 && !allowed.includes(message.chat.id)) {
      this.log.debug({ chatId: message.chat.id }, 'telegram: chat not in allowlist — ignoring');
      return;
    }

    // Group-chat scoping: only process messages directed at the bot.
    const botId = this.botIdentity.id;
    const botUsername = this.botIdentity.username;
    const isPrivate = message.chat.type === 'private';
    if (!isPrivate && !isDirectedAtBot(message, botId, botUsername)) {
      return;
    }

    const strippedText = stripTelegramMention(message.text, botUsername);

    // Reply to a bot message with an open pending question ⇒ answer path.
    if (await this.maybeAnswerPendingQuestion(message, strippedText)) return;

    // Phase 2.2 — slash-command dispatch. Recognises the seven
    // FACTORY_SUBCOMMANDS shared with Discord (`/status`, `/spend`,
    // `/findings`, `/resume`, `/cancel`, `/budget`, `/build`). When the
    // text is a known command the shared handler runs and the bot replies
    // directly via `sendMessage` — the brain isn't involved for read
    // commands. `/build` enqueues a directive via `runBuild` (same shape
    // as the legacy parser produced) AND emits a confirmation reply.
    const slash = parseSlashCommand(strippedText);
    if (slash !== undefined) {
      await this.dispatchSlashCommand(message, slash.cmd, slash.argsText);
      return;
    }

    // Fallback: chat-intent for any non-slash text. Phase 2.5 will route
    // chat-classified-as-status / spend / findings through the shared
    // handlers too; today the brain's triage handles the chat directive.
    const principal =
      message.from !== undefined ? String(message.from.id) : `chat:${String(message.chat.id)}`;
    const channelRef = telegramChannelRefFor(message);
    const directive: Directive = {
      id: newId(),
      source: 'telegram',
      principal,
      channelRef,
      intent: 'chat' satisfies Intent,
      payload: { text: strippedText },
      autonomy: 'chat',
      createdAt: new Date().toISOString(),
      status: 'pending',
    };

    try {
      await this.onInbound(directive);
      this.log.info(
        {
          directiveId: directive.id,
          intent: directive.intent,
          channelRef,
          principal,
          chatType: message.chat.type,
        },
        'telegram: inbound directive',
      );
    } catch (err) {
      this.log.error({ err, directiveId: directive.id }, 'telegram: onInbound threw');
    }
  }

  // ---- slash-command dispatch (Phase 2.2) ----

  /**
   * Run a shared command handler against the message and post the
   * formatted reply back to the chat. Read commands (`status`, `spend`,
   * `findings`) use HTML mode with `<pre>` blocks for tables; mutation
   * commands (`build`, `resume`, `cancel`, `budget`) use plain text.
   *
   * Failure paths are uniform: anything thrown by the handler becomes a
   * `factory <cmd>: error: <message>` plain-text reply. The shared
   * handler's structured `CommandResult.ok = false` failures (NOT_FOUND,
   * AMBIGUOUS, INVALID_INPUT, …) are formatted the same way — no need
   * for the transport to branch on `code` today.
   */
  private async dispatchSlashCommand(
    message: TelegramMessage,
    cmd: FactorySubcommand,
    argsText: string,
  ): Promise<void> {
    if (
      this.db === undefined ||
      this.log === undefined ||
      this.api === undefined ||
      this.onInbound === undefined
    ) {
      return;
    }
    const principal =
      message.from !== undefined ? String(message.from.id) : `chat:${String(message.chat.id)}`;
    const channelRef = telegramChannelRefFor(message);
    const ctx: CommandHandlerContext = {
      db: this.db,
      log: this.log,
      source: 'telegram',
      principal,
      channelRef,
      onInbound: this.onInbound,
      resolveProjectPath: this.resolveProjectPath,
      resolveBuildLimits: this.resolveBuildLimits,
      setProjectBudget: this.setProjectBudget,
    };

    let reply: TelegramReply;
    try {
      reply = await this.runCommand(ctx, cmd, argsText);
    } catch (err) {
      this.log.error(
        { err, cmd, chatId: message.chat.id, principal },
        'telegram: slash handler threw',
      );
      reply = {
        text: `factory ${cmd}: error: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    void this.api
      .sendMessage({
        chatId: message.chat.id,
        text: reply.text,
        replyToMessageId: message.message_id,
        ...(reply.parseMode !== undefined ? { parseMode: reply.parseMode } : {}),
      })
      .catch((err: unknown) => {
        this.log?.warn({ err, cmd, chatId: message.chat.id }, 'telegram: slash reply send failed');
      });
  }

  private async runCommand(
    ctx: CommandHandlerContext,
    cmd: FactorySubcommand,
    argsText: string,
  ): Promise<TelegramReply> {
    switch (cmd) {
      case 'status':
        return formatStatusReply(await runStatus(ctx, parseStatusArgs(argsText)));
      case 'spend':
        return formatSpendReply(await runSpend(ctx, parseSpendArgs(argsText)));
      case 'findings':
        return formatFindingsReply(await runFindings(ctx, parseFindingsArgs(argsText)));
      case 'resume': {
        const input = parseResumeArgs(argsText);
        if (input === undefined) return usageReply('resume', '/resume <project>');
        return formatResumeReply(await runResume(ctx, input));
      }
      case 'cancel': {
        const input = parseCancelArgs(argsText);
        if (input === undefined) return usageReply('cancel', '/cancel <directive-id> [reason]');
        return formatCancelReply(await runCancel(ctx, input));
      }
      case 'budget': {
        const input = parseBudgetArgs(argsText);
        if (input === undefined) {
          return usageReply(
            'budget',
            '/budget <project> [--max-usd N] [--max-steps M]  (omit both to clear)',
          );
        }
        return formatBudgetReply(await runBudget(ctx, input));
      }
      case 'build': {
        const input = parseBuildArgs(argsText);
        if (input === undefined) {
          return usageReply(
            'build',
            '/build <project> [-- <spec>] [--autonomy chat|assisted|autonomous] [--language python|node|go|rust] [--max-usd N] [--max-steps M]',
          );
        }
        return formatBuildReply(await runBuild(ctx, input));
      }
    }
  }

  /**
   * If the message replies to a bot message that is the "trigger" of an
   * open pending question (we match via the directive's `channelRef`
   * suffix), record the message text as the answer and acknowledge back
   * into the chat. Returns `true` if it handled the message as an answer.
   */
  private async maybeAnswerPendingQuestion(
    message: TelegramMessage,
    text: string,
  ): Promise<boolean> {
    if (this.db === undefined || this.api === undefined || this.log === undefined) return false;
    const replyTo = message.reply_to_message;
    if (replyTo === undefined) return false;
    // I012: prefer the exact bot-message-id rung. The outbound worker stamps
    // `pending_questions.bot_message_id` with the provider's message_id on
    // delivery, so when the operator uses Telegram's Reply feature on a
    // specific bot question we can pin to that exact question even when
    // multiple are open in the same chat. Falls through to the legacy
    // channel_ref / LIKE rungs for pre-migration-008 rows or for outbounds
    // whose delivery succeeded before they could be stamped.
    let row: { id: string; directiveId: string } | undefined;
    const targeted = pendingQuestions.findOpenByBotMessageId(
      this.db,
      'telegram',
      String(replyTo.message_id),
    );
    if (targeted !== undefined) {
      row = { id: targeted.id, directiveId: targeted.directiveId };
    } else {
      const candidateRef = `${String(message.chat.id)}#${String(replyTo.message_id)}`;
      // Also match by chat id alone — a pending question can be attached to
      // the whole chat if the directive was triggered without a known
      // message id. (`LIKE '<chatId>#%'` matches any message in that chat.)
      const rows = this.db
        .prepare(
          `SELECT id, directive_id AS directiveId
             FROM pending_questions
            WHERE channel = 'telegram'
              AND (channel_ref = ? OR channel_ref LIKE ?)
              AND answered_at IS NULL
            ORDER BY created_at ASC
            LIMIT 1`,
        )
        .all(candidateRef, `${String(message.chat.id)}#%`) as Array<{
        id: string;
        directiveId: string;
      }>;
      row = rows[0];
    }
    if (row === undefined) return false;
    pendingQuestions.answer(this.db, row.id, text, new Date().toISOString());
    this.log.info(
      { questionId: row.id, directiveId: row.directiveId, chatId: message.chat.id },
      'telegram: answered pending question from reply',
    );
    // ADR 0024 §4 — see equivalent check in discord.ts. If the linked task
    // is already terminal (orphaned by brain restart, etc.), preserve the
    // answer for forensic value but log loudly so the operator knows the
    // build didn't resume.
    const orphan = pendingQuestions.detectOrphanedAnswer(this.db, row.id);
    if (orphan !== undefined) {
      this.log.warn(
        {
          questionId: row.id,
          taskId: orphan.taskId,
          taskStatus: orphan.taskStatus,
          chatId: message.chat.id,
        },
        'telegram: answer recorded for question whose task is terminal — no consumer remains',
      );
    }
    // Fire-and-forget ack.
    void this.api
      .sendMessage({
        chatId: message.chat.id,
        text: `(answered question ${row.id})`,
        replyToMessageId: message.message_id,
      })
      .catch((err: unknown) => {
        this.log?.warn({ err, questionId: row.id }, 'telegram: answer ack failed');
      });
    return true;
  }

  /** Test helper: feed an update through the handler path directly. */
  async _simulateUpdate(update: TelegramUpdate): Promise<void> {
    await this.handleUpdate(update);
  }

  /** Test helper: read the current polling offset. */
  _getOffset(): number | undefined {
    return this.offset;
  }
}

/** Factory: returns a fresh Telegram plugin instance. */
export function createTelegramChannel(opts?: TelegramChannelOptions): TelegramChannel {
  return new TelegramChannel(opts);
}

// Re-export a precise Zod type alias so consumers can statically refer to
// the validated config (mirrors discord.ts).
export type { TelegramConfig as TelegramPluginConfig };

// ---------------------------------------------------------------------------
// Slash-command support (Phase 2.2)
// ---------------------------------------------------------------------------

/**
 * Telegram BotFather command list — registered via `setMyCommands` on
 * `start()` so the bot's `/` autocomplete shows the operator the same
 * vocabulary as Discord's `/factory` slash menu. Telegram caps each
 * description at 256 chars; ours stay well under.
 */
export const FACTORY_TELEGRAM_COMMANDS: ReadonlyArray<TelegramBotCommandSpec> = [
  { command: 'status', description: 'list active and recent directives' },
  { command: 'spend', description: 'cross-session spend rollup' },
  { command: 'findings', description: 'list registry findings' },
  { command: 'resume', description: 'resume a stopped build — /resume <project>' },
  { command: 'cancel', description: 'cancel a directive — /cancel <id> [reason]' },
  {
    command: 'budget',
    description: 'set project budget — /budget <project> [--max-usd N --max-steps M]',
  },
  { command: 'build', description: 'kick off a build — /build <project> [-- <spec>]' },
];

/** Reply payload returned by the Telegram-side formatter. */
interface TelegramReply {
  text: string;
  parseMode?: 'HTML';
}

/**
 * Recognise `/<cmd>[@bot] [args]`. Returns `undefined` when the text is
 * not a slash command or `<cmd>` is not one of the seven we handle —
 * the caller falls through to the chat-intent path.
 */
export function parseSlashCommand(
  text: string,
): { cmd: FactorySubcommand; argsText: string } | undefined {
  const trimmed = text.trim();
  if (!trimmed.startsWith('/')) return undefined;
  const match = /^\/(\w+)(?:@\S+)?(?:\s+([\s\S]*))?$/.exec(trimmed);
  if (match === null) return undefined;
  const cmd = match[1]!.toLowerCase();
  const argsText = match[2] ?? '';
  if (!(FACTORY_SUBCOMMANDS as readonly string[]).includes(cmd)) return undefined;
  return { cmd: cmd as FactorySubcommand, argsText };
}

/**
 * Tokenise `[--key value]... [positional...] [-- rest]` into a
 * structured `ParsedFlags`. The literal `--` token (alone) splits flags
 * from a free-form trailing payload — we use this for `/build <p> --
 * <spec>`. A flag without a value is recorded as the empty string.
 */
interface ParsedFlags {
  positional: string[];
  flags: Record<string, string>;
  rest?: string;
}

export function parseFlags(text: string): ParsedFlags {
  const tokens = text
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0);
  const positional: string[] = [];
  const flags: Record<string, string> = {};
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i]!;
    if (t === '--') {
      const rest = tokens.slice(i + 1).join(' ');
      return rest.length > 0 ? { positional, flags, rest } : { positional, flags };
    }
    if (t.startsWith('--')) {
      const key = t.slice(2);
      const next = tokens[i + 1];
      if (next === undefined || next === '--' || next.startsWith('--')) {
        flags[key] = '';
        i += 1;
      } else {
        flags[key] = next;
        i += 2;
      }
    } else {
      positional.push(t);
      i += 1;
    }
  }
  return { positional, flags };
}

// ---- per-command argument parsers ----

function parseStatusArgs(text: string): StatusInput {
  const { positional, flags } = parseFlags(text);
  const raw = flags['limit'] ?? positional[0];
  if (raw === undefined) return {};
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return {};
  return { limit: n };
}

function parseSpendArgs(text: string): SpendInput {
  const { flags } = parseFlags(text);
  const groupBy = flags['group-by'];
  const project = flags['project'];
  return {
    ...(groupBy !== undefined && groupBy.length > 0 ? { groupBy } : {}),
    ...(project !== undefined && project.length > 0 ? { project } : {}),
  };
}

function parseFindingsArgs(text: string): FindingsInput {
  const { flags } = parseFlags(text);
  return {
    ...(flags['project'] !== undefined && flags['project'].length > 0
      ? { project: flags['project'] }
      : {}),
    ...(flags['severity'] !== undefined && flags['severity'].length > 0
      ? { severity: flags['severity'] }
      : {}),
    ...(flags['status'] !== undefined && flags['status'].length > 0
      ? { status: flags['status'] }
      : {}),
  };
}

function parseResumeArgs(text: string): ResumeInput | undefined {
  const { positional } = parseFlags(text);
  const project = positional[0];
  if (project === undefined || project.length === 0) return undefined;
  return { project };
}

function parseCancelArgs(text: string): CancelInput | undefined {
  const { positional } = parseFlags(text);
  const directiveId = positional[0];
  if (directiveId === undefined || directiveId.length === 0) return undefined;
  const reason = positional.slice(1).join(' ').trim();
  return reason.length > 0 ? { directiveId, reason } : { directiveId };
}

function parseBudgetArgs(text: string): BudgetInput | undefined {
  const { positional, flags } = parseFlags(text);
  const project = positional[0];
  if (project === undefined || project.length === 0) return undefined;
  const maxUsd = flags['max-usd'] !== undefined ? Number.parseFloat(flags['max-usd']) : undefined;
  const maxSteps =
    flags['max-steps'] !== undefined ? Number.parseInt(flags['max-steps'], 10) : undefined;
  return {
    project,
    ...(maxUsd !== undefined && Number.isFinite(maxUsd) && maxUsd > 0 ? { maxUsd } : {}),
    ...(maxSteps !== undefined && Number.isFinite(maxSteps) && maxSteps > 0 ? { maxSteps } : {}),
  };
}

function parseBuildArgs(text: string): BuildInput | undefined {
  const { positional, flags, rest } = parseFlags(text);
  const project = positional[0];
  if (project === undefined || project.length === 0) return undefined;
  // `--spec` flag wins over `-- <rest>` separator (operator chose the form).
  const spec = flags['spec'] !== undefined && flags['spec'].length > 0 ? flags['spec'] : rest;
  const autonomyRaw = flags['autonomy'];
  const autonomy =
    autonomyRaw === 'chat' || autonomyRaw === 'assisted' || autonomyRaw === 'autonomous'
      ? (autonomyRaw as AutonomyMode)
      : undefined;
  const languageRaw = flags['language'];
  const language = isLanguageString(languageRaw) ? languageRaw : undefined;
  const maxUsd = flags['max-usd'] !== undefined ? Number.parseFloat(flags['max-usd']) : undefined;
  const maxSteps =
    flags['max-steps'] !== undefined ? Number.parseInt(flags['max-steps'], 10) : undefined;
  return {
    project,
    ...(spec !== undefined && spec.length > 0 ? { spec } : {}),
    ...(autonomy !== undefined ? { autonomy } : {}),
    ...(language !== undefined ? { language } : {}),
    ...(maxUsd !== undefined && Number.isFinite(maxUsd) && maxUsd > 0 ? { maxUsd } : {}),
    ...(maxSteps !== undefined && Number.isFinite(maxSteps) && maxSteps > 0 ? { maxSteps } : {}),
  };
}

function isLanguageString(value: string | undefined): value is ProjectLanguage {
  return value !== undefined && (PROJECT_LANGUAGES as readonly string[]).includes(value);
}

// ---- per-command formatters (Telegram replies) ----

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function preBlock(content: string): string {
  return `<pre>${escapeHtml(content)}</pre>`;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

function firstLine(s: string): string {
  const nl = s.indexOf('\n');
  return nl < 0 ? s : s.slice(0, nl);
}

function truncatePath(p: string): string {
  if (p.length <= 56) return p;
  const sepIdx = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  if (sepIdx < 0) return truncate(p, 56);
  const tail = p.slice(sepIdx);
  const headBudget = Math.max(8, 56 - tail.length - 3);
  return `${p.slice(0, headBudget)}…${tail}`;
}

function usageReply(cmd: FactorySubcommand, usage: string): TelegramReply {
  return { text: `factory ${cmd}: ${usage}` };
}

function formatStatusReply(data: StatusData): TelegramReply {
  const sections: string[] = ['<b>factory status</b>'];

  if (data.projects.length === 0) {
    sections.push('<b>Projects</b> — <i>(none registered)</i>');
  } else {
    const lines: string[] = [];
    for (const p of data.projects.slice(0, 8)) {
      lines.push(
        `• <code>${escapeHtml(p.name)}</code> — ${escapeHtml(p.status)} — ${escapeHtml(truncatePath(p.workspacePath))}`,
      );
    }
    if (data.projects.length > 8) {
      lines.push(`<i>…and ${(data.projects.length - 8).toString()} more</i>`);
    }
    sections.push(`<b>Projects</b> (${data.projects.length.toString()})\n${lines.join('\n')}`);
  }

  if (data.recent.length === 0) {
    sections.push('<b>Recent directives</b> — <i>(none yet)</i>');
  } else {
    const tableLines: string[] = [];
    tableLines.push(
      `${'id'.padEnd(8)}  ${'status'.padEnd(8)}  ${'intent'.padEnd(11)}  ${'spent'.padStart(9)}  created`,
    );
    for (const e of data.recent) {
      const d = e.directive;
      tableLines.push(
        `${d.id.slice(-8)}  ${d.status.padEnd(8)}  ${d.intent.padEnd(11)}  ${`$${e.spendUsd.toFixed(4)}`.padStart(9)}  ${d.createdAt.slice(0, 19)}Z`,
      );
    }
    sections.push(
      `<b>Recent directives</b> (${data.recent.length.toString()})\n${preBlock(tableLines.join('\n'))}`,
    );
  }

  return { text: sections.join('\n\n'), parseMode: 'HTML' };
}

function formatSpendReply(result: CommandResult<SpendData>): TelegramReply {
  if (!result.ok) return { text: `factory spend: ${result.message}` };
  const data = result.data;
  const tableLines: string[] = [];
  switch (data.groupBy) {
    case 'project':
      renderSpendProjectRows(data.rows, tableLines);
      break;
    case 'directive':
      renderSpendDirectiveRows(data.rows, tableLines);
      break;
    case 'day':
      renderSpendDayRows(data.rows, tableLines);
      break;
    case 'model':
      renderSpendModelRows(data.rows, tableLines);
      break;
  }
  const heading = `<b>factory spend</b> (group-by ${data.groupBy})`;
  if (tableLines.length === 0) {
    return { text: `${heading}\n\n<i>(no spend recorded)</i>`, parseMode: 'HTML' };
  }
  return { text: `${heading}\n\n${preBlock(tableLines.join('\n'))}`, parseMode: 'HTML' };
}

function renderSpendProjectRows(
  rows: ReadonlyArray<{
    display: string;
    directiveCount: number;
    callCount: number;
    totalUsd: number;
  }>,
  out: string[],
): void {
  if (rows.length === 0) return;
  out.push(
    `${'project'.padEnd(28)}  ${'dirs'.padStart(5)}  ${'calls'.padStart(6)}  ${'spent'.padStart(11)}`,
  );
  let totalUsd = 0;
  let totalCalls = 0;
  for (const r of rows) {
    const display = truncate(r.display, 28);
    out.push(
      `${display.padEnd(28)}  ${String(r.directiveCount).padStart(5)}  ${String(r.callCount).padStart(6)}  ${`$${r.totalUsd.toFixed(4)}`.padStart(11)}`,
    );
    totalUsd += r.totalUsd;
    totalCalls += r.callCount;
  }
  out.push(
    `${'TOTAL'.padEnd(28)}  ${''.padStart(5)}  ${String(totalCalls).padStart(6)}  ${`$${totalUsd.toFixed(4)}`.padStart(11)}`,
  );
}

function renderSpendDirectiveRows(
  rows: ReadonlyArray<{
    directiveId: string;
    projectId: string | null;
    projectName: string | null;
    callCount: number;
    totalUsd: number;
    lastCalledAt: string;
  }>,
  out: string[],
): void {
  if (rows.length === 0) return;
  out.push(
    `${'directive'.padEnd(8)}  ${'project'.padEnd(20)}  ${'calls'.padStart(6)}  ${'spent'.padStart(11)}  last`,
  );
  for (const r of rows) {
    const projLabel = r.projectName ?? '(unassigned)';
    const projId = r.projectId !== null ? r.projectId.slice(-4) : '----';
    const proj = truncate(`${projLabel} (…${projId})`, 20);
    out.push(
      `${r.directiveId.slice(-8).padEnd(8)}  ${proj.padEnd(20)}  ${String(r.callCount).padStart(6)}  ${`$${r.totalUsd.toFixed(4)}`.padStart(11)}  ${r.lastCalledAt.slice(0, 19)}Z`,
    );
  }
}

function renderSpendDayRows(
  rows: ReadonlyArray<{ date: string; callCount: number; totalUsd: number }>,
  out: string[],
): void {
  if (rows.length === 0) return;
  out.push(`${'date'.padEnd(11)}  ${'calls'.padStart(6)}  ${'spent'.padStart(11)}`);
  let totalUsd = 0;
  let totalCalls = 0;
  for (const r of rows) {
    out.push(
      `${r.date.padEnd(11)}  ${String(r.callCount).padStart(6)}  ${`$${r.totalUsd.toFixed(4)}`.padStart(11)}`,
    );
    totalUsd += r.totalUsd;
    totalCalls += r.callCount;
  }
  out.push(
    `${'TOTAL'.padEnd(11)}  ${String(totalCalls).padStart(6)}  ${`$${totalUsd.toFixed(4)}`.padStart(11)}`,
  );
}

function renderSpendModelRows(
  rows: ReadonlyArray<{
    provider: string;
    model: string;
    callCount: number;
    totalUsd: number;
  }>,
  out: string[],
): void {
  if (rows.length === 0) return;
  out.push(`${'provider/model'.padEnd(36)}  ${'calls'.padStart(6)}  ${'spent'.padStart(11)}`);
  for (const r of rows) {
    const label = truncate(`${r.provider}/${r.model}`, 36);
    out.push(
      `${label.padEnd(36)}  ${String(r.callCount).padStart(6)}  ${`$${r.totalUsd.toFixed(4)}`.padStart(11)}`,
    );
  }
}

function formatFindingsReply(result: CommandResult<FindingsData>): TelegramReply {
  if (!result.ok) return { text: `factory findings: ${result.message}` };
  const { rows, filters } = result.data;
  const filterParts: string[] = [`status=${filters.status}`];
  if (filters.severity !== undefined) filterParts.push(`severity=${filters.severity}`);
  if (filters.project !== undefined) filterParts.push(`project=${filters.project}`);
  const heading = `<b>factory findings</b> (${filterParts.join(', ')})`;
  if (rows.length === 0) {
    return { text: `${heading}\n\n<i>(no findings match)</i>`, parseMode: 'HTML' };
  }
  const tableLines: string[] = [];
  tableLines.push(
    `${'project'.padEnd(20)}  ${'id'.padEnd(6)}  ${'sev'.padEnd(8)}  ${'status'.padEnd(8)}  source         description`,
  );
  for (const e of rows) {
    const project = truncate(e.projectId.slice(-12), 20);
    const sev = e.finding.advisory === true ? `[adv]${e.finding.severity}` : e.finding.severity;
    const desc = truncate(firstLine(e.finding.description), 60);
    tableLines.push(
      `${project.padEnd(20)}  ${e.finding.id.padEnd(6)}  ${sev.padEnd(8)}  ${e.finding.status.padEnd(8)}  ${e.finding.source.padEnd(13)}  ${desc}`,
    );
  }
  tableLines.push(`(${rows.length.toString()} finding${rows.length === 1 ? '' : 's'})`);
  return { text: `${heading}\n\n${preBlock(tableLines.join('\n'))}`, parseMode: 'HTML' };
}

function formatResumeReply(result: CommandResult<ResumeData>): TelegramReply {
  if (!result.ok) return { text: `factory resume: ${result.message}` };
  const d = result.data;
  return {
    text: [
      `factory resume — queued`,
      `Project: ${d.project}`,
      `Path: ${truncatePath(d.projectPath)}`,
      `Resuming from: ${d.priorId.slice(-8)} (${d.priorStatus})`,
      `New directive: ${d.newDirectiveId.slice(-8)}`,
      ``,
      `The daemon will claim it shortly.`,
    ].join('\n'),
  };
}

function formatCancelReply(result: CommandResult<CancelData>): TelegramReply {
  if (!result.ok) return { text: `factory cancel: ${result.message}` };
  const d = result.data;
  return {
    text: [
      `factory cancel — directive marked blocked`,
      `Directive: ${d.directiveId.slice(-8)}`,
      `Was: ${d.prevStatus}`,
      `Reason: ${d.reason}`,
      ``,
      `(Phase 2.4 will additionally kill running workers within 10 s.)`,
    ].join('\n'),
  };
}

function formatBudgetReply(result: CommandResult<BudgetData>): TelegramReply {
  if (!result.ok) return { text: `factory budget: ${result.message}` };
  const d = result.data;
  const lines: string[] = [
    `factory budget — updated`,
    `Project: ${d.project} (…${d.projectId.slice(-4)})`,
  ];
  if (d.defaults.maxUsd === undefined && d.defaults.maxSteps === undefined) {
    lines.push(`Budget: cleared — directives now run uncapped from this project tier.`);
  } else {
    const parts: string[] = [];
    if (d.defaults.maxUsd !== undefined) parts.push(`max-usd $${d.defaults.maxUsd.toFixed(2)}`);
    if (d.defaults.maxSteps !== undefined)
      parts.push(`max-steps ${d.defaults.maxSteps.toString()}`);
    lines.push(`Budget: ${parts.join(' · ')}`);
  }
  return { text: lines.join('\n') };
}

function formatBuildReply(d: BuildData): TelegramReply {
  const lines: string[] = [
    `factory build — queued`,
    `Project: ${d.project}`,
    `Path: ${d.projectPath !== undefined ? truncatePath(d.projectPath) : '(unresolved — daemon will retry)'}`,
    `Directive: ${d.directiveId.slice(-8)}`,
    `Autonomy: ${d.autonomy}`,
  ];
  if (d.language !== undefined) lines.push(`Language: ${d.language}`);
  if (d.limits !== undefined) {
    const parts: string[] = [];
    if (d.limits.maxUsd !== undefined) parts.push(`max-usd $${d.limits.maxUsd.toFixed(2)}`);
    if (d.limits.maxSteps !== undefined) parts.push(`max-steps ${d.limits.maxSteps.toString()}`);
    lines.push(`Limits: ${parts.join(' · ')}`);
  }
  if (d.spec !== undefined && d.spec.length > 0) {
    lines.push(``, `Spec: ${truncate(d.spec, 800)}`);
  }
  lines.push(``, `The daemon will claim it shortly.`);
  return { text: lines.join('\n') };
}
