---
id: I014
severity: MEDIUM
area: brain/architect
status: OPEN
created: 2026-04-26
---

# Architect re-running on an existing project leaves wiki edits uncommitted, dirtying the gate

## Description

When the architect agent re-runs on a project that already has a git repo
and a tracked `docs/knowledge/*.md` wiki (typical for `factory resume`),
its writes land as **modifications to tracked files** in the main worktree
and are never auto-committed. The assessor's `gitClean` check then flips
`gate.verify` to false even though the runtime gate (build + tests) and
all artifacts pass cleanly.

In a fresh build the issue is invisible: `ensureProjectRepo` (called by
the first scaffolder worker) does the project's initial commit, which
captures the architect's then-untracked wiki pages along with the
scaffolder's other outputs.

## Repro / evidence

10.5 Go live validation (2026-04-26):

1. First run created the project and committed everything (initial
   commit captured architect output). Verify-gate failed for an
   unrelated runtime-parser issue.
2. After fixing the parser and `factory resume`-ing the project, the
   architect re-ran on the existing wiki and modified
   `docs/knowledge/{overview,modules,testing}.md`. Workers ran, all
   committed cleanly via the worktree merge. Assess saw three dirty
   files in main → `gitClean: false` → `gate.verify: false` despite
   `gate.build = true`, `gate.integration = true`, 34/0/0 tests.
3. Manual `git add docs/ && git commit` cleaned the tree; a one-shot
   re-assess produced `gate.verify: true`.

Affected directive: `01KQ4H8Y66HVWJJXAYTS1BJE2Q`. Project:
`~/factory5-workspace/go-line-counter`.

## Hypothesis

Two reasonable fixes, in priority order:

1. **Architect stages + commits its own writes** at the end of
   `runArchitect` if a git repo exists in `projectPath`. Pattern:

   ```ts
   await git.add(['docs/']);
   const status = await git.status();
   if (status.staged.length > 0) {
     await git.commit('factory: architect output');
   }
   ```

   Local to one file, low blast radius.

2. **Brain loop runs a "commit any uncommitted state" sweep** before the
   first worker pool task allocates a worktree. Wider, but also catches
   any other phase that might write to main without committing.

Option 1 is the targeted fix; option 2 is defensive and catches future
similar issues.

## Resolution

_(filled when work begins)_
