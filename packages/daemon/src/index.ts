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

import type { Directive, Event } from '@factory5/core';
import { channelConfigFor, loadConfig } from '@factory5/brain';
import {
  createChannelRegistry,
  createCliRpcChannel,
  createDiscordChannel,
  type ChannelPlugin,
  type ChannelRegistry,
} from '@factory5/channels';
import { createFsWatcher, type EventSource, type FsWatcher } from '@factory5/events';
import type { ProviderRegistry } from '@factory5/providers';
import {
  directives as directivesQ,
  events as eventsQ,
  projects as projectsQ,
} from '@factory5/state';

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
    }

    let channelRegistry: ChannelRegistry | undefined;
    if (opts.noChannels !== true) {
      // Resolve per-plugin config: explicit `opts.channelConfigs` wins over
      // anything we'd load from `config.toml`. Missing config blocks are
      // passed as `undefined` — each plugin's `configSchema` defaults
      // whatever the schema says is optional.
      const fileConfig =
        opts.noConfigFile === true ? undefined : await loadConfig().catch(() => undefined);
      const pluginList = opts.channelPlugins ?? buildDefaultChannelPlugins(fileConfig);
      const plugins = pluginList.map((plugin) => {
        const overrideBlock = opts.channelConfigs?.[plugin.id];
        const fileBlock = channelConfigFor(fileConfig, plugin.id);
        return { plugin, config: overrideBlock ?? fileBlock };
      });
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
      });
      await registry.start();
      subsystems.push({ name: 'channels', stop: () => registry.stop() });
      channelRegistry = registry;
    }

    if (opts.noIpc !== true) {
      const registry = channelRegistry;
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
 * Discord plugin only when `config.toml` has a `[channels.discord]` block
 * with a non-empty `token`. That way a user who installs factoryd without
 * touching Discord doesn't see a "discord: failed (no token)" line on
 * every startup.
 */
function buildDefaultChannelPlugins(
  fileConfig: Awaited<ReturnType<typeof loadConfig>>,
): ChannelPlugin[] {
  const plugins: ChannelPlugin[] = [createCliRpcChannel()];
  const discord = channelConfigFor(fileConfig, 'discord');
  const token =
    typeof discord === 'object' && discord !== null
      ? (discord as { token?: unknown }).token
      : undefined;
  if (typeof token === 'string' && token.length > 0) {
    plugins.push(createDiscordChannel());
  }
  return plugins;
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
