---
name: scaffolding
description: |
  Set up a new project from scratch. Use when BUILD.md doesn't exist yet
  or shows no completed items.
---

# Project Scaffolding

When starting a new project (no files exist yet), scaffold BEFORE implementing.

## Python Projects

```bash
# 1. Create directory structure from CLAUDE.md
mkdir -p src/<package> tests

# 2. Create pyproject.toml
cat > pyproject.toml << 'EOF'
[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[project]
name = "<project-name>"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = []  # Fill from CLAUDE.md tech stack

[project.optional-dependencies]
test = ["pytest", "pytest-cov", "pytest-asyncio"]
dev = ["ruff", "mypy"]
EOF

# 3. Create Makefile
cat > Makefile << 'EOF'
.PHONY: install dev test lint clean

install:
	pip install -e . --break-system-packages

dev:
	pip install -e ".[dev,test]" --break-system-packages

test:
	python -m pytest -v --tb=short

lint:
	ruff check .

clean:
	rm -rf __pycache__ .pytest_cache *.egg-info
EOF

# 4. Create .gitignore, .env.example, empty __init__.py files
# 5. Create virtual environment: python3 -m venv .venv
# 6. Install: make dev
# 7. Commit: git add -A && git commit -m "chore: scaffold project"
```

## TypeScript Projects

```bash
# 1. npm init -y
# 2. Install deps from CLAUDE.md tech stack
# 3. Create tsconfig.json with strict: true
# 4. Create directory structure
# 5. Add scripts to package.json: build, test, lint, dev
# 6. Create .gitignore
# 7. Commit: git add -A && git commit -m "chore: scaffold project"
```

## Always Include

- `.gitignore` covering: .env, **pycache**, node_modules, .venv, \*.pyc, dist/, .DS_Store
- `.env.example` listing required env vars (from CLAUDE.md) with placeholder values
- `Makefile` or `package.json` scripts for: install, test, lint, clean
- Empty `__init__.py` or `index.ts` in every package directory
- `tests/` directory (even if empty)

## After Scaffolding

Create BUILD.md with all modules from CLAUDE.md listed as Remaining.
Commit everything. Then start TDD on the first module.
