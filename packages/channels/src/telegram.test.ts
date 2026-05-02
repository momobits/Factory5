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
  sent: Array<{ chatId: number; text: string; replyToMessageId?: number; parseMode?: string }>;
  updateQueue: ReadonlyArray<TelegramUpdate>[];
  getUpdatesCalls: Array<{ offset?: number; timeoutSec: number }>;
  setMyCommandsCalls: Array<{ commands: ReadonlyArray<{ command: string; description: string }> }>;
  failNextGet?: Error;
  failSend?: Error;
  failSetMyCommands?: Error;
}

function makeStubApi(identity: TelegramBotIdentity = BOT_IDENTITY): StubTelegramApi {
  const api: StubTelegramApi = {
    sent: [],
    updateQueue: [],
    getUpdatesCalls: [],
    setMyCommandsCalls: [],
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
    async sendMessage({ chatId, text, replyToMessageId, parseMode }) {
      if (api.failSend !== undefined) throw api.failSend;
      api.sent.push({
        chatId,
        text,
        ...(replyToMessageId !== undefined ? { replyToMessageId } : {}),
        ...(parseMode !== undefined ? { parseMode } : {}),
      });
      return { message_id: api.sent.length };
    },
    async setMyCommands({ commands }) {
      if (api.failSetMyCommands !== undefined) throw api.failSetMyCommands;
      api.setMyCommandsCalls.push({ commands });
      return true;
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
    // No `projectPath` when resolveProjectPath isn't wired — pre-I011 shape.
    expect(payload['projectPath']).toBeUndefined();
    await plugin.stop();
  });

  it('build directive gets payload.projectPath when resolveProjectPath is wired (I011)', async () => {
    const api = makeStubApi();
    const inbounds: Directive[] = [];
    const plugin = createTelegramChannel({
      apiFactory: () => api,
      autoPoll: false,
      db: freshDb(),
    });
    const resolver = async (name: string): Promise<string> => `/resolved/workspace/${name}`;
    await plugin.start(
      {
        log: createLogger('test.telegram'),
        onInbound: (d) => inbounds.push(d),
        resolveProjectPath: resolver,
      },
      { botToken: 'fake' },
    );
    await plugin._simulateUpdate({
      update_id: 7,
      message: makeMessage({
        messageId: 60,
        text: '/build ask-user-smoke',
        chatId: 1225367797,
        fromId: 1225367797,
      }),
    });
    expect(inbounds).toHaveLength(1);
    const d = inbounds[0] as Directive;
    expect(d.intent).toBe('build');
    const payload = d.payload as Record<string, unknown>;
    expect(payload['project']).toBe('ask-user-smoke');
    expect(payload['projectPath']).toBe('/resolved/workspace/ask-user-smoke');
    await plugin.stop();
  });

  it('build directive carries `limits` from resolveBuildLimits (I009 fix)', async () => {
    // Regression for I009: pre-fix, Telegram inbound `/build` skipped both
    // project-tier `metadata.budgetDefaults` and config-tier
    // `[budget.defaults]`. Phase 13.3 threads `resolveBuildLimits` through
    // `ChannelContext`; the daemon binds it to a closure that merges the
    // project + config tiers via wiki's `resolveDirectiveLimits`.
    const api = makeStubApi();
    const inbounds: Directive[] = [];
    const plugin = createTelegramChannel({
      apiFactory: () => api,
      autoPoll: false,
      db: freshDb(),
    });
    const resolveBuildLimits = async (
      name: string,
    ): Promise<{ maxUsd?: number; maxSteps?: number } | undefined> => {
      // Mirror what the daemon binds: merge a project-tier { maxUsd: 5 }
      // (Web UI–writable) with a config-tier { maxSteps: 200 }.
      if (name !== 'budget-test-project') return undefined;
      return { maxUsd: 5, maxSteps: 200 };
    };
    await plugin.start(
      {
        log: createLogger('test.telegram'),
        onInbound: (d) => inbounds.push(d),
        resolveProjectPath: async (name) => `/resolved/${name}`,
        resolveBuildLimits,
      },
      { botToken: 'fake' },
    );
    await plugin._simulateUpdate({
      update_id: 99,
      message: makeMessage({
        messageId: 99,
        text: '/build budget-test-project',
        chatId: 1225367797,
        fromId: 1225367797,
      }),
    });
    expect(inbounds).toHaveLength(1);
    const d = inbounds[0] as Directive;
    expect(d.intent).toBe('build');
    expect(d.limits).toEqual({ maxUsd: 5, maxSteps: 200 });
    await plugin.stop();
  });

  it('build directive has no `limits` when resolveBuildLimits returns undefined', async () => {
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
        onInbound: (d) => inbounds.push(d),
        resolveProjectPath: async (name) => `/resolved/${name}`,
        // Returns undefined → no project tier, no config tier — unlimited path.
        resolveBuildLimits: async () => undefined,
      },
      { botToken: 'fake' },
    );
    await plugin._simulateUpdate({
      update_id: 100,
      message: makeMessage({
        messageId: 100,
        text: '/build no-limits-project',
        chatId: 1225367797,
        fromId: 1225367797,
      }),
    });
    expect(inbounds).toHaveLength(1);
    const d = inbounds[0] as Directive;
    expect(d.limits).toBeUndefined();
    await plugin.stop();
  });

  it('build directive has no `limits` when resolveBuildLimits is unwired (pre-I011 path)', async () => {
    // Standalone-script / test-harness path that wires the channel
    // without the daemon. Inbound directives carry no `limits` — the
    // pre-Phase-13.3 behaviour. Documented so a future contract tweak
    // surfaces here.
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
        onInbound: (d) => inbounds.push(d),
      },
      { botToken: 'fake' },
    );
    await plugin._simulateUpdate({
      update_id: 101,
      message: makeMessage({
        messageId: 101,
        text: '/build legacy-flow',
        chatId: 1225367797,
        fromId: 1225367797,
      }),
    });
    expect(inbounds).toHaveLength(1);
    const d = inbounds[0] as Directive;
    expect(d.limits).toBeUndefined();
    await plugin.stop();
  });

  it('build directive has no `limits` when resolveBuildLimits throws', async () => {
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
        onInbound: (d) => inbounds.push(d),
        resolveProjectPath: async (name) => `/resolved/${name}`,
        resolveBuildLimits: async () => {
          throw new Error('boom');
        },
      },
      { botToken: 'fake' },
    );
    await plugin._simulateUpdate({
      update_id: 102,
      message: makeMessage({
        messageId: 102,
        text: '/build throws-here',
        chatId: 1225367797,
        fromId: 1225367797,
      }),
    });
    expect(inbounds).toHaveLength(1);
    const d = inbounds[0] as Directive;
    // The plugin swallows the failure (logs a warning); directive runs
    // uncapped rather than crashing the inbound path.
    expect(d.limits).toBeUndefined();
    await plugin.stop();
  });

  it('falls back to raw name when resolveProjectPath throws', async () => {
    const api = makeStubApi();
    const inbounds: Directive[] = [];
    const plugin = createTelegramChannel({
      apiFactory: () => api,
      autoPoll: false,
      db: freshDb(),
    });
    const resolver = async (): Promise<string> => {
      throw new Error('workspace unavailable');
    };
    await plugin.start(
      {
        log: createLogger('test.telegram'),
        onInbound: (d) => inbounds.push(d),
        resolveProjectPath: resolver,
      },
      { botToken: 'fake' },
    );
    await plugin._simulateUpdate({
      update_id: 8,
      message: makeMessage({
        messageId: 61,
        text: '/build unknown-project',
        chatId: 1225367797,
        fromId: 1225367797,
      }),
    });
    expect(inbounds).toHaveLength(1);
    const d = inbounds[0] as Directive;
    const payload = d.payload as Record<string, unknown>;
    expect(payload['project']).toBe('unknown-project');
    expect(payload['projectPath']).toBeUndefined();
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

  it('targets the specific question whose bot message was replied to (I012)', async () => {
    // Regression: two open questions in the same chat. The operator uses
    // Telegram's Reply feature on the *newer* question's bot message; the
    // matcher must answer that question, not fall back to FIFO and silently
    // answer the older one.
    const api = makeStubApi();
    const db = freshDb();
    const directiveId = newId();
    const olderQuestionId = newId();
    const newerQuestionId = newId();
    const chatId = 1225367797;
    const directiveChannelRef = `${String(chatId)}#10`;
    directivesQ.insert(db, {
      id: directiveId,
      source: 'telegram',
      principal: String(chatId),
      channelRef: directiveChannelRef,
      intent: 'build',
      payload: { project: 'example' },
      autonomy: 'autonomous',
      createdAt: new Date().toISOString(),
      status: 'running',
    });
    // Older question: bot delivered it as message_id=100.
    pendingQuestions.create(db, {
      id: olderQuestionId,
      directiveId,
      question: 'older question',
      channel: 'telegram',
      channelRef: directiveChannelRef,
      createdAt: '2026-04-23T11:39:27.000Z',
      botMessageId: '100',
    });
    // Newer question: bot delivered it as message_id=200.
    pendingQuestions.create(db, {
      id: newerQuestionId,
      directiveId,
      question: 'newer question',
      channel: 'telegram',
      channelRef: directiveChannelRef,
      createdAt: '2026-04-23T11:56:57.000Z',
      botMessageId: '200',
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
    // Operator replies to the newer bot message (message_id=200).
    await plugin._simulateUpdate({
      update_id: 9,
      message: makeMessage({
        messageId: 31,
        text: 'abort',
        chatId,
        fromId: chatId,
        replyTo: { messageId: 200, fromBotId: 42 },
      }),
    });
    expect(inbounds).toHaveLength(0);
    const newer = pendingQuestions.getById(db, newerQuestionId);
    const older = pendingQuestions.getById(db, olderQuestionId);
    expect(newer?.answeredAt).toBeDefined();
    expect(newer?.answer).toBe('abort');
    expect(older?.answeredAt).toBeUndefined();
    expect(older?.answer).toBeUndefined();
    await new Promise((r) => setTimeout(r, 5));
    await plugin.stop();
  });

  it('falls back to channel_ref/LIKE when bot_message_id is unstamped (legacy rows)', async () => {
    // A pre-migration-008 question (or an outbound that was never stamped
    // because delivery failed before the worker could record the externalId)
    // should still be answerable by the legacy chat-id LIKE rung — this is
    // the back-compat path the I012 fix preserves.
    const api = makeStubApi();
    const db = freshDb();
    const directiveId = newId();
    const questionId = newId();
    const chatId = 1225367797;
    directivesQ.insert(db, {
      id: directiveId,
      source: 'telegram',
      principal: String(chatId),
      channelRef: `${String(chatId)}#10`,
      intent: 'build',
      payload: { project: 'example' },
      autonomy: 'autonomous',
      createdAt: new Date().toISOString(),
      status: 'running',
    });
    pendingQuestions.create(db, {
      id: questionId,
      directiveId,
      question: 'unstamped',
      channel: 'telegram',
      channelRef: `${String(chatId)}#10`,
      createdAt: new Date().toISOString(),
      // No botMessageId — legacy / un-stamped row.
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
      update_id: 11,
      message: makeMessage({
        messageId: 31,
        text: 'yes',
        chatId,
        fromId: chatId,
        // Reply to some bot message we have no record of — exact rung misses,
        // legacy LIKE rung must still match by chat id.
        replyTo: { messageId: 999, fromBotId: 42 },
      }),
    });
    expect(inbounds).toHaveLength(0);
    const q = pendingQuestions.getById(db, questionId);
    expect(q?.answeredAt).toBeDefined();
    expect(q?.answer).toBe('yes');
    await new Promise((r) => setTimeout(r, 5));
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

// ---------------------------------------------------------------------------
// Slash-command dispatch (Phase 2.2)
// ---------------------------------------------------------------------------

describe('TelegramChannel — setMyCommands on start', () => {
  it('registers the seven factory commands when the API supports it', async () => {
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
    expect(api.setMyCommandsCalls).toHaveLength(1);
    const call = api.setMyCommandsCalls[0]!;
    const names = call.commands.map((c) => c.command).sort();
    expect(names).toEqual(['budget', 'build', 'cancel', 'findings', 'resume', 'spend', 'status']);
    await plugin.stop();
  });

  it('does not abort start() when setMyCommands fails', async () => {
    const api = makeStubApi();
    api.failSetMyCommands = new Error('sim: telegram bad request');
    const plugin = createTelegramChannel({
      apiFactory: () => api,
      autoPoll: false,
      db: freshDb(),
    });
    await plugin.start(
      { log: createLogger('test.telegram'), onInbound: () => undefined },
      { botToken: 'fake' },
    );
    // Plugin still started — slash commands work via the parser even when the
    // BotFather menu is stale.
    await plugin.stop();
  });
});

describe('TelegramChannel — /factory slash commands', () => {
  it('/status emits an HTML reply with project + recent-directive sections', async () => {
    const api = makeStubApi();
    const db = freshDb();
    // Seed a directive + a project so the reply has content to render.
    const dId = newId();
    directivesQ.insert(db, {
      id: dId,
      source: 'telegram',
      principal: '111',
      channelRef: '111#1',
      intent: 'build',
      payload: { project: 'demo' },
      autonomy: 'autonomous',
      createdAt: new Date().toISOString(),
      status: 'running',
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
      update_id: 1,
      message: makeMessage({
        messageId: 100,
        text: '/status',
        chatId: 111,
        fromId: 111,
      }),
    });
    // No directive enqueued for a read command.
    expect(inbounds).toHaveLength(0);
    // Wait for the fire-and-forget reply.
    await vi.waitFor(() => expect(api.sent.length).toBe(1), { timeout: 200 });
    const sent = api.sent[0]!;
    expect(sent.parseMode).toBe('HTML');
    expect(sent.text).toContain('factory status');
    expect(sent.text).toContain(dId.slice(-8));
    await plugin.stop();
  });

  it('/build enqueues a directive AND posts a confirmation reply', async () => {
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
        onInbound: (d) => inbounds.push(d),
        resolveProjectPath: async (n) => `/work/${n}`,
        resolveBuildLimits: async (n) => (n === 'demo' ? { maxUsd: 5 } : undefined),
      },
      { botToken: 'fake' },
    );
    await plugin._simulateUpdate({
      update_id: 2,
      message: makeMessage({
        messageId: 200,
        text: '/build demo -- a sample CLI in Python',
        chatId: 111,
        fromId: 111,
      }),
    });
    expect(inbounds).toHaveLength(1);
    const d = inbounds[0]!;
    expect(d.intent).toBe('build');
    expect(d.autonomy).toBe('autonomous');
    expect(d.source).toBe('telegram');
    const payload = d.payload as Record<string, unknown>;
    expect(payload['project']).toBe('demo');
    expect(payload['projectPath']).toBe('/work/demo');
    expect(payload['spec']).toBe('a sample CLI in Python');
    expect(d.limits).toEqual({ maxUsd: 5 });
    await vi.waitFor(() => expect(api.sent.length).toBe(1), { timeout: 200 });
    expect(api.sent[0]!.text).toContain('factory build — queued');
    expect(api.sent[0]!.text).toContain('demo');
    await plugin.stop();
  });

  it('/build with --autonomy and --max-usd flags overrides defaults', async () => {
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
        onInbound: (d) => inbounds.push(d),
        resolveProjectPath: async (n) => `/work/${n}`,
        // Daemon-bound limits would say 999, but the explicit flag should win.
        resolveBuildLimits: async () => ({ maxUsd: 999, maxSteps: 999 }),
      },
      { botToken: 'fake' },
    );
    await plugin._simulateUpdate({
      update_id: 3,
      message: makeMessage({
        messageId: 201,
        text: '/build demo --autonomy assisted --language node --max-usd 2.5 --max-steps 50',
        chatId: 111,
        fromId: 111,
      }),
    });
    expect(inbounds).toHaveLength(1);
    const d = inbounds[0]!;
    expect(d.autonomy).toBe('assisted');
    expect(d.limits).toEqual({ maxUsd: 2.5, maxSteps: 50 });
    const payload = d.payload as Record<string, unknown>;
    expect(payload['language']).toBe('node');
    await plugin.stop();
  });

  it('/cancel marks a running directive blocked + replies', async () => {
    const api = makeStubApi();
    const db = freshDb();
    const dId = newId();
    directivesQ.insert(db, {
      id: dId,
      source: 'telegram',
      principal: '111',
      channelRef: '111#1',
      intent: 'build',
      payload: {},
      autonomy: 'autonomous',
      createdAt: new Date().toISOString(),
      status: 'running',
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
      update_id: 4,
      message: makeMessage({
        messageId: 300,
        text: `/cancel ${dId} just stopping it`,
        chatId: 111,
        fromId: 111,
      }),
    });
    // No new directive — cancel is a state mutation, not a directive insertion.
    expect(inbounds).toHaveLength(0);
    const updated = directivesQ.getById(db, dId)!;
    expect(updated.status).toBe('blocked');
    expect(updated.blockedReason).toBe('just stopping it');
    await vi.waitFor(() => expect(api.sent.length).toBe(1), { timeout: 200 });
    expect(api.sent[0]!.text).toContain('factory cancel');
    expect(api.sent[0]!.text).toContain(dId.slice(-8));
    await plugin.stop();
  });

  it('/budget invokes setProjectBudget and replies with the persisted defaults', async () => {
    const api = makeStubApi();
    const db = freshDb();
    let captured: { name: string; defaults: { maxUsd?: number; maxSteps?: number } } | undefined;
    const setProjectBudget = async (
      name: string,
      defaults: { maxUsd?: number; maxSteps?: number },
    ): Promise<{ projectId: string; defaults: { maxUsd?: number; maxSteps?: number } }> => {
      captured = { name, defaults };
      return { projectId: newId(), defaults };
    };
    const plugin = createTelegramChannel({
      apiFactory: () => api,
      autoPoll: false,
      db,
    });
    await plugin.start(
      {
        log: createLogger('test.telegram'),
        onInbound: () => undefined,
        setProjectBudget,
      },
      { botToken: 'fake' },
    );
    await plugin._simulateUpdate({
      update_id: 5,
      message: makeMessage({
        messageId: 400,
        text: '/budget demo --max-usd 7 --max-steps 200',
        chatId: 111,
        fromId: 111,
      }),
    });
    expect(captured).toEqual({ name: 'demo', defaults: { maxUsd: 7, maxSteps: 200 } });
    await vi.waitFor(() => expect(api.sent.length).toBe(1), { timeout: 200 });
    expect(api.sent[0]!.text).toContain('factory budget — updated');
    await plugin.stop();
  });

  it('/budget without a project replies with usage', async () => {
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
    await plugin._simulateUpdate({
      update_id: 6,
      message: makeMessage({
        messageId: 401,
        text: '/budget',
        chatId: 111,
        fromId: 111,
      }),
    });
    await vi.waitFor(() => expect(api.sent.length).toBe(1), { timeout: 200 });
    expect(api.sent[0]!.text).toContain('factory budget:');
    expect(api.sent[0]!.text).toContain('--max-usd');
    await plugin.stop();
  });

  it('an unknown slash command falls through to chat-intent', async () => {
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
      update_id: 7,
      message: makeMessage({
        messageId: 500,
        text: '/nonsense some args',
        chatId: 111,
        fromId: 111,
      }),
    });
    // Falls through to chat-intent.
    expect(inbounds).toHaveLength(1);
    expect(inbounds[0]!.intent).toBe('chat');
    expect(api.sent).toHaveLength(0);
    await plugin.stop();
  });

  it('handles `/<cmd>@bot` form for groups (Telegram suffixes the bot username)', async () => {
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
      update_id: 8,
      message: makeMessage({
        messageId: 600,
        // Mention starts at offset 7 (after the 7-char `/status` prefix);
        // `@Factory5TestBot` is 16 chars long.
        text: '/status@Factory5TestBot',
        chatId: -1001,
        chatType: 'supergroup',
        fromId: 7,
        entities: [{ type: 'mention', offset: 7, length: 16 }],
      }),
    });
    expect(inbounds).toHaveLength(0);
    await vi.waitFor(() => expect(api.sent.length).toBe(1), { timeout: 200 });
    expect(api.sent[0]!.text).toContain('factory status');
    await plugin.stop();
  });
});

// Silence unused-var warnings for `createLogger` import when tree-shaken.
void createLogger;
