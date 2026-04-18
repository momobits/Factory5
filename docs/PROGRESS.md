# Progress

Chronological log of work on factory5 itself. Update this at the end of every working session. Lead with date + headline; bullet what was done, what was decided, what's next.

---

## 2026-04-18 — Phase 0 scaffold complete

**Headline:** Workspace skeleton fully laid down. 13 packages + 2 apps + complete docs + ported skills/templates/agent-prompts. 148 files written. Ready for `pnpm install && pnpm build`.

### Done

**Top-level (12 files):**
- `CompleteArchitecture.md` — canonical design doc (snapshot)
- `CLAUDE.md` — working brief for Claude Code sessions on factory5 itself
- `README.md` — top-level intro + dev quickstart
- `package.json` — workspace root with pnpm scripts (build, test, dev, lint, format, factory, factoryd)
- `pnpm-workspace.yaml` — workspace globs (`packages/*`, `apps/*`)
- `tsconfig.base.json` — strict TypeScript ESM (NodeNext) shared config
- `vitest.config.ts` — shared test config
- `.gitignore`, `.editorconfig`, `.prettierrc`, `.eslintrc.cjs`, `.nvmrc`

**Documentation tree (13 files):**
- `docs/ARCHITECTURE.md` — current architecture (mirrors snapshot, evolves)
- `docs/PROGRESS.md` (this file)
- `docs/CONTRACTS.md` — data shapes (Directive, Event, Finding, Plan, Task, etc.)
- `docs/SKILLS.md`, `docs/AGENTS.md` — catalogs
- `docs/decisions/INDEX.md` + ADRs 0001–0005
- `docs/issues/INDEX.md`

**Foundational packages (fully implemented):**
- `@factory5/core` — types + Zod schemas + ULID helpers + tests
- `@factory5/logger` — Pino-based, child loggers, file + console sinks, paths helper, tests
- `@factory5/state` — better-sqlite3 wrapper, WAL pragmas, migrations runner, initial migration covering all 9 tables, typed CRUD for every table, tests
- `@factory5/ipc` — Zod-validated HTTP contracts (`/status`, `/send`, `/directives/notify`, `/reload-config`), typed client (undici), error envelope, tests

**Stub packages (interfaces defined, implementations Phase 1+):**
- `@factory5/channels` — `ChannelPlugin` interface
- `@factory5/events` — `EventSource` interface
- `@factory5/daemon` — `startDaemon`/`stopDaemon` stubs (Phase 3)
- `@factory5/providers` — `ModelProvider` interface + `ProviderRegistry` with 4-step resolution (impls Phase 1)
- `@factory5/wiki` — placeholder (Phase 1)
- `@factory5/assessor` — `AssessResult` shape + stub (Phase 1)
- `@factory5/brain` — agent registry (all 9 roles wired with category, tools, skills, prompt path) + tests; `runBrain` stub (Phase 1)
- `@factory5/worker` — `runWorker` stub (Phase 1)
- `@factory5/cli` — Commander program with subcommand stubs that print "not yet implemented" and the phase

**Apps (binaries):**
- `apps/factory` — entry wires `@factory5/cli` + logger init; `factory --version` and `factory --help` work; subcommand stubs respond
- `apps/factoryd` — entry parses `--version`/`--help`, calls `startDaemon`, handles SIGINT/SIGTERM gracefully

**Ported from factory2:**
- `skills/` — all 11 methodology files copied verbatim
- `templates/` — all 11 project templates copied verbatim
- `prompts/agents/legacy/` — `code-reviewer.md` and `test-runner.md` from factory2 (reference)
- `prompts/agents/<role>.md` — stub prompts for all 9 roles, each pointing at its lineage in skills/ and the legacy file

### Decided

- Language: TypeScript on Node 20+ (ADR 0001)
- Process model: two binaries `factory` + `factoryd` (ADR 0002)
- Storage: files for project state, SQLite for factory runtime (ADR 0003)
- Model routing: category-based with 4-step resolution (ADR 0004)
- Autonomy: three modes — `chat` / `assisted` / `autonomous` — with `ask_user` and `escalate_blocked` mid-flight tools (ADR 0005)

### Verification — PASSED 2026-04-18

All gates green on Windows / Node 22 LTS / pnpm 9.12.0 / better-sqlite3 11.10 (prebuilt binary).

- ✅ `pnpm install` — 295 packages, ~1m, zero errors
- ✅ `pnpm build` — all 15 buildable packages compile (ESM + DTS) via tsup
- ✅ `pnpm test` — `@factory5/core`, `@factory5/logger`, `@factory5/state`, `@factory5/ipc`, `@factory5/brain/agents/registry` all pass; stub packages skip cleanly via `passWithNoTests`
- ✅ `pnpm lint` — clean (ESLint 9 flat config)
- ✅ `pnpm factory --version` → `0.0.1`
- ✅ `pnpm factoryd --version` → `0.0.1`
- ✅ `pnpm factoryd --help` → usage text

### Fixes applied during verification (six)

Genuine scaffold defects discovered by running the toolchain. Each is a one-line lesson worth recording so future scaffolds avoid them.

1. **`packages/logger/src/logger.ts`** — `SonicBoom` (returned by `pino.destination`) does not satisfy `NodeJS.WritableStream` (lacks `.writable`). Fix: type the streams array as Pino's own `DestinationStream` (`{ write(msg: string): void }`).
2. **`packages/ipc/src/client.ts`** — `undici.request`'s `body` field doesn't accept `undefined` (only `string | Buffer | Readable | FormData | null`). Fix: build the options object conditionally with a spread instead of passing `body: undefined`.
3. **`packages/cli/src/index.ts`** — Commander's `.action()` expects `() => void | Promise<void>`. Single-expression arrows `() => process.stdout.write(...)` return `boolean`. Fix: wrap five subcommand handlers in `{ ... }` so they return void.
4. **`vitest.config.ts`** — Root config's `include: packages/**/*.test.ts` is workspace-relative and finds nothing when vitest runs from inside a package. Fix: drop the explicit `include` (vitest's default `**/*.{test,spec}.ts` works from both root and per-package). Also added `passWithNoTests: true` so stub packages don't fail the workspace test run.
5. **`.eslintrc.cjs` → `eslint.config.js`** — ESLint 9 dropped the `.eslintrc.*` legacy format. Fix: migrate to flat config; update root `lint` script to drop `--ext .ts,.tsx` (flat config uses `files` patterns).
6. **`apps/factoryd/src/main.ts`** — `node:process` doesn't export `on` as a named import (it's a method on the `process` object). Fix: add `process` as default import alongside the named ones; call `process.on('SIGINT', ...)`.

### Environment note

Node 24 is the current LTS line as of Oct 2025 but `better-sqlite3 11.10` does not yet ship Node 24 prebuilt binaries (would fall back to compiling from source via node-gyp + MSBuild, which fails on stock Windows VS2022 without the C++ workload installed). **Use Node 22 LTS** until `better-sqlite3` ships Node 24 binaries — or upgrade `better-sqlite3` to a version that does. Documented in `.nvmrc` (currently set to `20`; both 20 and 22 work).

### Open issues

None. All six fixes landed in the same session as the scaffold; tracked here rather than under `docs/issues/` since they were resolved before verification was reported as passing.

### Next session

Phase 1 — wire `factory build <project>` end-to-end inline:

1. **`@factory5/providers/claude-cli`** — first provider impl: spawn `claude -p`, capture stdout, parse JSON (--output-format json), record usage
2. **`@factory5/wiki`** — file ops: read/write wiki pages, BUILD.md, findings.json; readiness gate
3. **`@factory5/assessor`** — minimum viable: `pytest` + Python file/import checks (other languages later)
4. **`@factory5/brain/triage`** — actual triage call against `quick`-tier provider
5. **`@factory5/brain/architect`** — call `reasoning`-tier provider with `architect` skill, write wiki, run readiness gate
6. **`@factory5/brain/planner`** — call `planning`-tier provider, produce `plan.json` + `plan.md`
7. **`@factory5/worker`** — single-task path: spawn provider, stream output, parse findings, persist
8. **`@factory5/brain/loop` `mode: 'inline'`** — wire steps 4–7 + assessor verification
9. **`@factory5/cli/build` command** — actually call `runBrain({ mode: 'inline', directiveId })`
10. **End-to-end test:** `factory build example` (using the ported `templates/example`) produces a working Python CLI

After Phase 1: parallel workers + worktree isolation (Phase 2), then daemon (Phase 3), then Discord (Phase 4), then GitHub events (Phase 5).
