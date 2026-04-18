# @factory5/worker

Per-task subprocess. One worker = one task = one git worktree.

## Lifecycle

1. Allocate a fresh git worktree at `<project>/.factory/worktrees/task-<id>/`
2. Build prompt (system + skills + wiki context + finding context + task description)
3. Spawn the coding-agent CLI subprocess (`claude -p` or `codex` based on category routing)
4. Stream output back; parse `FINDING [SEV] file: description` markers; persist findings
5. On exit: write `TaskResult`, mark task complete/failed in `tasks_inflight`
6. Cleanup worktree (or keep on failure for inspection — configurable)

## API (planned)

```ts
import { runWorker } from '@factory5/worker';

const result = await runWorker({
  task,
  projectPath,
  provider,
  signal,           // AbortSignal — brain can cancel
  onHeartbeat,      // hook for state.tasksInflight.heartbeat
});
```

## Status

Stub. Implementation lands in Phase 1 (single worker) → Phase 2 (parallel pool).
