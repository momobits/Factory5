---
name: dependency-install
description: |
  Handle dependency installation, virtual environments, and common failure
  modes. Use during scaffolding and whenever a build or import fails due
  to missing packages.
---

# Dependency Installation

Install and manage project dependencies reliably. Detect the project's
runtime first (per ADR 0026 — factory5 supports pluggable runtimes),
then apply the matching pattern. Capture errors verbatim and surface
them explicitly; never silently skip a failed install.

## Detect the runtime

Scout the project root before installing:

- `pyproject.toml` / `setup.py` / `requirements.txt` → Python project
- `package.json` → Node / TypeScript project (check the `"packageManager"` field; factory5 itself uses pnpm)
- `Cargo.toml` → Rust
- `go.mod` → Go
- `pom.xml` / `build.gradle` → Java / Kotlin

The skill applies to any of these; the patterns below cover Python
and TypeScript — the two factory5 first-classes today. For other
runtimes, follow the project's existing manifest and apply the same
shape: isolation → install → capture errors verbatim → narrow the fix.

## Python Projects

### Setup

Always use a virtual environment in the project root. Never install
into the system Python; the worker sandbox relies on venv isolation,
and the builder agent's preserved discipline (per
`prompts/agents/builder.md`) treats a missing venv as a stop-the-task
condition.

```bash
# 1. Create virtual environment in the project root
python3 -m venv .venv
source .venv/bin/activate          # POSIX
# .venv\Scripts\activate           # Windows PowerShell

# 2. Install project + dev/test extras
pip install -e ".[dev,test]" 2>&1
```

Do **not** use `--break-system-packages`. That flag exists for distros
where pip refuses system-Python installs; factory5 always installs
into the venv, never the system. If the venv isn't activated, fix the
activation rather than reaching for the override — it papers over the
isolation gap that the builder relies on.

### Common Failures

**Missing system library** (e.g. `libpq-dev`, `libffi-dev`):

- Read the error for the library name.
- Try `sudo apt-get install -y <lib>` if the runtime allows it.
- Otherwise switch to a pure-Python alternative (e.g. `psycopg2-binary`
  instead of `psycopg2`). Document the swap in your task summary so
  the operator sees the workaround.

**Version conflict**:

- Pin the conflicting package in `pyproject.toml` to a compatible
  version.
- Re-run `pip install -e .`.
- Don't downgrade Python itself — that breaks downstream tasks.

**Package not found**:

- Check spelling against PyPI.
- Check whether the package was renamed (e.g. `sklearn` →
  `scikit-learn`).
- If it's an optional heavy dependency, check whether a lighter
  alternative satisfies the actual requirement.

### Virtual Environment Rules

- `.venv` lives at the project root, not in `~/.venv` or other shared
  paths.
- Activate before every `pip` / `pytest` / `python` invocation.
- If `.venv` exists but is broken (mismatched Python version,
  permission errors, partial install), delete and recreate it.
- Never `sudo pip` anything.

## TypeScript / Node Projects

### Setup

Factory5 itself uses pnpm; most factory5-native TypeScript projects
do too. Detect by reading `package.json`'s `"packageManager"` field,
then run the matching install:

```bash
# pnpm (factory5 default)
pnpm install --frozen-lockfile 2>&1

# fall through to the project's pinned manager
npm install 2>&1
yarn install --frozen-lockfile 2>&1
```

`--frozen-lockfile` (pnpm / yarn) and `npm ci` are the safe shapes for
CI / build contexts; without them the install may rewrite the lockfile
and surface phantom diffs at commit time.

### Common Failures

**Peer dependency conflict**:

- pnpm is strict by default — read the error and add a
  `peerDependencyRules.allowedVersions` entry in the workspace root
  `package.json` if the conflict is genuinely benign.
- npm: try `npm install --legacy-peer-deps`; longer term, pin the
  peer in `package.json` `overrides`.

**Node version mismatch**:

- Check `engines.node` in `package.json`.
- Use the version specified. Remove the `engines` constraint only if
  the project actually supports a wider range than the field claims.

**Native module build failure**:

- Ensure the platform's build toolchain is available (`build-essential`
  on Debian; Xcode Command Line Tools on macOS; Visual Studio Build
  Tools on Windows).
- If the toolchain isn't available and can't be installed, switch to
  a prebuilt or pure-JS alternative (e.g. `better-sqlite3` → `sql.js`).
  Document the swap in your task summary.

## Rules

- Always capture install output: `pip install ... 2>&1`,
  `pnpm install 2>&1`. The actionable fix is usually in the last ten
  lines of a long error.
- Never silently skip a failed install — it will break the build later
  in a more confusing way.
- After fixing a dependency issue, re-run the project's full test
  suite to confirm nothing else regressed.
- Update `pyproject.toml` / `package.json` **before** committing.
  Lockfiles ship with the change.
- If the workaround you applied is non-obvious (pure-Python swap,
  prebuilt fallback, peer-rule allowlist), surface it in the task
  summary or as a `FINDING [LOW] <manifest-file>: <swap-reason>` so
  the reviewer sees the rationale.
