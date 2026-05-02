# Tier 2 — Channel parity

**Goal**: Discord and Telegram match the brain's full eight-intent vocabulary. Operators can run `status / spend / findings / resume / cancel / budget` from the chat surface they prefer, not just the CLI.

**Why this tier**: closes the most-felt gap from the audit — today Discord/Telegram are essentially "kick off a build" or "free-form chat" only.

**Estimated effort**: 2 sessions. Suggested split:

- Session 2a: Discord slash commands + Telegram `setMyCommands` + button affordances.
- Session 2b: `factory cancel` brain hook + IPC route + triage classification.

**Issues addressed**: U004, U011, U012, U013, U023, partially U005.

---

## Pre-requisites

Read before starting:

- [`../AUDIT.md`](../AUDIT.md) §2 (channel parity)
- `packages/channels/src/discord.ts` — Discord plugin
- `packages/channels/src/telegram.ts` — Telegram plugin
- `packages/brain/src/triage.ts` — current triage prompt
- `packages/brain/src/pool.ts` — worker pool (for cancel plumbing)
- `packages/state/src/queries/{directives,spend,findings-registry,projects}.ts` — read-side queries the slash commands will use
- ADR 0014 (cli-rpc), ADR 0022 (telegram-polling-in-plugin), ADR 0027 (web UI mutation surface — same response shapes will work for slash-command outputs)

Discord: ensure you have a test bot; Telegram: ensure `testChatId` is configured. Live smoke is part of acceptance.

---

## Sub-tasks

### 2.1 Discord slash commands

**Today**: `discord.ts:69` reserves `applicationId` _"used by future slash-command wiring"_. Field is read but not used.

**Wire**:

1. On `Events.ClientReady`, call `client.application.commands.set(commandList, guildId?)`. Use guild-scoped commands when `config.guildId` is set (instant register); fall back to global when not (1-hour propagation).

2. Define the slash command list. Suggested initial set:

   | Command             | Purpose                                              | Args                                                          |
   | ------------------- | ---------------------------------------------------- | ------------------------------------------------------------- |
   | `/factory status`   | List active + recent directives                      | `[--limit <n>]`                                               |
   | `/factory spend`    | Spend summary                                        | `[--project <name>] [--group-by directive\|day\|model]`       |
   | `/factory findings` | List/show findings                                   | `[--project <name>] [--severity <level>]`                     |
   | `/factory resume`   | Resume a stopped build                               | `<project>`                                                   |
   | `/factory cancel`   | Cancel a running directive                           | `<directive-id>`                                              |
   | `/factory budget`   | Set per-project budget                               | `<project> [--max-usd <n>] [--max-steps <n>]`                 |
   | `/factory build`    | Kick off a build (parity with `@bot /build` mention) | `<project> [--autonomy ...] [--language ...] [--max-usd ...]` |

3. Add an `interactionCreate` listener that dispatches by `interaction.commandName`. Each handler reads from SQLite or emits a directive (cancel + resume + build + budget set are mutations; status + spend + findings are reads).

4. Format responses as Discord embeds (`EmbedBuilder` from `discord.js`). Tables are easier to read in embeds; the existing plain-text outbound path is still used for chat-thread replies.

5. **No LLM** for status / spend / findings — these read SQLite directly via the same query helpers the web UI uses.

**File pointers**:

- New: `packages/channels/src/discord-commands.ts` — command definitions + handlers.
- Edit: `packages/channels/src/discord.ts` — wire `commands.set()` on ready, register `interactionCreate` listener.
- Reuse: `packages/state/src/queries/*.ts` for reads; `packages/wiki/src/project-metadata.ts` for budget writes.

**Acceptance**: `/factory <cmd>` autocompletes in a Discord client; each command returns a real response; mutations persist (budget change reflected in `project.json`; cancel actually flips status).

### 2.2 Telegram bot commands

**Today**: Telegram parses `/build` and treats everything else as chat. No `setMyCommands` call.

**Wire**:

1. On `start()`, after `getMe`, call `setMyCommands` with the same list as Discord (different transport, same vocabulary). Telegram will show these in the `/` menu autocomplete.

2. Extend the inbound parser: alongside the existing `/build` branch, parse `/<cmd> [args]` for the command list. Match against the same handler functions (suggested: extract command handlers into a transport-agnostic module that both Discord and Telegram dispatch to).

3. Format responses as plain text with monospace-where-helpful (Telegram's HTML / MarkdownV2 modes). For tables, use aligned monospace blocks.

**File pointers**:

- New: `packages/channels/src/command-handlers.ts` — transport-agnostic handler functions: `handleStatus`, `handleSpend`, `handleFindings`, `handleResume`, `handleCancel`, `handleBudget`. Each takes a context object with the SQLite handle + outbound emitter + auth principal; returns a structured result the transport formats.
- Edit: `packages/channels/src/telegram.ts` — parser branch + `setMyCommands` call + result formatter.
- Edit: `packages/channels/src/discord.ts` — interaction handler calls the same shared handlers; formats via embeds.

**Acceptance**: Telegram `/` menu lists factory commands; each works; replies are clean.

### 2.3 Pending-question button affordances

**Today**: pending-question outbound message is plain text. Operator must reply in-thread (Discord) or reply-to-bot (Telegram).

**Wire**:

- **Discord**: when sending a pending-question outbound, attach an `ActionRowBuilder` with three buttons: "Answer" (opens a Modal), "Skip" (records `(skipped)` as the answer), "Escalate" (escalates to the operator's principal user — owner or `allowedUserIds[0]`).
- **Telegram**: same shape via inline keyboards (`reply_markup: { inline_keyboard: [[...]] }`). Telegram's button-callback model is `callback_query`; the bot polls for these alongside messages.

Buttons are optional UX — the existing thread-reply / reply-to-bot path still works. Buttons are added on top.

**File pointers**:

- Edit: `packages/channels/src/discord.ts` `send()` — when `msg.metadata.questionId` is set, attach the button row.
- Edit: `packages/channels/src/telegram.ts` `send()` — same; inline_keyboard.
- Edit: poll loop in telegram.ts to handle `callback_query` updates (currently it only handles `message`).
- Edit: discord.ts to handle button `interactionCreate` (in addition to the slash-command handler).

**Acceptance**: a pending-question message in Discord/Telegram has working "Answer / Skip / Escalate" buttons.

### 2.4 `factory cancel <directive-id>` — brain + IPC + CLI

**Today**: `factory directive mark-blocked <id>` flips status to `blocked` but doesn't kill the worker. Workers continue running until they finish or hit their own limits.

**Wire**:

1. **Brain hook**: in `packages/brain/src/serve.ts` and `packages/brain/src/pool.ts`, expose a per-directive `AbortController`. The pool already accepts `AbortSignal` per-task; surface a directive-level controller that aborts all tasks for that directive.

2. **State helper**: `cancelDirective(db, directiveId, reason)` in `packages/state/src/queries/directives.ts`. Marks directive `failed` with `blocked_reason: reason ?? 'cancelled'`. Idempotent: no-op if directive already terminal.

3. **IPC route**: `POST /directives/:id/cancel` on factoryd. Body: `{ reason?: string }`. Calls `cancelDirective` + signals the per-directive AbortController. Returns the updated directive.

4. **CLI command**: `packages/cli/src/commands/cancel.ts` — thin wrapper that hits the IPC route. If the daemon isn't running, falls back to calling `cancelDirective` against SQLite directly (the directive is paused, even if not killed mid-run).

5. **Update existing `directive mark-blocked` doc**: keep it as the "mark stuck rows blocked without killing anything" tool; `cancel` is the new "actively kill + mark failed" tool.

6. **Worker shutdown discipline**: ensure workers handle the AbortSignal cleanly:
   - `claude -p` subprocess: `child.kill('SIGTERM')` then SIGKILL after 5s.
   - Worker process itself: emits a final `task.cancelled` finding to the BUILD.md trail before exiting.

**File pointers**:

- Edit: `packages/brain/src/pool.ts` — per-directive controller registry.
- Edit: `packages/brain/src/serve.ts` — wire abort propagation.
- Edit: `packages/state/src/queries/directives.ts` — `cancelDirective(db, id, reason)`.
- Edit: `packages/ipc/src/schemas.ts` — `cancelDirectiveRequestSchema`, `cancelDirectiveResponseSchema`.
- Edit: `packages/ipc/src/client.ts` — `DaemonClient.cancelDirective()`.
- Edit: `packages/daemon/src/server.ts` — route handler.
- New: `packages/cli/src/commands/cancel.ts`.
- Edit: `packages/worker/src/run-worker.ts` — handle SIGTERM, emit cancelled-finding, exit clean.

**Acceptance**: `factory cancel <id>` against a running build kills the workers within 10 seconds, marks the directive `failed` with `blocked_reason: 'cancelled'`, and the worktree is cleaned up. New tests: brain pool abort, daemon route, CLI command.

### 2.5 Triage classifies chat across 8 intents

**Today**: anything from a channel that's not `/build ...` becomes `intent=chat`. The brain's triage runs but its output is currently used to confirm the intent — there's no re-routing if triage classifies a chat-shaped message as `intent=status`.

**Wire**:

1. **Update triage prompt** in `packages/brain/src/triage.ts` (or wherever it lives — likely in `prompts/agents/triage.md` if loaded from there). Make sure the prompt enumerates all 8 intents with examples, and instructs the model to pick the most likely.

2. **Add re-routing in channel handlers**: when an inbound is classified as `intent=status / spend / findings / resume / cancel`, **don't** create a chat directive. Instead, dispatch through the same shared `command-handlers.ts` (Tier 2.2) and reply with the structured response.

3. **Keep `intent=chat` and `intent=build` and `intent=fix / review / investigate`** flowing through the existing brain pipeline.

**File pointers**:

- Edit: `packages/brain/src/triage.ts` — confirm the classifier returns one of the 8 intents.
- Edit: `prompts/agents/triage.md` (if exists) — enumerate intents with examples.
- Edit: `packages/channels/src/{discord,telegram}.ts` — after triage, switch on `intent` and re-route to `command-handlers.ts` for read-only intents.
- Test: a chat message _"how's the spend?"_ triggers `intent=status` (or `spend`), and the channel reply is a status table, not a chat-LLM round-trip.

**Acceptance**: 4 new test fixtures (chat → status, chat → spend, chat → findings, chat → resume) — each shows the channel handler dispatching to the read-side instead of creating an `intent=chat` directive.

### 2.6 (Optional, defer-on-friction) Increase `factory chat` REPL turn timeout

**Today**: 120s — too short for builds.

**Two paths**:

- **Cheap**: bump `TURN_TIMEOUT_MS` in `packages/cli/src/commands/chat.ts:42` to 600s and rely on user `Ctrl-C`.
- **Better**: stream partial daemon-side messages (e.g. "still working — turn 3", "waiting on triage") so the operator sees progress within the existing window.

The cheap path is fine for Tier 2; the better path can be Tier 3 (folded into the SSE work).

---

## Acceptance criteria for the whole tier

- All four `pnpm` gates pass.
- Slash commands work on Discord (live test against a real bot).
- Telegram `/` menu lists commands; each works (live test).
- Pending-question buttons work on both surfaces.
- `factory cancel <id>` actually kills workers (verified via process inspection during a long-running build).
- Triage classification of chat messages produces non-`intent=chat` outputs at least 1/4 of the time on a representative test set.
- All issues U004, U011, U012, U013, U023 marked Resolved.
- Append session entries to [`../LOG.md`](../LOG.md).
- Tick Tier 2 checkboxes in [`../ROADMAP.md`](../ROADMAP.md).

---

## Risks + decisions

- **Discord guild-vs-global slash-command scope** — pick one. Guild-scoped is faster to register but only works in the configured guild; global takes up to an hour to propagate but works everywhere the bot is invited. Recommendation: guild-scoped when `config.guildId` set, global otherwise.
- **Telegram MarkdownV2 escaping** — the `_*[]()~\``>#+-=|{}.!` set must be escaped in MarkdownV2 messages. Either use the simpler HTML mode or an existing escape helper. Test with usernames that contain `_`.
- **Triage cost** — adding triage classification before every channel chat means every chat message hits the LLM. This was already happening (just for chat-intent confirmation); now triage's output is load-bearing. Verify spend doesn't balloon.
- **Worker abort discipline** — long-running `claude -p` subprocesses need SIGTERM grace. Test on Windows + Linux; Windows job-object cleanup can be sticky.

---

## Specs to write

Add these to `UPGRADE/specs/` as the work progresses:

- `specs/discord-slash-commands.md` — full command list + arg shapes + response shapes (embed structure).
- `specs/telegram-bot-commands.md` — parallel for Telegram, plus `setMyCommands` payload.
- `specs/cancel-directive.md` — IPC route shape, brain abort plumbing, worker-shutdown discipline.

---

## Suggested commit shape

Several commits, one per 2.x sub-task:

1. `feat(channels): wire Discord slash commands`
2. `feat(channels): wire Telegram setMyCommands + parser`
3. `feat(channels): pending-question button affordances`
4. `feat(brain,cli): factory cancel — kills workers, not just flips status`
5. `feat(brain): triage classifies chat across 8 intents; channel handlers re-route reads`
