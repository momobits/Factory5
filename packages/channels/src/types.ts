/**
 * `ChannelPlugin` — uniform contract for any inbound/outbound message channel
 * (CLI, Discord, Telegram, web, ...).
 *
 * Each channel runs inside the daemon process. Inbound messages are
 * normalized into `Directive` rows in SQLite; outbound messages are pulled
 * from `outbound_messages` and sent via the channel's `send` method.
 */

import type {
  ChannelId,
  Directive,
  DirectiveLimits,
  Intent,
  OutboundMessage,
  ProjectBudgetDefaults,
} from '@factory5/core';
import type { Logger } from '@factory5/logger';
import type { ZodSchema } from 'zod';

/**
 * Triage classification surfaced to the channel handler (Phase 2.5). The
 * brain's full {@link TriageResult} carries a `raw` model-text field for
 * audit; this slim shape strips that down to what the channel actually
 * routes on, so consumers don't pull the brain package in.
 */
export interface IntentClassification {
  intent: Intent;
  confidence: number;
  reasoning: string;
}

export interface ChannelCapabilities {
  /** Channel can ingest messages (push directives in). */
  inbound: boolean;
  /** Channel can deliver messages (push replies out). */
  outbound: boolean;
  /** Channel supports threaded conversations / replies. */
  threading: boolean;
  /** Channel supports interactive turn-taking (`ask_user`). */
  interactive: boolean;
  /** Channel supports file attachments. */
  fileAttachments: boolean;
}

export interface ChannelContext {
  /** Per-channel log prefix. */
  log: Logger;
  /**
   * Called by the channel when an inbound message arrives. The channel is
   * responsible for normalizing platform messages into a `Directive`.
   */
  onInbound: (d: Directive) => void | Promise<void>;
  /**
   * Resolve a project-name argument (from a `/build <name>` command or
   * equivalent) to an absolute workspace path. Mirrors what `factory build`
   * does before creating a directive — copies from `templates/<name>/` into
   * the workspace when needed, resolves relative paths, etc. Backed by
   * {@link resolveProjectPath} in `@factory5/wiki`; the daemon binds the
   * configured workspace at channel-registry creation time.
   *
   * Optional because some test harnesses / scripts wire the channel
   * registry directly without the daemon. When unset, inbound handlers fall
   * back to passing the raw `project` name through on the directive
   * payload (the pre-I011 behaviour — the brain will then try to resolve
   * the name relative to its own cwd, which is the gap I011 fixes).
   */
  resolveProjectPath?: (name: string) => Promise<string>;
  /**
   * Resolve the budget ceilings for an inbound `/build <name>` directive
   * by merging the per-project `metadata.budgetDefaults` with the instance
   * `config.toml [budget.defaults]` tier (ADR 0027 §4 / issue I009 fix).
   * The daemon binds this to a closure over the loaded `fileConfig` and
   * a `loadOrCreateProjectMetadata` call at channel-registry creation
   * time so the channel plugin doesn't need to import `@factory5/wiki`
   * or `@factory5/brain`.
   *
   * Returns `undefined` when no tier supplies any field (the unlimited
   * path; the brain treats absent `limits` as no cap). Optional because
   * test harnesses that wire the registry without the daemon emit
   * directives with no `limits` (the pre-fix behaviour).
   */
  resolveBuildLimits?: (name: string) => Promise<DirectiveLimits | undefined>;
  /**
   * Set per-project budget defaults from a channel surface (Discord
   * `/factory budget`, Telegram `/budget` once 2.2 ships). The daemon
   * binds this to a closure that:
   *
   *   1. Resolves the project by name via `projectsQ.findByName` (most
   *      recently touched wins on duplicates per ADR 0021).
   *   2. Calls `wiki.updateProjectMetadata` to write
   *      `metadata.budgetDefaults = defaults` (or clears it when
   *      `defaults` has neither field set, per ADR 0027 §4 PUT semantics).
   *   3. Returns the resolved project id and the persisted defaults so
   *      the caller can render a confirmation.
   *
   * Throws {@link SetProjectBudgetError} on lookup / corruption failures
   * so handlers can surface a structured error to the operator.
   *
   * Optional because tests / standalone scripts wire the registry without
   * the daemon. When unset, the budget command path returns an "unwired"
   * error rather than partially writing state.
   */
  setProjectBudget?: (
    name: string,
    defaults: ProjectBudgetDefaults,
  ) => Promise<{ projectId: string; defaults: ProjectBudgetDefaults }>;
  /**
   * Classify a free-form chat message into an {@link Intent} (Phase 2.5).
   * The daemon binds this to the brain's `triageDirective` against the
   * configured provider registry; the channel handler calls it BEFORE
   * deciding whether to create a chat directive vs. dispatch a read-side
   * command (`runStatus`/`runSpend`/`runFindings`/`runResume`).
   *
   * Optional — when unset, the channel handler skips classification and
   * falls back to the legacy "every non-slash message becomes
   * `intent=chat`" behaviour. Test rigs that don't wire a brain registry
   * leave this undefined.
   */
  classifyIntent?: (text: string) => Promise<IntentClassification>;
}

/**
 * Thrown by {@link ChannelContext.setProjectBudget} to give handlers a
 * stable shape for surfacing the failure mode (no project, ambiguous
 * name, missing identity file, corrupt identity file). The daemon's
 * binding maps `wiki` errors onto these codes.
 */
export class SetProjectBudgetError extends Error {
  readonly code: 'NOT_FOUND' | 'AMBIGUOUS' | 'PATH_UNREADABLE' | 'METADATA_CORRUPT';
  constructor(
    code: 'NOT_FOUND' | 'AMBIGUOUS' | 'PATH_UNREADABLE' | 'METADATA_CORRUPT',
    message: string,
  ) {
    super(message);
    this.name = 'SetProjectBudgetError';
    this.code = code;
  }
}

export interface SendResult {
  delivered: boolean;
  externalId?: string;
  error?: string;
}

export interface ChannelPlugin {
  /** Unique id matching `ChannelId` enum in `@factory5/core`. */
  id: ChannelId;
  /** What this channel can and can't do. */
  capabilities: ChannelCapabilities;
  /** Zod schema for the channel's config block in the user's `config.toml`. */
  configSchema: ZodSchema;
  /** Bring the channel online. Idempotent. */
  start(ctx: ChannelContext, config: unknown): Promise<void>;
  /** Take the channel offline. Idempotent. */
  stop(): Promise<void>;
  /** Deliver an outbound message. */
  send(msg: OutboundMessage): Promise<SendResult>;
}
