# 0026 — Pluggable assessor runtimes: per-language provisioner contract + failure-mode taxonomy + host-tool pre-flight

- **Status:** Accepted
- **Date:** 2026-04-24
- **Builds on:** [ADR 0017](0017-assessor-project-env-provisioning.md) — tier-1 / tier-2 Python provisioner (venv + `pip install -e .[test]`) that this ADR generalises to Node / Go / Rust without disturbing. [ADR 0018](0018-verifier-advisory-only.md) — advisory-only verifier; the assessor stays authoritative, so its gate outcomes and findings shape are what this ADR pins across runtimes. [ADR 0021](0021-first-class-project-identity.md) — `.factory/` per-project directory that any factory-managed env lives under.

## Context

Phase 10's charter (`.control/phases/phase-10-assessor-tier3/README.md`) extends the assessor's ground-truth verify gate from Python-only to three more runtimes in priority order: Node/TypeScript (10.2–10.3), Go (10.4–10.5), Rust (10.6–10.7). The forcing function is the Phase 7+ live-run observation that the assessor is the ceiling on what factory5 can actually ship — broaden the ceiling → more real builds → more operator usage of the Phase 9 Web UI.

ADR 0017 introduced the **tier-2 per-project factory-managed env** (`<projectPath>/.factory/assessor-env/`) for Python, keyed by nothing more sophisticated than presence-check, plus a **tier-1 interpreter picker** (`pickPython`) with `.venv` precedence + `requires-python` parsing + PATH fallback. That design is Python-shaped: a venv is a heavyweight mutable artifact; `pip install -e .` mutates it; failures fall into the buckets of "wrong interpreter" / "dependency install broken" / "import failure" / "test failure". Node/Go/Rust do not share that shape. `package.json` + `pnpm install` manages its own `node_modules/` (no per-project env to create); `go.mod` + `go test` needs no provisioning step at all beyond a `go` binary; `cargo test` compiles-then-tests in one command and manages `target/` itself.

The assessor's current API (`packages/assessor/src/assess.ts`) is not yet language-pluggable. `AssessOptions.testFramework` is typed `'auto' | 'pytest' | 'none'`; `assess()` hard-codes `provisionAssessorEnv` (Python-specific) and `checkPythonImports`. `AssessResult.provisioning` is a Python-shaped record (`pythonPath`, `pythonVersion`, `installOk`, `venvSource`). The Phase 9 findings UI consumes `AssessResult` + findings-registry rows and has no runtime dimension — it must stay runtime-agnostic once three new runtimes land, or every dashboard card gains a language-specific branch.

Before 10.2 writes the first non-Python runtime, four decisions have to be pinned so the implementation is additive rather than disruptive:

1. **Provisioner shape.** Does every runtime's provisioner fully own the project's env (the Python model: create venv, install deps, track `venvSource`), or does it assume the project is runnable out-of-the-box (the Node/Go/Rust model: trust the project's own manifest + lockfile, run the gate commands, do not manage a factory-internal env layer)?
2. **Verify-gate command mapping.** Which commands map to "did this project build + pass tests" per runtime? Node's path has the most optionality (pnpm vs npm vs yarn, `pnpm typecheck` vs `tsc --noEmit`, workspace monorepos). Go and Rust are nearly mechanical.
3. **Failure-mode taxonomy.** When the gate fails, how does the assessor tell the UI whether the build didn't compile, the tests failed, the env couldn't be provisioned, or the host is missing a required tool? The existing `gateResults: { build, integration, verify }` booleans capture outcome but not cause. The Phase 9 findings UI needs cause to render usefully.
4. **Host-tool pre-flight.** What happens when `node` / `pnpm` / `go` / `cargo` is missing from PATH? The failure shape must be consistent across runtimes: operator-facing, blocking, clearly attributable to the missing tool rather than to the built project.

This ADR follows the multi-decision one-file shape established by [ADR 0020](0020-pre-call-budget-enforcement.md), [ADR 0024](0024-worker-subprocess-ask-user.md), and [ADR 0025](0025-web-ui-architecture.md): keep the decisions adjacent because they compose, not because each is trivial.

## Decision

Four parts, one ADR.

### 1. Provisioner shape — two-shape contract: env-owning (Python) vs. env-assuming (Node / Go / Rust)

Rather than forcing one shape on every runtime, expose two `ProjectEnvProvisioner` variants and let each runtime pick the one that matches its toolchain's natural unit of reuse.

**Env-owning provisioner.** The runtime creates / reuses a factory-managed env under `<projectPath>/.factory/assessor-env/`, installs project deps into it, and tracks enough state that the `AssessResult` can explain which layer owns the install site. This is Python's shape (ADR 0017 tier-2 as implemented in Phase 5f for I006). The contract:

```ts
interface EnvOwningProvisioner {
  kind: 'env-owning';
  runtime: 'python'; // |... (future: 'ruby', 'dotnet')
  hostTools: readonly HostTool[]; // e.g. [{ bin: 'python', kind: 'interpreter' }]
  provision(projectPath: string, opts: ProvisionOptions): Promise<ProvisioningRecord>;
}

interface ProvisioningRecord {
  /** Interpreter / toolchain chosen. */
  toolPath: string;
  toolVersion: string; // e.g. '3.11.9'
  /** Did the env's install step exit cleanly? */
  installOk: boolean;
  /** Last 40 lines of install stderr on failure, else absent. */
  installSummary?: string;
  /** Which layer owns the install site (Python-specific enum today; extensible). */
  envSource: 'project' | 'factory-managed' | 'system';
}
```

**Env-assuming provisioner.** The runtime assumes the project's own manifest + lockfile is the env. No factory-managed install layer; the manifest's declared tool runs directly against the project dir. This is Node / Go / Rust's shape. The contract:

```ts
interface EnvAssumingProvisioner {
  kind: 'env-assuming';
  runtime: 'node' | 'go' | 'rust';
  hostTools: readonly HostTool[]; // e.g. [{ bin: 'pnpm', kind: 'pkg-manager' }]
  /** Optional pre-flight step (e.g. `pnpm install` for Node). Missing → gate runs directly. */
  preflight?(projectPath: string, opts: ProvisionOptions): Promise<PreflightRecord>;
}

interface PreflightRecord {
  /** Which command was run (e.g. 'pnpm install'). Empty string if preflight was a no-op. */
  command: string;
  /** Did the preflight exit cleanly? If false → ENV_SETUP_FAILURE, gate.build = false. */
  ok: boolean;
  summary?: string;
}
```

**Why the split rather than one shape.**

- Python's env is a first-class artifact with a lifecycle that the assessor must manage: creating `.venv/`, installing deps, surfacing `venvSource` so operators can see whether factory mutated their system Python. Forcing Node to fabricate an equivalent record (e.g. `envSource: 'project-node_modules'`) would be cargo-cult — `node_modules` is not analogous to a venv; it's transparently managed by the package manager per invocation.
- Go and Rust have no per-project env at all in Python's sense: `go` downloads modules to `$GOPATH/pkg/mod` (shared, cached, keyed on module hash); `cargo` downloads to `$CARGO_HOME/registry`. Both are invisible to factory5. Modelling them as `env-assuming` with a no-op `preflight` is honest; modelling them as `env-owning` would require inventing metadata that isn't load-bearing.
- Node sits in between: `pnpm install` is a real state change inside the project dir (`node_modules/`, `pnpm-lock.yaml` regeneration), but the env is keyed on `package.json` / `pnpm-lock.yaml` which are the project's own artifacts — not factory's. `env-assuming` + a `pnpm install` preflight captures this without introducing a second factory-managed layer.

The two shapes share a dispatch path in `assess()`: the runtime's provisioner is resolved by `spec.language` (or `AssessOptions.runtime`), then `kind` decides whether to call `provision()` or `preflight()`. Both paths return enough information to populate `AssessResult.env` (see §3).

**Scaffolder contract.** `spec.language` is already a field on the plan (Python is its only current value). Phase 10 adds the `'node' | 'go' | 'rust'` cases. The scaffolder emits the field; the assessor consumes it; no new plan-level metadata is required for tier-3. The `factory init` language picker (10.8) writes `spec.language` up front so the first `factory build` dispatches correctly.

### 2. Verify-gate command mapping — pinned per runtime

Each runtime's gate maps the universal "did this build + pass tests" question to a small, opinionated command chain. No auto-detection beyond the runtime dimension itself; no policy matrices for npm-vs-yarn-vs-pnpm; no surveying the project's scripts to pick a test command. **The assessor is opinionated by design** — ADR 0017 already established this for Python (we run `pytest`, not "whatever the project's CI does"). Tier-3 inherits that stance.

| Runtime | Preflight (env-assuming) / provision (env-owning)                                  | Build gate                                                                           | Test gate          |
| ------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------ |
| Python  | pick interpreter → ensure venv → `pip install -e .[test]` (falling back to `-e .`) | imports check on expected modules + `installOk !== false`                            | `python -m pytest` |
| Node    | `pnpm install --frozen-lockfile` (fallback to `pnpm install` if lockfile absent)   | `pnpm typecheck` **if the `typecheck` script exists**, else `pnpm exec tsc --noEmit` | `pnpm test`        |
| Go      | no-op (`go build` fetches modules transparently)                                   | `go build ./...`                                                                     | `go test ./...`    |
| Rust    | no-op (`cargo test` compiles + tests in one step)                                  | _subsumed by `cargo test`_ — no separate build command                               | `cargo test`       |

**Edge cases, named explicitly:**

- **Node — no `typecheck` script.** Fallback to `pnpm exec tsc --noEmit`. If `tsc` itself is not resolvable inside the workspace (neither in the project's `devDependencies` nor globally), emit a `BUILD_FAILURE` with a surfaced hint ("declare `typescript` in `devDependencies` or add a `typecheck` script"). Do not silently skip the type-check — an untypechecked TS project going through the gate defeats the gate's purpose.
- **Node — workspace monorepos.** Out of scope for 10.2. The assessor runs against a single project directory (the built project, not a multi-project workspace). If a future scaffolder emits a monorepo, revisit. The gate commands already scope to the single `projectPath`.
- **Node — `pnpm-lock.yaml` absent but `package.json` present.** Happens on fresh scaffolds before the first install. Run `pnpm install` (no `--frozen-lockfile`) to generate the lockfile in-place. Lockfile drift between runs is fine; the gate only cares that install succeeded.
- **Go — projects with no tests.** `go test ./...` exits 0 if no `_test.go` files exist, which reads as "tests available" in the existing `tests.available && tests.passed > 0` gate. This is a false positive: a zero-test project should not pass `gate.integration`. The Go runtime detects this (`go test -list '.*' ./...` returns no listed tests) and reports `testsAvailable: false` so the gate shape stays consistent with Python's "no tests" behaviour.
- **Go — doc tests / examples.** `go test ./...` runs example tests by default. No configuration; the gate inherits whatever tests the project wrote.
- **Rust — `cargo test` failure modes.** `cargo test` can fail for "didn't compile" (exit non-zero, no test output) or "tests failed" (exit non-zero, test output with `test result: FAILED`). The runtime distinguishes by parsing output: compile-failure is `BUILD_FAILURE`; test-failure is `TEST_FAILURE`.
- **Rust — doc tests.** Enabled by default in `cargo test`. No configuration; the gate inherits them.

**What the gate does _not_ do:**

- Lint (`eslint`, `clippy`, `go vet`). Linters are not ground-truth correctness signals; they are style + heuristic. Advisory-only by ADR 0018's spirit.
- Format checks (`prettier --check`, `gofmt`, `cargo fmt --check`). Same reasoning. If a project has a committed lint/format gate, its CI will enforce it; the assessor doesn't need to duplicate.
- Benchmark runs (`cargo bench`). Out of scope entirely.
- Coverage thresholds. If a future phase needs them, they land as a separate optional gate, not in tier-3.

### 3. Failure-mode taxonomy — four tags, encoded in a new `AssessResult.failureMode` field

Introduce `AssessResult.failureMode?: FailureMode` where `FailureMode` is the enum `'BUILD_FAILURE' | 'TEST_FAILURE' | 'ENV_SETUP_FAILURE' | 'ENV_HOST_MISSING_TOOL'`. Present only when the gate did not pass; absent on green gates. The field names the **first** thing that went wrong, read top-to-bottom from the runtime's pipeline, so the UI can render a single primary cause rather than ambiguating across multiple red indicators.

**Precedence** (first true wins, assessor short-circuits):

1. `ENV_HOST_MISSING_TOOL` — any host-tool pre-flight (§4) came back missing. The assessor stops before running any subprocess against the project.
2. `ENV_SETUP_FAILURE` — provisioning / preflight exited non-zero. Python: `pip install` failed. Node: `pnpm install` failed. Go / Rust: N/A (no preflight). Assessor stops before build / test.
3. `BUILD_FAILURE` — Python: import check fails or modules missing. Node: `tsc --noEmit` exit non-zero. Go: `go build ./...` exit non-zero. Rust: `cargo test` exit non-zero without reaching test-run phase (compile error parsed from output).
4. `TEST_FAILURE` — build succeeded; tests ran; `testsFailed > 0` or `testsErrors > 0`.

If the gate passes (all four clear), `failureMode` is absent and `gateResults.verify === true` (assuming the artifact checks also pass; those are a fifth dimension that doesn't participate in `failureMode` — see below).

**Relationship to `gateResults`:**

- `gate.build === false` implies `failureMode ∈ { ENV_HOST_MISSING_TOOL, ENV_SETUP_FAILURE, BUILD_FAILURE }`.
- `gate.integration === false` with `gate.build === true` implies `failureMode === 'TEST_FAILURE'`.
- Artifact-only failures (missing README / LICENSE / .gitignore / architecture doc / dirty git tree) flip `gate.verify = false` but do **not** set `failureMode`. They are not assessor-failure modes; they are completeness checks on the deliverable. The Phase 9 findings UI can surface them separately from the four failure-mode tags. Rationale: bundling them into `failureMode` would force the UI to render a "BUILD_FAILURE: missing README" state, which is misleading — the build is fine.

**Wire compatibility.** `AssessResult.failureMode` is optional; consumers that don't read it behave exactly as before ADR 0026. `computeGateResults()` gets a new third argument and the generalised install/build checks. The brain's verifier agent (which reads `AssessResult` and decides next action) picks up `failureMode` incrementally: in 10.2 it gains one new branch ("if `failureMode === 'ENV_HOST_MISSING_TOOL'`, surface the operator-facing error and stop iterating"). Python's runtime adopts `failureMode` retroactively in the same commit that introduces the field, so the enum has ≥1 producer everywhere it's read.

**Not adding a `Finding.tag` field.** The four failure-mode tags live on `AssessResult`, not on individual `Finding` rows. Reasons: (a) the Finding schema is already established and widely consumed (core/schemas.ts:138, findings-registry, wiki/findings, Web UI); adding a field for the assessor's benefit propagates complexity through eight+ call sites. (b) The assessor's failure mode is a per-assessment attribute, not a per-finding one — a single failed build produces at most one `failureMode`. (c) If a future phase needs per-finding categorisation (e.g. the verifier agent's advisory findings tagging a security concern vs. a style concern), that's a separate, orthogonal decision; overloading `failureMode` for it would entangle unrelated signals.

### 4. Host-tool pre-flight — declared per runtime, probed before any subprocess, `ENV_HOST_MISSING_TOOL` with blocking advisory

Every provisioner declares its required host tools up front via the `hostTools: readonly HostTool[]` field on the `*Provisioner` interface (§1):

```ts
interface HostTool {
  bin: string; // 'node' | 'pnpm' | 'go' | 'cargo' | 'python'
  kind: 'interpreter' | 'pkg-manager' | 'toolchain';
  /** Human-readable hint shown when missing. */
  installHint: string; // e.g. 'Install Node 20+ from https://nodejs.org'
}
```

Declared tools per runtime:

| Runtime | Host tools                                                                                                        |
| ------- | ----------------------------------------------------------------------------------------------------------------- |
| Python  | `python` (or `python3` on Unix) — picked dynamically by `pickPython`; the declaration documents "at least one of" |
| Node    | `node`, `pnpm`                                                                                                    |
| Go      | `go`                                                                                                              |
| Rust    | `cargo`                                                                                                           |

**Pre-flight order.** Before any runtime-specific provisioning or gate command runs, `assess()` walks the declared `hostTools` and probes each via `resolveOnPath()` (already in `packages/assessor/src/run.ts:113`). Any bin that `resolveOnPath` can't find short-circuits:

- `AssessResult.failureMode = 'ENV_HOST_MISSING_TOOL'`
- `AssessResult.gateResults = { build: false, integration: false, verify: false }`
- `AssessResult.testFramework = 'none'`
- An `info`-level log line names the missing bin + `installHint`
- The daemon surfaces the error through the brain's verifier path — in the operator-facing `ask_user` / Web UI finding, the description reads: "assessor requires `<bin>` on PATH but none was found. <installHint>"

**Blocking semantics.** The resulting finding is raised with `severity: 'CRITICAL'`, `status: 'OPEN'`, `advisory: false` (it blocks the gate). Operator resolves by installing the tool; a subsequent `factory build` re-runs the pre-flight. Unlike ADR 0018's advisory-only verifier findings, a missing host tool is objectively disqualifying — no inference, no false positive possible.

**Default resolution = WONTFIX is the wrong framing.** The next-session handoff described ENV*HOST_MISSING_TOOL as "WONTFIX default"; closer scrutiny says that's wrong. WONTFIX signals "we acknowledge but won't address" — but the \_operator* can trivially address a missing tool by installing it. The finding stays OPEN with a clear instruction; the resolution is "operator installs tool, re-runs build" and the finding auto-resolves next run (it doesn't re-emit because pre-flight passes). No WONTFIX state is needed.

**Python exception.** `pickPython` already handles "at least one of `python` / `python3` / `py`" with graceful fallback. The host-tool declaration lists `python` conceptually, but the probe is delegated to `pickPython`'s own logic — the assessor recognises Python's runtime has a bespoke picker and doesn't re-probe. This keeps Phase 5c/5f's tested behaviour intact.

**Cross-platform probing.** `resolveOnPath` already walks `PATHEXT` on Windows (run.ts:118), so `go.exe` / `cargo.exe` / `pnpm.cmd` resolve correctly. No new cross-platform code; the pre-flight inherits the existing subprocess runner's invariants.

## Consequences

**Positive:**

- Phase 10's per-runtime work (10.2 Node, 10.4 Go, 10.6 Rust) reduces to implementing one `ProjectEnvProvisioner` plus its gate command wiring. The shape, failure taxonomy, and pre-flight are fixed; sub-step bodies shrink to "declare tools + wire commands + write one integration test".
- The Phase 9 findings UI stays runtime-agnostic. It renders `failureMode` as a single category tag and renders `provisioning` / `preflight` detail through a per-runtime union without needing if-ladders over language string literals.
- Python's runtime adopts `failureMode` retroactively, so every consumer that reads it has ≥1 runtime producing it from day one — no "defined but never set" paths.
- Host-tool pre-flight converts a whole class of opaque runtime failures into a single, operator-actionable error. Today, a missing `pnpm` would surface as a Node-runtime subprocess spawn error with a cryptic message; tomorrow it's `ENV_HOST_MISSING_TOOL: install pnpm via corepack enable`.
- Extensibility: adding Ruby / .NET / Java in a future phase is a new provisioner registration + a `spec.language` value. No schema migration, no UI rework.

**Negative:**

- `AssessResult.provisioning` becomes a discriminated union by `runtime`. Existing Python consumers read `provisioning?.pythonPath` at call sites; the migration either renames the field to a neutral shape (`toolPath`) or keeps `pythonPath` only under `runtime: 'python'` discriminator. Decision: **rename to the neutral shape in the same commit that introduces the union**, so there's one breaking change rather than a field-shape split. Migration surface is small (three readers in `packages/brain/` + the Web UI). The old name ships for one session if needed as a backwards-compat alias, else removed in 10.2 since the daemon's consumers upgrade at the same time.
- The `env-owning` / `env-assuming` split introduces two interfaces where a single polymorphic one would suffice. Pragmatism: Python's env needs metadata Node's doesn't, and forcing Node to return empty strings for `toolVersion` / stub `envSource: 'project'` fields is worse than the interface split. If a fifth runtime surfaces a third shape, revisit.
- Four failure-mode tags is opinionated: the taxonomy might turn out too coarse (no distinction between "compile error" and "linker error" within BUILD_FAILURE) or too fine (ENV_SETUP_FAILURE + ENV_HOST_MISSING_TOOL could have merged into one `ENV_FAILURE`). Accepting the risk — we have zero concrete pain points today, and splitting later is a non-breaking addition.
- No lint / format / bench gates. Operators who want them have to wire external CI. Explicit non-goal; revisit when a live-run surfaces demand.

**Reversible?** The decision is a shape on internal interfaces (provisioner contract) + one new optional field on `AssessResult`. Reverting to Python-only is `git revert` on 10.2+ commits; the ADR itself is docs-only. No persistent data (findings-registry, `.factory/` state) encodes the four failure-mode tags, so rolling back doesn't orphan rows in SQLite.

## Alternatives considered

- **Single polymorphic `ProjectEnvProvisioner` shape.** A provisioner that exposes a uniform `provision(projectPath) → ProvisioningRecord` regardless of runtime, with empty/stub fields for runtimes that don't need them. Rejected: forces env-assuming runtimes to fabricate metadata (Node's "envSource" is meaningless), and the uniform signature drifts into lowest-common-denominator territory where Python's rich tier-2 state (factory-managed venv lifecycle) has nowhere to live. The two-shape split in §1 is less tidy-looking but honest.
- **Per-runtime ADRs instead of one tier-3 ADR.** Write 0026 Node, 0027 Go, 0028 Rust separately. Rejected: the four decisions in §1–§4 are shared infrastructure across all three runtimes; splitting the ADR would triplicate the context and force reviewers to reconstruct the shared shape from three pieces. Multi-decision single-ADR is the established pattern (ADR 0020, 0024, 0025).
- **`spec.language` as free-form string with runtime auto-detection on disk.** Scan for `package.json` / `go.mod` / `Cargo.toml` / `pyproject.toml` and pick the runtime. Rejected: polyglot projects (a Go backend + TypeScript SPA in one repo) defeat the heuristic; the spec already declares intent, so read the intent. The charter's §Deliberately out of scope specifically rejects polyglot detection.
- **A `Finding.tag` field carrying `BUILD_FAILURE` etc.** Rejected in §3 above. Briefly: the failure mode is a per-assessment attribute, not a per-finding one; adding a schema field mutates eight+ call sites for zero information gain.
- **Lint / format gates in-band.** Add `eslint` / `clippy` / `gofmt` as additional gate stages. Rejected per §2's "what the gate does _not_ do" — ground truth is correctness, not style. Advisory-only verifier (ADR 0018) already covers subjective-judgement findings.
- **Factory-managed `.factory/assessor-node_modules/`.** Mirror Python's tier-2 pattern to Node. Rejected: `node_modules` is not a reusable env across projects — it's the project's transparent cache. `pnpm install` already deduplicates globally via the content-addressed store (`pnpm-store/`). Inventing a factory-managed layer duplicates pnpm's own mechanism with no gain.
- **Delay host-tool pre-flight until the gate step attempts its first subprocess.** Let the subprocess fail with `ENOENT` and attribute it then. Rejected: the error message quality is dramatically worse (`spawn pnpm ENOENT` vs. a deliberate "pnpm not on PATH, install via corepack enable"), and attribution is ambiguous — did `pnpm` fail to spawn or did it exit non-zero for a project reason? Up-front probing is cheap (one `access()` call per tool) and eliminates the ambiguity.
- **ENV_HOST_MISSING_TOOL as WONTFIX default.** (As floated in the next-session handoff.) Rejected in §4: WONTFIX implies we won't address it, but the operator can trivially install the tool. OPEN + actionable instruction + auto-resolve on next-run pre-flight is the right shape.

## Implementation outline (10.2+)

Type sketch — lands in `packages/assessor/src/types.ts` at 10.2 open:

```ts
export type Runtime = 'python' | 'node' | 'go' | 'rust';

export type FailureMode =
  | 'BUILD_FAILURE'
  | 'TEST_FAILURE'
  | 'ENV_SETUP_FAILURE'
  | 'ENV_HOST_MISSING_TOOL';

export interface HostTool {
  bin: string;
  kind: 'interpreter' | 'pkg-manager' | 'toolchain';
  installHint: string;
}

export interface ProvisioningRecord {
  runtime: Runtime;
  toolPath: string;
  toolVersion: string;
  /** Python/env-owning only. */
  installOk?: boolean;
  /** Python/env-owning only. */
  installSummary?: string;
  /** Python/env-owning only. */
  envSource?: 'project' | 'factory-managed' | 'system';
  /** Node/env-assuming only. */
  preflight?: { command: string; ok: boolean; summary?: string };
}

export interface AssessResult {
  // ... existing fields ...
  runtime: Runtime; // NEW — defaults to 'python' for back-compat
  provisioning?: ProvisioningRecord; // NEW — replaces today's Python-shaped `provisioning`
  failureMode?: FailureMode; // NEW — absent on green gates
}
```

Directory layout:

```
packages/assessor/src/
  runtimes/
    python.ts   # wraps today's pytest.ts / imports.ts / pickPython under the new interface
    node.ts     # 10.2
    go.ts       # 10.4
    rust.ts     # 10.6
  assess.ts     # dispatch on spec.language → chosen provisioner
  run.ts        # shared subprocess primitive — unchanged
  types.ts      # the sketch above
```

No changes to the Finding schema. No changes to the findings-registry table. Web UI (`apps/factory-web/`) reads `AssessResult.failureMode` on the per-directive detail page; renders as a single-badge category tag.

Tests (per runtime, in `src/runtimes/<lang>.test.ts` and one `test/<lang>-e2e.test.ts` integration):

1. Host-tool pre-flight: asserts missing-tool short-circuits with `failureMode: 'ENV_HOST_MISSING_TOOL'`, no subprocess spawned.
2. Build gate: seeds a minimal project, asserts green gate.
3. Build failure: seeds a project with a deliberate compile error, asserts `failureMode: 'BUILD_FAILURE'` + `gate.build === false`.
4. Test failure: seeds a project with a deliberately failing test, asserts `failureMode: 'TEST_FAILURE'` + `gate.integration === false`.
5. Env-setup failure (Node only): seeds a project with a `pnpm install`-breaking `package.json`, asserts `failureMode: 'ENV_SETUP_FAILURE'`.

Python runtime test suite (existing) picks up `runtime: 'python'` + `failureMode` assertions in 10.2 so the enum isn't unset on the old paths.
