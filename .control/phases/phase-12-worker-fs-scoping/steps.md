# Phase 12 Steps — Worker filesystem-scoping

> **Sub-step 12.1 opens next.** The rest are outlines that expand once
> 12.1's ADR pins the gate site + path-prefix algebra + out-of-scope
> behaviour + Bash story. Per the Phase 7 / 8 / 9 / 10 / 11 pattern,
> sub-step bodies grow as each session opens.

## Phase 12 — Worker filesystem-scoping

- [x] 12.1 — **ADR** for the worker-sandbox contract. Decisions to pin:
  - **Gate site** — MCP middleware (worker-side, intercepts every
    `Read` / `Glob` / `Grep` call before reaching host fs) vs.
    provider-CLI native config (cheaper if `claude-cli` supports it
    natively) vs. OS sandbox (heaviest). Survey what `claude-cli`
    exposes today; the cheapest cross-platform gate wins.
  - **Path-prefix algebra** — how the allowlist is expressed. Likely:
    `{ workspaceRoots: string[]; readOnlyRoots: string[]; allowSymlinks: boolean }`
    where each root is an absolute path. `Read('foo')` resolves
    relative to the worker's cwd, then the resolved absolute path is
    checked against `workspaceRoots ∪ readOnlyRoots`. Symlinks
    rejected (or followed-then-rechecked) per the `allowSymlinks` flag.
    Edge cases: trailing slashes, drive letters on Windows (case-insensitive
    prefix match), `..` traversal (resolve to absolute first), UNC
    paths.
  - **Out-of-scope behaviour** — silent skip (return empty result,
    risk of LLM confusion) vs. hard error (return MCP-layer error,
    LLM sees a clear "denied" signal) vs. advisory log (don't gate at
    all, just record). Recommend hard error so workers fail loudly
    when they reach for something they shouldn't.
  - **Bash story** — `Bash` is shell-shaped, not fs-shaped; MCP-layer
    gating can't cover `cat /etc/passwd` directly. Either: (a) accept
    the gap and document it as a Phase 12 limitation; (b) gate `Bash`
    by working-directory pinning + a thin command-prefix allowlist
    (heuristic, leaky); (c) defer Bash sandboxing to a follow-up
    phase via OS-level isolation (chroot / Job Objects).
  - **Worktree-only writes** — per the charter, writes are scoped to
    `<projectPath>/.factory/worktrees/task-<id>/`. Reads are broader
    (worktree + project `.factory/` + repo templates). Make the
    write-vs-read distinction explicit in the contract.
  - Output: `docs/decisions/0028-*.md` + INDEX row.

- [x] 12.2 — **Implementation.** Land the gate at the site 12.1's ADR
      picks. Likely a thin MCP middleware layer in `@factory5/worker`
      (or a new package if the gate logic warrants its own home).
      Existing call sites in `runWorker.ts` updated to pass the
      `workspaceRoots` / `readOnlyRoots` config to the spawned
      provider CLI. No behavioural change to provider-side code; the
      gate sits between the LLM's tool call and the fs call.

- [x] 12.3 — **Regression tests.** Two minimum:
  - **F001 replay** — re-run the verifier scenario from Phase 6c
    against a project where `node_modules/` lives in the parent
    factory5 checkout. Pre-fix: verifier hallucinates because it
    sees the parent's tree. Post-fix: verifier's filesystem view is
    the worktree only, so it can't reach the parent.
  - **Out-of-scope path** — worker calls `Read` on `/etc/passwd`
    (Linux) or `C:/Windows/System32/drivers/etc/hosts` (Windows).
    Pre-fix: succeeds, returns content. Post-fix: 12.1's chosen
    out-of-scope behaviour fires (likely a hard error visible in
    the worker log).
  - Cross-platform: both tests pass on Windows + Linux.

- [x] 12.4 — **Live validation.** Operator runs `factory build` on a
      Phase 10 fixture (Node, Go, or Rust — the cheapest one) under
      the new gate. Verify:
  - Build runs to completion (gate doesn't break legitimate work).
  - Worker logs show no out-of-scope reads being attempted (or, if
    any, they short-circuit cleanly via 12.1's chosen behaviour).
  - `node_modules/` (or equivalent) creates inside the worktree only,
    not bleeding into the parent project tree (paying down I013).

- [ ] 12.5 — **Phase close.** Tag `phase-12-worker-fs-scoping-closed`.
      `docs/Phase12_Progress.md` + `docs/PROGRESS.md` entry +
      `CompleteArchitecture.md` extension (worker-sandbox model).
      Scaffold Phase 13 (likely Bash sandboxing if 12.1's ADR
      carved it out, or another carry-forward by demand signal).
