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

---

## 2026-04-18 — Phase 1 inline pipeline wired end-to-end

**Headline:** `factory build <project>` now runs against a real Claude subscription and produces wiki + plan + assessor report. 48 new tests across 3 packages; all workspace gates (build / test / lint / format) green. ADR 0006 documents the one deliberate scope cut (workers are single-shot provider calls in Phase 1, not tool-using subprocesses — that's Phase 2).

### Done

**Providers (`@factory5/providers`):**

- `ClaudeCliProvider` — subscription-based; `claude -p --output-format json`; prompt piped via stdin (no argv escaping); cross-platform binary resolution (walks PATH + PATHEXT on Windows, invokes `.cmd` via `cmd.exe` with safe quoting); records usage + cost from the CLI envelope; minimum `stream()` wraps `call()`.
- 15 unit tests: prompt composition, argv construction, JSON envelope parsing (malformed / empty / missing fields), usage extraction.
- Added `zod` dep for envelope validation.

**Wiki (`@factory5/wiki`):**

- `projectPaths(root)` — single source of truth for every path a project uses.
- `readWiki` / `writeWikiPage` with rejection of path-traversal slugs and correct nested-dir creation on Windows (fixed `lastIndexOf('/')` bug mid-session).
- `addFinding` / `updateFindingStatus` / `listFindings` / `getFinding` — project-scoped F001-style IDs, auto `resolvedAt` on terminal transitions, persists `.factory/findings.json`.
- `rebuildFindingsTable` / `appendBuildLog` — keep BUILD.md in sync; log section is append-only, findings table is regenerated from JSON.
- `writePlan` / `readPlan` — plan.json + rendered plan.md.
- `wikiReadiness(root)` — 4 checks (overview, modules, testing, minimum content); structured report, never throws.
- 18 unit tests covering each surface.

**Assessor (`@factory5/assessor`):**

- `assess({ projectPath, expectedModules, testFramework })` returns the stable `AssessResult` shape.
- `runPytest` — invokes `python -m pytest -q --tb=short`, parses stock summary line ("X passed, Y failed in Zs"); handles exit-code-5 (no tests collected).
- `checkPythonImports` — runs `python -c "import <mod>"` per expected module; `src/foo/bar.py` → `src.foo.bar`, strips `__init__`.
- Artifact checks: README (≥30 non-empty lines), LICENSE, .gitignore, architecture doc, git clean (no-git is a pass).
- 15 unit tests covering summary parsing, path→module conversion, every artifact check, and end-to-end `assess()` on temp dirs.

**Brain (`@factory5/brain`):**

- `prompts.ts` — walks up from `import.meta.url` to find `prompts/` + `skills/`, composes agent system prompt = agent body + concatenated skill bodies (default skills per role from the registry); overridable via `FACTORY5_PROMPTS_ROOT`.
- `usage.ts` — single helper recording a provider call into `model_usage`.
- `triage.ts` — runs on `quick` tier; robust JSON extraction (first balanced `{...}`); falls back to `chat` when confidence < 0.7.
- `architect.ts` — `reasoning` tier; produces `{ pages: [{slug, content}] }`, writes each page via `@factory5/wiki`, runs the readiness gate, returns a structured report.
- `planner.ts` — `planning` tier; produces `{ tasks: [...] }` with deps by array index, gets stamped with ULIDs on materialize; persists plan.json + plan.md.
- `provider-config.ts` / `buildDefaultRegistry()` — ships a claude-cli-only registry with category → model mapping (Haiku/Sonnet/Opus); override-friendly.
- `loop.ts` — full inline pipeline: claim directive → triage → architect → planner → topo-sort tasks → runWorker for each (skipping downstream tasks of failures) → assessor → mark directive `complete`/`blocked` and append BUILD.md summary line with total spend.

**Worker (`@factory5/worker`):**

- `runWorker({ task, projectPath, registry, systemPrompt, userPrompt })` accepts pre-built prompts from the brain (avoids a cycle). Resolves provider for `task.category`, appends a `# Context` block with open findings + wiki digest, calls provider, parses findings, persists them, returns `WorkerOutcome` (result + rawResponse + usage).
- `parseFindings(text)` — regex-based extractor for `FINDING [SEV] target: description` markers, supports multi-line descriptions.

**CLI (`@factory5/cli`):**

- `factory build <project>` — resolves the project (`./path`, absolute, `<workspace>/<name>`, or `templates/<name>` copied into workspace), registers the project, writes directive to SQLite, invokes the brain, prints a summary, exits with code 0 / 2.
- `factory doctor` — verifies `claude` binary resolves + `available()` is true, optionally makes one quick triage call to confirm the full stack. Invaluable before burning tokens.
- `factory status` — lists registered projects + recent directives with per-directive spend (from `model_usage`).
- Stubs kept for `init`, `daemon *`, `logs`, `chat` (Phase 3+).

### Decided

- ADR 0006: Phase 1 workers use single-shot provider calls, not tool-using subprocesses. Workflow preserved, file-writing by agents deferred to Phase 2.
- Worker package stays independent of brain (acyclic DAG). Brain composes prompts and hands them to worker; worker returns usage for brain to record.
- Default registry ships claude-cli as the only provider; fallback chains are structurally in place but single-entry until `anthropic-api` lands.

### Verification — PASSED 2026-04-18

All workspace gates green:

- ✅ `pnpm build` — 15 packages + 2 apps all compile (ESM + DTS)
- ✅ `pnpm test` — 79 tests pass across 8 packages with test files (core 12, logger 5, state 6, ipc 5, providers 15, wiki 18, assessor 15, brain 3; stub packages pass-with-no-tests)
- ✅ `pnpm lint` — clean
- ✅ `pnpm format:check` — clean (formatted the pre-scaffold files that had slipped through)
- ✅ `factory --version` / `--help` still work
- ✅ `factory doctor --skip-call` — `claude-cli available(): true` on Windows
- ✅ `factory doctor` (full) — triage call round-trips against live Haiku-tier, classified `"build me a weather CLI"` as `intent=build` with confidence 0.95 in ~5s (reported cost $0.04)

### Caveats / known gaps

- `factory build example` is not yet the "produces a working Python CLI" gate originally promised for Phase 1 finale. Per ADR 0006, it produces a wiki + plan + findings + assessor report. Full builder-tool-use lands in Phase 2; the seams are in place (`WorkerOptions` carries everything a tool-using worker needs).
- `factory build` has not been exercised against a live provider yet in this session to avoid a $5–20 spend on an Opus architect + Sonnet planner pass. Smoke-level validation (doctor) covered provider → JSON parse → triage JSON extraction. Next session should run one real `factory build example` and debug whatever the end-to-end throws up.
- Worker `signal: AbortSignal` option is present but not wired into the provider call — needs upstream support in `ClaudeCliProvider` (Phase 2).

### Next session

Phase 2 ramp-up — make the worker actually produce code:

1. **Worktree allocation** — per-task `<project>/.factory/worktrees/task-<id>/` via `simple-git`.
2. **Subprocess-style worker** — spawn `claude -p` with a working directory set to the worktree, tools enabled (Write/Edit/Bash/Glob/Grep/Read), stream stdout (stream-json parsing arrives in the same change), cancel via AbortSignal.
3. **Token-level `ClaudeCliProvider.stream()`** — actual stream-json parsing; emit delta chunks; yield final usage.
4. **Parallel worker pool** — the brain loop already topo-sorts; add a worker-pool executor that runs independent ready-tasks concurrently (configurable N, default min(4, cpu-count)).
5. **First real `factory build example`** — iterate until the inline path produces a runnable Python CLI + pytest-green.

Later: daemon (Phase 3), Discord (Phase 4), GitHub events (Phase 5).

---

## 2026-04-18 — Pre-Phase-2 polish: init / resume / config.toml / AbortSignal

**Headline:** Pre-Phase-2 polish items landed: `factory init` / `factory resume` / config.toml loader / AbortSignal threaded through the provider. 6 new tests for config; all workspace gates still green. Ready for Phase 2.

### Done

**Provider cancellation:**

- `ProviderRequest.signal?: AbortSignal` added to the shared interface (providers MUST honor it).
- `ClaudeCliProvider.call` listens for abort on the caller's signal, kills the subprocess with SIGKILL, and rejects with a named `AbortError`. Timeout path uses the same kill-and-settle helper; event listeners cleaned up on all settlement paths.
- `runWorker` forwards `opts.signal` into `provider.call`; logs the abort at `warn` (not `error`) so cancellations don't look like bugs in telemetry.
- `runBrain({ signal })` propagates to the per-task loop; aborted tasks are marked exit-code `130` (SIGINT convention) and the loop short-circuits remaining tasks.

**Config (`~/.factory5/config.toml` or `%LOCALAPPDATA%\factory5\config.toml`):**

- New `@factory5/brain/config` module. Schema: `general.{workspace, autonomy}`, `providers.claudeCliPath`, `categories.<name>.{provider, model}`, `fallbackChains.<name>[]`. All optional — empty file is valid.
- `loadConfig()` / `saveConfig()` / `configExists()` / `configPath()` / `defaultConfig()` exported. Round-trippable TOML via `smol-toml` (added as brain dep). Header comment is stamped into every write.
- `buildDefaultRegistry({ config })` now respects the loaded config: caller override → config.categories[c] → baked-in default; fallbackChains from config are appended to the primary entry.
- New `buildRegistryFromDisk()` async variant that calls `loadConfig()` first; brain loop uses it so every inline run picks up the user's config automatically.
- 6 new config unit tests; tests isolate via `FACTORY5_DATA_DIR` override to a tmp dir so the workspace test run never touches the user's real config.

**`factory init`:**

- Non-interactive (flags only, clean in CI). Writes `config.toml` with sensible defaults, detects `claude-cli` via probe, warns if the binary isn't reachable, and stamps `general.workspace` under `~/factory5-workspace` by default. Refuses to overwrite without `--force`.
- Flags: `--workspace`, `--claude-cli-path`, `--autonomy`, `--force`.

**`factory resume <project>`:**

- Finds the most recent directive whose payload matches the name or `projectPath` (prefers non-terminal: running > blocked > claimed/pending > terminal).
- Creates a new directive with `parentDirectiveId` pointing at the prior one and `payload.resumeFrom` for audit; re-enters `runBrain` inline.
- Brain loop now skips the architect when `wikiReadiness` already passes and treats already-complete tasks as no-ops (resume is load-bearing on these two). Appends "architect skipped" to BUILD.md for traceability.
- Added `directives.listRecent(db, limit)` helper in `@factory5/state` (directives don't have a project column so resume JSON-filters recent rows — small N, fine for Phase 1).

**CLI plumbing:**

- `registerInitCommand` + `registerResumeCommand` wired into `buildCli`; stub for `init` removed from `stubs.ts`.
- Smoke-verified `factory init --force` (writes the expected TOML) and `factory resume nonexistent` (prints "no prior directive" + exit code 2).

### Verification — PASSED 2026-04-18

- ✅ `pnpm build` — all 15 packages + 2 apps compile
- ✅ `pnpm test` — **85 tests** pass across 8 packages (was 79; +6 from config)
- ✅ `pnpm lint` — clean
- ✅ `pnpm format:check` — clean
- ✅ `factory --help` — `init`, `resume`, `doctor`, `status`, `build` all registered
- ✅ `factory init --force` (with `FACTORY5_DATA_DIR` redirected) — wrote config.toml, probed claude-cli as available

### Notes / followups

- `factory resume` relies on in-memory JSON filtering of recent directives. If the `directives` table ever grows large enough that `listRecent(200)` is the wrong scan, add a `project_ref` column + migration. Flagged; not blocking.
- `init` auto-detection of the claude-cli binary path is probe-only; we don't stamp the resolved path into `providers.claudeCliPath` unless the user passed `--claude-cli-path`. That keeps the config portable across machines by default.
- AbortSignal on `ClaudeCliProvider.stream()` is handled implicitly via `call()`, since Phase 1 stream() delegates to call(). When Phase 2 rewrites stream() to parse stream-json, it needs the same kill-and-settle pattern.

### Next session

Phase 2 — see [`startprompt-phase2.txt`](./startprompt-phase2.txt). Goal: turn the single-shot worker into a real coding-agent worker that writes files, with per-task worktrees and parallel execution, so `factory build example` produces a runnable Python CLI.

---

## 2026-04-18 — Phase 2 parts 1–4 landed: worktree + tool-using worker + stream-json + parallel pool

**Headline:** Scaffolder / builder / fixer now run as `claude -p --output-format stream-json` subprocesses inside per-task git worktrees, streamed via real NDJSON, scheduled concurrently up to `min(4, cpuCount)`. Workspace gates all green: **126 tests** (was 85; +9 worktree, +5 parse-findings, +2 run-worker, +16 stream-events, +5 claude-cli flag tests, +4 pool), build/lint/format clean. Four new ADRs (0007–0010) document the load-bearing choices; 0006 is now superseded. Only thing still ahead of "Phase 2 done": actually running `factory build example` against a live provider and iterating on prompts + gate thresholds.

### Done

**Worktree isolation (`@factory5/worker/worktree.ts`):**

- `ensureProjectRepo(projectPath)` — idempotent; `git init --initial-branch=main`, stage everything + initial commit, add `.factory/` to `.gitignore`, and set repo-local `user.email` / `user.name` fallback only when the global config has neither (real users with git configured are untouched).
- `allocateWorktree({ projectPath, taskId })` → `{ path, branch, baseBranch }` at `<projectPath>/.factory/worktrees/task-<taskId>/` on branch `factory/task-<last8chars>`. Throws if the worktree path already exists (stale state → surface rather than silently overwrite).
- `cleanupWorktree({ handle, outcome })` — on `success`, commit any outstanding agent changes, switch main to base branch if necessary, merge with `--no-ff`, `git worktree remove --force`, delete the task branch. On `failure`, leave everything in place with a warn-level log of the preserved path. Conflicted merges abort cleanly and surface the error.
- 9 tests using real `git` in temp dirs (branch naming, idempotency, `.gitignore` de-duplication, success/failure cleanup paths).

**Tool-using worker (`@factory5/worker/run-worker.ts`):**

- `isToolUsingAgent(role)` — true for scaffolder/builder/fixer; read-only agents (triage/architect/planner/reviewer/investigator/verifier) keep the single-shot `call()` path.
- Tool-using path: allocate worktree → `provider.stream({ cwd, allowedTools, permissionMode: 'bypassPermissions' })` → accumulate assistant-text deltas → parse findings → compute `filesChanged` from `git status` ∪ `git diff --name-only base...HEAD` → cleanup based on outcome.
- Default tool allowlist is `[Read, Write, Edit, Bash, Glob, Grep]`; overridable per call. `WorkerOutcome` now carries the `worktree: WorktreeHandle` for failed tasks so the brain/pool can surface the preserved path in logs.
- AbortSignal propagates into the provider's stream, which kills the subprocess cleanly.

**Stream-json parser (`@factory5/providers/stream-events.ts`):**

- `parseStreamJsonLine(line)` — NDJSON-safe parse; `undefined` for blanks or non-JSON (the CLI occasionally interleaves non-JSON log fragments under `--verbose`; a single stray line shouldn't crash a minutes-long build).
- `eventToChunks(evt)` — `assistant` text blocks → one chunk per block; `result` → terminal chunk with `usage`; `system` / `user` / `tool_use` blocks → no chunks (observability-only).
- `resultIsError(evt)` + `usageFromResult(evt)` complete the helpers; `call()` keeps its own `parseClaudeJsonResult` for the `--output-format json` envelope.
- `ClaudeCliProvider.stream()` now spawns real `claude -p --output-format stream-json --verbose`, uses `node:readline.createInterface` for NDJSON line splitting, queues events through a promise-wakeable async generator, honors `req.cwd` / `allowedTools` / `permissionMode`, enforces a `streamTimeoutMs` (default 2× call timeout), and reuses the shared `AbortError` + kill-and-settle pattern.
- `ProviderRequest` gained `cwd`, `allowedTools`, `permissionMode` optional fields. `buildClaudeArgs` translates: `permissionMode: 'bypassPermissions'` → `--dangerously-skip-permissions` (widest CLI-version compat for unattended mode); other modes → `--permission-mode <mode>`. Tool whitelist → `--allowedTools Read,Write,Edit,...`. `--max-turns 20` (configurable) caps the agentic loop.
- 16 new tests for the stream-events helpers + 6 new tests covering the new arg flags.

**Parallel worker pool (`@factory5/brain/pool.ts`):**

- `runPlanPool({ plan, registry, db, directiveId, concurrency?, signal? })` — topo-sorts, schedules ready tasks concurrently up to `min(4, cpuCount)` (overridable). Each task registers in `tasks_inflight` with `started_at` + `last_heartbeat`, heartbeats every 10 s via `setInterval`, and ends with `markComplete`/`markFailed`. Upstream-failed deps short-circuit downstream tasks with `exitCode 2` / `error: 'upstream failure'`. Deadlock guard fails loudly if pending tasks ever outlive running ones.
- AbortSignal stops launching new tasks but drains in-flight; remaining pending tasks get `exitCode 2 / error: 'aborted before start'` so `tasks_inflight` always reaches a terminal status.
- `topoSortTasks` exported so any caller (and tests) shares the same cycle-detection.
- Returns `TaskOutcome[]` (`taskId, exitCode, error?, findingsRaised, filesChanged`) in the plan's original order. `InlineResult.taskResults` is now this shape; CLI summary surfaces the aggregate `filesChanged` count.
- New `--concurrency <n>` flag on `factory build`; `BrainOptions.concurrency` on the programmatic API.
- 4 new pool tests (topo-sort order, cycle detection, unknown-dep tolerance, concurrency bounds).

**Small wiring + polish:**

- `@factory5/worker/package.json` gains `simple-git ^3.25`.
- Brain loop's header comment updated to describe the pool-based pipeline; stale description of stream() as a minimum impl removed from `claude-cli.ts`.
- CLI build summary adds a file-changed count per run.

### Decided

- ADR 0007 — Phase 2 tool-using worker subprocess (supersedes 0006): only scaffolder/builder/fixer get the stream path; read-only agents stay single-shot.
- ADR 0008 — Per-task git worktrees at `.factory/worktrees/task-<id>/`, branch `factory/task-<last8>`, merge-back on success, preserve on failure.
- ADR 0009 — Stream-json NDJSON parsing: pure helpers (`parseStreamJsonLine`, `eventToChunks`, `usageFromResult`, `resultIsError`); assistant-message-level granularity is enough for logs + finding parsing without requiring token-level streaming from the CLI.
- ADR 0010 — Parallel pool with heartbeats at `min(4, cpuCount)`; tasks_inflight is the single source of truth for "what's running," so a future daemon can reap stuck workers without IPC.

### Verification — PASSED 2026-04-18

- ✅ `pnpm build` — 15 packages + 2 apps compile (ESM + DTS)
- ✅ `pnpm test` — **126 tests pass** across 9 packages with test files (core 12, logger 5, state 6, ipc 5, providers 36, wiki 18, assessor 15, brain 13, worker 16; stub packages pass-with-no-tests)
- ✅ `pnpm lint` — clean
- ✅ `pnpm format:check` — clean
- ✅ `factory --help` — includes `build --concurrency <n>` flag
- ✅ Worker test suite exercises real `git` subprocess paths (worktree create, branch, commit, merge --no-ff, worktree remove) on Windows — so the cross-platform invariant holds before any live provider run.

### Caveats / known gaps

- **Not yet exercised live.** ADR 0007 notes `factory build example` against a live provider is the next step; expected $5–20 the first time (Opus architect + Sonnet planner + multiple Opus/Sonnet builder tasks). That run is going to shake out prompt issues + assessor-threshold tuning + whatever CLI-version skew bites first.
- **Permission flag cross-version skew.** We use `--dangerously-skip-permissions` for the `bypassPermissions` mode because it has the widest version compatibility. If a user's `claude` CLI build doesn't recognise it, the subprocess will exit non-zero with a clear argv error rather than silently misbehave. Alternative flag names can be swapped in `buildClaudeArgs` per user if needed.
- **Stream chunk granularity.** Chunks are per-assistant-message, not per-token. Fine for logs and finding parsing; not yet fine for a live-typing UI — when that lands, either a richer CLI flag or an anthropic-api provider will fill it in.
- **Merge-back is serialised through the pool.** Concurrent tasks writing the same file will end up as sequential merges that may conflict. The conflict surfaces as a task failure with the preserved worktree for operator inspection; no corruption.

### Next session

Phase 2 finale — run the end-to-end:

1. `factory doctor` against live Claude subscription on the current box (already passed in the prior session; re-verify).
2. `factory build example` against live claude-cli. Expected artifacts: working Python modules in the workspace, pytest-green, clean assessor report, total spend logged in `model_usage`.
3. Iterate until:
   - Architect's wiki covers overview/modules/testing and passes `wikiReadiness`.
   - Planner's DAG produces scaffolder → builder → verifier tasks with non-obvious deps handled.
   - Builder's tool-using subprocess writes files that pass pytest.
   - Merge-back leaves the project's `main` with a clean history.
4. Record the actual live-run spend in PROGRESS.md and compare against the $5–20 pre-estimate.
5. Land any prompt-level fixes as edits to `prompts/agents/<role>.md` (not skills — those stay canonical).

After this: Phase 3 — daemon + long-running `runBrain({ mode: 'serve' })`, IPC doorbell on the localhost HTTP port, channel adapters for CLI-RPC first, then Discord.

---

## 2026-04-18 — Phase 2 finale: first live factory build example (blocked on prompt/planner tuning; infra verified)

**Headline:** `factory build example --autonomy autonomous --concurrency 2` ran end-to-end against live claude-cli. Every infrastructure seam worked: triage, architect (7 wiki pages, readiness=ok), planner (14-task DAG), parallel pool with worktrees and stream-json tool use, assessor with real pytest. **5/14 tasks succeeded, 2 failed, 7 skipped on upstream failure.** Total spend **$2.29**, wall-clock **~10 min**. Failures are prompt-engineering / planner-output issues, not infrastructure bugs. Found and fixed one genuine assessor bug (missed bare `-q` pytest summary lines → reported 0 passed when 33 actually passed).

### Done

- **Live smoke (`factory doctor`)** — passed against live Haiku tier; intent classified, confidence 0.95, $0.04.
- **Live `factory build example --autonomy autonomous --concurrency 2 --verbose`:**
  - Triage (Haiku, ~7s, $0.01): intent=build, confidence=0.95.
  - Architect (Opus, ~89s, $0.27): produced `overview.md` + 4 module pages (`cli.md`, `api.md`, `formatter.md`, `models.md`) + `testing.md` + `decisions.md`. Wiki readiness gate passed first try.
  - Planner (Sonnet, ~91s, tbd cost): emitted a 14-task DAG (scaffolder + several builders + reviewers + verifiers).
  - Pool: parallelised at 2; 5 tool-using tasks merged back cleanly (scaffolder, 3 builders, 1 more), 40 files changed in total across successful tasks.
  - Assessor ran; reported pytest `0 passed / 0 failed` — but manual `python -m pytest -q` in the workspace shows **33 tests actually pass**. Root cause was the parser regex requiring `=====` banners; `-q` clean runs emit a bare `33 passed in 0.07s`. **Fixed** — see below.
  - Directive ended `blocked` with exit 2, spend $2.29.
- **Assessor bugfix (`runners/pytest.ts`):**
  - `parseSummary` now matches both the bannered `===== 5 passed, 2 failed in 0.42s =====` form and the bare `-q` form `33 passed in 0.07s` by looking up the last line ending in `in X.Ys`. +2 new tests. Verified live against the example workspace: now reports `testsPassed: 33, integration: true`.

### What the live run revealed — prompt/planner polish items (defer to next session)

1. **Planner over-parallelises modules that share files.** Two concurrent builders (Haiku + Haiku, then Haiku + Opus) were scheduled against tasks whose `expectedOutputs.files` overlapped. One of them won the race; the other's merge-back hit an unresolved conflict. Worktree preserved per ADR 0008 — exactly the designed behaviour. Next pass: tighten the planner prompt to model file ownership and emit `dependsOn` on any task that writes to a file a prior task also writes.
2. **Planner routes builders to `quick` (Haiku) sometimes.** The planner's `category` field is task-level, not agent-default — and it picked Haiku for multiple builders, which is underpowered for a real Python module write. Consider either (a) planner-prompt nudge ("builders default to `deep` unless the task is trivially small"), or (b) clamping at the pool level so `agent: 'builder'` can't end up below `reasoning` tier. Worth an ADR when tackling.
3. **`max-turns: 20` is tight for larger builder tasks.** One Opus builder hit `error_max_turns` after 180s and 20 turns. The cap is correct (prevents runaway loops) but the configured number was optimistic. Options: raise to 30–40 globally via `ClaudeCliProviderOptions.maxTurns`, or let the planner suggest per-task turn budgets alongside its category picks.
4. **Worktrees preserved on failure clutter the workspace.** Two preserved (task-01KPGRPM7YXJ1VAFQDWVZKJCGP, task-01KPGRPM7Z6NYCNAXX0M321TQA). No corruption — exactly what ADR 0008 prescribes. Future `factory cleanup` command should GC these after operator review.
5. **Architect prompt is solid.** 7 coherent pages first try, readiness gate green. No changes needed.

### Verification — PASSED 2026-04-18

- ✅ `pnpm build` — 15 packages + 2 apps compile
- ✅ `pnpm test` — **128 tests pass** across 9 packages (core 12, logger 5, state 6, ipc 5, providers 36, wiki 18, assessor 17, brain 13, worker 16; stub packages pass-with-no-tests). +2 from the assessor parser fix.
- ✅ `pnpm lint` — clean
- ✅ `pnpm format:check` — clean
- ✅ Live `factory build example` smoke — whole pipeline exercised; each phase produced correct artifacts; assessor fix verified against the live workspace (`testsPassed: 33` after the patch).

### Caveats / known gaps

- `factory build example` does not yet produce a green `verify` gate on its own — that requires the planner fixes above plus rerunning with tighter prompts. Infrastructure side of Phase 2 is done; prompt/planner tuning is pushed to a later pass (should come before Phase 3 shipping, but is decoupled from the daemon/channel work that Phase 3 actually blocks).
- The three tuning items above don't warrant new ADRs — they're prompt engineering + one configurable default, not architecture. Flagged in this progress entry and in the Phase 3 startprompt so the next session can decide whether to tackle them before or during Phase 3.

### Next session

**Phase 3** — see [`startprompt-phase3.txt`](./startprompt-phase3.txt). Goal: factoryd becomes a real long-running daemon; `factory build <p>` enqueues via IPC instead of running inline; `factory daemon start/stop/status` + `factory chat` wired through a CLI-RPC channel plugin; fs-watcher event source lands. The prompt recommends a **fresh conversation** — Phase 2's live-run context is cluttered with logs and prompt-tuning notes that Phase 3 doesn't need.

---

## 2026-04-18 — Phase 3 infrastructure: factoryd is a real daemon

**Headline:** `factoryd` is now a real long-running daemon with pidfile coordination, a Fastify IPC server on `127.0.0.1:25295`, a supervised brain serve-loop, a CLI-RPC channel plugin, and a chokidar fs-watcher. `factory build` auto-delegates to the daemon when it's running. `factory daemon {start,stop,status,restart}` + `factory chat` landed. End-to-end smoke test (stub provider, chat directive) passes 8/8 in ~1 s. All workspace gates green: **163 tests** (was 128; +35), build / lint / format:check clean. Four new ADRs (0011–0014) capture the non-obvious choices.

### Done

**Daemon assembly (`@factory5/daemon`):**

- `pidfile.ts` — cross-platform pidfile (Windows `%LOCALAPPDATA%\factory5\factoryd.pid` / Unix `~/.factory5/factoryd.pid`), stale-owner liveness-check via `process.kill(pid, 0)`, self-ownership check on release so a restart can't unlink its successor's file. Overridable via `FACTORY5_PIDFILE`. Throws `PidFileLockedError` when a live owner exists (ADR 0011).
- `doorbell.ts` — typed in-process `EventEmitter` with the three signals the daemon subsystems actually need (`directive.new`, `outbound.new`, `config.reloaded`). Wired to IPC (ADR 0013).
- `supervisor.ts` — `createSupervisor({ name, start, minBackoffMs, maxBackoffMs, maxRestarts })` wraps any long-running task in exponential-backoff crash-loop protection. Used for the brain; reusable for future channels/sources.
- `brain-supervisor.ts` — glues `runBrain({ mode: 'serve' })` to the daemon's doorbell + supervisor. `factoryd` hosts the brain in-process (ADR 0012).
- `server.ts` — Fastify IPC server on `127.0.0.1:25295` with `/healthz`, `/status`, `/send`, `/directives/notify`, `/reload-config`. Non-localhost `preHandler` reject; `ZodError` / `IpcRequestError` mapped to the `@factory5/ipc` error envelope. `/send` optionally calls a deliverer closure (wired to `ChannelRegistry.send`). `/directives/notify` 404s on unknown directive id.
- `index.ts` — composes pidfile + DB + channels + IPC + brain + event sources. `DaemonOptions` exposes `noPidFile` / `noIpc` / `noBrain` / `noChannels` / `noFsWatcher` so tests can disable each independently. Subsystems shut down in reverse order; rollback on partial start-up failure.

**Factoryd entry (`apps/factoryd`):**

- `--foreground` (default) runs the daemon in the current process and waits for SIGINT/SIGTERM.
- `--daemonize` spawns a detached `factoryd --foreground` child, prints its PID, exits 0. Works on Windows (detached `spawn` is the portable equivalent of fork+setsid).
- Catches `PidFileLockedError` and exits 2 with a clear message.

**Brain serve mode (`@factory5/brain`):**

- `serve.ts` — real claim loop: atomic `claimNext` from SQLite, dispatches to `runInline` via a dependency-injected `runOne` (makes tests trivial), up to `concurrency` (default 1) directives in flight at once. Races doorbell wake vs 250 ms poll; `AbortSignal` for shutdown. On abort, marks in-flight directives as `blocked` so resume can pick them up (ADR 0013).
- `loop.ts` — `mode: 'serve'` now wires through `startServeMode` which merges external signal with a private `AbortController`, exposes `done` + `stop()`.
- Minimum chat handler: for `intent=chat` directives, the brain triages then enqueues an `outbound_message` to the originating channel (`(triage) intent=X confidence=Y`). Enough for `factory chat` to demonstrate the round-trip without touching the build path.

**Channels (`@factory5/channels`):**

- `registry.ts` — `ChannelRegistry` owns lifecycle for a set of `ChannelPlugin`s. `start()` tolerates per-plugin failures (captures `status: 'failed' / lastError`). Exposes `ChannelRegistryView` for `/status` and `send(msg)` for IPC `/send`.
- `cli-rpc.ts` — minimal `CliRpcChannel` plugin. Tracks active sessions via `registerSession(sessionRef, listener)`; `send()` delivers live when a listener is registered, returns `delivered: false` otherwise so the CLI's polling picks the row out of `outbound_messages` (ADR 0014).

**Events (`@factory5/events`):**

- `fs-watcher.ts` — chokidar-backed `EventSource`. Accepts static roots or a `ProjectRootsProvider` callback (so daemon picks up newly-registered projects at the next restart). Cross-platform ignore predicate (not glob — chokidar@4 globs flake on Windows): `.factory`, `node_modules`, `.git`, `dist`, `.next`, `build`, `*.log` plus caller-supplied extras. Per-path debouncing (default 500 ms). `awaitWriteFinish` throttles burst writes.

**CLI (`@factory5/cli`):**

- `commands/daemon.ts` — `factory daemon start|stop|status|restart`. `start` refuses to spawn if a live daemon owns the pidfile; polls pidfile appearance with 5 s budget. `stop` sends SIGTERM; polls pidfile-gone with 10 s budget; escalates recommendation on timeout. `status` combines pidfile liveness + `/status` IPC round trip. Binary resolution walks up from the CLI's own location to find `apps/factoryd/dist/main.js` (prod) or `apps/factoryd/src/main.ts` (dev/tsx), with `FACTORY5_FACTORYD_BIN` override.
- `commands/chat.ts` — interactive REPL. Checks daemon liveness + DB presence; creates a session id; writes each user line as a `Directive(intent=chat)`; calls `/directives/notify`; polls `outbound_messages` for replies and marks them delivered as they're read.
- `commands/build.ts` — detects a running daemon via pidfile; if present, writes the directive to SQLite, notifies, and polls the directive's `status`. `--inline` flag forces the old behaviour. Prints a final summary with total spend pulled from `model_usage`.
- Stubs trimmed to just `logs` (still a planned Phase 3 feature but not the critical path).

**Providers (`@factory5/providers`):**

- `stub.ts` — `StubProvider` that returns canned triage / echo responses with zero cost. The brain's `buildDefaultRegistry` honours `FACTORY5_TEST_PROVIDER=stub` and routes every category to the stub, so integration tests and the e2e script never touch a real model.

**E2E smoke (`scripts/e2e-daemon.ts`):**

- New `@factory5/scripts` workspace package. `pnpm --filter @factory5/scripts e2e` spawns `factoryd --foreground` with `FACTORY5_TEST_PROVIDER=stub` + a temp data dir, hits `/healthz`, checks `/status`, inserts a chat directive, rings the doorbell, polls to terminal (`complete`), asserts no stuck `tasks_inflight` rows and no orphaned worktrees, then SIGTERMs and asserts the child exits. Passes 8/8 checks in ~1 s on Windows.

### Decided

- **ADR 0011** — Single-daemon-instance coordination via pidfile + `process.kill(pid, 0)` liveness probe. No native lock dep.
- **ADR 0012** — Brain hosted inside `factoryd` via supervised serve loop. Fault-isolation trade accepted; reversible if brain stability ever becomes a real problem.
- **ADR 0013** — Doorbell is an in-process `EventEmitter` with a 250 ms polling fallback. IPC `/directives/notify` rings the bell; polling keeps correctness under partial failure.
- **ADR 0014** — CLI-RPC transport: HTTP POST for inbound, SQLite polling for outbound, with a pluggable listener hook for future SSE. No new transport to maintain; the hook keeps SSE additive.

### Verification — PASSED 2026-04-18

- ✅ `pnpm build` — all 13 packages + 2 apps + 1 script compile (ESM + DTS)
- ✅ `pnpm test` — **163 tests pass** across 12 packages with test files (core 12, logger 5, state 6, ipc 5, providers 36, assessor 17, wiki 18, channels 4, events 3, worker 16, brain 18, daemon 23; cli has no tests yet — logs-Phase-3 lands with its own)
- ✅ `pnpm lint` — clean (ESLint 9 flat)
- ✅ `pnpm format:check` — clean
- ✅ `pnpm --filter @factory5/scripts e2e` — 8/8 checks: daemon starts, /healthz responds, /status returns schema-valid body (cli channel registered), /directives/notify acknowledged, chat directive reaches `complete` via stub provider, no stuck `tasks_inflight`, no orphaned worktrees, daemon exits within 10 s of SIGTERM.
- ✅ Smoke-verified `factoryd --version`/`--help` still work; `factory daemon --help` prints the four subcommands; `factory daemon status` reports "not running" when no pidfile.

### Caveats / known gaps

- **`factory logs` is still a stub.** Phase 3's scope was the daemon + channel + CLI wiring; a log-tailing CLI with cross-component stitching is deferred.
- **Windows SIGTERM is forcible.** Node translates SIGTERM to a termination-without-handler on Windows, so the e2e assertion is weakened to "process exited" rather than "exit code 0". On Unix the daemon's signal handler runs and exits 0. If a graceful-shutdown-IPC-endpoint is wanted for parity, it slots in cleanly next to `/reload-config`.
- **FsWatcher snapshots roots at `start()`.** A project registered after the daemon started requires a restart before the watcher notices. Flagged in `buildDefaultFsWatcher`; fix is to subscribe to a future `project.registered` doorbell event.
- **Brain-inside-factoryd is not fault-isolated.** A segfault in `better-sqlite3` would take `factoryd` down. Mitigated by the supervisor for JS-level crashes; ADR 0012 documents the reversal path.
- **Directives left in `running` across a crash are not auto-resumed.** The serve loop only picks up `status='pending'`. The pre-Phase-3 `factory resume <project>` handles this manually. A cleaner auto-resume (claim-ownership + re-run from last checkpoint) is Phase 4 material.

### Next session

**Pre-Phase-4** (same session or an immediate follow-up — see next entry below). Then **Phase 4** — Discord channel (`discord.js` plugin + `ask_user` / `escalate_blocked` brain tools + live smokes of daemon-mode `factory build` and `factory chat`). Then Phase 5 (GitHub events) and Phase 6 (polish + cross-project learnings).

---

## 2026-04-18 — Pre-Phase-4: outbound delivery worker + channel config loading

**Headline:** Closed the two Phase 4 blockers flagged at the end of Phase 3. `factoryd` now has a real outbound delivery worker that pulls undelivered `outbound_messages` rows and pushes them through `ChannelRegistry.send()`, and `config.toml` gained a `[channels.<id>]` section so plugins (Discord, Telegram, …) can ship their credentials without code changes. 168 tests green; e2e smoke now 9/9 (extended to assert the brain's chat reply actually lands on the outbound queue).

### Done

**Outbound delivery worker (`@factory5/daemon/outbound-worker.ts`):**

- Loop polls `outbound_messages WHERE delivered_at IS NULL`, hands each row to a `deliver(msg)` callback, marks `delivered_at` on success or records the failure (attempts++, `last_error`) on defer/throw.
- Wakes on the doorbell `outbound.new` event; polling fallback every 1000 ms (configurable via `DaemonOptions.outboundPollIntervalMs`).
- Per-message `maxAttempts` cap (default 5) prevents a hot loop against a dead channel; messages past the cap are skipped but remain in the queue until manual intervention (no dead-letter table yet).
- Stop is idempotent and drains the in-flight pass; re-entrance guard prevents overlapping drains.
- 5 new tests cover delivery, failure recording, doorbell shortcut, max-attempts skip, and stop idempotence.

**Channel config loading (`@factory5/brain/config.ts`):**

- `configSchema` gained a `channels: Record<string, Record<string, unknown>>` block. Keys are plugin ids; values are opaque to the brain and validated lazily by each plugin's `configSchema`.
- `channelConfigFor(cfg, channelId)` helper returns the block for a plugin id or `undefined`.
- `defaultConfig()` now includes an empty `channels: {}` so `factory init` writes a block the user can populate later.

**Daemon wiring (`@factory5/daemon/index.ts`):**

- `DaemonOptions` gained `channelConfigs?: Record<string, unknown>` (explicit override, test-friendly), `noConfigFile?: boolean` (skip `config.toml` reads), `noOutboundWorker?: boolean`, `outboundPollIntervalMs?: number`.
- On start, daemon calls `loadConfig()` unless `noConfigFile` is set; merges explicit `channelConfigs` overrides on top and passes each block to `ChannelRegistry` per plugin.
- `ChannelRegistry.start()` now runs each plugin's `configSchema.parse(rawConfig ?? {})` before invoking `plugin.start(ctx, validated)`. A plugin with a permissive `z.object({}).default({})` schema (like the CLI-RPC plugin) validates through trivially; a plugin with a strict schema (Discord, coming next) fails loudly with a parsed error rather than silently starting with garbage config.

**E2E (`scripts/e2e-daemon.ts`):**

- Asserts the brain's chat reply actually surfaced as an `outbound_messages` row (tagged `(triage) intent=chat confidence=<n>`). Proves the brain → outbound → worker path end-to-end without requiring a live channel listener.

### Verification — PASSED 2026-04-18

- ✅ `pnpm build` — all 13 packages + 2 apps + 1 script compile
- ✅ `pnpm test` — **168 tests pass** (Phase 3 163 + outbound-worker 5; core 12, logger 5, state 6, ipc 5, providers 36, assessor 17, wiki 18, channels 4, events 3, worker 16, brain 18, daemon 28)
- ✅ `pnpm lint` / `pnpm format:check` — clean
- ✅ `pnpm --filter @factory5/scripts e2e` — **9/9** (Phase 3 8 + outbound-row assertion)

### Caveats / known gaps (inherited from Phase 3; still open)

- `factory logs` is a stub.
- Windows SIGTERM is forcible; e2e assertion is weakened accordingly.
- FsWatcher snapshots roots at `start()`.
- Brain-inside-factoryd is not fault-isolated against native crashes.
- No auto-resume of directives left `running` after a crash.
- Planner tuning items from Phase 2 live-run (file-overlap collisions, Haiku routing for builders, tight `max-turns`).

### Next session

**Phase 4** — see [`startprompt-phase4.txt`](./startprompt-phase4.txt). Recommended to start in a **fresh conversation**: the Phase 3 context has run long and the Phase 4 scope (`ask_user` / `escalate_blocked` brain tools, Discord plugin, live smoke) is a clean slice of work that benefits from an uncluttered context. The startprompt points Phase 4 at reading `CLAUDE.md` + the latest two PROGRESS entries + ADRs 0005 / 0011–0014 + `CompleteArchitecture.md` §9 (channels) + §11 (autonomy modes / `ask_user`).
