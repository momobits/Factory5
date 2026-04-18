# @factory5/assessor

Ground-truth project assessment. **No LLM ever runs in this package** — that's the point. Agents can't game an assessor that uses real subprocesses and real file checks.

> This is factory's moat. Inherited from factory2. See `CompleteArchitecture.md` §2.

## What it checks

- **Test runners** — invokes the project's actual runner (pytest, jest, vitest, cargo test, go test, npm test) via subprocess; parses exit code + structured output
- **File existence** — `pathlib.exists()`-style checks for every module listed in `CLAUDE.md`
- **Imports** — for languages with a clean import-check (Python `python -c "import ..."`, Node `node --check`)
- **Git status** — clean working tree before completion
- **Required artifacts** — README ≥30 lines, LICENSE, .gitignore, docs with mermaid diagrams
- **No-secrets scan** — flags hardcoded credentials in source

## Output

```ts
type AssessResult = {
  modulesExisting: number;
  modulesMissing: string[];
  testsPassed: number;
  testsFailed: number;
  testsErrors: number;
  testFramework: string;
  importsOk: boolean;
  importErrors: string[];
  hasReadme: boolean;
  hasLicense: boolean;
  hasGitignore: boolean;
  hasArchitecture: boolean;
  gitClean: boolean;
  gateResults: { build: boolean; integration: boolean; verify: boolean };
};
```

## Status

Stub. Implementation lands in Phase 1.
