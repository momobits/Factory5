---
id: I006
severity: HIGH
area: assessor
status: RESOLVED
created: 2026-04-19
resolved: 2026-04-19
---

# Assessor's `pip install -e .` pollutes the user-site Python env — cross-project contamination

## Description

`pickPython` in `packages/assessor/src/runners/pytest.ts` picks an
interpreter (prefers `<projectPath>/.venv/…`, falls back to the system
`py -3.11`) and then runs `<python> -m pip install -e ".[dev]"` against
the project. When the chosen interpreter is the system install (no
per-project `.venv`), pip's default behaviour is to install the
editable project into the current user's
`%APPDATA%\Python\Python311\site-packages` (user-site) and register a
`.pth` that adds the project's `src/` directory to Python's `sys.path`.

That registration persists across factory runs. A second build of a
project whose `pyproject.toml` declares the same distribution name
(e.g. two successive `factory build example` runs into
`factory5-v5-final-example-N` workspaces — both declare
`name = "example-cli-app"`) ends up with **two entries** in sys.path,
and the **first-installed** workspace wins for `import <package>`.

Symptom: the assessor's `checkPythonImports` (and pytest's collection)
resolves `from models import DailyForecast` to the stale workspace's
`src/models.py`, whose classes differ from the new build's. Every
import of a module whose shape changed between the two builds raises
an `ImportError` — `gate.build` drops to false on a project whose own
source is otherwise fully correct.

## Repro / evidence

Phase 5 close-out live rerun, Run A attempt-3
(`factory build example --workspace /c/Users/Momo/factory5-v5-final-example-4`,
directive `01KPK0B9ZSZWSQ0V9AF74820NS`, 2026-04-19T13:57):

- 6/6 tasks succeeded. scaffolder merged, models merged, two siblings
  (`api` + `formatter`) both merged at same-millisecond, cli merged,
  verifier ran. All files present on main with `gitClean: true`.
- `assessor-env: install complete installOk:true` — the `pip install
-e ".[dev]"` step itself succeeded. Provisioning signal is green.
- `assess: complete` still reported
  `gate: {build: false, integration: true, verify: false}`,
  `testsPassed: 58`, with **all five `importErrors` pointing at an
  earlier workspace's paths**:

  ```
  tests.test_models: ImportError: cannot import name 'DailyForecast'
    from 'models' (C:\Users\Momo\factory5-v5-final-example-3\example\src\models.py)
  tests.conftest: ImportError: cannot import name 'DailyForecast'
    from 'models' (C:\Users\Momo\factory5-v5-final-example-3\example\src\models.py)
  src.api: ImportError: cannot import name 'DailyForecast'
    from 'models' (C:\Users\Momo\factory5-v5-final-example-3\example\src\models.py)
  tests.test_api: ImportError: cannot import name 'ApiError'
    from 'api' (C:\Users\Momo\factory5-v5-final-example-3\example\src\api.py)
  tests.test_formatter: ImportError: cannot import name 'DailyForecast'
    from 'models' (C:\Users\Momo\factory5-v5-final-example-3\example\src\models.py)
  ```

- `py -3.11 -m pip show example-cli-app` confirmed:

  ```
  Name: example-cli-app
  Version: 0.1.0
  Location: C:\Users\Momo\AppData\Roaming\Python\Python311\site-packages
  Editable project location: C:\Users\Momo\factory5-v5-final-example-3\example
  ```

- `py -3.11 -c "import sys; [print(p) for p in sys.path]"` showed both
  `example-3\src` (contaminant) and `example-4\src` (current build) on
  sys.path, with example-3 ordered first.

After `py -3.11 -m pip uninstall -y example-cli-app` to scrub the
contaminant, **re-running the assessor** against example-4 via
`npx tsx scripts/reassess.ts` returned:

```
gate.build:       true
gate.integration: true
gate.verify:      true
testsPassed:      58
testsFailed:      0
importsOk:        true
gitClean:         true
hasReadme:        true
hasLicense:       true
hasGitignore:     true
hasArchitecture:  true
```

Confirming the build itself is correct; the gate failure is entirely
I006's contamination.

## Hypothesis

`pickPython` needs to isolate the assessor's install from the shared
user-site. Candidate fixes, in rough order of invasiveness:

1. **Per-project isolated venv** (tier 1). Before the install step,
   create `<projectPath>/.factory/assessor-env/` via `<picked-python>
-m venv .factory/assessor-env`, then use
   `.factory/assessor-env/Scripts/python.exe` (or `bin/python` on
   Unix) for both `pip install` and `pytest`. Isolates every assess
   run from every other project's editable installs and from the
   user's global env. Slight cost on cold assessments (venv creation
   - dependency install), but `.factory/` is already gitignored so
     state carries across incremental assesses within one project.
2. **`pip install --target <tmpdir>` with PYTHONPATH injection.**
   Install into a scratch directory, run pytest with
   `PYTHONPATH=<tmpdir>`. Cheaper than a venv but fiddly around
   console-scripts / entry-points / binary wheels.
3. **Pre-uninstall any prior install of the project's distribution
   name.** Read `pyproject.toml` → `project.name`, run
   `pip uninstall -y <name>` before `pip install -e .`. Minimises
   change but only handles the specific "two workspaces sharing a
   name" case, not the broader "we polluted the user's env with
   factory-managed packages" problem. Also a loud operation against
   the user's global env.

Tier 1 is the cleanest. It aligns with ADR 0017's "the assessor
provisions its own env" direction and makes the contract between
runs independent.

## Resolution

**Landed:** 2026-04-19 (Phase 5f).

**Tier 1 per-project isolated venv** — implemented as
`ensureAssessorVenv` in `packages/assessor/src/runners/pytest.ts`.
Sits between `pickPython` and the `pip install -e .` step and routes
the install site through one of three layers (new
`provisioning.venvSource` field makes the decision observable):

1. **`project`** — `<projectPath>/.venv/` exists: reuse it
   (user-controlled env wins).
2. **`factory-managed`** — `<projectPath>/.factory/assessor-env/`.
   Created on demand via `<basePython> -m venv <envPath>`; reused
   across incremental assesses via presence check on the venv's
   interpreter binary. Covered by the existing `.factory/` gitignore.
3. **`system`** — fall through only when `python -m venv` fails AND
   `virtualenv` isn't on PATH; logs `warn` so operators can install
   venv support.

**Tests:** +8 assessor tests (34 → 42; workspace 247 → 255) covering
project-venv reuse, factory-managed create + reuse, Windows/POSIX
path layout, system-fallback, virtualenv fallback, and
`provisionAssessorEnv` → `ensureAssessorVenv` wiring.

**Live evidence (directive `01KPKPJ2ECBVQS15MGE3ZYDHYT`,
workspace `/c/Users/Momo/factory5-v5f-example`, spend $5.84):**

```
assessor-env: creating venv envPath=...\.factory\assessor-env
assessor-env: venv created durationMs: 11945
assessor-env: interpreter ready venvSource: factory-managed
assessor-env: install complete installOk: true durationMs: 32515
assess: complete gate: {build: true, integration: true, verify: true}
  testsPassed: 95 importErrors: []
  provisioning: { venvSource: factory-managed, pythonPath:
    ...\.factory\assessor-env\Scripts\python.exe }
brain: inline run complete terminalStatus: complete openFindings: 0
```

Belt-and-braces `scripts/reassess.ts` run against the same workspace
hit the reuse path (`assessor-env reused`, install in 8.6 s — a clean
cold-vs-warm delta) and returned the same green gates.

**Scope caveat.** I006 specifically names the **assessor**'s
`pip install -e .`. The fix closes that path. Post-fix inspection of
user-site showed a leftover `__editable__.example_cli_app-0.1.0.pth`
pointing at a (now-deleted) task worktree — installed by a **builder**
agent doing its own `pip install -e .` inside the worktree as part
of test-driven development. That pollution is orthogonal to I006 and
_functionally inert_ post-fix because the assessor's venv sets
`include-system-site-packages = false` and can't see user-site.
Filed separately as I007 (LOW) for hygiene.

**Documentation:** ADR 0017 gained an "Implementation notes" section
covering the precedence + venv lifecycle; no new ADR.

## Related

- ADR 0017 — assessor env provisioning. Tier 1 (per-project venv) is
  a natural extension of 0017's model; the ADR anticipated that host
  `python` as a fallback could bleed state, but deferred the
  .factory/assessor-env/ path to "after a few projects surface the
  need". Phase 5 close-out is that moment.
- I002 — RESOLVED in Phase 5c. I002 closed the "host Python doesn't
  have our deps" gap via `pip install -e .`. I006 is the other side
  of that trade: the install went somewhere, and without
  per-project isolation it's the user-site.

## Surfaced by

Phase 5 close-out session, 2026-04-19. The issue does **not** fire
on the first `factory build` against any one project in a clean user
environment — it only manifests when a previous `factory build
<same-named-project>` has left a `.pth` + site-packages entry
behind. Clean-system single-project builds in prior Phase 5 sessions
(5b, 5c, 5d) never hit this because no contamination existed yet.
