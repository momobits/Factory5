# @factory5/channels

`ChannelPlugin` interface, `ChannelRegistry`, and channel implementations. Lives in the **daemon** process.

## Status

- **Interface** — defined (`src/types.ts`)
- **`cli-rpc` channel** — phase-3 (ADR 0014). HTTP POST inbound + SQLite-polled outbound, with a pluggable in-process listener for future SSE.
- **`discord` channel** — phase-4 (this release). `discord.js` plugin with full thread discipline: mentions spawn threads, follow-ups in a thread auto-answer pending questions, /build prefix switches the directive to `intent=build`.
- **`telegram` channel** — future (Phase 5+)
- **`web` channel** — future

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

## Adding a channel

1. Implement `ChannelPlugin` from `src/types.ts`
2. Export from `src/index.ts`
3. Register from the daemon assembly (`packages/daemon/src/index.ts → buildDefaultChannelPlugins`) if it should be on by default when configured, or accept via `DaemonOptions.channelPlugins`
4. Add a row to `docs/ARCHITECTURE.md` channels table
