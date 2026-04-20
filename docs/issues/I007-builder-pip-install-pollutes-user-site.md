---
id: I007
severity: LOW
area: brain/builder
status: RESOLVED
created: 2026-04-19
resolved: 2026-04-19
---

# Builder agents' `pip install -e .` inside worktrees pollutes the user-site Python env (hygienic, non-blocking)

## Description

During a Python `factory build`, builder agents — running Claude with
Bash access inside a per-task git worktree — regularly invoke
`pip install -e .` from the worktree as part of their own
test-driven-development loop (run tests → see failures → install deps
→ re-run). Because the builder's subprocess uses the host's system
Python (no venv inside the worktree), pip's default is to install into
the **user-site** (`%APPDATA%\Python\Python311\site-packages` on
Windows; `~/.local/lib/python3.11/site-packages` on Unix) and register
an `__editable__.<name>-<ver>.pth` there pointing at the worktree's
`src/`.

When the task worktree is subsequently merged-and-removed
(`worker.worktree: merged and removed`), the `.pth` file remains in
user-site **pointing at a path that no longer exists**. Cross-workspace
state therefore accumulates in user-site even though factory's own
gates are unaffected.

## Repro / evidence

Phase 5f live validation (directive `01KPKPJ2ECBVQS15MGE3ZYDHYT`,
workspace `/c/Users/Momo/factory5-v5f-example`, 2026-04-19):

- Pre-run: `py -3.11 -m pip show example-cli-app` → "Package(s) not
  found: example-cli-app" (scrubbed as preflight).
- Live run completed `terminalStatus: complete`, all gates true,
  `venvSource: factory-managed` (I006 fix holding).
- Post-run: `py -3.11 -m pip show example-cli-app` →

  ```
  Name: example-cli-app
  Version: 0.1.0
  Location: C:\Users\Momo\AppData\Roaming\Python\Python311\site-packages
  Editable project location: C:\Users\Momo\factory5-v5f-example\example\.factory\worktrees\task-01KPKPN09H2P9DTZ96J53NJN98
  ```

  The `Editable project location` points at a task worktree. Listing
  `.factory/worktrees/` shows the directory has been cleaned up
  (worktree merged successfully) — so the `.pth` now resolves to a
  dead path.

- Log forensics: `grep -iE 'pip install'` over the live-build log
  returned zero matches — the assessor pipeline's pip calls log
  through Pino but are scoped to the `assessor-env` venv. The
  pollution therefore originated inside a builder worktree's Bash
  subprocess, which logs no Pino line.

## Why it is not blocking

Post-I006, the assessor creates `.factory/assessor-env/` with
`include-system-site-packages = false` (the venv default). The
assessor's Python cannot see user-site; the assessor's import check
and pytest both run against the assessor-env Python. User-site
pollution therefore **cannot** contaminate the assessor's gate — the
exact contamination path that made I006 a HIGH is closed
regardless of whether builders write into user-site.

A human running `py -3.11 -c "import src.api"` directly against the
host's system Python (no venv) would see the stale `.pth` and
crash with `FileNotFoundError`. That's the one remaining surprise
surface.

## Hypothesis

Builder agents are instructed to validate their work (tests passing)
before merging. Without a pre-provisioned per-task venv, Claude's
natural reaction to "ModuleNotFoundError: httpx" is
`pip install httpx` or `pip install -e .`, which silently lands in
user-site because the process doesn't own a writable venv.

Candidate fixes, ordered by invasiveness:

1. **Builder-prompt addendum.** Instruct the builder: "Do not run
   `pip install`. The assessor installs your project's deps in a
   sandboxed venv after you hand off. Run tests with
   `python -m pytest` only if deps are already available; otherwise
   trust the assessor's downstream gate." Narrow prompt change,
   zero infra cost, but trusts the LLM to follow the rule.
2. **Per-task builder venv.** Before spawning the claude-cli
   subprocess, the worker creates `<worktree>/.factory/builder-env/`
   (mirror of the assessor tier-1 fix) and sets `PATH` + `VIRTUAL_ENV`
   so `python` / `pip` the builder invokes land in the task's own
   venv. Clean isolation; venv destroyed with the worktree on
   merge-and-remove; more code than #1 but no trust assumption.
3. **User-site cleanup pass.** Post-assess, `pip uninstall -y <name>`
   against the host's system Python. Brute-force; assumes we know the
   distribution name (pyproject.toml `project.name`); could disrupt
   a developer's deliberate install.

Tier 1 (prompt) is the right opening move — cheap, reversible. If the
pollution reappears despite the prompt change, escalate to tier 2 in a
follow-on session.

## Resolution

**Landed:** 2026-04-19 (same day as filing — tier-1 prompt-only fix).

**Tier 1 — builder-prompt discipline.** `prompts/agents/builder.md`
gained a "Python environment discipline" section that:

- Flags the user-site-pollution anti-pattern by name (I007).
- Forbids `pip install` against host system python without an active
  venv, and forbids `PIP_USER=1` / `--user` / direct writes to the
  host user-site.
- Gives the builder a sanctioned escape hatch: if TDD needs
  `pytest` with third-party deps, create a per-task venv under
  `<worktree>/.factory/builder-env/` and install into that (the
  `.factory/` tree is gitignored and goes with the worktree on
  merge-and-remove).
- Reminds the builder that the downstream assessor handles
  project-dep installation in its own isolated env
  (`.factory/assessor-env/` at the project root, I006 fix), so in
  most cases no local install is needed at all.

**No code change.** No worker package touches, no provider-interface
widening for env-var injection — saved for tier 2 if tier 1 fails.

**Tests:** None added. The fix is prompt-only; the existing 255-test
workspace suite still passes unchanged.

**Live evidence (directive `01KPKRNB2V08QZZD02SKTK6MWP`,
workspace `/c/Users/Momo/factory5-v5f-example-2`, spend $4.74):**

_Preflight:_ `py -3.11 -m pip uninstall -y example-cli-app parallel-example`
scrubbed the user-site (both had leftovers from prior sessions).
`py -3.11 -m pip show example-cli-app` → "not found".

_Run:_ `factory build example --autonomy autonomous --concurrency 2
--workspace /c/Users/Momo/factory5-v5f-example-2`. Pool completed
6/6 tasks (scaffolder, models, api, formatter, cli, verifier) with
siblings `api` + `formatter` starting `21:06:24.035Z` and `.036Z`
(1 ms apart — I001/I004 still holding). Assessor venv created at
`.factory/assessor-env/`, install OK, gate
`{build: true, integration: true, verify: true}`, 78 tests passed,
`terminalStatus: complete`.

_Post-run pollution check:_

```
$ py -3.11 -m pip show example-cli-app
WARNING: Package(s) not found: example-cli-app

$ ls 'C:/Users/Momo/AppData/Roaming/Python/Python311/site-packages/' | grep -i example
(empty)
```

Compared with the pre-fix Phase 5f run against
`factory5-v5f-example`, which left
`__editable__.example_cli_app-0.1.0.pth` + `example_cli_app-0.1.0.dist-info/`
in user-site: **this run's user-site is clean.** The builder followed
the prompt guidance and did not run `pip install` against host python.

The builder also did not bother creating `.factory/builder-env/` in
its worktree — the builders found they could write code + tests
without a local install-and-verify loop, trusting the downstream
assessor. That's the best-case outcome: no pollution, no extra
infra, unchanged build quality.

## Related

- I006 — RESOLVED 2026-04-19 (assessor venv isolation). I007's fix
  assumes I006 is in place: if the assessor were still installing
  into user-site, this prompt change wouldn't be enough.
- Phase 5f — the `ensureAssessorVenv` helper established the
  per-project venv pattern. I007's guidance points builders at the
  same convention (`.factory/<name>-env/`) for a per-task escape
  hatch.
- Potential follow-on: if future live runs show the prompt rule
  slipping (e.g., a builder fighting a missing-dep error decides
  to ignore the warning), escalate to **tier 2** — worker pre-creates
  `.factory/builder-env/` before spawning claude-cli and injects
  `VIRTUAL_ENV` + `PATH` prefix via the provider interface. ~30 min
  of worker code + tests.

## Surfaced by

Phase 5f live validation session, 2026-04-19. Closed the same day
via a narrow prompt rule + a clean re-validation run on
`/c/Users/Momo/factory5-v5f-example-2`.

## Related

- I006 — RESOLVED 2026-04-19 (assessor venv isolation). Reading
  I006's strict scope as "assessor's own `pip install`," I007 is
  distinct. But I006's fix is what makes I007 LOW rather than HIGH:
  the assessor can no longer be poisoned by leftover user-site state.
- ADR 0017 — implementation-notes section describes the assessor
  venv precedence that neutralises I007's gate-impact surface.

## Surfaced by

Phase 5f live validation session, 2026-04-19. Does not fire on
factory's own gates post-I006. Only visible by inspecting
user-site directly (`pip show <project-name>`).
