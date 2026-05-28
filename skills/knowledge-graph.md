<!-- skills/knowledge-graph.md -->
---
name: knowledge-graph
description: |
  How to use the project's living knowledge graph: read and update
  feature files in docs/knowledge/features/, record decisions in
  docs/knowledge/decisions/ when you deviate from the documented
  surface, and keep the graph valid so the validator accepts your
  task completion. Use during scaffolding, building, and fixing
  whenever you touch user-facing surface.
---

# Knowledge Graph

The project's `docs/knowledge/` directory is a graph. Each feature and
decision is a markdown file with structured front-matter. The
relationships between them (which task implemented which feature,
which decision modified which feature) live in front-matter array
fields. Read `docs/knowledge/_schema.md` for the canonical schema.

## When you start a task

1. Read your task's `featureIds` from the plan. These are the
   features your task is responsible for.
2. For each featureId, read `docs/knowledge/features/<id>.md`. Pay
   attention to:
   - The feature's `status:` — usually `documented` when you start
   - The body's "User-facing surface" and "Acceptance criteria"
   - `documented_in:` — the docs the user will read to find this
     feature
3. Read any `decisions:` referenced by the feature to understand
   prior judgment calls.

## When you complete a task

Before claiming the task is done, update the knowledge graph:

1. **Flip `status: documented → implemented`** in each feature file
   your task built.
2. **Set `implements: [<your-task-id>]`** in each feature file. Your
   task ID is in `.factory/plan.json`'s entry for your current task.
3. **Fill in documented stubs** — the architect may have seeded
   placeholder sections in README.md (marked `<!-- to be filled by
   scaffolder/builder -->`). Replace these with real content matching
   what you built.

## When you deviate from the documented surface

If you can't implement the feature exactly as documented (the spec
turned out to be wrong, the dependency doesn't support it, the user-
facing surface needs adjustment), do NOT silently change the code.
Record the decision:

1. Copy the decision template:
   ```bash
   cp docs/knowledge/_templates/decision.md \
      docs/knowledge/decisions/$(date +%Y-%m-%d)-<short-slug>.md
   ```
2. Fill in the placeholders. The `## Context`, `## Decision`,
   `## Consequences` sections are required.
3. Add the new decision's `id` to the affected feature file's
   `decisions: []` array.
4. Update `documented_in:` target files (README, modules.md) to match
   what you actually built. The docs and the code must agree.

## When you add a new feature mid-task

If your task discovers a need for a feature not in the seeded
`features/` directory (e.g., a small helper that becomes user-visible):

1. Copy the feature template:
   ```bash
   cp docs/knowledge/_templates/feature.md \
      docs/knowledge/features/<new-id>.md
   ```
2. Fill in the placeholders. Set `status: implemented`, set
   `implements: [<your-task-id>]`.
3. Add an entry to `docs/knowledge/modules.md` describing where this
   feature's code lives.

## Templates and schema are pre-existing

- Templates live at `docs/knowledge/_templates/feature.md` and
  `_templates/decision.md`. Copy them — do not write front-matter
  from scratch.
- Schema reference lives at `docs/knowledge/_schema.md`. Re-read it
  if you're unsure about a field.

## The validator will check your work

At task completion, `factory5 graph check` runs against your worktree.
It validates:
- Front-matter parses as YAML
- Required fields are present
- `documented_in:` anchors resolve to real files / headings
- For each feature in your task's `featureIds`, `status: implemented`
  with `implements: [<your-task-id>]` is set

If any check fails, your task is marked incomplete with structured
findings telling you exactly what to fix. Fix and complete normally —
do NOT skip the knowledge graph step.

## Rules

- Never write front-matter from scratch. Copy a template.
- Never silently deviate. Write a decision file.
- Never delete a feature file. Set `status: abandoned` with a
  decision explaining why.
- Never set `status: implemented` without `implements: [<task-id>]`.
- Always re-read the feature file BEFORE writing code, so you
  understand the contract.
- Always update `documented_in:` targets when you change the
  user-facing surface.
