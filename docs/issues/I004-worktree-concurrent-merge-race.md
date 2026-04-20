---
id: I004
severity: HIGH
area: worker/worktree
status: RESOLVED
created: 2026-04-19
resolved: 2026-04-19
---

# Concurrent sibling worktree merges silently lose commits

## Description

When the pool runs two sibling builders concurrently (both depend only on
the scaffolder, no edge between them), their worktree branches both merge
back into `main` as they finish. On Windows, the **second** merge is
logged as `worktree: merged and removed` but does **not** land — the
project's `main` reflog never records it. Every file the lost builder
produced is missing from `main` after `pool: complete`.

The downstream builder (the CLI / dispatcher that reads both sibling
outputs) then branches from a `main` that's missing the lost sibling's
files, sees the module it expected as absent, and often re-creates a
stub of it. When its own worktree branch tries to merge back, git
refuses with:

```
fatal: Exiting because of an unresolved conflict.
error: Merging is not possible because you have unmerged files.
```

The main repo is left in a state where `git status` reports "nothing to
commit, working tree clean" (the merge aborted cleanly), but the index
is in some broken state internally.

Effect on the build: `gate.build: false` (imports of the lost module
fail, imports of the CLI dispatcher fail), `gate.verify: false`. Sibling
tests that happened to land run green; everything else cascades to
missing-module import errors.

## Repro / evidence

Reproduced cleanly on **both** Phase 5d live runs:

- **Run A** — `factory build example` (directive
  `01KPJHBK5Z2ZB7BPGE0N93M5MG`, 2026-04-19):
  - Builders 1 (`models`) merged OK (reflog index 1).
  - Siblings `api` + `formatter` started concurrently at 09:40:01.872.
  - `formatter` finished first at 09:43:14 → merged OK (reflog index 3).
  - `api` finished second at 09:45:18 → log says "merged and removed"
    but reflog never records the merge.
  - `cli` branched from main, didn't find `src/api.py`, wrote its own
    47-line stub, then failed to merge back.
  - Result: `gate.build: false`, `testsPassed: 30` (models + formatter
    only), `main` missing `api.py` + `cli.py` + `test_api.py` + `test_cli.py`.
- **Run B** — `factory build parallel-example` (directive
  `01KPJJP52JCWJVH2DVBVCSACVE`, 2026-04-19):
  - Siblings `rot13` + `art` started concurrently at 09:58:14.283.
  - `rot13` finished first at 09:59:20 → merged OK (reflog index 2).
  - `art` finished second at 09:59:38 → log says "merged and removed"
    but reflog never records the merge.
  - `cli` branched from main, didn't find `src/art.py`, failed to merge
    back at 10:02:48.
  - Result: `gate.build: false`, `testsPassed: 6` (rot13 only), `main`
    missing `art.py` + `cli.py` + `test_art.py` + `test_cli.py`.

Both runs ended in the same `askUser`-on-`hadFailures` escalation that
Phase 5b/5c hit.

## Hypothesis

Two candidate causes, both plausible:

1. **Concurrent `git merge` invocations on the same repo state on
   Windows.** Even if the pool runs merges sequentially (they do —
   execution is inside `executeTask`'s `finally` block), the
   `.git/index.lock` acquisition can race under Windows NTFS semantics
   when two worktrees share the same main-branch HEAD. If
   `worker.worktree` advances `main` without checking that its
   pre-merge HEAD is still the tip, the second merge may think it ran
   against the original main and then silently no-op when trying to
   update the ref.
2. **`git merge` inside a worktree vs in the main checkout.** The
   factory's worktree helper likely performs the merge from inside the
   worktree's directory with `--no-ff`, then the worktree is "merged
   and removed". If the worktree wasn't actually the canonical `main`
   checkout, the merge may have only updated the worktree's ref, not
   main. The first builder's merge worked because main wasn't stale; by
   the time the second finished, main had advanced and the second
   merge hit an out-of-date ref it didn't reconcile.

Either way, the symptom is the same: the pool happily reports success
on every individual task, but the aggregate merged state is
non-deterministic under concurrency.

## Resolution

Resolved 2026-04-19 (Phase 5e — I004 session).

**Fix in `packages/worker/src/worktree.ts`:**

1. **Project-level async mutex** (`projectMergeQueues`, a module-level
   `Map<string, Promise<unknown>>`). `mergeAndRemove` chains onto the
   tail before doing any merge work. Map entries clear themselves once
   no later caller has chained, so the table doesn't leak. The chain
   uses `.catch(() => undefined)` so one failed merge can't poison
   subsequent ones — every caller still sees its own error, but the
   queue keeps draining. Key normalises with `path.resolve` and (on
   Windows) `.toLowerCase()` so `.`, relative, and absolute forms
   collapse to the same entry.

2. **Post-merge HEAD verification** (`verifyHeadAdvanced`). After
   `git merge --no-ff` we re-read `git rev-parse <baseBranch>` and
   throw a clear error if HEAD didn't advance — defence-in-depth
   against any silent-no-op merge that the mutex didn't catch.

3. **Skip-empty-merge guard.** If the worker produced no commits
   ahead of the base branch, we skip the merge entirely (rather than
   running `git merge --no-ff` which would no-op as "Already up to
   date." and then trip the HEAD-didn't-advance check). Worktree +
   branch are still removed, so a "worker did nothing" task still
   cleans up.

**Test coverage** added to `packages/worker/src/worktree.test.ts`
(+5 tests, 16 → 21 in this file; workspace total 231 → 236 modulo
the autoresume session's WIP):

- `cleanup success on a branch with no new commits removes worktree
without throwing` — covers the skip-empty-merge path.
- `two concurrent successful cleanups on the same project both land in
main (I004)` — fires both cleanups via `Promise.all`, asserts both
  files end up in main, both branches removed, all 5 commits reachable
  from main (initial + worker-A + merge-A + worker-B + merge-B).
- `a failing cleanup does not poison subsequent merges on the same
project` — proves the `.catch(() => undefined)` chaining: deliberate
  failure of cleanup A leaves cleanup B fully successful.
- `verifyHeadAdvanced > throws when HEAD is unchanged` and
  `verifyHeadAdvanced > returns the new HEAD when the branch has
moved` — direct unit tests for the verification helper.

The unit tests exercise the mutex's mechanical contract. The race
itself may not reproduce reliably under Linux/CI semantics, so the
**live rerun on `parallel-example`** is the authoritative regression
test. That live rerun is deferred to the Phase 5 close-out session:
this checkout currently has the parallel autoresume session's
in-progress state-package WIP layered on top, which leaves the CLI
unbootable (`@factory5/state` does not yet re-export
`MarkBlockedError`, which `packages/cli/src/commands/directive.ts`
imports). Per the session prompts, both fixes get merged before the
close-out runs the end-to-end validation.

## Related

- I001 — planner parallelism (resolved in Phase 5d). The sibling
  parallelism I001 enables is what exposes this race.
- Directive-auto-resume gap (Phase 4/5b/5c/5d carry-over) — the
  escalation triggered by this race's `gate.build: false` is what
  leaves directives stuck `running` when the brain dies.
