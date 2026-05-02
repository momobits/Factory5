# @factory5/channels

`ChannelPlugin` interface, `ChannelRegistry`, and channel implementations. Lives in the **daemon** process.

## Status

- **Interface** — defined in `src/types.ts`. Three plugins implement it today (`cli-rpc`, `discord`, `telegram`). A fourth inbound surface — the web UI — lives in the daemon as a Fastify mount and deliberately is **not** a `ChannelPlugin`; see [Web — not a `ChannelPlugin`](#web--not-a-channelplugin) below.
- **`cli-rpc` channel** — `id: 'cli'`. ADR 0014. The CLI writes directives directly into SQLite and rings `POST /directives/notify`; on the outbound side, `factory chat` REPL sessions register an in-process listener via `registerSession()` for live push delivery, and disconnected CLIs fall back to polling the `outbound_messages` queue.
- **`discord` channel** — `id: 'discord'`. ADR 0014. `discord.js`-backed plugin with thread discipline: a mention in a text channel opens a fresh thread; follow-ups in the thread auto-answer the matching `pending_questions` row or, if none is open, become a new `intent=chat` directive. `/build <name>` switches the directive to `intent=build`.
- **`telegram` channel** — `id: 'telegram'`. ADR 0022. Long-polling loop against the Bot API over raw HTTP (no SDK). Reply-to matcher for pending questions, private-vs-group scoping, allow-list. Live smoke: `scripts/telegram-smoke.ts`.
- **Web UI** — Fastify mount in the daemon (`/app/*` static SPA + `/api/v1/*` JSON API gated by `FACTORY5_UI_TOKEN`). ADRs 0025 + 0027. Inbound directives flow through `POST /api/v1/builds` and `POST /api/v1/pending-questions/:id/answer`; the SPA reads from `/api/v1/{directives,pending-questions,spend,findings,projects}` directly. Not exported from this package — it's not a `ChannelPlugin`.

`ChannelId` enum (`@factory5/core/constants.ts`) is `'cli' | 'discord' | 'telegram'`. The legacy `'github'` and `'webhook'` entries were dropped per ADR 0019.

## Registry

```ts
import {
  createChannelRegistry,
  createCliRpcChannel,
  createDiscordChannel,
} from '@factory5/channels';

const registry = createChannelRegistry({
  log,
  plugins: [
    { plugin: createCliRpcChannel() },
    { plugin: createDiscordChannel(), config: { token: '...' } },
  ],
  onInbound: (directive) => {
    /* insert + ring doorbell */
  },
});
await registry.start();
const result = await registry.send(outboundMessage);
```

`registry.start()` runs each plugin's `configSchema.parse()` before invoking `plugin.start()` so misconfigured plugins surface a validation error rather than silently booting broken. `registry.send()` fans to the right plugin by `msg.targetChannel` and returns the plugin's `SendResult`.

## Discord plugin

```ts
import { createDiscordChannel } from '@factory5/channels';

const channel = createDiscordChannel();
// Daemon/wiring picks the config block out of `config.toml → [channels.discord]`.
```

Config (validated by `discordConfigSchema`):

| Field              | Required | Notes                                                                               |
| ------------------ | :------: | ----------------------------------------------------------------------------------- |
| `token`            |    ✅    | Bot token. Stored in `config.toml` under `[channels.discord]`.                      |
| `applicationId`    |          | Discord application id (used by future slash-command wiring).                       |
| `guildId`          |          | Restrict the bot to a single guild. Omit to accept any guild it's in.               |
| `defaultChannelId` |          | Channel to post into when a message has no thread context.                          |
| `allowedUserIds`   |          | Allow-list by Discord user id. Empty ⇒ anyone.                                      |
| `buildPrefix`      |          | Mentioned text that begins with this is parsed as `intent=build`. `/build` default. |

**Thread discipline.** A bot mention in a regular text channel opens a fresh thread (`startThread({ name: 'factory: …' })`) so concurrent directives don't interleave. `channelRef` is emitted as `<parentChannelId>#<threadId>`. Follow-up messages in the thread:

- If any `pending_questions` row has `channelRef` ending in `#<threadId>` and is unanswered, the message text is recorded as that question's answer — no new directive is created, and the bot posts `(answered question <id>)` as an acknowledgement.
- Otherwise the message is normalised as a new `intent=chat` directive tied to the same thread.

`send(msg)` parses `msg.targetRef` as `<channelId>[#<threadId>]`, fetches the channel (threads are channels in discord.js), and posts.

### Test injection

`createDiscordChannel({ clientFactory, db })` accepts an optional stub factory:

```ts
import { createDiscordChannel, type DiscordClientLike } from '@factory5/channels';

const stub: DiscordClientLike = /* ... */;
const channel = createDiscordChannel({ clientFactory: () => stub, db: testDb });
await channel._simulateMessage(stubMessage);
```

This is how the unit tests + `scripts/e2e-daemon.ts --discord` exercise the full path without a real bot token.

## Telegram plugin

```ts
import { createTelegramChannel } from '@factory5/channels';

const channel = createTelegramChannel();
// Daemon picks the config block out of `config.toml → [channels.telegram]`.
```

Config (validated by `telegramConfigSchema`):

| Field            | Required | Notes                                                                                                             |
| ---------------- | :------: | ----------------------------------------------------------------------------------------------------------------- |
| `botToken`       |    ✅    | Bot token from `@BotFather`. Stored in `config.toml` under `[channels.telegram]`.                                 |
| `allowedChatIds` |          | Allow-list of integer chat ids (private = user id; group / supergroup = negative id). Empty ⇒ any reachable chat. |
| `buildPrefix`    |          | Mentioned text starting with this is parsed as `intent=build`. Defaults to `/build`.                              |
| `pollTimeoutSec` |          | Long-poll timeout passed to `getUpdates` (Telegram caps at 60s; 30s is the sweet spot). Defaults to 30.           |
| `testChatId`     |          | Recorded at HALT clearance for live-smoke targets; the runtime ignores it.                                        |

**Private vs group scoping.** In private chats every non-bot message is treated as inbound. In groups / supergroups the bot only processes messages that either `@<botUsername>`-mention it or reply to one of its messages — without that gate the bot would react to every line of group chatter.

**Pending-question matching.** When the operator uses Telegram's reply-to feature on a bot message, the plugin pins the answer to that exact question via `pending_questions.bot_message_id` (the outbound worker stamps the column with the provider's `message_id` on delivery — issue I012). It falls back to a `channel_ref LIKE '<chatId>#%'` lookup for pre-migration-008 rows or for outbounds whose delivery succeeded before the column could be stamped. ADR 0024 §4 applies: if the linked task is already terminal, the answer is recorded for forensic value but a loud warning is logged.

**Polling discipline.** Maintains an `offset` cursor (last `update_id + 1`) for exactly-once delivery per bot token. On network / 5xx errors it backs off 1s → 2s → 4s, capped at 30s. An HTTP 409 from Telegram (another process polling the same token) logs an error and exits the loop; `start()` should be called in exactly one daemon instance per token.

`send(msg)` parses `msg.targetRef` as `<chatId>` or `<chatId>#<messageId>` and posts via `/sendMessage`, threading the reply with `reply_to_message_id` when a message id is present — the closest thing Telegram has to a Discord thread.

### Test injection

`createTelegramChannel({ apiFactory, autoPoll, db })` accepts:

```ts
import { createTelegramChannel, type TelegramApi } from '@factory5/channels';

const stub: TelegramApi = /* ... */;
const channel = createTelegramChannel({
  apiFactory: () => stub,
  autoPoll: false,        // tests drive updates directly
  db: testDb,
});
await channel._simulateUpdate(stubUpdate);
```

- `apiFactory` stubs the HTTP layer (`getMe` / `getUpdates` / `sendMessage`).
- `autoPoll` defaults to `true`; tests set `false` and feed updates via `_simulateUpdate`.
- `db` is optional; otherwise the plugin opens the default factory db on `start()`.

Live smoke against a real bot + real chat: `scripts/telegram-smoke.ts`.

## Web — not a `ChannelPlugin`

The web UI is an inbound surface, but it does **not** implement `ChannelPlugin` and is not exported from this package. It lives in the daemon as a Fastify mount per ADRs 0025 and 0027:

- `/app/*` — static SPA bundle (Astro), served via `@fastify/static`. Loopback-only at the bind layer; not bearer-gated (the HTML / JS / CSS reveals nothing operator-specific).
- `/api/v1/*` — JSON API gated by `FACTORY5_UI_TOKEN` (per-startup 48-hex token, scope-separated from the worker token per ADR 0025 §2). Reads cover directives, pending questions, spend, findings, projects. Mutations (ADR 0027) are `POST /api/v1/pending-questions/:id/answer`, `POST /api/v1/builds`, and `PUT /api/v1/projects/:id/budget`.

Inbound directives originating in the browser are inserted into the `directives` table by the daemon's mutation routes and ring the same `directive.new` doorbell the channel registry uses — so the brain treats a web-originated build identically to a CLI- or Discord-originated one. There is no `createWebChannel()` factory in this package and no `'web'` entry in `ChannelId`. The boundary exists because:

- The web UI's operator-facing surface is a JSON API + SPA, not a streaming chat. There's no concept of an outbound "message to push to a browser tab" — the SPA pulls state from the read endpoints when a page loads.
- All operator-specific state the SPA needs is already in SQLite; a `ChannelPlugin.send()` would have nothing to do.
- Auth, transport, and routing are daemon concerns (Fastify + bearer + URL versioning), not channel concerns.

The matching code lives in `packages/daemon/src/server.ts` and `apps/factory-web/`. ADR 0028 (worker sandbox) is the contract for any worker-originating writes that flow through the brain rather than the UI directly.

## Adding a channel

1. Implement `ChannelPlugin` from `src/types.ts`
2. Export from `src/index.ts`
3. Register from the daemon assembly (`packages/daemon/src/index.ts → buildDefaultChannelPlugins`) if it should be on by default when configured, or accept via `DaemonOptions.channelPlugins`
4. Add a row to `docs/ARCHITECTURE.md` channels table
