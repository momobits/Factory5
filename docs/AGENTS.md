# Agents catalog

Agents are _roles_ in the build pipeline. Each agent has:

- A **role** name (the `AgentRole` enum value)
- A **model category** (see ADR 0004) — declarative, not a hardcoded model
- An **allowed tool set** (per-agent permissioning)
- A **prompt template** (markdown in [`../prompts/agents/`](../prompts/agents))
- A **default skill list** (markdown injected into the prompt)

> Initial agents inspired by `factory2/agents/` and the OmO Sisyphus/Hephaestus/Prometheus/Oracle pattern.

| Agent          | Category    | Tools                               | Default skills                                              | Purpose                                                |
| -------------- | ----------- | ----------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------ |
| `triage`       | `quick`     | none (read-only classification)     | —                                                           | Classify a free-form directive into an `Intent`        |
| `architect`    | `reasoning` | Read, Write, Glob, Grep             | `architect`, `documentation`, `brainstorming`               | Read CLAUDE.md → write `docs/knowledge/` wiki          |
| `planner`      | `planning`  | Read, Glob, Grep                    | `progress-tracking`                                         | Decompose into a Task DAG                              |
| `scaffolder`   | `planning`  | Read, Write, Edit, Bash, Glob       | `scaffolding`, `dependency-install`                         | Set up project skeleton, deps, git                     |
| `builder`      | `deep`      | Read, Write, Edit, Bash, Glob, Grep | `tdd`, `progress-tracking`, `work-verification`             | Implement modules using strict TDD                     |
| `reviewer`     | `reasoning` | Read, Write, Glob, Grep             | `code-review`                                               | Adversarial review — write shadow tests; never fix     |
| `fixer`        | `reasoning` | Read, Write, Edit, Bash, Glob, Grep | `error-recovery`, `tdd`                                     | Fix specific findings by ID; respect existing patterns |
| `investigator` | `reasoning` | Read, Bash, Glob, Grep              | `error-recovery`                                            | Diagnose novel problems without changing code          |
| `verifier`     | `planning`  | Read, Bash, Glob, Grep              | `work-verification`, `integration-testing`, `documentation` | Run full verification checklist; generate docs         |

## Adding an agent

1. Create `prompts/agents/<role>.md` with the system prompt
2. Define the role in `packages/core/src/agent-roles.ts` (extend `AgentRole`)
3. Register in `packages/brain/src/agents/registry.ts` with category, tools, skills
4. Add a row above
5. Add a test in `packages/brain/src/agents/registry.test.ts`

## Model category resolution

Each agent declares a _category_, not a model. The provider layer resolves category → provider+model via the user's `~/.factory5/config.toml`. See ADR 0004.

Default mapping:

| Category        | Default provider/model            |
| --------------- | --------------------------------- |
| `quick`         | `anthropic-api/claude-haiku-4-5`  |
| `planning`      | `anthropic-api/claude-sonnet-4-6` |
| `reasoning`     | `claude-cli/claude-opus-4-7`      |
| `deep`          | `claude-cli/claude-opus-4-7`      |
| `documentation` | `anthropic-api/claude-haiku-4-5`  |

Override per agent in user config:

```toml
[agents.builder]
category = "deep"            # default
override = "openai/gpt-5"    # force specific model
```
