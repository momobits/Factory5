/**
 * Unit tests for TelegramChannel. Uses a stub {@link TelegramApi} so the
 * full handler path (config → inbound normalisation → pending-question
 * answer routing → outbound routing) runs without touching api.telegram.org.
 *
 * Polling-loop behaviour is tested separately with `autoPoll: true` and a
 * controllable `getUpdates` queue so we can assert offset discipline.
 */

import { newId, type Directive, type OutboundMessage } from '@factory5/core';
import { initLogger, createLogger } from '@factory5/logger';
import {
  directives as directivesQ,
  openDatabase,
  pendingQuestions,
  runMigrations,
} from '@factory5/state';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import {
  createTelegramChannel,
  isDirectedAtBot,
  parseTelegramRef,
  stripTelegramMention,
  telegramChannelRefFor,
  type TelegramApi,
  type TelegramBotIdentity,
  type TelegramMessage,
  type TelegramUpdate,
} from './telegram.js';

beforeAll(() => {
  initLogger({ processName: 'telegram-test', noFile: true, noConsole: true });
});

// ----------------------- fixtures -----------------------

const BOT_IDENTITY: TelegramBotIdentity = {
  id: 42,
  is_bot: true,
  username: 'Factory5TestBot',
  first_name: 'Factory5',
};

function freshDb(): ReturnType<typeof openDatabase> {
  const db = openDatabase(':memory:');
  runMigrations(db);
  return db;
}

interface StubTelegramApi extends TelegramApi {
  sent: Array<{ chatId: number; text: string; replyToMessageId?: number }>;
  updateQueue: ReadonlyArray<TelegramUpdate>[];
  getUpdatesCalls: Array<{ offset?: number; timeoutSec: number }>;
  failNextGet?: Error;
  failSend?: Error;
}

function makeStubApi(identity: TelegramBotIdentity = BOT_IDENTITY): StubTelegramApi {
  const api: StubTelegramApi = {
    sent: [],
    updateQueue: [],
    getUpdatesCalls: [],
    async getMe() {
      return identity;
    },
    async getUpdates({ offset, timeoutSec, signal }) {
      api.getUpdatesCalls.push({ ...(offset !== undefined ? { offset } : {}), timeoutSec });
      if (api.failNextGet !== undefined) {
        const err = api.failNextGet;
        api.failNextGet = undefined;
        throw err;
      }
      const next = api.updateQueue.shift();
      if (next !== undefined) return next;
      // Long-poll simulation: resolve empty after signal aborts or 5ms, whichever first.
      return new Promise<ReadonlyArray<TelegramUpdate>>((resolve) => {
        const timer = setTimeout(() => {
          signal.removeEventListener('abort', onAbort);
          resolve([]);
        }, 5);
        const onAbort = (): void => {
          clearTimeout(timer);
          resolve([]);
        };
        signal.addEventListener('abort', onAbort, { once: true });
      });
    },
    async sendMessage({ chatId, text, replyToMessageId }) {
      if (api.failSend !== undefined) throw api.failSend;
      api.sent.push({
        chatId,
        text,
        ...(replyToMessageId !== undefined ? { replyToMessageId } : {}),
      });
      return { message_id: api.sent.length };
    },
  };
  return api;
}

function makeMessage(opts: {
  messageId: number;
  text: string;
  chatId: number;
  chatType?: TelegramMessage['chat']['type'];
  fromId?: number;
  fromIsBot?: boolean;
  entities?: TelegramMessage['entities'];
  replyTo?: { messageId: number; fromBotId?: number };
}): TelegramMessage {
  const chatType = opts.chatType ?? 'private';
  const from =
    opts.fromId !== undefined
      ? { id: opts.fromId, is_bot: opts.fromIsBot ?? false, username: `user${String(opts.fromId)}` }
      : undefined;
  const msg: TelegramMessage = {
    message_id: opts.messageId,
    chat: { id: opts.chatId, type: chatType },
    date: 1_700_000_000,
    text: opts.text,
    ...(from !== undefined ? { from } : {}),
    ...(opts.entities !== undefined ? { entities: opts.entities } : {}),
    ...(opts.replyTo !== undefined
      ? {
          reply_to_message: {
            message_id: opts.replyTo.messageId,
            ...(opts.replyTo.fromBotId !== undefined
              ? { from: { id: opts.replyTo.fromBotId, is_bot: true } }
              : {}),
          },
        }
      : {}),
  };
  return msg;
}

// ----------------------- pure helpers -----------------------

describe('parseTelegramRef', () => {
  it('parses a bare chat id', () => {
    expect(parseTelegramRef('1225367797')).toEqual({ chatId: 1225367797 });
  });
  it('parses chat#message compound', () => {
    expect(parseTelegramRef('-1234#56')).toEqual({ chatId: -1234, replyToMessageId: 56 });
  });
  it('treats empty reply tail as bare chat id', () => {
    expect(parseTelegramRef('999#')).toEqual({ chatId: 999 });
  });
  it('throws on a non-integer chat id', () => {
    expect(() => parseTelegramRef('abc')).toThrow(/invalid chat id/);
  });
  it('throws on a non-integer reply id', () => {
    expect(() => parseTelegramRef('999#xyz')).toThrow(/invalid reply-to id/);
  });
});

describe('stripTelegramMention', () => {
  it('strips @<username>', () => {
    expect(stripTelegramMention('@Factory5TestBot hi', 'Factory5TestBot')).toBe('hi');
  });
  it('is case-insensitive', () => {
    expect(stripTelegramMention('@factory5testbot hi', 'Factory5TestBot')).toBe('hi');
  });
  it('leaves body unchanged if no prefix', () => {
    expect(stripTelegramMention('just text', 'Factory5TestBot')).toBe('just text');
  });
});

describe('telegramChannelRefFor', () => {
  it('joins chat id + message id with #', () => {
    const m = makeMessage({ messageId: 7, chatId: 100, text: 'hi', fromId: 1 });
    expect(telegramChannelRefFor(m)).toBe('100#7');
  });
  it('handles negative chat ids (groups)', () => {
    const m = makeMessage({
      messageId: 7,
      chatId: -12345,
      chatType: 'supergroup',
      text: 'hi',
      fromId: 1,
    });
    expect(telegramChannelRefFor(m)).toBe('-12345#7');
  });
});

describe('isDirectedAtBot', () => {
  it('returns true for a @mention entity matching the bot', () => {
    const m = makeMessage({
      messageId: 1,
      chatId: -1,
      chatType: 'supergroup',
      text: '@Factory5TestBot hello',
      fromId: 1,
      entities: [{ type: 'mention', offset: 0, length: 16 }],
    });
    expect(isDirectedAtBot(m, 42, 'Factory5TestBot')).toBe(true);
  });

  it('returns true for a text_mention entity with matching user id', () => {
    const m = makeMessage({
      messageId: 1,
      chatId: -1,
      chatType: 'supergroup',
      text: 'hey bot',
      fromId: 1,
      entities: [{ type: 'text_mention', offset: 4, length: 3, user: { id: 42 } }],
    });
    expect(isDirectedAtBot(m, 42, 'Factory5TestBot')).toBe(true);
  });

  it('returns true for a reply to the bot', () => {
    const m = makeMessage({
      messageId: 2,
      chatId: -1,
      chatType: 'supergroup',
      text: 'yes',
      fromId: 1,
      replyTo: { messageId: 1, fromBotId: 42 },
    });
    expect(isDirectedAtBot(m, 42, 'Factory5TestBot')).toBe(true);
  });

  it('returns false for a plain group message not referencing the bot', () => {
    const m = makeMessage({
      messageId: 3,
      chatId: -1,
      chatType: 'supergroup',
      text: 'hello everyone',
      fromId: 1,
    });
    expect(isDirectedAtBot(m, 42, 'Factory5TestBot')).toBe(false);
  });
});

// ----------------------- plugin-level -----------------------

describe('TelegramChannel start/stop lifecycle', () => {
  it('verifies identity via getMe before start() resolves', async () => {
    const api = makeStubApi();
    let getMeCalls = 0;
    const wrapped: TelegramApi = {
      ...api,
      async getMe() {
        getMeCalls += 1;
        return BOT_IDENTITY;
      },
    };
    const plugin = createTelegramChannel({
      apiFactory: () => wrapped,
      autoPoll: false,
      db: freshDb(),
    });
    await plugin.start(
      { log: createLogger('test.telegram'), onInbound: () => undefined },
      { botToken: 'fake' },
    );
    expect(getMeCalls).toBe(1);
    await plugin.stop();
  });

  it('stops cleanly when the poll loop is running', async () => {
    const api = makeStubApi();
    const plugin = createTelegramChannel({
      apiFactory: () => api,
      autoPoll: true,
      db: freshDb(),
    });
    await plugin.start(
      { log: createLogger('test.telegram'), onInbound: () => undefined },
      { botToken: 'fake', pollTimeoutSec: 1 },
    );
    // Let the loop fire once.
    await new Promise((r) => setTimeout(r, 10));
    await plugin.stop();
    // No unhandled rejections; a getUpdates was attempted.
    expect(api.getUpdatesCalls.length).toBeGreaterThan(0);
  });
});

describe('TelegramChannel inbound', () => {
  it('ignores messages from bots', async () => {
    const api = makeStubApi();
    const inbounds: Directive[] = [];
    const plugin = createTelegramChannel({
      apiFactory: () => api,
      autoPoll: false,
      db: freshDb(),
    });
    await plugin.start(
      {
        log: createLogger('test.telegram'),
        onInbound: (d) => {
          inbounds.push(d);
        },
      },
      { botToken: 'fake' },
    );
    await plugin._simulateUpdate({
      update_id: 1,
      message: makeMessage({
        messageId: 10,
        text: 'hello',
        chatId: 1225367797,
        fromId: 42,
        fromIsBot: true,
      }),
    });
    expect(inbounds).toHaveLength(0);
    await plugin.stop();
  });

  it('ignores messages outside the chat allowlist', async () => {
    const api = makeStubApi();
    const inbounds: Directive[] = [];
    const plugin = createTelegramChannel({
      apiFactory: () => api,
      autoPoll: false,
      db: freshDb(),
    });
    await plugin.start(
      { log: createLogger('test.telegram'), onInbound: (d) => inbounds.push(d) },
      { botToken: 'fake', allowedChatIds: [1225367797] },
    );
    await plugin._simulateUpdate({
      update_id: 2,
      message: makeMessage({
        messageId: 11,
        text: 'hello',
        chatId: 99999, // not in allowlist
        fromId: 7,
      }),
    });
    expect(inbounds).toHaveLength(0);
    await plugin.stop();
  });

  it('ignores group messages that do not mention the bot', async () => {
    const api = makeStubApi();
    const inbounds: Directive[] = [];
    const plugin = createTelegramChannel({
      apiFactory: () => api,
      autoPoll: false,
      db: freshDb(),
    });
    await plugin.start(
      { log: createLogger('test.telegram'), onInbound: (d) => inbounds.push(d) },
      { botToken: 'fake' },
    );
    await plugin._simulateUpdate({
      update_id: 3,
      message: makeMessage({
        messageId: 20,
        text: 'random chatter',
        chatId: -1001,
        chatType: 'supergroup',
        fromId: 5,
      }),
    });
    expect(inbounds).toHaveLength(0);
    await plugin.stop();
  });

  it('normalises a private-chat message into a chat Directive', async () => {
    const api = makeStubApi();
    const inbounds: Directive[] = [];
    const plugin = createTelegramChannel({
      apiFactory: () => api,
      autoPoll: false,
      db: freshDb(),
    });
    await plugin.start(
      { log: createLogger('test.telegram'), onInbound: (d) => inbounds.push(d) },
      { botToken: 'fake' },
    );
    await plugin._simulateUpdate({
      update_id: 4,
      message: makeMessage({
        messageId: 30,
        text: 'hey, what can you do?',
        chatId: 1225367797,
        fromId: 1225367797,
      }),
    });
    expect(inbounds).toHaveLength(1);
    const d = inbounds[0] as Directive;
    expect(d.source).toBe('telegram');
    expect(d.intent).toBe('chat');
    expect(d.autonomy).toBe('chat');
    expect(d.channelRef).toBe('1225367797#30');
    expect(d.principal).toBe('1225367797');
    const payload = d.payload as Record<string, unknown>;
    expect(payload['text']).toBe('hey, what can you do?');
    await plugin.stop();
  });

  it('parses /build prefix as intent=build with project payload', async () => {
    const api = makeStubApi();
    const inbounds: Directive[] = [];
    const plugin = createTelegramChannel({
      apiFactory: () => api,
      autoPoll: false,
      db: freshDb(),
    });
    await plugin.start(
      { log: createLogger('test.telegram'), onInbound: (d) => inbounds.push(d) },
      { botToken: 'fake' },
    );
    await plugin._simulateUpdate({
      update_id: 5,
      message: makeMessage({
        messageId: 40,
        text: '/build example -- a weather CLI in Python',
        chatId: 1225367797,
        fromId: 1225367797,
      }),
    });
    expect(inbounds).toHaveLength(1);
    const d = inbounds[0] as Directive;
    expect(d.intent).toBe('build');
    expect(d.autonomy).toBe('autonomous');
    const payload = d.payload as Record<string, unknown>;
    expect(payload['project']).toBe('example');
    expect(payload['spec']).toBe('a weather CLI in Python');
    await plugin.stop();
  });

  it('normalises a group @mention directive with mention stripped', async () => {
    const api = makeStubApi();
    const inbounds: Directive[] = [];
    const plugin = createTelegramChannel({
      apiFactory: () => api,
      autoPoll: false,
      db: freshDb(),
    });
    await plugin.start(
      { log: createLogger('test.telegram'), onInbound: (d) => inbounds.push(d) },
      { botToken: 'fake' },
    );
    await plugin._simulateUpdate({
      update_id: 6,
      message: makeMessage({
        messageId: 50,
        text: '@Factory5TestBot /build greeter -- say hello',
        chatId: -1001,
        chatType: 'supergroup',
        fromId: 7,
        entities: [{ type: 'mention', offset: 0, length: 16 }],
      }),
    });
    expect(inbounds).toHaveLength(1);
    const d = inbounds[0] as Directive;
    expect(d.intent).toBe('build');
    const payload = d.payload as Record<string, unknown>;
    expect(payload['project']).toBe('greeter');
    expect(payload['spec']).toBe('say hello');
    await plugin.stop();
  });

  it('answers a pending question when replying to the trigger message', async () => {
    const api = makeStubApi();
    const db = freshDb();
    const directiveId = newId();
    const questionId = newId();
    directivesQ.insert(db, {
      id: directiveId,
      source: 'telegram',
      principal: '1225367797',
      channelRef: '1225367797#30',
      intent: 'build',
      payload: { project: 'example' },
      autonomy: 'autonomous',
      createdAt: new Date().toISOString(),
      status: 'running',
    });
    pendingQuestions.create(db, {
      id: questionId,
      directiveId,
      question: 'Proceed?',
      channel: 'telegram',
      channelRef: '1225367797#30',
      createdAt: new Date().toISOString(),
    });
    const inbounds: Directive[] = [];
    const plugin = createTelegramChannel({
      apiFactory: () => api,
      autoPoll: false,
      db,
    });
    await plugin.start(
      { log: createLogger('test.telegram'), onInbound: (d) => inbounds.push(d) },
      { botToken: 'fake' },
    );
    await plugin._simulateUpdate({
      update_id: 7,
      message: makeMessage({
        messageId: 31,
        text: 'yes please',
        chatId: 1225367797,
        fromId: 1225367797,
        replyTo: { messageId: 30, fromBotId: 42 },
      }),
    });
    // Should answer, not produce a new directive.
    expect(inbounds).toHaveLength(0);
    const q = pendingQuestions.getById(db, questionId);
    expect(q?.answeredAt).toBeDefined();
    expect(q?.answer).toBe('yes please');
    // Wait for the fire-and-forget ack.
    await new Promise((r) => setTimeout(r, 5));
    expect(api.sent).toHaveLength(1);
    expect(api.sent[0]?.text).toContain(questionId);
    await plugin.stop();
  });
});

describe('TelegramChannel send', () => {
  it('routes to a bare chat id', async () => {
    const api = makeStubApi();
    const plugin = createTelegramChannel({
      apiFactory: () => api,
      autoPoll: false,
      db: freshDb(),
    });
    await plugin.start(
      { log: createLogger('test.telegram'), onInbound: () => undefined },
      { botToken: 'fake' },
    );
    const msg: OutboundMessage = {
      id: newId(),
      targetChannel: 'telegram',
      targetRef: '1225367797',
      text: 'hi from brain',
      createdAt: new Date().toISOString(),
      attempts: 0,
    };
    const res = await plugin.send(msg);
    expect(res.delivered).toBe(true);
    expect(api.sent).toEqual([{ chatId: 1225367797, text: 'hi from brain' }]);
    await plugin.stop();
  });

  it('threads via reply-to when targetRef has <chat>#<message>', async () => {
    const api = makeStubApi();
    const plugin = createTelegramChannel({
      apiFactory: () => api,
      autoPoll: false,
      db: freshDb(),
    });
    await plugin.start(
      { log: createLogger('test.telegram'), onInbound: () => undefined },
      { botToken: 'fake' },
    );
    const res = await plugin.send({
      id: newId(),
      targetChannel: 'telegram',
      targetRef: '1225367797#40',
      text: 'threaded reply',
      createdAt: new Date().toISOString(),
      attempts: 0,
    });
    expect(res.delivered).toBe(true);
    expect(api.sent[0]).toEqual({
      chatId: 1225367797,
      text: 'threaded reply',
      replyToMessageId: 40,
    });
    await plugin.stop();
  });

  it('reports delivered=false on a malformed ref', async () => {
    const api = makeStubApi();
    const plugin = createTelegramChannel({
      apiFactory: () => api,
      autoPoll: false,
      db: freshDb(),
    });
    await plugin.start(
      { log: createLogger('test.telegram'), onInbound: () => undefined },
      { botToken: 'fake' },
    );
    const res = await plugin.send({
      id: newId(),
      targetChannel: 'telegram',
      targetRef: 'not-a-number',
      text: 'x',
      createdAt: new Date().toISOString(),
      attempts: 0,
    });
    expect(res.delivered).toBe(false);
    expect(res.error).toContain('invalid chat id');
    await plugin.stop();
  });

  it('reports not-ready when send is called before start', async () => {
    const api = makeStubApi();
    const plugin = createTelegramChannel({
      apiFactory: () => api,
      autoPoll: false,
      db: freshDb(),
    });
    const res = await plugin.send({
      id: newId(),
      targetChannel: 'telegram',
      targetRef: '1225367797',
      text: 'x',
      createdAt: new Date().toISOString(),
      attempts: 0,
    });
    expect(res.delivered).toBe(false);
    expect(res.error).toContain('not ready');
  });

  it('surfaces api.sendMessage failures as delivered=false', async () => {
    const api = makeStubApi();
    api.failSend = new Error('sim: 403 bot was blocked');
    const plugin = createTelegramChannel({
      apiFactory: () => api,
      autoPoll: false,
      db: freshDb(),
    });
    await plugin.start(
      { log: createLogger('test.telegram'), onInbound: () => undefined },
      { botToken: 'fake' },
    );
    const res = await plugin.send({
      id: newId(),
      targetChannel: 'telegram',
      targetRef: '1225367797',
      text: 'x',
      createdAt: new Date().toISOString(),
      attempts: 0,
    });
    expect(res.delivered).toBe(false);
    expect(res.error).toContain('403 bot was blocked');
    await plugin.stop();
  });
});

describe('TelegramChannel polling loop', () => {
  it('advances offset past each delivered update and backs off after an error', async () => {
    const api = makeStubApi();
    // Queue one batch with two updates, then one error, then an empty reply.
    api.updateQueue.push([
      {
        update_id: 100,
        message: makeMessage({
          messageId: 1,
          text: 'hi',
          chatId: 1225367797,
          fromId: 1225367797,
        }),
      },
      {
        update_id: 101,
        message: makeMessage({
          messageId: 2,
          text: 'again',
          chatId: 1225367797,
          fromId: 1225367797,
        }),
      },
    ]);
    const inbounds: Directive[] = [];
    const plugin = createTelegramChannel({
      apiFactory: () => api,
      autoPoll: true,
      db: freshDb(),
    });
    await plugin.start(
      { log: createLogger('test.telegram'), onInbound: (d) => inbounds.push(d) },
      { botToken: 'fake', pollTimeoutSec: 1 },
    );
    // Drain the queue.
    await vi.waitFor(() => expect(inbounds.length).toBe(2), { timeout: 1000 });
    expect(plugin._getOffset()).toBe(102);

    // Inject a failing getUpdates and confirm the loop doesn't crash.
    api.failNextGet = new Error('sim: 502');
    await new Promise((r) => setTimeout(r, 30));
    await plugin.stop();
    // At least two getUpdates calls: the success + the error.
    expect(api.getUpdatesCalls.length).toBeGreaterThanOrEqual(2);
  });
});

// Silence unused-var warnings for `createLogger` import when tree-shaken.
void createLogger;
