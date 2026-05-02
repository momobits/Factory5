# Next session kickoff

> Auto-generated from `.control/progress/STATE.md` at 2026-05-02T21:30:00Z by
> `/phase-close`. Edit STATE.md's "Next action" or "Notes for next session"
> to influence this prompt; **do not edit next.md by hand** — it's
> overwritten on every session end.

This is a Control-managed project. Bootstrap protocol:

1. Read `.control/progress/STATE.md` — the single source of truth.
2. Read the current phase's `README.md` and `steps.md` (path in STATE.md).
3. Check `.control/issues/OPEN/` for current-phase blockers.

If the SessionStart hook is installed, steps 1-3 run automatically and you see a structured `[control:state]` block instead of doing them by hand.

## Next action

**Phase 2 kickoff — channel parity.** Phase 1 (doc-sweep) closed at tag `phase-1-doc-sweep-closed`; the next phase wires Discord and Telegram up to the brain's full eight-intent vocabulary so operators can run `status` / `spend` / `findings` / `resume` / `cancel` / `budget` from chat surfaces, not just the CLI.

Open [`../phases/phase-2-channel-parity/README.md`](../phases/phase-2-channel-parity/README.md) and [`steps.md`](../phases/phase-2-channel-parity/steps.md). Step **2.1 = wire Discord slash commands** per [`../../UPGRADE/plans/tier-2-channel-parity.md`](../../UPGRADE/plans/tier-2-channel-parity.md) §2.1. New file `packages/channels/src/discord-commands.ts` (definitions + handlers); edit `packages/channels/src/discord.ts` to call `client.application.commands.set(commandList, guildId?)` on `Events.ClientReady` and register an `interactionCreate` listener that dispatches by `interaction.commandName`. Embed-formatted responses; **no LLM** for `status` / `spend` / `findings` (they read SQLite directly via the same query helpers the web UI uses).

Before starting 2.1: skim ADR 0014 (cli-rpc) and ADR 0027 (web UI mutation surface — the response shapes will work for slash-command outputs too). Confirm a Discord test bot is configured and reachable (`factory doctor --skip-call` to verify).

## Notes for next session

Phase 2 is split into roughly two sessions per the tier plan: 2a covers slash commands + `setMyCommands` + button affordances (steps 2.1-2.3); 2b covers `factory cancel` plumbing + 8-intent triage classification (steps 2.4-2.5). Step 2.6 (`factory chat` per-turn timeout) is optional and can be deferred to Phase 3 if the streaming-progress path is preferred.

Discord guild-vs-global slash-command scope: pick guild-scoped when `config.guildId` is set (instant register), global otherwise (1-hour propagation). This is documented in the tier-2 plan §"Risks + decisions".

Last test baseline (2026-05-02): 876 passed, 3 skipped (Windows/Linux-only sandbox branches). All four `pnpm` gates clean throughout Phase 1.
