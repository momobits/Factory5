# 0017 — Assessor project-env provisioning: venv + requires-python + pip install

- **Status:** Accepted
- **Date:** 2026-04-19

## Context

The Phase 5b live `factory build example` run (2026-04-19, directive
`01KPHAYCJSYFC7RK3EPZ3B0XKA`) built a fully working Python CLI package
(6/6 tasks, 114 pytest tests green) but ended `blocked` rather than
`complete` because the assessor's verify gate returned `false` across the
board. The gate failure was environmental, not structural: the built
project declared `requires-python = ">=3.11"` in `pyproject.toml` and
correctly used `from enum import StrEnum` (3.11+), but the host's `python`
on PATH was 3.10. `packages/assessor/src/runners/pytest.ts` called
`python -m pytest` without provisioning anything — no venv detection, no
`pip install`, no version check — so the test subprocess died at import
time and every gate returned `false`. Filed as
[I002](../issues/I002-assessor-inherits-host-python-env.md).

The Phase 2 finale didn't surface this because that spec happened to be
stdlib-only and the happened-to-be-installed PATH python matched. The
assumption that "the host env is the test env" was always wrong for
languages other than Node; Python was the first test case to expose it.

Three tiers of fix have been discussed (I002 "Resolution → Suggested
direction"):

1. **Minimum viable.** Teach the pytest runner to (a) prefer a
   project-local `.venv/` over PATH; (b) when `pyproject.toml` carries
   `requires-python = ">=X.Y"`, prefer `py -X.Y` (Windows) / `pythonX.Y`
   (Unix); (c) run `pip install -e .[test]` (or `-e .` fallback) before
   pytest and surface install failure as a first-class signal.

2. **Per-project factory-managed env.** Cache a venv under
   `<project>/.factory/assessor-env/`, keyed by the dep-manifest hash.
   Introduce a runtime interface (`runtime: python>=3.11` in the plan)
   that the scaffolder declares and the assessor consumes.

3. **Pluggable runtime system.** A generalised `runtime` shape where
   per-language provisioners (`.factory/runtimes/python.ts`, `.node.ts`,
   `.go.ts`) are additive; the assessor dispatches through an interface.

## Decision

Ship **tier 1** in Phase 5c. The pytest runner gains three capabilities:

1. **`pickPython` priority order:**
   1. Caller-provided `opts.pythonBin` — used as-is, probed only to
      populate `PythonChoice.version`.
   2. Project-local venv:
      `<projectPath>/.venv/Scripts/python.exe` (Windows) or
      `<projectPath>/.venv/bin/python` (Unix), if it exists as a file.
   3. `requires-python` from `pyproject.toml` parsed with `smol-toml`
      (already in the workspace via `@factory5/brain`). The minimum
      version extracted from constraints like `">=3.11"`, `"~=3.11.2"`,
      `"^3.11"`, `"==3.11"`. Launched via `py -3.11` (Windows) or
      `python3.11` (Unix).
   4. Fall back to `python` / `python3` on PATH. When a specific version
      was requested but unavailable, logs `warn` and sets
      `PythonChoice.demoted = { requestedVersion }` so downstream callers
      can explain the demotion.

   Every candidate is probed with `<bin> --version`; the first that
   exits 0 wins. Logs an `info`-level line `pickPython: chose
interpreter` with the chosen bin, prefix args, detected version, and
   the reason (for traceability).

2. **Provisioning step before pytest.** When `pyproject.toml` exists, the
   runner invokes `<chosen-python> -m pip install -e .[test]
--disable-pip-version-check --quiet` (180 s timeout). If the pyproject
   declares no `optional-dependencies.test` extra, we call `-e .`
   directly. If `-e .[test]` fails (for any reason), we retry with
   `-e .` before giving up. The last 40 lines of combined stdout+stderr
   are captured on failure.

3. **`PytestResult.provisioning` + `AssessResult.provisioning`.** A new
   optional field surfaces provisioning state up through `runPytest` →
   `assess` → the `assess: complete` log line:

   ```ts
   provisioning?: {
     pythonPath: string;
     pythonVersion: string;
     installOk: boolean;
     installSummary?: string;  // tail-40 of stderr on failure
   };
   ```

   The gate computation (`computeGateResults`) now requires
   `provisioning?.installOk !== false` for `gate.build` to be true.
   Rationale: install failure means the built project's dependency
   declaration is broken, so `gate.build` must reflect it regardless of
   whether the (stdlib-only) imports happen to succeed.

The `PickPythonDeps` / `RunPytestDeps` surfaces are exported so unit
tests inject fakes instead of spawning real subprocesses. No production
caller uses them.

## Consequences

**Positive:**

- `factory build example` (Phase 5c target) will produce a green verify
  gate when the built project is actually correct, instead of failing
  environmentally on every non-stdlib Python build.
- The assessor's decision trail is now observable: one `info` log line
  per invocation records which Python was chosen and why.
- Install failure is a distinct first-class signal — it no longer masks
  as "pytest exit 5: no tests collected".
- The project's `requires-python` declaration becomes load-bearing for
  the assessor, not just metadata. This matches how `pip` itself treats
  the field.

**Negative:**

- **Host pollution risk.** `pip install -e .` mutates the chosen
  interpreter's site-packages. If that interpreter is the host's global
  Python (no venv, no versioned interpreter), subsequent factory builds
  for unrelated projects share state. Tier-1 trade-off — tier-2
  (`.factory/assessor-env/`) is the right long-term fix. Mitigation: the
  factory's standard setup increasingly assumes per-project venvs, and
  the `.venv` preference picks them up automatically when the scaffolder
  produces one.
- **Added latency.** Each assess call now spends ≤180 s on `pip
install`. Typical installs with a warm pip cache finish in <5 s; cold
  cache is closer to 30 s. Acceptable for end-of-build gate latency.
- **Install failures for reasons unrelated to the build** (network out,
  PyPI throttle, broken user env) now mark `gate.build: false`. This is
  a real false positive on the build's "quality". The
  `provisioning.installSummary` field is the operator's breadcrumb;
  future tier-2 caches will make this much less common.
- **Still no Node coverage.** A Node project would go through the same
  code path and get `testsPassed: 0` because the runner is
  pytest-specific. Out of scope for tier 1; tier 3 addresses it.

**Reversible?** Yes. The runner accepts the same `AssessOptions` shape;
the new `provisioning` field is optional and consumers unaware of it
still function. Reverting is a local change to `pytest.ts` and
`assess.ts`.

## Alternatives considered

- **Tier 2 — per-project `.factory/assessor-env/`.** Correct long-term
  design but requires (a) cache-key design (dep-manifest hash), (b) a
  `runtime` declaration in `plan.json` that the scaffolder emits and the
  assessor consumes, and (c) cross-platform venv creation with graceful
  fallback when the system Python can't `venv`. Two-session scope at
  minimum; deferred until one or two more projects surface the need.

- **Tier 3 — pluggable runtimes.** The full design. Right shape for
  factory's multi-language future (Go, Rust) but overkill when Python is
  the only non-Node runtime we've hit. Deferred until a second runtime
  lands.

- **Run everything in a fresh venv per assess call.** Rejected: venv
  creation is ~5 s, dep install on a cold env is another 10-30 s. The
  assessor already runs at the end of every `factory build`;
  multiplying that by two to four minutes of venv setup is not
  worthwhile when the tier-1 approach captures 90% of the value for no
  per-call overhead beyond the install itself.

- **Auto-create a venv when none is present.** Rejected: the scaffolder
  agent is the right place to create venvs (it knows the project's
  intent). Creating one implicitly from the assessor would hide
  provisioning as a side effect of running tests, which is the wrong
  layer. The assessor's job is to _use_ the env, not to _choose_ it.

- **Require `pytest-json-report` and parse JSON.** Rejected separately
  in `pytest.ts`'s header — avoiding the plugin dependency keeps the
  assessor's install surface small and the parsing logic under 60
  lines. Unchanged by this ADR.

## Implementation notes — 2026-04-19 (Phase 5f, I006 fix)

The Phase 5 close-out rerun surfaced
[I006](../issues/I006-assessor-pip-install-pollutes-user-site.md): when
`pickPython` fell through to the system interpreter (no project
`.venv/`), `pip install -e .` registered the project in the user's
site-packages (`%APPDATA%\Python\Python311\site-packages` on Windows;
`~/.local/lib/python3.11/site-packages` on Unix). A second
factory build of a same-named project then saw the previous install's
`.pth` entries on `sys.path` and imported the stale workspace's
modules. The ADR's "Negative consequences → Host pollution risk"
paragraph flagged this explicitly and deferred the fix to tier 2.

Phase 5f takes the narrow slice of tier 2 that closes I006 without
introducing a dep-manifest-hash cache or a `runtime:` plan declaration
— it just ensures the install site is always a venv.

**Install-site precedence (implemented in
`packages/assessor/src/runners/pytest.ts`):**

1. `<projectPath>/.venv/` — user-controlled. `pickPython` short-circuits
   on step 2 and `ensureAssessorVenv` keeps it. Reported as
   `provisioning.venvSource: 'project'`.
2. `<projectPath>/.factory/assessor-env/` — factory-managed. Created
   on demand via `<basePython> -m venv <envPath>`; reused across
   incremental assesses by checking that the venv's interpreter file
   exists. Gitignored via the pre-existing `.factory/` guard so no
   project state leaks. Reported as `'factory-managed'`.
3. Base interpreter — only used when steps 1/2 both fail (no `.venv/`
   - `python -m venv` refuses + optional `virtualenv` binary missing
     from PATH). Logged at `warn`, reported as `'system'`; carries the
     pre-fix pollution risk, so the surfaced field tells operators to
     install `python -m venv` support on the host.

**Why this is still tier 1 in spirit.** No cache key, no manifest hash,
no plan-level `runtime:` declaration, no pluggable dispatch. The venv
is simply "where we install" — its lifecycle is governed by the same
trivial presence-check cache as the project's own `.venv/`. Tier 2's
full design (manifest-hashed env names, runtime declarations) and
tier 3 (pluggable runtimes for Go/Rust/JS) remain deferred.

**Cross-platform invariants.** Venv interpreter paths follow the
Python venv module's conventions: `Scripts/python.exe` on Windows,
`bin/python` on Unix. The venv is invoked with empty `prefixArgs` —
a venv python is launched directly, not via the `py` launcher.

**Testing seam.** `ensureAssessorVenv` is exported and injection-only
for unit tests (no real subprocess / no real fs mutation in the
workspace suite). Integration coverage comes from the live
`factory build` validation runs.
