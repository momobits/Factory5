---
id: I012
severity: LOW
area: channels/telegram
status: OPEN
created: 2026-04-23
---

# Telegram Reply-feature answer matcher is FIFO, not targeted — can't pick a specific open question

## Description

`TelegramChannel.maybeAnswerPendingQuestion`
(`packages/channels/src/telegram.ts:627-654`) matches a reply to an open
`pending_questions` row with this WHERE clause:

```sql
WHERE channel = 'telegram'
  AND (channel_ref = ? OR channel_ref LIKE ?)
  AND answered_at IS NULL
ORDER BY created_at ASC
LIMIT 1
```

The exact-match rung (`channel_ref = ?`) is keyed on the chat id +
message id the user replied to. The LIKE fallback matches any message
in that chat. When the operator uses Telegram's Reply feature, the
exact match would _ideally_ pin the match to the specific bot message
they replied to — but the `channel_ref` stored on every
`pending_questions` row created by `brain.askUser` is the
**directive's** channelRef (the original `/build` command's
`chatId#messageId`), not the specific bot outbound message that
triggered this particular question. So the exact match rung almost
never fires, and the LIKE fallback always wins — returning the
**oldest unanswered** row in the chat.

Consequence: when a directive has multiple open questions (e.g. a
builder `ask_user` from 11:39 and a brain `escalateBlocked` from
11:56), an operator replying to the latest bot message hits the
earliest pending question. Live validation during Phase 8.7 on
2026-04-23 showed this clearly — operator replied to the verify-gate
escalation with `abort`, but the answer landed on the config-format
question two hops older in the queue.

## Repro / evidence

Phase 8.7 live run, 2026-04-23. Directive `01KPX1Z4RE3535H8X55E169PHR`
had two open questions at 12:21 local time:

- `01KPX26J5VMJTKNR2FK40QTSKH` created 11:39:27 — "Config format: YAML or TOML?"
  (builder `ask_user` MCP call)
- `01KPX36KHXQ10V9VPJ30QR82TM` created 11:56:57 — "`[escalation]` verify gate failed"
  (brain `escalateBlocked`)

Operator replied `Abort` to the escalation message in Telegram. Log
line:

```
12:21:49  daemon.channels (telegram)  answered pending question from reply  questionId=01KPX26J5VMJTKNR2FK40QTSKH
```

— i.e. the older config-format question, not the escalation the
operator was actually looking at. A second reply (same text) was then
needed to close the escalation.

## Hypothesis

Two stacked reasons:

1. `askUser` stores `channel_ref = directive.channelRef`
   (`packages/brain/src/ask-user.ts:221`), not a fresh channelRef tied
   to the specific outbound that carries this question. So even when
   the exact `chat#msg` rung of the matcher fires, it can't
   discriminate between questions of the same directive.
2. `outbound_messages` carry `metadata.questionId` but the channel's
   `send()` call currently posts to Telegram without threading — the
   `reply_to_message_id` on the _outbound_ is the directive's
   channelRef, not a per-question thread anchor. There's no way
   afterwards to reverse-map "I replied to message X" back to a
   specific question.

Fix direction:

- Record the bot's outbound `message_id` on `pending_questions` (new
  column) at the moment the outbound is delivered. Update the matcher
  to prefer that column on the exact-match rung.
- Alternative: Tighten `channel_ref` per-question so the existing
  matcher schema works — pre-compute an anchor message the bot will
  send and use its id as the ref. Heavier since it requires a two-step
  send (enqueue placeholder, update with real channelRef).

Either approach changes `pending_questions` schema (migration); not
in scope for Phase 8's close but worth tackling before Phase 9's web UI
surfaces "open questions per directive" more prominently.

## Resolution

(filled when work begins)
