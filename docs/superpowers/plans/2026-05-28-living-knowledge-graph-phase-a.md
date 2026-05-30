# Living Knowledge Graph — Phase A: Foundation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the foundation for the living knowledge graph: schema source-of-truth, templates, knowledge-graph skill, architect seeding, tasks↔features linkage, structured findings shape, and the schema+reference-integrity validator wired into worker/brain.

**Architecture:** Phase A establishes the data model + lightweight enforcement. The knowledge area at `docs/knowledge/` gains `features/` and `decisions/` subdirectories with structured front-matter. Findings get a new structured shape (category, location, why, fix, auto_fixable). A new `coherence-validator` package runs deterministic schema + reference checks at task completion and post-merge. Phase B will add doc-fiction + dead-code checks; Phase C adds the self-healing loop and workspace hygiene.

**Tech Stack:** TypeScript, Zod schemas, vitest, gray-matter (YAML front-matter parsing), better-sqlite3, Fastify, Astro.

**Spec:** `docs/superpowers/specs/2026-05-28-living-knowledge-graph-design.md`

---

## Section 1: Living Knowledge Graph Foundation

### Task 1: Create factory5 assets directory with schema file

**Files:**

- Create: `packages/brain/src/assets/_schema.md`
- Create: `packages/brain/src/assets/.gitkeep` (if directory needs git tracking)

**Spec reference:** Component 1 → "Schema source of truth"

- [ ] **Step 1: Create the assets directory**

```bash
mkdir -p packages/brain/src/assets
mkdir -p packages/brain/src/assets/_templates
```

- [ ] **Step 2: Create \_schema.md with the canonical schema reference**

```markdown
<!-- packages/brain/src/assets/_schema.md -->

# Knowledge Graph Schema (v1)

This file defines the node and edge kinds used in `docs/knowledge/`.
Both agents and the `factory5 graph check` validator read this file
as the source of truth.

## Node kinds

### `feature`

A user-visible capability the project provides. Lives at
`docs/knowledge/features/<id>.md`.

Required front-matter:

- `kind: feature`
- `id: <kebab-case>` (unique within project)
- `status: documented | implemented | superseded | abandoned`
- `documented_in: [<doc-path>#<anchor>, ...]` (at least one entry)

Optional front-matter:

- `implements: [<task-id>, ...]` — task IDs that built this feature
- `decisions: [<decision-id>, ...]` — decisions that affected this feature
- `derived_from: [<feature-id>, ...]` — parent features (sub-feature decomposition)
- `supersedes: <feature-id>` — feature this one replaced

### `decision`

A judgment call made during a build that modifies a feature's spec.
Lives at `docs/knowledge/decisions/<YYYY-MM-DD>-<slug>.md`.

Required front-matter:

- `kind: decision`
- `id: <YYYY-MM-DD>-<slug>`
- `date: <YYYY-MM-DD>`
- `made_by_task: <task-id>`
- `modifies: [<feature-id>, ...]` (at least one entry)

Required body sections:

- `## Context`
- `## Decision`
- `## Consequences`

Optional front-matter:

- `supersedes: <decision-id>` — decision this one replaced
- `follow_ups: [<feature-id>, ...]` — features deferred or filed as a result

## Edge kinds (front-matter array fields)

| Edge            | Source kind      | Target          | Direction                             |
| --------------- | ---------------- | --------------- | ------------------------------------- |
| `implements`    | feature          | task-id         | feature → was built by → task         |
| `documented_in` | feature          | doc-path#anchor | feature → described at → doc location |
| `modifies`      | decision         | feature-id      | decision → changed → feature          |
| `supersedes`    | decision/feature | id of same kind | newer → replaced → older              |
| `derived_from`  | feature          | feature-id      | child → parent                        |
| `decisions`     | feature          | decision-id     | feature → affected by → decisions     |
| `follow_ups`    | decision         | feature-id      | decision → spawned → features         |

## Status state machine
```

documented ─→ implemented ─→ superseded
│ │
└────→ abandoned ←─────┘

```

- `documented` — seeded by architect; no implementing task yet
- `implemented` — a builder task completed; `implements:` is populated
- `superseded` — replaced by another feature; `supersedes:` populated on the replacement
- `abandoned` — explicitly dropped without replacement; requires a `decisions:` entry explaining why

A feature MAY transition `documented → abandoned` directly (never built).
A feature MAY transition `implemented → superseded` (replaced by a better implementation).
A feature MAY NOT transition `superseded → implemented` (resurrect via a new feature with `supersedes:` pointing back).
```

- [ ] **Step 3: Commit**

```bash
git add packages/brain/src/assets/_schema.md
git commit -m "feat(15.13): seed knowledge graph schema reference file"
```

---

### Task 2: Create feature template

**Files:**

- Create: `packages/brain/src/assets/_templates/feature.md`

**Spec reference:** Component 1 → "Templates"

- [ ] **Step 1: Write the feature template**

```markdown
## <!-- packages/brain/src/assets/_templates/feature.md -->

kind: feature
id: <REPLACE-with-kebab-case-id>
status: documented
documented_in:

- <REPLACE-with-doc-path>#<REPLACE-with-anchor>

# Optional fields (uncomment as needed):

# implements: []

# decisions: []

# derived_from: []

# supersedes: <feature-id>

---

# Feature: <REPLACE with human-readable title>

<REPLACE with 1-3 paragraphs describing what this feature does from a
user's perspective. Focus on the contract, not the implementation.>

## User-facing surface

<REPLACE with the CLI command, API call, config option, or other
interface the user interacts with. Be specific — exact argument names,
exact YAML keys.>

## Acceptance criteria

- [ ] <REPLACE with a testable assertion about behavior>
- [ ] <REPLACE>

## Notes

<Optional — implementation hints, related features, things to avoid.>
```

- [ ] **Step 2: Commit**

```bash
git add packages/brain/src/assets/_templates/feature.md
git commit -m "feat(15.13): seed knowledge graph feature template"
```

---

### Task 3: Create decision template

**Files:**

- Create: `packages/brain/src/assets/_templates/decision.md`

**Spec reference:** Component 1 → "Templates"

- [ ] **Step 1: Write the decision template**

```markdown
## <!-- packages/brain/src/assets/_templates/decision.md -->

kind: decision
id: <REPLACE-with-YYYY-MM-DD-slug>
date: <REPLACE-with-YYYY-MM-DD>
made_by_task: <REPLACE-with-ULID>
modifies:

- <REPLACE-with-feature-id>

# Optional fields (uncomment as needed):

# supersedes: <decision-id>

# follow_ups: []

---

# Decision: <REPLACE with one-line summary>

## Context

<REPLACE: what was the spec/intent? What did the agent encounter that
required a judgment call?>

## Decision

<REPLACE: what was decided? Be concrete — names, paths, behaviors.>

## Consequences

<REPLACE: what changes as a result? Any features deferred, any docs
that need updating, any follow-ups to file?>
```

- [ ] **Step 2: Commit**

```bash
git add packages/brain/src/assets/_templates/decision.md
git commit -m "feat(15.13): seed knowledge graph decision template"
```

---

### Task 4: Create the knowledge-graph skill

**Files:**

- Create: `skills/knowledge-graph.md`

**Spec reference:** Component 1 → "How agents adopt it"

- [ ] **Step 1: Write the skill file**

````markdown
## <!-- skills/knowledge-graph.md -->

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
````

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

````

- [ ] **Step 2: Commit**

```bash
git add skills/knowledge-graph.md
git commit -m "feat(15.13): add knowledge-graph skill teaching the schema"
````

---

### Task 5: Wire knowledge-graph skill into agent registry

**Files:**

- Modify: `packages/brain/src/agents/registry.ts`

**Spec reference:** Component 1 → "A skill teaches the rules"

- [ ] **Step 1: Read the current registry**

Run: `head -100 packages/brain/src/agents/registry.ts`
Expected: see the agent entries with their `defaultSkills` arrays as quoted in the exploration report.

- [ ] **Step 2: Add knowledge-graph to scaffolder, builder, fixer**

Edit `packages/brain/src/agents/registry.ts`. Find each entry and append `'knowledge-graph'` to its `defaultSkills` array (last position):

```typescript
scaffolder: {
  role: 'scaffolder',
  category: 'planning',
  tools: ['Read', 'Write', 'Edit', 'Bash', 'Glob', ASK_USER_MCP_TOOL],
  defaultSkills: ['scaffolding', 'language-toolchain-setup', 'dependency-install', 'ask-user', 'knowledge-graph'],
  promptPath: 'scaffolder.md',
},
builder: {
  role: 'builder',
  category: 'deep',
  tools: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep', ASK_USER_MCP_TOOL],
  defaultSkills: ['tdd', 'language-toolchain-setup', 'progress-tracking', 'work-verification', 'ask-user', 'knowledge-graph'],
  promptPath: 'builder.md',
},
fixer: {
  role: 'fixer',
  category: 'reasoning',
  tools: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep', ASK_USER_MCP_TOOL],
  defaultSkills: ['error-recovery', 'tdd', 'language-toolchain-setup', 'ask-user', 'knowledge-graph'],
  promptPath: 'fixer.md',
},
```

- [ ] **Step 3: Build to verify the registry compiles**

Run: `pnpm --filter @factory5/brain build 2>&1 | tail -5`
Expected: Build success.

- [ ] **Step 4: Commit**

```bash
git add packages/brain/src/agents/registry.ts
git commit -m "feat(15.13): attach knowledge-graph skill to scaffolder/builder/fixer"
```

---

### Task 6: Update architect prompt to seed knowledge graph

**Files:**

- Modify: `prompts/agents/architect.md`

**Spec reference:** Component 1 → "Architect seeding"

- [ ] **Step 1: Read the current architect prompt**

Run: `cat prompts/agents/architect.md`
Identify the "Output shape" section (around line 63-68).

- [ ] **Step 2: Add the seeding instruction**

Append a new section after the "Rules" section (or before, depending on the file's structure). The full text to append:

````markdown
## Knowledge graph seeding

In addition to the four wiki pages (overview, modules, testing,
decisions), you MUST seed the project's knowledge graph:

### 1. Copy schema and templates

Copy these files verbatim from `<factory5-install>/packages/brain/src/assets/`
into `docs/knowledge/`:

- `_schema.md` → `docs/knowledge/_schema.md`
- `_templates/feature.md` → `docs/knowledge/_templates/feature.md`
- `_templates/decision.md` → `docs/knowledge/_templates/decision.md`

(These are static assets — copy them verbatim, do not modify.)

### 2. Enumerate features from modules.md

For each user-visible capability the project provides (based on
modules.md's per-module contracts), produce a `docs/knowledge/features/<id>.md`
file. Use `_templates/feature.md` as the starting shape. Set:

- `kind: feature`
- `id: <kebab-case-derived-from-feature-name>`
- `status: documented`
- `documented_in:` — list the locations that WILL describe this feature
  to users. Almost always: a section in `modules.md` (which you wrote)
  AND a section in `README.md` (which the scaffolder/builder will write)

Be liberal in what counts as a "feature" — anything a user can invoke,
configure, or rely on as a contract. CLI commands, API endpoints,
config keys, exported library functions all count.

### 3. Seed stub README

Create a `README.md` at the project root with the planned section
headings (Overview, Quick Start, Configuration, CLI Reference, etc.)
and explicit stub markers under each section:

```markdown
<!-- to be filled by scaffolder/builder -->
```
````

The headings must match the anchors referenced in your seeded
`features/*.md` `documented_in:` fields. Validator will fail at task
completion if anchors don't resolve.

### 4. Emit these in your output

Your `pages: []` output array should include:

- The four wiki pages (overview, modules, testing, decisions) — same as before
- `_schema.md` (slug: `_schema.md`, content: verbatim from assets)
- `_templates/feature.md` (slug: `_templates/feature.md`, content: verbatim)
- `_templates/decision.md` (slug: `_templates/decision.md`, content: verbatim)
- One entry per seeded feature file (slug: `features/<id>.md`, content: filled template)

Additionally, emit a top-level `readme` field in your output:

```json
{
  "pages": [...],
  "readme": "<README.md content with planned headings + stub markers>"
}
```

The brain will write this to the project root.

````

- [ ] **Step 3: Commit**

```bash
git add prompts/agents/architect.md
git commit -m "feat(15.13): architect seeds knowledge graph + stub README"
````

---

### Task 6.5: Brain consumes architect's readme + feature outputs

**Files:**

- Modify: `packages/brain/src/architect.ts` (or wherever architect output is parsed)
- Test: `packages/brain/src/architect.test.ts`

**Spec reference:** Component 1 → "Architect seeding" (step 3, stub README; step 4, output fields)

- [ ] **Step 1: Locate the architect output consumer**

Run: `grep -rn "pages" packages/brain/src/architect*.ts | head -20`
Identify the function that parses architect output (it currently reads `result.pages: [{slug, content}]` and writes each to `docs/knowledge/<slug>`).

- [ ] **Step 2: Read the current parser shape**

Look at the architect's response schema. It likely uses a zod schema like:

```typescript
const architectOutputSchema = z.object({
  pages: z.array(
    z.object({
      slug: z.string(),
      content: z.string(),
    }),
  ),
});
```

- [ ] **Step 3: Extend the schema to accept the new fields**

Update the architect output schema:

```typescript
const architectOutputSchema = z.object({
  pages: z.array(
    z.object({
      slug: z.string(),
      content: z.string(),
    }),
  ),
  /** Optional README content seeded with stub markers, written to <project>/README.md. */
  readme: z.string().optional(),
});
```

- [ ] **Step 4: Write the readme if present**

After the existing loop that writes pages to `docs/knowledge/<slug>`, add:

```typescript
if (parsed.readme !== undefined && parsed.readme.length > 0) {
  await writeFile(join(projectPath, 'README.md'), parsed.readme, 'utf8');
  log.info({ projectPath, bytes: parsed.readme.length }, 'architect: wrote stub README');
}
```

Note: pages with slugs like `_schema.md`, `_templates/feature.md`, `features/cli-run-command.md` all get written via the existing pages loop because the slug is the path under `docs/knowledge/`. No additional handling needed for those.

- [ ] **Step 5: Add a test**

```typescript
it('writes README when architect output includes the readme field', async () => {
  // Mock architect that returns { pages: [], readme: '# Project\n\n## Quick Start\n\n<!-- to be filled -->\n' }
  // Run the architect handler against a temp project dir
  // Assert: README.md exists at the project root with the expected content
});
```

- [ ] **Step 6: Build + test**

Run: `pnpm --filter @factory5/brain test -- --reporter=verbose -t "readme" 2>&1 | tail -10`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/brain/src/architect.ts packages/brain/src/architect.test.ts
git commit -m "feat(15.13): brain writes architect's stub README + seeded features"
```

---

### Task 7: Add featureIds field to taskSchema

**Files:**

- Modify: `packages/core/src/schemas.ts:273-309` (taskSchema)
- Test: `packages/core/src/schemas.test.ts`

**Spec reference:** Component 1 → "Tasks ↔ features linkage"

- [ ] **Step 1: Write failing tests**

Add to `packages/core/src/schemas.test.ts` (at end of the file, before any closing braces):

```typescript
describe('taskSchema — featureIds', () => {
  it('accepts featureIds as an array of strings', () => {
    const parsed = taskSchema.parse({
      id: '01HZZZZZZZZZZZZZZZZZZZZZZZ',
      planId: '01HZZZZZZZZZZZZZZZZZZZZZZZ',
      title: 'Build CLI',
      agent: 'builder',
      category: 'deep',
      inputs: { files: [], context: '' },
      expectedOutputs: { files: [], signals: [] },
      dependsOn: [],
      status: 'pending',
      attempts: 0,
      featureIds: ['cli-run-command', 'cli-validate-command'],
    });
    expect(parsed.featureIds).toEqual(['cli-run-command', 'cli-validate-command']);
  });

  it('defaults featureIds to empty array when absent', () => {
    const parsed = taskSchema.parse({
      id: '01HZZZZZZZZZZZZZZZZZZZZZZZ',
      planId: '01HZZZZZZZZZZZZZZZZZZZZZZZ',
      title: 'Build CLI',
      agent: 'builder',
      category: 'deep',
      inputs: { files: [], context: '' },
      expectedOutputs: { files: [], signals: [] },
      dependsOn: [],
      status: 'pending',
      attempts: 0,
    });
    expect(parsed.featureIds).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @factory5/core test -- --reporter=verbose -t "featureIds"`
Expected: FAIL — featureIds field not recognized.

- [ ] **Step 3: Add the field to taskSchema**

In `packages/core/src/schemas.ts` around line 273-309 (the `taskSchema` definition), add `featureIds` after `estimatedUsd`:

```typescript
export const taskSchema = z.object({
  id: ulidSchema,
  planId: ulidSchema,
  title: z.string().min(1),
  agent: agentRoleSchema,
  category: modelCategorySchema,
  inputs: z.object({
    files: z.array(z.string()),
    context: z.string(),
  }),
  expectedOutputs: z.object({
    files: z.array(z.string()),
    signals: z.array(z.string()),
  }),
  dependsOn: z.array(ulidSchema),
  status: taskStatusSchema,
  attempts: z.number().int().nonnegative(),
  worktreePath: z.string().optional(),
  result: taskResultSchema.optional(),
  maxTurns: z.number().int().positive().optional(),
  estimatedUsd: z.number().nonnegative().optional(),
  /**
   * Knowledge-graph features this task is responsible for implementing.
   * Read by the validator to verify the task updated each feature's
   * status: documented → implemented. Empty array (default) means
   * the task is not part of the knowledge graph workflow (e.g.,
   * pre-graph projects, infrastructure tasks). See ADR / spec
   * 2026-05-28-living-knowledge-graph-design.
   */
  featureIds: z.array(z.string()).default([]),
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @factory5/core test -- --reporter=verbose -t "featureIds"`
Expected: PASS.

- [ ] **Step 5: Build the workspace to verify downstream packages still compile**

Run: `pnpm build 2>&1 | tail -5`
Expected: build success across all packages.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/schemas.ts packages/core/src/schemas.test.ts
git commit -m "feat(15.13): add featureIds to taskSchema — task↔feature graph edge"
```

---

### Task 8: Update planner to emit featureIds

**Files:**

- Modify: `packages/brain/src/planner.ts:42` (plannerTaskSchema)
- Modify: `packages/brain/src/planner.ts:121-135` (task materialization)
- Test: `packages/brain/src/planner.test.ts`

**Spec reference:** Component 1 → "Tasks ↔ features linkage"

- [ ] **Step 1: Read current planner code**

Run: `sed -n '35,50p' packages/brain/src/planner.ts` to see plannerTaskSchema.
Run: `sed -n '115,140p' packages/brain/src/planner.ts` to see materialization.

- [ ] **Step 2: Write failing test**

Add to `packages/brain/src/planner.test.ts` (find the existing `describe('materialisePlannerTasks ...')` block):

```typescript
it('passes featureIds through when set', () => {
  const plannerTasks = [
    {
      title: 'Build CLI',
      agent: 'builder' as const,
      category: 'deep' as const,
      inputs: { files: [], context: 'Build the CLI.' },
      expectedOutputs: { files: ['etl/cli.py'], signals: [] },
      dependsOn: [],
      featureIds: ['cli-run-command'],
    },
  ];
  const planId = '01HZZZZZZZZZZZZZZZZZZZZZZZ';
  const tasks = materialisePlannerTasks(plannerTasks, planId);
  expect(tasks[0]?.featureIds).toEqual(['cli-run-command']);
});

it('defaults featureIds to empty array when planner omits the field', () => {
  const plannerTasks = [
    {
      title: 'Build CLI',
      agent: 'builder' as const,
      category: 'deep' as const,
      inputs: { files: [], context: 'Build the CLI.' },
      expectedOutputs: { files: ['etl/cli.py'], signals: [] },
      dependsOn: [],
    },
  ];
  const planId = '01HZZZZZZZZZZZZZZZZZZZZZZZ';
  const tasks = materialisePlannerTasks(plannerTasks, planId);
  expect(tasks[0]?.featureIds).toEqual([]);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @factory5/brain test -- --reporter=verbose -t "featureIds"`
Expected: FAIL — featureIds not in planner schema or not passed through.

- [ ] **Step 4: Add featureIds to plannerTaskSchema**

In `packages/brain/src/planner.ts` around line 42 (plannerTaskSchema), add `featureIds`:

```typescript
const plannerTaskSchema = z.object({
  title: z.string().min(1),
  agent: agentRoleSchema,
  category: modelCategorySchema,
  inputs: z.object({
    files: z.array(z.string()),
    context: z.string(),
  }),
  expectedOutputs: z.object({
    files: z.array(z.string()),
    signals: z.array(z.string()),
  }),
  dependsOn: z.array(z.number().int().nonnegative()).default([]),
  maxTurns: z.number().int().positive().optional(),
  estimatedUsd: z.number().nonnegative().optional(),
  /** Features this task is responsible for; the planner reads docs/knowledge/features/*.md to determine. */
  featureIds: z.array(z.string()).default([]),
});
```

- [ ] **Step 5: Pass featureIds through materialization**

In `packages/brain/src/planner.ts` around line 121-135 (the task materialization), add `featureIds` to the constructed Task:

```typescript
const task: Task = {
  id: taskIds[i] as string,
  planId,
  title: t.title,
  agent: t.agent as AgentRole,
  category: clamped,
  inputs: t.inputs,
  expectedOutputs: t.expectedOutputs,
  dependsOn,
  status: 'pending',
  attempts: 0,
  featureIds: t.featureIds,
};
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter @factory5/brain test -- --reporter=verbose -t "featureIds"`
Expected: PASS.

- [ ] **Step 7: Build + lint**

Run: `pnpm build && pnpm lint 2>&1 | tail -3`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add packages/brain/src/planner.ts packages/brain/src/planner.test.ts
git commit -m "feat(15.13): planner emits featureIds per task — feeds graph validator"
```

---

## Section 2: Structured Findings

### Task 9: Define new structured finding schema

**Files:**

- Modify: `packages/core/src/schemas.ts:208-226` (findingSchema)
- Test: `packages/core/src/schemas.test.ts`

**Spec reference:** Component 2 → "Structured Findings"

- [ ] **Step 1: Write failing tests**

Add to `packages/core/src/schemas.test.ts`:

```typescript
describe('findingSchema — structured shape', () => {
  it('accepts a fully structured finding', () => {
    const parsed = findingSchema.parse({
      id: 'F042',
      source: 'builder',
      target: 'etl/cli.py',
      severity: 'high',
      status: 'OPEN',
      description: 'legacy field — present for backward compat',
      createdAt: '2026-05-28T12:00:00Z',
      // New structured fields:
      category: 'doc-fiction',
      location: {
        file: 'README.md',
        line: 42,
        anchor: '#cli-reference',
      },
      title: 'CLI Reference documents pipeline_name arg that does not exist',
      why: 'Users following the README will hit "unexpected extra argument" error.',
      suggested_fix:
        'Either implement the optional arg or remove it from README.md §CLI Reference.',
      auto_fixable: false,
    });
    expect(parsed.category).toBe('doc-fiction');
    expect(parsed.location?.file).toBe('README.md');
    expect(parsed.auto_fixable).toBe(false);
  });

  it('accepts legacy finding shape (backward compat)', () => {
    const parsed = findingSchema.parse({
      id: 'F001',
      source: 'scaffolder',
      target: 'README.md',
      severity: 'LOW',
      status: 'OPEN',
      description: 'Old-style finding with just a description.',
      createdAt: '2026-05-24T12:00:00Z',
    });
    expect(parsed.description).toBe('Old-style finding with just a description.');
    expect(parsed.category).toBeUndefined();
    expect(parsed.title).toBeUndefined();
  });

  it('accepts location with frontmatter_field for graph findings', () => {
    const parsed = findingSchema.parse({
      id: 'F050',
      source: 'builder',
      target: 'docs/knowledge/features/cli-run-command.md',
      severity: 'medium',
      status: 'OPEN',
      description: 'graph orphan',
      createdAt: '2026-05-28T12:00:00Z',
      category: 'graph-orphan',
      location: {
        file: 'docs/knowledge/features/cli-run-command.md',
        frontmatter_field: 'implements',
      },
      title: 'Feature status=implemented but implements: is empty',
      why: 'Without implements link, traceability to build commit is lost.',
      suggested_fix: 'Set implements: [<this-task-id>]',
      auto_fixable: true,
    });
    expect(parsed.location?.frontmatter_field).toBe('implements');
  });

  it('rejects invalid category enum', () => {
    expect(() =>
      findingSchema.parse({
        id: 'F001',
        source: 'builder',
        target: 'x',
        severity: 'low',
        status: 'OPEN',
        description: 'x',
        createdAt: '2026-05-28T12:00:00Z',
        category: 'invalid-category',
      }),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @factory5/core test -- --reporter=verbose -t "findingSchema — structured"`
Expected: FAIL — fields like `category`, `location`, `title`, `why`, `suggested_fix`, `auto_fixable` not recognized.

- [ ] **Step 3: Extend findingSchema with the structured fields**

In `packages/core/src/schemas.ts` find `findingSchema` (lines ~208-226). Add the location schema first, then extend findingSchema:

```typescript
// Add BEFORE findingSchema definition:

/**
 * Category of a structured finding. Drives the self-healing loop's
 * decision on what to do with the finding.
 *
 * Graph-related categories (graph-orphan, graph-schema-error) are
 * usually auto-fixable. Code-quality (doc-fiction, dead-code,
 * half-implementation) need human or fixer-agent judgment.
 */
export const findingCategorySchema = z.enum([
  'graph-orphan',
  'graph-schema-error',
  'doc-fiction',
  'dead-code',
  'half-implementation',
  'test-failure',
  'build-failure',
  'other',
]);
export type FindingCategory = z.infer<typeof findingCategorySchema>;

/**
 * Locator for a finding. All fields optional except `file` — different
 * finding categories populate different combinations:
 *   - graph findings use file + frontmatter_field
 *   - doc-fiction findings use file + anchor + line
 *   - dead-code findings use file + line
 *   - test-failure findings use file + line
 */
export const findingLocationSchema = z.object({
  file: z.string().min(1),
  line: z.number().int().positive().optional(),
  anchor: z.string().optional(),
  frontmatter_field: z.string().optional(),
});
export type FindingLocation = z.infer<typeof findingLocationSchema>;
```

Then extend `findingSchema`:

```typescript
export const findingSchema = z.object({
  id: z.string().regex(/^F\d{3,}$/, 'Finding IDs are F001, F002, ... (project-scoped)'),
  source: agentRoleSchema,
  target: z.string().min(1),
  severity: severitySchema,
  status: findingStatusSchema,
  description: z.string().min(1),
  resolution: z.string().optional(),
  createdAt: isoDateTimeSchema,
  resolvedAt: isoDateTimeSchema.optional(),
  advisory: z.boolean().optional(),
  // Tier 15.13 — structured shape additions (all optional for backward compat).
  category: findingCategorySchema.optional(),
  location: findingLocationSchema.optional(),
  title: z.string().min(1).optional(),
  why: z.string().min(1).optional(),
  suggested_fix: z.string().min(1).optional(),
  auto_fixable: z.boolean().optional(),
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @factory5/core test -- --reporter=verbose -t "findingSchema"`
Expected: PASS (the existing tests still pass too, since the new fields are optional).

- [ ] **Step 5: Build + lint**

Run: `pnpm build && pnpm lint 2>&1 | tail -3`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/schemas.ts packages/core/src/schemas.test.ts
git commit -m "feat(15.13): extend findingSchema with structured fields (category/location/why/fix)"
```

---

### Task 10: Add structured-finding helper to wiki findings storage

**Files:**

- Modify: `packages/wiki/src/findings.ts`
- Test: `packages/wiki/src/findings.test.ts` (or create if absent)

**Spec reference:** Component 2 → "Structured Findings"

- [ ] **Step 1: Read current findings.ts**

Run: `cat packages/wiki/src/findings.ts | head -100`
Identify the `addFinding` function signature.

- [ ] **Step 2: Write failing test**

Add to `packages/wiki/src/findings.test.ts` (create if it doesn't exist; mirror existing test style):

```typescript
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { addFinding, listFindings } from './findings.js';

describe('addFinding — structured fields', () => {
  let projectPath: string;

  beforeEach(async () => {
    projectPath = await mkdtemp(join(tmpdir(), 'factory5-findings-test-'));
  });

  afterEach(async () => {
    await rm(projectPath, { recursive: true, force: true }).catch(() => undefined);
  });

  it('persists category, location, title, why, suggested_fix, auto_fixable', async () => {
    const f = await addFinding(projectPath, {
      source: 'builder',
      target: 'etl/cli.py',
      severity: 'high',
      description: 'Legacy description still required.',
      category: 'doc-fiction',
      location: { file: 'README.md', line: 42, anchor: '#cli' },
      title: 'CLI doc mismatch',
      why: 'Users hit unexpected-argument error.',
      suggested_fix: 'Remove the arg from README or implement it.',
      auto_fixable: false,
    });
    expect(f.category).toBe('doc-fiction');
    expect(f.location?.file).toBe('README.md');
    expect(f.title).toBe('CLI doc mismatch');

    const listed = await listFindings(projectPath, { status: 'OPEN' });
    expect(listed[0]?.title).toBe('CLI doc mismatch');
  });

  it('persists a legacy finding without the new fields', async () => {
    const f = await addFinding(projectPath, {
      source: 'scaffolder',
      target: 'README.md',
      severity: 'LOW',
      description: 'Old-style finding.',
    });
    expect(f.category).toBeUndefined();
    expect(f.location).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @factory5/wiki test -- --reporter=verbose -t "addFinding"`
Expected: FAIL — addFinding doesn't accept the new optional fields, or doesn't persist them.

- [ ] **Step 4: Update addFinding to accept and persist new fields**

In `packages/wiki/src/findings.ts`, find the `addFinding` function. Look at its current signature (around line 144). Update the input type to allow the new optional fields, and persist them:

Find this:

```typescript
export async function addFinding(
  projectPath: string,
  input: {
    source: AgentRole;
    target: string;
    severity: Severity;
    description: string;
    resolution?: string;
    advisory?: boolean;
  },
  registry?: FindingRegistryBinding,
): Promise<Finding> {
```

Change to:

```typescript
export async function addFinding(
  projectPath: string,
  input: {
    source: AgentRole;
    target: string;
    severity: Severity;
    description: string;
    resolution?: string;
    advisory?: boolean;
    // Tier 15.13 — structured fields (optional for backward compat).
    category?: FindingCategory;
    location?: FindingLocation;
    title?: string;
    why?: string;
    suggested_fix?: string;
    auto_fixable?: boolean;
  },
  registry?: FindingRegistryBinding,
): Promise<Finding> {
```

Then in the body where the new finding object is constructed (look for `const finding: Finding = { ... }` — likely around line 160-180), spread the new fields conditionally:

```typescript
const finding: Finding = {
  id,
  source: input.source,
  target: input.target,
  severity: input.severity,
  status: 'OPEN',
  description: input.description,
  createdAt: nowIso(),
  ...(input.resolution !== undefined && { resolution: input.resolution }),
  ...(input.advisory !== undefined && { advisory: input.advisory }),
  // Structured fields (only set if provided).
  ...(input.category !== undefined && { category: input.category }),
  ...(input.location !== undefined && { location: input.location }),
  ...(input.title !== undefined && { title: input.title }),
  ...(input.why !== undefined && { why: input.why }),
  ...(input.suggested_fix !== undefined && { suggested_fix: input.suggested_fix }),
  ...(input.auto_fixable !== undefined && { auto_fixable: input.auto_fixable }),
};
```

Also add the imports at the top of findings.ts:

```typescript
import type { Finding, FindingCategory, FindingLocation, ... } from '@factory5/core';
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @factory5/wiki test -- --reporter=verbose -t "addFinding"`
Expected: PASS.

- [ ] **Step 6: Build + lint**

Run: `pnpm build && pnpm lint 2>&1 | tail -3`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add packages/wiki/src/findings.ts packages/wiki/src/findings.test.ts
git commit -m "feat(15.13): wiki addFinding accepts + persists structured fields"
```

---

### Task 11: Update IPC schemas for structured findings

**Files:**

- Modify: `packages/ipc/src/schemas.ts` (search for `apiV1FindingSchema` or similar)
- Test: existing IPC test suite

**Spec reference:** Component 2 → "Structured Findings"

- [ ] **Step 1: Locate the IPC finding schema**

Run: `grep -n "finding" packages/ipc/src/schemas.ts | head -10`
The IPC layer typically re-exports or wraps the core findingSchema for HTTP transport.

- [ ] **Step 2: Verify IPC schemas re-export from core**

Look at the file. If the IPC schemas import from `@factory5/core`, the structured fields are already available (zod schema composition is transitive). Confirm by:

Run: `grep -A 2 "findingSchema" packages/ipc/src/schemas.ts`

- [ ] **Step 3: If IPC has its own finding shape, sync it**

If IPC has a parallel schema (e.g., `apiV1FindingResponseSchema`), update it to include the new optional fields:

```typescript
// Whichever schema represents findings on the wire:
export const apiV1FindingSchema = findingSchema.extend({
  // No-op: zod-extend the core schema. New fields propagate automatically.
});
// Or if it's a different shape, add the fields manually:
// category: findingCategorySchema.optional(),
// location: findingLocationSchema.optional(),
// title: z.string().min(1).optional(),
// why: z.string().min(1).optional(),
// suggested_fix: z.string().min(1).optional(),
// auto_fixable: z.boolean().optional(),
```

If IPC just re-exports `findingSchema` from core, no changes are needed and you can skip the modification.

- [ ] **Step 4: Run IPC tests**

Run: `pnpm --filter @factory5/ipc test 2>&1 | tail -5`
Expected: all existing tests pass.

- [ ] **Step 5: Commit if changes were made**

```bash
git add packages/ipc/src/schemas.ts
git commit -m "feat(15.13): IPC finding schemas pick up structured fields"
```

If no changes were needed, skip this step and proceed to Task 12.

---

### Task 12: Frontend renders structured fields with legacy fallback

**Files:**

- Modify: `apps/factory-web/src/pages/directives/detail.astro` (find the findings rendering section)

**Spec reference:** Component 2 → "Structured Findings"

- [ ] **Step 1: Locate the findings rendering in detail.astro**

Run: `grep -n "finding" apps/factory-web/src/pages/directives/detail.astro | head -20`
Identify the section where findings are rendered as DOM.

- [ ] **Step 2: Add structured-vs-legacy renderer**

In the client-side JS section of detail.astro, find the `renderFinding` function (or the inline DOM code that renders a single finding). Replace with:

```typescript
function renderFinding(f: any): HTMLElement {
  const el = document.createElement('div');
  el.className = `finding finding--${f.severity?.toLowerCase() ?? 'low'}`;

  // Detect structured vs legacy by presence of `title` field.
  const isStructured = typeof f.title === 'string' && f.title.length > 0;

  if (isStructured) {
    el.innerHTML = `
      <div class="finding-header">
        <span class="finding-id">${escapeHtml(f.id)}</span>
        <span class="finding-category">${escapeHtml(f.category ?? 'other')}</span>
        <span class="finding-severity">${escapeHtml(f.severity)}</span>
        ${f.auto_fixable ? '<span class="finding-autofix">auto-fixable</span>' : ''}
      </div>
      <h4 class="finding-title">${escapeHtml(f.title)}</h4>
      <div class="finding-location">${escapeHtml(formatLocation(f.location))}</div>
      <div class="finding-why"><strong>Why:</strong> ${escapeHtml(f.why ?? '')}</div>
      <div class="finding-fix"><strong>Fix:</strong> ${escapeHtml(f.suggested_fix ?? '')}</div>
    `;
  } else {
    // Legacy fallback: render the description as-is.
    el.innerHTML = `
      <div class="finding-header">
        <span class="finding-id">${escapeHtml(f.id)}</span>
        <span class="finding-severity">${escapeHtml(f.severity)}</span>
      </div>
      <div class="finding-target">${escapeHtml(f.target)}</div>
      <div class="finding-description">${escapeHtml(f.description)}</div>
    `;
  }
  return el;
}

function formatLocation(loc: any): string {
  if (!loc) return '';
  let s = loc.file;
  if (loc.line) s += `:${loc.line}`;
  if (loc.anchor) s += ` (${loc.anchor})`;
  if (loc.frontmatter_field) s += ` [front-matter: ${loc.frontmatter_field}]`;
  return s;
}
```

- [ ] **Step 3: Add CSS for the structured fields**

Find the `<style>` block in `apps/factory-web/src/layouts/Dashboard.astro` (or detail.astro's style section) and append:

```css
.finding-header {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-bottom: 6px;
}
.finding-category {
  font-family: var(--f-body);
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  padding: 1px 6px;
  border: 1px solid var(--hairline);
  border-radius: 2px;
  color: var(--mute);
}
.finding-autofix {
  font-family: var(--f-body);
  font-size: 10px;
  color: var(--acid);
  border: 1px solid color-mix(in srgb, var(--acid) 40%, transparent);
  padding: 1px 6px;
  border-radius: 2px;
}
.finding-title {
  margin: 4px 0;
  font-size: 14px;
}
.finding-location {
  font-family: var(--f-mono);
  font-size: 11px;
  color: var(--mute);
  margin-bottom: 6px;
}
.finding-why,
.finding-fix {
  font-size: 13px;
  line-height: 1.5;
  margin-top: 4px;
}
```

- [ ] **Step 4: Rebuild the web app**

Run: `pnpm --filter factory-web build 2>&1 | tail -5`
Expected: build success.

- [ ] **Step 5: Commit**

```bash
git add apps/factory-web/src/pages/directives/detail.astro apps/factory-web/src/layouts/Dashboard.astro
git commit -m "feat(15.13): frontend renders structured findings with legacy fallback"
```

---

## Section 3: Coherence Validator (schema + reference integrity)

### Task 13: Scaffold the coherence-validator package

**Files:**

- Create: `packages/coherence-validator/package.json`
- Create: `packages/coherence-validator/tsconfig.json`
- Create: `packages/coherence-validator/README.md`
- Create: `packages/coherence-validator/src/index.ts`

**Spec reference:** Component 3 → "Coherence Validator"

- [ ] **Step 1: Create package.json**

```json
{
  "name": "@factory5/coherence-validator",
  "version": "0.0.1",
  "private": true,
  "description": "Validates the project's knowledge graph: schema, reference integrity, doc-fiction, dead-code (phases A/B).",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsup src/index.ts --format esm --dts --sourcemap --clean",
    "test": "vitest run",
    "lint": "eslint src"
  },
  "dependencies": {
    "@factory5/core": "workspace:*",
    "@factory5/logger": "workspace:*",
    "gray-matter": "^4.0.3",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "tsup": "^8.0.0",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 2: Create tsconfig.json extending base**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: Create README.md**

````markdown
# @factory5/coherence-validator

Validates the project's knowledge graph at `docs/knowledge/`:

- **Schema validity** — front-matter parses; required fields present
- **Reference integrity** — `documented_in:` anchors resolve; `implements:`
  task IDs match the current plan
- **Doc-fiction** (Phase B) — README code blocks actually run
- **Dead-code** (Phase B) — public symbols with no caller

Used by the worker at task completion and the brain at post-merge +
final-verification phases.

## Programmatic API

```typescript
import { validateKnowledgeGraph } from '@factory5/coherence-validator';
const result = await validateKnowledgeGraph({ projectPath, planPath, taskId });
// result.findings contains structured findings if any checks failed
```
````

## CLI

```bash
factory5 graph check [<projectPath>]
```

See spec at `docs/superpowers/specs/2026-05-28-living-knowledge-graph-design.md`.

````

- [ ] **Step 4: Create stub src/index.ts**

```typescript
/**
 * @factory5/coherence-validator — entry point.
 *
 * Validates the project's knowledge graph. Phase A ships schema +
 * reference integrity checks; Phase B adds doc-fiction + dead-code.
 */

export { validateKnowledgeGraph, type ValidationResult } from './validator.js';
````

- [ ] **Step 5: Install workspace dependencies**

Run: `pnpm install 2>&1 | tail -5`
Expected: new package picked up by pnpm workspaces.

- [ ] **Step 6: Commit**

```bash
git add packages/coherence-validator/
git commit -m "feat(15.13): scaffold @factory5/coherence-validator package"
```

---

### Task 14: Implement schema validity check

**Files:**

- Create: `packages/coherence-validator/src/schema-check.ts`
- Create: `packages/coherence-validator/src/schema-check.test.ts`

**Spec reference:** Component 3 → "Schema validity"

- [ ] **Step 1: Write failing tests**

Create `packages/coherence-validator/src/schema-check.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { checkFeatureFile, checkDecisionFile } from './schema-check.js';

describe('checkFeatureFile', () => {
  it('accepts a valid feature file', () => {
    const content = `---
kind: feature
id: cli-run-command
status: documented
documented_in:
  - README.md#cli-reference
---

# Feature: CLI run command

Body...
`;
    const findings = checkFeatureFile('docs/knowledge/features/cli-run-command.md', content);
    expect(findings).toEqual([]);
  });

  it('rejects missing kind field', () => {
    const content = `---
id: cli-run-command
status: documented
documented_in:
  - README.md#cli
---

Body
`;
    const findings = checkFeatureFile('features/x.md', content);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]?.category).toBe('graph-schema-error');
    expect(findings[0]?.location?.frontmatter_field).toBe('kind');
  });

  it('rejects invalid status enum', () => {
    const content = `---
kind: feature
id: x
status: invalid-status
documented_in:
  - README.md#x
---

Body
`;
    const findings = checkFeatureFile('features/x.md', content);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]?.location?.frontmatter_field).toBe('status');
  });

  it('rejects missing documented_in', () => {
    const content = `---
kind: feature
id: x
status: documented
---

Body
`;
    const findings = checkFeatureFile('features/x.md', content);
    expect(findings.some((f) => f.location?.frontmatter_field === 'documented_in')).toBe(true);
  });

  it('rejects malformed YAML front-matter', () => {
    const content = `---
kind: feature
id: x: y: z  <-- broken yaml
---

Body
`;
    const findings = checkFeatureFile('features/x.md', content);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]?.category).toBe('graph-schema-error');
  });
});

describe('checkDecisionFile', () => {
  it('accepts a valid decision file', () => {
    const content = `---
kind: decision
id: 2026-05-28-drop-pipeline-name
date: 2026-05-28
made_by_task: 01HZZZZZZZZZZZZZZZZZZZZZZZ
modifies:
  - cli-run-command
---

# Decision: Drop pipeline_name arg

## Context
...

## Decision
...

## Consequences
...
`;
    const findings = checkDecisionFile('decisions/2026-05-28-drop.md', content);
    expect(findings).toEqual([]);
  });

  it('rejects missing required body sections', () => {
    const content = `---
kind: decision
id: 2026-05-28-x
date: 2026-05-28
made_by_task: 01HZZZZZZZZZZZZZZZZZZZZZZZ
modifies:
  - cli-run-command
---

# Decision: x

## Context
...
`;
    // Missing ## Decision and ## Consequences sections
    const findings = checkDecisionFile('decisions/x.md', content);
    expect(findings.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @factory5/coherence-validator test 2>&1 | tail -10`
Expected: FAIL — schema-check.ts doesn't exist yet.

- [ ] **Step 3: Implement schema-check.ts**

```typescript
/**
 * Schema validity check for knowledge-graph files.
 *
 * Validates front-matter shape (YAML parseability, required fields,
 * enum values) and required body sections (for decisions). Produces
 * structured findings keyed to specific front-matter fields.
 */

import matter from 'gray-matter';

import type { Finding, FindingCategory, FindingLocation } from '@factory5/core';

const VALID_FEATURE_STATUSES = ['documented', 'implemented', 'superseded', 'abandoned'];
const REQUIRED_DECISION_SECTIONS = ['Context', 'Decision', 'Consequences'];

/** Partial finding — missing fields populated by the validator entry point. */
export interface PartialFinding {
  category: FindingCategory;
  severity: 'high' | 'medium' | 'low';
  title: string;
  why: string;
  suggested_fix: string;
  auto_fixable: boolean;
  location: FindingLocation;
}

export function checkFeatureFile(filePath: string, content: string): PartialFinding[] {
  const findings: PartialFinding[] = [];

  let parsed: matter.GrayMatterFile<string>;
  try {
    parsed = matter(content);
  } catch (err) {
    findings.push({
      category: 'graph-schema-error',
      severity: 'high',
      title: 'Malformed YAML front-matter',
      why: `Cannot parse front-matter: ${(err as Error).message}`,
      suggested_fix: 'Fix the YAML syntax. Use _templates/feature.md as a reference.',
      auto_fixable: false,
      location: { file: filePath, frontmatter_field: 'front-matter' },
    });
    return findings;
  }

  const data = parsed.data as Record<string, unknown>;

  // kind field
  if (data['kind'] !== 'feature') {
    findings.push({
      category: 'graph-schema-error',
      severity: 'high',
      title: data['kind'] === undefined ? 'Missing required field: kind' : 'Invalid kind value',
      why: 'Feature files must have `kind: feature` in front-matter.',
      suggested_fix: 'Set `kind: feature` in front-matter.',
      auto_fixable: true,
      location: { file: filePath, frontmatter_field: 'kind' },
    });
  }

  // id field
  if (typeof data['id'] !== 'string' || data['id'].length === 0) {
    findings.push({
      category: 'graph-schema-error',
      severity: 'high',
      title: 'Missing required field: id',
      why: 'Feature files must have a kebab-case `id:` in front-matter.',
      suggested_fix: 'Set `id: <kebab-case>` matching the filename (without .md).',
      auto_fixable: false,
      location: { file: filePath, frontmatter_field: 'id' },
    });
  }

  // status field
  const status = data['status'];
  if (typeof status !== 'string' || !VALID_FEATURE_STATUSES.includes(status)) {
    findings.push({
      category: 'graph-schema-error',
      severity: 'high',
      title:
        status === undefined
          ? 'Missing required field: status'
          : `Invalid status: ${String(status)}`,
      why: `Feature status must be one of: ${VALID_FEATURE_STATUSES.join(', ')}.`,
      suggested_fix: 'Set `status: documented` (or another valid value).',
      auto_fixable: true,
      location: { file: filePath, frontmatter_field: 'status' },
    });
  }

  // documented_in field
  const documentedIn = data['documented_in'];
  if (!Array.isArray(documentedIn) || documentedIn.length === 0) {
    findings.push({
      category: 'graph-schema-error',
      severity: 'high',
      title: 'Missing or empty documented_in',
      why: 'Feature files must have at least one documented_in entry.',
      suggested_fix: 'Set `documented_in: [README.md#section, ...]`.',
      auto_fixable: false,
      location: { file: filePath, frontmatter_field: 'documented_in' },
    });
  }

  return findings;
}

export function checkDecisionFile(filePath: string, content: string): PartialFinding[] {
  const findings: PartialFinding[] = [];

  let parsed: matter.GrayMatterFile<string>;
  try {
    parsed = matter(content);
  } catch (err) {
    findings.push({
      category: 'graph-schema-error',
      severity: 'high',
      title: 'Malformed YAML front-matter',
      why: `Cannot parse front-matter: ${(err as Error).message}`,
      suggested_fix: 'Fix the YAML syntax. Use _templates/decision.md as a reference.',
      auto_fixable: false,
      location: { file: filePath, frontmatter_field: 'front-matter' },
    });
    return findings;
  }

  const data = parsed.data as Record<string, unknown>;

  // kind field
  if (data['kind'] !== 'decision') {
    findings.push({
      category: 'graph-schema-error',
      severity: 'high',
      title: 'Decision file missing or wrong kind',
      why: 'Decision files must have `kind: decision`.',
      suggested_fix: 'Set `kind: decision`.',
      auto_fixable: true,
      location: { file: filePath, frontmatter_field: 'kind' },
    });
  }

  // Required fields: id, date, made_by_task, modifies
  for (const field of ['id', 'date', 'made_by_task']) {
    if (typeof data[field] !== 'string' || (data[field] as string).length === 0) {
      findings.push({
        category: 'graph-schema-error',
        severity: 'high',
        title: `Missing required field: ${field}`,
        why: `Decision files must have a non-empty \`${field}:\`.`,
        suggested_fix: `Set \`${field}: <value>\` per the template.`,
        auto_fixable: false,
        location: { file: filePath, frontmatter_field: field },
      });
    }
  }

  const modifies = data['modifies'];
  if (!Array.isArray(modifies) || modifies.length === 0) {
    findings.push({
      category: 'graph-schema-error',
      severity: 'high',
      title: 'Missing or empty modifies',
      why: 'Decisions must list at least one feature they modify.',
      suggested_fix: 'Set `modifies: [<feature-id>, ...]`.',
      auto_fixable: false,
      location: { file: filePath, frontmatter_field: 'modifies' },
    });
  }

  // Required body sections
  const body = parsed.content;
  for (const section of REQUIRED_DECISION_SECTIONS) {
    const headingRegex = new RegExp(`^##\\s+${section}\\s*$`, 'm');
    if (!headingRegex.test(body)) {
      findings.push({
        category: 'graph-schema-error',
        severity: 'medium',
        title: `Missing required section: ## ${section}`,
        why: 'Decision files must have Context, Decision, and Consequences sections.',
        suggested_fix: `Add a \`## ${section}\` heading with content.`,
        auto_fixable: false,
        location: { file: filePath, anchor: `#${section.toLowerCase()}` },
      });
    }
  }

  return findings;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @factory5/coherence-validator test 2>&1 | tail -10`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/coherence-validator/src/schema-check.ts packages/coherence-validator/src/schema-check.test.ts
git commit -m "feat(15.13): coherence validator — schema validity check"
```

---

### Task 15: Implement reference integrity check

**Files:**

- Create: `packages/coherence-validator/src/reference-check.ts`
- Create: `packages/coherence-validator/src/reference-check.test.ts`

**Spec reference:** Component 3 → "Reference integrity"

- [ ] **Step 1: Write failing tests**

Create `packages/coherence-validator/src/reference-check.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { checkReferences } from './reference-check.js';

describe('checkReferences', () => {
  it('passes when all documented_in anchors resolve', () => {
    const docs = new Map([['README.md', '# Project\n\n## CLI Reference\n\nDoc text.']]);
    const feature = {
      filePath: 'features/cli.md',
      frontmatter: {
        kind: 'feature',
        id: 'cli',
        status: 'documented',
        documented_in: ['README.md#cli-reference'],
      },
    };
    const findings = checkReferences([feature], docs, { taskIds: [] });
    expect(findings).toEqual([]);
  });

  it('fails when documented_in points to a missing file', () => {
    const docs = new Map<string, string>();
    const feature = {
      filePath: 'features/cli.md',
      frontmatter: {
        kind: 'feature',
        id: 'cli',
        status: 'documented',
        documented_in: ['README.md#cli'],
      },
    };
    const findings = checkReferences([feature], docs, { taskIds: [] });
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]?.title).toContain('README.md');
  });

  it('fails when documented_in anchor does not exist in target file', () => {
    const docs = new Map([['README.md', '# Project\n\n## Installation\n']]);
    const feature = {
      filePath: 'features/cli.md',
      frontmatter: {
        kind: 'feature',
        id: 'cli',
        status: 'documented',
        documented_in: ['README.md#cli-reference'],
      },
    };
    const findings = checkReferences([feature], docs, { taskIds: [] });
    expect(findings.some((f) => f.title.includes('cli-reference'))).toBe(true);
  });

  it('fails when implements references unknown task ID', () => {
    const docs = new Map([['README.md', '## CLI Reference']]);
    const feature = {
      filePath: 'features/cli.md',
      frontmatter: {
        kind: 'feature',
        id: 'cli',
        status: 'implemented',
        documented_in: ['README.md#cli-reference'],
        implements: ['01XBOGUSTASKID'],
      },
    };
    const findings = checkReferences([feature], docs, { taskIds: ['01HVALIDTASK1234567890'] });
    expect(findings.some((f) => f.title.includes('implements'))).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @factory5/coherence-validator test 2>&1 | tail -10`
Expected: FAIL — reference-check.ts doesn't exist.

- [ ] **Step 3: Implement reference-check.ts**

```typescript
/**
 * Reference integrity check for knowledge-graph files.
 *
 * For each feature, verifies:
 *   - documented_in: <file>#<anchor> resolves to a real file with a
 *     real heading-derived anchor
 *   - implements: <task-id> matches a task in the current plan
 *
 * Anchors are slugified from heading text (lowercased, hyphenated)
 * matching GitHub's standard markdown anchor convention.
 */

import type { PartialFinding } from './schema-check.js';

export interface FeatureEntry {
  filePath: string;
  frontmatter: Record<string, unknown>;
}

export interface ReferenceCheckContext {
  taskIds: readonly string[];
}

const SLUG_NON_ALPHANUMERIC = /[^a-z0-9]+/g;

function slugify(headingText: string): string {
  return headingText.toLowerCase().replace(SLUG_NON_ALPHANUMERIC, '-').replace(/^-|-$/g, '');
}

function extractAnchors(markdown: string): Set<string> {
  const anchors = new Set<string>();
  const headingRe = /^#{1,6}\s+(.+?)\s*$/gm;
  let m: RegExpExecArray | null;
  while ((m = headingRe.exec(markdown)) !== null) {
    anchors.add(slugify(m[1] ?? ''));
  }
  return anchors;
}

export function checkReferences(
  features: readonly FeatureEntry[],
  docs: ReadonlyMap<string, string>,
  ctx: ReferenceCheckContext,
): PartialFinding[] {
  const findings: PartialFinding[] = [];

  // Pre-compute anchors per doc file.
  const anchorsByFile = new Map<string, Set<string>>();
  for (const [file, content] of docs) {
    anchorsByFile.set(file, extractAnchors(content));
  }
  const taskIdSet = new Set(ctx.taskIds);

  for (const feature of features) {
    const fm = feature.frontmatter;

    // Check documented_in references.
    const documentedIn = fm['documented_in'];
    if (Array.isArray(documentedIn)) {
      for (const entry of documentedIn) {
        if (typeof entry !== 'string') continue;
        const [file, anchor] = entry.split('#', 2);
        if (file === undefined || file.length === 0) continue;

        if (!docs.has(file)) {
          findings.push({
            category: 'graph-schema-error',
            severity: 'high',
            title: `Referenced doc file does not exist: ${file}`,
            why: `Feature documented_in points to ${file}, which doesn't exist in the project.`,
            suggested_fix: `Either create ${file} or remove the entry from documented_in.`,
            auto_fixable: false,
            location: { file: feature.filePath, frontmatter_field: 'documented_in' },
          });
          continue;
        }

        if (anchor !== undefined && anchor.length > 0) {
          const anchors = anchorsByFile.get(file) ?? new Set();
          if (!anchors.has(anchor)) {
            findings.push({
              category: 'graph-schema-error',
              severity: 'high',
              title: `Anchor #${anchor} not found in ${file}`,
              why: `Feature documented_in references #${anchor} but ${file} has no heading that slugifies to that anchor.`,
              suggested_fix: `Add a matching heading to ${file}, or correct the anchor in this feature's documented_in.`,
              auto_fixable: false,
              location: { file: feature.filePath, frontmatter_field: 'documented_in' },
            });
          }
        }
      }
    }

    // Check implements task IDs.
    const implementsField = fm['implements'];
    if (Array.isArray(implementsField)) {
      for (const taskId of implementsField) {
        if (typeof taskId !== 'string') continue;
        if (!taskIdSet.has(taskId)) {
          findings.push({
            category: 'graph-orphan',
            severity: 'medium',
            title: `implements references unknown task ID: ${taskId}`,
            why: `This feature's implements: list references a task ID that does not exist in the current plan.`,
            suggested_fix: 'Remove the stale task ID or update to the correct one.',
            auto_fixable: false,
            location: { file: feature.filePath, frontmatter_field: 'implements' },
          });
        }
      }
    }
  }

  return findings;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @factory5/coherence-validator test 2>&1 | tail -10`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/coherence-validator/src/reference-check.ts packages/coherence-validator/src/reference-check.test.ts
git commit -m "feat(15.13): coherence validator — reference integrity check"
```

---

### Task 16: Implement validator entry point

**Files:**

- Create: `packages/coherence-validator/src/validator.ts`
- Create: `packages/coherence-validator/src/validator.test.ts`

**Spec reference:** Component 3 → "Validator entry point"

- [ ] **Step 1: Write failing test**

Create `packages/coherence-validator/src/validator.test.ts`:

```typescript
import { mkdir, writeFile, rm, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { validateKnowledgeGraph } from './validator.js';

describe('validateKnowledgeGraph', () => {
  let projectPath: string;

  beforeEach(async () => {
    projectPath = await mkdtemp(join(tmpdir(), 'factory5-validator-test-'));
    await mkdir(join(projectPath, 'docs', 'knowledge', 'features'), { recursive: true });
    await mkdir(join(projectPath, 'docs', 'knowledge', 'decisions'), { recursive: true });
  });

  afterEach(async () => {
    await rm(projectPath, { recursive: true, force: true }).catch(() => undefined);
  });

  it('returns ok=true and empty findings for a valid graph', async () => {
    await writeFile(join(projectPath, 'README.md'), '# Project\n\n## CLI Reference\n\nThe CLI.\n');
    await writeFile(
      join(projectPath, 'docs', 'knowledge', 'features', 'cli.md'),
      `---
kind: feature
id: cli
status: documented
documented_in:
  - README.md#cli-reference
---

# Feature: CLI
`,
    );
    const result = await validateKnowledgeGraph({ projectPath, taskIds: [] });
    expect(result.ok).toBe(true);
    expect(result.findings).toEqual([]);
  });

  it('returns ok=false and findings for an invalid graph', async () => {
    await writeFile(
      join(projectPath, 'docs', 'knowledge', 'features', 'cli.md'),
      `---
kind: feature
id: cli
status: documented
documented_in:
  - README.md#nonexistent
---

Body
`,
    );
    // Note: README.md does not exist
    const result = await validateKnowledgeGraph({ projectPath, taskIds: [] });
    expect(result.ok).toBe(false);
    expect(result.findings.length).toBeGreaterThan(0);
  });

  it('handles a project with no knowledge area gracefully (relaxed mode)', async () => {
    // No docs/knowledge directory at all
    await rm(join(projectPath, 'docs'), { recursive: true, force: true });
    const result = await validateKnowledgeGraph({ projectPath, taskIds: [] });
    expect(result.ok).toBe(true);
    expect(result.findings).toEqual([]);
    expect(result.skippedReason).toBe('no-knowledge-area');
  });

  it('validates a decision file with all required sections', async () => {
    await writeFile(
      join(projectPath, 'docs', 'knowledge', 'decisions', '2026-05-28-test.md'),
      `---
kind: decision
id: 2026-05-28-test
date: 2026-05-28
made_by_task: 01HZZZZZZZZZZZZZZZZZZZZZZZ
modifies:
  - some-feature
---

# Decision: Test

## Context
Why we needed this.

## Decision
What we chose.

## Consequences
What happens next.
`,
    );
    const result = await validateKnowledgeGraph({ projectPath, taskIds: [] });
    expect(result.ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @factory5/coherence-validator test 2>&1 | tail -10`
Expected: FAIL — validator.ts doesn't exist.

- [ ] **Step 3: Implement validator.ts**

```typescript
/**
 * Coherence validator entry point.
 *
 * Walks docs/knowledge/, runs schema and reference checks, returns
 * structured findings. Caller (worker or brain) decides what to do
 * with them.
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';

import matter from 'gray-matter';

import type { Finding, FindingCategory } from '@factory5/core';
import { createLogger } from '@factory5/logger';

import { checkDecisionFile, checkFeatureFile, type PartialFinding } from './schema-check.js';
import { checkReferences, type FeatureEntry } from './reference-check.js';

const log = createLogger('coherence-validator');

export interface ValidateOptions {
  projectPath: string;
  taskIds: readonly string[];
}

export interface ValidationResult {
  ok: boolean;
  findings: PartialFinding[];
  skippedReason?: 'no-knowledge-area';
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function listMarkdownFiles(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir);
    return entries.filter((e) => e.endsWith('.md') && !e.startsWith('_')).map((e) => join(dir, e));
  } catch {
    return [];
  }
}

async function collectDocsForReferenceCheck(projectPath: string): Promise<Map<string, string>> {
  const docs = new Map<string, string>();
  const candidates = ['README.md', 'docs/knowledge/modules.md', 'docs/knowledge/overview.md'];
  for (const rel of candidates) {
    const abs = join(projectPath, rel);
    if (await fileExists(abs)) {
      docs.set(rel, await readFile(abs, 'utf8'));
    }
  }
  return docs;
}

export async function validateKnowledgeGraph(opts: ValidateOptions): Promise<ValidationResult> {
  const knowledgeDir = join(opts.projectPath, 'docs', 'knowledge');
  if (!(await fileExists(knowledgeDir))) {
    return { ok: true, findings: [], skippedReason: 'no-knowledge-area' };
  }

  const allFindings: PartialFinding[] = [];
  const featureEntries: FeatureEntry[] = [];

  // Schema check: features
  const featureFiles = await listMarkdownFiles(join(knowledgeDir, 'features'));
  for (const filePath of featureFiles) {
    const rel = relative(opts.projectPath, filePath).split('\\').join('/');
    const content = await readFile(filePath, 'utf8');
    const schemaFindings = checkFeatureFile(rel, content);
    allFindings.push(...schemaFindings);

    // Collect for reference check (only if schema passed)
    if (schemaFindings.length === 0) {
      try {
        const parsed = matter(content);
        featureEntries.push({ filePath: rel, frontmatter: parsed.data });
      } catch {
        // Already reported by schema check
      }
    }
  }

  // Schema check: decisions
  const decisionFiles = await listMarkdownFiles(join(knowledgeDir, 'decisions'));
  for (const filePath of decisionFiles) {
    const rel = relative(opts.projectPath, filePath).split('\\').join('/');
    const content = await readFile(filePath, 'utf8');
    allFindings.push(...checkDecisionFile(rel, content));
  }

  // Reference integrity check
  const docs = await collectDocsForReferenceCheck(opts.projectPath);
  allFindings.push(...checkReferences(featureEntries, docs, { taskIds: opts.taskIds }));

  log.debug(
    {
      projectPath: opts.projectPath,
      featureCount: featureFiles.length,
      decisionCount: decisionFiles.length,
      findingCount: allFindings.length,
    },
    'coherence-validator: complete',
  );

  return { ok: allFindings.length === 0, findings: allFindings };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @factory5/coherence-validator test 2>&1 | tail -10`
Expected: PASS.

- [ ] **Step 5: Build the package**

Run: `pnpm --filter @factory5/coherence-validator build 2>&1 | tail -5`
Expected: build success, dist/ produced.

- [ ] **Step 6: Commit**

```bash
git add packages/coherence-validator/src/validator.ts packages/coherence-validator/src/validator.test.ts
git commit -m "feat(15.13): coherence validator entry point (validateKnowledgeGraph)"
```

---

### Task 17: Wire validator into worker post-task

**Files:**

- Modify: `packages/worker/src/run-worker.ts:735` (the area after listChangedFiles, before cleanupWorktree)
- Modify: `packages/worker/package.json` (add @factory5/coherence-validator dep)
- Test: `packages/worker/src/run-worker.test.ts`

**Spec reference:** Component 3 → "Where the validator runs — Post-task"

- [ ] **Step 1: Add coherence-validator as a worker dependency**

In `packages/worker/package.json`, add to `dependencies`:

```json
"@factory5/coherence-validator": "workspace:*",
```

Run: `pnpm install 2>&1 | tail -3`
Expected: install succeeds.

- [ ] **Step 2: Read the current run-worker.ts target area**

Run: `sed -n '730,775p' packages/worker/src/run-worker.ts`
Confirm the structure: `durationMs`, `filesChanged`, then `persistFindings/persistResolutions`, then `cleanupWorktree`.

- [ ] **Step 3: Add validator invocation between listChangedFiles and cleanupWorktree**

In `packages/worker/src/run-worker.ts`, find the section starting at line ~735. Add the validator call after `filesChanged` is computed and after persistFindings/persistResolutions, but BEFORE the cleanupWorktree block. Insert:

```typescript
// First, add the import at the top of the file (around line 50):
import { validateKnowledgeGraph } from '@factory5/coherence-validator';

// Then, in runTooling(), insert AFTER persistResolutions completes but BEFORE
// the wasAborted/desiredOutcome block (~line 752):

// Tier 15.13 — knowledge graph schema + reference integrity check.
// Only runs for tool-using tasks that touched the knowledge area OR
// declare featureIds (strict mode). Failures convert success → failure
// and preserve the worktree for the fixer to attempt repair.
let graphFindings: PartialFinding[] = [];
if (error === undefined && opts.task.featureIds.length > 0) {
  const planTaskIds = await readPlanTaskIds(opts.projectPath).catch(() => []);
  const validation = await validateKnowledgeGraph({
    projectPath: worktree.path,
    taskIds: planTaskIds,
  });
  if (!validation.ok) {
    graphFindings = validation.findings;
    error = `coherence-validator: ${validation.findings.length} findings`;
    log.warn(
      { taskId: opts.task.id, findingCount: validation.findings.length },
      'worker: knowledge graph validation failed',
    );
  }
}
```

Add the `readPlanTaskIds` helper near the top of the file (outside any function):

```typescript
import { readFile as fsReadFile } from 'node:fs/promises';

async function readPlanTaskIds(projectPath: string): Promise<string[]> {
  try {
    const planPath = join(projectPath, '.factory', 'plan.json');
    const raw = await fsReadFile(planPath, 'utf8');
    const parsed = JSON.parse(raw) as { tasks?: Array<{ id?: string }> };
    return (parsed.tasks ?? [])
      .map((t) => t.id)
      .filter((id): id is string => typeof id === 'string');
  } catch {
    return [];
  }
}
```

Then update the result construction at the bottom of `runTooling()` to merge graphFindings into the result:

```typescript
// At the point where `result: TaskResult = { ... }` is constructed,
// add graphFindings into findingsRaised by converting them through
// the wiki's addFinding (so they get IDs):
for (const pf of graphFindings) {
  const persisted = await addFinding(opts.projectPath, {
    source: opts.task.agent,
    target: pf.location.file,
    severity: pf.severity === 'high' ? 'HIGH' : pf.severity === 'medium' ? 'MEDIUM' : 'LOW',
    description: pf.title,
    category: pf.category,
    location: pf.location,
    title: pf.title,
    why: pf.why,
    suggested_fix: pf.suggested_fix,
    auto_fixable: pf.auto_fixable,
  });
  findingIds.push(persisted.id);
}
```

Note: `findingIds` is the existing array populated by `persistFindings`. The graph findings get appended.

- [ ] **Step 4: Build + run existing tests to verify wiring doesn't break anything**

Run: `pnpm build && pnpm --filter @factory5/worker test 2>&1 | tail -10`
Expected: build success; existing tests pass.

The validator's unit-level behavior is covered comprehensively in `packages/coherence-validator/src/validator.test.ts` (Task 16). A full end-to-end worker integration test requires the worker's complete mock infrastructure (mock provider, mock worktree, mock registry) which is heavy. Phase A's verification of the wiring is:

- Worker compiles with the new import + call site (covered by `pnpm build`)
- Validator's own tests still pass (covered by Task 16)
- The manual end-to-end check in Task 19 step 2 exercises the full path

If a regression appears, the worker test suite's existing happy-path tests will fail (because they don't set `featureIds`, the validator is skipped, and they still pass — confirming the relaxed path works). A dedicated worker integration test for the strict path can be added in Phase B alongside the brain integration work.

- [ ] **Step 5: Commit**

```bash
git add packages/worker/src/run-worker.ts packages/worker/package.json packages/worker/src/run-worker.test.ts
git commit -m "feat(15.13): worker runs coherence validator post-task when featureIds set"
```

---

### Task 18: Create factory5 graph check CLI command

**Files:**

- Create: `packages/cli/src/commands/graph-check.ts`
- Modify: `packages/cli/src/commands/index.ts` (register the command)
- Modify: `packages/cli/package.json` (add @factory5/coherence-validator dep)

**Spec reference:** Component 3 → "Coherence Validator CLI"

- [ ] **Step 1: Add dependency**

In `packages/cli/package.json`, add to `dependencies`:

```json
"@factory5/coherence-validator": "workspace:*",
```

Run: `pnpm install 2>&1 | tail -3`

- [ ] **Step 2: Create the command file**

```typescript
// packages/cli/src/commands/graph-check.ts
import { resolve } from 'node:path';

import { Command } from 'commander';

import { validateKnowledgeGraph } from '@factory5/coherence-validator';
import { createLogger } from '@factory5/logger';

const log = createLogger('cli.graph-check');

export function registerGraphCheckCommand(parent: Command): void {
  const graph = parent.command('graph').description('Operate on the project knowledge graph');

  graph
    .command('check')
    .description('Validate the project knowledge graph (schema + reference integrity)')
    .argument('[projectPath]', 'Project root path (defaults to cwd)', process.cwd())
    .action(async (projectPath: string) => {
      const abs = resolve(projectPath);
      log.info({ projectPath: abs }, 'graph check: starting');

      const result = await validateKnowledgeGraph({ projectPath: abs, taskIds: [] });

      if (result.skippedReason === 'no-knowledge-area') {
        process.stdout.write('No knowledge area at docs/knowledge/ — nothing to check.\n');
        process.exit(0);
      }

      if (result.ok) {
        process.stdout.write('Knowledge graph: OK\n');
        process.exit(0);
      }

      process.stdout.write(`Knowledge graph: ${result.findings.length} findings\n\n`);
      for (const f of result.findings) {
        process.stdout.write(
          `[${f.severity.toUpperCase()}] ${f.category}: ${f.title}\n` +
            `  Location: ${f.location.file}${f.location.line ? `:${f.location.line}` : ''}${f.location.frontmatter_field ? ` [${f.location.frontmatter_field}]` : ''}${f.location.anchor ? ` (${f.location.anchor})` : ''}\n` +
            `  Why: ${f.why}\n` +
            `  Fix: ${f.suggested_fix}\n\n`,
        );
      }
      process.exit(1);
    });
}
```

- [ ] **Step 3: Register the command in the CLI entry**

In `packages/cli/src/commands/index.ts` (or wherever commands are registered), add:

```typescript
import { registerGraphCheckCommand } from './graph-check.js';

// In the function that wires up all commands:
registerGraphCheckCommand(program);
```

- [ ] **Step 4: Build and smoke test**

Run: `pnpm --filter @factory5/cli build && node packages/cli/dist/index.js graph check --help`
Expected: usage text printed showing the new subcommand.

- [ ] **Step 5: Smoke test against pythonetl**

Run: `node packages/cli/dist/index.js graph check "C:\Users\Momo\factory5-workspace\pythonetl"`
Expected: "No knowledge area at docs/knowledge/ — nothing to check." (since pythonetl doesn't have the new graph yet; this confirms the relaxed-mode path works).

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/commands/graph-check.ts packages/cli/src/commands/index.ts packages/cli/package.json
git commit -m "feat(15.13): add factory5 graph check CLI command"
```

---

### Task 19: End-to-end Phase A verification

- [ ] **Step 1: Full build + lint + test**

Run: `pnpm build && pnpm lint && pnpm test 2>&1 | tail -20`
Expected: all clean. Document any pre-existing failures (planner.test.ts maxTurns may still fail — pre-existing).

- [ ] **Step 2: Verify feature file authoring works end-to-end**

Create a manual test in a scratch directory:

```bash
mkdir -p /tmp/factory5-graph-test/docs/knowledge/features
cp packages/brain/src/assets/_schema.md /tmp/factory5-graph-test/docs/knowledge/
cp packages/brain/src/assets/_templates/feature.md /tmp/factory5-graph-test/docs/knowledge/features/test-feature.md
# Hand-edit test-feature.md filling in id/status/documented_in.
node packages/cli/dist/index.js graph check /tmp/factory5-graph-test
```

Expected: validator runs; if you reference a non-existent file in `documented_in:`, it reports the issue.

- [ ] **Step 3: Verify schema test coverage**

Run: `pnpm --filter @factory5/coherence-validator test -- --coverage 2>&1 | tail -15`
Expected: schema-check.ts and reference-check.ts at high coverage.

- [ ] **Step 4: Commit Phase A completion marker**

```bash
git commit --allow-empty -m "chore(15.13): Phase A foundation complete — knowledge graph schema + validator wired"
```

---

## Phase A coverage check (self-review against spec)

Verify before handoff to Phase B:

- [x] Component 1: Schema file shipped (`_schema.md`) — Task 1
- [x] Component 1: Templates shipped (`_templates/feature.md`, `_templates/decision.md`) — Tasks 2, 3
- [x] Component 1: `knowledge-graph` skill created — Task 4
- [x] Component 1: Skill wired into scaffolder/builder/fixer — Task 5
- [x] Component 1: Architect prompt updated to seed features + stub README — Task 6
- [x] Component 1: Brain consumes architect's new outputs (readme + features) — Task 6.5
- [x] Component 1: `featureIds` field on taskSchema — Task 7
- [x] Component 1: Planner emits `featureIds` — Task 8
- [x] Component 2: Structured fields on findingSchema — Task 9
- [x] Component 2: Wiki addFinding accepts/persists structured fields — Task 10
- [x] Component 2: IPC schemas re-export new fields — Task 11
- [x] Component 2: Frontend renders structured fields with legacy fallback — Task 12
- [x] Component 3 (schema check): coherence-validator package scaffolded — Task 13
- [x] Component 3 (schema check): schema-check.ts implemented — Task 14
- [x] Component 3 (reference check): reference-check.ts implemented — Task 15
- [x] Component 3: validator.ts entry point — Task 16
- [x] Component 3: wired into worker post-task — Task 17
- [x] Component 3: `factory5 graph check` CLI — Task 18

**Deferred to Phase B:**

- Post-merge validator wiring in brain (waits for self-healing loop integration)
- Doc-fiction programmatic check (engine + python.json config)
- Dead-code scan
- Coherence-reviewer agent

**Deferred to Phase C:**

- Self-healing loop wiring around the validator's findings
- Workspace hygiene (`factory5 cleanup`, abandoned worktree detection)
