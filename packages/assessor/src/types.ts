/**
 * Shared types for the assessor. The `AssessResult` shape is a stable
 * cross-package contract — agents and the brain loop read these fields
 * directly to decide next steps.
 */

export interface AssessResult {
  /** How many modules listed in `CLAUDE.md` exist on disk. */
  modulesExisting: number;
  /** Module paths that were expected but missing. */
  modulesMissing: string[];

  /** Tests that passed in the most recent run. */
  testsPassed: number;
  /** Tests that failed in the most recent run. */
  testsFailed: number;
  /** Tests that errored (collection failure, import error, etc.). */
  testsErrors: number;
  /** Which runner reported the numbers (e.g. `pytest`, `jest`, `cargo-test`, `none`). */
  testFramework: string;

  /** Did every source module import cleanly? */
  importsOk: boolean;
  /** One line per import that failed, e.g. `src/api.py: ModuleNotFoundError: httpx`. */
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
   * Present when the pytest runner provisioned an environment before running
   * the tests (ADR 0017). Absent when tests were skipped (`testFramework:
   * 'none'`) or the runner short-circuited before provisioning (python not on
   * PATH, no `tests/` directory).
   */
  provisioning?: {
    /** Absolute path to the Python interpreter the runner chose. */
    pythonPath: string;
    /** Interpreter's reported version (e.g. `3.11.9`), or empty if probing failed. */
    pythonVersion: string;
    /** `python -m pip install -e .[test]` exited 0 (or `-e .` fallback did). */
    installOk: boolean;
    /** Last 40 lines of combined stdout+stderr from the install step, when it failed. */
    installSummary?: string;
    /**
     * Which venv layer owns the install site (ADR 0017 implementation notes, I006 fix):
     *  - `'project'` — reused `<projectPath>/.venv/` (user-controlled).
     *  - `'factory-managed'` — created/reused `<projectPath>/.factory/assessor-env/`.
     *  - `'system'` — installed against the base interpreter because no venv could
     *    be created; risks user-site pollution and warrants operator attention.
     */
    venvSource: 'project' | 'factory-managed' | 'system';
  };
}

export interface AssessOptions {
  /** Project root directory. */
  projectPath: string;
  /**
   * Module paths (relative to project root) that were promised in the spec /
   * wiki. Used for existence + import checks.
   */
  expectedModules?: readonly string[];
  /**
   * Python interpreter to use for pytest / import checks. Defaults to `python`
   * on PATH (or `python3` on Unix if `python` is absent).
   */
  pythonBin?: string;
  /**
   * Override test runner detection. `none` skips tests entirely. Default is
   * to auto-detect; currently only `pytest` is implemented.
   */
  testFramework?: 'auto' | 'pytest' | 'none';
  /** Per-runner timeout in ms. Default 2 minutes. */
  runnerTimeoutMs?: number;
}
