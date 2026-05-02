# Next session kickoff

> Auto-generated from `.control/progress/STATE.md` at 2026-05-02T18:41:10Z by
> `.claude/hooks/regenerate-next-md.ps1`. Edit STATE.md's "Next action"
> or "Notes for next session" to influence this prompt; **do not edit
> next.md by hand** -- it's overwritten on every session end.

This is a Control-managed project. Bootstrap protocol:

1. Read `.control/progress/STATE.md` -- the single source of truth.
2. Read the current phase's `README.md` and `steps.md` (path in STATE.md).
3. Check `.control/issues/OPEN/` for current-phase blockers.

If the SessionStart hook is installed, steps 1-3 run automatically and you
see a structured `[control:state]` block instead of doing them by hand.

## Next action

Open [`../phases/phase-2-channel-parity/README.md`](../phases/phase-2-channel-parity/README.md) and [`steps.md`](../phases/phase-2-channel-parity/steps.md). Step **2.3 = pending-question button affordances** per [`../../UPGRADE/plans/tier-2-channel-parity.md`](../../UPGRADE/plans/tier-2-channel-parity.md) §2.3. Touches `packages/channels/src/discord.ts` `send()` (attach `ActionRowBuilder` with Answer/Skip/Escalate buttons when `msg.metadata.questionId` is set), `packages/channels/src/telegram.ts` `send()` (inline_keyboard via `reply_markup`), and the Telegram poll loop to handle `callback_query` updates alongside messages. Discord side also needs a button-`interactionCreate` branch (in addition to slash). The legacy thread-reply / reply-to-bot answer path stays intact — buttons are additive.


## Notes for next session

Phase 2 split, recap: **2a** = 2.1 + 2.2 + 2.3 (slash + setMyCommands + button affordances) — 2.1 + 2.2 done this session; 2.3 is what's left in 2a. **2b** = 2.4 + 2.5 (cancel-kills-workers + 8-intent triage). Step 2.6 (`factory chat` per-turn timeout) is optional and deferrable to Phase 3 if the streaming path wins.

**Step 2.3 design notes** (read before starting):

- The shape is symmetric between transports: when an outbound message has metadata flagging it as a pending-question prompt, attach button affordances. The brain emits the outbound; the channel plugin's `send()` is what attaches the buttons. So the contract change is: the outbound message needs a way to signal "this is a question" + carry the question id.
- Today the plugins look up pending-question rows via `channelRef`-LIKE matching for the answer path; for the outbound side, the brain's outbound emitter doesn't pass extra metadata. Two options: (a) add a `metadata: { questionId }` field to the `OutboundMessage` schema, or (b) have the channel plugin look up "is there an open pending question for this directive?" by directiveId before sending. Option (a) is cleaner — explicit signal beats inferred.
- Discord buttons: `ActionRowBuilder<ButtonBuilder>` with three buttons. CustomIds like `factory:question:<id>:answer`, `factory:question:<id>:skip`, `factory:question:<id>:escalate`. The "Answer" button opens a `ModalBuilder` with a single `TextInputBuilder`; submission lands in `interactionCreate` as a `ModalSubmitInteraction`.
- Telegram inline keyboards: `reply_markup: { inline_keyboard: [[ {text, callback_data} ... ]] }`. Callbacks come back as `update.callback_query` — the poll loop currently only requests `allowed_updates: ['message']`, so it'll need `['message', 'callback_query']`.
- `pendingQuestions.answer(db, id, text, ts)` is the existing call; both flows funnel through it.

**Code-touching surfaces this session (cumulative for Phase 2 so far):**

- `packages/channels/src/{discord,telegram,command-handlers,discord-commands}.ts` — primary
- `packages/channels/src/{registry,types}.ts` — added `setProjectBudget` callback
- `packages/daemon/src/index.ts` — bound `registrySetProjectBudget` over `wiki.updateProjectMetadata`
- All four `pnpm` gates green; full workspace 938 tests pass.

**Live-smoke acceptance still pending** for Phase 2: `/factory <cmd>` against a real Discord bot, `/<cmd>` against a real Telegram bot, with both `setMyCommands`-registered and slash-registered surfaces honoured. Done at `/phase-close` (step 2.7) once 2.3+2.4+2.5 land.

**Hook fix (cleared):** `.claude/hooks/regenerate-next-md.ps1` previously read STATE.md as CP-1252 (default for `Get-Content` on en-US Windows) but wrote UTF-8 with BOM, mangling em-dashes (`—` → `â€"`) and section signs (`§` → `Â§`). Fixed in this session-end commit: `Get-Content -Encoding utf8` + `WriteAllText` with a `UTF8Encoding $false` (no BOM) for parity with the bash sibling. The `next.md` produced by THIS session-end is the first run with the fix.

Read [`../../UPGRADE/LOG.md`](../../UPGRADE/LOG.md) for the upgrade-side narrative across sessions; this STATE.md is the operational cursor (overwritten at each `/session-end`).