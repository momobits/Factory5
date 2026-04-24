/**
 * Shared types for the assessor. The `AssessResult` shape is a stable
 * cross-package contract — agents and the brain loop read these fields
 * directly to decide next steps.
 *
 * ADR 0026 (Phase 10): the assessor became language-pluggable. `runtime`,
 * `failureMode`, and a runtime-neutral `provisioning` record landed in
 * 10.2 when the Node/TypeScript runtime shipped alongside the existing
 * Python runtime. Tier-1/2 Python code paths (ADR 0017) are preserved
 * behaviourally; only the types exposed to `AssessResult` consumers moved.
 */

// ---------------------------------------------------------------------------
// Pluggable-runtime shape (ADR 0026)
// ---------------------------------------------------------------------------

/**
 * Languages the assessor's verify gate supports. Derived from `spec.language`
 * on the plan; the scaffolder is responsible for setting it. Additional
 * languages arrive as new runtime modules under `src/runtimes/`.
 */
export type Runtime = 'python' | 'node' | 'go' | 'rust';

/**
 * The single primary cause when a gate fails. Precedence (assessor evaluates
 * top-down and short-circuits):
 *
 *  1. `ENV_HOST_MISSING_TOOL` — a declared host tool (`node`, `pnpm`, `go`,
 *     `cargo`, …) is not on PATH. The assessor stops before running any
 *     subprocess against the project.
 *  2. `ENV_SETUP_FAILURE` — provisioning / preflight exited non-zero. Python:
 *     `pip install` failed. Node: `pnpm install` failed. Go / Rust: N/A.
 *  3. `BUILD_FAILURE` — source did not compile / typecheck / import.
 *  4. `TEST_FAILURE` — build succeeded; tests ran; one or more tests failed
 *     or errored.
 *
 * Absent on green gates. Artifact-only failures (missing README, dirty git
 * tree, …) flip `gateResults.verify` but do NOT set `failureMode` — they are
 * completeness checks on the deliverable, not assessor failure modes.
 */
export type FailureMode =
  | 'BUILD_FAILURE'
  | 'TEST_FAILURE'
  | 'ENV_SETUP_FAILURE'
  | 'ENV_HOST_MISSING_TOOL';

/**
 * A host binary the assessor needs resolvable on PATH before it can run
 * a runtime's gate. Declared statically per runtime so the pre-flight step
 * in `assess()` can probe every tool before any subprocess attempts to
 * spawn against the built project.
 */
export interface HostTool {
  /** Base name to probe (e.g. `'pnpm'`, `'go'`, `'cargo'`). */
  bin: string;
  /** Category — informational, used for the log line + error message shape. */
  kind: 'interpreter' | 'pkg-manager' | 'toolchain';
  /** Operator-facing hint surfaced when the tool is missing. */
  installHint: string;
}

/**
 * Runtime-neutral provisioning record attached to {@link AssessResult}.
 * Python populates the env-owning sub-fields (`installOk`, `installSummary`,
 * `envSource`); Node populates `preflight`; Go/Rust run with no preflight
 * at all and populate only `toolPath` / `toolVersion`.
 *
 * Consumers that don't care which runtime produced the record read
 * `toolPath` + `toolVersion`; consumers that want the Python-specific
 * detail (which venv layer owns the install site) branch on
 * `envSource !== undefined`.
 */
export interface ProvisioningRecord {
  /** Which runtime produced this record. Always matches {@link AssessResult.runtime}. */
  runtime: Runtime;
  /** Absolute path to the primary toolchain binary (e.g. Python interpreter, `pnpm`, `go`, `cargo`). */
  toolPath: string;
  /** Version string reported by the tool, e.g. `'3.11.9'` / `'v20.11.0'` / `'go1.22.1'`. Empty if probing failed. */
  toolVersion: string;
  /**
   * Env-owning runtimes only (today: Python). Did the dep-install step exit
   * cleanly? `false` ⇒ `failureMode: 'ENV_SETUP_FAILURE'`.
   */
  installOk?: boolean;
  /** Env-owning runtimes only. Last 40 lines of install stderr on failure. */
  installSummary?: string;
  /**
   * Env-owning runtimes only. Which layer owns the install site:
   *  - `'project'` — reused a project-provided env (e.g. `<projectPath>/.venv/`).
   *  - `'factory-managed'` — created/reused `<projectPath>/.factory/assessor-env/`.
   *  - `'system'` — fell back to the base interpreter; carries user-site pollution risk.
   */
  envSource?: 'project' | 'factory-managed' | 'system';
  /**
   * Env-assuming runtimes only (today: Node). Result of the preflight step
   * (`pnpm install`); absent when the runtime has no preflight (Go / Rust).
   */
  preflight?: {
    /** Command line, joined for logging, e.g. `'pnpm install --frozen-lockfile'`. */
    command: string;
    /** Did the preflight exit cleanly? `false` ⇒ `failureMode: 'ENV_SETUP_FAILURE'`. */
    ok: boolean;
    /** Last 40 lines of combined stdout+stderr on failure. */
    summary?: string;
  };
}

/**
 * A runtime's contribution to the final {@link AssessResult}. Each runtime
 * module (`src/runtimes/python.ts`, `src/runtimes/node.ts`, …) returns one
 * of these; `assess()` composes it with the artifact / module / git checks
 * to build the final result.
 */
export interface RuntimeGateResult {
  /** Detected test framework, or `'none'` when tests were skipped / absent. */
  testFramework: string;
  /** Were tests available and run? When false, `gate.integration` is false by definition. */
  testsAvailable: boolean;
  testsPassed: number;
  testsFailed: number;
  testsErrors: number;
  /** Did the source pass the runtime's build gate (typecheck / compile / imports)? */
  buildOk: boolean;
  /**
   * Python-only — one line per import that failed, e.g.
   * `'src/api.py: ModuleNotFoundError: httpx'`. Empty for Node/Go/Rust.
   */
  importErrors: readonly string[];
  /** Did every expected source module import cleanly? Python-only; defaults to `buildOk` for other runtimes. */
  importsOk: boolean;
  /** Provisioning record surfaced up through {@link AssessResult.provisioning}. */
  provisioning?: ProvisioningRecord;
  /**
   * Set by the runtime when its gate failed. `assess()` propagates directly;
   * host-tool-missing short-circuits before the runtime runs, so this never
   * carries `'ENV_HOST_MISSING_TOOL'` (that value is set in `assess()` itself).
   */
  failureMode?: FailureMode;
}

/**
 * The dispatch contract each per-language runtime module implements. `assess()`
 * resolves the runtime by `AssessOptions.runtime` (default `'python'`), probes
 * `hostTools` via `resolveOnPath`, and — if pre-flight passes — calls `runGate`.
 */
export interface RuntimeAssessor {
  runtime: Runtime;
  /**
   * Host tools the runtime requires on PATH. `assess()` probes every entry
   * before invoking `runGate`; any missing tool short-circuits with
   * `failureMode: 'ENV_HOST_MISSING_TOOL'`.
   *
   * Python is a special case: its own `pickPython` logic handles
   * interpreter discovery with version-specific fallbacks, so `hostTools`
   * is empty and the runtime surfaces host-missing internally.
   */
  hostTools: readonly HostTool[];
  /** Run the runtime's end-to-end gate (preflight + build + test). */
  runGate(projectPath: string, opts: RuntimeGateOptions): Promise<RuntimeGateResult>;
}

export interface RuntimeGateOptions {
  /**
   * Module paths (relative to project root) the scaffolder promised. Used
   * for existence checks and, for Python, import probing. Non-Python
   * runtimes may ignore this.
   */
  expectedModules?: readonly string[];
  /** Per-runner timeout in ms. Default 2 minutes. */
  runnerTimeoutMs?: number;
  /** Python-specific: interpreter to use (testing seam + override). Ignored by other runtimes. */
  pythonBin?: string;
}

// ---------------------------------------------------------------------------
// Public result / options shapes
// ---------------------------------------------------------------------------

export interface AssessResult {
  /** Which runtime produced the gate outcomes (ADR 0026). Defaults to `'python'` when unset. */
  runtime: Runtime;

  /**
   * Single primary cause when the gate failed; absent on green gates. See
   * {@link FailureMode} for precedence semantics.
   */
  failureMode?: FailureMode;

  /** How many modules listed in `CLAUDE.md` / the plan exist on disk. */
  modulesExisting: number;
  /** Module paths that were expected but missing. */
  modulesMissing: string[];

  /** Tests that passed in the most recent run. */
  testsPassed: number;
  /** Tests that failed in the most recent run. */
  testsFailed: number;
  /** Tests that errored (collection failure, import error, etc.). */
  testsErrors: number;
  /** Which runner reported the numbers (e.g. `pytest`, `vitest`, `go-test`, `cargo-test`, `none`). */
  testFramework: string;

  /** Did every source module import cleanly? Python-only semantics; Node/Go/Rust use `gate.build`. */
  importsOk: boolean;
  /** One line per import that failed — Python-only, empty for other runtimes. */
  importErrors: string[];

  /** README.md present and ≥30 non-empty lines. */
  hasReadme: boolean;
  /** LICENSE or LICENSE.md / LICENSE.txt present. */
  hasLicense: boolean;
  /** .gitignore present. */
  hasGitignore: boolean;
  /** Architecture doc present (docs/architecture.md or docs/knowledge/architecture.md). */
  hasArchitecture: boolean;

  /** `git status --porcelain` is empty. */
  gitClean: boolean;

  /** Aggregate gate results the brain consumes to decide completion. */
  gateResults: {
    build: boolean;
    integration: boolean;
    verify: boolean;
  };

  /**
   * Runtime-neutral provisioning record. Python populates the env-owning
   * fields (`installOk`, `envSource`, …); Node populates `preflight`;
   * Go/Rust set only `toolPath` + `toolVersion`. Absent when tests were
   * skipped (`testFramework: 'none'`) or the runtime short-circuited
   * before provisioning (e.g. host-tool missing).
   */
  provisioning?: ProvisioningRecord;
}

export interface AssessOptions {
  /** Project root directory. */
  projectPath: string;
  /**
   * Module paths (relative to project root) that were promised in the spec /
   * wiki. Used for existence + (Python only) import checks.
   */
  expectedModules?: readonly string[];
  /**
   * Which runtime's provisioner + gate to run. Defaults to `'python'` to
   * preserve pre-ADR-0026 behaviour for callers that don't yet carry
   * `spec.language` through.
   */
  runtime?: Runtime;
  /**
   * Python-specific override — interpreter to use for pytest / import checks.
   * Ignored when `runtime !== 'python'`.
   */
  pythonBin?: string;
  /**
   * Skip the runtime's test + provisioning step entirely. `'auto'` runs the
   * runtime's default gate; `'none'` short-circuits so artifact-only
   * assessments (used by tests and diagnostics) don't spawn subprocesses.
   */
  testFramework?: 'auto' | 'none';
  /** Per-runner timeout in ms. Default 2 minutes. */
  runnerTimeoutMs?: number;
}
