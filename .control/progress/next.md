# Next session — paste this to start

Phase 11 closed 2026-04-26 (tag `phase-11-web-ui-9b-closed`). All 7
sub-steps shipped: ADR 0027 + three backend mutation routes + SPA write
affordances + GET /api/v1/projects + operator-driven live browser smoke.
The Web UI is now a complete operating surface — operators can answer
pending questions, kick off builds, and configure per-project budget
defaults from the browser without dropping back to the CLI.

Workspace: 717 tests across 14 packages green. lint + format clean.
Builds clean across 14 packages + 3 apps.

## Pickup

Read `CLAUDE.md`, then `.control/progress/STATE.md` (current phase /
step / carry-forwards), then the Phase 12 charter at
`.control/phases/phase-12-worker-fs-scoping/{README.md,steps.md}`. The
`README.md` lays out the three forcing functions that converge on this
phase: F001 (verifier hallucination, Phase 6c), Phase 8's deferred
filesystem-scoping carry-forward, and Phase 10's I013 worktree-cleanup
pain. Phase 12 pays down all three with one mechanism.

Run `/session-start` for the full drift check.

## Next concrete work — 12.1 (ADR for the worker-sandbox contract)

Five decisions to pin in `docs/decisions/0028-*.md` before any code
lands:

1. **Gate site.** MCP middleware (worker-side, intercepts every
   `Read` / `Glob` / `Grep` call before reaching host fs) vs.
   provider-CLI native config (cheaper if `claude-cli` supports it
   natively) vs. OS sandbox (heaviest). Survey what `claude-cli`
   exposes today; the cheapest cross-platform gate wins. Likely
   landing: MCP middleware.
2. **Path-prefix algebra.** How the allowlist is expressed —
   `{ workspaceRoots: string[]; readOnlyRoots: string[]; allowSymlinks: boolean }`
   is the candidate shape. `Read('foo')` resolves relative to cwd,
   absolute path checked against `workspaceRoots ∪ readOnlyRoots`.
   Edge cases: trailing slashes, drive letters on Windows
   (case-insensitive prefix match), `..` traversal (resolve to
   absolute first), UNC paths.
3. **Out-of-scope behaviour.** Silent skip vs. hard error vs.
   advisory log. Recommend hard error so workers fail loudly when
   they reach for something they shouldn't.
4. **Bash story.** `Bash` is shell-shaped, not fs-shaped; MCP-layer
   gating can't cover `cat /etc/passwd` directly. Either accept the
   gap as a Phase 12 limitation, gate `Bash` by working-directory
   pinning + a thin command-prefix allowlist (heuristic, leaky), or
   defer Bash sandboxing to a follow-up phase via OS-level isolation.
5. **Worktree-only writes.** Per the charter: writes scoped to
   `<projectPath>/.factory/worktrees/task-<id>/`. Reads broader
   (worktree + project `.factory/` + repo templates). Make the
   write-vs-read distinction explicit in the contract.

Output: `docs/decisions/0028-*.md` + INDEX row. The ADR is design-only
($0 spend); 12.2 implementation kicks off the next sub-step.

## Then in order

**12.2 — Implementation.** Land the gate at the site 12.1 picks.
Likely a thin MCP middleware layer in `@factory5/worker` (or a new
package if the gate logic warrants its own home). Existing call sites
in `runWorker.ts` updated to pass `workspaceRoots` / `readOnlyRoots`
config to the spawned provider CLI. No behavioural change to
provider-side code; the gate sits between the LLM's tool call and the
fs call.

**12.3 — Regression tests.** Two minimum:

- F001 replay — re-run the Phase 6c verifier scenario against a
  project where `node_modules/` lives in the parent factory5 checkout.
  Pre-fix: verifier hallucinates because it sees the parent's tree.
  Post-fix: verifier's filesystem view is the worktree only.
- Out-of-scope path — worker calls `Read` on `/etc/passwd` (Linux) or
  `C:/Windows/System32/drivers/etc/hosts` (Windows). Pre-fix: succeeds.
  Post-fix: 12.1's chosen out-of-scope behaviour fires (likely a hard
  error visible in the worker log).

Cross-platform: both tests pass on Windows + Linux.

**12.4 — Live validation.** Operator runs `factory build` on a Phase
10 fixture under the new gate. Verify build runs to completion (gate
doesn't break legitimate work), worker logs show no out-of-scope reads
being attempted (or any short-circuit cleanly), and `node_modules/`
creates inside the worktree only — paying down I013.

**12.5 — Phase close.** Tag `phase-12-worker-fs-scoping-closed`.
Author `docs/Phase12_Progress.md`, prepend `docs/PROGRESS.md`, extend
`CompleteArchitecture.md` with the worker-sandbox model. Scaffold
Phase 13 (likely Bash sandboxing if 12.1's ADR carved it out, or
another carry-forward by demand signal).

## Mid-phase opportunities

If a session lands in `runArchitect`, brain inbound, or directive
creation for any reason, two carry-forwards are one-commit wins:

- **I009 fix** — extract `resolveDirectiveLimits(projectMeta, cfg,
explicitFlags)` to `@factory5/brain` or `@factory5/wiki`; replace
  the three open-coded resolvers (CLI, daemon, Telegram inbound). After
  Phase 11.4 the Telegram path is two tiers behind the CLI/daemon
  paths.
- **I014 fix** — add a `git add docs/ && git commit` step at the end
  of `runArchitect` if `isGitRepo(projectPath)` succeeds. Targets the
  architect-on-resume dirty-tree footgun.

## Carry-forward (still non-blocking)

- **I009** (MEDIUM, OPEN) — Telegram/Discord `/build` inbound doesn't
  inherit budget defaults. After 11.4 it skips two tiers (project +
  config), not one. Recorded as ADR 0027 §4 carry-forward.
- **I012** (LOW, OPEN) — `maybeAnswerPendingQuestion` FIFO matcher.
- **I014** (MEDIUM, OPEN) — architect-on-resume leaves wiki edits
  uncommitted; manual workaround (`git add docs/ && git commit`)
  cleared the issue in 10.5.
- **Stale-dist dev-loop gotcha** — needs design (conditional exports
  OR app-side bundling with full transitive npm deps); workaround is
  `pnpm build` after editing workspace deps before running
  `pnpm factoryd`.
- **`factory ui-token` CLI command** (ADR 0025 §2) — operator closes
  terminal → loses dashboard URL.
- **Phase 6 operator follow-up:** revoke PAT, `gh repo delete`, env
  var cleanup.

Report back on wake-up with a status block in this shape:

```
Phase 12 — 0/5 closed; 12.1 ADR for worker-sandbox contract next
Last action: chore(phase-11) <SHA> (phase close + Phase 12 scaffold)
Git: branch=main, last=<latest-sha>, uncommitted=no, tag=phase-11-web-ui-9b-closed
Open blockers: 0 (I009 + I012 + I014 non-blocking)
Proposed next action: 12.1 — survey claude-cli's native fs-scoping config + author ADR 0028
Ready to proceed?
```
