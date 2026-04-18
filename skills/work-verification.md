---
name: work-verification
description: |
  Final verification before declaring a project complete. Run ALL checks
  and confirm with actual command output. Evidence before assertions.
---

# Work Verification

Before outputting FACTORY_COMPLETE, you MUST run every check below
and confirm with ACTUAL terminal output. Do not assume — verify.

## Verification Steps

### 1. All Modules Implemented

```bash
# Read CLAUDE.md module list
# For each module: confirm the file exists and is not empty
# If ANY module is missing → DO NOT complete, implement it
```

### 2. All Tests Pass

```bash
# Python:
python -m pytest -v --tb=short 2>&1
# Confirm: 0 failed, 0 errors

# TypeScript:
npx vitest run 2>&1
# Confirm: 0 failed
```

If ANY test fails → fix the code and re-run. Do NOT delete the test.

### 3. No Import Errors

```bash
# Python: try importing the main package
python -c "import <package_name>" 2>&1
# Should produce no output (no errors)

# TypeScript:
npx tsc --noEmit 2>&1
# Should produce no errors
```

### 4. Detailed README.md (30+ lines)

README must include ALL of these sections:

- Project title and overview (2-3 paragraphs)
- Features list
- Architecture overview (with link to docs/architecture.md)
- Quick Start (copy-paste commands)
- Installation (detailed)
- Usage with code examples
- API Reference (if applicable)
- Testing instructions
- Project structure tree
- Contributing guide
- License

### 5. LICENSE Exists

```bash
cat LICENSE | head -3
# Must be MIT with copyright line
```

### 6. No Secrets in Code

```bash
grep -rn "sk-ant\|api_key\s*=\s*['\"]" --include="*.py" --include="*.ts" . | grep -v test | grep -v .env
# Should return nothing
```

### 7. .gitignore Is Complete

```bash
cat .gitignore
# Must include: .env, __pycache__, node_modules, .venv, *.pyc, .DS_Store
```

### 8. Documentation Folder

```bash
# ALL of these must exist:
ls docs/architecture.md    # Architecture with mermaid diagrams
ls docs/setup.md           # Setup guide
ls docs/notebooks/         # At least 1 notebook
```

**docs/architecture.md** must contain:

- System overview
- At least 2 mermaid diagrams (component diagram + data flow)
- Module details with signatures
- Valid mermaid syntax (test by reviewing)

**docs/setup.md** must contain:

- Prerequisites
- Installation steps (copy-paste-able)
- Environment variables
- Configuration
- Verification command
- Troubleshooting

**docs/notebooks/** must contain at least:

- `01_getting_started.ipynb` — imports, basic usage, working code cells with output
- Additional notebooks for complex features
- Every code cell must be tested and produce output

### 9. Clean Git State

```bash
git status
# Working tree should be clean (everything committed)
git log --oneline | head -10
# Should show meaningful conventional commits
```

## Decision

If ALL checks above pass → output FACTORY_COMPLETE
If ANY check fails → fix it, re-verify, do NOT output FACTORY_COMPLETE
