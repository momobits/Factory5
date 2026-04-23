# Phase 10 — Assessor tier-3 (pluggable runtimes)

**Dependencies:** Phase 9 closed (tag `phase-9-web-ui-closed`)
**Estimated duration:** 2–3 sessions
**Status:** 🟢 active — opens with this commit

## Goal

Extend the assessor's ground-truth verification surface from Python-only
(tier-1 / tier-2 under [ADR 0017](../../../docs/decisions/0017-assessor-project-env-provisioning.md))
to **language-pluggable tier-3**: Node / Go / Rust projects can build,
test, and verify through the same `factory build` loop that ships
Python projects today. The forcing function is the observation — reiterated
at every Phase 7+ live run — that the current assessor is the ceiling on
what projects factory can produce. Broaden the ceiling → more real builds
→ more operator usage of the Web UI just shipped.

Per-step detail gets fleshed out as each sub-step opens (Phase 7 / Phase
8 / Phase 9 pattern).

## Charter

ADR 0017 shipped the **pluggable-runtime abstraction** at the interface
level: `ProjectEnvProvisioner` with per-language implementations. Phase 1
/ 2 filled in Python (via `uv`-style venv provisioning + `pytest` gate).
Phase 10 fills in the next tier, in priority order driven by what
factory5-built projects would realistically need:

1. **Node / TypeScript** — highest overlap with factory5's own toolchain
   (pnpm / tsup / vitest). The assessor's verify gate for a Node
   project should be a narrow `pnpm install → pnpm typecheck → pnpm
test` chain. Closest to zero-friction since the host machine
   already has pnpm.
2. **Go** — self-contained toolchain (`go build / go test`), trivial
   provisioner (no per-project env to manage — `go.mod` is enough).
   Good second target after Node.
3. **Rust** — `cargo build / cargo test`. Similar shape to Go.
   Provisioner is mechanical once Node + Go prove the abstraction.

Per-runtime scope:

- **Provisioner** — a new `ProjectEnvProvisioner` impl in
  `packages/assessor/src/runtimes/<lang>.ts`. Registered in the
  language-detection path that currently reads `spec.language`.
- **Verify gate** — maps the project's "did this build work" question to
  the runtime's native tools (typecheck + test for Node; `go test` for
  Go; `cargo test` for Rust). The gate is **identical** in shape to
  Python's today (pass/fail + findings list); only the command wiring
  differs.
- **Tests** — one assessor integration test per runtime that builds a
  minimal seeded project end-to-end. Windows + Linux; no skipping.

Deliberately out of scope for Phase 10:

- **Java / C# / C++** (heavier toolchains; separate phase if operator
  demand materialises).
- **Language detection heuristics** beyond `spec.language` — if an
  operator wants Node, the spec says Node. No polyglot detection.
- **Cross-language projects** (e.g. a Go backend + TypeScript frontend
  in one factory5 directive) — out of scope until a single-language
  project exists in all three.

## Sub-step schedule (preliminary — refined at 10.1 open)

| Step | Subject                                                                          |
| ---- | -------------------------------------------------------------------------------- |
| 10.1 | ADR 0026 — pluggable runtime contract (provisioner shape, failure-mode taxonomy) |
| 10.2 | Node/TypeScript runtime — provisioner + verify gate + one integration test       |
| 10.3 | Live validation — `factory build` a small Node project end-to-end                |
| 10.4 | Go runtime — provisioner + verify gate + one integration test                    |
| 10.5 | Live validation — `factory build` a small Go project end-to-end                  |
| 10.6 | Rust runtime — provisioner + verify gate + one integration test                  |
| 10.7 | Live validation — `factory build` a small Rust project end-to-end                |
| 10.8 | `factory init` — language picker in the new-project wizard                       |
| 10.9 | Phase close — tag `phase-10-assessor-tier3-closed`, scaffold Phase 11            |

Single-charter phase; sub-letter split (10a Node / 10b Go / 10c Rust)
possible if any single runtime's implementation balloons. Default is to
stay single-phase.

## Done criteria

- [ ] All sub-steps checked off with commit references
- [ ] `pnpm build` clean; `pnpm test` green (new integration tests
      included)
- [ ] `pnpm lint` + `pnpm format:check` clean
- [ ] Three live validation runs: Node / Go / Rust each builds and
      verifies green against a real spec
- [ ] [ADR 0026](../../../docs/decisions/) authored covering provisioner
      contract + failure-mode taxonomy + per-runtime command mapping
- [ ] `docs/PROGRESS.md` entry; `docs/Phase10_Progress.md` charter created
- [ ] `CompleteArchitecture.md` §? updated — §22 or an edit to §6
      (storage) + §9 (runtime) to surface pluggable-runtime as a
      first-class concept
- [ ] Working tree clean
- [ ] Tag `phase-10-assessor-tier3-closed`

## Rollback plan

`git reset --hard phase-9-web-ui-closed`. The new code is purely
additive (new provisioner impls + new assessor integration tests). The
Python runtime stays the default; a project without `spec.language`
continues to resolve to Python.

## Forward queue (after Phase 10)

- **Phase 11** — Web UI 9b (mutation surface: answer pending questions
  from the browser, kick off a build, configure budget defaults). The
  Phase 9 read-side demonstrated the pattern; 9b was explicitly
  deferred at Phase 9 charter time.
- **Phase 12** — Filesystem-scoping for worker subprocesses (Read /
  Glob / Grep whitelist scoped to the worker's active worktree +
  `.factory/` + template dirs). Surfaced as the Phase 8 "filesystem
  scoping" carry-forward; non-urgent until a verifier hallucinates
  from repo-internal files in a way that affects a build outcome.

Order is durable — only re-pick if a HALT event in Phase 10 reveals a
different priority (e.g. if Node projects reveal a provisioner-contract
flaw large enough to warrant revisiting Go/Rust shapes).
