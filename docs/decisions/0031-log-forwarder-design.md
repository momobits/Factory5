# 0031 — Log-forwarder design: manual emit sites first; pino-transport-tap deferred

- **Status:** Accepted
- **Date:** 2026-05-16
- **Builds on:** [ADR 0029](0029-directive-stream-protocol.md) — defined the `log.line` SSE event schema and the brain-side optional-callback emission contract. The hub, the route, the `EventSource` client, and the Zod schema in `@factory5/ipc/sse` all shipped in Phase 3. This ADR is about the _emission-side_ coverage that Phase 3 left under-saturated.

## Context

`packages/ipc/src/sse.ts` defines six SSE event types pushed over `GET /api/v1/directives/:id/stream`. Five of them (`task.started`, `task.completed`, `finding.created`, `spend.updated`, `directive.completed`) are wired across `pool.ts` / `loop.ts` / `serve.ts` and consistently fire over the directive's lifecycle. The sixth — `log.line` — is fired from exactly one site in the brain today: `packages/brain/src/loop.ts:258`, where the chat-reply text is mirrored to the SSE stream so `/app/chat` renders one bubble per agent turn.

For `build` directives this leaves the directive-detail activity panel silent for the full duration of the run. The brain's pino stream is verbose — every stage emits `info` / `warn` / `error` lines at narrative breakpoints (architect-start, wiki-written, planner-start, planner-parse-fail, pool-task-dispatched, etc.) — but those lines stay in the daemon log file and never reach the operator's dashboard.

The forcing function is an `automl` build directive on 2026-05-16 (`01KRQ1RPE5SM6Q8AYSRHHAPG39`) that ran for ~14 minutes (architect ~3 min, planner ~10 min) before crashing on a `ZodError: tasks Required` at `packages/brain/src/planner.ts:335`. The operator watching the dashboard saw the directive flip from `running` to `failed` with zero narrative — no indication of which stage broke or what Sonnet returned that didn't parse. The daemon log carried the full story; the UI carried nothing.

Closing the gap requires deciding _how_ brain stages tell the SSE stream what they're doing. Two coherent approaches present themselves; this ADR pins the choice plus the guardrails that make the chosen approach maintainable.

## Decision

Five parts, one ADR.

### 1. Manual `emitLogLine` sites — chosen for first-ship

The brain emits `log.line` events via explicit `emitLogLine(emit, directiveId, level, component, msg, attrs?)` calls (defined at `packages/brain/src/loop.ts:176`) at every narrative breakpoint — stage entry, stage exit (with summary), and error paths. The set of breakpoints is enumerated in [`UPGRADE/plans/tier-10-resume-and-activity-feed.md`](../../UPGRADE/plans/tier-10-resume-and-activity-feed.md) §10.3; the ADR pins the _pattern_, the plan pins the exact sites for first-ship.

Why this over an automatic transport tap:

- **Exactly what we want surfaces.** The operator gets the narrative breakpoints, not every `log.debug` line the brain emits internally. Pino has dozens of `log.debug` calls inside hot paths (e.g. provider call serialisation, query-helper instrumentation); auto-mirroring them would bury the signal under noise.
- **No throttling design needed.** Manual sites self-throttle by being placed at semantic boundaries. An auto-tap would need a rate limit (operator-perceptible flooding is real — the assessor's per-test invocation logs would push thousands of lines in seconds).
- **No payload-shape surprises.** Pino objects can carry stack traces, large nested structures (Zod `issues` arrays, provider response bodies), and circular refs. Manual sites pick exactly what crosses the SSE wire; the size budget is predictable.
- **Testable per site.** `loop.test.ts` and per-module unit tests can assert "stage X emitted level Y at message Z" with the same fidelity they assert "task pool transitioned to state W". An auto-tap pushes the assertion surface into integration tests that have to drive the full pino stream.
- **Maintainable in code review.** A reviewer can see "this PR added a stage, it should also surface log.line for entry/exit/error" by reading the diff. An auto-tap hides the emission contract behind framework magic.

The cost is the obvious one: authors must remember to wire `emitLogLine` when adding a new brain stage. The guardrail (decision 4) makes this enforceable.

### 2. Event shape — level + component + msg + optional attrs

`emitLogLine` signature (already shipped in Phase 3):

```ts
emitLogLine(
  emit: DirectiveEventEmitter | undefined,
  directiveId: string,
  level: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal',
  component: string,
  msg: string,
  attrs?: Record<string, unknown>,
): void
```

The `component` field follows the existing pino convention: dotted hierarchy starting with the package (`brain.triage`, `brain.architect`, `brain.planner`, `brain.pool`, `brain.assessor`, `brain.loop`). The FE renders the component as a small monospaced label; the level renders as a coloured pill (info / warn / error mapped to the design-system tokens shipped in Tier 9).

`msg` is human-readable single-line prose. Anything structured goes in `attrs`. The schema (`packages/ipc/src/sse.ts:logLineEventSchema`) caps neither — but emission sites should keep `msg` under ~120 chars and `attrs` under ~4 KB per event so the SSE stream stays readable.

### 3. Error-line shape — `attrs.detail` carries first 500 chars of offending LLM output

When an LLM response fails to validate (planner's `extractJsonObject → null`, planner's `plannerJsonSchema.parse` Zod throw, similar future sites), the corresponding `error`-level `log.line` event carries the first 500 chars of `response.text` as `attrs.detail`. This matches the existing pattern at `planner.ts:331` which constructs an `Error.message` containing the first 500 chars — the SSE event uses the same prefix so the operator sees the same diagnostic context in the dashboard that the daemon log already records.

Example payload for the `automl` planner crash:

```json
{
  "type": "log.line",
  "directiveId": "01KRQ1RPE5SM6Q8AYSRHHAPG39",
  "ts": "2026-05-16T00:21:17.659Z",
  "level": "error",
  "component": "brain.planner",
  "msg": "planner: schema parse failed — tasks Required",
  "attrs": {
    "detail": "<first 500 chars of Sonnet's output that failed to parse>",
    "zodIssues": [
      { "path": ["tasks"], "code": "invalid_type", "expected": "array", "received": "undefined" }
    ]
  }
}
```

`attrs.zodIssues` is a copy of the Zod error's `.issues` array, truncated to the first three issues so the payload stays bounded. The `Error.message` thrown to the brain's surrounding try/catch is unchanged — the SSE event is purely _additive_.

### 4. Guardrail — at least one `emitLogLine` per brain stage entry, exit, and error path

To make the manual-sites approach enforceable without a runtime contract, the convention is: **every brain stage MUST emit a `log.line` event at (a) stage entry, (b) stage exit on the happy path with a one-line summary of what was produced, and (c) every error path that ends the stage**.

A "brain stage" is any function in `packages/brain/src/` that takes a `directiveId` and either calls an LLM provider, writes to the wiki / plan / findings registry / task pool, or runs the assessor. The current stage set is `triage`, `architect`, `planner`, `pool` (each task dispatch + completion + error), `assessor`, `loop` (per-mode wiring + terminal finalisation). The set is closed by the brain's `index.ts` exports; reviewers can audit emission by walking the public surface.

Tests in `loop.test.ts` extend to assert (a) and (b) per stage on the happy path; per-module unit tests assert (c) on error paths. A regression test for the planner parse-fail path is the canonical example for new error-site additions — modelled at `planner.test.ts` once 10.3 lands.

### 5. Operator-visible truncation — `attrs.detail` is a prefix, not a transcript

`attrs.detail` is bounded at 500 chars for first-ship. This matches the existing pattern at `planner.ts:331`'s thrown-error message. The operator who wants the full LLM response (longer reasoning trace, full plan body) still has the daemon log file as the system-of-record; the SSE stream is a _summary_ surface, not a transcript.

If 500 chars turns out to be insufficient in real use, this can be tuned without an ADR amendment — but the bound itself stays in the ADR so future authors know it's a deliberate choice, not an accident.

## Consequences

### Positive

- Operator watching directive-detail sees a real narrative for `build` directives: triage → architect started → wiki written (N pages) → readiness passed/failed → planner started → plan written (M tasks) | planner: parse failed (first 500 chars of output) → tasks dispatched → terminal.
- Schema-parse failures and other LLM-output validation errors stop being silent in the UI. The operator's debugging path goes from "guess what stage broke and read the daemon log" to "open the directive and read the error line".
- The emission contract is local to each brain stage — adding a new stage means adding a few `emitLogLine` calls in the same file, not modifying a transport-tap configuration somewhere else.

### Negative

- Authors must remember the convention. Mitigated by the guardrail (decision 4) and the canonical test patterns established in Tier 10. The first PR that adds a new brain stage without `emitLogLine` should fail review.
- `attrs.detail`'s 500-char truncation can occasionally hide the actual root cause if it falls past the prefix. The daemon log is the fallback. If this becomes a real pain (operator regularly needing the daemon log to debug), future tuning is a one-line change.
- No "what is happening right now" event for stages that complete synchronously in <100 ms (e.g. small-file wiki writes). The entry+exit pair will fire effectively simultaneously. This is fine — the operator sees the transition; the timing is in the timestamps.

## Alternatives considered

### A. Pino transport tap (auto-mirror by `directiveId` binding)

A custom Pino transport registered on the brain logger that mirrors every pino line carrying a `directiveId` field to the `DirectiveEventEmitter`. Pros: zero-touch; new stages automatically surface; no convention to enforce. Cons:

- **Bloat.** Internal `log.debug` lines (provider call serialisation, query timings, hot-path instrumentation) would flood the SSE stream. An allow-list / level filter would be required — and once a filter is in place, the simplicity advantage evaporates.
- **Payload-shape surprises.** Pino lines carry stack traces, large nested objects, circular refs. Each would need serialisation rules. The transport becomes a non-trivial chunk of code with its own test surface.
- **Harder to throttle.** Per-component / per-level / per-directive rate limits would be required to prevent operator flooding. None of these are needed with manual sites because authors place emissions at semantic breakpoints.
- **Test fidelity drop.** Stage-level assertions move from unit tests ("stage X emitted Y") to integration tests ("the pino transport mirrored Y when stage X ran"). Brittle.

**Retained as Tier 11+ candidate.** If the manual-emit-site overhead becomes a maintenance burden in practice — e.g., the brain grows from 8 stages to 30 and the manual-emit convention becomes a serial source of code-review nits — revisit. The infrastructure cost is well-understood at that point; the trigger is operator-felt pain, not preemptive design.

### B. Hybrid — manual sites for narrative, pino tap for everything else

Manual `emitLogLine` calls at curated narrative breakpoints (decision 1) AND an auto-tap that mirrors any pino line at `warn` or `error` level carrying a `directiveId` binding, filtered through an allow-list of components. Pros: narrative is hand-crafted; unexpected errors surface automatically. Cons: doubles the code surface for emission. The same problem as alternative A, just less of it. **Deferred.** Revisit if the manual-emit convention misses a class of error worth surfacing automatically — the most likely candidate being unhandled `process.on('uncaughtException')` lines from brain-side native callers.

### C. Polling-based activity log

Persist `log.line`-equivalent rows to a `directive_log_lines` table; FE polls `GET /api/v1/directives/:id/logs?since=<cursor>` every second. Pros: durable — operator opening directive-detail after the directive completes sees the full narrative. Cons: defeats the SSE infrastructure shipped in Phase 3 (ADR 0029). The persistence direction is a separate concern (Tier 11+ candidate per Tier 10 plan's deferred section); it should layer _on top_ of `emitLogLine`, not replace it.

## References

- [ADR 0029](0029-directive-stream-protocol.md) — SSE plumbing this ADR consumes
- `packages/brain/src/loop.ts:176` — `emitLogLine` signature
- `packages/ipc/src/sse.ts` — `logLineEventSchema` Zod definition
- [Tier 10 plan](../../UPGRADE/plans/tier-10-resume-and-activity-feed.md) §10.3 — enumerated emit sites
- U030 — operator-felt incident driving this ADR
