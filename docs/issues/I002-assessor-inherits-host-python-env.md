---
id: I002
severity: HIGH
area: assessor
status: RESOLVED
created: 2026-04-19
resolved: 2026-04-19
---

# Assessor inherits the host's Python env — no venv, no dep install, no runtime version pin

## Description

`packages/assessor/src/runners/pytest.ts` calls `python -m pytest` by resolving `python` on `PATH`. No venv is provisioned, no `pip install` is run, and no check is made that the host Python matches the `requires-python` the scaffolder declared in `pyproject.toml`. The gate result reflects the host's environmental luck, not whether the built project is actually valid.

This was not caught until the Phase 5b live run (2026-04-19) because the Phase 2 finale spec happened to declare only stdlib-ish code. On the Phase 5b live run the planner correctly picked `from enum import StrEnum` (Python 3.11+) matching `pyproject.toml`'s `requires-python = ">=3.11"`, but the host's `python` on PATH was 3.10 — so the assessor's `pytest` invocation failed at import time and every gate returned `false`. The brain then escalated via `askUser`, as designed, and was killed mid-escalation by the shell-timeout I'd set on the background command. The build's **actual deliverable** (6 tasks, 25 source files, green merges) was fine; the gate just couldn't see it.

## Repro / evidence

- Live run: directive `01KPHAYCJSYFC7RK3EPZ3B0XKA`. Pool result: 6/6 succeeded, 0 failed, all merged. Assessor result: `{build: false, integration: false, verify: false, testsPassed: 0, testsFailed: 0}`.
- Ran `py -3.10 -m pytest` manually against the built project → `ImportError: cannot import name 'StrEnum' from 'enum'` at `src/models.py:10`.
- `py -3.11` exists on the host but is not on PATH; the assessor has no way to discover or select it.
- Attempting `py -3.11 -m pip install -e ".[test]"` into a venv also failed during package metadata generation — needs investigation, but is a separate symptom of "we assume pip-installable deps work".

## Hypothesis

The assessor was designed when the only expected runtime was Node (project-side dependencies are vendored into `node_modules/` with `pnpm install` already run — no extra work needed to `pytest`). Python dropped in because the `example` template is Python; no one audited the runner contract against that assumption.

Fixing this well means treating "test environment" as a first-class factory concern: declare what the project needs (language + version + deps), provision it before the assessor runs, tear it down cleanly. The scaffolder already has the information — `pyproject.toml` is the truth — but nothing in the pipeline consumes it.

## Resolution

(filled when work begins)

Suggested direction — three levels of ambition, cheapest first:

1. **Minimum viable (one session).** Teach the pytest runner to (a) detect a project-local `.venv/` and prefer its Python over PATH; (b) if it sees `pyproject.toml` with `requires-python = ">=3.11"`, prefer `py -3.11` (Windows) or `python3.11` (Unix) over bare `python`; (c) invoke `python -m pip install -e ".[test]"` (or without `[test]` if the extra doesn't exist) inside the selected interpreter once at the start of the assessor run, with output captured and surfaced on failure. Log at warn when a requested Python version isn't available.

2. **Proper (ADR-worthy).** Introduce a per-project factory-managed env under `.factory/assessor-env/` (venv for Python, `.factory/assessor-env/node_modules/` for Node). The scaffolder declares `runtime: python>=3.11` or `runtime: node>=20` in `plan.json`; the assessor provisions and caches the env on first run; cache is keyed by the dep-manifest hash so subsequent runs are cheap. Cross-platform via a single runner interface with pluggable backends.

3. **Full.** A `runtime` pluggable system: the scaffolder declares runtime, the assessor looks up the runtime's provisioner (`.factory/runtimes/python.ts`, `.factory/runtimes/node.ts`), which handles env provisioning + test invocation. Makes future languages (Go, Rust) additive.

Not a blocker for Phase 5b validation — ADR 0016's three behaviours are independently confirmed. But it IS what stopped this run from ending with a green verify gate, and it will bite every future non-Node build the same way.

## Related

- I001 — planner over-serialisation. Orthogonal, both surfaced by the same Phase 5b live run.
- ADR 0016 — the behaviours that are working correctly; this issue is downstream.
