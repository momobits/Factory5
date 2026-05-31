# ADR 0038 — Assessor installs `requirements.txt` dependencies

# Status

Accepted (2026-05-31)

Relates to: 0017 (extends — Assessor Python provisioning), 0026 (Assessor multi-runtime)

## Context

The Python runtime assessor provisions an isolated venv and installs the built
project's declared dependencies so the import smoke + pytest run against a real
environment (ADR 0017). But the install step recognised **only `pyproject.toml`**
(`pip install -e .[test]`, with an `-e .` fallback). `provisionAssessorEnv`
returned early with `installOk: true` — having installed nothing — whenever a
project shipped no `pyproject.toml`. `requirements.txt` was never referenced
anywhere in the assessor.

`requirements.txt` is the dominant dependency-declaration convention for
**applications** (as opposed to packaged libraries), so this gap silently broke
any generated app that used it:

- An autonomous web-UI build for the **fluiddynamics** project (a pygame fluid
  sim) — directive `01KSXFWEERWNKF1F656278TD9F` — created an empty
  `.factory/assessor-env/` venv, then failed every third-party import. The
  daemon log recorded `gate.verify=false`, `failureMode: BUILD_FAILURE`,
  `importErrors: ["… No module named 'pytest'", "… 'tomli'", "… 'numpy'"]`, and
  — tellingly — `provisioning.installOk: true` despite nothing being installed.
- All nine worker tasks passed; the block came purely from the verify gate
  (`loop.ts` sets `hadFailures = anyTaskFailed || !verify`). With no
  auto-fixable findings, autonomous self-heal had nothing to do, so the brain
  correctly escalated and parked the directive as `blocked`. The verify gate
  could **never** pass for such a project — not a code-quality problem, an
  assessor provisioning gap.

## Decision

Broaden `provisionAssessorEnv` (`packages/assessor/src/runners/pytest.ts`) to
install from **both** conventions, combining them when both are present:

1. **`pyproject.toml`** → `pip install -e .[test]` (with `-e .` fallback) —
   unchanged from ADR 0017; installs the project itself plus declared deps.
2. **`requirements.txt`** (and the common siblings `requirements-dev.txt`,
   `dev-requirements.txt`, `requirements-test.txt`) → `pip install -r <file>`
   for each that exists.

`installOk` reflects **all** install steps that ran; the first failure's output
tail is captured into `installSummary` (a failed install still surfaces as
`failureMode: ENV_SETUP_FAILURE`). When neither manifest is present, nothing is
installed and `installOk` stays `true` — an empty venv is the correct result,
and a project that imports undeclared third-party packages still surfaces that
accurately as an import/build failure rather than a provisioning failure.

Node already provisions via `pnpm install` (ADR 0026); Go and Rust fetch
dependencies through their own toolchains during build/test. No change there.

## Consequences

- Python projects using the `requirements.txt` convention now provision
  correctly, so their verify gate can pass and autonomous directives stop
  blocking on a phantom build failure.
- A genuinely missing/undeclared dependency is still caught — as an honest
  import/build failure, with the real module name — instead of being masked by
  a falsely-`true` `installOk`.
- Marginally more install time when a project carries both a `pyproject.toml`
  and a `requirements.txt`; both are installed.
- `installOk` is now an aggregate across potentially multiple `pip` invocations.

## Alternatives considered

- **Require generated Python projects to ship a `pyproject.toml`** — rejected:
  `requirements.txt` is the dominant application convention; the assessor should
  not dictate the project's packaging style.
- **Synthesize a `pyproject.toml` from `requirements.txt`** — rejected: fragile
  and hides the project's real manifest.
- **Install `requirements.txt` only when no `pyproject.toml` exists** —
  rejected: projects legitimately use both (e.g. packaging metadata in
  `pyproject.toml`, pinned runtime deps in `requirements.txt`).
