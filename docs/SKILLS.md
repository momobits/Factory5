# Skills catalog

Skills are reusable methodology files (markdown) that get injected into agent prompts. They define _how_ an agent should approach a class of task.

Skill files live in [`../skills/`](../skills). Format: YAML frontmatter (`name`, `description`) + markdown body.

> Skills are factory5-native. New skills follow the format below.

| Skill                      | Purpose                                                                                                                     | Used by                                          |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `architect`                | Design software architecture from a CLAUDE.md spec — produce concrete interfaces, patterns, decisions                       | `architect` agent                                |
| `ask-user`                 | Heuristics for when to escalate via the `ask_user` MCP tool vs. guess and proceed (ADR 0024)                                | `scaffolder`, `builder`, `fixer`, `investigator` |
| `brainstorming`            | Explore options before committing                                                                                           | `architect`, `planner`                           |
| `code-review`              | Adversarial code review checklist                                                                                           | `reviewer`                                       |
| `dependency-install`       | Install + verify project dependencies                                                                                       | `scaffolder`, `builder`                          |
| `documentation`            | Produce README/architecture/API docs                                                                                        | `verifier`, `architect`                          |
| `error-recovery`           | Diagnose and recover from a failed step                                                                                     | `investigator`, `fixer`                          |
| `integration-testing`      | Write and run integration tests                                                                                             | `builder`, `verifier`                            |
| `language-toolchain-setup` | Pick the runtime version (Python `py -3.X`, Node) matching the project's declared constraint before installing dependencies | `scaffolder`, `builder`, `fixer`                 |
| `progress-tracking`        | Maintain BUILD.md findings + progress                                                                                       | All agents                                       |
| `scaffolding`              | Set up project structure, dependencies, git                                                                                 | `scaffolder`                                     |
| `tdd`                      | Strict test-first development                                                                                               | `builder`                                        |
| `work-verification`        | Confirm work before claiming done                                                                                           | All agents                                       |

## Adding a skill

1. Create `skills/<name>.md` with YAML frontmatter:

   ```markdown
   ---
   name: <skill-id>
   description: |
     One-paragraph description of what this skill is for and when to apply it.
   ---

   # <Title>

   <Methodology body — be explicit, reference rules, give examples>
   ```

2. Add a row above
3. Reference from any agent prompt that should use it

## Loading

Skills are loaded by `@factory5/brain` at runtime via the skill loader (`packages/brain/src/prompts.ts`'s `loadSkill(id)`). The loader scans the `skills/` directory plus user-specific overrides at `~/.factory5/skills/` and project-specific overrides at `<project>/.factory/skills/`.
