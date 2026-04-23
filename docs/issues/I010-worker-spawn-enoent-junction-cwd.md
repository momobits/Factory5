---
id: I010
severity: LOW
area: worker/run-worker
status: WONTFIX
created: 2026-04-23
resolved: 2026-04-23
---

# Worker subprocess spawn fails with `ENOENT` when `cwd` is inside a Windows directory junction

## Description

During Phase 8.7 live validation (2026-04-23), a tool-using worker
spawn failed immediately with `spawn C:\Users\Momo\.local\bin\claude.EXE
ENOENT` even though the claude binary exists, is executable, and can
be spawned directly from the same factoryd process with the exact
same path (verified by running
`node -e "require('node:child_process').spawn(...)"` in a sibling
shell). The failing call's `cwd` was a relative path that resolved
through a Windows directory junction:
`ask-user-smoke\.factory\worktrees\task-...`, where `./ask-user-smoke`
was a junction → `C:\Users\Momo\factory5-workspace\ask-user-smoke`.

Node.js on Windows surfaces `CreateProcess`'s `STATUS_NOT_FOUND` for
a bad `cwd` as an `ENOENT` error whose message references the
_executable_ path, not the _directory_ path — a known Node quirk. The
hypothesis is that `CreateProcess` failed on the junction-relative
cwd, not on the binary.

**Status: hypothesis only.** The junction was introduced as a
workaround for issue I011 (Telegram inbound doesn't resolve project
paths — filed as part of the 8.7 close). Once I011 is fixed properly,
no junction is needed; the worker's `cwd` points to a real workspace
directory via an absolute path. If the failure does not recur after
I011 is fixed, this issue closes as `WONTFIX` / `NOT_REPRODUCED`. If
it does recur, the spawn call in `packages/worker/src/run-worker.ts`
(or in `packages/providers/src/claude-cli.ts`'s `spawnClaude`) needs
to be hardened — likely by resolving `cwd` to an absolute path before
handing it to `spawn`, and verifying it exists first.

## Repro / evidence

```
{"level":"error","time":"2026-04-23T10:42:35.610Z","pid":31440,
 "component":"worker",
 "err":{"code":"ENOENT","errno":-4058,
        "syscall":"spawn C:\\Users\\Momo\\.local\\bin\\claude.EXE",
        "path":"C:\\Users\\Momo\\.local\\bin\\claude.EXE",
        "spawnargs":["-p","--output-format","stream-json", ...]},
 "taskId":"01KPWYYDFT206TJ8FJSFW6YTFB",
 "msg":"worker: provider stream failed"}
```

Preceding worktree log:

```
worktree: allocating  worktreePath:"ask-user-smoke\\.factory\\worktrees\\task-..."
```

— note the relative path (no drive letter).

Direct verification that the binary itself spawns fine from the same
process context:

```
$ node -e "const {spawn}=require('node:child_process'); const p=spawn(
    String.raw`C:\Users\Momo\.local\bin\claude.EXE`, ['--version'],
    {stdio:'pipe'}); p.stdout.on('data', d => console.log(d.toString()));"
2.1.118 (Claude Code)
```

## Hypothesis

Two independent factors:

1. `git worktree add <path>` against a junction `<path>` may record
   the worktree at the junction _target_ rather than the junction
   path, leaving the junction-relative subdirectory absent on disk
   when the worker subsequently tries `spawn({cwd})`.
2. Even if the cwd directory exists, Node's `spawn` with a
   junction-relative `cwd` may hit `CreateProcess` path-resolution
   quirks on Windows.

Either way, the pragmatic fix is to ensure `cwd` is an absolute,
canonicalised path to a directory known to exist before `spawn`.
Defensive check + loud error beats the confusing `ENOENT on binary`
symptom.

## Resolution

Closed WONTFIX / NOT_REPRODUCED on 2026-04-23. Phase 8.7's re-run after
I011 was fixed showed the scaffolder worker spawning cleanly
(exitCode=0, filesChanged=6, durationMs=43025) against the absolute
workspace path, with no junction anywhere in the `cwd` chain. Both
subsequent builder tasks (01KPX24AFGD8AWBGJGVVMKM703 and
01KPX24AFGJF1A7QM2GC8QR94W) spawned and completed normally too. The
ENOENT observed on the prior run's scaffolder was therefore a junction
artifact, not a defect in the spawn layer — consistent with this
issue's hypothesis.

No code change is warranted; the hardening direction in the hypothesis
(canonicalise `cwd` before spawn, fail loudly on missing dirs) is worth
holding as a defensive improvement if a similar symptom appears again,
but without a concrete repro it'd be speculative.
