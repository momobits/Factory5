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

import { newId, type Directive, type Intent, type OutboundMessage } from '@factory5/core';
import type { Logger } from '@factory5/logger';
import { openDatabase, pendingQuestions, type Database } from '@factory5/state';
import { z } from 'zod';

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
  }): Promise<{ message_id: number }>;
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
    async sendMessage({ chatId, text, replyToMessageId }) {
      const params: Record<string, unknown> = { chat_id: chatId, text };
      if (replyToMessageId !== undefined) params['reply_to_message_id'] = replyToMessageId;
      return callTelegram<{ message_id: number }>(
        botToken,
        'sendMessage',
        params,
        undefined,
        10_000,
      );
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

    const intent = this.detectIntent(strippedText);
    const principal =
      message.from !== undefined ? String(message.from.id) : `chat:${String(message.chat.id)}`;
    const channelRef = telegramChannelRefFor(message);

    const directive: Directive = {
      id: newId(),
      source: 'telegram',
      principal,
      channelRef,
      intent,
      payload: intent === 'build' ? this.parseBuildPayload(strippedText) : { text: strippedText },
      autonomy: intent === 'build' ? 'autonomous' : 'chat',
      createdAt: new Date().toISOString(),
      status: 'pending',
    };

    try {
      await this.onInbound(directive);
      this.log.info(
        {
          directiveId: directive.id,
          intent,
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
    const row = rows[0];
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

  private detectIntent(text: string): Intent {
    const prefix = this.config?.buildPrefix ?? '/build';
    const trimmed = text.trim();
    if (trimmed.toLowerCase().startsWith(prefix.toLowerCase())) return 'build';
    return 'chat';
  }

  private parseBuildPayload(text: string): Record<string, unknown> {
    const prefix = this.config?.buildPrefix ?? '/build';
    const payloadText = text.slice(prefix.length).trim();
    const sepIdx = payloadText.indexOf(' -- ');
    const project = sepIdx < 0 ? payloadText : payloadText.slice(0, sepIdx).trim();
    const spec = sepIdx < 0 ? undefined : payloadText.slice(sepIdx + 4).trim();
    const out: Record<string, unknown> = {};
    if (project.length > 0) out['project'] = project;
    if (spec !== undefined && spec.length > 0) out['spec'] = spec;
    out['text'] = text;
    return out;
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
