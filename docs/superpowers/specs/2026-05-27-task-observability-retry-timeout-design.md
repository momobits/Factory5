# Task Observability, Per-Task Retry, and Timeout Configuration

_Created: 2026-05-27_
_Status: APPROVED_

## Problem

Factory5's task execution pipeline has three gaps:

1. **No conversation persistence.** The full agent back-and-forth (tool calls, reasoning, errors) is streamed via NDJSON from `claude-cli`, consumed line-by-line in `streamClaude()`, then discarded. Only a few scalar fields survive in `TaskResult`. Operators cannot debug what went wrong inside a failed task.

2. **No per-task retry.** When a single task fails (e.g., timeout), all downstream dependent tasks cascade-fail. The only recovery is directive-level `/resume`, which creates a child directive. There is no way to re-run just the failed task.

3. **Fixed stream timeout.** The provider's stream timeout defaults to 20 minutes (`timeoutMs * 2`). Complex builder tasks routinely need more time. The timeout is not configurable per-project.

These were surfaced by a real failure: pythonetl's "Build schema and config" task timed out at 20 minutes, cascading 4 downstream tasks to failure. The operator had no way to see what the agent was doing, no way to retry just that task, and no way to give it more time.

## Scope

Three features, designed as a cohesive set and shipped incrementally:

1. **Timeout configuration** (small) — per-project `taskStreamTimeoutMs` in `project.json`
2. **Conversation logging** (medium) — capture + persist per-task transcripts as NDJSON files
3. **Frontend: transcript viewer + retry** (medium) — expandable task panel on directive detail page with log viewer and retry buttons

## Feature 1: Per-Project Timeout Configuration

### Schema

Add `taskStreamTimeoutMs` to the project metadata schema as a sibling to `budgetDefaults` (it is a runtime config knob, not a budget axis):

```typescript
// In projectMetadataSchema, alongside budgetDefaults
taskStreamTimeoutMs?: number  // milliseconds, optional
```

Example `project.json`:

```json
{
  "metadata": {
    "budgetDefaults": { ... },
    "taskStreamTimeoutMs": 3600000
  }
}
```

### Flow

1. Brain's `executeTaskWithBudgetGuard()` already loads project metadata (for budget resolution). Read `taskStreamTimeoutMs` from the same source.
2. Pass it to `runWorker()` as a new optional field on `WorkerOptions`:
   ```typescript
   interface WorkerOptions {
     // ... existing fields
     streamTimeoutMs?: number;
   }
   ```
3. Worker passes it to `ClaudeCliProvider` constructor via `opts.streamTimeoutMs`.
4. If not set, the provider's default applies.

### Default bump

Change the provider's hardcoded fallback from `timeoutMs * 2` (20 min) to `timeoutMs * 6` (60 min) in the constructor:

```typescript
// packages/providers/src/claude-cli.ts line 620
this.streamTimeoutMs = opts.streamTimeoutMs ?? this.timeoutMs * 6;
```

This unblocks complex tasks without requiring every project to set a custom value. The per-project field exists for operators who want to tune further.

### Files touched

| File                                   | Change                                                           |
| -------------------------------------- | ---------------------------------------------------------------- |
| `packages/providers/src/claude-cli.ts` | Default from `*2` to `*6`                                        |
| `packages/worker/src/run-worker.ts`    | Accept + forward `streamTimeoutMs` on `WorkerOptions`            |
| `packages/brain/src/pool.ts`           | Read `taskStreamTimeoutMs` from project metadata, pass to worker |
| `packages/core/src/schemas.ts`         | Add `taskStreamTimeoutMs` to project metadata schema             |

## Feature 2: Conversation Logging

### Storage: NDJSON files on disk

Each task gets a transcript file at `.factory/transcripts/<taskId>.ndjson`. Raw NDJSON lines from `claude-cli` are appended as they stream — no transformation, no buffering.

Why disk files over SQLite:

- Transcripts can be multi-MB. Blobs in `better-sqlite3` bloat the DB and slow queries on `tasks_inflight`.
- NDJSON append is crash-safe (each line is a complete JSON object). If the task crashes mid-stream, the transcript contains everything up to the crash.
- Files are inspectable with standard tools (`cat`, `jq`).
- The DB stores a pointer and metadata, not the transcript itself.

### Capture point

Inside `streamClaude()` (`packages/providers/src/claude-cli.ts` lines 457–595). The async generator already iterates NDJSON lines via `readline.createInterface`. The change: tee each raw line to a file write stream before parsing. This means:

- Zero overhead on the hot path (file append, no serialization)
- The raw `claude-cli` NDJSON format is preserved — if the schema evolves, old transcripts still parse
- Tool calls, tool results, assistant text, usage events, errors — everything lands in the file

The tee is injected by the worker, not hardcoded in the provider. The worker opens the write stream before calling `provider.stream()` and passes it as a `transcriptSink` option:

```typescript
interface StreamOptions {
  // ... existing fields
  transcriptSink?: WritableStream; // raw NDJSON lines tee'd here
}
```

### Log level control

Three levels, configurable per-project via `metadata.transcriptLevel` in `project.json`:

| Level            | What's stored                                            | Typical size |
| ---------------- | -------------------------------------------------------- | ------------ |
| `full` (default) | Every NDJSON line from claude-cli                        | 1–10 MB/task |
| `tools`          | Only `tool_use`, `tool_result`, and final `result` lines | 100 KB–1 MB  |
| `off`            | No transcript file created                               | 0            |

Filtering happens at write time. The tee checks the level before appending each line.

### Database schema change

New migration on `tasks_inflight`:

```sql
ALTER TABLE tasks_inflight ADD COLUMN transcript_path TEXT;
ALTER TABLE tasks_inflight ADD COLUMN transcript_bytes INTEGER;
ALTER TABLE tasks_inflight ADD COLUMN transcript_lines INTEGER;
```

The worker writes these fields to `WorkerOutcome`, and the brain persists them alongside `result_json`.

### API endpoint

`GET /api/v1/directives/:directiveId/tasks/:taskId/transcript`

Query parameters:

- `offset` (default 0) — skip N lines
- `limit` (default 500) — return at most N lines
- `level` (`full` | `tools` | `errors`) — server-side filter when stored transcript is `full` but viewer wants a subset

Response:

```typescript
{
  lines: object[],        // parsed NDJSON objects
  total: number,          // total line count in file
  bytesTotal: number,     // file size
  level: string,          // effective level returned
  hasMore: boolean        // offset + limit < total
}
```

Implementation: stream from disk via `readline`, skip `offset` lines, apply level filter, collect up to `limit` lines. Never loads the full file into memory.

### Lifecycle

- Transcript files live in `.factory/transcripts/` (gitignored alongside `assessor-env/` and `worktrees/`).
- Transcripts persist after directive completion — they are the operator's debug record.
- Manual cleanup: `rm -rf .factory/transcripts/`. No automatic retention policy in this iteration.

### Files touched

| File                                           | Change                                                                                                                     |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `packages/providers/src/claude-cli.ts`         | `streamClaude()` accepts + calls `onRawLine` callback per NDJSON line                                                      |
| `packages/worker/src/run-worker.ts`            | Opens write stream, passes `onRawLine` to provider (tees to file + emits SSE), records byte/line counts on `WorkerOutcome` |
| `packages/brain/src/pool.ts`                   | Constructs transcript path, passes to worker, persists metadata to DB                                                      |
| `packages/state/src/migrations/`               | New migration adding columns to `tasks_inflight`                                                                           |
| `packages/state/src/queries/tasks-inflight.ts` | Read/write transcript metadata                                                                                             |
| `packages/daemon/src/server.ts`                | New transcript endpoint                                                                                                    |
| `packages/core/src/schemas.ts`                 | Add `transcriptLevel` to project metadata schema                                                                           |
| `packages/ipc/src/schemas.ts`                  | Add transcript fields to `ApiV1InflightTask`                                                                               |

## Feature 3: Frontend — Transcript Viewer + Per-Task Retry

### 3a. Transcript Viewer

**Location:** Directive detail page (`apps/factory-web/src/pages/directives/detail.astro`).

**Interaction:** Each task row becomes expandable (accordion — one task open at a time). Click a task → expands to show the transcript panel below. Click again → collapses.

**Panel contents:**

- **Header bar:** Level filter tabs (`Full` / `Tools only` / `Errors only`), file size, line count.
- **Transcript body:** Scrollable list of conversation turns. Each NDJSON line is parsed and rendered by type:
  - `assistant` — text block, proportional font
  - `tool_use` — tool name header, collapsible arguments
  - `tool_result` — success/error badge, collapsible output
  - `result` (final) — highlighted styling with exit status
  - `system` — collapsed by default (large, rarely needed for debugging)
- **Pagination:** Loads 500 lines at a time. "Load more" button appends next batch.
- **Live mode:** For tasks currently running, the panel combines two sources:
  1. **Initial load:** Fetch persisted lines from the transcript API (the NDJSON file is being appended to in real time, so pagination works against partial files).
  2. **Live tail:** Subscribe to the existing directive SSE stream for `transcript.line` events, filtered client-side by `taskId`. New lines auto-append and the panel auto-scrolls to bottom.
  3. **Completion transition:** When `task.completed` fires, the panel stops listening for `transcript.line` events. The persisted transcript is now final.

**SSE transport for live lines:**

New event type `transcript.line` on the existing directive SSE channel (`GET /api/v1/directives/:id/stream`):

```typescript
{
  type: 'transcript.line',
  taskId: string,
  directiveId: string,
  line: object,    // the parsed NDJSON object
  lineIndex: number // sequential index within this task's transcript
}
```

The worker emits each raw NDJSON line through the directive's SSE hub as it writes to the transcript file. The `onRawLine` callback (used for the file tee) also emits the SSE event. This means the hub carries transcript lines for ALL running tasks — clients filter by `taskId` in the frontend. The event is NOT persisted to `directive_log_lines` (transcripts have their own persistence via the NDJSON file); it is fire-and-forget through the hub.

**Backfill:** `transcript.line` events are NOT backfilled on SSE reconnect (unlike `task.started`/`task.completed`). The persisted transcript API serves as the recovery path — on reconnect, the frontend re-fetches from the API and resumes the SSE tail from the last `lineIndex` seen. This avoids the hub having to buffer potentially thousands of transcript lines per task.

**Bandwidth note:** All connected directive-detail clients receive all transcript lines for all running tasks in that directive, even if they haven't opened a task panel. For directives with many concurrent tasks, this could be noisy. Acceptable for v1 — the alternative (per-task SSE endpoint) adds significant routing complexity for marginal bandwidth savings. If bandwidth becomes a problem, the per-task endpoint is a clean follow-up.

### 3b. Per-Task Retry

**API endpoint:** `POST /api/v1/directives/:id/tasks/:taskId/retry`

Request body:

```typescript
{
  mode: 'resume' | 'clean';
}
```

**Server-side flow:**

1. **Validate:** Task must be `failed`, directive must be `blocked`. Return 409 otherwise.

2. **Reset the task:** Flip status to `pending`, increment `attempts`, clear `result_json` and `finished_at`. If `mode === 'clean'`: delete the worktree directory and transcript file.

3. **Cascade reset:** Find all tasks in the same plan whose `dependsOn` includes the retried task (directly or transitively) AND whose status is `failed` with `attempts === 0` (cascade-blocked — they never ran). Reset those to `pending` too. Tasks that ran independently and failed on their own keep their `failed` status.

4. **Re-activate the directive:** Flip directive status from `blocked` → `running`.

5. **Notify the brain:** Insert a row into a new `directive_signals` table:
   ```sql
   CREATE TABLE directive_signals (
     id TEXT PRIMARY KEY,
     directive_id TEXT NOT NULL,
     signal_type TEXT NOT NULL,  -- 'task_retry'
     payload_json TEXT,          -- { taskId, mode, cascadeReset: [...] }
     created_at TEXT NOT NULL,
     consumed_at TEXT            -- set when brain picks it up
   );
   ```
   The brain's claim loop polls this table alongside directive status checks. On finding an unconsumed `task_retry` signal, it re-enters `executeDirective()` for that directive.

**Brain-side changes:**

The pool dispatcher already iterates pending tasks, checks dependencies, and dispatches when ready. It exits when all tasks are terminal. After retry, the retried task (and cascade-reset dependents) are `pending` again, so the loop naturally re-includes them.

For `mode === 'resume'`: the worker receives the existing worktree path. The agent prompt gets a prefix: _"This task was previously attempted but did not complete. The worktree contains partial work from the prior attempt. Continue from where it left off."_

For `mode === 'clean'`: fresh worktree, no prefix. Standard dispatch.

**SSE event:**

New event type `task.retried`:

```typescript
{
  type: 'task.retried',
  taskId: string,
  directiveId: string,
  mode: 'resume' | 'clean',
  attempt: number,
  cascadeReset: string[]  // IDs of downstream tasks also reset to pending
}
```

The frontend handles this by resetting the task's row to `pending` status and clearing the transcript panel if it was open.

**Frontend retry buttons:**

- Shown only for tasks in `failed` status.
- Two buttons at the bottom of the expanded task panel: "Retry (Resume)" and "Retry (Clean)".
- On click: confirmation dialog showing the task title, mode, and list of downstream tasks that will be cascade-reset.
- After POST succeeds: task row animates to `pending`, SSE picks up `task.started` when the brain dispatches.

### Files touched

| File                                                 | Change                                                                  |
| ---------------------------------------------------- | ----------------------------------------------------------------------- |
| `apps/factory-web/src/pages/directives/detail.astro` | Expandable task rows, transcript panel, retry buttons, live-stream mode |
| `packages/daemon/src/server.ts`                      | New retry endpoint, transcript endpoint                                 |
| `packages/ipc/src/schemas.ts`                        | `task.retried` SSE event, transcript fields on `ApiV1InflightTask`      |
| `packages/ipc/src/sse.ts`                            | `task.retried` event schema                                             |
| `packages/daemon/src/directive-stream-route.ts`      | Emit `task.retried` events                                              |
| `packages/state/src/migrations/`                     | `directive_signals` table                                               |
| `packages/state/src/queries/`                        | Signal read/consume queries                                             |
| `packages/brain/src/pool.ts`                         | Poll signals, re-enter loop, resume prompt prefix                       |
| `packages/brain/src/loop.ts`                         | Signal-aware claim loop                                                 |

## Implementation Order

1. **Timeout config** — ships first, unblocks pythonetl immediately. 4 files, small change.
2. **Conversation logging** — capture + persist + API. 8 files, medium change. No frontend yet — API-only, testable with `curl`.
3. **Frontend viewer + retry** — the UI layer. Depends on (1) and (2). 8 files, medium change.

Each ships as its own commit and can be verified independently.

## Risks

| Risk                                                    | Mitigation                                                                                                                         |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Transcript files grow large for long-running tasks      | `tools` and `off` levels exist; pagination prevents browser overload; `.factory/transcripts/` is gitignored                        |
| Brain re-entry after retry races with other signals     | `directive_signals` is consumed atomically (set `consumed_at` in same query); brain holds directive lock during loop               |
| Resume mode confuses the agent (partial worktree state) | Operator chooses the mode after reading the transcript. Clean mode is always available. The resume prompt prefix provides context. |
| SSE backfill for `task.retried` events on reconnect     | Store retries in DB (already via `directive_signals`); backfill reconstructs from task `attempts` field                            |
