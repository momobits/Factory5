---
id: I005
severity: HIGH
area: worker/run-worker
status: RESOLVED
created: 2026-04-19
resolved: 2026-04-19
---

# `persistFindings` dirties main's working tree, blocking the next `mergeAndRemove`

## Description

`runTooling` in `packages/worker/src/run-worker.ts` calls
`persistFindings(opts.projectPath, …)` after the claude subprocess
finishes and **before** `cleanupWorktree(…)`. `persistFindings` in turn
calls `appendBuildLog(projectPath, …)` which writes to
`<projectPath>/BUILD.md` — **the main project repository's working
tree**, not the task's worktree.

`BUILD.md` is a tracked file (the brain's `appendBuildLog` at inline-run
startup creates it before `ensureProjectRepo` stages everything into the
initial commit). Any subsequent write from `persistFindings` therefore
leaves main's working tree with uncommitted modifications to a tracked
file.

When `cleanupWorktree` → `mergeAndRemove` then tries
`git merge --no-ff <task-branch>` on that same main checkout, git
refuses:

```
error: Your local changes to the following files would be overwritten by merge:
	BUILD.md
Please commit your changes or stash them before you merge.
Aborting
Merge with strategy ort failed.
```

Effect on the build: the first builder that raises any finding (even a
LOW one) poisons the pool — its own merge aborts, every downstream task
short-circuits with `upstream failure`, and the assess line reports
`gate.build: false` on the missing-sibling-import cascade. Same shape as
I004 from the user's perspective (pool fails after scaffolder), but a
different root cause.

This is **adjacent to I004, not a regression of it.** I004 (concurrent
sibling merges) was about two merges racing on the same `.git/`. I005
is about a single worker dirtying main's working tree between its own
output and its own merge. The I004 mutex correctly serialises merges;
I005 blocks each merge independently.

## Repro / evidence

Phase 5 close-out Run A (`factory build example` → directive
`01KPJVFJ35A8WJVKHK3G8H9F8Y`, 2026-04-19T12:29):

- Scaffolder task `01KPJVM6A1Q9PBNZ2Z846E5M9F` completed, raised zero
  findings → `persistFindings` did nothing, main stayed clean → merge
  succeeded (reflog HEAD advanced 9281c65 → 14996c1).
- Models builder task `01KPJVM6A1DDCC8Z622ZWE1HDF` completed, raised
  F001 (LOW) at 12:35:57.200Z. `appendBuildLog` fired on
  `C:\Users\Momo\factory5-v5-final-example\example\BUILD.md`.
- At 12:35:57.574Z `mergeAndRemove` logged "merge of factory/task-2zwe1hdf
  into main failed (warning: …LF will be replaced by CRLF… Your local
  changes to the following files would be overwritten by merge:
  BUILD.md)" and re-threw with the worktree preserved.
- All four downstream builder/verifier tasks were skipped with
  `pool: skipping — upstream dependency failed`.
- `pool: complete` reported `succeeded: 1, failed: 5`. `assess: complete`
  returned `{build: false, integration: false, verify: false,
testsPassed: 0, importErrors: ["tests.conftest: … 'src.models'", …]}`
  — exactly the lost-sibling-import cascade.
- `askUser` escalated; the autonomous-mode loop terminated with the
  directive in `running` (the separate autoresume reconcile sweep will
  flip it on next daemon start, per this session's preflight).
- Post-run `git -C .../example status --short` confirms:

```
 M BUILD.md
```

and `git diff HEAD -- BUILD.md` shows the append from `persistFindings`
at the timestamp of the finding:

```
+- `2026-04-19T12:35:57.200Z` — builder (task 01KPJVM6A1DDCC8Z622ZWE1HDF) raised 1 finding(s)
+- `2026-04-19T12:36:11.332Z` — assessor: build=false integration=false verify=false
```

Spend for the partial run: $1.47 (triage $0.01 + architect $0.31 +
planner $0.10 + scaffolder $0.21 + models $0.84 + assessor install $0).

## Hypothesis

`persistFindings` must not write to the main project's working tree
while merges are in flight. Candidate fixes, in increasing invasiveness:

1. **Gitignore `BUILD.md`.** Extend
   `worktree.ts:ensureGitignoreExcludesFactory` to also add `BUILD.md`
   to `.gitignore` before the initial commit. Then BUILD.md is never
   tracked, and writes never block a merge. Trade-off: BUILD.md stops
   travelling with the project's git history; humans pulling the project
   from git won't see the factory's build log unless they also copy
   BUILD.md separately. For factory's purposes this is probably fine —
   BUILD.md is a runtime artefact of the build, not a source document —
   but the decision deserves an ADR note.
2. **Stage+commit BUILD.md from inside the mutex.** After
   `mergeAndRemove` completes, and while still holding
   `projectMergeQueues`'s tail, have `persistFindings` (pulled into the
   mutex) write BUILD.md + `git add BUILD.md` + `git commit -m "factory:
findings update"` on main. Main stays clean at end-of-turn; next
   merge proceeds. Keeps BUILD.md in git history; adds a commit per
   finding-producing task.
3. **Move `persistFindings` into the brain loop** and call it after the
   whole pool drains, not per-task. Simpler coupling but loses per-task
   BUILD.md log granularity and would need a redesign of how the brain's
   lifecycle log lines (run-started, architect-skipped, etc.) interleave
   with worker log lines.

Tier 1 is the smallest change and the right first cut. If/when we want
BUILD.md in git (for reviewers / auditors), tier 2 upgrades it without
changing the worker's contract.

## Resolution

Resolved 2026-04-19 via a **one-line path move** (tier 1 from the
Hypothesis section, refined to sidestep the gitignore decision
entirely):

- `packages/wiki/src/paths.ts` —
  `buildMd: join(projectPath, 'BUILD.md')` → `buildMd: join(factory,
'BUILD.md')`. Every `appendBuildLog` / `rebuildFindingsTable` /
  `ensureBuildMd` call routes through `projectPaths(...).buildMd`, so
  the single-line change moves all BUILD.md writes into
  `<projectPath>/.factory/BUILD.md`. `.factory/` is already covered by
  `ensureGitignoreExcludesFactory` in `worktree.ts`, so BUILD.md is
  never tracked by the project's git, never dirties main's working
  tree, and never blocks a merge. `ensureBuildMd` already does
  `mkdir(dirname(buildMdPath), { recursive: true })`, so no
  filesystem-bootstrap change is needed.

- Decision rationale: the project's git log is the authoritative build
  history; `BUILD.md` is a runtime artefact of factory's own bookkeeping
  and belongs alongside `.factory/findings.json` (also gitignored). Any
  human wanting factory's per-run log opens `.factory/BUILD.md`
  directly. No new ADR — this is a documented convention refinement, not
  an architectural decision.

**Test coverage** added to `packages/worker/src/worktree.test.ts`:

- `appendBuildLog between task and cleanup does not dirty main (I005)`
  — allocates a worktree, writes a file in it, calls
  `appendBuildLog(projectPath, …)` (the exact call the worker's
  `persistFindings` makes post-stream), asserts
  `git status` on main shows no changes, then runs `cleanupWorktree`
  with `outcome: 'success'` and asserts the worktree's file lands on
  main, the branch is removed, and no merge aborts fire. Without the
  fix, this test would reproduce the Run A failure; with the fix it's
  clean.

Existing wiki test "does not overwrite an existing BUILD.md on
appendBuildLog" adjusted: its `writeFile(bp, …)` bootstrap now calls
`mkdir(dirname(bp), { recursive: true })` so `.factory/` exists before
the seeded BUILD.md write. The test itself continues to exercise the
append-preserves-existing-content behaviour — unaffected by the move.

**Workspace gates post-fix:**

- `pnpm build` — clean.
- `pnpm test` — 247 passing (logger 5, core 12, ipc 5, state 16,
  providers 37, assessor 34, wiki 18, channels 25, events 3, worker 22
  [+1 from the I005 regression test, 21 → 22], brain 42, daemon 28).
- `pnpm lint` — clean.
- `pnpm format:check` — clean.
- Live rerun of the Phase 5 close-out deferred to the close-out
  re-attempt session (same prompt, fresh workspace).

## Related

- I004 — concurrent sibling merges (RESOLVED via mutex). I004 and I005
  are symbiotic: before I004 was fixed, the race hid I005 (the second
  sibling was losing its merge silently, but only the first sibling had
  raised findings, and main's BUILD.md was never dirty long enough to
  block anything). After I004's mutex landed in Phase 5e, merges
  serialise correctly — which exposes I005 on the first finding-raising
  task.
- Directive auto-resume (Phase 4/5b/5c/5d carry-over, closed this
  session) — the `askUser`-on-`hadFailures` escalation triggered by
  I005's `gate.build: false` is what would leave the Run A directive
  stuck `running` without the reconcile sweep.
