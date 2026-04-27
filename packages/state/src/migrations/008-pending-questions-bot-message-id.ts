import type { Migration } from './index.js';

/**
 * Migration 008 — `pending_questions` gains `bot_message_id`, the provider's
 * message identifier for the outbound that carried the question (Telegram's
 * `message_id`, Discord's snowflake, etc.).
 *
 * Rationale (I012): when an operator uses Telegram's Reply feature on a
 * specific bot message, the inbound update's `reply_to_message.message_id`
 * tells us _which_ outbound they replied to. Without recording that id on
 * the question row, the matcher had to fall back to a chat-id LIKE rung
 * (`channel_ref LIKE '<chatId>#%'`) and ORDER BY created_at — i.e. the
 * oldest open question always won, regardless of which message the
 * operator targeted. Adding the column closes that ambiguity.
 *
 * The column is nullable: rows created before this migration have no
 * recorded id, and the matcher correctly falls through to the legacy
 * channel_ref / LIKE rungs for them. The partial index keeps lookups
 * cheap when most questions never use this path (other channels) without
 * indexing the NULL backfill of pre-migration rows.
 */
export const migration008: Migration = {
  id: 8,
  name: 'pending-questions-bot-message-id',
  up: `
    ALTER TABLE pending_questions ADD COLUMN bot_message_id TEXT;
    CREATE INDEX idx_pending_bot_message
      ON pending_questions(bot_message_id)
      WHERE bot_message_id IS NOT NULL AND answered_at IS NULL;
  `,
};
