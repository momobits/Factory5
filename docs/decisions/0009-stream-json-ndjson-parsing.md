# 0009 — Stream-json NDJSON parsing in `ClaudeCliProvider.stream()`

- **Status:** Accepted
- **Date:** 2026-04-18

## Context

Phase 1 shipped `ClaudeCliProvider.stream()` as a stub that delegated to
`call()` and yielded one chunk. Phase 2's tool-using worker calls `stream()`
and needs live progress + per-task cancellation + final usage recorded
into `model_usage`. Three decisions were load-bearing enough to capture:

1. **Which events to emit as chunks.** `claude -p --output-format stream-json`
   emits NDJSON with several `type`s: `system/init`, `assistant`, `user` (tool
   results), `result`. Assistant messages carry content blocks of type `text`
   or `tool_use`.
2. **How to shape the terminal chunk.** The existing contract,
   `{ delta: string; usage?: ProviderUsage }`, ships the final `usage` in
   the last chunk; we needed to decide what goes into `delta` for
   non-text events.
3. **How to thread abort + timeout through an async generator** without
   leaking child processes.

## Decision

**Event → chunk mapping.** Extracted into `parseStreamJsonLine(line)` →
`StreamEvent | undefined` and `eventToChunks(evt)` →
`ProviderStreamChunk[]`, both pure and unit-testable:

- `assistant` event → one chunk per `{type: 'text', text}` content block,
  with `delta = text`. Empty text and `tool_use` blocks are skipped; the
  brain's finding parser runs over concatenated text, so tool-use records
  are observability-only and not needed for that path.
- `result` event → one terminal chunk with `delta = ''` and
  `usage = usageFromResult(evt)` (prefers `total_cost_usd` over `cost_usd`;
  falls back to zero for each field). `resultIsError(evt)` is checked
  first — an error result throws out of the generator with a descriptive
  error including the CLI subtype.
- `system`, `user` events → no chunks.

**Lines that fail JSON.parse or schema-match** are silently dropped.
`--verbose` occasionally interleaves non-JSON debug lines; treating a
single stray line as a fatal error would turn a debuggable subprocess into
a crashed build.

**ProviderRequest surface.** To make `stream()` useful for tool-using work
the contract gains three optional fields:

- `cwd?: string` — per-call working directory (for the per-task worktree).
- `allowedTools?: readonly string[]` — comma-joined into `--allowedTools`.
- `permissionMode?: 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan'`
  — `bypassPermissions` translates to `--dangerously-skip-permissions`
  because that flag has the widest CLI-version compatibility for
  unattended operation; other modes pass through as
  `--permission-mode <mode>`.

**Lifecycle / abort.** `streamClaude(child, opts)` is the internal async
generator. It uses an in-memory queue populated by:

- `readline.createInterface({ input: child.stdout })` for line splitting
  (`crlfDelay: Infinity` because Windows).
- Child `error` / `close` for terminal conditions.
- The caller's `AbortSignal` via `addEventListener('abort', ...)`.
- A hard `streamTimeoutMs` (default `2 * timeoutMs`) so tool-using
  sessions can run longer than the one-shot default without ever being
  unbounded.

All settlement paths (abort, timeout, error, normal close) go through a
single `finish()` helper that clears the timer, removes the abort
listener, `SIGKILL`s the child, and pushes a terminal queue entry so
consumers observe a clean end. The generator's `finally` block re-runs
the teardown to cover break/return inside `for await`.

## Consequences

**Positive:**

- Unit tests for `parseStreamJsonLine` / `eventToChunks` / `usageFromResult`
  / `resultIsError` cover the event-mapping logic without spawning
  subprocesses. 16 tests land in `stream-events.test.ts`.
- The `call()` path's `AbortError` class and kill-and-settle pattern is
  reused, so cancellation semantics are identical between modes.
- Future providers (anthropic-api with SSE, OpenAI-style streams) can
  implement `stream()` by constructing `ProviderStreamChunk`s directly —
  the event-mapping helpers are claude-cli-specific and do not leak.
- `result_is_error` handling means a `subtype: 'error_max_turns'` event
  becomes an explicit worker failure with a message, not a silently
  truncated build.

**Negative:**

- We throw away per-token detail. `stream-json` emits per-message chunks,
  which is enough for logs but not for a live typing UI. Acceptable for
  Phase 2; later we can either switch to a richer CLI flag or use the
  anthropic-api provider's SSE path where every token is a chunk.
- Silently dropping unparseable lines hides genuine CLI bugs. We mitigate
  by logging at `debug` in the caller, not here — the cost of a noisy
  stream breaking a build is worse than the cost of a hidden fragment.

**Reversible?** Yes. Swapping to a different output format or a different
parser changes only `stream-events.ts` and a few lines in `claude-cli.ts`.

## Alternatives considered

- **Keep `stream()` delegating to `call()`.** Rejected: with tool-using
  agents that run for minutes, waiting for a single JSON envelope defeats
  the point of streaming and breaks any observability story.
- **Use the CLI's `--output-format text`.** Rejected: no structured usage
  on completion, no clean boundaries between tool use and text, no
  error envelope.
- **Emit a chunk per line without filtering.** Rejected: consumers would
  see `system/init`, `user`/`tool_result`, and non-JSON debug fragments.
  Most are useless for the finding-parsing path and some are malformed —
  filtering at the parse stage keeps worker logic simple.
