/**
 * Unit tests for the Discord slash-command dispatch
 * (`/factory <subcommand>`) — Phase 2 step 2.1.
 *
 * Stubs `ChatInputCommandInteraction` so handlers run without the live
 * Discord API; drives each subcommand through `dispatchSlashInteraction`
 * and asserts on the embed shape, side effects (directives inserted via
 * `onInbound`, budget mutator invoked), and error paths.
 */

import { newId, type Directive, type ProjectBudgetDefaults } from '@factory5/core';
import { initLogger, createLogger } from '@factory5/logger';
import {
  directives as directivesQ,
  findingsRegistry,
  modelUsage,
  openDatabase,
  projects as projectsQ,
  runMigrations,
  type Database,
} from '@factory5/state';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import {
  buildFactorySlashCommand,
  dispatchSlashInteraction,
  FACTORY_SUBCOMMANDS,
  type DiscordCommandContext,
} from './discord-commands.js';
import { SetProjectBudgetError } from './types.js';

beforeAll(() => {
  initLogger({ processName: 'discord-commands-test', noFile: true, noConsole: true });
});

// ---------------------------------------------------------------------------
// Test plumbing — minimal interaction stub matching the surface our
// handlers actually touch.
// ---------------------------------------------------------------------------

interface InteractionOpts {
  subcommand: string;
  string?: Record<string, string>;
  integer?: Record<string, number>;
  number?: Record<string, number>;
  user?: { id: string; tag: string };
  guildId?: string | null;
}

interface RecordedReply {
  embeds: Array<Record<string, unknown>>;
  content?: string;
  ephemeral?: boolean;
}

interface FakeInteraction {
  recorded: {
    deferReply: number;
    editReply: RecordedReply[];
    reply: RecordedReply[];
  };
  /** What the test asserts against — accessor returning the live record. */
  fake: unknown;
}

function makeInteraction(opts: InteractionOpts): FakeInteraction {
  const recorded: FakeInteraction['recorded'] = {
    deferReply: 0,
    editReply: [],
    reply: [],
  };
  const stringMap = opts.string ?? {};
  const integerMap = opts.integer ?? {};
  const numberMap = opts.number ?? {};
  const fake = {
    commandName: 'factory',
    isChatInputCommand: () => true,
    user: opts.user ?? { id: 'u1', tag: 'someone#0001' },
    guildId: opts.guildId ?? null,
    options: {
      getSubcommand: (_required?: boolean): string => opts.subcommand,
      getString: (name: string, required = false): string | null => {
        const v = stringMap[name];
        if (v === undefined) {
          if (required === true) throw new Error(`missing required string ${name}`);
          return null;
        }
        return v;
      },
      getInteger: (name: string, required = false): number | null => {
        const v = integerMap[name];
        if (v === undefined) {
          if (required === true) throw new Error(`missing required integer ${name}`);
          return null;
        }
        return v;
      },
      getNumber: (name: string, required = false): number | null => {
        const v = numberMap[name];
        if (v === undefined) {
          if (required === true) throw new Error(`missing required number ${name}`);
          return null;
        }
        return v;
      },
    },
    deferReply: async (): Promise<void> => {
      recorded.deferReply += 1;
    },
    editReply: async (payload: {
      embeds?: ReadonlyArray<{ toJSON?: () => Record<string, unknown> } | Record<string, unknown>>;
      content?: string;
    }): Promise<void> => {
      const embeds = (payload.embeds ?? []).map((e) =>
        typeof (e as { toJSON?: unknown }).toJSON === 'function'
          ? (e as { toJSON: () => Record<string, unknown> }).toJSON()
          : (e as Record<string, unknown>),
      );
      recorded.editReply.push({
        embeds,
        ...(payload.content !== undefined ? { content: payload.content } : {}),
      });
    },
    reply: async (payload: {
      content?: string;
      ephemeral?: boolean;
      embeds?: ReadonlyArray<{ toJSON?: () => Record<string, unknown> } | Record<string, unknown>>;
    }): Promise<void> => {
      const embeds = (payload.embeds ?? []).map((e) =>
        typeof (e as { toJSON?: unknown }).toJSON === 'function'
          ? (e as { toJSON: () => Record<string, unknown> }).toJSON()
          : (e as Record<string, unknown>),
      );
      recorded.reply.push({
        embeds,
        ...(payload.content !== undefined ? { content: payload.content } : {}),
        ...(payload.ephemeral === true ? { ephemeral: true } : {}),
      });
    },
  };
  return { recorded, fake };
}

function freshDb(): Database {
  const db = openDatabase(':memory:');
  runMigrations(db);
  return db;
}

function makeCtx(opts: {
  db: Database;
  inbounds?: Directive[];
  resolveProjectPath?: (name: string) => Promise<string>;
  resolveBuildLimits?: DiscordCommandContext['resolveBuildLimits'];
  setProjectBudget?: DiscordCommandContext['setProjectBudget'];
  allowedUserIds?: string[];
  user?: { id: string; tag: string };
}): DiscordCommandContext {
  return {
    db: opts.db,
    log: createLogger('test.discord-commands'),
    user: opts.user ?? { id: 'u1', tag: 'someone#0001' },
    guildId: 'guild-1',
    onInbound: (d) => {
      opts.inbounds?.push(d);
    },
    resolveProjectPath: opts.resolveProjectPath,
    resolveBuildLimits: opts.resolveBuildLimits,
    setProjectBudget: opts.setProjectBudget,
    allowedUserIds: opts.allowedUserIds ?? [],
  };
}

function nowIso(): string {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// Slash-command JSON shape
// ---------------------------------------------------------------------------

describe('buildFactorySlashCommand', () => {
  it('emits a single top-level `factory` command with the expected subcommands', () => {
    const json = buildFactorySlashCommand();
    expect(json.name).toBe('factory');
    const subnames = (json.options ?? [])
      .filter((o) => (o as { type: number }).type === 1) // SUB_COMMAND
      .map((o) => (o as { name: string }).name);
    expect(subnames.sort()).toEqual([...FACTORY_SUBCOMMANDS].sort());
  });
});

// ---------------------------------------------------------------------------
// /factory status
// ---------------------------------------------------------------------------

describe('dispatchSlashInteraction — /factory status', () => {
  it('returns an embed with the recent directive list and projects', async () => {
    const db = freshDb();
    // Seed two directives + a project.
    const dId = newId();
    directivesQ.insert(db, {
      id: dId,
      source: 'discord',
      principal: 'u1',
      channelRef: 'chan-1#thread-1',
      intent: 'build',
      payload: { project: 'demo' },
      autonomy: 'autonomous',
      createdAt: nowIso(),
      status: 'running',
    });
    projectsQ.upsert(db, {
      id: newId(),
      name: 'demo',
      workspacePath: '/work/demo',
      status: 'active',
      createdAt: nowIso(),
      lastTouchedAt: nowIso(),
    });
    const ctx = makeCtx({ db });
    const { recorded, fake } = makeInteraction({ subcommand: 'status' });
    await dispatchSlashInteraction(ctx, fake as never);
    expect(recorded.deferReply).toBe(1);
    expect(recorded.editReply).toHaveLength(1);
    const embed = recorded.editReply[0]!.embeds[0]!;
    expect(embed.title).toBe('factory status');
    const desc = embed.description as string;
    expect(desc).toContain('demo');
    expect(desc).toContain(dId.slice(-8));
  });

  it('handles an empty database without throwing', async () => {
    const db = freshDb();
    const ctx = makeCtx({ db });
    const { recorded, fake } = makeInteraction({ subcommand: 'status' });
    await dispatchSlashInteraction(ctx, fake as never);
    const desc = recorded.editReply[0]!.embeds[0]!.description as string;
    expect(desc).toContain('(none registered)');
    expect(desc).toContain('(none yet)');
  });
});

// ---------------------------------------------------------------------------
// /factory spend
// ---------------------------------------------------------------------------

describe('dispatchSlashInteraction — /factory spend', () => {
  it('renders an empty rollup with a recognisable message', async () => {
    const db = freshDb();
    const ctx = makeCtx({ db });
    const { recorded, fake } = makeInteraction({ subcommand: 'spend' });
    await dispatchSlashInteraction(ctx, fake as never);
    const desc = recorded.editReply[0]!.embeds[0]!.description as string;
    expect(desc).toContain('no spend recorded');
  });

  it('groups by directive when group-by=directive', async () => {
    const db = freshDb();
    const dId = newId();
    directivesQ.insert(db, {
      id: dId,
      source: 'cli',
      principal: 'u1',
      channelRef: 'cli',
      intent: 'build',
      payload: {},
      autonomy: 'autonomous',
      createdAt: nowIso(),
      status: 'complete',
    });
    modelUsage.record(db, {
      id: newId(),
      directiveId: dId,
      provider: 'anthropic',
      model: 'claude-haiku-4-5-20251001',
      category: 'coder',
      mode: 'call',
      inputTokens: 100,
      outputTokens: 200,
      costUsd: 0.123,
      durationMs: 4200,
      calledAt: nowIso(),
    });
    const ctx = makeCtx({ db });
    const { recorded, fake } = makeInteraction({
      subcommand: 'spend',
      string: { 'group-by': 'directive' },
    });
    await dispatchSlashInteraction(ctx, fake as never);
    const desc = recorded.editReply[0]!.embeds[0]!.description as string;
    expect(desc).toContain(dId.slice(-8));
    expect(desc).toContain('$0.1230');
  });

  it('errors when --project does not match', async () => {
    const db = freshDb();
    const ctx = makeCtx({ db });
    const { recorded, fake } = makeInteraction({
      subcommand: 'spend',
      string: { project: 'nonexistent' },
    });
    await dispatchSlashInteraction(ctx, fake as never);
    const embed = recorded.editReply[0]!.embeds[0]!;
    expect(embed.title).toBe('/factory spend — error');
    expect(embed.description as string).toContain('no project matches');
  });
});

// ---------------------------------------------------------------------------
// /factory findings
// ---------------------------------------------------------------------------

describe('dispatchSlashInteraction — /factory findings', () => {
  it('lists open + blocking findings by default', async () => {
    const db = freshDb();
    findingsRegistry.upsert(db, {
      projectId: newId(),
      projectPath: '/work/fp',
      finding: {
        id: 'F001',
        source: 'verifier',
        target: 'src/foo.ts',
        severity: 'HIGH',
        status: 'OPEN',
        description: 'sample finding\nsecond line',
        createdAt: nowIso(),
      },
    });
    const ctx = makeCtx({ db });
    const { recorded, fake } = makeInteraction({ subcommand: 'findings' });
    await dispatchSlashInteraction(ctx, fake as never);
    const desc = recorded.editReply[0]!.embeds[0]!.description as string;
    expect(desc).toContain('F001');
    expect(desc).toContain('HIGH');
    // Multi-line description must be collapsed to first line.
    expect(desc).not.toContain('second line');
  });

  it('returns the no-match message when filter excludes everything', async () => {
    const db = freshDb();
    const ctx = makeCtx({ db });
    const { recorded, fake } = makeInteraction({
      subcommand: 'findings',
      string: { severity: 'CRITICAL' },
    });
    await dispatchSlashInteraction(ctx, fake as never);
    const desc = recorded.editReply[0]!.embeds[0]!.description as string;
    expect(desc).toContain('no findings match');
  });
});

// ---------------------------------------------------------------------------
// /factory resume
// ---------------------------------------------------------------------------

describe('dispatchSlashInteraction — /factory resume', () => {
  it('emits a fresh resume directive that points at the prior one', async () => {
    const db = freshDb();
    const priorId = newId();
    directivesQ.insert(db, {
      id: priorId,
      source: 'discord',
      principal: 'u1',
      channelRef: 'chan-1#thread-1',
      intent: 'build',
      payload: { project: 'demo', projectPath: '/work/demo', language: 'node' },
      autonomy: 'autonomous',
      createdAt: nowIso(),
      status: 'blocked',
    });
    const inbounds: Directive[] = [];
    const ctx = makeCtx({ db, inbounds });
    const { recorded, fake } = makeInteraction({
      subcommand: 'resume',
      string: { project: 'demo' },
    });
    await dispatchSlashInteraction(ctx, fake as never);
    expect(inbounds).toHaveLength(1);
    const fresh = inbounds[0]!;
    expect(fresh.intent).toBe('build');
    expect(fresh.parentDirectiveId).toBe(priorId);
    const payload = fresh.payload as Record<string, unknown>;
    expect(payload['projectPath']).toBe('/work/demo');
    expect(payload['language']).toBe('node');
    expect(payload['resumeFrom']).toBe(priorId);
    const desc = recorded.editReply[0]!.embeds[0]!.description as string;
    expect(desc).toContain('demo');
    expect(desc).toContain(priorId.slice(-8));
  });

  it('errors when no prior directive exists for the named project', async () => {
    const db = freshDb();
    const inbounds: Directive[] = [];
    const ctx = makeCtx({ db, inbounds });
    const { recorded, fake } = makeInteraction({
      subcommand: 'resume',
      string: { project: 'nope' },
    });
    await dispatchSlashInteraction(ctx, fake as never);
    expect(inbounds).toHaveLength(0);
    const embed = recorded.editReply[0]!.embeds[0]!;
    expect(embed.title).toBe('/factory resume — error');
    expect(embed.description as string).toContain('no prior directive');
  });
});

// ---------------------------------------------------------------------------
// /factory cancel
// ---------------------------------------------------------------------------

describe('dispatchSlashInteraction — /factory cancel', () => {
  it('marks a running directive blocked and confirms via embed', async () => {
    const db = freshDb();
    const id = newId();
    directivesQ.insert(db, {
      id,
      source: 'discord',
      principal: 'u1',
      channelRef: 'chan-1#thread-1',
      intent: 'build',
      payload: {},
      autonomy: 'autonomous',
      createdAt: nowIso(),
      status: 'running',
    });
    const ctx = makeCtx({ db });
    const { recorded, fake } = makeInteraction({
      subcommand: 'cancel',
      string: { 'directive-id': id, reason: 'test cancel' },
    });
    await dispatchSlashInteraction(ctx, fake as never);
    const updated = directivesQ.getById(db, id)!;
    expect(updated.status).toBe('blocked');
    expect(updated.blockedReason).toBe('test cancel');
    const embed = recorded.editReply[0]!.embeds[0]!;
    expect(embed.title).toContain('factory cancel');
    expect(embed.description as string).toContain(id.slice(-8));
  });

  it('accepts a 8-char suffix and resolves to the full ULID', async () => {
    const db = freshDb();
    const id = newId();
    directivesQ.insert(db, {
      id,
      source: 'cli',
      principal: 'u1',
      channelRef: 'cli',
      intent: 'build',
      payload: {},
      autonomy: 'autonomous',
      createdAt: nowIso(),
      status: 'pending',
    });
    const ctx = makeCtx({ db });
    const { recorded, fake } = makeInteraction({
      subcommand: 'cancel',
      string: { 'directive-id': id.slice(-8) },
    });
    await dispatchSlashInteraction(ctx, fake as never);
    expect(directivesQ.getById(db, id)!.status).toBe('blocked');
    expect(recorded.editReply[0]!.embeds[0]!.title).toContain('factory cancel');
  });

  it('errors gracefully when the directive id is unknown', async () => {
    const db = freshDb();
    const ctx = makeCtx({ db });
    const { recorded, fake } = makeInteraction({
      subcommand: 'cancel',
      string: { 'directive-id': '01J9999999999999999999XXXX' },
    });
    await dispatchSlashInteraction(ctx, fake as never);
    const embed = recorded.editReply[0]!.embeds[0]!;
    expect(embed.title).toBe('/factory cancel — error');
    expect(embed.description as string).toContain('no directive matches');
  });

  it('refuses to cancel a directive that is already terminal', async () => {
    const db = freshDb();
    const id = newId();
    directivesQ.insert(db, {
      id,
      source: 'cli',
      principal: 'u1',
      channelRef: 'cli',
      intent: 'build',
      payload: {},
      autonomy: 'autonomous',
      createdAt: nowIso(),
      status: 'complete',
    });
    const ctx = makeCtx({ db });
    const { recorded, fake } = makeInteraction({
      subcommand: 'cancel',
      string: { 'directive-id': id },
    });
    await dispatchSlashInteraction(ctx, fake as never);
    const embed = recorded.editReply[0]!.embeds[0]!;
    expect(embed.title).toBe('/factory cancel — error');
    expect(embed.description as string).toContain('already complete');
  });
});

// ---------------------------------------------------------------------------
// /factory budget
// ---------------------------------------------------------------------------

describe('dispatchSlashInteraction — /factory budget', () => {
  it('invokes setProjectBudget with the supplied caps', async () => {
    const db = freshDb();
    const setProjectBudget = vi.fn(
      async (
        _name: string,
        defaults: ProjectBudgetDefaults,
      ): Promise<{ projectId: string; defaults: ProjectBudgetDefaults }> => ({
        projectId: newId(),
        defaults,
      }),
    );
    const ctx = makeCtx({ db, setProjectBudget });
    const { recorded, fake } = makeInteraction({
      subcommand: 'budget',
      string: { project: 'demo' },
      number: { 'max-usd': 5 },
      integer: { 'max-steps': 200 },
    });
    await dispatchSlashInteraction(ctx, fake as never);
    expect(setProjectBudget).toHaveBeenCalledWith('demo', { maxUsd: 5, maxSteps: 200 });
    const desc = recorded.editReply[0]!.embeds[0]!.description as string;
    expect(desc).toContain('max-usd');
    expect(desc).toContain('max-steps');
  });

  it('renders a "cleared" embed when neither cap is set', async () => {
    const db = freshDb();
    const setProjectBudget = vi.fn(async (_name: string, defaults: ProjectBudgetDefaults) => ({
      projectId: newId(),
      defaults,
    }));
    const ctx = makeCtx({ db, setProjectBudget });
    const { recorded, fake } = makeInteraction({
      subcommand: 'budget',
      string: { project: 'demo' },
    });
    await dispatchSlashInteraction(ctx, fake as never);
    expect(setProjectBudget).toHaveBeenCalledWith('demo', {});
    expect(recorded.editReply[0]!.embeds[0]!.description as string).toContain('_cleared_');
  });

  it('returns an "unwired" message when setProjectBudget is absent', async () => {
    const db = freshDb();
    const ctx = makeCtx({ db });
    const { recorded, fake } = makeInteraction({
      subcommand: 'budget',
      string: { project: 'demo' },
      number: { 'max-usd': 7 },
    });
    await dispatchSlashInteraction(ctx, fake as never);
    const embed = recorded.editReply[0]!.embeds[0]!;
    expect(embed.title).toBe('/factory budget — error');
    expect(embed.description as string).toContain('not wired');
  });

  it('surfaces SetProjectBudgetError to the user as a structured embed', async () => {
    const db = freshDb();
    const setProjectBudget = vi.fn(async (): Promise<never> => {
      throw new SetProjectBudgetError('NOT_FOUND', 'no project named "ghost"');
    });
    const ctx = makeCtx({ db, setProjectBudget });
    const { recorded, fake } = makeInteraction({
      subcommand: 'budget',
      string: { project: 'ghost' },
      number: { 'max-usd': 3 },
    });
    await dispatchSlashInteraction(ctx, fake as never);
    const embed = recorded.editReply[0]!.embeds[0]!;
    expect(embed.title).toBe('/factory budget — error');
    expect(embed.description as string).toContain('ghost');
  });
});

// ---------------------------------------------------------------------------
// /factory build
// ---------------------------------------------------------------------------

describe('dispatchSlashInteraction — /factory build', () => {
  it('enqueues a build directive with project + spec + language + limits', async () => {
    const db = freshDb();
    const inbounds: Directive[] = [];
    const ctx = makeCtx({
      db,
      inbounds,
      resolveProjectPath: async (name) => `/work/${name}`,
      resolveBuildLimits: async () => undefined,
    });
    const { recorded, fake } = makeInteraction({
      subcommand: 'build',
      string: {
        project: 'demo',
        spec: 'a sample CLI',
        autonomy: 'assisted',
        language: 'node',
      },
      number: { 'max-usd': 2.5 },
      integer: { 'max-steps': 50 },
    });
    await dispatchSlashInteraction(ctx, fake as never);
    expect(inbounds).toHaveLength(1);
    const d = inbounds[0]!;
    expect(d.intent).toBe('build');
    expect(d.autonomy).toBe('assisted');
    expect(d.source).toBe('discord');
    expect(d.limits).toEqual({ maxUsd: 2.5, maxSteps: 50 });
    const payload = d.payload as Record<string, unknown>;
    expect(payload['project']).toBe('demo');
    expect(payload['projectPath']).toBe('/work/demo');
    expect(payload['spec']).toBe('a sample CLI');
    expect(payload['language']).toBe('node');
    const embed = recorded.editReply[0]!.embeds[0]!;
    expect(embed.title).toContain('queued');
    expect(embed.description as string).toContain('demo');
  });

  it('falls back to resolveBuildLimits when no flag is set', async () => {
    const db = freshDb();
    const inbounds: Directive[] = [];
    const ctx = makeCtx({
      db,
      inbounds,
      resolveProjectPath: async (name) => `/work/${name}`,
      resolveBuildLimits: async () => ({ maxUsd: 9, maxSteps: 300 }),
    });
    const { fake } = makeInteraction({
      subcommand: 'build',
      string: { project: 'demo' },
    });
    await dispatchSlashInteraction(ctx, fake as never);
    expect(inbounds[0]!.limits).toEqual({ maxUsd: 9, maxSteps: 300 });
  });

  it('proceeds without projectPath when resolveProjectPath throws', async () => {
    const db = freshDb();
    const inbounds: Directive[] = [];
    const ctx = makeCtx({
      db,
      inbounds,
      resolveProjectPath: async () => {
        throw new Error('boom');
      },
    });
    const { fake } = makeInteraction({
      subcommand: 'build',
      string: { project: 'demo' },
    });
    await dispatchSlashInteraction(ctx, fake as never);
    expect(inbounds).toHaveLength(1);
    const payload = inbounds[0]!.payload as Record<string, unknown>;
    expect(payload['projectPath']).toBeUndefined();
    expect(payload['project']).toBe('demo');
  });
});

// ---------------------------------------------------------------------------
// Allow-list gate
// ---------------------------------------------------------------------------

describe('dispatchSlashInteraction — allow-list', () => {
  it('refuses an interaction from a user not on the allow-list', async () => {
    const db = freshDb();
    const ctx = makeCtx({ db, allowedUserIds: ['u-allowed'] });
    const { recorded, fake } = makeInteraction({
      subcommand: 'status',
      user: { id: 'u-stranger', tag: 'stranger#0001' },
    });
    await dispatchSlashInteraction(ctx, fake as never);
    expect(recorded.deferReply).toBe(0);
    expect(recorded.editReply).toHaveLength(0);
    expect(recorded.reply).toHaveLength(1);
    expect(recorded.reply[0]!.content).toContain('not authorised');
    expect(recorded.reply[0]!.ephemeral).toBe(true);
  });

  it('accepts an interaction from a user on the allow-list', async () => {
    const db = freshDb();
    const ctx = makeCtx({ db, allowedUserIds: ['u-allowed'] });
    const { recorded, fake } = makeInteraction({
      subcommand: 'status',
      user: { id: 'u-allowed', tag: 'friend#0001' },
    });
    await dispatchSlashInteraction(ctx, fake as never);
    expect(recorded.deferReply).toBe(1);
    expect(recorded.editReply).toHaveLength(1);
  });
});
