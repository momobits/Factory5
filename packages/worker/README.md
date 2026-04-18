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

## Phase 2 plans

- Allocate a per-task git worktree at `<project>/.factory/worktrees/task-<id>/`.
- Spawn `claude -p` with Write/Edit/Bash tools enabled; stream stdout (stream-json); honor `signal: AbortSignal`.
- Worker-pool executor for independent-ready tasks (concurrency configurable).
- Heartbeat into `tasks_inflight` so the brain can time out stuck workers.

## Status

Phase 1 single-shot implementation shipped.
