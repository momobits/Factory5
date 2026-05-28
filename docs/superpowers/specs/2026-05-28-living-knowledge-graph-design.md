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

1. **Architect seeds** the feature file at project start: `status: documented`, no `implements:` yet. Architect also seeds stub README + module docs so `documented_in:` anchors point at real (stub) targets — the validator's reference-integrity check passes from day one.
2. **Planner links tasks to features.** When the planner produces `plan.json`, each task entry gains a new field `featureIds: [<id>, ...]` listing the features that task is responsible for. This is the load-bearing link between tasks and the graph: builders read it to know which features to update on completion; the validator uses it to check coverage.
3. **Builder picks up** the feature(s) when its task runs. Reads each feature file via `featureIds[]` to understand the documented surface before writing code.
4. **Builder writes code**, then before marking the task complete: updates each feature file's `status: documented → implemented`, sets `implements: [<this-task-id>]`, and fills in any documented_in stubs the scaffolder left behind.
5. **If builder deviates** from the documented surface, builder creates a `decisions/<date>-<slug>.md` file describing what changed and why, adds the decision's ID to the feature's `decisions: []` array, and updates `documented_in:` target files (README, modules.md) to match the actual built surface.
6. **Validator runs** at task completion. Confirms front-matter is well-formed; every feature in `featureIds[]` has `status: implemented` with `implements: [<this-task-id>]`; all `documented_in:` anchors resolve.

If the builder ignores any of step 4-5, the validator fails the task with a structured finding telling it what to fix.

### Tasks ↔ features linkage (the load-bearing edge)

The plan.json task schema gains:

```typescript
{
  // ... existing fields ...
  /** Features this task implements. Read by the validator to verify coverage. */
  featureIds?: readonly string[];
}
```

The planner fills this from its understanding of which features (per `modules.md` and the seeded `features/*.md` files) each task should produce. A task may implement multiple features (e.g., "Build CLI" implements both `cli-run-command` and `cli-validate-command`); a feature may span multiple tasks (e.g., "Streaming support" might need tasks across extractor + transformer + loader).

For directives that don't run the architect/planner flow (small bug fixes, single feature adds — see "Non-greenfield directives" below), `featureIds` may be empty and the validator runs in a relaxed mode.

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

1. **Copy fixed assets** into the project: `_schema.md` and `_templates/feature.md`, `_templates/decision.md`. These ship as factory5 assets bundled with the architect prompt; the architect copies them verbatim into `docs/knowledge/`.
2. **Enumerate planned features** from `modules.md` and produce a `features/<id>.md` file for each, in `status: documented`, with `documented_in:` pointing at the relevant `modules.md` section (which exists) AND at planned README sections (which don't exist yet — see step 3).
3. **Seed stub user-facing docs**: a placeholder `README.md` with the planned section headings (Quick Start, Configuration, CLI Reference, etc.) and explicit `<!-- to be filled by scaffolder/builder -->` markers. This ensures every `documented_in: README.md#cli-reference` anchor has a real target from day one. The validator sees a valid graph at seed time; scaffolder/builder fill in the stubs as features get implemented.

The planner agent's job grows by one field: it produces `plan.json` task definitions WITH each task's `featureIds: [...]` populated (see lifecycle step 2). The planner reads `features/*.md` to know what features exist, then maps tasks → features based on the task's intended outputs.

### Existing projects (backward compat)

Factory5 has projects that already exist without the graph structure (pythonetl, etc.). When a directive runs against a project lacking `features/` or `_schema.md`:

1. The brain detects the missing graph at directive start.
2. If the directive is **greenfield-shaped** (architect/planner pair will run): the architect's seeding step builds the full graph from scratch as part of its normal job — no special migration needed.
3. If the directive is **operating on an existing project that lacks a graph** (e.g., resuming a project built before this feature shipped): the brain inserts a one-shot `graph-migration` task at the start of the plan. This is a single architect-role task that:
   - Copies `_schema.md` and `_templates/` into `docs/knowledge/`
   - Reads existing `modules.md` to infer the feature surface
   - Produces `features/*.md` files for each inferred feature, in `status: implemented` (since the code already exists), with `implements: []` empty (no task built it in this directive — the link is retroactive)
   - Commits this as one migration commit
4. After migration, the directive proceeds normally with the validator active.

The migration is **idempotent** — re-running it on an already-migrated project is a no-op. It runs once per project, ever.

### Non-greenfield directives

Many directives don't run the full architect → planner → scaffolder flow:
- "Fix bug X" — adds a fixer task only
- "Add feature Y to existing project" — adds builder tasks only
- "Refactor module Z" — adds builder tasks only

For these:

- The knowledge graph **still applies**. Tasks read existing feature files to understand the current contract before modifying.
- The planner is responsible for **adding feature seed nodes** if the directive introduces new features. For "Add feature Y," the planner produces a seed task before the implementation task: a small architect/scaffolder-role task that creates `features/<y>.md` in `status: documented`, updates `modules.md`, then the implementation task picks it up via `featureIds: [y]`.
- For directives that **modify existing features without adding new ones** (bug fixes, refactors), no seed task is needed. The builder reads the existing feature, makes changes, and writes a decision file if the modification represents a semantic change (e.g., behavior changed in a user-visible way).
- The validator runs in **relaxed mode** when `featureIds` is empty: it still enforces schema validity and reference integrity for any feature files touched, but doesn't fail the task for "this task didn't update any feature's status."

The brain detects directive shape from the planner's output: if `plan.json` includes tasks with `featureIds[]` set, the validator runs in strict mode for those tasks; otherwise relaxed.

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
    "line": 7,
    "anchor": "#cli-run-command",
    "frontmatter_field": "implements"
  },
  "title": "Feature claims status=implemented but no implements task ID",
  "why": "Without the implements link, we can't verify the code actually exists or trace it back to a build commit.",
  "suggested_fix": "Set implements: [<this-task-id>] in front-matter.",
  "auto_fixable": true,
  "raised_at": "2026-05-28T...",
  "raised_by_task": "01KSQAC3G0..."
}
```

The `location` object is flexible: `file` is required, `line` / `anchor` / `frontmatter_field` are each optional and used per-finding-category. A schema-violation finding sets `frontmatter_field`; a doc-fiction finding sets `anchor` (the heading the bad example is under) and `line`; a dead-code finding sets `line` only. Renderers pick whichever fields are populated.

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

Three trigger points, all in the worker or brain at the right architectural layer:

1. **Post-task, pre-cleanup**, in `runTooling()` (`packages/worker/src/run-worker.ts`), after the agent's stream completes and `listChangedFiles()` runs (line ~736), but BEFORE `cleanupWorktree()` (line ~762). The worktree still exists; we run the schema + reference-integrity checks against the worktree's view of the knowledge area. If validation fails, `runTooling()` records the findings in the `TaskResult`, sets `exitCode: 1`, and `cleanupWorktree()` preserves the worktree for the fixer to attempt repair. No merge to main happens for failed validation.

2. **Post-merge, in the brain's pool dispatcher**, after `runWorker()` returns success AND the worker has merged the task branch into main. The brain runs the validator against the project root (now reflecting the merged changes) to catch cross-task issues that only become detectable after integration — e.g., feature A's decision referenced feature B, but feature B's status never flipped. Findings here trigger the self-healing loop on the next task or escalate to the operator.

3. **Final verification**, in the brain's `executeDirective()`, before the directive is marked complete. Runs after the last task merges. This is where the programmatic doc-fiction check (executable README examples), dead-code scan, and the coherence-reviewer agent run — the deeper checks that need the integrated codebase, not just per-task changes.

### Programmatic doc-fiction check

For Python (initially):
- Parse README fenced code blocks (` ```python `, ` ```yaml `, ` ```bash `, etc.).
- For ` ```yaml ` under a "Quick Start" / "Configuration" / "Example" heading: validate by invoking the project's own config parser as a subprocess (`<assessor-env-python> -c "from <project>.config import load_yaml; load_yaml(<block>)"`). Failure = doc-fiction finding with `category: doc-fiction`, `location.file: README.md`, `location.line: <block-start>`.
- For ` ```bash ` containing a project-binary invocation (entry in `pyproject.toml [project.scripts]`): spawn it in the assessor-env with the args from the block, capture output. Non-zero exit + the README claims this is a working example = doc-fiction finding.
- For ` ```python ` showing the project's importable API: run it as a script in the assessor-env. Import errors / attribute errors = doc-fiction finding.

This is per-runtime; Python is the v1 target. Node/Go/Rust extend later. The check is conservative — it only flags code blocks under heading patterns matching `/Quick Start|Configuration|Example|Usage|Reference/i`. Tutorial-style "do not run this" snippets aren't validated.

### Dead-code scan (Python v1)

A "dead-code candidate" is any public symbol (no underscore prefix) that is:
1. Defined at module scope in a file under the project's package(s), AND
2. Not referenced by any other module in the package (imports + qualified calls scanned via AST), AND
3. Not exposed as a console script in `pyproject.toml [project.scripts]`, AND
4. Not exposed in any module's `__all__` list, AND
5. Not referenced by any `documented_in:` target of an active feature (i.e., not a deliberately exposed API surface).

Symbols matching all five = candidates flagged as `category: dead-code` findings. They're not auto-fixable — the agent or operator has to decide: wire it (write the caller) or remove it.

The scanner is conservative against false positives by design (it excludes anything documented as feature surface, and anything in `__all__`). The pythonetl case (`Pipeline.register_pipeline`, `get_pipeline`, `list_pipelines`) catches because:
- They're public methods on `Pipeline`
- No other module imports or calls them
- They're not in `__all__`
- The CLI README mentions a `pipeline_name` arg that would invoke them, but the CLI implementation doesn't call them — so they're documented in spirit but not via an active `documented_in:` link in a feature file

### Semantic doc-fiction check (coherence-reviewer agent)

For prose claims that aren't executable code blocks (e.g., "the CLI supports an optional pipeline_name argument"), a new read-only agent role `coherence-reviewer`:

**Agent definition** (`prompts/agents/coherence-reviewer.md` + entry in `packages/brain/src/agents/registry.ts`):

```typescript
'coherence-reviewer': {
  role: 'coherence-reviewer',
  category: 'reasoning',         // uses the reasoning model tier
  tools: ['Read', 'Glob', 'Grep'],  // read-only
  defaultSkills: ['knowledge-graph', 'code-review'],
  promptPath: 'coherence-reviewer.md',
}
```

**System prompt** (sketch): "You verify that the project's docs match its code. You read the knowledge area (features/*.md, decisions/*.md, modules.md, README.md) and the actual code modules. You raise findings for any documented capability that isn't actually implemented, any code symbol that's exposed but not documented, and any decision that's missing for a documented-vs-actual divergence. Your output is a list of structured findings — you never fix anything; you report only."

**Inputs**: full read access to the project. Receives a single user prompt summarizing the directive scope.

**Outputs**: structured findings emitted via the same `FINDING [SEVERITY] target: description` marker convention used by existing read-only agents, parsed by the worker's `parseFindings()` into the new structured shape.

**When the planner inserts it**: always at directive end for tool-using directives. The planner appends a terminal `coherence-reviewer` task after the last builder/fixer task, with no `dependsOn` constraints beyond "all builder tasks complete." Cost is bounded: one `provider.call()` per directive with the reviewer model tier.

**Cost note**: read-only agent, single call, bounded by `streamTimeoutMs` config. For a typical project ~50 source files, the context is small enough to fit comfortably in a single Sonnet/Opus call. We don't iterate; one pass produces findings, the brain dispatches a fixer if there are auto-fixable ones, then we're done.

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

### Attempt counting

One **attempt** = one fixer task dispatched to completion (success, partial, or stuck). The counter increments when the fixer's task transitions out of `running`:

- **Full success** (all input findings resolved + no new findings raised) → loop ends, success
- **Partial success** (some findings resolved, others remain OR new findings raised) → counts as one attempt; if `attempts < N` and remaining findings include at least one auto-fixable, dispatch again with the new finding set
- **Zero progress** (no findings resolved AND no new useful changes) → counts as one attempt but the brain immediately escalates (no point retrying the same input)
- **Fixer task failed/timed out** → counts as one attempt; if `attempts < N`, retry with the same findings; otherwise escalate

The "zero progress" detection compares the finding set before and after: if the auto-fixable subset is unchanged AND no new findings appeared AND no files changed, the fixer is stuck — escalate immediately rather than burning the remaining attempts.

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

**Default: off.** Cleanup happens via explicit operator action (the resume-time prompt or `factory5 cleanup` CLI) rather than time-based auto-removal. A developer taking a 2-week vacation shouldn't return to find abandoned worktrees auto-deleted.

Projects that want set-and-forget can opt in via `metadata.worktreeRetentionDays: <number>` in `project.json`. When set, the brain removes abandoned worktrees older than the window at the start of each directive run, with a single `info` log line noting what was removed.

### What about the branches?

For each removed worktree, factory5 leaves the `factory/task-<id>` branch in place by default — operators may want to keep them for forensics or to cherry-pick salvageable work even after the worktree directory is gone. Opt-in branch pruning via `--prune-branches` flag on `factory5 cleanup`, or `metadata.pruneBranchesOnCleanup: true` for the automatic path.

Before deleting a branch, factory5 confirms it is not the current HEAD, is not merged into main, and is not referenced by any open finding's `location.file` path (a finding might reference a partial implementation in a preserved branch).

### Non-CLI channels

When a blocked directive resumes via Discord/Telegram/Web UI (not the CLI), the resume-time prompt degrades to a structured message in the channel: "5 abandoned worktrees detected from prior runs of this directive. Reply with `factory cleanup` (via CLI) or `/cleanup confirm` (via channel command) to remove them." No silent removal; the operator decides explicitly.

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
| Workspace auto-cleanup destroys work the operator wanted | Auto-cleanup default is **off**; cleanup happens via explicit operator action or opt-in retention policy. Non-CLI channels degrade to a structured message, no silent removal. |
| Coherence-reviewer becomes a token sink | Read-only agent (single `provider.call()`); time-boxed by the existing stream-timeout config. Findings are deduplicated against the validator's existing findings. |
| The schema spec lives in the project, so cross-project intelligence is lost | Acceptable for v1. Future: a registry that aggregates schemas across projects for federation. |
| Validator runs at every task completion — performance footprint | Schema + reference checks parse the `docs/knowledge/` tree (typically <100 small markdown files). Expected cost <100ms per task. If a project grows large enough to exceed this, the validator can be made incremental (only re-check files touched by the current task). v1 ships the full-scan version; instrument the actual cost; optimize only if needed. |
| Existing projects without a knowledge graph | One-shot `graph-migration` task inserted at directive start when the brain detects missing graph. Idempotent — runs once per project ever. Inferred features from existing `modules.md`. Defined in the "Existing projects (backward compat)" section. |
| Architect's seeded README stubs get out of sync with what builder ships | Builder is responsible for filling stubs as features land (see lifecycle step 4). Validator's reference-integrity check at final-verification phase catches unfilled stub markers (`<!-- to be filled by scaffolder/builder -->`) as `half-implementation` findings. |

## Out of scope (deferred)

- **Cross-project graph queries** (e.g., "show me every project that uses HTTPExtractor"). Federation requires a shared schema and storage layer. Defer to a future spec.
- **Visual diagram rendering** (`factory5 graph render`). Useful but cosmetic; not needed for the core coherence improvement.
- **Graph-aware planner** that builds plans from existing graph state (e.g., "if 2 features are documented but unimplemented, plan tasks to implement them"). Future iteration once the graph is stable.
- **Decision supersession surfaces in UI**. v1 stores supersession in front-matter; UI rendering of decision timelines is a follow-up.
