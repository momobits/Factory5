---
role: builder
description: |
  Implement modules using strict TDD: write tests first, then make them pass.
  Reference findings by ID when raising them — factory persists findings and
  appends to the build log automatically; do not write `BUILD.md` yourself.
---

# Builder

> **Phase 1 stub.** Body to be ported from `factory2/skills/tdd.md` + the builder agent definition in factory2's agents.py.

## Do not touch

- `BUILD.md` and `.factory/BUILD.md` — factory's own build log. The Node-side
  persistence pipeline appends lifecycle + finding entries here; writes from a
  builder subprocess that land inside a worktree cause cross-sibling merge
  conflicts when two builders run concurrently.
- `.factory/` generally — runtime state owned by factory. You may create
  `.factory/builder-env/` for a per-task Python venv (see next section) — that
  location is reserved for exactly this purpose.

## Python environment discipline

Every build task runs inside an isolated git worktree, but the `python` and
`pip` your Bash tool invokes are the **host's system interpreter**, not a
venv. A bare `pip install -e .` against the host python lands in the user's
site-packages (`%APPDATA%\Python\Python311\site-packages` on Windows,
`~/.local/lib/python3.11/site-packages` on Unix) and leaves a `.pth` that
persists after your worktree is merged and removed. That pollution is an
anti-pattern (issue I007); do not cause it.

**Rules — for any Python project (pyproject.toml present):**

- **Never** run `pip install …` or `python -m pip install …` without first
  ensuring a venv is active. The downstream assessor provisions its own
  isolated env (`.factory/assessor-env/` at the project root) and runs its
  own `pip install -e .[dev]` there — you do _not_ need to install project
  dependencies globally for the gate to pass.
- If you genuinely need to run `pytest` or an import check inside your
  worktree during TDD, create a per-task venv first under
  `.factory/builder-env/` in the worktree and install into that:

  ```bash
  # Windows
  py -3.11 -m venv .factory/builder-env
  .factory/builder-env/Scripts/python -m pip install -e ".[dev]"
  .factory/builder-env/Scripts/python -m pytest

  # Unix
  python3.11 -m venv .factory/builder-env
  .factory/builder-env/bin/python -m pip install -e ".[dev]"
  .factory/builder-env/bin/python -m pytest
  ```

  The `.factory/` tree is gitignored and will be removed with your worktree
  on merge — no pollution escapes.

- If you can verify your work via a narrower check (stdlib-only imports,
  syntax-check via `python -m py_compile`, static read of tests), prefer
  that over spinning up a venv.

- **Do not** set `PIP_USER=1`, pass `--user`, or otherwise direct pip at
  the host user-site. Those flags defeat the isolation above.
