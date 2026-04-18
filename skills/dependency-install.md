---
name: dependency-install
description: |
  Handle dependency installation, virtual environments, and common failure
  modes. Use during scaffolding and whenever a build or import fails due
  to missing packages.
---

# Dependency Installation

Install and manage project dependencies reliably. Handle failures gracefully.

## Python Projects

### Setup

```bash
# 1. Create virtual environment
python3 -m venv .venv
source .venv/bin/activate

# 2. Install project + deps
pip install -e ".[dev,test]" --break-system-packages 2>&1
```

### Common Failures

**Missing system library** (e.g., `libpq-dev`, `libffi-dev`):
- Read the error for the library name
- Try: `sudo apt-get install -y <lib>` if permissions allow
- If no sudo: switch to a pure-Python alternative (e.g., `psycopg2-binary` instead of `psycopg2`)
- Note the workaround in BUILD.md Decisions

**Version conflict**:
- Pin the conflicting package to a compatible version in pyproject.toml
- Run `pip install -e .` again
- Do NOT downgrade Python itself

**Package not found**:
- Check spelling against PyPI
- Check if it was renamed (e.g., `sklearn` → `scikit-learn`)
- If it's an optional heavy dependency, check if a lighter alternative exists

### Virtual Environment Rules

- Always use `.venv` in the project root
- Activate before every pip/pytest command
- If `.venv` exists but is broken, delete and recreate it
- Never install globally with `sudo pip`

## TypeScript Projects

### Setup

```bash
npm install 2>&1
```

### Common Failures

**Peer dependency conflict**:
- Try: `npm install --legacy-peer-deps`
- If that fails: pin the conflicting peer in package.json overrides

**Node version mismatch**:
- Check `engines` field in package.json
- Use the version specified, or remove the engines constraint if flexible

**Native module build failure**:
- Switch to a prebuilt alternative (e.g., `better-sqlite3` → `sql.js`)
- Note the swap in BUILD.md Decisions

## Rules

- Always capture install output: `pip install ... 2>&1`
- If install fails, read the FULL error — the fix is usually in the last 10 lines
- Never silently skip a failed install — it will break the build later
- After fixing a dependency issue, re-run the full test suite to confirm nothing else broke
- Update requirements/package.json BEFORE committing
