# Agent prompts

One markdown file per agent role (see `docs/AGENTS.md` for the catalog and `packages/brain/src/agents/registry.ts` for runtime registration).

Each file is the agent's system prompt. The brain composes the final prompt at runtime by:

1. Reading this file
2. Appending the skill methodology files listed in the agent's `defaultSkills`
3. Injecting the wiki/findings/plan context for the current task
4. Sending the result to the model resolved for the agent's category

## Files

| File              | Role           | Purpose                                                |
| ----------------- | -------------- | ------------------------------------------------------ |
| `triage.md`       | `triage`       | Classify a free-form directive into an `Intent`        |
| `architect.md`    | `architect`    | Read CLAUDE.md → write `docs/knowledge/` wiki          |
| `planner.md`      | `planner`      | Decompose into a Task DAG                              |
| `scaffolder.md`   | `scaffolder`   | Set up project skeleton, deps, git                     |
| `builder.md`      | `builder`      | Implement modules using strict TDD                     |
| `reviewer.md`     | `reviewer`     | Adversarial review — write shadow tests; never fix     |
| `fixer.md`        | `fixer`        | Fix specific findings by ID; respect existing patterns |
| `investigator.md` | `investigator` | Diagnose novel problems without changing code          |
| `verifier.md`     | `verifier`     | Run full verification checklist; generate docs         |

`legacy/code-reviewer.md` and `legacy/test-runner.md` are reference-only Claude-Code-style subagent prompts kept as comparative reading. They are **not loaded by the brain** — `packages/brain/src/agents/registry.ts` references the active prompts only. Safe to delete if they ever grow confusing.

## Format

```markdown
---
role: <agent-role> # matches packages/core AgentRole
description: |
  Short description of when this agent runs and what it produces.
---

# <Title>

<System prompt body. Be concrete. Reference skills by name where applicable.>
```

## Hot reload

Prompts are read at the start of every directive (no caching across runs). Edit and the next directive picks up the change — no rebuild needed.
