# 0008 — Per-task git worktrees for agent isolation

- **Status:** Accepted
- **Date:** 2026-04-18

## Context

Phase 2 workers spawn coding-agent subprocesses with write-capable tools
(ADR 0007). Those subprocesses must not:

- Stomp on each other when tasks run concurrently (the pool launches up to
  `min(4, cpuCount)` at once; ADR 0010).
- Leave a failed task's half-written state in the main working tree where
  the next build — or the user — would have to manually clean it up.
- Corrupt the project's history when a task produces commits that later
  turn out to be garbage.

The most battle-tested way to give each task its own filesystem while
sharing git history is `git worktree add`. Every worktree has its own
working directory and its own current branch but shares the object store
with the main repo, so merging back is a cheap in-process operation and
there's no double-disk-space cost.

## Decision

**Layout.** Per-task worktrees live at

```
<projectPath>/.factory/worktrees/task-<taskId>/
```

`.factory/` is added to the project's top-level `.gitignore` on first use
so worktree directories (and other factory-scoped state) never leak into
the project's main branch.

**Branch naming.** Each task gets a branch `factory/task-<short>`, where
`<short>` is the trailing 8 characters of the task ULID, lowercased.
Collision probability within a single project is negligible (two ULIDs
would need to share an 8-char Crockford-base32 suffix); if it ever does
collide simple-git surfaces a deterministic "branch already exists" error
that the worker treats as a hard failure.

**Repository bootstrap.** If the project is not yet a git repo,
`ensureProjectRepo` runs `git init --initial-branch=main`, stages and
commits everything present, and sets a repo-local `user.email` /
`user.name` _only when the global git config has neither_. Users who
already have git configured are unaffected; fresh CI machines or newly
provisioned dev boxes don't silently fail their first commit.

**Cleanup policy.** `cleanupWorktree({ outcome })`:

- `success` — commit any outstanding agent-produced changes in the
  worktree, switch the main repo to the base branch (if necessary), merge
  the task branch with `git merge --no-ff -m 'factory: merge <branch>'`,
  then `git worktree remove --force` and delete the branch.
- `failure` — leave the worktree, branch, and any uncommitted work in
  place so an operator can diff the failed branch against `main`.

Merges run sequentially from the pool even when workers themselves are
concurrent: the pool awaits each task's `runWorker`, which calls
`cleanupWorktree` before returning. This serialises the main-branch
updates, making conflicts between concurrent tasks a rare surprise rather
than the common case. A conflicted merge aborts (`git merge --abort`),
the worktree is preserved, and the task's outcome is marked failed with
the merge error in `TaskResult.error`.

**Branch naming function.** Exported as `branchNameFor(taskId)` so any
consumer that needs to reference the branch pre-allocation (heartbeats,
logs, failure diagnostics) can match deterministically.

## Consequences

**Positive:**

- Concurrent agents cannot collide on the filesystem; they literally can't
  see each other's work.
- Failed runs leave a clean, inspectable audit trail (a branch + a
  worktree the operator can `cd` into).
- Merge-back is an explicit, auditable step — every factory-produced
  change has a merge commit with a predictable message, so `git log` on
  the main branch reads as a ledger of factory activity.
- Windows/Linux parity: `git worktree` is in stock git on both and has
  been stable for years.

**Negative:**

- Every build touches the project's git history. Users who prefer a
  "factory runs but doesn't commit" mode would need an opt-out. For
  Phase 2 we accept this; a `--no-commit` flag can be added in Phase 3.
- `.factory/worktrees/` accumulates on failure. We log the preserved path
  at `warn` so it's visible; a future `factory cleanup` command can
  garbage-collect after operator review.
- Concurrent merges are serialised, so the pool's parallelism is capped
  by whichever tasks finish simultaneously. In practice merges are
  millisecond-cheap; this is not the bottleneck.

**Reversible?** Yes. `cleanupWorktree` is the one choke point; future
policies (rebase instead of merge, squash commits, dry-run mode) slot in
there without touching runWorker.

## Alternatives considered

- **Copy the project directory per task** instead of using worktrees.
  Rejected: double-disk-cost, and merging back is a diff-and-apply dance
  we'd have to maintain.
- **Run every agent in the main working tree with a mutex.** Rejected:
  forfeits parallelism (the whole point of the pool) and leaves the tree
  dirty on a failed task.
- **Name the branch after the whole ULID.** Rejected as noisy in `git
log`; 8 chars is enough to disambiguate within a project.
- **Keep the initial commit manual** (fail if repo is empty, ask user to
  commit). Rejected: kills the "just run factory on a fresh spec"
  experience that Phase 1's `factory init` / `factory build template`
  flow promises.
