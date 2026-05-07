---
name: progress-tracking
description: |
  Report progress via the runtime contract: emit declared signals from
  expectedOutputs.signals[], raise findings via FINDING markers, cite
  finding IDs when relevant. The brain tracks completion automatically
  from these emissions — there is no per-iteration progress doc to update.
---

# Progress Tracking

Factory5's progress signal is **runtime emission**, not a per-iteration
progress doc. The brain consumes:

- **Signals** declared by the planner in `expectedOutputs.signals[]`
  per task (e.g. `tests-green`, `module-implemented`, `lint-clean`),
  emitted by the builder via the `TaskResult.signalsEmitted` field
  (`packages/core/src/schemas.ts`).
- **Findings** raised by reviewer / verifier / fixer agents via the
  `FINDING [SEV] target: description` marker grammar, parsed by
  `packages/worker/src/parse-findings.ts`, persisted via
  `addFinding` to the per-project `findings.json` and the
  cross-project `findings_registry` (per ADR 0021).
- **Resolutions** emitted by the fixer via the
  `RESOLUTION <FID> (FIXED|VERIFIED|WONTFIX): <prose>` marker
  grammar, parsed by `packages/worker/src/parse-resolutions.ts`,
  dispatched through `updateFindingStatus`.
- **Files changed**, recorded automatically by the worker via
  `TaskResult.filesChanged` (the worktree's git diff against the
  parent branch).

You don't write a `BUILD.md`-style progress document. The brain's
directive lifecycle plus the registry is the durable record; the
operator's narrative lives in `<workspace>/<project>/.factory/` under
the brain's management. Your job is to emit cleanly so the brain can
track.

## At the START of a task

1. Read the task's `inputs` block — what the planner is asking you to
   do (`task.inputs.context`, `task.inputs.files`).
2. Read the task's `expectedOutputs` — both the file scope you may
   write (`expectedOutputs.files[]`) and the signals you are expected
   to emit (`expectedOutputs.signals[]`). Both are the contract; the
   brain checks completion by observing them.
3. Read open findings on this project via the worker's auto-injected
   context block (`# Context` in your user prompt). Findings already
   raised against files you'll touch are signals: avoid duplicating;
   cite their IDs (`F003`) when relevant in commit messages or
   resolution markers.

## At the END of a task

Your `TaskResult` carries the durable record:

- `signalsEmitted` — the signals you actually completed. Match against
  `expectedOutputs.signals[]`; missing signals are how the brain
  knows the task is incomplete.
- `findingsRaised` — populated automatically from your `FINDING`
  markers by the worker.
- `filesChanged` — populated automatically from the worktree diff.
- `exitCode` — `0` for clean completion; non-zero if the provider
  errored.

Don't manufacture signals you didn't earn. Emitting `tests-green`
without running tests creates a silent regression the brain will
trust.

## Builder-specific framing (per the `tdd` skill)

The `tdd` skill governs the builder's discipline. Progress within a
task = test-first cycles green. Progress across a task = the signals
declared in `expectedOutputs.signals[]` emit on completion. Don't
batch multiple signal emissions until the end if the planner declared
intermediate ones; emit each as it earns.

If the builder cannot land the task cleanly:

- Spec ambiguity, ballooning scope, or genuinely-stuck failure modes
  → escalate via `ask_user` (per ADR 0024 + the `ask-user` skill).
- Don't emit a signal you didn't actually achieve to "get unstuck".

## Planner-specific framing

The planner reads the `findings_registry` (cross-project) and the
per-project `findings.json` to see what previous directives raised.
That's how the planner knows whether to schedule a fixer pass on
existing OPEN findings or only build new modules.

The planner doesn't update progress docs either. Its output is the
Task DAG (`Plan.tasks[]`); the brain stores it; subsequent agents
read their assigned `Task` from the brain's state.

## Citing findings

When your work relates to an existing finding, cite the ID:

- In commit messages: `fix(F003): clamp profile index in src/auth.ts`
- In resolution markers (fixer): `RESOLUTION F003 (FIXED): ...`
- In task summary prose: "addresses F003 by …"

The ID resolves through `findingId` in `@factory5/core`; the registry
links findings to the directive that raised them. Citation makes the
trail readable for the operator and the next agent without
duplicating context.

## Rules

- Never invent a signal that wasn't in `expectedOutputs.signals[]`.
- Never claim a signal you didn't earn (test failed → don't emit
  `tests-green`).
- Never write a `BUILD.md` from your own task. The factory5 worker
  appends a small build-log line per task automatically; that is the
  brain's surface, not the agent's.
- Don't create a per-task progress doc. The brain's directive
  lifecycle + the registry is the durable record.
- If you discover a problem on this project that's outside the
  current task's scope, raise a `FINDING` rather than silently
  expanding scope.
