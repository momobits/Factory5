/**
 * @factory5/worker — per-task execution.
 *
 * Phase 1 implements the single-task inline path: compose a prompt from the
 * task + project wiki + open findings, call the resolved provider, parse
 * `FINDING [SEV] target: description` markers out of the output, and return
 * a {@link TaskResult}.
 *
 * Worktree isolation + subprocess-style `claude -p` invocation from a
 * worker subprocess (rather than the brain's own process) land in Phase 2.
 *
 * @packageDocumentation
 */

export * from './run-worker.js';
export * from './parse-findings.js';
export * from './parse-resolutions.js';
export * from './worktree.js';
