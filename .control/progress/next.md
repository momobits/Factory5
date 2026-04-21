# Next session — paste this to start

Continue Phase 7, sub-phase 7c — Telegram channel.
Phase 7b is closed (tag `phase-7b-spend-dashboard-closed`).
**7c.1 is a [HALT] gate — operator must provide secrets before implementation starts.**

Read `CLAUDE.md`, then `.control/progress/STATE.md`, then
`.control/phases/phase-7-budget-discipline/README.md` and
`.control/phases/phase-7-budget-discipline/steps.md` for the 7-step
7c checklist (7c.1 HALT, 7c.2 → 7c.7 remain).

Also read:

- `docs/Phase7_Progress.md` — the §"Phase 7b — cross-session spend
  dashboard" section summarises what just shipped; the §"Phase 7c"
  outline at the bottom sketches the Telegram scope.
- `docs/decisions/0019-drop-github-integration.md` — **durable
  doctrine** that frames 7c: factory's outbound effects are
  operator-directed per-directive, not pattern-driven. Telegram is
  the third channel (after CLI + Discord); Discord is the reference
  plugin. No webhook spam, no pattern-driven messaging.
- `packages/channels/src/discord.ts` (or whatever Discord's entry
  point is at 7c's open) as the reference `ChannelPlugin`
  implementation to mirror.

## Decisions awaiting your input

**7c.1 — HALT: secrets needed.** To unblock 7c.2, please provide:

1. **Telegram bot token** — create a bot via
   [@BotFather](https://t.me/BotFather) on Telegram and paste the
   token back here. Format: `<digits>:<alphanumeric-35>`.
2. **Target chat-id** — one chat you're OK using for smoke tests.
   Options: (a) your personal chat with the bot (start the bot and
   send it any message; we can derive the chat-id from the first
   update), (b) a small test group you create and add the bot to.

**How to provide them:** either

- **Persistent (recommended):** write both to `~/.factory5/config.toml`
  under a new `[channels.telegram]` section with keys `botToken` and
  `testChatId`. 7c.4 formalises this config shape; for the HALT
  clearance anything parseable is fine.
- **Session-only:** paste here or set env vars
  `TELEGRAM_BOT_TOKEN` + `TELEGRAM_TEST_CHAT_ID` before the session
  starts.

**Once secrets are in place,** 7c.2 — `packages/channels/src/telegram.ts`
implementing `ChannelPlugin` — can begin (1 session). 7c.3 long-polling
event source in `@factory5/events` (Telegram's preferred transport,
no webhook server needed). 7c.4 state config shape. 7c.5 round-trip
integration test using recorded fixtures. 7c.6 live run against the
provided test chat. 7c.7 phase close.

Report back a 5-line status in this shape:

```
Phase 7 — Operator-control + budget discipline, sub-phase 7c — Telegram channel, step 7c.1 (HALT)
Last action: Phase 7b closed (commits beb540a → ecce6ef; 428 tests green; tag phase-7b-spend-dashboard-closed)
Git: branch=main, last=<sha> <subject>, uncommitted=<yes/no>, tag=phase-7b-spend-dashboard-closed
Open blockers: 0 (I008 closed in 7b.1)
Proposed next action: 7c.1 HALT — confirm operator has provided Telegram bot token + test chat-id; then begin 7c.2
Ready to proceed?
```

Budget for Phase 7c: 1–2 sessions (1 for implementation, optional
second for fixture recording + live run polish). Near-zero LLM spend
if done thoroughly; Telegram's API is HTTP, not an LLM surface.

Execution order for Phase 7: **7a → 7b → 7c** (strict). 7a + 7b both
closed. After 7c.7, Phase 7 closes with tag `phase-7-closed` and
Phase 8 opens (not yet charted — options: Web UI, assessor tier-3,
worker-subprocess `ask_user`).

**Operator follow-up from Phase 6 close, out-of-band whenever
convenient (none block 7c):** revoke the `env:GITHUB_TOKEN` PAT at
https://github.com/settings/tokens, delete the throwaway repo
(`gh repo delete momobits/factory5-6b-smoke --yes`), clear the env
var (`reg delete "HKCU\Environment" /v GITHUB_TOKEN /f`).
