---
id: I003
severity: MEDIUM
area: brain/scaffolder
status: OPEN
created: 2026-04-19
---

# Scaffolder omits project-hygiene artifacts (README ≥30 lines, LICENSE, comprehensive .gitignore)

## Description

The factory's scaffolder produces the bare minimum to build + test the project
— `pyproject.toml`, package `__init__.py` files, etc. — but does not produce
the "project hygiene" artifacts the assessor checks for `gate.verify`:

- **No `README.md`** (assessor requires README with ≥ 30 non-empty lines).
- **No `LICENSE`** (assessor looks for `LICENSE`, `LICENSE.md`, `LICENSE.txt`).
- **`.gitignore` too thin**: on the Phase 5c live run it contained only
  `.factory/`. The scaffolder for a Python project should ignore
  `__pycache__/`, `*.pyc`, `.pytest_cache/`, `.coverage`, `*.egg-info/`, at
  minimum.

Under the previous broken assessor (Phase 5b), `gate.verify: false` was
dominated by `gate.build: false` (the pytest environment mismatch — see
I002), and the artifact failures were mostly invisible. With the ADR 0017
provisioning fix landed, `gate.build: true` + `gate.integration: true` is now
achievable, and the remaining `gate.verify: false` is entirely driven by
these missing artifacts:

```
gate.build:       true
gate.integration: true
gate.verify:      false   ← blocked by the three below
testsPassed:      129
testsFailed:      0
importsOk:        true
...
hasReadme:        false
hasLicense:       false
hasGitignore:     true    ← present, but incomplete
hasArchitecture:  true
gitClean:         false   ← generated .egg-info / __pycache__ / .coverage pollute status
```

## Repro / evidence

- Live run: directive `01KPJCH7HC7ECW1VRFC4QYWM79` (Phase 5c, 2026-04-19).
- Scaffolder output: `pyproject.toml`, `src/__init__.py`, `tests/__init__.py`
  only. The architect's wiki at `docs/knowledge/` was silent on
  README/LICENSE content.
- Post-run local reassess: `scripts/reassess.ts <project> <plan.json>` →
  gate.verify=false with the three failing flags above.
- `git status --porcelain` shows `__pycache__/*.pyc`, `.coverage`, `*.egg-info/`
  as untracked/modified after the assessor's pip install + pytest run — the
  current `.gitignore` doesn't cover them.

## Hypothesis

Two independent lines of cause:

1. **Architect + scaffolder prompts are under-specified for "project hygiene".**
   The architect's module wiki covers what the code does, not what the
   repo-level metadata looks like. The scaffolder, given `pyproject.toml +
src/... + tests/...` as expected outputs, emits exactly those files.
   Neither prompt says "produce a README ≥30 lines" or "produce a LICENSE
   or defer to a downstream tool." So neither fires.

2. **Assessor's `gitClean` check is intentionally strict, but downstream of
   `pip install -e .` — so it reports dirty even when the commit itself was
   clean at merge-back time.** The assessor runs
   `provisionAssessorEnv` (pip install), then the pytest subprocess, both of
   which emit generated files (`*.egg-info/`, `__pycache__/`, `.coverage`)
   into the project tree. A comprehensive `.gitignore` would mask these.

## Resolution

(filled when work begins)

Suggested direction (tier 1, prompt-only):

- Update the architect prompt to include a line like "describe the
  repo-level files the project needs (README, LICENSE, .gitignore) and what
  they should contain" as part of its `overview.md` output.
- Update the scaffolder agent prompt / agent registry entry to include
  README / LICENSE / comprehensive .gitignore in its default outputs for any
  project type it recognises.
- At minimum, ship a Python-project `.gitignore` template the scaffolder
  uses as a baseline — it's well-known and stable.

Tier 2 (requires factory-wide policy): introduce a dedicated **hygiene
pass** task (verifier-adjacent) that checks artifacts pre-gate and emits
findings rather than relying on the builder tasks to remember. Defer until
we've seen whether the tier-1 prompt fix holds across multiple project
types.

Not the root cause of the Phase 5b / 5c verify-gate failure (that was
I002); but with I002 resolved this is now the dominant remaining gap
between "factory builds" and "verify gate green".

## Related

- I002 — assessor env provisioning (resolved via ADR 0017, 2026-04-19).
  Exposed I003 by lifting the verify-gate ceiling past `gate.build`.
