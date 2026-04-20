# @factory5/worker

Per-task execution. The brain calls `runWorker` for each planned task.

## Phase 1 behavior (current)

- One-shot provider call: `registry.resolve(category)` → `provider.call({ systemPrompt, messages })`.
- System prompt + user prompt are built by the brain (agent + skills baked in) and passed through `WorkerOptions`; this keeps the worker independent of `@factory5/brain` (acyclic deps).
- The worker prepends a `# Context` block with open findings + wiki digest so the model can reason about the current project state.
- Parses `FINDING [LOW|MEDIUM|HIGH|CRITICAL] <target>: <description>` markers out of the response (multi-line descriptions supported); persists each via `@factory5/wiki` with a sequential F-id.
- Returns a `WorkerOutcome` = `{ result: TaskResult, rawResponse?, usage? }` so the brain can record `model_usage` itself.

## API

```ts
import { runWorker } from '@factory5/worker';

const outcome = await runWorker({
  task,
  projectPath,
  registry,
  systemPrompt, // built by brain via buildAgentSystemPrompt(task.agent)
  userPrompt, // task description, inputs, expected outputs
});
// outcome.result.{exitCode, filesChanged, findingsRaised, signalsEmitted, error?, durationMs}
// outcome.usage?.{resolution, response, durationMs} — for model_usage recording
```

## Phase 2+ behavior (also current)

Tool-using agents (scaffolder/builder/fixer) run in per-task git worktrees:

- `allocateWorktree({ projectPath, taskId })` — branches `factory/task-<short>` off the project's current branch and `git worktree add`s it at `<project>/.factory/worktrees/task-<id>/`. Idempotent on the project (calls `ensureProjectRepo` to init + initial-commit if needed). Returns `WorktreeHandle = { path, branch, baseBranch }`.
- `cleanupWorktree({ projectPath, handle, outcome })` — `success` merges the task branch back into the base (`--no-ff`), removes the worktree, deletes the branch. `failure` leaves the worktree in place for inspection.
- `verifyHeadAdvanced(git, baseBranch, preMergeHead)` — assertion helper used inside `cleanupWorktree`; throws if the post-merge `rev-parse <baseBranch>` equals the pre-merge HEAD (catches silent no-op merges — see I004).
- `branchNameFor(taskId)` / `WORKTREES_SUBDIR` — name + path conventions.

Concurrent-merge safety: per-project async mutex inside `mergeAndRemove` chains sibling-task merges so two simultaneous `git merge` invocations don't race on `.git/index.lock` (originally observed losing commits silently on Windows — I004).

## Status

Phase 1 single-shot path + Phase 2 worktree + tool-streaming path both shipped. The worker is invoked from `@factory5/brain`'s pool (see `packages/brain/src/pool.ts`).
