# @factory5/brain

The orchestrator. Triage → architect → plan → delegate to workers → assess → mark complete/blocked. Mid-flight, the brain can park execution on a pending question via `askUser` / `escalateBlocked` (ADR 0015).

## Surface

- **Agent registry** (`agents/registry.ts`) — declarative definitions (role, model category, tools, default skills, prompt path). 9 agents: triage, architect, planner, scaffolder, builder, reviewer, fixer, investigator, verifier.
- **`buildAgentSystemPrompt(role)`** — loads `prompts/agents/<role>.md` + concatenates default skills; override the anchor dir with `FACTORY5_PROMPTS_ROOT`.
- **`triageDirective(text, { registry, db?, directiveId? })`** — `quick`-tier classification into an `Intent`; falls back to `chat` when the model's confidence is < 0.7.
- **`runArchitect({ registry, projectPath, ... })`** — `reasoning`-tier wiki design; writes pages to `docs/knowledge/`; runs the readiness gate.
- **`runPlanner({ registry, projectPath, directiveId, ... })`** — `planning`-tier task DAG; writes `plan.json` + `plan.md`.
- **`runPlanPool({ plan, registry, db, directiveId, ... })`** — parallel executor (ADR 0010); topo-sorts the plan, runs independent ready-tasks concurrently up to `min(4, cpuCount)`, heartbeats `tasks_inflight`, and propagates aborts.
- **`askUser({ db, directiveId, question, options?, deadlineAt?, signal? })`** / **`escalateBlocked({ db, directiveId, reason, attempted, suggestions, ... })`** — Phase 4 primitives (ADR 0015). Create a `pending_questions` row (or resume an existing one), enqueue an outbound message on the directive's originating channel, and poll until answered. Idempotent over `(directiveId, question, taskId?)` — brain-restart replays rehydrate the same row.
- **`openQuestionsForDirective(db, directiveId)`** — list open questions for a directive (for operators + `factory status`).
- **`buildDefaultRegistry(opts?)`** / **`buildRegistryFromDisk()`** — ship a `claude-cli`-only `ProviderRegistry` with category → model defaults, optionally merged with the user's `config.toml`. When `FACTORY5_TEST_PROVIDER=stub` is set, returns a stub-only registry so tests never hit a real model.
- **`loadConfig()` / `saveConfig()` / `channelConfigFor(cfg, id)`** — `config.toml` read/write + per-channel config lookup.
- **`recordUsage({ db, directiveId?, taskId?, category, resolution, response, durationMs, error? })`** — single path into `model_usage`.

## Public entry: `runBrain`

```ts
import { runBrain } from '@factory5/brain';

// Inline (one directive, returns when done)
const inline = await runBrain({ mode: 'inline', directiveId: '01HXY…' });
const result = await inline.done;
// result.directive, triage, architect, plan, taskResults, assessment, terminalStatus

// Serve (long-running claim loop — used by the daemon)
const serve = await runBrain({ mode: 'serve', onWake: doorbell.onWake });
// Later:
await serve.stop();
await serve.done;
```

### Inline pipeline

1. Claim the directive in SQLite (`pending` → `claimed` → `running`).
2. Triage (records audit; inline CLI builds preserve the original intent).
3. Architect → wiki pages + readiness gate (skipped if wiki already passes the gate).
4. Planner → `plan.json` + `plan.md` (reuses an in-progress plan if one exists).
5. `runPlanPool` schedules tasks concurrently; skips downstream of failed upstreams; respects `AbortSignal`.
6. Assessor (pytest + imports + artifacts + git).
7. **Autonomous mode only:** if any task failed or `assessor.verify` is false, call `escalateBlocked` — the brain stays alive until a human answers or the signal aborts.
8. Mark directive `complete` or `blocked`; append BUILD.md summary.

### Serve loop (ADR 0013)

- Atomically `claimNext` pending directives up to `concurrency` in flight (default 1).
- Races the doorbell (`onWake`) against a 250 ms polling fallback.
- On abort: stops claiming, drains in-flight, marks any surviving `running` directives `blocked` so resume can pick them up.

## `askUser` / `escalateBlocked` — how pausing works

```ts
import { askUser, escalateBlocked } from '@factory5/brain';

const res = await askUser({
  db,
  directiveId,
  question: 'Architect produced 7 pages. Continue to planning?',
  options: ['continue', 'abort'],
  signal, // optional
  // deadlineAt: '2026-04-19T00:00:00.000Z',
});
if (res.answer === 'abort') {
  /* … */
}
```

- Creates (or rehydrates on restart) a `pending_questions` row.
- Enqueues a single outbound message addressed to the directive's originating channel.
- Polls `pending_questions.answered_at` at 1 Hz until answered / signal / deadline.
- `factory answer <questionId> <text>` closes a question from any channel the user has CLI access to; channel plugins can also answer contextually (e.g. Discord does it for messages posted in the question's thread).

See ADR 0015 for why this is a brain-level primitive rather than a worker-subprocess suspension mechanism.

## Status

Phase 1–4 shipped. `mode: 'serve'` parallel pool lands in Phase 2 + 3; `askUser`/`escalateBlocked` in Phase 4. Worker-subprocess-level `ask_user` (in-tool clarification) is deferred — see ADR 0015.
