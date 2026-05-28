# Living Knowledge Graph for Project Coherence

*Created: 2026-05-28*
*Status: APPROVED*

## Problem

The pythonetl build surfaced a class of failures that factory5's current pipeline doesn't catch:

1. **README is fiction.** The Quick Start example documented `pyetl run <config> [pipeline_name]` but the implementation only accepts `config_path`. YAML config example used `url:` for SQL extractors but the code expects `dsn:`. Tests passed; build was marked complete; the documented surface didn't work.

2. **Dead code shipped silently.** `Pipeline.register_pipeline`, `get_pipeline`, `list_pipelines` exist in code but nothing populates `_pipelines`. The other half of the README's `[pipeline_name]` argument — an unfinished feature with no caller anywhere in the build.

3. **Half-honored contracts.** `stop_on_error` docstring said it controls whether the pipeline short-circuits, but extractor and loader errors always short-circuit regardless of the flag.

4. **Opaque operator messages.** Findings are free-form strings, escalation questions look like raw model output. The operator has to interpret factory5's output rather than act on it.

5. **Workspace state accumulates.** Failed/abandoned worktrees from prior runs remain on disk forever. Operator can't tell what's "live" code vs. dead-end branches.

The deep cause: **factory5's definition of "complete" is too narrow.** It checks "imports work + tests pass" but not "the spec is honored, docs match code, no half-finished features, no dead code." Drift between the initial knowledge area and the actual built code accumulates throughout the build and is never reconciled.

## Design philosophy

**Continuous coherence beats forced realignment.**

The wrong move is to detect drift at the end of a build and force the code back to the original spec. Drift isn't a bug — it's a signal that an agent encountered something the spec didn't quite fit and made a judgment call. The right answer is to **record those decisions as they happen**, so the knowledge area evolves with the build and there is no end-state drift to reconcile.

The mechanism is a **living knowledge graph**: graph-shaped markdown docs where each feature, decision, and module is a file, and relationships (implements, modifies, supersedes, documented_in) are explicit front-matter fields. The graph is emergent from the file structure — no database, no new tooling — but the structure is hard to break and easy to query.

Agents work in a pre-seeded knowledge area, follow a small schema taught by a skill, copy from templates instead of writing front-matter from scratch, and a post-task validator catches schema violations before the task can complete. The graph is native to how agents already operate (Read/Write/Edit on markdown), with structure added at exactly the spots where structure matters.

## Architecture overview

### The knowledge area is a graph

```
docs/knowledge/
  _schema.md                         # canonical schema reference
  _templates/
    feature.md                       # template for new feature nodes
    decision.md                      # template for new decision nodes
  overview.md                        # project goal (existing)
  modules.md                         # module surface (existing)
  testing.md                         # testing strategy (existing)
  decisions.md                       # high-level decisions index (existing)
  features/                          # NEW: one file per feature
    cli-run-command.md
    pipeline-from-config.md
    ...
  decisions/                         # NEW: one file per decision
    2026-05-28-drop-pipeline-name.md
    ...
```

**Nodes** are markdown files with `kind:` in their front-matter. **Edges** are front-matter array fields whose values are node IDs or file paths. The file system IS the graph; no separate database.

### Node kinds

| Kind | What it represents | Lives at |
|---|---|---|
| `feature` | A user-visible capability the project provides | `features/<id>.md` |
| `decision` | A judgment call made during a build that modifies the spec | `decisions/<YYYY-MM-DD>-<slug>.md` |
| `module-spec` | The intended shape of a code module (the spec for `etl/cli.py`, etc.) | embedded sections within `modules.md` for now; future: own files |
| `goal` | The project's overall intent | `overview.md` (single node per project) |

### Edge kinds (front-matter arrays)

- `implements: [<task-id>]` — the task ID that built this feature (filled in by builder when complete)
- `documented_in: [<doc-path>#<anchor>]` — where this feature is described to users
- `modifies: [<feature-id>]` — for decisions, what feature this decision changes
- `supersedes: [<id>]` — for decisions or features, what was replaced
- `derived_from: [<feature-id>]` — feature decomposition (sub-features point at parent)
- `decisions: [<decision-id>]` — for features, the decisions that affected this feature
- `follow_ups: [<feature-id>]` — for decisions, features deferred or filed as a result

### Lifecycle: how a feature evolves

1. **Architect seeds** the feature file at project start: `status: documented`, no `implements:` yet.
2. **Builder picks up** the feature when assigned a task that should implement it.
3. **Builder writes code**, updates the feature file's `status: documented → implemented`, sets `implements: [<this-task-id>]`.
4. **If builder deviates** from the documented surface, builder creates a `decisions/<date>-<slug>.md` file describing what changed and why, and adds the decision's ID to the feature's `decisions: []` array. If the feature surface changes, builder also updates `documented_in:` target files (README, modules.md).
5. **Validator runs** at task completion. Confirms front-matter is well-formed, `implements:` task ID matches the current task, and all `documented_in:` anchors exist in their target files.

If the builder ignores any of step 3-4, the validator fails the task with a structured finding telling it what to fix.

## Component 1: Living Knowledge Graph

### Schema source of truth

A single file at `docs/knowledge/_schema.md` defines the node kinds, their required fields, and the edge kinds. Both the `knowledge-graph` skill (which agents read) and the `factory5 graph check` validator (which enforces) read this file. The schema lives in the project, not in factory5's code — projects can extend it, schema changes are git-tracked, and agents see the schema in their context.

Required fields per kind:

**`feature`**:
- `kind: feature` (literal)
- `id: <kebab-case>` (unique within the project)
- `status: documented | implemented | superseded | abandoned`
- `documented_in: [...]` (at least one doc location)
- Optional: `implements: [...]`, `decisions: [...]`, `derived_from: [...]`, `supersedes: <id>`

**`decision`**:
- `kind: decision` (literal)
- `id: <YYYY-MM-DD>-<slug>` (date-prefixed)
- `date: <YYYY-MM-DD>`
- `made_by_task: <task-id>`
- `modifies: [...]` (at least one feature ID)
- Body must have sections: `## Context`, `## Decision`, `## Consequences`
- Optional: `supersedes: <id>`, `follow_ups: [...]`

### Templates

`docs/knowledge/_templates/feature.md` and `_templates/decision.md` are pre-filled markdown files with all required front-matter fields present (with placeholder values) and section headers stubbed out. Agents are taught (via the skill) to copy these instead of writing from scratch.

### Architect seeding

The architect agent's existing job (per `prompts/agents/architect.md`) is to produce `docs/knowledge/overview.md`, `modules.md`, `testing.md`, `decisions.md` from the project request. Extended job:

1. Also create `_schema.md` and `_templates/`. These ship as fixed factory5 assets — the architect copies them into the project.
2. Enumerate the planned features from `modules.md` and produce a `features/<id>.md` file for each, in `status: documented`, with `documented_in:` pointing at the relevant `modules.md` section.

The planner agent's job stays the same — it produces `plan.json` task definitions. The connection between tasks and features is established when the builder updates `implements:` on completion.

## Component 2: Structured Findings

Findings today are free-form strings in `findings.json`. New schema:

```json
{
  "id": "F042",
  "category": "graph-orphan | graph-schema-error | doc-fiction | dead-code | half-implementation | test-failure | build-failure | other",
  "severity": "blocker | high | medium | low",
  "status": "open | resolved | superseded",
  "source": "validator | verifier | reviewer | builder | external",
  "location": {
    "file": "docs/knowledge/features/cli-run-command.md",
    "anchor": "front-matter",
    "line": 7
  },
  "title": "Feature claims status=implemented but no implements task ID",
  "why": "Without the implements link, we can't verify the code actually exists or trace it back to a build commit.",
  "suggested_fix": "Set implements: [<this-task-id>] in front-matter.",
  "auto_fixable": true,
  "raised_at": "2026-05-28T...",
  "raised_by_task": "01KSQAC3G0..."
}
```

Free-form `description` is replaced by `title + why + suggested_fix`. `auto_fixable: true/false` drives the self-healing loop.

The IPC schema (`packages/ipc/src/schemas.ts`) gains the new finding shape; legacy findings parse via a migration adapter (read old `description` string into `title`, set other fields to defaults). Frontend renders the structured form; legacy findings render in fallback prose mode.

### Operator-facing messages

Escalation questions get the same shape — `title + why + options[]` instead of free-form prose. The brain's escalation message (`escalation answered: skip <reason text>`) gets templated: `{title, reason, decision, options_considered}`.

## Component 3: Coherence Validator

A new CLI subcommand: `factory5 graph check [<projectPath>]`. Runs deterministic checks against the knowledge area:

| Check | What it catches |
|---|---|
| **Schema validity** | Front-matter parses as YAML; required fields present; values match enums. |
| **Reference integrity** | Every `documented_in: <file>#<anchor>` resolves to a real anchor in a real file. Every `implements: <task-id>` matches a task in the current `plan.json`. |
| **Status coherence** | Features marked `status: implemented` have `implements: [<task-id>]` set. Decisions exist for status changes that aren't purely additive. |
| **Doc-fiction** | Symbols/commands mentioned in README/docs but absent in code. (Catches the README-claims-pipeline_name case.) |
| **Dead code** | Exported symbols in code with no caller outside their own module/tests and not declared as a feature surface. (Catches the unwired Pipeline.register_pipeline case.) |

Each check emits structured findings via the schema in Component 2. Auto-fixable categories: `graph-schema-error` (most), `graph-orphan` (most). Not auto-fixable: `doc-fiction`, `dead-code`, `half-implementation` — these need human judgment or fixer-agent reasoning.

### Where the validator runs

Three trigger points:

1. **Post-task** in `runTooling()` (`packages/worker/src/run-worker.ts`), after the agent's stream completes but before `cleanupWorktree()`. Operates on the worktree. If validation fails, the task is marked incomplete with findings; the agent has the chance to fix and retry within the same task budget.

2. **Pre-merge** in the brain's pool dispatcher, after a successful task but before the merge to main. Catches cross-task issues (e.g., feature A's decision referenced feature B, but feature B's status never flipped).

3. **Final verification** as the last gate before marking a directive complete. Runs after all tasks merge. Surfaces remaining doc-fiction and dead-code findings that only become detectable once all code is integrated.

### Programmatic doc-fiction check

For Python (initially):
- Parse README code blocks tagged ```python, ```yaml, ```bash, etc.
- For ```yaml under a "Quick Start" / "Configuration" / "Example" heading: validate against the project's actual schema parser. Failure = doc-fiction finding.
- For ```bash containing `<binary> <args>`: spawn the binary in a temp env (the assessor-env), capture output. If non-zero exit + the README claims this works, that's a doc-fiction finding.

This is per-runtime; Python is the v1 target. Node/Go/Rust extend later.

### Semantic doc-fiction check

For prose claims that aren't executable (e.g., "the CLI supports an optional pipeline_name argument"):
- A `coherence-reviewer` agent (new agent role) reads README + features/*.md + the actual code module(s)
- Produces findings for assertions in docs that don't have corresponding implementation

Runs as the final verification gate. Uses the existing read-only agent infrastructure (no worktree, single `provider.call()`).

## Component 4: Self-Healing Loop

The brain's failure handling becomes finding-aware:

**Current**: task fails → directive parks blocked → operator escalation.

**New**:
1. Task fails (or finishes with open findings from the validator).
2. Brain partitions findings into `auto_fixable: true` and `auto_fixable: false`.
3. For auto-fixable findings: dispatch a `fixer` agent with the structured findings as input. Up to N attempts (default 3, configurable per-project via `metadata.maxFixerAttempts`).
4. If findings remain after N attempts, escalate to the operator with a **structured summary**: what was tried, what remains, what options the operator has.
5. Operator's options also come structured: "Resolve this finding manually," "Skip this finding," "Abort the directive," "Adjust budget and retry."

**Try-then-ask policy** is the default. The brain decides "tried enough" via the attempt counter.

### Fixer agent input

The fixer gets a structured task:
```json
{
  "kind": "fix-findings",
  "findings": [<structured finding>, ...],
  "context_files": ["<paths relevant to the findings>"],
  "constraints": "Apply fixes inline. Each fix must be the smallest change that resolves the finding. Do not refactor adjacent code."
}
```

The fixer's `defaultSkills` grow to include the new `knowledge-graph` skill (so it can update front-matter when needed).

## Component 5: Workspace Hygiene

### Abandoned worktree detection

A new helper queries:
```
worktrees on disk WHERE task NOT IN (current plan tasks)
  OR (task.status IN failed/aborted/cancelled AND merged_as IS NULL)
```

Produces a list of `{path, branch, task_title, abandoned_since}`.

### Operator surfaces

1. **CLI**: `factory5 cleanup` lists abandoned worktrees and prompts for action (remove, keep, archive).
2. **Directive detail page**: a "Previous attempts" panel when an abandoned worktree exists for the same directive as the current view.
3. **Auto-prompt**: when a blocked directive is resumed, the brain detects abandoned worktrees and surfaces them as the first decision: "5 worktrees from previous attempts of this directive remain on disk. Remove? [yes/no/show]"

### Auto-cleanup policy

Configurable per-project via `metadata.worktreeRetentionDays` (default `7`). Worktrees older than the retention window with no associated open finding get auto-removed at the start of the next directive run.

### What about the branches?

For each removed worktree, factory5 also deletes the associated `factory/task-<id>` branch (after confirming it's not the current HEAD and not merged). The branch removal is opt-in (`--prune-branches` flag on `factory5 cleanup`) by default — operators may want to keep branches for forensics even after the worktree directory is gone.

## Sequencing

1. **Living knowledge graph foundation** (Components 1 — most of it).
   - Schema file, templates, architect seeding.
   - The `knowledge-graph` skill teaching agents the rules.
   - Wire skill into scaffolder/builder/fixer registry.

2. **Structured findings shape** (Component 2).
   - New IPC schema with backward-compat adapter for old findings.
   - Frontend renders new shape; falls back to prose for legacy findings.

3. **Validator: schema + reference integrity** (Component 3, deterministic checks).
   - `factory5 graph check` CLI.
   - Wire into `runTooling()` as a post-task finishing step.
   - Run pre-merge in the brain.

4. **Validator: doc-fiction (programmatic) + dead-code** (Component 3, deeper checks).
   - Per-runtime executable-doc checking (Python first).
   - Dead-code scanner (Python first: parse exports, scan callers).
   - Both produce structured findings.

5. **Coherence-reviewer agent** (Component 3, semantic check).
   - New read-only agent role.
   - Runs as final verification before directive complete.

6. **Self-healing loop** (Component 4).
   - Brain partitions findings; dispatches fixer for auto-fixable.
   - Structured escalation for the rest.

7. **Workspace hygiene** (Component 5).
   - `factory5 cleanup` CLI.
   - Auto-prompt on directive resume.
   - Auto-retention policy.

Each section ships as its own commit set and can be verified independently. Sections 1-3 are the foundation; sections 4-6 deepen the validation; section 7 is independent and can ship anywhere in the sequence.

## Files touched (high-level)

| Component | Files |
|---|---|
| **1. Knowledge graph** | `skills/knowledge-graph.md` (new), `packages/brain/src/agents/registry.ts`, `prompts/agents/architect.md`, factory5 ships `_schema.md` + `_templates/*.md` as embedded assets |
| **2. Structured findings** | `packages/core/src/schemas.ts` (finding schema), `packages/ipc/src/schemas.ts`, `packages/wiki/src/findings.ts` (storage), `apps/factory-web/src/pages/directives/detail.astro` (rendering) |
| **3. Validator** | New package `packages/coherence-validator/`, integration in `packages/worker/src/run-worker.ts` post-task, integration in `packages/brain/src/pool.ts` pre-merge, integration in `packages/brain/src/loop.ts` final verification |
| **4. Coherence-reviewer agent** | `prompts/agents/coherence-reviewer.md` (new), `packages/brain/src/agents/registry.ts`, planner updates to insert reviewer task at directive end |
| **5. Self-healing** | `packages/brain/src/pool.ts` (finding partition + fixer dispatch), fixer skill update |
| **6. Workspace hygiene** | `packages/cli/src/commands/cleanup.ts` (new), `packages/brain/src/loop.ts` (resume-time prompt), `apps/factory-web/src/pages/directives/detail.astro` (previous-attempts panel) |

## Risks

| Risk | Mitigation |
|---|---|
| Agents ignore the schema | Validator catches at task end with structured findings; agent must fix to complete. Templates make correct shape easier than incorrect shape. |
| Schema evolves and old projects break | `_schema.md` is per-project and git-tracked; old projects keep their schema. Factory5 ships a migration helper for major schema changes. |
| Doc-fiction check produces false positives | Per-runtime extractors are conservative (only executable code blocks). Semantic check is LLM-judgment, which the operator can override per finding. |
| Self-healing loop runs forever | Hard cap on attempts (default 3); finding partition is deterministic; brain escalates with full audit of attempts. |
| Fixer makes things worse | Fixer's task contract is "smallest change that resolves this specific finding"; reviewer can audit fixer outputs in a follow-up if needed. Worst case: operator rolls back. |
| Workspace auto-cleanup destroys work the operator wanted | Retention default (7d) is conservative; cleanup is opt-in unless explicitly enabled; operator can disable per-project. |
| Coherence-reviewer becomes a token sink | Read-only agent (single `provider.call()`); time-boxed by the existing stream-timeout config. Findings are deduplicated against the validator's existing findings. |
| The schema spec lives in the project, so cross-project intelligence is lost | Acceptable for v1. Future: a registry that aggregates schemas across projects for federation. |

## Out of scope (deferred)

- **Cross-project graph queries** (e.g., "show me every project that uses HTTPExtractor"). Federation requires a shared schema and storage layer. Defer to a future spec.
- **Visual diagram rendering** (`factory5 graph render`). Useful but cosmetic; not needed for the core coherence improvement.
- **Graph-aware planner** that builds plans from existing graph state (e.g., "if 2 features are documented but unimplemented, plan tasks to implement them"). Future iteration once the graph is stable.
- **Decision supersession surfaces in UI**. v1 stores supersession in front-matter; UI rendering of decision timelines is a follow-up.
