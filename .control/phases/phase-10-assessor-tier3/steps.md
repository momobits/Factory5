# Phase 10 Steps — Assessor tier-3 (pluggable runtimes)

> **Sub-step 10.1 opens next.** The rest are outlines that expand once
> 10.1's ADR pins the provisioner contract + failure-mode taxonomy.
> Per the Phase 7 / 8 / 9 pattern, sub-step bodies grow as each session
> opens.

## Phase 10 — Assessor tier-3

- [x] 10.1 — **ADR 0026** pluggable-runtime contract. Decisions to pin:
  - **Provisioner shape** — does the provisioner fully own the project's
    env (install deps, set up typecheck tooling) or is the project
    expected to be runnable out-of-the-box (the assessor just runs the
    gate commands)? Today's Python provisioner (tier-2, ADR 0017) owns
    the venv; Node/Go/Rust may all benefit from not-owning — the
    project's own `package.json` / `go.mod` / `Cargo.toml` is the env.
  - **Verify-gate command mapping** — which commands count as the
    "did this project build + pass tests" signal per runtime? Node:
    `pnpm install → pnpm typecheck → pnpm test`? Go:
    `go build ./... && go test ./...`? Rust: `cargo test`? What if a
    project's `package.json` has no `typecheck` script?
  - **Failure-mode taxonomy** — how does the assessor distinguish
    compile failure vs. test failure vs. env-setup failure vs. missing
    tool? The finding taxonomy (severity + tag) needs to encode this
    uniformly across runtimes so Phase 9's findings UI surfaces are
    agnostic.
  - **Host-tool pre-flight** — the assessor needs `node` / `pnpm` /
    `go` / `cargo` on PATH to run. What does the failure look like when
    the host is missing the tool? (Probably: skip + surface as
    `ENV_HOST_MISSING_TOOL` finding + WONTFIX by default; operator
    resolves by installing the tool.)
  - Output: `docs/decisions/0026-*.md` + INDEX row.

- [x] 10.2 — **Node / TypeScript runtime.** New
      `packages/assessor/src/runtimes/node.ts` implementing the
      `ProjectEnvProvisioner` interface per ADR 0026. Verify gate wires
      `pnpm install → pnpm typecheck || tsc --noEmit → pnpm test`. One
      integration test under `packages/assessor/test/node-e2e.test.ts`
      that seeds a minimal TS project, runs the assessor end-to-end,
      asserts the finding shape. Cross-platform; no skipping on Windows
      (operator's primary platform) or Linux.

- [x] 10.3 — **Live validation — Node end-to-end.** `factory build`
      against a real spec like "build a TypeScript CLI that parses a
      JSON log file and prints totals." Verify the build completes, the
      assessor's gate passes, spend stays under the autonomy mode's
      ceiling.

- [x] 10.4 — **Go runtime.** `packages/assessor/src/runtimes/go.ts`.
      Gate: `go build ./... && go test ./...`. Integration test.
      Provisioner is the lightest of the three — no per-project env
      management since `go.mod` is enough.

- [x] 10.5 — **Live validation — Go end-to-end.** Small Go CLI spec;
      full `factory build` loop.

- [x] 10.6 — **Rust runtime.** `packages/assessor/src/runtimes/rust.ts`.
      Gate: `cargo test`. Integration test. Shape is mechanical once
      Node + Go prove the abstraction.

- [x] 10.7 — **Live validation — Rust end-to-end.** Small Rust CLI
      spec; full `factory build` loop.

- [x] 10.8 — **`factory init` language picker.** Today the wizard
      assumes Python. Add a language prompt; propagate to `spec.language`
      so the assessor picks the right runtime on first `factory build`.
      Keep Python as the default for backwards compatibility with the
      existing `factory5-workspace/` corpus of Python projects.

- [x] 10.9 — **Phase close.** Tag `phase-10-assessor-tier3-closed`.
      `docs/Phase10_Progress.md` + `docs/PROGRESS.md` entry +
      `CompleteArchitecture.md` update (§22 "Pluggable runtimes" or
      an edit to §6 / §9). Scaffold Phase 11 (Web UI 9b — mutation
      surface).
