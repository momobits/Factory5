import type { Migration } from './index.js';

/**
 * Initial schema. Creates every table referenced in CompleteArchitecture.md §6.
 *
 * Conventions:
 *  - All IDs are TEXT (ULIDs from `@factory5/core`).
 *  - All timestamps are TEXT in ISO8601 form.
 *  - JSON columns store stringified JSON; helpers parse on read.
 *  - Status enums are TEXT with CHECK constraints to catch typos at insert.
 *
 * Note on `'github'` / `'webhook'` in the `source` and `target_channel`
 * CHECK lists: these were part of the original scaffold and are retained
 * in-place as a historical superset. The TypeScript `CHANNEL_IDS` constant
 * narrowed to `['cli','discord','telegram']` in ADR 0019; the DB CHECK is
 * stricter-superset-harmless and left untouched because SQLite cannot ALTER
 * a CHECK constraint without a full table recreation. Consult ADR 0019 for
 * the decision context.
 */
export const migration001: Migration = {
  id: 1,
  name: 'initial-schema',
  up: `
    -- ---------------------------------------------------------------------
    -- directives — inbound work queue
    -- ---------------------------------------------------------------------
    CREATE TABLE directives (
      id                   TEXT PRIMARY KEY,
      source               TEXT NOT NULL CHECK (source IN ('cli','discord','telegram','github','webhook')),
      principal            TEXT NOT NULL,
      channel_ref          TEXT NOT NULL,
      intent               TEXT NOT NULL CHECK (intent IN ('build','fix','review','investigate','chat','status','resume','cancel')),
      payload_json         TEXT NOT NULL,
      autonomy             TEXT NOT NULL CHECK (autonomy IN ('chat','assisted','autonomous')),
      created_at           TEXT NOT NULL,
      status               TEXT NOT NULL CHECK (status IN ('pending','claimed','running','blocked','complete','failed')),
      claimed_by           TEXT,
      parent_directive_id  TEXT REFERENCES directives(id) ON DELETE SET NULL
    );
    CREATE INDEX idx_directives_status ON directives(status, created_at);
    CREATE INDEX idx_directives_source_principal ON directives(source, principal);

    -- ---------------------------------------------------------------------
    -- outbound_messages — brain → channel delivery queue
    -- ---------------------------------------------------------------------
    CREATE TABLE outbound_messages (
      id              TEXT PRIMARY KEY,
      directive_id    TEXT REFERENCES directives(id) ON DELETE SET NULL,
      target_channel  TEXT NOT NULL CHECK (target_channel IN ('cli','discord','telegram','github','webhook')),
      target_ref      TEXT NOT NULL,
      text            TEXT NOT NULL,
      metadata_json   TEXT,
      created_at      TEXT NOT NULL,
      delivered_at    TEXT,
      attempts        INTEGER NOT NULL DEFAULT 0,
      last_error      TEXT
    );
    CREATE INDEX idx_outbound_pending ON outbound_messages(delivered_at, created_at)
      WHERE delivered_at IS NULL;

    -- ---------------------------------------------------------------------
    -- events_audit — every observed external event
    -- ---------------------------------------------------------------------
    CREATE TABLE events_audit (
      id            TEXT PRIMARY KEY,
      source        TEXT NOT NULL,
      kind          TEXT NOT NULL,
      body_json     TEXT NOT NULL,
      metadata_json TEXT NOT NULL,
      received_at   TEXT NOT NULL
    );
    CREATE INDEX idx_events_received ON events_audit(received_at);
    CREATE INDEX idx_events_source_kind ON events_audit(source, kind);

    -- ---------------------------------------------------------------------
    -- sessions — per-channel/per-user conversational state
    -- ---------------------------------------------------------------------
    CREATE TABLE sessions (
      id            TEXT PRIMARY KEY,
      channel       TEXT NOT NULL,
      principal     TEXT NOT NULL,
      channel_ref   TEXT NOT NULL,
      autonomy      TEXT NOT NULL CHECK (autonomy IN ('chat','assisted','autonomous')),
      state_json    TEXT NOT NULL,
      created_at    TEXT NOT NULL,
      last_active   TEXT NOT NULL,
      UNIQUE (channel, channel_ref)
    );
    CREATE INDEX idx_sessions_active ON sessions(last_active);

    -- ---------------------------------------------------------------------
    -- pending_questions — ask_user calls awaiting reply
    -- ---------------------------------------------------------------------
    CREATE TABLE pending_questions (
      id            TEXT PRIMARY KEY,
      directive_id  TEXT NOT NULL REFERENCES directives(id) ON DELETE CASCADE,
      task_id       TEXT,
      question      TEXT NOT NULL,
      options_json  TEXT,
      channel       TEXT NOT NULL,
      channel_ref   TEXT NOT NULL,
      created_at    TEXT NOT NULL,
      deadline_at   TEXT,
      answered_at   TEXT,
      answer        TEXT
    );
    CREATE INDEX idx_pending_open ON pending_questions(answered_at, created_at)
      WHERE answered_at IS NULL;
    CREATE INDEX idx_pending_directive ON pending_questions(directive_id);

    -- ---------------------------------------------------------------------
    -- tasks_inflight — currently-running worker tasks
    -- ---------------------------------------------------------------------
    CREATE TABLE tasks_inflight (
      id              TEXT PRIMARY KEY,
      directive_id    TEXT NOT NULL REFERENCES directives(id) ON DELETE CASCADE,
      plan_id         TEXT NOT NULL,
      title           TEXT NOT NULL,
      agent           TEXT NOT NULL,
      category        TEXT NOT NULL,
      worktree_path   TEXT,
      pid             INTEGER,
      status          TEXT NOT NULL CHECK (status IN ('pending','running','complete','failed','blocked')),
      attempts        INTEGER NOT NULL DEFAULT 0,
      started_at      TEXT,
      last_heartbeat  TEXT,
      finished_at     TEXT,
      result_json     TEXT
    );
    CREATE INDEX idx_tasks_status ON tasks_inflight(status, started_at);
    CREATE INDEX idx_tasks_directive ON tasks_inflight(directive_id);

    -- ---------------------------------------------------------------------
    -- projects — registry of projects factory has touched
    -- ---------------------------------------------------------------------
    CREATE TABLE projects (
      name             TEXT PRIMARY KEY,
      workspace_path   TEXT NOT NULL,
      status           TEXT NOT NULL CHECK (status IN ('active','paused','complete','archived')),
      created_at       TEXT NOT NULL,
      last_touched_at  TEXT NOT NULL,
      metadata_json    TEXT
    );

    -- ---------------------------------------------------------------------
    -- learnings — cross-project patterns
    -- ---------------------------------------------------------------------
    CREATE TABLE learnings (
      id            TEXT PRIMARY KEY,
      topic         TEXT NOT NULL,
      lesson        TEXT NOT NULL,
      source_project TEXT,
      created_at    TEXT NOT NULL,
      times_applied INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX idx_learnings_topic ON learnings(topic);

    -- ---------------------------------------------------------------------
    -- model_usage — per-call cost tracking
    -- ---------------------------------------------------------------------
    CREATE TABLE model_usage (
      id             TEXT PRIMARY KEY,
      directive_id   TEXT REFERENCES directives(id) ON DELETE SET NULL,
      task_id        TEXT,
      provider       TEXT NOT NULL,
      model          TEXT NOT NULL,
      category       TEXT NOT NULL,
      input_tokens   INTEGER NOT NULL,
      output_tokens  INTEGER NOT NULL,
      cost_usd       REAL NOT NULL,
      duration_ms    INTEGER NOT NULL,
      called_at      TEXT NOT NULL,
      error          TEXT
    );
    CREATE INDEX idx_usage_directive ON model_usage(directive_id);
    CREATE INDEX idx_usage_called ON model_usage(called_at);
  `,
};
