---
id: I013
severity: MEDIUM
area: worker/worktree
status: OPEN
created: 2026-04-24
---

# Worker worktree `git remove --force` fails with "Directory not empty" when the worker created a `node_modules/` inside its worktree

## Description

When a worker for a Node/TypeScript project runs `pnpm install` (or `npm
install`) inside its allocated worktree — often to verify its own edits —
the resulting `node_modules/` tree prevents `git worktree remove --force`
from cleaning up the worktree at end-of-task. simple-git / git surface
the error:

```
error: failed to delete '.../.factory/worktrees/task-<ULID>':
       Directory not empty
```

The task is flagged `exitCode: 1` even though the agent's source-file
changes committed and merged cleanly. Downstream tasks that depend on it
get skipped by the pool (`pool: skipping — upstream dependency failed`).

The leftover worktree dir contains at least `node_modules/`,
`pnpm-lock.yaml`, `package.json`, `src/`. All ignored or committed files;
nothing Git needs to preserve.

## Repro / evidence

Observed during 10.3 Node live validation (2026-04-24T17:30Z), directive
`01KQ085DM30HWR04093EQ056K1`, project
`~/factory5-workspace/log-totals-cli`. Two of the five planned tasks
(both `builder` agents running `claude-opus-4-7`) hit this on exit; the
scaffolder task passed because it didn't run `pnpm install`. Net pool
outcome: 1/5 succeeded, 4/5 failed (2 cleanup failures + 2
dependency-skipped). Node assessor runtime itself was unaffected — pnpm
install / typecheck / vitest all ran green when finally invoked against
the project root.

Specific failing git invocation (from log stack trace):

```
git worktree remove --force '<path>'
```

Windows + simple-git 3.36.0 + Node 22.22.2.

## Hypothesis

Two plausible fixes, in priority order:

1. **Cheapest** — before `git worktree remove --force`, `rimraf` any
   `node_modules/` / `.venv/` / other ignored-but-heavy dirs inside the
   worktree. Git's `--force` does not override Windows "Directory not
   empty" errors from file handles or long paths; an explicit recursive
   remove bypasses both. Low blast radius, language-agnostic.
2. **Deeper** — teach workers that they should not need to run
   `pnpm install` inside their worktree at all. The assessor already
   provisions the project env (ADR 0026). The worker's allowed-tools
   should continue to include `Bash` but the prompt / skill nudges
   them away from env-setup side effects. Bigger change; likely
   overkill given option 1.

I004 and I005 both touched worktree-lifecycle issues; this is adjacent
but narrower — cleanup-phase only, no data loss, no concurrent-merge
risk.

Cross-runtime: Python workers that create `.venv/` inside the worktree
would hit the same failure mode. `~/factory5-workspace/ask-user-smoke`
(Phase 8 Python project) didn't repro because the assessor runs
`pip install -e .` against a venv in the project root, not the worktree.

## Resolution

_(filled when work begins)_
