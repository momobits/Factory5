/**
 * `runWorker` — execute a single task.
 *
 * The worker is deliberately independent of `@factory5/brain` to keep the
 * dependency DAG acyclic (brain → worker, not the other way). The brain
 * composes the system prompt + user prompt (so it can include agent-specific
 * skill bodies) and hands both to the worker via {@link WorkerOptions}.
 *
 * Two execution paths, selected by agent role:
 *
 *   - **Read-only** (triage, architect, planner, reviewer, investigator,
 *     verifier): single-shot `provider.call()`; the agent's text response
 *     is parsed for `FINDING [...]` markers. No worktree.
 *
 *   - **Tool-using** (scaffolder, builder, fixer): `provider.stream()` with
 *     `cwd = <per-task worktree>`, `allowedTools = agent.tools`, and
 *     `permissionMode = 'bypassPermissions'`. The agent writes files directly
 *     into the worktree via its Write/Edit/Bash tools; on success we merge
 *     the task branch back into the project's main branch, on failure we
 *     leave the worktree in place for inspection.
 *
 * Both paths honor `opts.signal` for cancellation. Both populate
 * {@link WorkerOutcome} with `findingsRaised`, `filesChanged`, and the
 * usage record the brain persists into `model_usage`.
 */

import { rm, writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { env, execPath } from 'node:process';

import type { AgentRole, Finding, Task, TaskResult } from '@factory5/core';
import { createLogger } from '@factory5/logger';
import {
  ClaudeCliStreamError,
  type CategoryResolution,
  type ProviderRegistry,
  type ProviderResponse,
  type ProviderUsage,
} from '@factory5/providers';
import {
  addFinding,
  appendBuildLog,
  findRepoTemplatesDir,
  listFindings,
  readWiki,
  updateFindingStatus,
  type FindingRegistryBinding,
} from '@factory5/wiki';
import { buildMcpConfig, getServerScriptPath } from '@factory5/worker-mcp';
import {
  evaluateToolCall,
  writeWorktreeSandbox,
  type WorkerSandboxConfig,
  type WrittenSandbox,
} from '@factory5/worker-sandbox';
import { simpleGit } from 'simple-git';

import { parseFindings } from './parse-findings.js';
import { parseResolutions } from './parse-resolutions.js';
import { allocateWorktree, cleanupWorktree, type WorktreeHandle } from './worktree.js';

const log = createLogger('worker');
const sandboxLog = createLogger('worker.sandbox');

export interface WorkerOptions {
  task: Task;
  projectPath: string;
  registry: ProviderRegistry;
  /** System prompt (agent prompt + skills) — built by the brain. */
  systemPrompt: string;
  /**
   * User prompt body. The worker will append an auto-generated `# Context`
   * block (open findings + wiki digest) before sending.
   */
  userPrompt: string;
  /**
   * Tool whitelist for tool-using agents (scaffolder/builder/fixer).
   * Passed through to the provider's `stream()` path via
   * `ProviderRequest.allowedTools`. Ignored for read-only agents. If
   * omitted, a default of
   * `['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep']` is used.
   */
  allowedTools?: readonly string[];
  /**
   * Optional binding to the cross-project `findings_registry` (Phase
   * 6a). When supplied, every finding raised during this task is
   * dual-written: the per-project `findings.json` remains the source
   * of truth; the registry row is upserted best-effort. Pass
   * `originDirectiveId` so the registry can tie findings back to the
   * directive for cross-project traceability.
   */
  findingRegistry?: FindingRegistryBinding;
  /**
   * Optional MCP `ask_user` configuration (per ADR 0024 §1, sub-step 8.3).
   * When supplied for a tool-using agent, the worker writes a temporary
   * mcp-config JSON, points claude-cli at it via `--mcp-config`, and the
   * `mcp__factory5-ask-user__ask_user` tool becomes available to the
   * in-stream agent. Skipped silently for read-only agents (which take
   * the brain-checkpointed `escalateBlocked` path instead).
   */
  askUserConfig?: WorkerAskUserConfig;
  /** Optional cancellation signal — propagates into the provider call. */
  signal?: AbortSignal;
  /**
   * Tier 15 / ADR 0034 — pool watchdog callback. Invoked after each
   * stream chunk on the tool-using path. When the callback returns
   * `{ interrupt: true }`, the worker aborts the in-flight provider
   * stream via its internal AbortController and the resulting outcome
   * carries `errorSubtype: 'pool-exhausted-midstream'` so the pool
   * dispatcher recognises it as a parking signal rather than a generic
   * failure. Ignored on the read-only path (no stream).
   */
  onTurnComplete?: () => { interrupt: boolean };
  /**
   * F4 / ADR 0034 §6 — remaining pool headroom for the task's axis.
   * Passed as `maxTurns` to the provider so `--max-turns` acts as a
   * safety ceiling aligned with the pool cap. When undefined (read-only
   * agents, or no axis mapped), no `--max-turns` is forwarded — the
   * pool watchdog is the sole authority.
   */
  poolRemainingTurns?: number;
}

export interface WorkerAskUserConfig {
  /** Daemon's IPC base URL (e.g. `http://127.0.0.1:25295`). */
  brainRpcUrl: string;
  /** Per-startup bearer token from `FACTORY5_WORKER_AUTH_TOKEN`. */
  brainRpcToken: string;
  /** ULID of the parent directive — required so brain-side proxy can correlate. */
  directiveId: string;
}

export interface WorkerOutcome {
  result: TaskResult;
  /** Raw model text (if the call succeeded). */
  rawResponse?: string;
  /** Chosen provider/model + usage for the brain to record. */
  usage?: {
    resolution: CategoryResolution;
    response: ProviderResponse;
    durationMs: number;
  };
  /**
   * The worktree allocated for this task (present only for tool-using
   * agents). The brain uses this to heartbeat `tasks_inflight.worktree_path`
   * and surfaces the path in logs when tasks fail.
   */
  worktree?: WorktreeHandle;
}

const DEFAULT_TOOL_ALLOWLIST: readonly string[] = ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep'];

/** True for agents that write files and therefore need a worktree. */
export function isToolUsingAgent(role: AgentRole): boolean {
  return role === 'scaffolder' || role === 'builder' || role === 'fixer';
}

async function buildContextBlock(projectPath: string): Promise<string> {
  const [wiki, openFindings] = await Promise.all([
    readWiki(projectPath),
    listFindings(projectPath, { status: 'OPEN' }),
  ]);
  const wikiDigest =
    wiki.length === 0
      ? '(no wiki yet)'
      : wiki.map((p) => `--- ${p.slug} ---\n${p.content.slice(0, 2000)}`).join('\n\n');
  const findingDigest =
    openFindings.length === 0
      ? '(no open findings)'
      : openFindings
          .map((f) => `- ${f.id} [${f.severity}] ${f.target}: ${f.description}`)
          .join('\n');
  return [
    '# Context',
    '',
    '## Open findings',
    findingDigest,
    '',
    '## Project wiki',
    wikiDigest,
  ].join('\n');
}

/**
 * List files the agent modified inside the worktree, combining uncommitted
 * status with committed diff against the base branch. Returns relative paths.
 */
async function listChangedFiles(handle: WorktreeHandle): Promise<string[]> {
  const git = simpleGit(handle.path);
  const files = new Set<string>();
  try {
    const status = await git.status();
    for (const f of status.files) files.add(f.path);
  } catch {
    /* fallthrough — worktree may already be removed */
  }
  try {
    const diff = await git.raw(['diff', '--name-only', `${handle.baseBranch}...HEAD`]);
    for (const line of diff.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (trimmed.length > 0) files.add(trimmed);
    }
  } catch {
    /* ignore — no commits yet is a non-error */
  }
  return [...files].sort();
}

async function persistFindings(
  projectPath: string,
  agent: AgentRole,
  taskId: string,
  responseText: string,
  findingRegistry: FindingRegistryBinding | undefined,
): Promise<string[]> {
  const findingIds: string[] = [];
  if (responseText.length === 0) return findingIds;
  const parsed = parseFindings(responseText);
  for (const p of parsed) {
    const f: Finding = await addFinding(
      projectPath,
      {
        source: agent,
        target: p.target,
        severity: p.severity,
        description: p.description,
      },
      findingRegistry,
    );
    findingIds.push(f.id);
  }
  if (parsed.length > 0) {
    await appendBuildLog(
      projectPath,
      `${agent} (task ${taskId}) raised ${String(parsed.length)} finding(s)`,
    );
  }
  return findingIds;
}

/**
 * Parse `RESOLUTION <FID> (FIXED|VERIFIED|WONTFIX): <prose>` markers from
 * agent output and dispatch {@link updateFindingStatus} for each one. The
 * fixer is the canonical emitter (per `prompts/agents/fixer.md`); other
 * agents typically don't emit, but the parser runs unconditionally to
 * stay future-proof — output without markers is a no-op.
 *
 * If a marker references a finding ID that doesn't exist (typo, stale
 * ref), `updateFindingStatus` throws. We log + skip rather than failing
 * the task — the operator can read the agent's response text to see the
 * orphan marker.
 *
 * Sequenced after {@link persistFindings} at the call site because both
 * operate on `<project>/.factory/findings.json` via read-modify-write;
 * concurrent execution would race.
 */
async function persistResolutions(
  projectPath: string,
  agent: AgentRole,
  taskId: string,
  responseText: string,
  findingRegistry: FindingRegistryBinding | undefined,
): Promise<string[]> {
  const flippedIds: string[] = [];
  if (responseText.length === 0) return flippedIds;
  const parsed = parseResolutions(responseText);
  for (const p of parsed) {
    try {
      const f = await updateFindingStatus(
        projectPath,
        p.fid,
        p.status,
        p.resolution,
        findingRegistry,
      );
      flippedIds.push(f.id);
    } catch (err) {
      log.warn(
        { err, projectPath, fid: p.fid, status: p.status, taskId, agent },
        'worker: RESOLUTION marker references unknown or invalid finding — skipping',
      );
    }
  }
  if (flippedIds.length > 0) {
    await appendBuildLog(
      projectPath,
      `${agent} (task ${taskId}) flipped ${String(flippedIds.length)} finding(s)`,
    );
  }
  return flippedIds;
}

/**
 * Write the per-task mcp-config JSON to a tmp file and return its path.
 * Tmp directory rather than the worktree because the worktree is git-tracked
 * and we don't want a transient config file showing up in the agent's
 * `git status` output (let alone an accidental commit). Tmp files are
 * cleaned up by the runTooling caller on stream completion.
 */
async function writeMcpConfig(taskId: string, cfg: WorkerAskUserConfig): Promise<string> {
  const path = join(tmpdir(), `factory5-mcp-${taskId}.json`);
  const config = buildMcpConfig({
    scriptPath: getServerScriptPath(),
    brainRpcUrl: cfg.brainRpcUrl,
    brainRpcToken: cfg.brainRpcToken,
    taskId,
    directiveId: cfg.directiveId,
  });
  await writeFile(path, JSON.stringify(config, null, 2), 'utf8');
  return path;
}

/**
 * Prepare the per-spawn worker filesystem-scoping sandbox per ADR 0028.
 *
 * Writes `<worktree>/.claude/settings.local.json` (Claude Code's
 * highest-precedence non-managed settings file) plus a sibling
 * `factory5-sandbox-config.json` carrying the parsed
 * {@link WorkerSandboxConfig}. The settings file declares
 * `permissions.deny` for obvious danger zones (`~/.ssh`, `/etc`,
 * `C:/Windows`, …) plus a `PreToolUse` hook that runs the
 * affirmative path-prefix algebra on every `Read`/`Write`/`Edit`/
 * `Glob`/`Grep` call.
 *
 * Returns the {@link WrittenSandbox} handle so the caller can `rm -rf`
 * `<worktree>/.claude/` at end-of-stream — the worktree is git-tracked
 * and `mergeAndRemove` runs `git add -A` before merging back, so the
 * per-spawn config must not bleed into the merged commit.
 *
 * Returns `undefined` when `FACTORY5_DISABLE_WORKER_SANDBOX=1` is set
 * in the environment — the operator-visible escape hatch for emergency
 * rollback / 12.4 A/B testing (ADR 0028 — Reversibility).
 */
export async function prepareSandbox(
  projectPath: string,
  worktreePath: string,
  taskId: string,
): Promise<WrittenSandbox | undefined> {
  if (env['FACTORY5_DISABLE_WORKER_SANDBOX'] === '1') {
    sandboxLog.warn(
      { taskId, projectPath },
      'worker.sandbox: disabled by FACTORY5_DISABLE_WORKER_SANDBOX=1 — worker has host-wide fs access',
    );
    return undefined;
  }
  const readOnlyRoots: string[] = [join(projectPath, '.factory')];
  const templatesDir = await findRepoTemplatesDir();
  if (templatesDir !== undefined) {
    readOnlyRoots.push(templatesDir);
  }
  const config: WorkerSandboxConfig = {
    workspaceRoots: [worktreePath],
    readOnlyRoots,
    allowSymlinks: false,
  };

  // Smoke-check the algebra before we hand it to claude-cli. Cheaper
  // than catching a mid-stream tool-use failure post-spawn.
  const smoke = evaluateToolCall({
    toolName: 'Read',
    toolInput: { file_path: join(worktreePath, '__sandbox_smoke__.txt') },
    cwd: worktreePath,
    config,
  });
  if (smoke.decision !== 'allow') {
    throw new Error(
      `worker-sandbox smoke check failed (rejected an in-scope path): ${smoke.reason}`,
    );
  }

  const written = await writeWorktreeSandbox(worktreePath, config, {
    nodeBinary: execPath,
  });
  sandboxLog.info(
    {
      taskId,
      worktreePath,
      readOnlyRoots,
      settingsPath: written.settingsPath,
    },
    'worker.sandbox: gate up — Read/Write/Edit/Glob/Grep scoped to worktree + readOnlyRoots',
  );
  return written;
}

async function runReadOnly(opts: WorkerOptions, fullUserPrompt: string): Promise<WorkerOutcome> {
  const resolution = await opts.registry.resolve(opts.task.category);
  log.info(
    {
      taskId: opts.task.id,
      agent: opts.task.agent,
      category: opts.task.category,
      provider: resolution.provider.id,
      model: resolution.model,
      mode: 'call',
    },
    'worker: starting (read-only)',
  );

  const started = Date.now();
  let responseText = '';
  let response: ProviderResponse | undefined;
  let error: string | undefined;
  try {
    response = await resolution.provider.call({
      model: resolution.model,
      systemPrompt: opts.systemPrompt,
      messages: [{ role: 'user', content: fullUserPrompt }],
      temperature: 0.2,
      ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
    });
    responseText = response.text;
  } catch (err) {
    error = (err as Error).message;
    if ((err as Error).name === 'AbortError') {
      log.warn({ taskId: opts.task.id }, 'worker: aborted by caller');
    } else {
      log.error({ err, taskId: opts.task.id }, 'worker: provider call failed');
    }
  }

  const findingIds = await persistFindings(
    opts.projectPath,
    opts.task.agent,
    opts.task.id,
    responseText,
    opts.findingRegistry,
  );
  await persistResolutions(
    opts.projectPath,
    opts.task.agent,
    opts.task.id,
    responseText,
    opts.findingRegistry,
  );

  const durationMs = Date.now() - started;
  // Tier 15 / ADR 0034 — capture `numTurns` from the provider response when
  // present. Read-only agents (no tool use) typically report 1 turn from
  // claude-cli; the pool's `axisForAgent` returns undefined for these agents
  // so they don't contribute to a `maxTurns*` pool anyway, but threading the
  // field through keeps the TaskResult shape symmetrical with the tool-using
  // path and surfaces the value for diagnostics.
  const numTurns = response?.numTurns;
  const result: TaskResult = {
    exitCode: error === undefined ? 0 : 1,
    filesChanged: [],
    findingsRaised: findingIds,
    signalsEmitted: [],
    ...(error !== undefined ? { error } : {}),
    durationMs,
    ...(numTurns !== undefined ? { turnsUsed: numTurns } : {}),
  };

  log.info(
    {
      taskId: opts.task.id,
      exitCode: result.exitCode,
      findings: findingIds.length,
      durationMs,
      ...(numTurns !== undefined ? { turnsUsed: numTurns } : {}),
    },
    'worker: complete (read-only)',
  );

  const outcome: WorkerOutcome = { result };
  if (responseText.length > 0) outcome.rawResponse = responseText;
  if (response !== undefined) outcome.usage = { resolution, response, durationMs };
  return outcome;
}

async function runTooling(opts: WorkerOptions, fullUserPrompt: string): Promise<WorkerOutcome> {
  const resolution = await opts.registry.resolve(opts.task.category);
  const allowed = opts.allowedTools ?? DEFAULT_TOOL_ALLOWLIST;

  let worktree: WorktreeHandle;
  try {
    worktree = await allocateWorktree({
      projectPath: opts.projectPath,
      taskId: opts.task.id,
    });
  } catch (err) {
    const message = (err as Error).message;
    log.error({ err, taskId: opts.task.id }, 'worker: worktree allocation failed');
    const result: TaskResult = {
      exitCode: 1,
      filesChanged: [],
      findingsRaised: [],
      signalsEmitted: [],
      error: `worktree allocation failed: ${message}`,
      durationMs: 0,
    };
    return { result };
  }

  log.info(
    {
      taskId: opts.task.id,
      agent: opts.task.agent,
      category: opts.task.category,
      provider: resolution.provider.id,
      model: resolution.model,
      worktreePath: worktree.path,
      allowedTools: allowed,
      mode: 'stream',
    },
    'worker: starting (tool-using)',
  );

  // ADR 0024 §1 (sub-step 8.3): if the brain wired an askUserConfig, write a
  // per-task mcp-config to a tmp file and pass it to claude via --mcp-config.
  // The MCP server's env block carries the bearer token + correlation ids
  // back to the brain RPC. Skipped silently when the brain hasn't wired
  // askUser support (workers still function, agents just lack ask_user).
  let mcpConfigPath: string | undefined;
  if (opts.askUserConfig !== undefined) {
    try {
      mcpConfigPath = await writeMcpConfig(opts.task.id, opts.askUserConfig);
    } catch (err) {
      log.warn(
        { err, taskId: opts.task.id },
        'worker: mcp-config write failed — agent will run without ask_user',
      );
    }
  }

  // ADR 0028: stand up the worker filesystem-scoping sandbox before the
  // provider spawn. Failure here is fatal — set FACTORY5_DISABLE_WORKER_SANDBOX=1
  // to bypass for emergency rollback. The sandbox handle is cleaned up
  // in the finally below so the per-spawn `.claude/` directory does not
  // bleed into the worktree's `git add -A` at merge time.
  let sandbox: WrittenSandbox | undefined;
  try {
    sandbox = await prepareSandbox(opts.projectPath, worktree.path, opts.task.id);
  } catch (err) {
    const message = (err as Error).message;
    log.error(
      { err, taskId: opts.task.id, worktreePath: worktree.path },
      'worker: sandbox setup failed — set FACTORY5_DISABLE_WORKER_SANDBOX=1 to bypass',
    );
    const result: TaskResult = {
      exitCode: 1,
      filesChanged: [],
      findingsRaised: [],
      signalsEmitted: [],
      error: `sandbox setup failed: ${message}`,
      durationMs: 0,
    };
    return { result, worktree };
  }

  const started = Date.now();
  let responseText = '';
  let finalUsage: ProviderUsage | undefined;
  let finalNumTurns: number | undefined;
  let error: string | undefined;
  let errorSubtype: string | undefined;

  // Tier 15 / ADR 0034 — internal AbortController that fires when either
  // the caller's signal aborts OR the pool watchdog callback signals
  // mid-stream pool exhaustion. The watchdog is checked after each
  // stream chunk; on interrupt we abort the provider stream and tag
  // the outcome with `errorSubtype: 'pool-exhausted-midstream'`.
  const internalAbort = new AbortController();
  let interruptedByWatchdog = false;
  const onExternalAbort = (): void => {
    internalAbort.abort();
  };
  if (opts.signal !== undefined) {
    if (opts.signal.aborted) internalAbort.abort();
    else opts.signal.addEventListener('abort', onExternalAbort, { once: true });
  }

  try {
    const iter = resolution.provider.stream({
      model: resolution.model,
      systemPrompt: opts.systemPrompt,
      messages: [{ role: 'user', content: fullUserPrompt }],
      temperature: 0.1,
      cwd: worktree.path,
      allowedTools: allowed,
      // With the sandbox up, switch from the Phase-2 `bypassPermissions`
      // (which translates to `--dangerously-skip-permissions` and grants
      // host-wide fs access) to `acceptEdits` — auto-accepts edits in
      // cwd ∪ additionalDirectories; the PreToolUse hook + permissions.deny
      // rules in <worktree>/.claude/settings.local.json then enforce the
      // path-prefix algebra. ADR 0028 §1.
      permissionMode: sandbox !== undefined ? 'acceptEdits' : 'bypassPermissions',
      ...(mcpConfigPath !== undefined ? { mcpConfigPath } : {}),
      ...(opts.poolRemainingTurns !== undefined ? { maxTurns: opts.poolRemainingTurns } : {}),
      signal: internalAbort.signal,
    });
    for await (const chunk of iter) {
      if (chunk.delta.length > 0) responseText += chunk.delta;
      if (chunk.usage !== undefined) finalUsage = chunk.usage;
      // Tier 15 / ADR 0034 — capture num_turns from the terminal chunk.
      // The provider populates this only on the terminal `result` event;
      // intermediate delta chunks leave it undefined. The pool's
      // `computePoolUsage` reads `result.turnsUsed` from `tasks_inflight`
      // so the watchdog and `pool.tally` SSE event see live consumption.
      if (chunk.numTurns !== undefined) finalNumTurns = chunk.numTurns;

      // Tier 15 / ADR 0034 — pool watchdog poll. The brain hands us a
      // callback that returns `{ interrupt: true }` when live pool usage
      // crosses an axis cap; on interrupt we abort the provider stream so
      // the directive can park without burning more turns than the pool
      // permits. Checked AFTER each chunk so an in-flight assistant turn
      // completes cleanly before we tear down — preserves any partial
      // state the agent already produced.
      if (opts.onTurnComplete !== undefined) {
        const decision = opts.onTurnComplete();
        if (decision.interrupt) {
          interruptedByWatchdog = true;
          internalAbort.abort();
          break;
        }
      }
    }
  } catch (err) {
    error = (err as Error).message;
    // Tier 12 / ADR 0032 §4 — capture the typed subtype when the provider
    // surfaces one (today: claude-cli's `error_max_turns` and friends). The
    // pool reads `result.errorSubtype` to decide whether to escalate via
    // an askUser instead of hard-failing the task.
    if (err instanceof ClaudeCliStreamError) {
      errorSubtype = err.subtype;
    }
    // Tier 15 / ADR 0034 — when the watchdog signalled mid-stream pool
    // exhaustion, tag the outcome so the pool dispatcher treats this as a
    // parking signal (not a generic abort or AbortError from the operator).
    if (interruptedByWatchdog) {
      errorSubtype = 'pool-exhausted-midstream';
    }
    if ((err as Error).name === 'AbortError') {
      log.warn({ taskId: opts.task.id, interruptedByWatchdog }, 'worker: aborted by caller');
    } else {
      log.error({ err, taskId: opts.task.id }, 'worker: provider stream failed');
    }
  } finally {
    if (opts.signal !== undefined) {
      opts.signal.removeEventListener('abort', onExternalAbort);
    }
    if (mcpConfigPath !== undefined) {
      try {
        await unlink(mcpConfigPath);
      } catch {
        // Best-effort — leftover tmp files are not load-bearing.
      }
    }
    if (sandbox !== undefined) {
      try {
        await rm(sandbox.claudeDir, { recursive: true, force: true });
      } catch (err) {
        sandboxLog.warn(
          { err, taskId: opts.task.id, claudeDir: sandbox.claudeDir },
          'worker.sandbox: cleanup failed — settings file may bleed into worktree merge',
        );
      }
    }
  }

  const durationMs = Date.now() - started;
  const filesChanged = error === undefined ? await listChangedFiles(worktree) : [];
  const findingIds = await persistFindings(
    opts.projectPath,
    opts.task.agent,
    opts.task.id,
    responseText,
    opts.findingRegistry,
  );
  await persistResolutions(
    opts.projectPath,
    opts.task.agent,
    opts.task.id,
    responseText,
    opts.findingRegistry,
  );

  // Phase 2.4 — operator-driven cancellation cleans the worktree (operator
  // abandoned the work, no diff to triage). Tier 15 — pool-watchdog-driven
  // interrupts are NOT operator-aborts; the directive is being parked with
  // partial state preserved so the operator can raise the cap and resume,
  // so the worktree stays in place. Other failures preserve the worktree
  // for post-mortem inspection.
  const wasAborted = opts.signal?.aborted === true && !interruptedByWatchdog;
  const desiredOutcome: 'success' | 'failure' | 'cancelled' =
    error === undefined ? 'success' : wasAborted ? 'cancelled' : 'failure';
  try {
    await cleanupWorktree({
      projectPath: opts.projectPath,
      handle: worktree,
      outcome: desiredOutcome,
    });
  } catch (cleanupErr) {
    const msg = (cleanupErr as Error).message;
    log.warn(
      { err: cleanupErr, taskId: opts.task.id, worktreePath: worktree.path },
      'worker: worktree cleanup failed (preserved for inspection)',
    );
    if (error === undefined) error = `worktree cleanup failed: ${msg}`;
  }

  const result: TaskResult = {
    exitCode: error === undefined ? 0 : 1,
    filesChanged,
    findingsRaised: findingIds,
    signalsEmitted: [],
    ...(error !== undefined ? { error } : {}),
    ...(errorSubtype !== undefined ? { errorSubtype } : {}),
    durationMs,
    ...(finalNumTurns !== undefined ? { turnsUsed: finalNumTurns } : {}),
  };

  log.info(
    {
      taskId: opts.task.id,
      exitCode: result.exitCode,
      findings: findingIds.length,
      filesChanged: filesChanged.length,
      durationMs,
      ...(errorSubtype !== undefined ? { errorSubtype } : {}),
      ...(finalNumTurns !== undefined ? { turnsUsed: finalNumTurns } : {}),
    },
    'worker: complete (tool-using)',
  );

  const outcome: WorkerOutcome = { result, worktree };
  if (responseText.length > 0) outcome.rawResponse = responseText;
  if (finalUsage !== undefined) {
    const response: ProviderResponse = {
      text: responseText,
      usage: finalUsage,
      resolvedProvider: resolution.provider.id,
      resolvedModel: resolution.model,
      ...(finalNumTurns !== undefined ? { numTurns: finalNumTurns } : {}),
    };
    outcome.usage = { resolution, response, durationMs };
  }
  return outcome;
}

export async function runWorker(opts: WorkerOptions): Promise<WorkerOutcome> {
  const contextBlock = await buildContextBlock(opts.projectPath);
  const fullUserPrompt = `${opts.userPrompt}\n\n${contextBlock}\n\nWhen reporting issues, use: \`FINDING [LOW|MEDIUM|HIGH|CRITICAL] <target>: <description>\``;

  if (isToolUsingAgent(opts.task.agent)) {
    return runTooling(opts, fullUserPrompt);
  }
  return runReadOnly(opts, fullUserPrompt);
}
