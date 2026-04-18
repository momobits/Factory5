# 0016 — Planner materialisation: category floor, file-ownership deps, per-task turn budgets

- **Status:** Accepted
- **Date:** 2026-04-18

## Context

The Phase 2 finale ran a live `factory build` end-to-end on a real project and
surfaced three concrete quality issues that Phase 3 and Phase 4 did not
revisit:

1. **File-ownership collisions.** The planner happily emitted plans where two
   independent `builder` tasks both declared `expectedOutputs.files:
["src/foo.ts"]` with no dependency between them. The pool scheduled them
   concurrently, each allocated its own worktree (ADR 0008), each wrote
   `src/foo.ts` in isolation, and at merge-back time the second task's merge
   into the project's main branch conflicted with the first's committed
   changes — producing a non-deterministic failure that only shows up under
   concurrency.

2. **Under-powered tool-using tasks.** The planner occasionally picked
   `category: "quick"` (Haiku) for a `builder` task. The agent registry's
   declared category for `builder` is `deep` (Opus). The planner's free
   choice of category meant cheap-model builders were getting dispatched —
   failing mid-TDD because the model couldn't reason through the tests.

3. **Tight `max-turns` ceiling.** The claude-cli provider defaulted to 20
   agentic turns per tool-using task. Phase 2 live data showed typical
   builder tasks hitting 15-18 turns; multi-file implementations regularly
   ran out of budget at exactly the wrong moment (mid-edit, context spent,
   subprocess killed).

All three issues are planner-adjacent: the planner emits the work unit, the
pool executes verbatim. Fixing them in the pool (reject the plan, rewrite the
plan at dispatch time) would couple policy to execution. Fixing in the
planner prompt alone is not enough either: LLM output drift will reintroduce
the issues on the next fine-tune. We want **belt-and-braces**: teach the
planner the rules _and_ enforce them at materialisation time.

## Decision

Introduce a new materialisation step between the planner's LLM response and
the on-disk `plan.json`. Exported as
`materialisePlannerTasks(raw, planId) -> { tasks, notes }` from
`@factory5/brain/planner.ts`. Three responsibilities, one pass each:

### 1. Category floor

Every task's `category` is clamped to
`max(plannerChoice, AGENTS[role].category)` using a total rank over
{`quick`, `documentation`, `planning`, `reasoning`, `deep`}:

```
quick = documentation = 0
planning             = 1
reasoning = deep     = 2
```

A `builder` task the LLM labelled `quick` becomes `deep` (the registry's
declared category for builders). The planner is still free to _upgrade_ —
it can pick `deep` for a `reviewer` — but never downgrade below the
agent's floor. Each adjustment is recorded in the returned `notes[]` and
emitted as a `brain.planner` warn-level log line.

The new `MODEL_CATEGORY_RANKS` constant lives in `@factory5/core/constants`
so the planner, the registry, and any future tooling share the same
ordering.

### 2. File-ownership synthetic dependencies

Walk the materialised task list in order. For each task, for each file in
`expectedOutputs.files`, track the index of the first task that claims it.
When a later task claims the same file:

- normalise both paths (`./foo` and `foo\bar` and `foo/bar` compare equal)
- if the later task (or any of its transitive dependencies) already
  reaches the first writer, leave the plan alone — the planner got it
  right
- otherwise, append the first writer's task id to the later task's
  `dependsOn`, recording a note

The net effect: at worst the LLM plans two `builder` tasks racing for the
same file; at worst the pool serialises them instead of letting them
conflict. First writer wins the order because the common case is
"scaffolder writes foo.ts; builder refines foo.ts" — the builder is the
later index.

### 3. Per-task turn budgets

Add an optional `maxTurns` field to `taskSchema` (`@factory5/core`),
propagated from an optional `maxTurns` on the planner's output. The
planner's prompt is updated to tell it to emit `maxTurns: 50-80` for broad
implementations and `10-20` for narrow ones.

Plumbed through:

- `taskSchema` (optional positive int)
- `ProviderRequest.maxTurns` (new optional field)
- `ClaudeCliProvider.stream()` uses `req.maxTurns ?? this.maxTurns`
- `ClaudeCliProviderOptions.maxTurns` default raised **20 → 40**

Worker reads `opts.task.maxTurns` and passes it through to the provider.
Read-only agents ignore the field.

### Planner prompt

The planner agent prompt (`prompts/agents/planner.md`) is rewritten (was a
Phase 1 stub). It now covers:

- Which agent roles exist and when to use each
- Default category per agent + when to upgrade (never downgrade)
- The file-ownership rule with concrete ✅/❌ examples
- Turn-budget guidance
- A minimal plan skeleton showing the exact JSON shape

## Consequences

**Positive:**

- File-ownership collisions become structurally impossible: even if the
  LLM emits the wrong plan, materialisation rewires. Correctness is
  defence-in-depth — prompt tells the LLM, materialisation enforces.
- Cheap-model builder tasks become impossible without a deliberate
  registry change. Cost ceiling moves from "hope the LLM picks right" to
  "declared floor is the lowest the agent can run at".
- Builders have enough turns to finish cohesive modules in one pass. The
  default move from 20 → 40 turns roughly doubles the headroom at a small
  cost-per-call overhead (most turns are short; the long ones dominate
  duration regardless).
- Plans written to `plan.json` now reflect the _effective_ execution
  category, not the LLM's wish. Resume flows don't need to re-apply the
  clamp.

**Negative:**

- Synthetic `dependsOn` edges make plans slightly harder to read: a human
  inspecting `plan.json` can't always tell which edges came from the LLM
  vs the materialiser. Mitigated by the adjustment notes logged at warn
  level — anyone debugging a collision can see what was added.
- The materialiser's first-writer rule doesn't guarantee a fully ordered
  chain across three-way overlaps. Task C that shares a file with both A
  and B only gets an edge to A (the first writer). B and C could still
  race if B doesn't depend on A. In practice the planner prompt is enough
  to prevent this; the fix-if-needed is a second pass that also edges
  to any prior writer reachable only through an independent path.
- `maxTurns` is per-task but not yet per-phase (scaffold vs build vs
  fix). Good enough for now.

**Reversible?** Yes. `materialisePlannerTasks` is an in-process function
with no persistence concerns; reverting its three behaviours is a local
change. The new `maxTurns` field on `taskSchema` is optional — old plans
without it continue to work.

## Alternatives considered

- **Enforce category floor in the pool instead of the planner.** Rejected:
  the plan.json would still show `quick` for a task that actually ran on
  `deep`, making debugging (and resume replay) harder.
- **Reject invalid plans and re-run the planner.** Rejected: burns tokens
  on a retry when a deterministic rewrite produces the same result at
  zero marginal cost.
- **Raise default max-turns to 80.** Rejected: most tasks finish well
  under 40; doubling again trades risk of runaway loops for headroom that
  the minority of large tasks need. Per-task override gives the planner
  the lever without changing the cheap default.
- **Parse agent-registry floors into a separate config file.** Rejected:
  `AGENTS` is already the single source of truth for per-agent
  categories; adding a floor field there (instead of introducing a new
  config surface) keeps the data in one place.
- **Auto-merge tasks that write the same file.** Rejected as too
  invasive: the planner's intent might be "two tasks refining the same
  file in sequence", and merging would change the semantics. The
  synthetic edge preserves the LLM's structure and only constrains
  execution order.
