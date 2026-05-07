---
name: work-verification
description: |
  Final verification before declaring a project complete. Run ALL checks
  and confirm with actual command output. Evidence before assertions.
---

# Work Verification

Before signalling that the shipped project is complete, run every
check below and confirm with **actual** command output. Do not assume
— verify. Each failing check raises a `FINDING` (advisory by default
per ADR 0018; the brain decides completion based on the assessor's
gates plus the severity of any blocking findings, not on a magic
token from this skill).

The verifier prompt body (`prompts/agents/verifier.md`) frames the
overall verifier role as advisory; this skill provides the per-check
granularity that turns into individual `FINDING` lines.

## Verification Checks

### 1. All Modules Implemented

Read the project's spec / `CLAUDE.md` module list. For each module,
confirm the file exists and is non-empty. Missing modules raise:

```
FINDING [HIGH] src/<missing-module>: declared in CLAUDE.md but file
absent or empty
```

### 2. All Tests Pass

```bash
# Python:
python -m pytest -v --tb=short 2>&1

# TypeScript / JavaScript (vitest, the factory5 default):
pnpm test 2>&1
# or
npx vitest run 2>&1
```

A failed test raises:

```
FINDING [HIGH] tests/<file>: <test name> failed — <one-line summary>
```

Don't delete or skip a failing test to make the suite green; that
masks the underlying gap and the operator's next pass will re-discover
it.

### 3. No Import Errors

```bash
# Python: try importing the main package
python -c "import <package_name>" 2>&1

# TypeScript: full type-check
pnpm exec tsc --noEmit 2>&1
```

Either should produce zero output. Errors raise a `FINDING [HIGH]`
against the offending module.

### 4. README.md Is Substantive

The shipped project's `README.md` should make sense to a new reader.
At minimum it includes:

- Title + 2-3 paragraph overview
- Features list
- Architecture overview (link to `docs/architecture.md` if separate)
- Quick Start (copy-paste-runnable commands)
- Installation (detailed)
- Usage with code examples
- Testing instructions
- Project structure tree

Missing sections raise `FINDING [MEDIUM] README.md: <missing section>:
<what's expected>`.

### 5. LICENSE File Exists

```bash
test -f LICENSE && head -3 LICENSE
```

Missing or empty LICENSE → `FINDING [MEDIUM] LICENSE: missing or
empty`. The factory5 default for shipped projects is MIT unless the
spec says otherwise; a license isn't optional.

### 6. No Secrets in Source

```bash
# Adjust patterns + extensions to the project's stack
grep -rn "sk-ant\|api_key\s*=\s*['\"]\|ghp_\|AKIA[0-9A-Z]{16}" \
  --include="*.py" --include="*.ts" --include="*.js" \
  . 2>&1 | grep -v node_modules | grep -v .venv | grep -v test
```

Any hit raises `FINDING [CRITICAL] <path>:<line>: hardcoded secret`.
Critical because a leaked secret on commit is hard to undo.

### 7. .gitignore Coverage

```bash
cat .gitignore
```

Must include at minimum: `.env`, language-specific build outputs
(`__pycache__`, `node_modules`, `.venv`, `dist`, `build`), OS temp
files (`.DS_Store`, `Thumbs.db`). Missing entries → `FINDING [LOW]
.gitignore: <missing pattern>: <reason it should be ignored>`.

### 8. Documentation

If the spec scope includes shipped docs:

```bash
ls docs/architecture.md       # high-level architecture
ls docs/setup.md              # setup walkthrough
ls docs/notebooks/ 2>/dev/null  # for Python projects, demonstration notebooks
```

Each missing artifact raises a `FINDING [MEDIUM]` against `docs/`
naming what's missing. Mermaid diagrams in `architecture.md` should
render — invalid mermaid syntax is a `FINDING [LOW]`.

### 9. Clean Git State

```bash
git status
# Working tree should be clean (everything committed).

git log --oneline | head -10
# Recent commits should follow the project's convention (e.g.
# Conventional Commits) and be meaningful.
```

Uncommitted changes at verification time raise `FINDING [HIGH]
working-tree: <list of dirty paths>: <one-line reason if known>`.
The verifier should not commit or stage on the project's behalf —
raise the finding and let the operator decide.

## Output

Prose summary plus `FINDING` lines for any failing check. The worker
parses these via `packages/worker/src/parse-findings.ts` and persists
each via `addFinding` with `source: 'verifier'` and
`advisory: true` stamped automatically (per ADR 0018 + the
`resolveAdvisory` helper at `packages/wiki/src/findings.ts:130`).

End your output with a one-line summary stating either "no further
findings — project ready for ship" or counting the findings raised.
**Do not emit any "complete" token.** The brain decides completion
from the assessor's gates plus the registry's blocking-vs-advisory
tally; the verifier's role per ADR 0018 is to surface signal that
the operator can act on, not to gate the build itself.

## Anti-noise rule

Each `FINDING` consumes operator attention. Don't raise:

- A check the assessor already failed (e.g. `gate.verify === false`).
  Restating that as a finding is noise.
- A "this could conceivably go wrong" hunch without an observed
  failure. Raise at LOW with the explicit "unverified" caveat per
  the verifier prompt's anti-hallucination rule, or don't raise it
  at all.
- A stylistic preference (cross-module style drift, naming taste).
  That isn't on the 9-check list above for a reason.

If every check passes, emit a brief confirmation prose ("project
verifies clean — all 9 checks pass") and zero findings.
