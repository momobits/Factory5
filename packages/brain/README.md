# @factory5/brain

The orchestrator. Triage → architect → plan → delegate to workers → assess → verify → loop or escalate.

## Components (planned)

- **Agent registry** (`src/agents/registry.ts`) — declarative agent definitions (role, category, tools, default skills, prompt path)
- **Triage** (`src/triage.ts`) — classify a directive's intent
- **Architect** (`src/architect.ts`) — design the wiki for a project from CLAUDE.md
- **Planner** (`src/planner.ts`) — decompose into a Task DAG
- **Loop** (`src/loop.ts`) — main orchestration: claim directive, run pipeline, persist, escalate
- **Tools** (`src/tools/`) — `ask_user`, `escalate_blocked`, finding-tracker, etc.

## Public API (planned)

```ts
import { runBrain } from '@factory5/brain';

await runBrain({ db, providers, mode: 'inline', directiveId });
// or:
await runBrain({ db, providers, mode: 'serve' });  // long-running, claims pending directives
```

## Status

Stub — agent registry shape only. Phase 1 wires the inline-build path; Phase 3 wires the serve path.
