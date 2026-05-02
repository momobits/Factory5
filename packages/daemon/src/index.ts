/**
 * @factory5/daemon — daemon assembly.
 *
 * Composes the long-running subsystems that make up `factoryd`:
 *   - pidfile (one daemon per host)
 *   - SQLite (the durable bus)
 *   - IPC server (Fastify on `127.0.0.1:25295`)
 *   - brain supervisor (runs `runBrain({ mode: 'serve' })` with crash-loop
 *     protection — wired in Phase 3 step 3)
 *   - channels + event sources (wired in later steps)
 *
 * The `startDaemon` surface is composable: tests and scripts disable
 * individual subsystems with flags so the daemon can be exercised without
 * running the full brain.
 *
 * @packageDocumentation
 */

import process from 'node:process';

import { DEFAULT_DAEMON_HOST, DEFAULT_DAEMON_PORT } from '@factory5/core';
import { createLogger } from '@factory5/logger';
import { closeDatabase, openDatabase, runMigrations, type Database } from '@factory5/state';

import type { Directive, DirectiveLimits, Event, ProjectBudgetDefaults } from '@factory5/core';
import { askUser, channelConfigFor, loadConfig } from '@factory5/brain';
import {
  createChannelRegistry,
  createCliRpcChannel,
  createDiscordChannel,
  createTelegramChannel,
  SetProjectBudgetError,
  type ChannelPlugin,
  type ChannelRegistry,
} from '@factory5/channels';
import { createFsWatcher, type EventSource, type FsWatcher } from '@factory5/events';
import {
  IpcRequestError,
  type WorkerAskUserRequest,
  type WorkerAskUserResponse,
} from '@factory5/ipc';
import type { ProviderRegistry } from '@factory5/providers';
import {
  directives as directivesQ,
  events as eventsQ,
  projects as projectsQ,
  tasksInflight,
} from '@factory5/state';
import {
  budgetDefaultsFromProjectMeta,
  defaultWorkspace,
  loadOrCreateProjectMetadata,
  ProjectMetadataCorruptError,
  ProjectMetadataNotFoundError,
  resolveDirectiveLimits,
  resolveProjectPath,
  updateProjectMetadata,
} from '@factory5/wiki';

import { startBrainSupervisor } from './brain-supervisor.js';
import { Doorbell } from './doorbell.js';
import { startOutboundWorker, type OutboundWorkerHandle } from './outbound-worker.js';
import { acquirePidFile, defaultPidFilePath, type PidFileHandle } from './pidfile.js';
import { startIpcServer, type IpcServerHandle } from './server.js';
import type { SupervisorHandle } from './supervisor.js';

const log = createLogger('daemon');

/** Daemon version — used for the `/status` response. */
export const DAEMON_VERSION = '0.0.1';

export interface DaemonOptions {
  /** IPC bind host. Default `127.0.0.1`. Non-localhost hosts are rejected. */
  host?: string;
  /** IPC bind port. Default `25295`. Set to 0 for an ephemeral port. */
  port?: number;
  /**
   * Override the SQLite path. Tests and one-shot scripts pass `:memory:` or
   * a temp file here; the default goes to the factory5 data dir.
   */
  dbPath?: string;
  /** Override the pidfile path. Default from `FACTORY5_PIDFILE` env / data dir. */
  pidFilePath?: string;
  /**
   * Skip the pidfile lock. For tests only — a live daemon on the same host
   * without this flag must fail fast.
   */
  noPidFile?: boolean;
  /** Disable the IPC server. Tests that don't need HTTP pass this. */
  noIpc?: boolean;
  /** Disable the brain supervisor. Used by tests that don't need a claim loop. */
  noBrain?: boolean;
  /**
   * Override the `process` field on `/status`. Default `'factoryd'`.
   */
  processName?: string;
  /**
   * Channels to register. Defaults to `[createCliRpcChannel()]`. Tests /
   * scripts override with their own plugin set or pass `[]` for none.
   */
  channelPlugins?: ChannelPlugin[];
  /**
   * Per-channel config, keyed by `ChannelPlugin.id`. Overrides any block
   * the daemon would otherwise read out of `config.toml`. Tests pass this
   * to inject credentials without touching the user's config file.
   */
  channelConfigs?: Record<string, unknown>;
  /** Skip the channel registry entirely. */
  noChannels?: boolean;
  /** Skip reading `config.toml` for channels (tests). */
  noConfigFile?: boolean;
  /**
   * Provider registry for the brain serve loop. When omitted, the brain
   * builds one from `config.toml` on each (re)start. Tests / the e2e
   * script inject a stub here.
   */
  providerRegistry?: ProviderRegistry;
  /** Max directives in flight inside the brain serve loop. Default 1. */
  serveConcurrency?: number;
  /** Skip the filesystem watcher event source. */
  noFsWatcher?: boolean;
  /**
   * Override / extend event sources. When omitted the daemon builds the
   * default set (fs-watcher for registered projects). Tests may pass `[]`.
   */
  eventSources?: EventSource[];
  /** Skip the outbound delivery worker. Tests that never enqueue pass this. */
  noOutboundWorker?: boolean;
  /** Poll cadence for the outbound worker, ms. Default 1000. */
  outboundPollIntervalMs?: number;
  /**
   * Skip the orphaned-directive reconcile pass at startup. Tests that seed
   * their own DB state and don't want the reconciler touching it pass this.
   */
  noReconcile?: boolean;
  /**
   * Bearer token required by `/worker/*` IPC routes. When set, the daemon
   * builds a worker-askUser handler (per ADR 0024) and gates it on this
   * token. When omitted, the route returns 503 `WORKER_ASK_USER_DISABLED`.
   * Production daemons set this; tests usually leave it unset.
   */
  workerAuthToken?: string;
  /**
   * Default per-question soft deadline in seconds for `/worker/ask-user`
   * when the request omits one (per ADR 0024 §2). Default 3600 (1 hour).
   */
  workerAskUserDefaultDeadlineSeconds?: number;
  /**
   * Bearer token required by `/api/v1/*` IPC routes (web UI JSON API).
   * When omitted, those routes return 503 `UI_DISABLED`. Scoped distinct
   * from {@link workerAuthToken} per ADR 0025 §2.
   */
  uiAuthToken?: string;
  /**
   * Absolute path to a built SPA bundle (typically `apps/factory-web/dist/`).
   * When set, `/app/*` serves files from this directory via `@fastify/static`;
   * when omitted, `/app/*` yields 404 (headless CLI-only mode). Per ADR 0025 §3.
   */
  webUiStaticPath?: string;
}

export interface DaemonHandle {
  /** Bound IPC port (may differ from request when port=0). */
  port: number;
  /** PID of the running daemon process. */
  pid: number;
  /** ISO timestamp of when the daemon finished starting. */
  startedAt: string;
  /** Database handle — exposed for subsystems the caller wires (tests, scripts). */
  db: Database;
  /** Doorbell — subsystems wired externally can listen or emit. */
  doorbell: Doorbell;
  /** Graceful shutdown — idempotent. */
  stop(): Promise<void>;
}

/**
 * Start the daemon. Idempotent stop() releases all subsystems in reverse
 * order. Throws {@link import('./pidfile.js').PidFileLockedError} if another
 * live daemon already owns the pidfile.
 */
export async function startDaemon(opts: DaemonOptions = {}): Promise<DaemonHandle> {
  const host = opts.host ?? DEFAULT_DAEMON_HOST;
  const requestedPort = opts.port ?? DEFAULT_DAEMON_PORT;
  const startedAt = new Date().toISOString();
  const processName = opts.processName ?? 'factoryd';

  let pidFile: PidFileHandle | undefined;
  let db: Database | undefined;
  // Subsystem stop order: reverse of insert order.
  const subsystems: Array<{ name: string; stop: () => Promise<void> }> = [];
  const doorbell = new Doorbell();
  let ipc: IpcServerHandle | undefined;

  try {
    if (opts.noPidFile !== true) {
      pidFile = acquirePidFile(opts.pidFilePath ?? defaultPidFilePath());
    }

    db = openDatabase(opts.dbPath);
    runMigrations(db);

    log.info(
      { host, port: requestedPort, pid: process.pid, pidFile: pidFile?.path },
      'daemon: starting',
    );

    // Before any subsystem touches directives, sweep up anything left
    // `running` by a prior brain that died without writing a terminal
    // status (escalation-kill, ctrl-C mid-await, etc.). The pidfile lock
    // above guarantees no other factoryd is running, so dead PIDs in
    // `claimed_by` are unambiguously orphaned; concurrent `factory build
    // --inline` runs are protected by the activity-floor heuristic.
    if (opts.noReconcile !== true) {
      const reconcileRes = directivesQ.reconcileOrphanedDirectives(
        db,
        createLogger('daemon.reconcile'),
      );
      if (reconcileRes.reconciled.length > 0) {
        log.warn(
          { reconciled: reconcileRes.reconciled, inspected: reconcileRes.inspected },
          'daemon: reconciled orphaned directives at startup',
        );
      } else if (reconcileRes.inspected > 0) {
        log.info(
          { inspected: reconcileRes.inspected },
          'daemon: inspected running directives at startup, none orphaned',
        );
      }

      // ADR 0024 §4 — separately reap any tasks left `'waiting_for_human'`
      // by a previous brain process. Their worker subprocesses died with
      // the previous brain, so they're unambiguously orphaned regardless
      // of any directive-level reconcile result.
      const recovered = recoverFromHumanWaits(db, createLogger('daemon.recover'));
      if (recovered > 0) {
        log.warn({ recovered }, 'daemon: aborted orphaned waiting-for-human tasks at startup');
      }
    }

    // Load fileConfig once at boot — the channels registry needs it to
    // build budget-tier resolvers (issue I009 fix), and the IPC server
    // needs `[budget.defaults]` for `POST /api/v1/builds`'s third tier.
    // `noConfigFile` short-circuits both paths to `undefined` (test mode).
    const fileConfig =
      opts.noConfigFile === true ? undefined : await loadConfig().catch(() => undefined);
    const configBudgetDefaults = fileConfig?.budget?.defaults;

    let channelRegistry: ChannelRegistry | undefined;
    if (opts.noChannels !== true) {
      // Resolve per-plugin config: explicit `opts.channelConfigs` wins over
      // anything we'd load from `config.toml`. Missing config blocks are
      // passed as `undefined` — each plugin's `configSchema` defaults
      // whatever the schema says is optional.
      const pluginList = opts.channelPlugins ?? buildDefaultChannelPlugins(fileConfig);
      const plugins = pluginList.map((plugin) => {
        const overrideBlock = opts.channelConfigs?.[plugin.id];
        const fileBlock = channelConfigFor(fileConfig, plugin.id);
        return { plugin, config: overrideBlock ?? fileBlock };
      });
      // Bind the workspace-aware project resolver so inbound `/build <name>`
      // commands from any channel land with a pre-resolved absolute
      // `payload.projectPath`, matching what `factory build` does from the
      // CLI. Without this wire-up, the brain's architect would try to
      // resolve the bare name against factoryd's cwd and fail (issue I011).
      const registryWorkspace = fileConfig?.general.workspace ?? defaultWorkspace();
      const registryResolveProjectPath = async (name: string): Promise<string> =>
        resolveProjectPath(name, registryWorkspace);
      // Bind the three-tier budget resolver so inbound `/build <name>`
      // directives carry the same `limits` as `factory build` (ADR 0027 §4
      // / issue I009). Loads project metadata once, merges with the
      // instance-config tier, returns `undefined` for unlimited.
      const registryResolveBuildLimits = async (
        name: string,
      ): Promise<DirectiveLimits | undefined> => {
        try {
          const projectPath = await resolveProjectPath(name, registryWorkspace);
          const meta = await loadOrCreateProjectMetadata(projectPath, name);
          return resolveDirectiveLimits({
            projectDefaults: budgetDefaultsFromProjectMeta(meta),
            configDefaults: configBudgetDefaults,
          });
        } catch (err) {
          log.warn(
            { err, projectName: name },
            'daemon: resolveBuildLimits failed — directive will run uncapped',
          );
          return undefined;
        }
      };
      // Per-project budget mutator surfaced to channels (Discord
      // `/factory budget`, Telegram `/budget` once 2.2 ships). Resolves
      // the project by name (most-recently-touched wins on ties per
      // ADR 0021), writes `metadata.budgetDefaults` via
      // `updateProjectMetadata`, and maps wiki errors onto the stable
      // `SetProjectBudgetError` codes.
      const dbHandle = db as NonNullable<typeof db>;
      const registrySetProjectBudget = async (
        name: string,
        defaults: ProjectBudgetDefaults,
      ): Promise<{ projectId: string; defaults: ProjectBudgetDefaults }> => {
        const matches = projectsQ.findByName(dbHandle, name);
        if (matches.length === 0) {
          throw new SetProjectBudgetError('NOT_FOUND', `no project named "${name}"`);
        }
        if (matches.length > 1) {
          throw new SetProjectBudgetError(
            'AMBIGUOUS',
            `${matches.length.toString()} projects share the name "${name}" — disambiguate via the Web UI (per ADR 0021)`,
          );
        }
        const project = matches[0]!;
        try {
          const updated = await updateProjectMetadata(project.workspacePath, (meta) => ({
            ...meta,
            metadata: { ...meta.metadata, budgetDefaults: defaults },
          }));
          const persistedDefaults = budgetDefaultsFromProjectMeta(updated) ?? {};
          return { projectId: project.id, defaults: persistedDefaults };
        } catch (err) {
          if (err instanceof ProjectMetadataNotFoundError) {
            throw new SetProjectBudgetError('PATH_UNREADABLE', err.message);
          }
          if (err instanceof ProjectMetadataCorruptError) {
            throw new SetProjectBudgetError('METADATA_CORRUPT', err.message);
          }
          throw err;
        }
      };
      const registry = createChannelRegistry({
        log: createLogger('daemon.channels'),
        plugins,
        onInbound: (d: Directive) => {
          // An inbound directive from a channel gets written to the bus and
          // the brain claim loop is rung.
          try {
            directivesQ.insert(db as NonNullable<typeof db>, d);
            doorbell.emit('directive.new', { directiveId: d.id, reason: 'new' });
          } catch (err) {
            log.error({ err, directiveId: d.id }, 'daemon: channel inbound insert failed');
          }
        },
        resolveProjectPath: registryResolveProjectPath,
        resolveBuildLimits: registryResolveBuildLimits,
        setProjectBudget: registrySetProjectBudget,
      });
      await registry.start();
      subsystems.push({ name: 'channels', stop: () => registry.stop() });
      channelRegistry = registry;
    }

    if (opts.noIpc !== true) {
      const registry = channelRegistry;
      const workerAskUserDefaultDeadlineSeconds = opts.workerAskUserDefaultDeadlineSeconds ?? 3600;
      const workerAskUserHandler =
        opts.workerAuthToken !== undefined
          ? buildWorkerAskUserHandler({
              db,
              defaultDeadlineSeconds: workerAskUserDefaultDeadlineSeconds,
            })
          : undefined;
      ipc = await startIpcServer({
        host,
        port: requestedPort,
        db,
        doorbell,
        startedAt,
        version: DAEMON_VERSION,
        processName,
        ...(registry !== undefined ? { channels: registry } : {}),
        ...(registry !== undefined ? { deliverOutbound: (msg) => registry.send(msg) } : {}),
        ...(opts.workerAuthToken !== undefined ? { workerAuthToken: opts.workerAuthToken } : {}),
        ...(workerAskUserHandler !== undefined ? { workerAskUser: workerAskUserHandler } : {}),
        ...(opts.uiAuthToken !== undefined ? { uiAuthToken: opts.uiAuthToken } : {}),
        ...(opts.webUiStaticPath !== undefined ? { webUiStaticPath: opts.webUiStaticPath } : {}),
        configBudgetDefaults,
      });
      subsystems.push({ name: 'ipc', stop: ipc.stop });
    }

    let outboundWorker: OutboundWorkerHandle | undefined;
    if (channelRegistry !== undefined && opts.noOutboundWorker !== true) {
      const registry = channelRegistry;
      outboundWorker = startOutboundWorker({
        log: createLogger('daemon.outbound'),
        db,
        doorbell,
        deliver: (msg) => registry.send(msg),
        ...(opts.outboundPollIntervalMs !== undefined
          ? { pollIntervalMs: opts.outboundPollIntervalMs }
          : {}),
      });
      subsystems.push({ name: 'outbound', stop: () => outboundWorker!.stop() });
    }

    let brain: SupervisorHandle | undefined;
    if (opts.noBrain !== true) {
      brain = startBrainSupervisor({
        log: createLogger('daemon.brain'),
        db,
        doorbell,
        ...(opts.providerRegistry !== undefined ? { registry: opts.providerRegistry } : {}),
        ...(opts.serveConcurrency !== undefined ? { concurrency: opts.serveConcurrency } : {}),
      });
      subsystems.push({ name: 'brain', stop: brain.stop });
    }

    const eventSources: EventSource[] =
      opts.eventSources !== undefined
        ? [...opts.eventSources]
        : opts.noFsWatcher !== true
          ? [buildDefaultFsWatcher(db)]
          : [];
    for (const src of eventSources) {
      try {
        await src.start({
          log: createLogger(`daemon.events.${src.name}`),
          emit: (event: Event) => {
            try {
              eventsQ.append(db as NonNullable<typeof db>, event);
            } catch (err) {
              log.warn({ err, eventId: event.id }, 'daemon: events_audit append failed');
            }
          },
        });
        subsystems.push({ name: `events.${src.name}`, stop: () => src.stop() });
      } catch (err) {
        log.error({ err, source: src.name }, 'daemon: event source start failed');
      }
    }

    const boundPort = ipc?.boundPort ?? requestedPort;
    log.info({ host, port: boundPort, startedAt, subsystems: subsystems.length }, 'daemon: ready');

    let stopped = false;
    const stop = async (): Promise<void> => {
      if (stopped) return;
      stopped = true;
      log.info({ subsystems: subsystems.length }, 'daemon: stopping');
      for (const s of [...subsystems].reverse()) {
        try {
          await s.stop();
          log.debug({ subsystem: s.name }, 'daemon: subsystem stopped');
        } catch (err) {
          log.warn({ err, subsystem: s.name }, 'daemon: subsystem stop failed');
        }
      }
      doorbell.clear();
      if (db !== undefined) {
        closeDatabase(db);
      }
      pidFile?.release();
      log.info('daemon: stopped');
    };

    return {
      port: boundPort,
      pid: process.pid,
      startedAt,
      db,
      doorbell,
      stop,
    };
  } catch (err) {
    log.error({ err }, 'daemon: start failed, rolling back');
    for (const s of [...subsystems].reverse()) {
      try {
        await s.stop();
      } catch (stopErr) {
        log.debug({ stopErr, subsystem: s.name }, 'daemon: rollback stop failed');
      }
    }
    if (db !== undefined) {
      try {
        closeDatabase(db);
      } catch (dbErr) {
        log.debug({ dbErr }, 'daemon: rollback db close failed');
      }
    }
    pidFile?.release();
    throw err;
  }
}

/** Convenience symmetric stop. */
export async function stopDaemon(handle: DaemonHandle): Promise<void> {
  await handle.stop();
}

/**
 * Default channel set. Always includes the CLI-RPC plugin; includes the
 * Discord / Telegram plugins only when `config.toml` has a non-empty
 * token in the matching block. That way a user who installs factoryd
 * without touching those channels doesn't see a "discord: failed (no
 * token)" line on every startup.
 */
function buildDefaultChannelPlugins(
  fileConfig: Awaited<ReturnType<typeof loadConfig>>,
): ChannelPlugin[] {
  const plugins: ChannelPlugin[] = [createCliRpcChannel()];
  if (hasStringField(channelConfigFor(fileConfig, 'discord'), 'token')) {
    plugins.push(createDiscordChannel());
  }
  if (hasStringField(channelConfigFor(fileConfig, 'telegram'), 'botToken')) {
    plugins.push(createTelegramChannel());
  }
  return plugins;
}

/** True when `block[field]` is a non-empty string. */
function hasStringField(block: unknown, field: string): boolean {
  if (typeof block !== 'object' || block === null) return false;
  const value = (block as Record<string, unknown>)[field];
  return typeof value === 'string' && value.length > 0;
}

/**
 * Build the `POST /worker/ask-user` handler (ADR 0024 §2–§3). Closes over
 * the daemon's `db` so each request reaches the brain's existing `askUser()`
 * helper. Validates that `taskId` actually belongs to a `tasks_inflight` row
 * for the requested directive (defense-in-depth — a spoofed taskId from a
 * compromised worker can't poison sibling questions).
 *
 * Exported so the regression suite (sub-step 8.6) can compose the handler
 * with a known DB state and a fast `pollIntervalMs` — production callers
 * leave `pollIntervalMs` undefined, inheriting `askUser`'s default of 1 s.
 */
export function buildWorkerAskUserHandler(opts: {
  db: Database;
  defaultDeadlineSeconds: number;
  /**
   * Override for the poll cadence against `pending_questions`. Tests pass
   * a small value (e.g. 10 ms) so answer-arrives-mid-wait races complete
   * in sub-second time; production leaves this undefined.
   */
  pollIntervalMs?: number;
}): (req: WorkerAskUserRequest) => Promise<WorkerAskUserResponse> {
  return async (req) => {
    // Validate (taskId, directiveId) pair exists in tasks_inflight.
    const tasks = tasksInflight.listByDirective(opts.db, req.directiveId);
    const taskMatch = tasks.find((t) => t.id === req.taskId);
    if (taskMatch === undefined) {
      throw new IpcRequestError(
        404,
        'WORKER_TASK_NOT_FOUND',
        `taskId ${req.taskId} not found for directive ${req.directiveId}`,
      );
    }

    // Compute deadlineAt. Per-request override wins; falls back to daemon default.
    const deadlineSeconds = req.deadlineSeconds ?? opts.defaultDeadlineSeconds;
    const deadlineAt = new Date(Date.now() + deadlineSeconds * 1000).toISOString();

    // ADR 0024 §4: mark the task `'waiting_for_human'` BEFORE the poll loop
    // starts (via askUser's onQuestionResolved hook), so brain-startup
    // orphan-cleanup can detect the row if we're killed mid-wait. Flip
    // back to `'running'` when askUser returns (answered or timed out);
    // markRunningAfterAnswer is a no-op if the orphan-cleanup race already
    // moved the task to `'aborted'`.
    let markedWaiting = false;
    try {
      const result = await askUser({
        db: opts.db,
        directiveId: req.directiveId,
        taskId: req.taskId,
        question: req.question,
        ...(req.options !== undefined ? { options: req.options } : {}),
        deadlineAt,
        ...(opts.pollIntervalMs !== undefined ? { pollIntervalMs: opts.pollIntervalMs } : {}),
        onQuestionResolved: (questionId) => {
          tasksInflight.markWaitingForHuman(
            opts.db,
            req.taskId,
            questionId,
            new Date().toISOString(),
          );
          markedWaiting = true;
        },
      });

      if (markedWaiting) {
        tasksInflight.markRunningAfterAnswer(opts.db, req.taskId, new Date().toISOString());
      }

      return {
        questionId: result.questionId,
        ...(result.answer !== undefined ? { answer: result.answer } : {}),
        timedOut: result.timedOut,
        aborted: result.aborted,
      };
    } catch (err) {
      // Best-effort cleanup if we set the wait state but never flipped back.
      // Orphan-recovery on next brain startup is the backstop if this also
      // fails (e.g. db closed mid-throw).
      if (markedWaiting) {
        try {
          tasksInflight.markRunningAfterAnswer(opts.db, req.taskId, new Date().toISOString());
        } catch {
          /* ignore — orphan recovery handles it */
        }
      }
      throw err;
    }
  };
}

/**
 * Brain-startup orphan-cleanup pass (ADR 0024 §4). Any task left in
 * `'waiting_for_human'` from a previous daemon process is by definition
 * orphaned — its worker subprocess died with the previous brain. Mark
 * each one `'aborted'` with reason `'brain_restart_during_human_wait'`
 * so the operator can tell why the directive halted, and so any
 * answer that arrives later for the linked question is correctly
 * recognized as "answered after task ended" by the channel collector.
 *
 * Called once during `startDaemon`, before the brain supervisor starts
 * spawning new workers. Exported so the regression suite (sub-step 8.6)
 * can drive this recovery without spinning up a full daemon. Returns the
 * count of recovered tasks for logging.
 */
export function recoverFromHumanWaits(db: Database, log: ReturnType<typeof createLogger>): number {
  const orphans = tasksInflight.findOrphanedHumanWaits(db);
  if (orphans.length === 0) return 0;
  const when = new Date().toISOString();
  for (const o of orphans) {
    tasksInflight.markAborted(db, o.id, 'brain_restart_during_human_wait', when);
    log.warn(
      {
        taskId: o.id,
        directiveId: o.directiveId,
        questionId: o.waitingQuestionId,
      },
      'daemon: aborted orphaned human-wait task at startup',
    );
  }
  return orphans.length;
}

/**
 * Build the default fs-watcher, resolving project roots lazily each call so
 * the watcher picks up newly-registered projects after the daemon started.
 *
 * The chokidar watcher currently snapshots roots at `start()`, so roots added
 * after startup require a daemon restart. That's acceptable for Phase 3; a
 * future iteration can react to `projects.upsert` via the doorbell.
 */
function buildDefaultFsWatcher(db: Database): FsWatcher {
  return createFsWatcher({
    roots: () => {
      try {
        return projectsQ
          .listAll(db)
          .filter((p) => p.status === 'active')
          .map((p) => p.workspacePath);
      } catch (err) {
        log.warn({ err }, 'daemon: project list failed — fs-watcher idle');
        return [];
      }
    },
  });
}

export * from './brain-supervisor.js';
export * from './doorbell.js';
export * from './outbound-worker.js';
export * from './pidfile.js';
export * from './server.js';
export * from './supervisor.js';
