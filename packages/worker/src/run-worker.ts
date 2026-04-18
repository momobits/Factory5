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

import type { AgentRole, Finding, Task, TaskResult } from '@factory5/core';
import { createLogger } from '@factory5/logger';
import type {
  CategoryResolution,
  ProviderRegistry,
  ProviderResponse,
  ProviderUsage,
} from '@factory5/providers';
import { addFinding, appendBuildLog, listFindings, readWiki } from '@factory5/wiki';
import { simpleGit } from 'simple-git';

import { parseFindings } from './parse-findings.js';
import { allocateWorktree, cleanupWorktree, type WorktreeHandle } from './worktree.js';

const log = createLogger('worker');

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
  /** Optional cancellation signal — propagates into the provider call. */
  signal?: AbortSignal;
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
): Promise<string[]> {
  const findingIds: string[] = [];
  if (responseText.length === 0) return findingIds;
  const parsed = parseFindings(responseText);
  for (const p of parsed) {
    const f: Finding = await addFinding(projectPath, {
      source: agent,
      target: p.target,
      severity: p.severity,
      description: p.description,
    });
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
  );

  const durationMs = Date.now() - started;
  const result: TaskResult = {
    exitCode: error === undefined ? 0 : 1,
    filesChanged: [],
    findingsRaised: findingIds,
    signalsEmitted: [],
    ...(error !== undefined ? { error } : {}),
    durationMs,
  };

  log.info(
    {
      taskId: opts.task.id,
      exitCode: result.exitCode,
      findings: findingIds.length,
      durationMs,
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

  const started = Date.now();
  let responseText = '';
  let finalUsage: ProviderUsage | undefined;
  let error: string | undefined;

  try {
    const iter = resolution.provider.stream({
      model: resolution.model,
      systemPrompt: opts.systemPrompt,
      messages: [{ role: 'user', content: fullUserPrompt }],
      temperature: 0.1,
      cwd: worktree.path,
      allowedTools: allowed,
      permissionMode: 'bypassPermissions',
      ...(opts.task.maxTurns !== undefined ? { maxTurns: opts.task.maxTurns } : {}),
      ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
    });
    for await (const chunk of iter) {
      if (chunk.delta.length > 0) responseText += chunk.delta;
      if (chunk.usage !== undefined) finalUsage = chunk.usage;
    }
  } catch (err) {
    error = (err as Error).message;
    if ((err as Error).name === 'AbortError') {
      log.warn({ taskId: opts.task.id }, 'worker: aborted by caller');
    } else {
      log.error({ err, taskId: opts.task.id }, 'worker: provider stream failed');
    }
  }

  const durationMs = Date.now() - started;
  const filesChanged = error === undefined ? await listChangedFiles(worktree) : [];
  const findingIds = await persistFindings(
    opts.projectPath,
    opts.task.agent,
    opts.task.id,
    responseText,
  );

  const desiredOutcome: 'success' | 'failure' = error === undefined ? 'success' : 'failure';
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
    durationMs,
  };

  log.info(
    {
      taskId: opts.task.id,
      exitCode: result.exitCode,
      findings: findingIds.length,
      filesChanged: filesChanged.length,
      durationMs,
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
