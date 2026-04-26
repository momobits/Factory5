# Phase 12 — Worker filesystem-scoping

**Dependencies:** Phase 11 closed (tag `phase-11-web-ui-9b-closed`)
**Estimated duration:** 2–3 sessions
**Status:** 🟢 active — opens with this commit

## Goal

Scope the worker subprocess's filesystem view to **what the task needs to
see and nothing more**: the active worktree at
`<project>/.factory/worktrees/task-<id>/`, the project's `.factory/`
directory, and any factory5-managed template / config dirs. Today the
worker runs with unconstrained `Read` / `Glob` / `Grep` tools — it can
read `node_modules/` from the factory5 checkout, neighbouring projects
under the same workspace, or `~/.ssh/`, anywhere the host user has
read access.

Forcing functions:

- **Phase 6c F001** — the verifier hallucinated about file absence
  partly because its model context included irrelevant repo-internal
  files. ADR 0018 demoted it to advisory; scoping its filesystem view
  is the durable fix.
- **Phase 8 carry-forward** — surfaced when the worker MCP `ask_user`
  flow shipped: ADR 0024 explicitly noted the worker still has full
  filesystem access, deferred the scoping question to a later phase.
- **Phase 10 I013** — `git worktree remove --force` failed on Windows
  because workers polluted their worktree with `node_modules/`. A
  scoped worker should never reach into the parent project's tree to
  copy or symlink dependency caches; `node_modules/` only exists if
  the worker created it inside its sandbox.

This phase pays down all three with one mechanism.

## Charter

The worker subprocess (`@factory5/worker`) currently spawns the
provider CLI (`claude-cli`, today) with `allowedTools: ['Read',
'Write', 'Edit', 'Bash', 'Glob', 'Grep']` (see `worker:
starting (tool-using)` log). The provider CLI grants those tools host-wide
read access by default — `Read('/etc/passwd')` would succeed on Linux,
`Read('C:/Users/Momo/.ssh/id_rsa')` on Windows. Phase 12 narrows the
allowed-fs surface to:

1. `<projectPath>/.factory/worktrees/task-<taskId>/` — the active
   worktree (full read + write).
2. `<projectPath>/.factory/` (read-only) — workers can read prior
   plans / findings / project.json metadata but not write outside the
   worktree.
3. Repository templates dir (read-only) — exact path resolved via
   `findRepoTemplatesDir` from `@factory5/wiki`. Workers reference
   templates without copying them inside the worktree.
4. `Bash` — separately scoped: working directory always pinned to the
   worktree; subprocesses inherit the same path-prefix gate where
   feasible (this is the imperfect part — `cat /etc/passwd` from
   inside `Bash` is harder to gate than `Read('/etc/passwd')` directly).

Three places the gate could live, with a decision to pin in 12.1 (ADR):

- **MCP layer (worker-side)** — the worker speaks MCP to the provider
  CLI for tool use. A custom MCP middleware can inspect every Read /
  Glob / Grep call and short-circuit out-of-scope paths before they
  reach the host filesystem. Cleanest gate site; works regardless of
  which provider CLI is in use as long as it's MCP-shaped. Caveat:
  `Bash` tool is shell-shaped, not fs-shaped, so MCP gating can't
  cover it directly.
- **Provider config** — pass an allowlist to the provider CLI at
  startup if it natively supports one. Cheapest if available; depends
  on whether `claude-cli` exposes such config (TBD in 12.1).
- **OS sandbox** — actual chroot / Job-Object / namespace-style
  isolation. Heaviest, most secure, least cross-platform.

For Windows + Linux parity at acceptable cost, the MCP-layer gate is
the most likely landing spot, with Bash treated separately as a known
gap (Phase 12 charter ships the fs gate; Bash sandboxing is a
follow-up unless 12.1's ADR sees a cross-platform path).

Per-step scope:

- **ADR** — 12.1 pins the gate site, the path-prefix algebra, the
  out-of-scope behaviour (silent skip / hard error / advisory), and
  the Bash story.
- **Implementation** — 12.2 wires the gate. Likely lives in a new
  module under `@factory5/worker` or a thin wrapper package.
- **Regression test** — 12.3 covers the F001 replay (verifier sees
  worktree only) + an explicit "worker tries to read out-of-scope
  path" → expected behaviour test. Cross-platform.
- **Live validation** — 12.4 builds a real project under the new
  gate. A `log-totals-*` Phase 10 fixture is the right cheap target.
- **Phase close** — 12.5 tags `phase-12-worker-fs-scoping-closed`,
  scaffolds Phase 13.

Deliberately out of scope for Phase 12:

- **Bash sandboxing** unless 12.1's ADR finds a cross-platform path.
  Not a Phase 12 goal; tracked as a known gap.
- **Network egress scoping.** Workers can hit any URL today
  (`pnpm install` reaches npm, `cargo` reaches crates.io). Out of
  scope; covered separately if a future need surfaces.
- **Process / memory isolation.** OS-level jail is too heavy for
  Phase 12's acceptable-cost target. Path-prefix gating is enough to
  fix the verifier-hallucination + cross-project-leak surface.

## Sub-step schedule (preliminary — refined at 12.1 open)

| Step | Subject                                                                     |
| ---- | --------------------------------------------------------------------------- |
| 12.1 | ADR — gate site + path-prefix algebra + out-of-scope behaviour + Bash story |
| 12.2 | Implementation — wire the gate in worker MCP layer                          |
| 12.3 | Regression tests — F001 replay + cross-platform out-of-scope path test      |
| 12.4 | Live validation — `factory build` a Phase 10 fixture under the new gate     |
| 12.5 | Phase close — tag `phase-12-worker-fs-scoping-closed`, scaffold Phase 13    |

Single-charter phase. Sub-letter split possible (12a fs-scoping / 12b
Bash-sandbox) if 12.1's ADR opens that door.

## Done criteria

- [ ] All sub-steps checked off with commit references
- [ ] `pnpm build` clean; `pnpm test` green (regression tests included)
- [ ] `pnpm lint` + `pnpm format:check` clean
- [ ] Live validation: build runs to completion under the new gate;
      worker logs show out-of-scope reads being short-circuited
      (or the equivalent for the chosen gate site)
- [ ] ADR for the gate contract authored
- [ ] `docs/PROGRESS.md` entry; `docs/Phase12_Progress.md` charter created
- [ ] `CompleteArchitecture.md` extended with the worker-sandbox model
- [ ] Working tree clean
- [ ] Tag `phase-12-worker-fs-scoping-closed`

## Rollback plan

`git reset --hard phase-11-web-ui-9b-closed`. The new gate is purely
additive (a middleware layer in front of the existing provider CLI
spawn); removing it returns workers to host-wide fs access.

## Forward queue (after Phase 12)

- **Bash sandboxing** — if 12.1's ADR carves it out, becomes a Phase 13
  candidate. Cross-platform sandbox-exec / Job Objects / namespace-
  based isolation is non-trivial; only worth pursuing if a real
  incident surfaces (e.g. a verifier `cat ~/.ssh/id_rsa` event in a
  live run).
- **Network egress scoping** — long-tail concern; today workers reach
  npm / crates.io / etc. for legitimate dep installs. Wait until an
  egress-policy demand signal materialises.
- **I009 fix** — extract shared `resolveDirectiveLimits(projectMeta,
cfg, explicitFlags)` helper so Telegram / Discord inbound `/build`
  pick up the same three-tier resolution that 11.4 wired into the CLI
  - daemon paths. Carry-forward from Phase 11; can land mid-12 or as
    a standalone fix commit.
- **I014 fix** — architect's wiki edits should commit themselves on
  resume so `gate.verify` doesn't dirty-trip. Carry-forward from
  Phase 10.

Order is durable — only re-pick if a HALT event reveals a different
priority.
