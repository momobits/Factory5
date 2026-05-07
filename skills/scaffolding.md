---
name: scaffolding
description: |
  Set up a new project from scratch. Use when BUILD.md doesn't exist yet
  or shows no completed items.
---

# Project Scaffolding

When starting a new project (no source files exist yet), scaffold
**before** implementing. Detect the project's runtime first (per
ADR 0026 — factory5 supports pluggable runtimes); the spec / CLAUDE.md
tells you which one. Apply the matching pattern below.

The scaffolder runs in a worker subprocess with path-prefix-scoped
filesystem access (per ADR 0028). You can only write inside the
project's path prefix; cross-project writes are rejected at the
sandbox layer. Stay inside the scope; the planner's
`expectedOutputs.files[]` is the contract.

## Python Projects

```bash
# 1. Directory structure (read CLAUDE.md to know which packages exist)
mkdir -p src/<package> tests

# 2. pyproject.toml — hatchling build backend, Python 3.11+
cat > pyproject.toml << 'EOF'
[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[project]
name = "<project-name>"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = []  # fill from CLAUDE.md tech stack

[project.optional-dependencies]
test = ["pytest", "pytest-cov", "pytest-asyncio"]
dev = ["ruff", "mypy"]
EOF

# 3. Makefile — operator-facing scripts
cat > Makefile << 'EOF'
.PHONY: install dev test lint clean

install:
	pip install -e .

dev:
	pip install -e ".[dev,test]"

test:
	python -m pytest -v --tb=short

lint:
	ruff check .

clean:
	rm -rf __pycache__ .pytest_cache *.egg-info
EOF

# 4. Virtual environment (the builder's preserved discipline relies on it)
python3 -m venv .venv
source .venv/bin/activate

# 5. Install dev/test extras
make dev

# 6. Empty package marker, .gitignore, .env.example (see "Always Include" below)
touch src/<package>/__init__.py

# 7. Initial commit
git add -A
git commit -m "chore: scaffold project"
```

Do **not** use `--break-system-packages`. Factory5's builder
discipline (per `prompts/agents/builder.md`) treats the venv as the
isolation boundary; the override flag papers over that. The
`dependency-install` skill has the full Python install pattern.

## TypeScript / Node Projects

Factory5 itself uses pnpm; new TypeScript projects follow the same
default unless the spec says otherwise.

```bash
# 1. package.json with pnpm + workspace conventions
cat > package.json << 'EOF'
{
  "name": "<project-name>",
  "version": "0.1.0",
  "type": "module",
  "packageManager": "pnpm@9",
  "scripts": {
    "build": "tsup",
    "test": "vitest run",
    "lint": "eslint .",
    "format:check": "prettier --check \"**/*.{ts,tsx,json,md}\""
  }
}
EOF

# 2. tsconfig.json — strict mode, NodeNext module resolution
cat > tsconfig.json << 'EOF'
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist"
  },
  "include": ["src/**/*"]
}
EOF

# 3. tsup.config.ts — bundler (or use plain tsc if the project ships source-only)
cat > tsup.config.ts << 'EOF'
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
});
EOF

# 4. ESLint flat config (eslint.config.js — eslint 9.x convention)
cat > eslint.config.js << 'EOF'
import tseslint from 'typescript-eslint';
import js from '@eslint/js';

export default [
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: { project: './tsconfig.json' },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
];
EOF

# 5. .prettierrc (or use defaults)
echo '{"singleQuote": true, "semi": true}' > .prettierrc

# 6. Directory structure + entry
mkdir -p src
echo "export {};" > src/index.ts

# 7. Install + initial commit
pnpm install
git add -A
git commit -m "chore: scaffold project"
```

For multi-package projects, add a top-level `pnpm-workspace.yaml`
listing `packages/*` (mirroring factory5's own layout) and put each
package under `packages/<name>/` with its own `package.json`,
`tsconfig.json`, and `src/`.

## Always Include

Regardless of runtime:

- **`.gitignore`** covering: `.env`, `__pycache__`, `node_modules`,
  `.venv`, `*.pyc`, `dist/`, `.DS_Store`, OS-specific tempfiles.
- **`.env.example`** listing required environment variables (read
  CLAUDE.md / spec for the list) with placeholder values. Never
  commit a real `.env`.
- **A scripts surface** — `Makefile` (Python) or `package.json`
  scripts (TypeScript) — covering at minimum `install`, `test`,
  `lint`, `clean`.
- **A tests directory** matching the runtime's convention (`tests/`
  for Python; `src/__tests__/` or co-located `*.test.ts` for
  TypeScript) — even if empty at scaffold time.
- **An entry point** — `src/<package>/__init__.py` (Python) or
  `src/index.ts` (TypeScript).

## After Scaffolding

Commit the scaffold. Then the planner's task DAG kicks in: the first
builder task implements the first module per CLAUDE.md / wiki using
the `tdd` skill discipline.

You do not write a `BUILD.md`. The brain manages directive-side state;
the worker appends a per-task line to the project's `BUILD.md`
automatically. Your contract ends when the scaffold is committed and
the project's manifest (`pyproject.toml` / `package.json`) is
populated.

If the spec genuinely needs a runtime not covered above (Rust, Go,
Java, Kotlin, etc.), apply the same shape: detect runtime → write
manifest → set up isolation if applicable (`go.mod` cache,
`Cargo.lock` …) → write minimal entry → run the install → commit.
Per ADR 0026 the supported set grows with the spec; the scaffolder
isn't pinned to two runtimes.
