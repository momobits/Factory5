---
name: language-toolchain-setup
description: |
  Pick the correct runtime version (Python, Node) for a project before
  installing dependencies or running tests. Match the project's declared
  version constraint to an installed interpreter; do not rely on bare
  `python` / `node` on PATH. Use during scaffolding and before any
  build/install/test step in a fresh worktree.
---

# Language Toolchain Setup

Before installing dependencies or creating a virtual environment, pick
the runtime version that matches the project's declared constraint.
**Do not** rely on the bare `python` or `node` on PATH — on Windows
those typically resolve to the oldest installed version, which usually
doesn't satisfy modern projects.

This skill applies to the **runtime version selection** that comes
_before_ the `dependency-install` skill's `pip install` / `pnpm install`
steps. Pick the interpreter first, then install dependencies into it.

## Python

### 1. Read the project's version constraint

In order of preference:

- `pyproject.toml` → `[project]` table → `requires-python` (e.g.
  `">=3.11"`, `"~=3.12.0"`, `">=3.11,<3.13"`)
- `.python-version` file at the project root (single version, used by
  pyenv)
- If neither exists, default to the highest installed Python 3.x and
  emit a `FINDING [LOW] pyproject.toml: no requires-python constraint`
  so the operator sees the missing declaration.

### 2. Enumerate installed interpreters

**Windows** — use the `py` launcher (ships with the standard Python
installer, lists every installed version including non-PATH ones):

```cmd
py --list
```

Output is one line per installed version, e.g.:

```
 -V:3.13          *
 -V:3.12
 -V:3.11
 -V:3.10
```

**macOS / Linux** — probe versioned binaries on PATH:

```bash
for v in 3.13 3.12 3.11 3.10; do
  command -v "python$v" >/dev/null && "python$v" --version
done
```

### 3. Pick the lowest installed version that satisfies the constraint

Lowest matching, not highest. The project was almost certainly tested
against the floor of its declared range; picking 3.13 when the
constraint is `>=3.11` risks using newer syntax/stdlib that won't run
on a 3.11 deployment target.

Examples:

- Constraint `>=3.11`, installed `{3.11, 3.12, 3.13}` → pick **3.11**
- Constraint `>=3.12`, installed `{3.11, 3.13}` → pick **3.13**
  (3.11 doesn't satisfy, 3.13 does, no 3.12 available)
- Constraint `~=3.12.0`, installed `{3.11, 3.12, 3.13}` → pick
  **3.12** (`~=3.12.0` means `>=3.12.0, <3.13`)

### 4. Create the venv with that specific interpreter

**Windows:**

```cmd
py -3.11 -m venv .venv
```

**macOS / Linux:**

```bash
python3.11 -m venv .venv
```

Substitute the version you matched in step 3.

### 5. Use the venv's interpreter by absolute path from here on

Do NOT rely on `source .venv/bin/activate` / `.venv\Scripts\Activate.ps1`
— activation behavior varies across PowerShell / cmd / bash and breaks
in subprocess inheritance. Reference the interpreter directly:

**Windows:**

```cmd
.venv\Scripts\python.exe -m pip install -e ".[test]"
.venv\Scripts\python.exe -m pytest
```

**macOS / Linux:**

```bash
.venv/bin/python -m pip install -e ".[test]"
.venv/bin/python -m pytest
```

### Validation: confirm the venv satisfies the constraint

After creation, probe:

```cmd
.venv\Scripts\python.exe --version
```

Confirm the output matches what you intended. If it doesn't (e.g.
the venv picked up a different interpreter because of a PYTHONHOME
env-var quirk), delete and recreate the venv pointing at the explicit
launcher version.

## Node.js

### 1. Read the project's version constraint

- `package.json` → `engines.node` (e.g. `">=20.0.0"`)
- `.nvmrc` file at the project root (single version, used by nvm)

If neither exists, use the system `node` and emit a
`FINDING [LOW] package.json: no engines.node constraint`.

### 2. Check the installed version

```bash
node --version
```

### 3. Decide

- Version satisfies the constraint → proceed with `pnpm install` /
  `npm install` as normal (see the `dependency-install` skill).
- Version does NOT satisfy the constraint:
  - If `nvm` is available: `nvm use <required-version>` (or
    `nvm install <required>` then `nvm use`).
  - If not: emit a `FINDING [HIGH] package.json: engines.node
requires <X>, system has <Y>` and stop. Do not attempt to
    install a new Node — that's an operator-level concern.

## If no installed runtime satisfies the constraint

**Do not** attempt to install Python or Node automatically. Installing
system-level toolchains has security and side-effect implications that
belong to the operator, not the agent.

Instead:

1. Emit a finding describing the gap:
   ```
   FINDING [HIGH] pyproject.toml: requires-python "<constraint>"
   not satisfied by any installed Python (available: 3.10, 3.13).
   Operator must install Python <required>.
   ```
2. Stop the task. Surface the missing-runtime condition in your
   task summary so the brain parks the directive and the operator
   sees what to do next.

## Why "lowest matching" not "highest"

A project that declares `requires-python = ">=3.11"` is saying "I work
on 3.11 and later". Its CI matrix and the version it was tested
against are likely 3.11. Using 3.13 for development risks introducing
3.12+ syntax (PEP 695 type parameters, etc.) that won't run on 3.11
deployment targets — and the tests won't catch this because they're
running on 3.13 too.

Picking lowest-matching keeps the agent honest about the project's
compatibility floor.

## Rules

- Always pick the interpreter version before creating a venv. Never
  let `python -m venv` use a default that happens to be on PATH.
- Always reference the venv's interpreter by absolute path after
  creation. Avoid `activate`.
- Capture all `pip install` output with `2>&1`. The actionable error
  is usually in the last ten lines.
- If you change `pyproject.toml`'s `requires-python` constraint, the
  factory5 assessor's persistent venv at `.factory/assessor-env/` will
  auto-recreate on next assessor run (it validates installed-version
  against constraint before reuse). No operator action required.
- Per-task worktree venvs (`<worktree>/.venv/`) are ephemeral and
  always created fresh against the current constraint.
