# @factory5/assessor

Ground-truth project assessment. **No LLM ever runs in this package** — that's the point. Agents can't game an assessor that uses real subprocesses and real file checks.

> This is factory's moat. Inherited from factory2. See `CompleteArchitecture.md` §2.

## What it checks

- **Test runners** — invokes the project's actual runner (pytest today; jest/cargo/go-test in Phase 2) via subprocess; parses exit code + summary line
- **File existence** — `access()`-style checks for every module listed by the planner in `expectedOutputs.files`
- **Imports** — `python -c "import <mod>"` per expected module (Python only in Phase 1)
- **Git status** — `git status --porcelain` empty ⇒ clean. No-git is a pass.
- **Required artifacts** — README ≥30 non-empty lines, LICENSE, .gitignore, architecture doc

## API

```ts
import { assess } from '@factory5/assessor';

const r = await assess({
  projectPath: '/path/to/project',
  expectedModules: ['src/api.py', 'src/cli.py'],
  testFramework: 'auto', // 'auto' | 'pytest' | 'none'
  pythonBin: 'python', // optional
  runnerTimeoutMs: 120_000,
});

// r.modulesExisting, r.modulesMissing
// r.testsPassed, r.testsFailed, r.testsErrors, r.testFramework
// r.importsOk, r.importErrors
// r.hasReadme, r.hasLicense, r.hasGitignore, r.hasArchitecture
// r.gitClean
// r.gateResults: { build, integration, verify }  — the brain consumes these
```

Also exports `runPytest`, `checkPythonImports`, and individual artifact checks for callers that want finer-grained assessments.

## Status

Implemented in Phase 1 (pytest + Python import + artifact + git checks). Phase 5c wired per-project environment provisioning (pickPython + editable install, ADR 0017). Phase 5f closed I006 by routing every install through an isolated venv — precedence is project `.venv/` → factory-managed `.factory/assessor-env/` → base interpreter fallback, surfaced on `AssessResult.provisioning.venvSource`. Other language runners — jest/vitest, cargo, go — land in Phase 2 when we build projects that need them.

42 unit tests cover summary parsing, `pathToModule` conversion, every artifact check, `pickPython` priority order + demotion, `ensureAssessorVenv` across Unix + Windows + cache-reuse + fallback paths, `provisionAssessorEnv` wiring, and gate computation edge cases.
