# Task Observability, Retry & Timeout — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give operators visibility into what agents are doing inside tasks (conversation transcripts), the ability to retry individual failed tasks (resume or clean), and per-project stream timeout configuration.

**Architecture:** Three incremental features. Feature 1 adds `taskStreamTimeoutMs` to project metadata and threads it through brain → worker → provider. Feature 2 tees raw NDJSON lines from `streamClaude()` to per-task transcript files on disk, adds DB metadata columns, exposes a paginated API endpoint, and emits `transcript.line` SSE events for live streaming. Feature 3 adds an expandable transcript viewer (with live tail via SSE) to the directive detail page and a per-task retry mechanism (daemon endpoint + brain signal loop + frontend buttons).

**Tech Stack:** TypeScript, better-sqlite3, Fastify, Astro (SSR + client-side JS), Zod schemas, Node `readline` + `fs.createWriteStream`.

**Spec:** `docs/superpowers/specs/2026-05-27-task-observability-retry-timeout-design.md`

---

## Feature 1: Per-Project Timeout Configuration

### Task 1: Add `taskStreamTimeoutMs` to project metadata schema

**Files:**
- Modify: `packages/core/src/schemas.ts:132`
- Test: `packages/core/src/schemas.test.ts` (or nearest existing schema test)

- [ ] **Step 1: Write the failing test**

```typescript
// In the test file for schemas
import { projectBudgetDefaultsSchema } from './schemas.js';

test('projectMetadata accepts taskStreamTimeoutMs', () => {
  // This will fail until we add the field — budgetsSchema doesn't have it
  const parsed = projectBudgetDefaultsSchema.parse({
    maxUsd: 100,
    taskStreamTimeoutMs: 3600000,
  });
  expect(parsed.taskStreamTimeoutMs).toBe(3600000);
});

test('projectMetadata taskStreamTimeoutMs is optional', () => {
  const parsed = projectBudgetDefaultsSchema.parse({ maxUsd: 100 });
  expect(parsed.taskStreamTimeoutMs).toBeUndefined();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @factory5/core test -- --reporter=verbose -t "taskStreamTimeoutMs"`
Expected: FAIL — `taskStreamTimeoutMs` not recognized by schema

- [ ] **Step 3: Add the field to the schema**

The project metadata schema is `projectBudgetDefaultsSchema` which equals `budgetsSchema`. Since `taskStreamTimeoutMs` is a runtime config knob (not a budget axis), add it directly to the `budgetsSchema` definition. Find where `budgetsSchema` is defined in `packages/core/src/schemas.ts` (it carries all 12 budget axes) and append:

```typescript
  taskStreamTimeoutMs: z.number().int().positive().optional(),
```

This field is optional. When absent, the provider's default (60 min after Task 2) applies.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @factory5/core test -- --reporter=verbose -t "taskStreamTimeoutMs"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/schemas.ts packages/core/src/schemas.test.ts
git commit -m "feat(core): add taskStreamTimeoutMs to project metadata schema"
```

---

### Task 2: Bump default stream timeout from 20min to 60min

**Files:**
- Modify: `packages/providers/src/claude-cli.ts:620`
- Test: `packages/providers/src/claude-cli.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { ClaudeCliProvider } from './claude-cli.js';

test('default stream timeout is 60 minutes (timeoutMs * 6)', () => {
  const provider = new ClaudeCliProvider();
  // Access the private field via any-cast for testing
  expect((provider as any).streamTimeoutMs).toBe(60 * 60 * 1000);
});

test('explicit streamTimeoutMs overrides default', () => {
  const provider = new ClaudeCliProvider({ streamTimeoutMs: 5000 });
  expect((provider as any).streamTimeoutMs).toBe(5000);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @factory5/providers test -- --reporter=verbose -t "stream timeout"`
Expected: first test FAIL — currently returns 1200000 (20 min), not 3600000 (60 min)

- [ ] **Step 3: Change the default multiplier**

In `packages/providers/src/claude-cli.ts` line 620, change:

```typescript
// Before:
this.streamTimeoutMs = opts.streamTimeoutMs ?? this.timeoutMs * 2;

// After:
this.streamTimeoutMs = opts.streamTimeoutMs ?? this.timeoutMs * 6;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @factory5/providers test -- --reporter=verbose -t "stream timeout"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/providers/src/claude-cli.ts packages/providers/src/claude-cli.test.ts
git commit -m "feat(providers): bump default stream timeout from 20min to 60min"
```

---

### Task 3: Thread `streamTimeoutMs` from brain → worker → provider

**Files:**
- Modify: `packages/worker/src/run-worker.ts:66-123` (WorkerOptions)
- Modify: `packages/brain/src/pool.ts:710-726` (runWorker call site)
- Test: `packages/worker/src/run-worker.test.ts`

- [ ] **Step 1: Add `streamTimeoutMs` to WorkerOptions**

In `packages/worker/src/run-worker.ts`, add to the `WorkerOptions` interface (after the `poolRemainingTurns` field at ~line 123):

```typescript
  /**
   * Per-project stream timeout override (ms). Read from
   * `project.json` `metadata.taskStreamTimeoutMs`. When set, the
   * worker passes it to the provider constructor so tool-using agent
   * sessions get a project-appropriate wall-clock limit.
   */
  streamTimeoutMs?: number;
```

- [ ] **Step 2: Forward the option to the provider in `runTooling()`**

In `packages/worker/src/run-worker.ts`, inside `runTooling()` at ~line 474, the provider is obtained via `opts.registry.resolve(opts.task.category)`. The registry returns an already-constructed provider instance, so the timeout must be passed per-stream-call, not per-constructor. However, `provider.stream()` takes a `ProviderRequest` which doesn't have a timeout field — the timeout is on the provider instance.

**Revised approach:** Instead of threading through the constructor, pass `streamTimeoutMs` through `ProviderRequest` so it can be set per-call. Add to `ProviderRequest` in `packages/providers/src/types.ts`:

```typescript
  /** Per-call stream timeout override (ms). Takes precedence over the provider's default. */
  streamTimeoutMs?: number;
```

Then in `ClaudeCliProvider.stream()` at line 760, use it:

```typescript
// Before:
const iter = streamClaude(child, {
  timeoutMs: this.streamTimeoutMs,
  stdin: promptText,
  ...(req.signal !== undefined ? { signal: req.signal } : {}),
});

// After:
const iter = streamClaude(child, {
  timeoutMs: req.streamTimeoutMs ?? this.streamTimeoutMs,
  stdin: promptText,
  ...(req.signal !== undefined ? { signal: req.signal } : {}),
});
```

Then in `runTooling()` at the `resolution.provider.stream()` call (~line 576), spread it:

```typescript
const iter = resolution.provider.stream({
  model: resolution.model,
  systemPrompt: opts.systemPrompt,
  messages: [{ role: 'user', content: fullUserPrompt }],
  temperature: 0.1,
  cwd: worktree.path,
  allowedTools: allowed,
  permissionMode: sandbox !== undefined ? 'acceptEdits' : 'bypassPermissions',
  ...(mcpConfigPath !== undefined ? { mcpConfigPath } : {}),
  ...(opts.poolRemainingTurns !== undefined ? { maxTurns: opts.poolRemainingTurns } : {}),
  ...(opts.streamTimeoutMs !== undefined ? { streamTimeoutMs: opts.streamTimeoutMs } : {}),
  signal: internalAbort.signal,
});
```

- [ ] **Step 3: Pass from brain pool to worker**

In `packages/brain/src/pool.ts`, inside `executeTaskWithBudgetGuard()` at the `runWorker()` call (~line 710), read the timeout from project metadata and pass it:

```typescript
// After the existing loadProjectBudgets call, extract the timeout:
const projectMeta = await loadOrCreateProjectMetadata(projectPath, '');
const streamTimeoutMs = (projectMeta.budgetDefaults as Record<string, unknown>)?.taskStreamTimeoutMs as number | undefined;

// Add to the runWorker call:
outcome = await runWorker({
  task,
  projectPath,
  registry,
  systemPrompt,
  userPrompt,
  findingRegistry: { ... },
  ...(askUserConfig !== undefined ? { askUserConfig } : {}),
  ...(signal !== undefined ? { signal } : {}),
  ...(onTurnComplete !== undefined ? { onTurnComplete } : {}),
  ...(poolRemainingTurns !== undefined ? { poolRemainingTurns } : {}),
  ...(streamTimeoutMs !== undefined ? { streamTimeoutMs } : {}),
});
```

Note: `loadOrCreateProjectMetadata` may already be called earlier in the function for budget resolution — reuse the same call, don't duplicate I/O.

- [ ] **Step 4: Write integration test**

```typescript
test('worker forwards streamTimeoutMs to provider stream request', async () => {
  // Use the existing test infrastructure's mock registry/provider
  // Capture the ProviderRequest passed to stream()
  let capturedRequest: ProviderRequest | undefined;
  const mockProvider = {
    async *stream(req: ProviderRequest) {
      capturedRequest = req;
      yield { delta: 'done', usage: undefined, numTurns: 1 };
    },
  };
  // ... setup with streamTimeoutMs: 120000
  // Assert: capturedRequest?.streamTimeoutMs === 120000
});
```

- [ ] **Step 5: Run tests**

Run: `pnpm build && pnpm test`
Expected: all tests pass, build clean

- [ ] **Step 6: Commit**

```bash
git add packages/providers/src/types.ts packages/providers/src/claude-cli.ts packages/worker/src/run-worker.ts packages/brain/src/pool.ts
git commit -m "feat(worker): thread per-project taskStreamTimeoutMs to provider stream calls"
```

---

## Feature 2: Conversation Logging

### Task 4: Add transcript columns to `tasks_inflight` (migration 011)

**Files:**
- Create: `packages/state/src/migrations/011-task-transcript.ts`
- Modify: `packages/state/src/migrations/index.ts` (register the migration)

- [ ] **Step 1: Create the migration file**

```typescript
// packages/state/src/migrations/011-task-transcript.ts
import type { Database } from 'better-sqlite3';

export function up(db: Database): void {
  db.exec(`
    ALTER TABLE tasks_inflight ADD COLUMN transcript_path TEXT;
    ALTER TABLE tasks_inflight ADD COLUMN transcript_bytes INTEGER;
    ALTER TABLE tasks_inflight ADD COLUMN transcript_lines INTEGER;
  `);
}
```

- [ ] **Step 2: Register the migration**

In `packages/state/src/migrations/index.ts`, import and add to the migrations array:

```typescript
import { up as up011 } from './011-task-transcript.js';
// In the migrations array:
{ version: 11, up: up011 },
```

- [ ] **Step 3: Update query helpers**

In `packages/state/src/queries/tasks-inflight.ts`, update the `markComplete()` function (or equivalent) to accept and write the three new columns. Add a getter that returns transcript metadata for a task:

```typescript
export function getTranscriptMeta(
  db: Database,
  taskId: string,
): { transcriptPath: string; transcriptBytes: number; transcriptLines: number } | undefined {
  const row = db.prepare(
    'SELECT transcript_path, transcript_bytes, transcript_lines FROM tasks_inflight WHERE id = ?',
  ).get(taskId) as { transcript_path: string | null; transcript_bytes: number | null; transcript_lines: number | null } | undefined;
  if (row === undefined || row.transcript_path === null) return undefined;
  return {
    transcriptPath: row.transcript_path,
    transcriptBytes: row.transcript_bytes ?? 0,
    transcriptLines: row.transcript_lines ?? 0,
  };
}
```

Also update `markComplete` (or the result-writing function) to accept transcript fields:

```typescript
export function updateTranscriptMeta(
  db: Database,
  taskId: string,
  meta: { transcriptPath: string; transcriptBytes: number; transcriptLines: number },
): void {
  db.prepare(
    'UPDATE tasks_inflight SET transcript_path = ?, transcript_bytes = ?, transcript_lines = ? WHERE id = ?',
  ).run(meta.transcriptPath, meta.transcriptBytes, meta.transcriptLines, taskId);
}
```

- [ ] **Step 4: Run tests + build**

Run: `pnpm build && pnpm --filter @factory5/state test`
Expected: PASS — migration applies cleanly, queries compile

- [ ] **Step 5: Commit**

```bash
git add packages/state/src/migrations/
git commit -m "feat(state): migration 011 — transcript columns on tasks_inflight"
```

---

### Task 5: Add `transcriptLevel` to project metadata schema

**Files:**
- Modify: `packages/core/src/schemas.ts`
- Test: `packages/core/src/schemas.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
test('projectMetadata accepts transcriptLevel', () => {
  const parsed = projectBudgetDefaultsSchema.parse({
    maxUsd: 100,
    transcriptLevel: 'tools',
  });
  expect(parsed.transcriptLevel).toBe('tools');
});

test('transcriptLevel rejects invalid values', () => {
  expect(() =>
    projectBudgetDefaultsSchema.parse({ transcriptLevel: 'verbose' }),
  ).toThrow();
});

test('transcriptLevel defaults to undefined (full is applied at runtime)', () => {
  const parsed = projectBudgetDefaultsSchema.parse({ maxUsd: 100 });
  expect(parsed.transcriptLevel).toBeUndefined();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @factory5/core test -- --reporter=verbose -t "transcriptLevel"`
Expected: FAIL

- [ ] **Step 3: Add the field**

In `budgetsSchema` (same location as Task 1), add:

```typescript
  transcriptLevel: z.enum(['full', 'tools', 'off']).optional(),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @factory5/core test -- --reporter=verbose -t "transcriptLevel"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/schemas.ts packages/core/src/schemas.test.ts
git commit -m "feat(core): add transcriptLevel to project metadata schema"
```

---

### Task 6: Tee NDJSON lines to transcript file in the worker

**Files:**
- Modify: `packages/worker/src/run-worker.ts` (WorkerOptions, WorkerOutcome, runTooling)
- Test: `packages/worker/src/run-worker.test.ts`

This is the core capture mechanism. The worker opens a write stream, iterates provider chunks, and tees each raw NDJSON line to the file.

- [ ] **Step 1: Add transcript fields to WorkerOptions and WorkerOutcome**

In `WorkerOptions`, add (after `streamTimeoutMs`):

```typescript
  /**
   * Absolute path for the transcript NDJSON file. When set, the worker
   * tees raw NDJSON lines from the provider stream to this path. The
   * brain constructs this as `<projectPath>/.factory/transcripts/<taskId>.ndjson`.
   */
  transcriptPath?: string;
  /**
   * Transcript log level filter. Default `'full'` — write every line.
   * `'tools'` — only tool_use, tool_result, and result lines.
   * `'off'` — no transcript (transcriptPath is ignored).
   */
  transcriptLevel?: 'full' | 'tools' | 'off';
```

In `WorkerOutcome`, add (after `worktree`):

```typescript
  /** Transcript file metadata (set when transcriptPath was provided and level != 'off'). */
  transcript?: {
    path: string;
    bytes: number;
    lines: number;
  };
```

- [ ] **Step 2: Implement the tee in `runTooling()`**

In `runTooling()`, before the `for await (const chunk of iter)` loop (~line 594), set up the transcript write stream:

```typescript
import { createWriteStream, statSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';

// Inside runTooling(), before the stream loop:
let transcriptStream: import('node:fs').WriteStream | undefined;
let transcriptLineCount = 0;

if (
  opts.transcriptPath !== undefined &&
  opts.transcriptLevel !== 'off'
) {
  await mkdir(join(opts.transcriptPath, '..'), { recursive: true });
  transcriptStream = createWriteStream(opts.transcriptPath, { flags: 'a', encoding: 'utf8' });
}
```

The tee cannot happen inside the `for await (const chunk of iter)` loop because `chunk` is already parsed — the raw NDJSON line is gone. Instead, we need to inject the tee into the provider's stream path.

**Revised approach:** Add a `transcriptSink` callback to `RunOptions` in `claude-cli.ts` that is called with each raw line before parsing:

In `packages/providers/src/claude-cli.ts`, extend `RunOptions`:

```typescript
interface RunOptions {
  timeoutMs: number;
  stdin?: string;
  signal?: AbortSignal;
  /** Called with each raw NDJSON line before parsing. For transcript tee. */
  onRawLine?: (line: string) => void;
}
```

In `streamClaude()` at line 508, add the tee call:

```typescript
rl.on('line', (line) => {
  // Tee raw line to transcript sink before parsing
  if (opts.onRawLine !== undefined) opts.onRawLine(line);

  const event = parseStreamJsonLine(line);
  if (event === undefined) return;
  // ... rest of existing handler
});
```

In `ClaudeCliProvider.stream()` at line 760, forward `onRawLine` from `ProviderRequest`:

```typescript
// Add to ProviderRequest in packages/providers/src/types.ts:
onRawLine?: (line: string) => void;

// In stream() method:
const iter = streamClaude(child, {
  timeoutMs: req.streamTimeoutMs ?? this.streamTimeoutMs,
  stdin: promptText,
  ...(req.signal !== undefined ? { signal: req.signal } : {}),
  ...(req.onRawLine !== undefined ? { onRawLine: req.onRawLine } : {}),
});
```

Then in `runTooling()`, build the callback and pass it:

```typescript
const shouldLogLine = (line: string): boolean => {
  if (opts.transcriptLevel === 'full' || opts.transcriptLevel === undefined) return true;
  // 'tools' level: only tool_use, tool_result, and result lines
  return line.includes('"type":"tool_use"') ||
    line.includes('"type":"tool_result"') ||
    line.includes('"type":"result"');
};

const onRawLine = transcriptStream !== undefined
  ? (line: string): void => {
      if (shouldLogLine(line)) {
        transcriptStream!.write(line + '\n');
        transcriptLineCount++;
      }
    }
  : undefined;

// Pass in the provider.stream() call:
const iter = resolution.provider.stream({
  // ... existing fields
  ...(onRawLine !== undefined ? { onRawLine } : {}),
});
```

After the stream loop completes (in the `finally` block), close the stream and record metadata:

```typescript
if (transcriptStream !== undefined) {
  transcriptStream.end();
  await new Promise<void>((resolve) => transcriptStream!.once('finish', resolve));
  try {
    const stat = statSync(opts.transcriptPath!);
    transcriptMeta = {
      path: opts.transcriptPath!,
      bytes: stat.size,
      lines: transcriptLineCount,
    };
  } catch {
    // File may not exist if no lines were written
  }
}
```

Set `transcriptMeta` on the returned `WorkerOutcome.transcript`.

- [ ] **Step 3: Write test**

```typescript
test('worker tees raw NDJSON lines to transcript file', async () => {
  const tmpPath = join(tmpdir(), `test-transcript-${Date.now()}.ndjson`);
  // Use mock provider that yields known chunks
  // After run, read tmpPath and verify it contains the raw NDJSON lines
  // Clean up tmpPath
});

test('worker respects transcriptLevel=tools filter', async () => {
  // Similar to above, but set transcriptLevel: 'tools'
  // Verify only tool_use/tool_result/result lines are in the file
});

test('worker skips transcript when transcriptLevel=off', async () => {
  // Set transcriptLevel: 'off', verify no file created
});
```

- [ ] **Step 4: Run tests**

Run: `pnpm build && pnpm --filter @factory5/worker test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/providers/src/claude-cli.ts packages/providers/src/types.ts packages/worker/src/run-worker.ts
git commit -m "feat(worker): tee raw NDJSON lines to per-task transcript files"
```

---

### Task 7: Brain constructs transcript path and persists metadata

**Files:**
- Modify: `packages/brain/src/pool.ts` (~lines 710-726)

- [ ] **Step 1: Construct transcript path and pass to worker**

In `executeTaskWithBudgetGuard()`, before the `runWorker()` call, construct the transcript path:

```typescript
import { join } from 'node:path';

const transcriptLevel = ((projectMeta.budgetDefaults as Record<string, unknown>)
  ?.transcriptLevel as string | undefined) ?? 'full';
const transcriptPath = transcriptLevel !== 'off'
  ? join(projectPath, '.factory', 'transcripts', `${task.id}.ndjson`)
  : undefined;

// Add to the runWorker call:
outcome = await runWorker({
  // ... existing fields
  ...(transcriptPath !== undefined ? { transcriptPath } : {}),
  ...(transcriptLevel !== 'off' ? { transcriptLevel: transcriptLevel as 'full' | 'tools' } : {}),
});
```

- [ ] **Step 2: Persist transcript metadata to DB after task completion**

After the `runWorker()` call returns, if `outcome.transcript` is present, persist it:

```typescript
import * as tasksInflight from '@factory5/state/queries/tasks-inflight';

if (outcome.transcript !== undefined) {
  tasksInflight.updateTranscriptMeta(db, task.id, outcome.transcript);
}
```

- [ ] **Step 3: Run full test suite**

Run: `pnpm build && pnpm test`
Expected: all tests pass

- [ ] **Step 4: Commit**

```bash
git add packages/brain/src/pool.ts
git commit -m "feat(brain): construct transcript paths and persist metadata to DB"
```

---

### Task 8: Transcript API endpoint

**Files:**
- Modify: `packages/daemon/src/server.ts`
- Modify: `packages/ipc/src/schemas.ts` (add transcript fields to ApiV1InflightTask + response schema)
- Test: `packages/daemon/src/server.test.ts`

- [ ] **Step 1: Add transcript fields to ApiV1InflightTask**

In `packages/ipc/src/schemas.ts`, extend `apiV1InflightTaskSchema`:

```typescript
export const apiV1InflightTaskSchema = z.object({
  // ... existing fields
  transcriptPath: z.string().optional(),
  transcriptBytes: z.number().int().nonneg().optional(),
  transcriptLines: z.number().int().nonneg().optional(),
});
```

- [ ] **Step 2: Add the transcript response schema**

```typescript
export const apiV1TaskTranscriptResponseSchema = z.object({
  lines: z.array(z.unknown()),
  total: z.number().int().nonnegative(),
  bytesTotal: z.number().int().nonnegative(),
  level: z.string(),
  hasMore: z.boolean(),
});
export type ApiV1TaskTranscriptResponse = z.infer<typeof apiV1TaskTranscriptResponseSchema>;
```

- [ ] **Step 3: Add the endpoint**

In `packages/daemon/src/server.ts`, after the logs endpoint (~line 676), add:

```typescript
// ----- GET /api/v1/directives/:directiveId/tasks/:taskId/transcript -----
app.get<{
  Params: { directiveId: string; taskId: string };
  Querystring: { offset?: string; limit?: string; level?: string };
}>(
  '/api/v1/directives/:directiveId/tasks/:taskId/transcript',
  async (request, reply) => {
    requireUiAuth(request, opts.uiAuthToken);
    const { directiveId, taskId } = request.params;

    const directive = directivesQ.getById(opts.db, directiveId);
    if (directive === undefined) {
      throw new IpcRequestError(404, 'DIRECTIVE_NOT_FOUND', `directive ${directiveId} not found`);
    }

    const meta = tasksInflight.getTranscriptMeta(opts.db, taskId);
    if (meta === undefined) {
      reply.send({ lines: [], total: 0, bytesTotal: 0, level: 'full', hasMore: false });
      return;
    }

    const offset = parseInt(request.query.offset ?? '0', 10);
    const limit = parseInt(request.query.limit ?? '500', 10);
    const level = (request.query.level ?? 'full') as 'full' | 'tools' | 'errors';

    const { lines, total } = await readTranscriptLines(meta.transcriptPath, { offset, limit, level });

    reply.send({
      lines,
      total,
      bytesTotal: meta.transcriptBytes,
      level,
      hasMore: offset + limit < total,
    });
  },
);
```

- [ ] **Step 4: Implement `readTranscriptLines` helper**

Create a helper (either in the same file or a new `packages/daemon/src/transcript-reader.ts`):

```typescript
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

export async function readTranscriptLines(
  filePath: string,
  opts: { offset: number; limit: number; level: 'full' | 'tools' | 'errors' },
): Promise<{ lines: unknown[]; total: number }> {
  const rl = createInterface({ input: createReadStream(filePath, 'utf8'), crlfDelay: Infinity });
  const lines: unknown[] = [];
  let lineIndex = 0;
  let total = 0;

  for await (const raw of rl) {
    total++;
    if (opts.level !== 'full') {
      const isToolLine = raw.includes('"type":"tool_use"') || raw.includes('"type":"tool_result"');
      const isResultLine = raw.includes('"type":"result"');
      const isErrorLine = raw.includes('"is_error":true') || raw.includes('"error"');
      if (opts.level === 'tools' && !isToolLine && !isResultLine) continue;
      if (opts.level === 'errors' && !isErrorLine && !isResultLine) continue;
    }
    if (lineIndex >= opts.offset && lines.length < opts.limit) {
      try { lines.push(JSON.parse(raw)); } catch { lines.push({ raw }); }
    }
    lineIndex++;
  }

  return { lines, total };
}
```

- [ ] **Step 5: Run tests**

Run: `pnpm build && pnpm --filter @factory5/daemon test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/ipc/src/schemas.ts packages/daemon/src/server.ts packages/daemon/src/transcript-reader.ts packages/state/src/queries/tasks-inflight.ts
git commit -m "feat(daemon): GET transcript endpoint with pagination and level filtering"
```

---

### Task 9: Live transcript streaming via SSE

**Files:**
- Modify: `packages/ipc/src/sse.ts` (new `transcript.line` event schema)
- Modify: `packages/worker/src/run-worker.ts` (emit SSE event alongside file tee)
- Modify: `packages/daemon/src/directive-stream-route.ts` (no backfill for transcript.line — documented skip)

The worker already has an `onRawLine` callback that tees NDJSON lines to the transcript file (Task 6). This task adds a second side-effect: emitting each line as an SSE event through the directive stream hub so connected frontends can display live output.

- [ ] **Step 1: Add `transcript.line` event schema**

In `packages/ipc/src/sse.ts`, after `taskCompletedEventSchema`:

```typescript
export const transcriptLineEventSchema = z.object({
  type: z.literal('transcript.line'),
  taskId: ulidSchema,
  directiveId: ulidSchema,
  line: z.unknown(),
  lineIndex: z.number().int().nonnegative(),
});
export type TranscriptLineEvent = z.infer<typeof transcriptLineEventSchema>;
```

Add it to the `directiveStreamEventSchema` union.

- [ ] **Step 2: Add `emitTranscriptLine` to WorkerOptions**

In `packages/worker/src/run-worker.ts`, add to `WorkerOptions`:

```typescript
  /**
   * Callback to emit a transcript line as an SSE event. The brain
   * passes a closure that calls `streamHub.emit(directiveId, event)`.
   * Called from the same `onRawLine` callback that tees to the file.
   */
  emitTranscriptLine?: (line: unknown, lineIndex: number) => void;
```

- [ ] **Step 3: Wire the emission into the `onRawLine` callback**

In `runTooling()`, update the `onRawLine` construction (from Task 6) to also emit:

```typescript
const onRawLine = transcriptStream !== undefined
  ? (line: string): void => {
      if (shouldLogLine(line)) {
        transcriptStream!.write(line + '\n');
        transcriptLineCount++;
        // Emit live SSE event for connected frontends
        if (opts.emitTranscriptLine !== undefined) {
          try {
            opts.emitTranscriptLine(JSON.parse(line), transcriptLineCount - 1);
          } catch {
            // Malformed line — written to file as-is, skip SSE emission
          }
        }
      }
    }
  : undefined;
```

- [ ] **Step 4: Pass the emission callback from the brain**

In `packages/brain/src/pool.ts`, in the `runWorker()` call site, construct the callback:

```typescript
const emitTranscriptLine = emit !== undefined && transcriptPath !== undefined
  ? (line: unknown, lineIndex: number): void => {
      emit({
        type: 'transcript.line',
        taskId: task.id,
        directiveId,
        line,
        lineIndex,
      });
    }
  : undefined;

outcome = await runWorker({
  // ... existing fields
  ...(emitTranscriptLine !== undefined ? { emitTranscriptLine } : {}),
});
```

- [ ] **Step 5: Document no-backfill in the stream route**

In `packages/daemon/src/directive-stream-route.ts`, add a comment in the backfill section (after the existing task + spend backfill):

```typescript
// transcript.line events are NOT backfilled on SSE reconnect. The
// persisted transcript file (via GET .../transcript) is the recovery
// path. On reconnect the frontend re-fetches from the API and resumes
// the SSE tail from the last lineIndex seen.
```

- [ ] **Step 6: Run tests + build**

Run: `pnpm build && pnpm test`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add packages/ipc/src/sse.ts packages/worker/src/run-worker.ts packages/brain/src/pool.ts packages/daemon/src/directive-stream-route.ts
git commit -m "feat(worker): emit transcript.line SSE events for live frontend streaming"
```

---

## Feature 3: Frontend Viewer + Per-Task Retry

### Task 9: Migration 012 — `directive_signals` table

**Files:**
- Create: `packages/state/src/migrations/012-directive-signals.ts`
- Modify: `packages/state/src/migrations/index.ts`
- Create: `packages/state/src/queries/directive-signals.ts`

- [ ] **Step 1: Create the migration**

```typescript
// packages/state/src/migrations/012-directive-signals.ts
import type { Database } from 'better-sqlite3';

export function up(db: Database): void {
  db.exec(`
    CREATE TABLE directive_signals (
      id TEXT PRIMARY KEY,
      directive_id TEXT NOT NULL,
      signal_type TEXT NOT NULL,
      payload_json TEXT,
      created_at TEXT NOT NULL,
      consumed_at TEXT
    );
    CREATE INDEX idx_directive_signals_unconsumed
      ON directive_signals (directive_id, signal_type)
      WHERE consumed_at IS NULL;
  `);
}
```

- [ ] **Step 2: Register migration**

Add `{ version: 12, up: up012 }` to the migrations array in `index.ts`.

- [ ] **Step 3: Create query helpers**

```typescript
// packages/state/src/queries/directive-signals.ts
import type { Database } from 'better-sqlite3';
import { ulid } from 'ulid';

export interface DirectiveSignal {
  id: string;
  directiveId: string;
  signalType: string;
  payload: unknown;
  createdAt: string;
  consumedAt: string | null;
}

export function insert(
  db: Database,
  directiveId: string,
  signalType: string,
  payload: unknown,
): string {
  const id = ulid();
  const now = new Date().toISOString();
  db.prepare(
    'INSERT INTO directive_signals (id, directive_id, signal_type, payload_json, created_at) VALUES (?, ?, ?, ?, ?)',
  ).run(id, directiveId, signalType, JSON.stringify(payload), now);
  return id;
}

export function consumeNext(
  db: Database,
  directiveId: string,
  signalType: string,
): DirectiveSignal | undefined {
  const now = new Date().toISOString();
  const row = db.prepare(
    `UPDATE directive_signals
     SET consumed_at = ?
     WHERE id = (
       SELECT id FROM directive_signals
       WHERE directive_id = ? AND signal_type = ? AND consumed_at IS NULL
       ORDER BY created_at ASC LIMIT 1
     )
     RETURNING *`,
  ).get(now, directiveId, signalType) as any;
  if (row === undefined) return undefined;
  return {
    id: row.id,
    directiveId: row.directive_id,
    signalType: row.signal_type,
    payload: JSON.parse(row.payload_json ?? 'null'),
    createdAt: row.created_at,
    consumedAt: row.consumed_at,
  };
}

export function pendingForDirective(
  db: Database,
  directiveId: string,
): DirectiveSignal[] {
  const rows = db.prepare(
    'SELECT * FROM directive_signals WHERE directive_id = ? AND consumed_at IS NULL ORDER BY created_at ASC',
  ).all(directiveId) as any[];
  return rows.map((r) => ({
    id: r.id,
    directiveId: r.directive_id,
    signalType: r.signal_type,
    payload: JSON.parse(r.payload_json ?? 'null'),
    createdAt: r.created_at,
    consumedAt: r.consumed_at,
  }));
}
```

- [ ] **Step 4: Run tests + build**

Run: `pnpm build && pnpm --filter @factory5/state test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/state/src/migrations/ packages/state/src/queries/directive-signals.ts
git commit -m "feat(state): migration 012 — directive_signals table for per-task retry"
```

---

### Task 10: Per-task retry daemon endpoint

**Files:**
- Modify: `packages/daemon/src/server.ts`
- Modify: `packages/ipc/src/schemas.ts` (request/response schemas)
- Modify: `packages/ipc/src/sse.ts` (task.retried event)

- [ ] **Step 1: Add `task.retried` SSE event schema**

In `packages/ipc/src/sse.ts`, after `taskCompletedEventSchema`:

```typescript
export const taskRetriedEventSchema = z.object({
  type: z.literal('task.retried'),
  taskId: ulidSchema,
  directiveId: ulidSchema,
  mode: z.enum(['resume', 'clean']),
  attempt: z.number().int().positive(),
  cascadeReset: z.array(ulidSchema),
});
export type TaskRetriedEvent = z.infer<typeof taskRetriedEventSchema>;
```

Add it to the `directiveStreamEventSchema` union.

- [ ] **Step 2: Add retry request/response schemas**

In `packages/ipc/src/schemas.ts`:

```typescript
export const apiV1TaskRetryRequestSchema = z.object({
  mode: z.enum(['resume', 'clean']),
});
export type ApiV1TaskRetryRequest = z.infer<typeof apiV1TaskRetryRequestSchema>;

export const apiV1TaskRetryResponseSchema = z.object({
  taskId: ulidSchema,
  directiveId: ulidSchema,
  mode: z.enum(['resume', 'clean']),
  attempt: z.number().int().positive(),
  cascadeReset: z.array(ulidSchema),
});
export type ApiV1TaskRetryResponse = z.infer<typeof apiV1TaskRetryResponseSchema>;
```

- [ ] **Step 3: Implement the retry endpoint**

In `packages/daemon/src/server.ts`:

```typescript
// ----- POST /api/v1/directives/:directiveId/tasks/:taskId/retry -----
app.post<{
  Params: { directiveId: string; taskId: string };
  Body: ApiV1TaskRetryRequest;
}>(
  '/api/v1/directives/:directiveId/tasks/:taskId/retry',
  async (request, reply) => {
    requireUiAuth(request, opts.uiAuthToken);
    const { directiveId, taskId } = request.params;
    const { mode } = apiV1TaskRetryRequestSchema.parse(request.body);

    // 1. Validate directive is blocked
    const directive = directivesQ.getById(opts.db, directiveId);
    if (directive === undefined) {
      throw new IpcRequestError(404, 'DIRECTIVE_NOT_FOUND', `directive ${directiveId} not found`);
    }
    if (directive.status !== 'blocked') {
      throw new IpcRequestError(409, 'DIRECTIVE_NOT_BLOCKED', `directive is ${directive.status}, not blocked`);
    }

    // 2. Validate task is failed
    const tasks = tasksInflight.listByDirective(opts.db, directiveId);
    const task = tasks.find((t) => t.id === taskId);
    if (task === undefined) {
      throw new IpcRequestError(404, 'TASK_NOT_FOUND', `task ${taskId} not found`);
    }
    if (task.status !== 'failed') {
      throw new IpcRequestError(409, 'TASK_NOT_FAILED', `task is ${task.status}, not failed`);
    }

    // 3. Reset the task
    const newAttempts = (task.attempts ?? 0) + 1;
    tasksInflight.resetForRetry(opts.db, taskId, newAttempts);

    // 4. If clean mode, delete worktree + transcript
    if (mode === 'clean') {
      if (task.worktreePath) {
        try { await rm(task.worktreePath, { recursive: true, force: true }); } catch { /* best effort */ }
      }
      const meta = tasksInflight.getTranscriptMeta(opts.db, taskId);
      if (meta !== undefined) {
        try { await unlink(meta.transcriptPath); } catch { /* best effort */ }
      }
    }

    // 5. Cascade reset — find downstream tasks that never ran (attempts=0, failed).
    // Dependencies live in plan.json on disk (task.dependsOn arrays). Read the
    // plan to build the dependency graph, then walk it transitively from taskId.
    const planPath = join(directive.projectPath ?? '', '.factory', 'plan.json');
    const planData = JSON.parse(await readFile(planPath, 'utf8')) as {
      tasks: Array<{ id: string; dependsOn: string[]; status: string; attempts: number }>;
    };
    const cascadeReset: string[] = [];
    const findCascadeDeps = (sourceId: string): void => {
      for (const pt of planData.tasks) {
        if (pt.dependsOn.includes(sourceId)) {
          const dbTask = tasks.find((t) => t.id === pt.id);
          if (dbTask?.status === 'failed' && dbTask.attempts === 0) {
            cascadeReset.push(pt.id);
            tasksInflight.resetForRetry(opts.db, pt.id, 0);
            findCascadeDeps(pt.id);
          }
        }
      }
    };
    findCascadeDeps(taskId);

    // 6. Re-activate directive
    directivesQ.updateStatus(opts.db, directiveId, 'running');

    // 7. Signal the brain
    directiveSignals.insert(opts.db, directiveId, 'task_retry', {
      taskId,
      mode,
      cascadeReset,
    });

    // 8. Emit SSE event
    opts.streamHub?.emit(directiveId, {
      type: 'task.retried',
      taskId,
      directiveId,
      mode,
      attempt: newAttempts,
      cascadeReset,
    });

    reply.send({
      taskId,
      directiveId,
      mode,
      attempt: newAttempts,
      cascadeReset,
    });
  },
);
```

- [ ] **Step 4: Add `resetForRetry` query helper**

In `packages/state/src/queries/tasks-inflight.ts`:

```typescript
export function resetForRetry(db: Database, taskId: string, attempts: number): void {
  db.prepare(
    `UPDATE tasks_inflight
     SET status = 'pending', attempts = ?, result_json = NULL,
         finished_at = NULL, transcript_path = NULL,
         transcript_bytes = NULL, transcript_lines = NULL
     WHERE id = ?`,
  ).run(attempts, taskId);
}
```

- [ ] **Step 5: Run tests + build**

Run: `pnpm build && pnpm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/daemon/src/server.ts packages/ipc/src/schemas.ts packages/ipc/src/sse.ts packages/state/src/queries/tasks-inflight.ts
git commit -m "feat(daemon): POST per-task retry endpoint with cascade reset and brain signaling"
```

---

### Task 11: Brain signal-aware re-entry loop

**Files:**
- Modify: `packages/brain/src/pool.ts`
- Modify: `packages/brain/src/loop.ts`

- [ ] **Step 1: Add signal polling to the brain's claim loop**

In `packages/brain/src/loop.ts`, in the directive execution section (after a directive completes with `blocked` status or during the poll cycle), add a check for unconsumed retry signals:

```typescript
import * as directiveSignals from '@factory5/state/queries/directive-signals';

// In the claim/poll loop, after checking for pending directives:
const retrySignal = directiveSignals.consumeNext(db, directiveId, 'task_retry');
if (retrySignal !== undefined) {
  const payload = retrySignal.payload as { taskId: string; mode: string; cascadeReset: string[] };
  log.info(
    { directiveId, taskId: payload.taskId, mode: payload.mode, cascadeReset: payload.cascadeReset },
    'brain: received task_retry signal — re-entering directive execution',
  );
  // Re-enter executeDirective for this directive
  await executeDirective(db, directiveId, registry, emit);
}
```

- [ ] **Step 2: Add resume prompt prefix in pool dispatcher**

In `packages/brain/src/pool.ts`, when building the user prompt for a task, check if `task.attempts > 0`:

```typescript
// In the prompt construction section of executeTaskWithBudgetGuard:
let resumePrefix = '';
if (task.attempts > 0) {
  // Check if worktree still exists (resume mode) or was wiped (clean mode)
  const worktreeExists = existsSync(join(projectPath, '.factory', 'worktrees', `task-${task.id}`));
  if (worktreeExists) {
    resumePrefix = 'This task was previously attempted but did not complete. The worktree contains partial work from the prior attempt. Continue from where it left off.\n\n';
  }
}
const fullUserPrompt = resumePrefix + userPrompt;
```

- [ ] **Step 3: Run full test suite**

Run: `pnpm build && pnpm test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/brain/src/pool.ts packages/brain/src/loop.ts
git commit -m "feat(brain): signal-aware re-entry loop for per-task retry"
```

---

### Task 12: Frontend — expandable task panel with transcript viewer

**Files:**
- Modify: `apps/factory-web/src/pages/directives/detail.astro`

This is the frontend-only task. The API endpoints from Tasks 8 and 10 are already in place. Task 9's `transcript.line` SSE events provide the live-streaming data.

- [ ] **Step 1: Add expandable row behavior to task table**

In the task rendering section of `detail.astro`, wrap each task row in a clickable container. Add a `data-task-id` attribute. On click, toggle an expanded panel below the row:

```typescript
// In the client-side JS section:
function toggleTaskPanel(taskId: string): void {
  const existing = document.getElementById(`task-panel-${taskId}`);
  if (existing) {
    existing.remove();
    return;
  }
  // Close any other open panel (accordion)
  document.querySelectorAll('.task-panel').forEach((el) => el.remove());
  // Create and insert the panel
  const panel = createTaskPanel(taskId);
  const row = document.querySelector(`[data-task-id="${taskId}"]`);
  row?.insertAdjacentElement('afterend', panel);
  loadTranscript(taskId, 0, 'full');
}
```

- [ ] **Step 2: Implement transcript loading and rendering**

```typescript
async function loadTranscript(taskId: string, offset: number, level: string): Promise<void> {
  const panel = document.getElementById(`task-panel-${taskId}`);
  if (!panel) return;
  const directiveId = state.directive!.id;
  const resp = await fetch(
    `/api/v1/directives/${directiveId}/tasks/${taskId}/transcript?offset=${offset}&limit=500&level=${level}`,
    { headers: { Authorization: `Bearer ${authToken}` } },
  );
  const data = await resp.json();

  const body = panel.querySelector('.transcript-body')!;
  for (const line of data.lines) {
    body.appendChild(renderTranscriptLine(line));
  }
  // Update "load more" button visibility
  const loadMore = panel.querySelector('.load-more') as HTMLElement;
  if (data.hasMore) {
    loadMore.style.display = 'block';
    loadMore.dataset.nextOffset = String(offset + 500);
  } else {
    loadMore.style.display = 'none';
  }
  // Update header stats
  panel.querySelector('.transcript-stats')!.textContent =
    `${data.bytesTotal > 1_000_000 ? `${(data.bytesTotal / 1_000_000).toFixed(1)} MB` : `${(data.bytesTotal / 1000).toFixed(0)} KB`} · ${data.total} lines`;
}
```

- [ ] **Step 3: Implement line renderer by type**

```typescript
function renderTranscriptLine(line: any): HTMLElement {
  const el = document.createElement('div');
  el.className = 'transcript-line';

  if (line.type === 'assistant') {
    el.className += ' transcript-assistant';
    el.innerHTML = `<div class="transcript-header">assistant</div><div class="transcript-content">${escapeHtml(line.message ?? line.content ?? JSON.stringify(line))}</div>`;
  } else if (line.type === 'tool_use') {
    el.className += ' transcript-tool-use';
    el.innerHTML = `<div class="transcript-header">tool: ${escapeHtml(line.name ?? 'unknown')}</div><details><summary>arguments</summary><pre>${escapeHtml(JSON.stringify(line.input ?? line, null, 2))}</pre></details>`;
  } else if (line.type === 'tool_result') {
    const isError = line.is_error === true;
    el.className += isError ? ' transcript-tool-error' : ' transcript-tool-result';
    el.innerHTML = `<div class="transcript-header">${isError ? '✗' : '✓'} result</div><details><summary>output</summary><pre>${escapeHtml(typeof line.content === 'string' ? line.content : JSON.stringify(line.content ?? line, null, 2))}</pre></details>`;
  } else if (line.type === 'result') {
    el.className += ' transcript-final';
    el.innerHTML = `<div class="transcript-header">final result (${escapeHtml(line.subtype ?? 'unknown')})</div><pre>${escapeHtml(line.result ?? JSON.stringify(line))}</pre>`;
  } else {
    el.className += ' transcript-other';
    el.innerHTML = `<pre>${escapeHtml(JSON.stringify(line, null, 2))}</pre>`;
  }
  return el;
}
```

- [ ] **Step 4: Add level filter tabs**

```typescript
function createTaskPanel(taskId: string): HTMLElement {
  const panel = document.createElement('div');
  panel.id = `task-panel-${taskId}`;
  panel.className = 'task-panel';
  panel.innerHTML = `
    <div class="transcript-header-bar">
      <div class="transcript-tabs">
        <button class="tab active" data-level="full">Full</button>
        <button class="tab" data-level="tools">Tools only</button>
        <button class="tab" data-level="errors">Errors only</button>
      </div>
      <span class="transcript-stats">loading...</span>
    </div>
    <div class="transcript-body"></div>
    <button class="load-more" style="display:none">Load more</button>
    <div class="retry-buttons" style="display:none">
      <button class="retry-resume">Retry (Resume)</button>
      <button class="retry-clean">Retry (Clean)</button>
    </div>
  `;
  // Wire up tab clicks
  panel.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      panel.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      panel.querySelector('.transcript-body')!.innerHTML = '';
      loadTranscript(taskId, 0, (tab as HTMLElement).dataset.level!);
    });
  });
  // Wire up load-more
  panel.querySelector('.load-more')!.addEventListener('click', (e) => {
    const btn = e.target as HTMLElement;
    const activeTab = panel.querySelector('.tab.active') as HTMLElement;
    loadTranscript(taskId, parseInt(btn.dataset.nextOffset!, 10), activeTab.dataset.level!);
  });
  // Show retry buttons only for failed tasks
  const task = state.tasks.get(taskId);
  if (task?.status === 'failed') {
    (panel.querySelector('.retry-buttons') as HTMLElement).style.display = 'flex';
    wireRetryButtons(panel, taskId);
  }
  return panel;
}
```

- [ ] **Step 5: Add retry button handlers**

```typescript
function wireRetryButtons(panel: HTMLElement, taskId: string): void {
  const directiveId = state.directive!.id;

  panel.querySelector('.retry-resume')!.addEventListener('click', async () => {
    if (!confirm('Retry this task? The existing worktree will be preserved.')) return;
    await postRetry(directiveId, taskId, 'resume');
  });

  panel.querySelector('.retry-clean')!.addEventListener('click', async () => {
    if (!confirm('Retry this task with a clean slate? The worktree and transcript will be deleted.')) return;
    await postRetry(directiveId, taskId, 'clean');
  });
}

async function postRetry(directiveId: string, taskId: string, mode: 'resume' | 'clean'): Promise<void> {
  const resp = await fetch(`/api/v1/directives/${directiveId}/tasks/${taskId}/retry`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode }),
  });
  if (!resp.ok) {
    const err = await resp.json();
    alert(`Retry failed: ${err.message ?? resp.statusText}`);
    return;
  }
  // Close the panel — SSE will update the task row
  document.getElementById(`task-panel-${taskId}`)?.remove();
}
```

- [ ] **Step 6: Handle `task.retried` SSE event**

In the SSE event handler section, add:

```typescript
case 'task.retried': {
  const task = state.tasks.get(event.taskId);
  if (task) {
    task.status = 'pending';
    task.result = undefined;
    task.finishedAt = undefined;
  }
  for (const cascadeId of event.cascadeReset) {
    const ct = state.tasks.get(cascadeId);
    if (ct) {
      ct.status = 'pending';
      ct.result = undefined;
      ct.finishedAt = undefined;
    }
  }
  // Close any open transcript panel for the retried task
  document.getElementById(`task-panel-${event.taskId}`)?.remove();
  renderTasks();
  break;
}
```

- [ ] **Step 7: Handle `transcript.line` SSE events for live tail**

In the SSE event handler, add:

```typescript
case 'transcript.line': {
  // Only append if the panel for this task is currently open
  const panel = document.getElementById(`task-panel-${event.taskId}`);
  if (panel) {
    const body = panel.querySelector('.transcript-body')!;
    body.appendChild(renderTranscriptLine(event.line));
    // Auto-scroll to bottom
    body.scrollTop = body.scrollHeight;
    // Update line count in header
    const stats = panel.querySelector('.transcript-stats');
    if (stats) {
      const currentLines = body.children.length;
      stats.textContent = `${currentLines} lines (live)`;
    }
  }
  break;
}
```

Also update `toggleTaskPanel` to handle the running-task case — when opening a panel for a running task, load persisted lines first (the file is being written to in real time), then the SSE handler above appends new lines live:

```typescript
function toggleTaskPanel(taskId: string): void {
  const existing = document.getElementById(`task-panel-${taskId}`);
  if (existing) {
    existing.remove();
    return;
  }
  document.querySelectorAll('.task-panel').forEach((el) => el.remove());
  const panel = createTaskPanel(taskId);
  const row = document.querySelector(`[data-task-id="${taskId}"]`);
  row?.insertAdjacentElement('afterend', panel);
  loadTranscript(taskId, 0, 'full');

  // If task is running, add a live indicator
  const task = state.tasks.get(taskId);
  if (task?.status === 'running') {
    const stats = panel.querySelector('.transcript-stats');
    if (stats) stats.textContent += ' (live)';
  }
}
```

When `task.completed` fires, update any open panel to remove the live indicator:

```typescript
// In the existing task.completed handler, add:
const openPanel = document.getElementById(`task-panel-${event.taskId}`);
if (openPanel) {
  const stats = openPanel.querySelector('.transcript-stats');
  if (stats) stats.textContent = stats.textContent.replace(' (live)', '');
}
```

- [ ] **Step 8: Add CSS styles for the transcript panel and live indicator**

Add to the page's `<style>` section:

```css
.task-panel {
  border: 1px solid var(--border);
  border-top: none;
  padding: 1rem;
  background: var(--surface-1);
  max-height: 600px;
  overflow-y: auto;
}
.transcript-header-bar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem; }
.transcript-tabs { display: flex; gap: 0.5rem; }
.tab { padding: 0.25rem 0.75rem; border: 1px solid var(--border); background: none; cursor: pointer; border-radius: 4px; }
.tab.active { background: var(--accent); color: white; }
.transcript-stats { font-size: 0.85rem; color: var(--text-muted); }
.transcript-line { margin-bottom: 0.5rem; padding: 0.5rem; border-radius: 4px; font-size: 0.9rem; }
.transcript-assistant { background: var(--surface-2); }
.transcript-tool-use { background: #1a1a2e; border-left: 3px solid #4a9eff; }
.transcript-tool-result { background: #1a2e1a; border-left: 3px solid #4aff4a; }
.transcript-tool-error { background: #2e1a1a; border-left: 3px solid #ff4a4a; }
.transcript-final { background: #2e2a1a; border-left: 3px solid #ffcc4a; font-weight: bold; }
.transcript-other { background: var(--surface-2); opacity: 0.7; }
.transcript-header { font-weight: 600; margin-bottom: 0.25rem; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.05em; }
.transcript-content { white-space: pre-wrap; word-break: break-word; }
.transcript-line pre { max-height: 300px; overflow: auto; font-size: 0.8rem; margin: 0.25rem 0 0; }
.load-more { width: 100%; padding: 0.5rem; margin-top: 0.5rem; cursor: pointer; }
.retry-buttons { display: flex; gap: 0.5rem; margin-top: 1rem; padding-top: 1rem; border-top: 1px solid var(--border); }
.retry-resume, .retry-clean { padding: 0.5rem 1rem; border-radius: 4px; cursor: pointer; font-size: 0.9rem; }
.retry-resume { background: var(--accent); color: white; border: none; }
.retry-clean { background: none; border: 1px solid var(--border); color: var(--text); }
```

- [ ] **Step 9: Test in browser**

Run: `pnpm dev` (start the dev server)

Test the following:
1. Navigate to a directive detail page with completed/failed tasks
2. Click a task row — panel should expand showing transcript (or "no transcript" for pre-feature tasks)
3. Click level filter tabs — content should reload with filtered lines
4. Click "Load more" — next page of lines should append
5. For failed tasks, verify retry buttons appear
6. Click "Retry (Resume)" — confirmation dialog, then task resets to pending
7. Verify SSE updates the task row back to pending status
8. For a currently-running task, open the panel — verify "(live)" indicator appears
9. Watch for new transcript lines appending in real time via SSE
10. When the task completes, verify "(live)" indicator disappears

- [ ] **Step 10: Commit**

```bash
git add apps/factory-web/src/pages/directives/detail.astro
git commit -m "feat(web): expandable transcript viewer + per-task retry buttons on directive detail"
```

---

## Verification

### Task 13: End-to-end verification

- [ ] **Step 1: Verify timeout config**

Set `taskStreamTimeoutMs: 3600000` in pythonetl's `.factory/project.json`:

```json
{
  "metadata": {
    "budgetDefaults": { ... },
    "taskStreamTimeoutMs": 3600000
  }
}
```

Trigger a build. Verify in the brain logs that the provider receives the 60-minute timeout.

- [ ] **Step 2: Verify transcript creation**

After a task completes, check:
- `.factory/transcripts/<taskId>.ndjson` exists
- Contains valid NDJSON lines
- `tasks_inflight` row has `transcript_path`, `transcript_bytes`, `transcript_lines` populated

```bash
ls -la .factory/transcripts/
wc -l .factory/transcripts/*.ndjson
```

- [ ] **Step 3: Verify transcript API**

```bash
curl -H "Authorization: Bearer <token>" \
  "http://localhost:3100/api/v1/directives/<id>/tasks/<taskId>/transcript?limit=10&level=full"
```

Verify: returns JSON with `lines` array, `total`, `bytesTotal`, `hasMore`.

- [ ] **Step 4: Verify frontend viewer**

Open the directive detail page. Click a completed task. Verify the transcript panel opens with level tabs, line rendering, and pagination.

- [ ] **Step 5: Verify per-task retry**

On a directive with a failed task:
1. Open the failed task's transcript panel
2. Click "Retry (Resume)"
3. Verify the task resets to pending
4. Verify cascade-blocked downstream tasks also reset
5. Verify the brain re-enters the loop and dispatches the task

- [ ] **Step 6: Run full test suite**

Run: `pnpm build && pnpm test && pnpm lint && pnpm format:check`
Expected: all clean

- [ ] **Step 7: Final commit**

```bash
git add -A
git commit -m "test: end-to-end verification of task observability, retry, and timeout features"
```
