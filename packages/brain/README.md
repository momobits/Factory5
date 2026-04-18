# @factory5/brain

The orchestrator. Triage → architect → plan → delegate to workers → assess → mark complete/blocked.

## Surface

- **Agent registry** (`agents/registry.ts`) — declarative definitions (role, model category, tools, default skills, prompt path). 9 agents: triage, architect, planner, scaffolder, builder, reviewer, fixer, investigator, verifier.
- **`buildAgentSystemPrompt(role)`** — loads `prompts/agents/<role>.md` + concatenates default skills; override the anchor dir with `FACTORY5_PROMPTS_ROOT`.
- **`triageDirective(text, { registry, db?, directiveId? })`** — `quick`-tier classification into an `Intent`; falls back to `chat` when the model's confidence is < 0.7.
- **`runArchitect({ registry, projectPath, ... })`** — `reasoning`-tier wiki design; writes pages to `docs/knowledge/`; runs the readiness gate.
- **`runPlanner({ registry, projectPath, directiveId, ... })`** — `planning`-tier task DAG; writes `plan.json` + `plan.md`.
- **`buildDefaultRegistry(opts?)`** — ships a `claude-cli`-only `ProviderRegistry` with category → model defaults (Haiku/Sonnet/Opus); override-friendly.
- **`recordUsage({ db, directiveId?, taskId?, category, resolution, response, durationMs, error? })`** — single path into `model_usage`.

## Public entry: `runBrain`

```ts
import { runBrain } from '@factory5/brain';

const handle = await runBrain({
  mode: 'inline', // 'inline' implemented; 'serve' is Phase 3
  directiveId: '01HXY…',
  // optional:
  // registry: buildDefaultRegistry(),
  // db: myDb,
  // claimedBy: 'my-brain',
});
const result = await handle.done;
// result.directive, triage, architect, plan, taskResults, assessment, terminalStatus
```

Inline mode runs the full pipeline:

1. Claim the directive in SQLite (`pending` → `claimed` → `running`).
2. Triage (records audit; inline CLI builds preserve the original intent).
3. Architect → wiki pages + readiness gate (non-fatal in Phase 1 if readiness fails).
4. Planner → `plan.json` + `plan.md` (reuses an in-progress plan if one exists).
5. Topo-sort tasks, run workers serially, skip downstream tasks of failures.
6. Assessor runs (pytest + imports + artifacts + git).
7. Mark directive `complete` or `blocked`; append BUILD.md summary line.

## Status

Phase 1 inline path implemented. `mode: 'serve'` + parallel worker pool + tool-using workers are Phase 2/3.
