# 0022 — Telegram long-polling lives inside the ChannelPlugin, not as a separate EventSource

- **Status:** Accepted
- **Date:** 2026-04-22

## Context

The Phase 7c plan (authored in `.control/phases/phase-7-budget-discipline/steps.md` and the 7b-close handoff) split Telegram integration into two steps:

- **7c.2** — `ChannelPlugin` implementation at `packages/channels/src/telegram.ts`
- **7c.3** — long-polling event source in `@factory5/events`

On paper this mirrors the pattern that `@factory5/events` established with `FsWatcher` (an `EventSource` that emits `Event` rows, which the daemon later materialises as directives if it wants to). The argument was that Telegram's long-polling loop "observes the outside world" the way the fs watcher does, so the polling belongs alongside fs/git/tmux event sources.

Once the plugin was implemented, the fit turned out to be poor:

- Telegram's `getUpdates` returns fully-formed `Update` records that must be scoped (private-chat vs group, allowlist, mention-detection in groups) and normalised (principal, channelRef, intent-parse, build-prefix) before they become anything meaningful. All of that scoping lives inside the channel plugin because it depends on the plugin's config (`botToken`, `allowedChatIds`, `buildPrefix`, bot identity from `getMe`).
- Discord's precedent: `discord.js`'s websocket + message event loop lives _inside_ `DiscordChannel`. There is no separate `EventSource` that emits "raw Discord message" events for the daemon to post-process. The plugin is self-contained — `start()` brings the transport up, inbound messages flow through `ctx.onInbound` as `Directive` rows.
- Splitting Telegram across two modules would duplicate lifecycle (two `start()` / `stop()` flows), leak the bot identity and config across package boundaries, and force either the event-source or the plugin to import the other.
- There are no _other_ Telegram signals today that would need the polling loop's output as `Event` rather than `Directive`. If future signals appear (typing indicators, new-member joins, file uploads not tied to a directive), we can revisit — but YAGNI applies.

## Decision

The Telegram long-polling loop lives inside `TelegramChannel` in `packages/channels/src/telegram.ts`, mirroring Discord. `@factory5/events` stays focused on observation sources that emit `Event` rows for audit / directive-materialisation (currently `FsWatcher`; future `GitWatcher`, `TmuxWatcher` fit the same shape). No new package or event source is created for Telegram.

**7c.3 in `steps.md` is closed as a no-op** — the step's intent is satisfied by the polling loop inside the plugin (tested at `telegram.test.ts ▸ TelegramChannel polling loop`). The loop maintains an `offset` cursor across polls, backs off exponentially on network errors (cap 30s), and exits cleanly on `AbortController.abort()`.

**Concrete boundary:**

- `ChannelPlugin` owns: transports (websocket, long-poll, webhook), message normalisation to `Directive`, channel-scoped config.
- `EventSource` owns: observations of local/remote state changes that may or may not become directives (file changes, git pushes, cron ticks).

If a future Telegram signal needs `Event` treatment (not `Directive`), it can be emitted from within the plugin via a second callback on `ChannelContext` — the plugin still owns the transport.

## Consequences

**Positive:**

- Single lifecycle per channel — `plugin.start()` brings the transport up; `plugin.stop()` tears it down.
- Symmetric with Discord, which matters for readers reaching for the reference plugin.
- No cross-package leakage of the bot token or identity.
- Test seam is local (`TelegramApi` interface + `apiFactory` option) — no need to stub `EventSource` + daemon + plugin separately.
- `@factory5/events` keeps a tight charter: observing state changes that may or may not become directives. Mixing in channel transports would have muddied that.

**Negative:**

- If a future third channel wants long-polling too (unlikely — webhooks are the modern default), we might duplicate a small amount of AbortController + backoff boilerplate rather than share a helper. Acceptable. If it ever hits three copies, extract a `@factory5/polling` util or a shared mixin.
- Slight divergence from the original 7c plan as written in `steps.md`. The plan was architecturally plausible but turned out to be premature layering for the 1:1 update-to-directive case Telegram currently exhibits.

**Reversible?** Yes. If future Telegram signals need `Event` treatment, we can factor the poll loop into an `EventSource` and have the plugin consume its emissions. Nothing in the data model forces the current layering.

## Alternatives considered

- **EventSource + plugin split (original plan).** Rejected above — splits one stateful loop across two modules with no distinct observer today.
- **Shared `PollingLoop` utility in a new `@factory5/polling` package.** Rejected as premature. The Discord plugin already has a different lifecycle (websocket, not HTTP long-poll); abstracting over both wouldn't save much code and would add a package boundary for no consumer.
- **Webhook transport instead of long-polling.** Telegram supports it but requires an HTTPS endpoint reachable from api.telegram.org. Rejected for factory5 because the daemon is typically run on a developer workstation / home server without a public ingress. Long-polling works from anywhere.
