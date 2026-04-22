/**
 * Round-trip integration tests for {@link TelegramChannel} using
 * realistic-shape fixtures — i.e. JSON payloads modelled on real
 * Telegram Bot API `getUpdates` responses. Identifying details (chat
 * ids, usernames, message ids) have been sanitised, but the field
 * layout matches exactly what `api.telegram.org` emits.
 *
 * Provenance: fixtures derived from the 7c.1 HALT-clearance smoke
 * (a private chat with `@Factory5_bot` plus a synthesised supergroup
 * fixture) and cross-checked against the Bot API docs at
 * https://core.telegram.org/bots/api#update. If Telegram adds or
 * renames a field we care about, these tests should fail before any
 * live-run regression.
 *
 * Where the unit suite (`telegram.test.ts`) uses handcrafted minimal
 * shapes to exercise single branches, this suite feeds end-to-end
 * fixtures through the plugin with a real SQLite db + a realistic
 * `onInbound` handler (same pattern the daemon uses) and asserts
 * against the persisted directive rows rather than just the callback.
 */

import { newId, type Directive } from '@factory5/core';
import { initLogger, createLogger } from '@factory5/logger';
import {
  directives as directivesQ,
  openDatabase,
  pendingQuestions,
  runMigrations,
} from '@factory5/state';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  createTelegramChannel,
  type TelegramApi,
  type TelegramBotIdentity,
  type TelegramUpdate,
} from './telegram.js';

beforeAll(() => {
  initLogger({ processName: 'telegram-roundtrip', noFile: true, noConsole: true });
});

// ---------------------------------------------------------------------------
// Fixtures — shape mirrors api.telegram.org/bot<token>/getUpdates
// ---------------------------------------------------------------------------

/** Synthetic personal chat (type: 'private'); chat.id === from.id. */
const PRIVATE_CHAT_HI: TelegramUpdate = {
  update_id: 413483649,
  message: {
    message_id: 4,
    from: {
      id: 111222333,
      is_bot: false,
      first_name: 'Example',
      username: 'example_user',
    },
    chat: {
      id: 111222333,
      type: 'private',
      first_name: 'Example',
      username: 'example_user',
    },
    date: 1776877536,
    text: 'Hi',
  },
};

/** Private-chat /build directive with a -- separator. */
const PRIVATE_CHAT_BUILD: TelegramUpdate = {
  update_id: 413483650,
  message: {
    message_id: 5,
    from: {
      id: 111222333,
      is_bot: false,
      first_name: 'Example',
      username: 'example_user',
    },
    chat: {
      id: 111222333,
      type: 'private',
      first_name: 'Example',
      username: 'example_user',
    },
    date: 1776877700,
    text: '/build weather -- a small CLI in Python',
  },
};

/**
 * Supergroup message that @-mentions the bot. The `entities` array is how
 * Telegram actually delivers mention metadata — the plugin uses that
 * rather than substring-matching the text.
 */
const SUPERGROUP_MENTION_BUILD: TelegramUpdate = {
  update_id: 413483651,
  message: {
    message_id: 101,
    from: {
      id: 111222333,
      is_bot: false,
      first_name: 'Example',
      username: 'example_user',
    },
    chat: {
      id: -1001234567890,
      type: 'supergroup',
      title: 'Factory Test Group',
    },
    date: 1776877800,
    text: '@Factory5TestBot /build greeter -- say hello',
    entities: [{ type: 'mention', offset: 0, length: 16 }],
  },
};

/** Same supergroup, message without a mention — should be ignored. */
const SUPERGROUP_UNMENTIONED_CHATTER: TelegramUpdate = {
  update_id: 413483652,
  message: {
    message_id: 102,
    from: {
      id: 999888777,
      is_bot: false,
      first_name: 'Other',
      username: 'another_user',
    },
    chat: {
      id: -1001234567890,
      type: 'supergroup',
      title: 'Factory Test Group',
    },
    date: 1776877900,
    text: 'random chatter, not meant for the bot',
  },
};

/**
 * Reply to a bot message — emulates a user answering a pending question.
 * `reply_to_message.message_id` matches the bot message that triggered
 * the question (id 5 in the fixture, i.e. the trigger of a build
 * directive whose channelRef is `111222333#5`).
 */
const PRIVATE_CHAT_REPLY_TO_BOT: TelegramUpdate = {
  update_id: 413483653,
  message: {
    message_id: 6,
    from: {
      id: 111222333,
      is_bot: false,
      first_name: 'Example',
      username: 'example_user',
    },
    chat: {
      id: 111222333,
      type: 'private',
      first_name: 'Example',
      username: 'example_user',
    },
    date: 1776878000,
    text: 'yes please',
    reply_to_message: {
      message_id: 5,
      from: { id: 42, is_bot: true },
    },
  },
};

// Identity matches the mention entity in the supergroup fixture.
const BOT_IDENTITY: TelegramBotIdentity = {
  id: 42,
  is_bot: true,
  username: 'Factory5TestBot',
  first_name: 'Factory5',
};

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

interface Harness {
  db: ReturnType<typeof openDatabase>;
  plugin: ReturnType<typeof createTelegramChannel>;
  delivered: TelegramUpdate[];
  sent: Array<{ chatId: number; text: string; replyToMessageId?: number }>;
  allowedChatIds?: number[];
}

async function startHarness(opts: { allowedChatIds?: number[] } = {}): Promise<Harness> {
  const db = openDatabase(':memory:');
  runMigrations(db);

  const sent: Array<{ chatId: number; text: string; replyToMessageId?: number }> = [];
  const api: TelegramApi = {
    async getMe() {
      return BOT_IDENTITY;
    },
    async getUpdates() {
      // autoPoll:false, so this is never called; return empty for safety.
      return [];
    },
    async sendMessage({ chatId, text, replyToMessageId }) {
      sent.push({
        chatId,
        text,
        ...(replyToMessageId !== undefined ? { replyToMessageId } : {}),
      });
      return { message_id: sent.length };
    },
  };

  const delivered: TelegramUpdate[] = [];
  const plugin = createTelegramChannel({
    apiFactory: () => api,
    autoPoll: false,
    db,
  });

  await plugin.start(
    {
      log: createLogger('roundtrip.telegram'),
      // Daemon-shape inbound handler — writes the Directive to the bus.
      onInbound: (d: Directive) => {
        directivesQ.insert(db, d);
      },
    },
    {
      botToken: 'fake',
      ...(opts.allowedChatIds !== undefined ? { allowedChatIds: opts.allowedChatIds } : {}),
    },
  );

  const harness: Harness = { db, plugin, delivered, sent };
  if (opts.allowedChatIds !== undefined) harness.allowedChatIds = opts.allowedChatIds;
  return harness;
}

async function stopHarness(h: Harness): Promise<void> {
  await h.plugin.stop();
  h.db.close();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Telegram round-trip — private chat', () => {
  it('lands a chat Directive in the db with the expected fields', async () => {
    const h = await startHarness();
    try {
      await h.plugin._simulateUpdate(PRIVATE_CHAT_HI);
      const rows = directivesQ.listByStatus(h.db, 'pending');
      expect(rows).toHaveLength(1);
      const d = rows[0];
      expect(d).toBeDefined();
      if (d === undefined) return;
      expect(d.source).toBe('telegram');
      expect(d.intent).toBe('chat');
      expect(d.autonomy).toBe('chat');
      expect(d.channelRef).toBe('111222333#4');
      expect(d.principal).toBe('111222333');
      expect(d.status).toBe('pending');
      const payload = d.payload as Record<string, unknown>;
      expect(payload['text']).toBe('Hi');
    } finally {
      await stopHarness(h);
    }
  });

  it('lands a build Directive with project + spec parsed', async () => {
    const h = await startHarness();
    try {
      await h.plugin._simulateUpdate(PRIVATE_CHAT_BUILD);
      const rows = directivesQ.listByStatus(h.db, 'pending');
      expect(rows).toHaveLength(1);
      const d = rows[0];
      expect(d).toBeDefined();
      if (d === undefined) return;
      expect(d.intent).toBe('build');
      expect(d.autonomy).toBe('autonomous');
      expect(d.channelRef).toBe('111222333#5');
      const payload = d.payload as Record<string, unknown>;
      expect(payload['project']).toBe('weather');
      expect(payload['spec']).toBe('a small CLI in Python');
    } finally {
      await stopHarness(h);
    }
  });
});

describe('Telegram round-trip — supergroup', () => {
  it('lands a build Directive for a @-mention message and drops chatter', async () => {
    const h = await startHarness();
    try {
      await h.plugin._simulateUpdate(SUPERGROUP_MENTION_BUILD);
      await h.plugin._simulateUpdate(SUPERGROUP_UNMENTIONED_CHATTER);
      const rows = directivesQ.listByStatus(h.db, 'pending');
      expect(rows).toHaveLength(1);
      const d = rows[0];
      expect(d).toBeDefined();
      if (d === undefined) return;
      expect(d.intent).toBe('build');
      expect(d.channelRef).toBe('-1001234567890#101');
      expect(d.principal).toBe('111222333');
      const payload = d.payload as Record<string, unknown>;
      expect(payload['project']).toBe('greeter');
      expect(payload['spec']).toBe('say hello');
      expect(payload['text']).toBe('/build greeter -- say hello');
    } finally {
      await stopHarness(h);
    }
  });
});

describe('Telegram round-trip — allowlist', () => {
  it('drops messages from chats not in allowedChatIds', async () => {
    const h = await startHarness({ allowedChatIds: [999999999] });
    try {
      await h.plugin._simulateUpdate(PRIVATE_CHAT_HI);
      expect(directivesQ.listByStatus(h.db, 'pending')).toHaveLength(0);
    } finally {
      await stopHarness(h);
    }
  });

  it('accepts messages from chats in allowedChatIds', async () => {
    const h = await startHarness({ allowedChatIds: [111222333] });
    try {
      await h.plugin._simulateUpdate(PRIVATE_CHAT_HI);
      expect(directivesQ.listByStatus(h.db, 'pending')).toHaveLength(1);
    } finally {
      await stopHarness(h);
    }
  });
});

describe('Telegram round-trip — pending question answer path', () => {
  it('records a reply-to-bot as the answer and does not create a new directive', async () => {
    const h = await startHarness();
    try {
      // Seed a running build directive that asked a question on msg 5.
      const directiveId = newId();
      const questionId = newId();
      directivesQ.insert(h.db, {
        id: directiveId,
        source: 'telegram',
        principal: '111222333',
        channelRef: '111222333#5',
        intent: 'build',
        payload: { project: 'weather' },
        autonomy: 'autonomous',
        createdAt: new Date().toISOString(),
        status: 'running',
      });
      pendingQuestions.create(h.db, {
        id: questionId,
        directiveId,
        question: 'Proceed?',
        channel: 'telegram',
        channelRef: '111222333#5',
        createdAt: new Date().toISOString(),
      });

      // Clear the seed directive from the running set so the "no new
      // directive" assertion below isn't polluted.
      const seeded = directivesQ.listByStatus(h.db, 'pending').length;
      expect(seeded).toBe(0); // status=running isn't pending

      await h.plugin._simulateUpdate(PRIVATE_CHAT_REPLY_TO_BOT);

      // No *new* directive.
      expect(directivesQ.listByStatus(h.db, 'pending')).toHaveLength(0);

      // The question is now answered.
      const q = pendingQuestions.getById(h.db, questionId);
      expect(q).toBeDefined();
      expect(q?.answeredAt).toBeDefined();
      expect(q?.answer).toBe('yes please');

      // The plugin fired an ack — give it a microtask to land.
      await new Promise((r) => setTimeout(r, 5));
      expect(h.sent).toHaveLength(1);
      expect(h.sent[0]?.chatId).toBe(111222333);
      expect(h.sent[0]?.text).toContain(questionId);
      expect(h.sent[0]?.replyToMessageId).toBe(6);
    } finally {
      await stopHarness(h);
    }
  });
});
