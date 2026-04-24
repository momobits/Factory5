# @factory5/assessor

Ground-truth project assessment. **No LLM ever runs in this package** — that's the point. Agents can't game an assessor that uses real subprocesses and real file checks.

> This is factory's moat. Inherited from factory2. See `CompleteArchitecture.md` §2.

## What it checks

- **Per-runtime gate** — dispatches on `AssessOptions.runtime` (ADR 0026). Python runs `pytest` + import probing; Node runs `pnpm typecheck || tsc --noEmit` + `pnpm test`; Go (10.4) and Rust (10.6) land next.
- **File existence** — `access()`-style checks for every module listed by the planner in `expectedOutputs.files`
- **Imports** — `python -c "import <mod>"` per expected module (Python only)
- **Git status** — `git status --porcelain` empty ⇒ clean. No-git is a pass.
- **Required artifacts** — README ≥30 non-empty lines, LICENSE, .gitignore, architecture doc
- **Host-tool pre-flight** (ADR 0026 §4) — short-circuits with `failureMode: 'ENV_HOST_MISSING_TOOL'` when a runtime's declared binary (`pnpm`, `go`, `cargo`) is not on PATH

## API

```ts
import { assess } from '@factory5/assessor';

const r = await assess({
  projectPath: '/path/to/project',
  runtime: 'node', // 'python' (default) | 'node' | 'go' (10.4) | 'rust' (10.6)
  expectedModules: ['src/api.ts', 'src/cli.ts'],
  testFramework: 'auto', // 'auto' | 'none' — 'none' skips the runtime entirely
  pythonBin: 'python', // optional; ignored when runtime !== 'python'
  runnerTimeoutMs: 120_000,
});

// r.runtime                                        — which dispatch path ran
// r.failureMode                                    — 'BUILD_FAILURE' | 'TEST_FAILURE' | 'ENV_SETUP_FAILURE' | 'ENV_HOST_MISSING_TOOL' | undefined
// r.modulesExisting, r.modulesMissing
// r.testsPassed, r.testsFailed, r.testsErrors, r.testFramework
// r.importsOk, r.importErrors                      — Python-only; Node/Go/Rust use `gate.build`
// r.hasReadme, r.hasLicense, r.hasGitignore, r.hasArchitecture
// r.gitClean
// r.gateResults: { build, integration, verify }    — the brain consumes these
// r.provisioning.{ runtime, toolPath, toolVersion, installOk?, envSource?, preflight? }
```

Also exports `runPytest`, `checkPythonImports`, `pythonRuntime`, `nodeRuntime`, `buildNodeRuntime`, `parseNodeTestSummary`, and individual artifact checks for callers that want finer-grained assessments.

## Status

Phase 1 introduced pytest + Python import + artifact + git checks. Phase 5c wired per-project environment provisioning (`pickPython` + editable install, ADR 0017). Phase 5f closed I006 by routing every Python install through an isolated venv — precedence is project `.venv/` → factory-managed `.factory/assessor-env/` → base interpreter fallback, surfaced on `AssessResult.provisioning.envSource`. **Phase 10.2 shipped tier-3 pluggable runtimes (ADR 0026):** the Node/TypeScript runtime runs end-to-end against a seeded fixture (`test/node-e2e.test.ts`, ~15 s warm). Go (10.4) and Rust (10.6) follow the same shape.

58 tests cover summary parsing for pytest/vitest/jest/node:test, every artifact check, `pickPython` priority order + demotion, `ensureAssessorVenv` across Unix + Windows + cache-reuse + fallback paths, Node runtime's every failure mode (seam-injected), one real end-to-end Node run, and gate computation edge cases.
