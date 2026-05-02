/**
 * Unit tests for DiscordChannel — use a stub `discord.js`-like client so the
 * full handler path (config → inbound normalisation → pending-question
 * answer routing → outbound routing) runs without hitting the live API.
 */

import { newId, type Directive, type OutboundMessage } from '@factory5/core';
import { initLogger, createLogger } from '@factory5/logger';
import {
  directives as directivesQ,
  openDatabase,
  pendingQuestions,
  runMigrations,
} from '@factory5/state';
import { Events, type Message } from 'discord.js';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import {
  ANSWER_INPUT_ID,
  ANSWER_MODAL_PREFIX,
  QUESTION_BUTTON_PREFIX,
  buildAnswerModal,
  buildQuestionComponents,
  buildThreadName,
  channelRefFor,
  createDiscordChannel,
  parseAnswerModalId,
  parseDiscordRef,
  parseQuestionButtonId,
  readQuestionMetadata,
  stripBotMention,
  type DiscordClientLike,
} from './discord.js';

beforeAll(() => {
  initLogger({ processName: 'discord-test', noFile: true, noConsole: true });
});

// ----------------------- stub client -----------------------

interface StubSendableChannel {
  id: string;
  send: (text: string) => Promise<{ id: string }>;
  isThread?: () => boolean;
  parentId?: string | null;
}

interface SentRecord {
  channelId: string;
  text: string;
  /**
   * Populated only when the plugin sent the components-form payload (Phase
   * 2.3 pending-question buttons). Bare-text outbounds leave this absent
   * so existing assertions on plain strings keep matching.
   */
  components?: unknown[];
}

function makeStubClient(opts: { autoReady?: boolean } = {}): {
  client: DiscordClientLike;
  emit: (m: Message) => Promise<void>;
  fireReady: () => void;
  channels: Map<string, StubSendableChannel>;
  sent: SentRecord[];
} {
  const listeners: Array<(m: Message) => void | Promise<void>> = [];
  let readyCb: (() => void) | undefined;
  const channels = new Map<string, StubSendableChannel>();
  const sent: SentRecord[] = [];
  const autoReady = opts.autoReady ?? true;

  const client: DiscordClientLike = {
    user: { id: 'bot-1', tag: 'factory-bot#0001' },
    once(event, listener) {
      if (event === Events.ClientReady) readyCb = listener;
    },
    on(event, listener) {
      if (event === 'messageCreate') listeners.push(listener);
    },
    off(event, listener) {
      if (event !== 'messageCreate') return;
      const idx = listeners.indexOf(listener);
      if (idx >= 0) listeners.splice(idx, 1);
    },
    async login() {
      if (autoReady) {
        // Fire on next microtask so plugin.start() sees the ready promise
        // created first — same ordering the real discord.js client uses.
        queueMicrotask(() => readyCb?.());
      }
      return 'ok';
    },
    async destroy() {
      // nothing
    },
    channels: {
      async fetch(id: string) {
        const c = channels.get(id);
        if (c === undefined) return null;
        // cast back to the `discord.js` channel shape
        return {
          ...c,
          send: async (
            payload: string | { content: string; components?: unknown[] },
          ): Promise<{ id: string }> => {
            if (typeof payload === 'string') {
              sent.push({ channelId: c.id, text: payload });
            } else {
              sent.push({
                channelId: c.id,
                text: payload.content,
                ...(payload.components !== undefined ? { components: payload.components } : {}),
              });
            }
            return { id: `msg-${sent.length.toString()}` };
          },
        } as unknown as ReturnType<DiscordClientLike['channels']['fetch']> extends Promise<infer T>
          ? T
          : never;
      },
    },
  };

  return {
    client,
    emit: async (m) => {
      for (const l of listeners) await l(m);
    },
    fireReady: () => readyCb?.(),
    channels,
    sent,
  };
}

// Build a minimal Message-looking object. discord.js's real Message has
// dozens of fields; we stub just the ones the handler reads.
function makeMessage(opts: {
  id: string;
  content: string;
  authorId: string;
  channelId: string;
  guildId?: string;
  bot?: boolean;
  threadOf?: string; // if set, channel is a thread whose parentId is this
  mentions?: string[];
  startThread?: (o: { name: string }) => Promise<{ id: string }>;
  reply?: (text: string) => Promise<{ id: string }>;
}): Message {
  const channel =
    opts.threadOf !== undefined
      ? {
          isThread: () => true,
          parentId: opts.threadOf,
          id: opts.channelId,
          type: 11,
        }
      : {
          isThread: () => false,
          parentId: null,
          id: opts.channelId,
          type: 0, // GuildText
        };
  return {
    id: opts.id,
    content: opts.content,
    author: { id: opts.authorId, bot: opts.bot === true },
    channelId: opts.channelId,
    guildId: opts.guildId ?? 'guild-1',
    channel,
    mentions: {
      has: (userId: string) =>
        (opts.mentions ?? []).includes(userId) ||
        opts.content.includes(`<@${userId}>`) ||
        opts.content.includes(`<@!${userId}>`),
    },
    startThread: opts.startThread ?? vi.fn(async () => ({ id: `thread-of-${opts.id}` })),
    reply: opts.reply ?? vi.fn(async () => ({ id: 'reply-1' })),
  } as unknown as Message;
}

function freshDb(): ReturnType<typeof openDatabase> {
  const db = openDatabase(':memory:');
  runMigrations(db);
  return db;
}

// ----------------------- pure helpers -----------------------

describe('parseDiscordRef', () => {
  it('parses bare channel id', () => {
    expect(parseDiscordRef('123')).toEqual({ channelId: '123' });
  });
  it('parses compound channel#thread', () => {
    expect(parseDiscordRef('123#456')).toEqual({ channelId: '123', threadId: '456' });
  });
  it('treats empty thread segment as bare channel', () => {
    expect(parseDiscordRef('123#')).toEqual({ channelId: '123' });
  });
});

describe('stripBotMention', () => {
  it('strips <@id> prefix', () => {
    expect(stripBotMention('<@bot-1> hello', 'bot-1')).toBe('hello');
  });
  it('strips <@!id> prefix', () => {
    expect(stripBotMention('<@!bot-1> hi there', 'bot-1')).toBe('hi there');
  });
  it('leaves body unchanged if no prefix', () => {
    expect(stripBotMention('just text', 'bot-1')).toBe('just text');
  });
});

describe('buildThreadName', () => {
  it('prefixes and trims whitespace', () => {
    expect(buildThreadName('  hello   world\nagain  ')).toBe('factory: hello world again');
  });
  it('truncates past 100 chars with ...', () => {
    const n = buildThreadName('a'.repeat(300));
    expect(n.length).toBeLessThanOrEqual(100);
    expect(n.endsWith('...')).toBe(true);
  });
});

describe('channelRefFor', () => {
  it('formats <channelId>#<messageId> for non-thread messages', () => {
    const m = makeMessage({
      id: 'msg-1',
      content: 'hi',
      authorId: 'u1',
      channelId: 'chan-1',
    });
    expect(channelRefFor(m)).toBe('chan-1#msg-1');
  });
  it('formats <parentId>#<threadId> for messages in a thread', () => {
    const m = makeMessage({
      id: 'msg-2',
      content: 'reply',
      authorId: 'u1',
      channelId: 'thread-1',
      threadOf: 'chan-2',
    });
    expect(channelRefFor(m)).toBe('chan-2#thread-1');
  });
});

// ----------------------- plugin-level -----------------------

describe('DiscordChannel start/stop lifecycle', () => {
  it('awaits ClientReady before start() resolves', async () => {
    const stub = makeStubClient({ autoReady: false });
    const plugin = createDiscordChannel({
      clientFactory: () => stub.client,
      db: freshDb(),
    });
    let resolved = false;
    const started = plugin
      .start(
        { log: createLogger('test.discord'), onInbound: () => undefined },
        { token: 'fake-token' },
      )
      .then(() => {
        resolved = true;
      });
    await new Promise((r) => setTimeout(r, 20));
    expect(resolved).toBe(false);
    stub.fireReady();
    await started;
    expect(resolved).toBe(true);
    await plugin.stop();
  });
});

describe('DiscordChannel inbound', () => {
  it('ignores messages from bots', async () => {
    const stub = makeStubClient();
    const db = freshDb();
    const inbounds: Directive[] = [];
    const plugin = createDiscordChannel({ clientFactory: () => stub.client, db });
    await plugin.start(
      {
        log: createLogger('test.discord'),
        onInbound: (d) => {
          inbounds.push(d);
        },
      },
      { token: 'x' },
    );
    stub.fireReady();
    await stub.emit(
      makeMessage({
        id: 'm1',
        content: '<@bot-1> hi',
        authorId: 'u1',
        channelId: 'chan-1',
        bot: true,
      }),
    );
    expect(inbounds).toHaveLength(0);
    await plugin.stop();
  });

  it('ignores messages outside the configured guild', async () => {
    const stub = makeStubClient();
    const db = freshDb();
    const inbounds: Directive[] = [];
    const plugin = createDiscordChannel({ clientFactory: () => stub.client, db });
    await plugin.start(
      {
        log: createLogger('test.discord'),
        onInbound: (d) => inbounds.push(d),
      },
      { token: 'x', guildId: 'guild-A' },
    );
    stub.fireReady();
    await stub.emit(
      makeMessage({
        id: 'm1',
        content: '<@bot-1> hi',
        authorId: 'u1',
        channelId: 'chan-1',
        guildId: 'guild-B',
      }),
    );
    expect(inbounds).toHaveLength(0);
    await plugin.stop();
  });

  it('ignores messages from users outside the allowlist', async () => {
    const stub = makeStubClient();
    const db = freshDb();
    const inbounds: Directive[] = [];
    const plugin = createDiscordChannel({ clientFactory: () => stub.client, db });
    await plugin.start(
      { log: createLogger('test.discord'), onInbound: (d) => inbounds.push(d) },
      { token: 'x', allowedUserIds: ['u2'] },
    );
    stub.fireReady();
    await stub.emit(
      makeMessage({
        id: 'm1',
        content: '<@bot-1> hi',
        authorId: 'u1',
        channelId: 'chan-1',
      }),
    );
    expect(inbounds).toHaveLength(0);
    await plugin.stop();
  });

  it('normalises a chat mention into a Directive and opens a thread', async () => {
    const stub = makeStubClient();
    const db = freshDb();
    const inbounds: Directive[] = [];
    const startThread = vi.fn(async () => ({ id: 'thread-xyz' }));
    const plugin = createDiscordChannel({ clientFactory: () => stub.client, db });
    await plugin.start(
      { log: createLogger('test.discord'), onInbound: (d) => inbounds.push(d) },
      { token: 'x' },
    );
    stub.fireReady();
    await stub.emit(
      makeMessage({
        id: 'm1',
        content: '<@bot-1> hey, what can you do?',
        authorId: 'u1',
        channelId: 'chan-1',
        startThread,
      }),
    );
    expect(inbounds).toHaveLength(1);
    const d = inbounds[0] as Directive;
    expect(d.intent).toBe('chat');
    expect(d.source).toBe('discord');
    expect(d.channelRef).toBe('chan-1#thread-xyz');
    expect(d.principal).toBe('u1');
    expect(d.autonomy).toBe('chat');
    expect(startThread).toHaveBeenCalledTimes(1);
    await plugin.stop();
  });

  it('parses a /build prefix as intent=build with project payload', async () => {
    const stub = makeStubClient();
    const db = freshDb();
    const inbounds: Directive[] = [];
    const plugin = createDiscordChannel({ clientFactory: () => stub.client, db });
    await plugin.start(
      { log: createLogger('test.discord'), onInbound: (d) => inbounds.push(d) },
      { token: 'x', buildPrefix: '/build' },
    );
    stub.fireReady();
    await stub.emit(
      makeMessage({
        id: 'm1',
        content: '<@bot-1> /build example -- a weather CLI in Python',
        authorId: 'u1',
        channelId: 'chan-1',
        startThread: vi.fn(async () => ({ id: 'thread-b' })),
      }),
    );
    expect(inbounds).toHaveLength(1);
    const d = inbounds[0] as Directive;
    expect(d.intent).toBe('build');
    expect(d.autonomy).toBe('autonomous');
    const payload = d.payload as Record<string, unknown>;
    expect(payload['project']).toBe('example');
    expect(payload['spec']).toBe('a weather CLI in Python');
    await plugin.stop();
  });

  it('build directive carries `limits` from resolveBuildLimits (I009 fix)', async () => {
    // Mirrors the Telegram I009 regression. Pre-Phase-13.3 the Discord
    // plugin emitted a `/build` directive with no `limits`; the
    // resolveBuildLimits callback now threads project + config tiers.
    const stub = makeStubClient();
    const db = freshDb();
    const inbounds: Directive[] = [];
    const plugin = createDiscordChannel({ clientFactory: () => stub.client, db });
    await plugin.start(
      {
        log: createLogger('test.discord'),
        onInbound: (d) => inbounds.push(d),
        resolveProjectPath: async (name) => `/resolved/${name}`,
        resolveBuildLimits: async (name) => {
          if (name !== 'budget-test-discord') return undefined;
          return { maxUsd: 7, maxSteps: 150 };
        },
      },
      { token: 'x', buildPrefix: '/build' },
    );
    stub.fireReady();
    await stub.emit(
      makeMessage({
        id: 'm-budget',
        content: '<@bot-1> /build budget-test-discord',
        authorId: 'u1',
        channelId: 'chan-budget',
        startThread: vi.fn(async () => ({ id: 'thread-budget' })),
      }),
    );
    expect(inbounds).toHaveLength(1);
    const d = inbounds[0] as Directive;
    expect(d.intent).toBe('build');
    expect(d.limits).toEqual({ maxUsd: 7, maxSteps: 150 });
    await plugin.stop();
  });

  it('build directive has no `limits` when resolveBuildLimits is unwired', async () => {
    const stub = makeStubClient();
    const db = freshDb();
    const inbounds: Directive[] = [];
    const plugin = createDiscordChannel({ clientFactory: () => stub.client, db });
    await plugin.start(
      { log: createLogger('test.discord'), onInbound: (d) => inbounds.push(d) },
      { token: 'x', buildPrefix: '/build' },
    );
    stub.fireReady();
    await stub.emit(
      makeMessage({
        id: 'm-no-limits',
        content: '<@bot-1> /build legacy-no-limits',
        authorId: 'u1',
        channelId: 'chan-x',
        startThread: vi.fn(async () => ({ id: 'thread-no-limits' })),
      }),
    );
    expect(inbounds).toHaveLength(1);
    const d = inbounds[0] as Directive;
    expect(d.limits).toBeUndefined();
    await plugin.stop();
  });

  it('answers a pending question when posted in the question thread', async () => {
    const stub = makeStubClient();
    const db = freshDb();
    const directiveId = newId();
    const questionId = newId();
    directivesQ.insert(db, {
      id: directiveId,
      source: 'discord',
      principal: 'u1',
      channelRef: 'chan-1#thread-1',
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
      channel: 'discord',
      channelRef: 'chan-1#thread-1',
      createdAt: new Date().toISOString(),
    });
    const replySpy = vi.fn(async () => ({ id: 'ack-1' }));
    const inbounds: Directive[] = [];
    const plugin = createDiscordChannel({ clientFactory: () => stub.client, db });
    await plugin.start(
      { log: createLogger('test.discord'), onInbound: (d) => inbounds.push(d) },
      { token: 'x' },
    );
    stub.fireReady();
    await stub.emit(
      makeMessage({
        id: 'reply-msg',
        content: 'yes please',
        authorId: 'u1',
        channelId: 'thread-1',
        threadOf: 'chan-1',
        reply: replySpy,
      }),
    );
    // Should answer, not produce a new directive.
    expect(inbounds).toHaveLength(0);
    const q = pendingQuestions.getById(db, questionId);
    expect(q?.answeredAt).toBeDefined();
    expect(q?.answer).toBe('yes please');
    // Wait for the fire-and-forget ack to flush.
    await new Promise((r) => setTimeout(r, 5));
    expect(replySpy).toHaveBeenCalled();
    await plugin.stop();
  });
});

describe('DiscordChannel send', () => {
  it('routes to the thread when targetRef has `channel#thread`', async () => {
    const stub = makeStubClient();
    const db = freshDb();
    stub.channels.set('thread-xyz', {
      id: 'thread-xyz',
      send: async () => ({ id: 'out-1' }),
    });
    const plugin = createDiscordChannel({ clientFactory: () => stub.client, db });
    await plugin.start(
      { log: createLogger('test.discord'), onInbound: () => undefined },
      { token: 'x' },
    );
    stub.fireReady();
    const msg: OutboundMessage = {
      id: newId(),
      targetChannel: 'discord',
      targetRef: 'chan-1#thread-xyz',
      text: 'hi from brain',
      createdAt: new Date().toISOString(),
      attempts: 0,
    };
    const res = await plugin.send(msg);
    expect(res.delivered).toBe(true);
    expect(stub.sent).toEqual([{ channelId: 'thread-xyz', text: 'hi from brain' }]);
    await plugin.stop();
  });

  it('routes to the bare channel when targetRef has no thread', async () => {
    const stub = makeStubClient();
    const db = freshDb();
    stub.channels.set('chan-1', {
      id: 'chan-1',
      send: async () => ({ id: 'x' }),
    });
    const plugin = createDiscordChannel({ clientFactory: () => stub.client, db });
    await plugin.start(
      { log: createLogger('test.discord'), onInbound: () => undefined },
      { token: 'x' },
    );
    stub.fireReady();
    const res = await plugin.send({
      id: newId(),
      targetChannel: 'discord',
      targetRef: 'chan-1',
      text: 'hello',
      createdAt: new Date().toISOString(),
      attempts: 0,
    });
    expect(res.delivered).toBe(true);
    await plugin.stop();
  });

  it('reports delivered=false when the channel does not exist', async () => {
    const stub = makeStubClient();
    const db = freshDb();
    const plugin = createDiscordChannel({ clientFactory: () => stub.client, db });
    await plugin.start(
      { log: createLogger('test.discord'), onInbound: () => undefined },
      { token: 'x' },
    );
    stub.fireReady();
    const res = await plugin.send({
      id: newId(),
      targetChannel: 'discord',
      targetRef: 'chan-missing',
      text: 'will fail',
      createdAt: new Date().toISOString(),
      attempts: 0,
    });
    expect(res.delivered).toBe(false);
    expect(res.error).toContain('not found');
    await plugin.stop();
  });

  it('reports not-ready when called before start completes', async () => {
    const plugin = createDiscordChannel({
      clientFactory: () => makeStubClient().client,
      db: freshDb(),
    });
    const res = await plugin.send({
      id: newId(),
      targetChannel: 'discord',
      targetRef: 'chan-1',
      text: 'x',
      createdAt: new Date().toISOString(),
      attempts: 0,
    });
    expect(res.delivered).toBe(false);
    expect(res.error).toContain('not ready');
  });
});

// ---------------------------------------------------------------------------
// Phase 2.3 — pending-question button affordances
// ---------------------------------------------------------------------------

describe('readQuestionMetadata', () => {
  it('returns the questionId for an ask_user-stamped outbound', () => {
    expect(readQuestionMetadata({ kind: 'ask_user', questionId: 'Q1' })).toEqual({
      questionId: 'Q1',
    });
  });
  it('returns undefined when kind is missing or wrong', () => {
    expect(readQuestionMetadata({ questionId: 'Q1' })).toBeUndefined();
    expect(readQuestionMetadata({ kind: 'other', questionId: 'Q1' })).toBeUndefined();
  });
  it('returns undefined for non-object metadata', () => {
    expect(readQuestionMetadata(undefined)).toBeUndefined();
    expect(readQuestionMetadata(null)).toBeUndefined();
    expect(readQuestionMetadata('hello')).toBeUndefined();
  });
  it('returns undefined when questionId is empty / non-string', () => {
    expect(readQuestionMetadata({ kind: 'ask_user', questionId: '' })).toBeUndefined();
    expect(readQuestionMetadata({ kind: 'ask_user', questionId: 42 })).toBeUndefined();
  });
});

describe('parseQuestionButtonId', () => {
  it('decodes the three valid actions', () => {
    expect(parseQuestionButtonId(`${QUESTION_BUTTON_PREFIX}Q1:answer`)).toEqual({
      questionId: 'Q1',
      action: 'answer',
    });
    expect(parseQuestionButtonId(`${QUESTION_BUTTON_PREFIX}Q1:skip`)).toEqual({
      questionId: 'Q1',
      action: 'skip',
    });
    expect(parseQuestionButtonId(`${QUESTION_BUTTON_PREFIX}Q1:escalate`)).toEqual({
      questionId: 'Q1',
      action: 'escalate',
    });
  });
  it('returns undefined for non-factory custom ids', () => {
    expect(parseQuestionButtonId('something-else')).toBeUndefined();
    expect(parseQuestionButtonId('factory:question:Q1:nope')).toBeUndefined();
    expect(parseQuestionButtonId('factory:question:Q1')).toBeUndefined();
  });
  it('preserves question ids that contain a colon', () => {
    // Defensive: if a future questionId carries a colon, the parser should
    // split on the LAST colon so the action stays well-defined.
    expect(parseQuestionButtonId(`${QUESTION_BUTTON_PREFIX}Q:1:skip`)).toEqual({
      questionId: 'Q:1',
      action: 'skip',
    });
  });
});

describe('parseAnswerModalId', () => {
  it('decodes the modal customId', () => {
    expect(parseAnswerModalId(`${ANSWER_MODAL_PREFIX}Q1`)).toEqual({ questionId: 'Q1' });
  });
  it('returns undefined for non-modal ids', () => {
    expect(parseAnswerModalId('something')).toBeUndefined();
    expect(parseAnswerModalId(ANSWER_MODAL_PREFIX)).toBeUndefined();
  });
});

describe('buildQuestionComponents', () => {
  it('emits an ActionRow with three labeled buttons', () => {
    const rows = buildQuestionComponents('Q1');
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    const json = row.toJSON();
    expect(json.components).toHaveLength(3);
    const customIds = json.components.map((c) => (c as { custom_id: string }).custom_id);
    expect(customIds).toEqual([
      `${QUESTION_BUTTON_PREFIX}Q1:answer`,
      `${QUESTION_BUTTON_PREFIX}Q1:skip`,
      `${QUESTION_BUTTON_PREFIX}Q1:escalate`,
    ]);
    const labels = json.components.map((c) => (c as { label: string }).label);
    expect(labels).toEqual(['Answer', 'Skip', 'Escalate']);
  });
});

describe('buildAnswerModal', () => {
  it('uses the question text as the input label, truncating if long', () => {
    const long = 'x'.repeat(200);
    const modal = buildAnswerModal('Q1', long);
    const json = modal.toJSON();
    expect(json.custom_id).toBe(`${ANSWER_MODAL_PREFIX}Q1`);
    const input = (json.components[0]! as { components: Array<{ label: string }> }).components[0]!;
    expect(input.label.length).toBeLessThanOrEqual(45);
  });
  it('falls back to a default label when the question is empty', () => {
    const modal = buildAnswerModal('Q1', '');
    const json = modal.toJSON();
    const input = (json.components[0]! as { components: Array<{ label: string }> }).components[0]!;
    expect(input.label).toBe('Answer');
  });
});

describe('DiscordChannel send (Phase 2.3 buttons)', () => {
  it('attaches Answer/Skip/Escalate buttons when metadata.questionId is set', async () => {
    const stub = makeStubClient();
    const db = freshDb();
    stub.channels.set('thread-q', { id: 'thread-q', send: async () => ({ id: 'x' }) });
    const plugin = createDiscordChannel({ clientFactory: () => stub.client, db });
    await plugin.start(
      { log: createLogger('test.discord'), onInbound: () => undefined },
      { token: 'x' },
    );
    stub.fireReady();
    const res = await plugin.send({
      id: newId(),
      targetChannel: 'discord',
      targetRef: 'chan-1#thread-q',
      text: 'should I proceed?',
      metadata: { kind: 'ask_user', questionId: 'Q-buttons' },
      createdAt: new Date().toISOString(),
      attempts: 0,
    });
    expect(res.delivered).toBe(true);
    const row = stub.sent[0];
    expect(row?.text).toBe('should I proceed?');
    expect(row?.components).toBeDefined();
    expect(row?.components).toHaveLength(1);
    await plugin.stop();
  });

  it('omits components for plain outbounds (preserving bare-text path)', async () => {
    const stub = makeStubClient();
    const db = freshDb();
    stub.channels.set('chan-1', { id: 'chan-1', send: async () => ({ id: 'x' }) });
    const plugin = createDiscordChannel({ clientFactory: () => stub.client, db });
    await plugin.start(
      { log: createLogger('test.discord'), onInbound: () => undefined },
      { token: 'x' },
    );
    stub.fireReady();
    await plugin.send({
      id: newId(),
      targetChannel: 'discord',
      targetRef: 'chan-1',
      text: 'no question here',
      createdAt: new Date().toISOString(),
      attempts: 0,
    });
    expect(stub.sent[0]?.components).toBeUndefined();
    await plugin.stop();
  });
});

interface ButtonInteractionStub {
  customId: string;
  user: { id: string; tag: string };
  isChatInputCommand: () => false;
  isButton: () => true;
  isModalSubmit: () => false;
  showModal: ReturnType<typeof vi.fn>;
  reply: ReturnType<typeof vi.fn>;
}

function makeButtonInteraction(
  customId: string,
  userId = 'u1',
): ButtonInteractionStub & { recorded: { reply: unknown[]; showModal: unknown[] } } {
  const recorded = { reply: [] as unknown[], showModal: [] as unknown[] };
  return {
    customId,
    user: { id: userId, tag: `user${userId}#0001` },
    isChatInputCommand: () => false,
    isButton: () => true,
    isModalSubmit: () => false,
    showModal: vi.fn(async (m: unknown) => {
      recorded.showModal.push(m);
    }),
    reply: vi.fn(async (p: unknown) => {
      recorded.reply.push(p);
    }),
    recorded,
  };
}

interface ModalSubmitInteractionStub {
  customId: string;
  user: { id: string; tag: string };
  isChatInputCommand: () => false;
  isButton: () => false;
  isModalSubmit: () => true;
  fields: { getTextInputValue: (id: string) => string };
  reply: ReturnType<typeof vi.fn>;
}

function makeModalSubmitInteraction(
  customId: string,
  text: string,
  userId = 'u1',
): ModalSubmitInteractionStub & { recorded: { reply: unknown[] } } {
  const recorded = { reply: [] as unknown[] };
  return {
    customId,
    user: { id: userId, tag: `user${userId}#0001` },
    isChatInputCommand: () => false,
    isButton: () => false,
    isModalSubmit: () => true,
    fields: {
      getTextInputValue: (id: string) => (id === ANSWER_INPUT_ID ? text : ''),
    },
    reply: vi.fn(async (p: unknown) => {
      recorded.reply.push(p);
    }),
    recorded,
  };
}

async function startPluginForInteraction(
  db: ReturnType<typeof freshDb>,
): Promise<ReturnType<typeof createDiscordChannel>> {
  const stub = makeStubClient();
  const plugin = createDiscordChannel({ clientFactory: () => stub.client, db });
  await plugin.start(
    { log: createLogger('test.discord'), onInbound: () => undefined },
    { token: 'x' },
  );
  stub.fireReady();
  return plugin;
}

function seedOpenQuestion(
  db: ReturnType<typeof freshDb>,
  questionId: string,
): { directiveId: string } {
  const directiveId = newId();
  directivesQ.insert(db, {
    id: directiveId,
    source: 'discord',
    principal: 'u1',
    channelRef: 'chan-1#thread-1',
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
    channel: 'discord',
    channelRef: 'chan-1#thread-1',
    createdAt: new Date().toISOString(),
  });
  return { directiveId };
}

describe('DiscordChannel button + modal interaction', () => {
  it('Skip button writes [skip] via pendingQuestions.answer', async () => {
    const db = freshDb();
    const questionId = newId();
    seedOpenQuestion(db, questionId);
    const plugin = await startPluginForInteraction(db);
    const interaction = makeButtonInteraction(`${QUESTION_BUTTON_PREFIX}${questionId}:skip`);
    await plugin._simulateInteraction(
      interaction as unknown as Parameters<typeof plugin._simulateInteraction>[0],
    );
    const q = pendingQuestions.getById(db, questionId);
    expect(q?.answer).toBe('[skip]');
    expect(q?.answeredAt).toBeDefined();
    expect(interaction.recorded.reply).toHaveLength(1);
    expect((interaction.recorded.reply[0] as { ephemeral?: boolean }).ephemeral).toBe(true);
    await plugin.stop();
  });

  it('Escalate button writes [escalate]', async () => {
    const db = freshDb();
    const questionId = newId();
    seedOpenQuestion(db, questionId);
    const plugin = await startPluginForInteraction(db);
    const interaction = makeButtonInteraction(`${QUESTION_BUTTON_PREFIX}${questionId}:escalate`);
    await plugin._simulateInteraction(
      interaction as unknown as Parameters<typeof plugin._simulateInteraction>[0],
    );
    const q = pendingQuestions.getById(db, questionId);
    expect(q?.answer).toBe('[escalate]');
    await plugin.stop();
  });

  it('Answer button shows the modal (no answer recorded yet)', async () => {
    const db = freshDb();
    const questionId = newId();
    seedOpenQuestion(db, questionId);
    const plugin = await startPluginForInteraction(db);
    const interaction = makeButtonInteraction(`${QUESTION_BUTTON_PREFIX}${questionId}:answer`);
    await plugin._simulateInteraction(
      interaction as unknown as Parameters<typeof plugin._simulateInteraction>[0],
    );
    expect(interaction.showModal).toHaveBeenCalledTimes(1);
    expect(interaction.recorded.reply).toHaveLength(0);
    const q = pendingQuestions.getById(db, questionId);
    expect(q?.answeredAt).toBeUndefined();
    await plugin.stop();
  });

  it('Modal submit records the operator-typed answer', async () => {
    const db = freshDb();
    const questionId = newId();
    seedOpenQuestion(db, questionId);
    const plugin = await startPluginForInteraction(db);
    const interaction = makeModalSubmitInteraction(
      `${ANSWER_MODAL_PREFIX}${questionId}`,
      'yes please',
    );
    await plugin._simulateInteraction(
      interaction as unknown as Parameters<typeof plugin._simulateInteraction>[0],
    );
    const q = pendingQuestions.getById(db, questionId);
    expect(q?.answer).toBe('yes please');
    expect(q?.answeredAt).toBeDefined();
    await plugin.stop();
  });

  it('rejects an empty modal submission', async () => {
    const db = freshDb();
    const questionId = newId();
    seedOpenQuestion(db, questionId);
    const plugin = await startPluginForInteraction(db);
    const interaction = makeModalSubmitInteraction(`${ANSWER_MODAL_PREFIX}${questionId}`, '   ');
    await plugin._simulateInteraction(
      interaction as unknown as Parameters<typeof plugin._simulateInteraction>[0],
    );
    const q = pendingQuestions.getById(db, questionId);
    expect(q?.answeredAt).toBeUndefined();
    expect((interaction.recorded.reply[0] as { content: string }).content).toMatch(/empty/i);
    await plugin.stop();
  });

  it('reports already-answered when the question was previously closed', async () => {
    const db = freshDb();
    const questionId = newId();
    seedOpenQuestion(db, questionId);
    pendingQuestions.answer(db, questionId, 'previous', new Date().toISOString());
    const plugin = await startPluginForInteraction(db);
    const interaction = makeButtonInteraction(`${QUESTION_BUTTON_PREFIX}${questionId}:skip`);
    await plugin._simulateInteraction(
      interaction as unknown as Parameters<typeof plugin._simulateInteraction>[0],
    );
    expect((interaction.recorded.reply[0] as { content: string }).content).toMatch(
      /already answered/i,
    );
    const q = pendingQuestions.getById(db, questionId);
    expect(q?.answer).toBe('previous'); // unchanged
    await plugin.stop();
  });

  it('reports question-not-found when the id is unknown', async () => {
    const db = freshDb();
    const plugin = await startPluginForInteraction(db);
    const interaction = makeButtonInteraction(`${QUESTION_BUTTON_PREFIX}MISSING:skip`);
    await plugin._simulateInteraction(
      interaction as unknown as Parameters<typeof plugin._simulateInteraction>[0],
    );
    expect((interaction.recorded.reply[0] as { content: string }).content).toMatch(/not found/i);
    await plugin.stop();
  });

  it('blocks a non-allowlisted user from acting on the button', async () => {
    const db = freshDb();
    const questionId = newId();
    seedOpenQuestion(db, questionId);
    const stub = makeStubClient();
    const plugin = createDiscordChannel({ clientFactory: () => stub.client, db });
    await plugin.start(
      { log: createLogger('test.discord'), onInbound: () => undefined },
      { token: 'x', allowedUserIds: ['allowed-user'] },
    );
    stub.fireReady();
    const interaction = makeButtonInteraction(
      `${QUESTION_BUTTON_PREFIX}${questionId}:skip`,
      'someone-else',
    );
    await plugin._simulateInteraction(
      interaction as unknown as Parameters<typeof plugin._simulateInteraction>[0],
    );
    expect((interaction.recorded.reply[0] as { content: string }).content).toMatch(
      /not authorised/i,
    );
    const q = pendingQuestions.getById(db, questionId);
    expect(q?.answeredAt).toBeUndefined();
    await plugin.stop();
  });

  it('ignores foreign customIds (e.g. another bot’s buttons)', async () => {
    const db = freshDb();
    const plugin = await startPluginForInteraction(db);
    const interaction = makeButtonInteraction('not-our-bot:thing:123');
    await plugin._simulateInteraction(
      interaction as unknown as Parameters<typeof plugin._simulateInteraction>[0],
    );
    expect(interaction.recorded.reply).toHaveLength(0);
    expect(interaction.showModal).not.toHaveBeenCalled();
    await plugin.stop();
  });
});
