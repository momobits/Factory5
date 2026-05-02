# Next session kickoff

> Auto-generated from `.control/progress/STATE.md` at 2026-05-02T21:45:00Z by
> `/session-end` (manually regenerated — see Notes for next session re: PS
> hook UTF-8 bug). Edit STATE.md's "Next action" or "Notes for next session"
> to influence this prompt; **do not edit next.md by hand** — it's
> overwritten on every session end.

This is a Control-managed project. Bootstrap protocol:

1. Read `.control/progress/STATE.md` — the single source of truth.
2. Read the current phase's `README.md` and `steps.md` (path in STATE.md).
3. Check `.control/issues/OPEN/` for current-phase blockers.

If the SessionStart hook is installed, steps 1-3 run automatically and you see a structured `[control:state]` block instead of doing them by hand.

## Next action

Open [`../phases/phase-2-channel-parity/README.md`](../phases/phase-2-channel-parity/README.md) and [`steps.md`](../phases/phase-2-channel-parity/steps.md). Step **2.1 = wire Discord slash commands** per [`../../UPGRADE/plans/tier-2-channel-parity.md`](../../UPGRADE/plans/tier-2-channel-parity.md) §2.1. New file `packages/channels/src/discord-commands.ts` (definitions + handlers); edit `packages/channels/src/discord.ts` to call `client.application.commands.set(commandList, guildId?)` on `Events.ClientReady` and register an `interactionCreate` listener. Embed-formatted responses; no LLM for the read commands (`status` / `spend` / `findings`).

## Notes for next session

Phase 2 splits into ~2 sessions per the tier plan: **2a** = slash commands + `setMyCommands` + button affordances (steps 2.1-2.3); **2b** = `factory cancel` plumbing + 8-intent triage classification (steps 2.4-2.5). Step 2.6 (`factory chat` per-turn timeout) is optional — defer to Phase 3 if the streaming-progress path wins.

Discord guild-vs-global slash-command scope decision: guild-scoped when `config.guildId` is set (instant register), global otherwise (1-hour propagation). Documented in tier-2 plan §"Risks + decisions".

Phase 2 is the first phase that touches code (packages/channels, packages/brain, packages/cli, packages/state, packages/ipc). Live-smoke against a real Discord bot + Telegram bot is part of acceptance — confirm test bots are configured (`factory doctor`) before Step 2.1 starts.

**Known hook bug:** `.claude/hooks/regenerate-next-md.ps1` reads STATE.md as CP-1252 but writes UTF-8, mangling em-dashes (`—` → `â€"`) and section signs (`§` → `Â§`). The bash variant is presumably fine. Worth a small fix during Phase 2 idle — open `regenerate-next-md.ps1` and ensure both the read and write specify UTF-8 (`Get-Content -Encoding utf8`, `Out-File -Encoding utf8`).

Read [`../../UPGRADE/LOG.md`](../../UPGRADE/LOG.md) for the upgrade-side narrative across sessions; this STATE.md is the operational cursor (overwritten at each `/session-end`).
