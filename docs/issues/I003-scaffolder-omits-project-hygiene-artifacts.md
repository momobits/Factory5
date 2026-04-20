---
id: I003
severity: MEDIUM
area: brain/scaffolder
status: RESOLVED
created: 2026-04-19
resolved: 2026-04-19
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

**Phase 5d (2026-04-19)**: tier-1 prompt-only fix landed and validated.

Shipped:

- `prompts/agents/scaffolder.md` — replaced the Phase 1 stub with a
  body that mandates three "repo-level hygiene files" as required
  output regardless of planner-provided `expectedOutputs.files[]`:
  - `README.md` with ≥30 non-empty lines covering Overview, Install,
    Usage, Testing, License (explicit section list and "README is
    content, not a stub" framing).
  - `LICENSE` defaulting to MIT with the current year and a sensible
    placeholder copyright holder; spec overrides.
  - Runtime-aware `.gitignore` — explicit Python block
    (`__pycache__/`, `*.pyc`, `.pytest_cache/`, `.coverage`, `htmlcov/`,
    `*.egg-info/`, `dist/`, `build/`, `.venv/`, `.factory/`) and Node
    block (`node_modules/`, `dist/`, `build/`, `*.tsbuildinfo`,
    `coverage/`, `.env*`, `.factory/`) with a fall-through note for
    other runtimes.
- `prompts/agents/architect.md` — rewritten from stub with a
  "Wiki scope" section that makes `overview.md` hygiene coverage
  mandatory (README content outline, license choice, runtime tag for
  `.gitignore`). Adds the load-bearing "if module A does not import
  module B, say so plainly" guidance that I001 needs.
- `packages/brain/src/architect.ts` inline user prompt updated in
  parallel so the inline and .md guidance agree.

Live validation (Phase 5d, 2026-04-19):

- **Run A** — `factory build example`: scaffolder produced `README.md`
  (108 non-empty lines), `LICENSE` (1110 bytes, full MIT), `.gitignore`
  (15 entries covering all Python cache/build artefacts plus
  `.factory/`).
- **Run B** — `factory build parallel-example`: scaffolder produced
  `README.md` (109 non-empty lines), `LICENSE` (1111 bytes), `.gitignore`
  (13 entries).

Both artefacts satisfy the assessor's `hasReadme`, `hasLicense`, and
`hasGitignore` checks, and the comprehensive `.gitignore` masks the
`pip install -e .` + `pytest` generated noise that was making
`gitClean: false` in Phase 5c.

Status: **RESOLVED**. Tier-2 (dedicated hygiene-pass task) stays
deferred — the prompt-only tier handled both project types cleanly.

Note: `gate.verify: true` is still unreachable end-to-end, but the
blocker is now a separate, newer issue — [I004](I004-worktree-concurrent-merge-race.md).
When two sibling builders merge back concurrently the second one's
commits are silently lost, which strands downstream builders and drops
`gate.build` via missing imports. I003's artefacts themselves are
correct on every run.

## Related

- I002 — assessor env provisioning (resolved via ADR 0017, 2026-04-19).
  Exposed I003 by lifting the verify-gate ceiling past `gate.build`.
