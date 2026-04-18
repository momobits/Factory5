#!/usr/bin/env tsx
/**
 * End-to-end smoke test for factoryd (Phase 3).
 *
 * Run with: `pnpm tsx scripts/e2e-daemon.ts`
 *
 * Flow:
 *   1. Create a temp data dir and set `FACTORY5_DATA_DIR`, `FACTORY5_PIDFILE`,
 *      and `FACTORY5_TEST_PROVIDER=stub` in the child env.
 *   2. Spawn `factoryd --foreground` as a child process.
 *   3. Poll `/healthz` until it's ready; then hit `/status`.
 *   4. Insert a `chat` directive into SQLite, call `/directives/notify`, and
 *      poll the directive until it reaches a terminal status.
 *   5. Assert `tasks_inflight` has zero non-terminal rows and no worktree
 *      directories leaked on disk.
 *   6. Send SIGTERM and wait for the daemon to exit cleanly.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import {
  accessSync,
  constants as fsConstants,
  existsSync,
  mkdtempSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import process, { exit } from 'node:process';
import { fileURLToPath } from 'node:url';

import { newId } from '@factory5/core';
import { createDaemonClient } from '@factory5/ipc';
import {
  directives as directivesQ,
  openDatabase,
  outbound as outboundQ,
  runMigrations,
  tasksInflight,
} from '@factory5/state';

// ---------- fixtures ----------

const tmp = mkdtempSync(join(tmpdir(), 'factory5-e2e-'));
const dataDir = join(tmp, 'data');
const pidFile = join(dataDir, 'factoryd.pid');

const childEnv: NodeJS.ProcessEnv = {
  ...process.env,
  FACTORY5_DATA_DIR: dataDir,
  FACTORY5_PIDFILE: pidFile,
  FACTORY5_TEST_PROVIDER: 'stub',
  FACTORY5_LOG_LEVEL: 'info',
};

// ---------- binary resolution ----------

function findRepoRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 12; i++) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('cannot locate factory5 repo root');
}

/**
 * Resolve the path to the `tsx` ESM loader entry (`dist/esm/index.mjs`).
 * We invoke it via `node --import <loader>` so we sidestep the Windows
 * `.cmd` shim + `spawn EINVAL` footgun that hits when you try to spawn
 * node_modules/.bin shims directly.
 */
function resolveTsxLoader(root: string): string {
  const candidate = join(root, 'node_modules', 'tsx', 'dist', 'loader.mjs');
  try {
    accessSync(candidate, fsConstants.R_OK);
    return candidate;
  } catch {
    // Fall through to the import name — Node will still resolve `tsx/esm`
    // via package.json exports on most platforms.
  }
  return 'tsx/esm';
}

// ---------- helpers ----------

const results: { name: string; ok: boolean; detail?: string }[] = [];
function assert(name: string, ok: boolean, detail?: string): void {
  results.push({ name, ok, ...(detail !== undefined ? { detail } : {}) });
  const prefix = ok ? '✓' : '✗';
  const suffix = detail !== undefined ? ` — ${detail}` : '';
  process.stdout.write(`  ${prefix} ${name}${suffix}\n`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitFor(
  label: string,
  predicate: () => Promise<boolean>,
  budgetMs = 10_000,
  pollMs = 100,
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < budgetMs) {
    if (await predicate()) return true;
    await sleep(pollMs);
  }
  process.stdout.write(`  (timeout waiting for: ${label})\n`);
  return false;
}

async function daemonHealthy(): Promise<boolean> {
  try {
    const res = await fetch('http://127.0.0.1:25295/healthz');
    if (!res.ok) return false;
    const body = (await res.json()) as { ok?: boolean };
    return body.ok === true;
  } catch {
    return false;
  }
}

// ---------- runner ----------

async function main(): Promise<void> {
  const root = findRepoRoot();
  const loader = resolveTsxLoader(root);
  const factorydMain = join(root, 'apps', 'factoryd', 'src', 'main.ts');
  const factorydDist = join(root, 'apps', 'factoryd', 'dist', 'main.js');

  // Prefer the compiled dist if present — avoids loader ceremony entirely.
  const useDist = existsSync(factorydDist);
  const runnerArgs: string[] = useDist
    ? [factorydDist, '--foreground']
    : ['--import', loader, factorydMain, '--foreground'];

  if (!useDist && !existsSync(factorydMain)) {
    process.stdout.write(`cannot find factoryd source at ${factorydMain}\n`);
    exit(1);
  }

  process.stdout.write(`e2e-daemon — tmp=${tmp}\n`);
  process.stdout.write(`  mode:     ${useDist ? 'dist' : 'tsx/esm (source)'}\n`);
  process.stdout.write(`  factoryd: ${useDist ? factorydDist : factorydMain}\n\n`);

  process.stdout.write('Starting factoryd…\n');
  const child: ChildProcess = spawn(process.execPath, runnerArgs, {
    env: childEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
    cwd: root,
  });
  let childStdout = '';
  child.stdout?.on('data', (d: Buffer) => {
    childStdout += d.toString();
  });
  child.stderr?.on('data', (d: Buffer) => {
    childStdout += d.toString();
  });

  let childExited = false;
  let childExitCode: number | null = null;
  child.once('exit', (code) => {
    childExited = true;
    childExitCode = code;
  });

  try {
    // 1. Liveness via /healthz.
    const healthy = await waitFor('factoryd /healthz', daemonHealthy, 20_000, 250);
    assert('daemon /healthz responds', healthy);
    if (!healthy) return;

    // 2. /status returns schema-valid body + includes cli channel.
    const client = createDaemonClient({ timeoutMs: 3000 });
    try {
      const status = await client.status();
      assert(
        'daemon /status returns schema-valid body',
        true,
        `pid=${String(status.pid)} channels=${String(status.channels.length)}`,
      );
      assert(
        'cli channel is registered',
        status.channels.some((c) => c.id === 'cli'),
      );
    } catch (err) {
      assert('daemon /status returns schema-valid body', false, (err as Error).message);
      return;
    }

    // 3. Enqueue a directive + notify.
    const db = openDatabase(join(dataDir, 'factory.db'));
    runMigrations(db);
    const directiveId = newId();
    directivesQ.insert(db, {
      id: directiveId,
      source: 'cli',
      principal: 'e2e',
      channelRef: 'e2e-session',
      intent: 'chat',
      payload: { text: 'hello from e2e' },
      autonomy: 'chat',
      createdAt: new Date().toISOString(),
      status: 'pending',
    });

    try {
      const ack = await client.notifyDirective({ directiveId, reason: 'new' });
      assert('/directives/notify acknowledged', ack.acknowledged);
    } catch (err) {
      assert('/directives/notify acknowledged', false, (err as Error).message);
    }

    // 4. Wait for terminal status.
    const terminal = await waitFor(
      'directive terminal',
      () =>
        Promise.resolve(
          ['complete', 'failed', 'blocked'].includes(
            directivesQ.getById(db, directiveId)?.status ?? 'pending',
          ),
        ),
      15_000,
      250,
    );
    const finalDirective = directivesQ.getById(db, directiveId);
    assert(
      'directive reached terminal status',
      terminal,
      `status=${String(finalDirective?.status)}`,
    );

    // 5. No non-terminal tasks_inflight for this directive.
    const inflight = tasksInflight.listByDirective(db, directiveId);
    const stuck = inflight.filter(
      (t) => t.status !== 'complete' && t.status !== 'failed' && t.status !== 'blocked',
    );
    assert('tasks_inflight has no non-terminal rows', stuck.length === 0);

    // 5b. The brain's chat reply surfaced as an outbound row addressed to
    //     this session. The worker will have tried to deliver it; since the
    //     e2e script isn't registered as a live cli-rpc session, the row
    //     stays undelivered — but it must exist with the triage summary.
    const rows = outboundQ
      .listPending(db, 50)
      .filter((m) => m.targetChannel === 'cli' && m.targetRef === 'e2e-session');
    assert(
      'brain enqueued a chat-reply outbound row',
      rows.length === 1 && rows[0]?.text.startsWith('(triage) intent='),
      rows[0]?.text,
    );

    // 6. No orphaned worktrees on disk (chat directive never allocates one).
    let orphans = 0;
    try {
      const entries = readdirSync(join(dataDir, '.factory', 'worktrees'));
      orphans = entries.length;
    } catch {
      // ENOENT — no worktrees dir at all, which is what we expect.
    }
    assert('no orphaned worktrees', orphans === 0);

    db.close();
  } finally {
    // 7. SIGTERM and verify the child exits.
    //
    // Node translates SIGTERM to a forcible termination on Windows (POSIX
    // signals don't exist there), so the exit code is reported as null with
    // a signal of SIGTERM. On Unix the daemon's signal handler runs and
    // exits with code 0. We assert the weaker but platform-portable claim:
    // the process exited within 10 s of SIGTERM.
    if (!childExited) {
      process.stdout.write('\nSending SIGTERM…\n');
      try {
        child.kill('SIGTERM');
      } catch (err) {
        process.stdout.write(`  kill threw: ${(err as Error).message}\n`);
      }
      const exited = await waitFor('child exit', () => Promise.resolve(childExited), 10_000, 100);
      assert('factoryd exited after SIGTERM', exited, `code=${String(childExitCode)}`);
      if (process.platform !== 'win32') {
        assert(
          'factoryd exited with code 0 (unix clean shutdown)',
          childExitCode === 0,
          `code=${String(childExitCode)}`,
        );
      }
    }
    process.stdout.write('\n--- factoryd stdout+stderr (last 1000 chars) ---\n');
    process.stdout.write(childStdout.slice(-1000) + '\n');
  }

  // Cleanup temp dir on success; leave it behind on failure for inspection.
  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;
  if (failed === 0) {
    try {
      rmSync(tmp, { recursive: true, force: true });
    } catch {
      // ignore
    }
  } else {
    process.stdout.write(`\nTemp dir preserved: ${tmp}\n`);
  }

  process.stdout.write(`\n${String(passed)}/${String(results.length)} checks passed\n`);
  if (failed > 0) exit(1);
}

main().catch((err: unknown) => {
  process.stdout.write(`e2e-daemon: unhandled error: ${(err as Error).message}\n`);
  process.stdout.write(`${(err as Error).stack ?? ''}\n`);
  exit(1);
});
