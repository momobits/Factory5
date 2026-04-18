# Agent prompts

One markdown file per agent role (see `docs/AGENTS.md` for the catalog and `packages/brain/src/agents/registry.ts` for runtime registration).

Each file is the agent's system prompt. The brain composes the final prompt at runtime by:

1. Reading this file
2. Appending the skill methodology files listed in the agent's `defaultSkills`
3. Injecting the wiki/findings/plan context for the current task
4. Sending the result to the model resolved for the agent's category

## Files

| File                      | Role           | Status                                     |
| ------------------------- | -------------- | ------------------------------------------ |
| `triage.md`               | `triage`       | stub                                       |
| `architect.md`            | `architect`    | stub                                       |
| `planner.md`              | `planner`      | stub                                       |
| `scaffolder.md`           | `scaffolder`   | stub                                       |
| `builder.md`              | `builder`      | stub                                       |
| `reviewer.md`             | `reviewer`     | stub                                       |
| `fixer.md`                | `fixer`        | stub                                       |
| `investigator.md`         | `investigator` | stub                                       |
| `verifier.md`             | `verifier`     | stub                                       |
| `legacy/code-reviewer.md` | reference      | from factory2 — Claude-Code-style subagent |
| `legacy/test-runner.md`   | reference      | from factory2 — Claude-Code-style subagent |

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

## Phase 1 work

The stubs are intentionally minimal. Phase 1 lands the real prompts based on factory2's experience and the OmO Sisyphus/Hephaestus/Prometheus patterns. The stub format is the contract; the body is what evolves.
