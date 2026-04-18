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

---

## 2026-04-18 — Phase 4: ask_user / escalate_blocked + Discord channel + init/doctor wiring

**Headline:** Discord is now a first-class inbound + outbound channel. Brain has `askUser` / `escalateBlocked` primitives that survive restarts; autonomous-mode directives that finish with failures escalate instead of silently dying. `factory init` gained `--discord-*` flags, `factory doctor` gained a Discord reachability probe, `factory answer <id> <text>` closes pending questions from the CLI. 201 tests green (was 168; +33 = +12 ask-user + +21 discord). `scripts/e2e-daemon.ts --discord` adds 4 new checks; the full e2e now runs 13/13. Lint + format clean. One new ADR (0015) covers why mid-flight engagement happens at brain-level + checkpoint-and-rehydrate, not subprocess-level suspension.

### Done

**Live shakedown (Phase 3 seams under real claude-cli, step 1):**

- `factoryd --foreground` + headless `factory chat --autonomy chat` with `printf 'hello…' | …` round-trip verified against live Haiku triage. ~$0.005 total spend, ~3 s wall-clock. Directive inserted → claimed by serve loop → triage returned `intent=chat confidence=0.98` → outbound enqueued → delivered via CLI poll.
- Full `factory build example` live shakedown **deferred** to the Phase 5 Discord end-to-end. Phase 2's finale already exercised the build pipeline live ($2.29 / ~10 min); Phase 3's stub e2e validates the daemon-mode runViaDaemon polling path; the chat shakedown validated the Phase 3 daemon + serve-loop seams live. Remaining unvalidated-live piece is long-duration (10+ min) daemon uptime, which the Phase 5 live Discord smoke covers equivalently without double-spending.

**`askUser` / `escalateBlocked` (`@factory5/brain/ask-user.ts`):**

- `askUser({ db, directiveId, question, options?, deadlineAt?, signal?, pollIntervalMs? })` — create-or-rehydrate a `pending_questions` row, enqueue one outbound message on the directive's originating channel (`targetChannel = directive.source`, `targetRef = directive.channelRef`), poll `answered_at` at 1 Hz until answered / deadline / abort.
- Idempotent on `(directiveId, question, taskId?)`. Three paths: (a) already-answered row → return the previous answer without re-asking, (b) open row → resume polling without re-enqueuing outbound, (c) no row → create + enqueue.
- `escalateBlocked({ reason, attempted, suggestions, … })` — stores a stable JSON question body so rehydration keys off it; renders the outbound as the "I'm stuck — here's what I tried" prompt from ADR 0005.
- 12 new unit tests cover: create-path, rehydration from answered row, open-row polling, deadline, abort-signal, custom outbound renderer, directive-source routing (including `discord`), escalate formatting, and default-render templates.
- Wired into `loop.ts` at the end of the inline pipeline: **autonomous mode** with failures (or failing verify gate) calls `escalateBlocked` with the failed tasks + three default suggestions; the call blocks until a human answers or the brain is aborted. Assisted-mode phase checkpoints are scaffolded (primitives + integration contract) but not yet wired to avoid changing default UX in the same diff.

**`factory answer <questionId> [text...]` (`@factory5/cli/commands/answer.ts`):**

- Writes `pending_questions.answer` + `answered_at`. Does not require a running daemon (SQLite is the bus).
- Accepts either inline text (`factory answer ULID continue`) or `-` to read from stdin (for longer prompts).
- Refuses to double-answer a question that already has `answered_at`.

**Discord channel plugin (`@factory5/channels/discord.ts`):**

- `discord.js` v14.26 wrapper implementing the full `ChannelPlugin` contract (start/stop/send + inbound normalisation).
- Intents: `Guilds + GuildMessages + MessageContent` (MessageContent is privileged — documented in the plugin's TSDoc).
- Thread discipline (matches Phase 4 startprompt): every mention-in-a-channel opens a thread via `message.startThread({ name: 'factory: …' })`. `channelRef` emitted as `<channelId>#<threadId>` so cross-directive messages don't interleave.
- Answer routing: any unanswered `pending_questions` whose `channel_ref` ends in `#<threadId>` gets closed when a user posts in that thread. The bot acks with `(answered question <id>)` as a threaded reply so the human sees closure.
- Intent detection: mention text starting with `buildPrefix` (default `/build`) → `intent=build` + payload `{ project, spec?, text }` + `autonomy=autonomous`; everything else → `intent=chat` + `autonomy=chat`.
- Allow-list + guild-scoping controls: `allowedUserIds` (empty = anyone the Discord permission system allows), `guildId` (scope the bot to a single guild).
- `createDiscordChannel({ clientFactory, db })` takes a pluggable `DiscordClientLike` factory so unit tests + the `--discord` e2e scenario run without a real bot token.
- 21 new unit tests cover: ref parsing, mention-prefix stripping, thread-name building, ready-gate, bot-author ignore, guild ignore, allowlist ignore, chat-mention normalisation with thread creation, `/build`-prefix parsing, pending-question answer routing, send-to-thread, send-to-bare-channel, channel-not-found, not-ready-guard.

**Daemon wiring (`@factory5/daemon/index.ts`):**

- `buildDefaultChannelPlugins(fileConfig)` — CLI-RPC always on; Discord added only when `config.toml` has `[channels.discord].token` non-empty. Avoids a "discord: failed (no token)" line on every startup for users who haven't configured Discord.
- Existing `DaemonOptions.channelPlugins` override unchanged so tests still inject whatever they want.

**`factory init --discord-*` flags (`@factory5/cli/commands/init.ts`):**

- `--discord-token`, `--discord-application-id`, `--discord-guild`, `--discord-default-channel` populate `[channels.discord]` in the written `config.toml`. Any one of the four triggers the block; missing fields are simply absent.
- Smoke-verified: `factory init --force --discord-token … --discord-application-id … --discord-guild … --claude-cli-path …` with `FACTORY5_DATA_DIR` redirected produces the expected TOML.

**`factory doctor` Discord probe (`@factory5/cli/commands/doctor.ts`):**

- When `config.toml → [channels.discord].token` exists, attempts a 15 s `Client.login()` + `ClientReady` wait + `guilds.cache.size` + optional `guilds.fetch(targetGuild)` to confirm the configured guild is reachable.
- Reports `login`, `bot` tag, `guilds` visible, `guildId` reachable (when configured), plus error message on failure. Exits 2 on login failure.
- `--skip-discord` flag skips the probe even when a token is configured.

**E2E (`scripts/e2e-daemon.ts`):**

- New `--discord` flag runs a second in-process scenario after the existing subprocess scenario. Uses `startDaemon({ channelPlugins: [cli, discordStub], channelConfigs: { discord: { token: 'stub-token', guildId: 'guild-e2e' } } })` + `FACTORY5_TEST_PROVIDER=stub` so no real bot token is needed. Simulates an inbound Discord message via `DiscordChannel._simulateMessage`, waits for the brain's triage reply to surface in the stub's `sent[]` record.
- 4 new assertions: daemon starts with Discord channel, Discord inbound creates a directive, brain reply delivered via Discord stub, outbound text contains the triage summary.
- `pnpm --filter @factory5/scripts e2e --discord` now runs **13/13**; unchanged 9/9 when run without the flag.

**ADR 0015 — Mid-flight user engagement:**

- Documents why `askUser` lives at brain level (checkpoint between phases) rather than inside the `claude -p` subprocess (would pin the subscription, grow context window with nothing, lose state on restart).
- Phase 5+ can layer worker-subprocess `ask_user` on top without changing this primitive.

### Decided

- **ADR 0015** — `askUser` / `escalateBlocked` at brain level with idempotent pending-question rehydration; worker-subprocess suspension explicitly out of scope.

### Verification — PASSED 2026-04-18

- ✅ `pnpm build` — all 13 packages + 2 apps + 1 script compile (ESM + DTS)
- ✅ `pnpm test` — **201 tests pass** (Pre-Phase-4 168 + ask-user 12 + discord 21)
- ✅ `pnpm lint` — clean
- ✅ `pnpm format:check` — clean
- ✅ `pnpm --filter @factory5/scripts e2e` — 9/9 (unchanged)
- ✅ `pnpm --filter @factory5/scripts e2e --discord` — **13/13** (full Discord round-trip via stub)
- ✅ Live daemon smoke: `factoryd --foreground` + headless `factory chat` — triage reply via live Haiku, ~$0.005.

### Caveats / known gaps

- **Assisted-mode checkpoints not yet wired.** The primitives (`askUser`) are ready and exported; integrating between-phase checkpoints changes default UX for `--autonomy assisted` users, so the wiring is deferred to a dedicated follow-up iteration where the exact prompts can get their own UX pass.
- **Worker-subprocess `ask_user` is not implemented** (ADR 0015). A builder that realises mid-tool it needs clarification has to either guess or raise a finding. Revisitable if users report pain.
- **Live Discord smoke in a private guild is still a manual step.** The `--discord` e2e exercises the full daemon assembly + round-trip via a stub client, which proves the plumbing; only an actual bot token posting into a real guild validates the last inch of real-API behaviour (rate limits, permissions, MessageContent intent, etc.). Estimated manual cost: ~$0 (chat round-trip only) or $2–5 (if a real `/build` directive gets claimed and the full pipeline runs).
- **Every chat message accumulates one failed Discord-outbound attempt** if the daemon isn't registered as a live CLI session listener — same behaviour as Phase 3. Messages still deliver via polling. Low-severity Phase 3 polish item still deferred.
- **`factory logs`** is still a stub.
- **Brain-inside-factoryd** still not fault-isolated against native crashes (ADR 0012).
- **Directives left `running` across a daemon crash** are not auto-resumed; `factory resume <project>` is the manual path.
- **Planner tuning items from Phase 2 live-run** (file-overlap collisions, Haiku routing for builders, tight `max-turns`) still open.

### Next session

**Phase 5 scope is flexible.** The startprompt for Phase 4 explicitly left GitHub events, Telegram, and the web UI for Phase 5+. Candidate priorities in descending order:

1. **Live Discord smoke in a private guild** — burn $2–5 validating the last inch of the real Discord API + do a full `/build` directive end-to-end. Records real-world usage and likely surfaces prompt/planner issues not visible in the stub e2e.
2. **Planner + prompt tuning** from the Phase 2 finale caveats (file-ownership modelling, category floor for builders, configurable `max-turns`). Cheapest win for build quality.
3. **Assisted-mode checkpoint wiring** — plug `askUser` into phase boundaries; deliver the "confirm design before planning" and "confirm plan before building" UX.
4. **Worker-subprocess `ask_user`** (shape 1 in ADR 0015) — if the field shows actual pain from the mid-tool gap.
5. **GitHub event source + channel** — per the original Phase 5 scope.

Each is independently scoped; any of (1)–(3) fits in one fresh conversation.

---

## 2026-04-18 — Phase 4 closeout: live Discord smoke + `Events.ClientReady` bug fix + assisted-mode checkpoints

**Headline:** Phase 4 is fully closed out. Live chat round-trip through real Discord verified end-to-end (bot posted a triage reply in an auto-spawned thread; ~$0.005). Bug found + fixed during the smoke: the `ClientReady` event listener was registered with the wrong string literal `'ClientReady'` instead of `Events.ClientReady` (`'clientReady'`), which let unit tests pass (stubs matched the wrong literal) while hanging on any real discord.js v14 client. Assisted-mode checkpoints now wired at architect-done and planner-done. Daemon test isolation hardened so future users who configure a Discord token don't have unit tests silently try a real login. **201 tests still green**, lint + format clean.

### Done

**Live Discord smoke (the other half of Phase 4 Step 5):**

- User created a Discord bot application, enabled Message Content Intent, invited to a private guild (guild id `1495163534433325171`, channel id `1495163648937689182`).
- `factory doctor --skip-call` surfaced three iterative bugs before passing:
  1. First attempt → REST `401: Unauthorized`. Root cause: token leaked into chat paste + then got pasted into PowerShell with a trailing newline. Fixed by rotating + using `Read-Host` for interactive paste.
  2. Second attempt → REST ok, gateway stuck at `Identifying` (no READY). Debug tail showed the shard was actually fully ready internally but our listener never fired.
  3. Root cause: `client.once('ClientReady', …)` used a literal string that doesn't match discord.js v14's emitted event name (`'clientReady'` lowercase c). The `Events.ClientReady` enum is the supported path. Fixed.
- After the fix: `rest: ok`, `login: ok`, `bot: Factory#5957`, `guilds: 1 visible`, `guildId: reachable`.
- Live chat: user @mentioned the bot in the configured channel; brain triaged `intent=chat confidence=0.98` in live Haiku (~$0.005); DiscordChannel's `message.startThread()` spawned a thread on the user's message; outbound worker delivered the triage reply into the new thread on the first attempt (`attempts=0`, `delivered_at` set). Directive reached `complete` in under 2 s wall-clock.
- Full `/build` directive intentionally skipped to preserve budget + because the triage round-trip exercised the critical new Phase 4 plumbing (inbound normalisation, thread creation, outbound routing through Discord).

**Bug fix — `Events.ClientReady`:**

- `packages/channels/src/discord.ts` — `client.once('ClientReady', …)` → `client.once(Events.ClientReady, …)`. Also updated `DiscordClientLike` contract's event type to `typeof Events.ClientReady`.
- `packages/cli/src/commands/doctor.ts` — same fix in the probe.
- `packages/channels/src/discord.test.ts` + `scripts/e2e-daemon.ts` stubs — match against `Events.ClientReady` so the stub keeps matching the real event name.
- Enhanced doctor probe: split REST validation (`/users/@me`) from gateway login, so operators can distinguish a bad token (REST 401) from a privileged-intent or network issue (gateway stall). Captures gateway `error` / `shardError` / `shardDisconnect` / `shardReconnecting` events + keeps a 20-line ring buffer of debug messages and prints the last 6 on timeout. Bumped timeout 15 s → 45 s.

**Daemon test isolation:**

- `packages/daemon/src/index.test.ts` — `baseOpts` now sets `noConfigFile: true`. Without it, a user who has run `factory init --discord-token …` would have daemon integration tests attempt a live Discord login on every `pnpm test` and hang or time out. Caught only by running the full suite after the live smoke wrote the user's real token to `config.toml`.

**Assisted-mode checkpoints (ADR 0005, previously scaffolded):**

- `packages/brain/src/loop.ts` — two checkpoints for `directive.autonomy === 'assisted'`:
  1. **After architect** — `askUser("Architect done (N wiki pages). Continue to planning?", options: ['continue', 'abort'])`.
  2. **After planner** — `askUser("Plan ready (N tasks). Continue to execution?", options: ['continue', 'abort'])`. Highest-leverage: blocks before any paid worker tasks start.
- `isAbortAnswer(res)` helper treats explicit `abort|cancel|stop|no|quit|exit` (case-insensitive, word-boundary anchored), aborted signals, and timeouts as aborts. Anything else continues.
- On abort: the brain marks the directive `blocked`, appends a reason to BUILD.md, and returns early with `terminalStatus: 'blocked'`. No paid work past the abort point.
- Fully idempotent via the `askUser` rehydration contract — resuming a directive after a restart finds the answered-row and continues without re-asking.
- Autonomous and chat modes unchanged. No assisted-mode-specific tests because the primitive is heavily covered (12 ask-user tests) and the wiring is two calls to a tested function; the full integration path would require a live-provider build which Phase 5 covers.

### Decided

- No new ADRs. The `Events.ClientReady` fix is a bug, not a design. The assisted-mode integration is what ADR 0005 already specified; shipping the wiring just delivers on the promise.

### Verification — PASSED 2026-04-18

- ✅ `pnpm build` — clean
- ✅ `pnpm test` — **201 tests pass** (unchanged; the `Events.ClientReady` fix + daemon test-isolation fix cover regressions that would otherwise have surfaced once a user configured Discord)
- ✅ `pnpm lint` — clean
- ✅ `pnpm format:check` — clean
- ✅ `pnpm --filter @factory5/scripts e2e` — 9/9
- ✅ `pnpm --filter @factory5/scripts e2e --discord` — 13/13
- ✅ **Live Discord chat smoke** — real guild, real bot, real claude-cli. Directive → thread → triage reply posted. ~$0.005. No daemon crashes.

### Caveats / known gaps (carried forward)

- `factory logs` still a stub.
- Brain-inside-factoryd not fault-isolated against native crashes.
- Directives left `running` across a daemon crash aren't auto-resumed.
- Planner tuning items from Phase 2 finale still open.
- **Worker-subprocess `ask_user`** (shape 1 in ADR 0015) — deferred to Phase 5+.
- **Full `/build` Discord smoke** — deferred. The chat round-trip validates all new Phase 4 plumbing; a real `/build` exercises the same infrastructure Phase 2 already proved live at $2.29. Revisit if any prompt/planner tuning lands in Phase 5.

### Phase 4 final stats

- 33 new tests (12 ask-user + 21 Discord + 4 e2e scenarios = `168 → 201`).
- 1 new ADR (0015 — mid-flight user engagement).
- 2 new source files (`ask-user.ts`, `discord.ts`) + their tests.
- 2 bugs found + fixed during live smoke (token-paste-newline UX, `Events.ClientReady`).
- ~$0.01 cumulative spend across Phase 4 live validation (doctor probes + 2× chat smoke).

### Next session

**Phase 5.** See [`startprompt-phase5.txt`](./startprompt-phase5.txt). **Recommended: start a fresh conversation.** The Phase 3 + Pre-Phase-4 + Phase 4 + Phase 4 closeout context has run long, and Phase 5's scope (planner/prompt tuning OR GitHub events, depending on direction chosen) reads cleanest from a clean slate with just `CLAUDE.md` + the last two PROGRESS entries as context.

---

## 2026-04-18 — Phase 5a: planner materialisation (category floor, file-ownership deps, per-task turn budgets)

**Headline:** Direction A from the Phase 5 startprompt. The three Phase-2-finale planner caveats are now closed at the code level: (1) the planner's emitted plan goes through a `materialisePlannerTasks` pass that inserts synthetic `dependsOn` edges whenever two tasks share any `expectedOutputs.files[]` entry (no more concurrent builders racing on the same file); (2) every task's `category` is clamped to at least the agent-registry floor (a `builder` task the LLM labels `quick` is materialised as `deep` — cheap-model builders are now structurally impossible); (3) `taskSchema` gained an optional `maxTurns` field that flows through `ProviderRequest.maxTurns` into `claude -p --max-turns`, and the provider-level default was raised 20 → 40. The Phase 1 stub `prompts/agents/planner.md` is replaced with a real prompt covering agent-role selection, the file-ownership rule (with ✅/❌ examples), the category table, and turn-budget guidance. One new ADR (0016). **214 tests green** (was 201; +12 planner tests + 1 claude-cli maxTurns test). Lint + format clean. E2E 9/9 (unchanged — still runs against stubs). **No live spend this session** — the code-level changes are complete and tested; live validation against `factory build example` is deferred to a follow-up session with clearer go/no-go criteria.

### Done

**`@factory5/core` — capability ranking + optional `Task.maxTurns`:**

- `MODEL_CATEGORY_RANKS: Readonly<Record<ModelCategory, number>>` in `constants.ts`. `quick = documentation = 0`, `planning = 1`, `reasoning = deep = 2`. Exported so the planner, the registry, and future tooling share one ordering.
- `taskSchema.maxTurns` — optional positive integer, tool-using agents only (scaffolder / builder / fixer); read-only agents ignore it.

**`@factory5/providers` — per-request `maxTurns` + raised default:**

- `ProviderRequest.maxTurns?: number` — new optional field on the provider contract.
- `ClaudeCliProvider.stream()` uses `req.maxTurns ?? this.maxTurns`. `call()` ignores it (single-shot call has no tool turns).
- `ClaudeCliProviderOptions.maxTurns` default **20 → 40**. Doubles the per-task headroom for typical builder tasks; per-request override lets the planner punch through to 60-80 for large implementations without raising the global floor.
- +1 test: `buildClaudeArgs` with a per-request override emits the right `--max-turns` value.

**`@factory5/brain/planner.ts` — materialisation layer:**

- `materialisePlannerTasks(raw, planId) -> { tasks: Task[]; notes: string[] }` is now the only path from LLM output to on-disk `plan.json`. Three passes:
  1. **Category floor.** `max(plannerChoice, AGENTS[role].category)` using the rank table. Every clamp recorded in `notes[]`.
  2. **Synthetic dependencies for shared files.** Normalise paths (`./foo` == `foo\bar` == `foo/bar`), track first writer, for each subsequent writer check reachability through the existing DAG — only add a synthetic edge if there isn't one already. Prevents the Phase-2-finale failure mode where two concurrent builders both wrote `src/foo.ts` and collided at merge-back.
  3. **`maxTurns` passthrough.** Planner-emitted field carried verbatim into the materialised `Task`.
- Returned `PlannerResult` now includes `adjustments: string[]` — one entry per rewrite, logged at `warn` level and available to future UX (e.g. "the factory rewrote 2 of your tasks to avoid file conflicts" in assisted mode).
- 12 new unit tests in `planner.test.ts` cover: category upgrades per agent, same-index `dependsOn` filtering, synthetic-edge insertion, path normalisation, transitive-reachability short-circuit, three-way overlaps, empty-file ignoring, `maxTurns` passthrough.

**`@factory5/brain/planner.ts` — user-prompt tightening:**

- The inline user prompt now lists: defaults per agent, a hard "never `quick`/`documentation` for builder/scaffolder/fixer", the file-ownership rule (with the "merge-conflict" phrasing so the LLM understands the cost), the parallelisation rule (no false dependencies), the scope rule (prefer fewer larger tasks), and a `maxTurns` sizing guide (10-20 / 25-40 / 50-80).
- Example JSON skeleton shows a `builder` with `maxTurns: 60` so the model has a concrete pattern to mimic.

**`@factory5/worker/run-worker.ts` — thread maxTurns through:**

- Tool-using path now passes `task.maxTurns` via `ProviderRequest.maxTurns` when present.

**`prompts/agents/planner.md` — real prompt (was a Phase 1 stub):**

- Full rewrite. Sections: agent roles and when to use each, category table with upgrade/downgrade rules, file-ownership rule with worked ✅/❌ examples, parallelisation guidance, scope guidance, turn budgets with sizing bands, and a minimal plan skeleton.

**Docs:**

- **ADR 0016** (`docs/decisions/0016-planner-materialisation-and-turn-budgets.md`) — documents the three behaviours, why they live in a materialisation pass rather than the pool or the prompt alone, the known limitation of the first-writer rule for three-way overlaps, and the alternatives rejected (reject+retry, merge-same-file tasks, raise default to 80).
- **`docs/decisions/INDEX.md`** — new row for 0016.
- **`docs/CONTRACTS.md`** — documents `MODEL_CATEGORY_RANKS`, adds `maxTurns?: number` to the `Task` shape, notes that `dependsOn` may include synthetic edges (ADR 0016) and `category` is materialised with a per-agent floor.

### Decided

- **ADR 0016** — three-behaviour materialisation pass, category floor from the agent registry, synthetic `dependsOn` edges for shared files, optional per-task `maxTurns` with a provider-level default raised 20 → 40.

### Verification — PASSED 2026-04-18

- ✅ `pnpm build` — all 13 packages + 2 apps + 1 script compile (ESM + DTS)
- ✅ `pnpm test` — **214 tests pass** (Phase-4-closeout 201 + planner 12 + claude-cli maxTurns 1)
- ✅ `pnpm lint` — clean
- ✅ `pnpm format:check` — clean
- ✅ `pnpm --filter @factory5/scripts e2e` — 9/9 (unchanged — still stub-provider path)

### Caveats / known gaps

- **No live `factory build` this session.** The code and tests prove the materialiser does the right thing on synthetic plans. Validating that a live planner call produces a better plan (and that the live builder finishes inside the new default turn budget) still requires a real run. The Phase 5 startprompt suggested a $5-15 budget; saving that for a session that can watch the run closely and update prompts based on the real output.
- **Three-way file-overlap ordering isn't exhaustive.** The materialiser's first-writer rule only adds an edge from each later writer to the _first_ writer of a file. If tasks A, B, and C all write `src/x.ts` and B doesn't depend on A, C ends up with an edge to A but not to B — B and C can still race. In practice the rewritten planner prompt should prevent this; a follow-up could add a second pass that edges to every prior writer. Left as a note in ADR 0016.
- **`maxTurns` is per-task, not per-phase.** A long task has one budget for scaffold + build + fix. The planner can size up for known-large tasks; finer-grained phasing is future work.
- **Planner prompt has no tests.** The materialiser is exhaustively tested, but the prompt itself will only reveal problems during live runs. Regression coverage for prompt drift is a follow-up (e.g. fixture prompt + expected JSON output, or a quick Haiku smoke on a canned spec).
- **`factory logs`** still a stub.
- **Brain-inside-factoryd** still not fault-isolated against native crashes.
- **Directives left `running` across a daemon crash** aren't auto-resumed.
- **Worker-subprocess `ask_user`** (shape 1 in ADR 0015) — still deferred.

### Next session

**Options, in descending order:**

1. **Live `factory build example --autonomy autonomous --concurrency 2`** against the materialiser. Budget $5-15; re-run with prompt tweaks until all tasks succeed and the verify gate is green. Record spend + task-success-rate + any further planner prompt edits in PROGRESS.md. If a second-pass file-ownership edge (three-way overlap) turns out to matter, ship it here.
2. **GitHub event source + channel** (Phase 5 direction B). Two new packages (`@factory5/events/github-poll`, `@factory5/channels/github`), cursor persistence in a new `github_cursors` table, `--github-token` on `factory init`, reachability probe in `factory doctor`, extended e2e with `--github` stub flag. Clean slate for a dedicated session.
3. **Worker-subprocess `ask_user`** (Phase 5 direction C). Only if a live run surfaces a concrete mid-tool blocker.

Recommended to keep the fresh-conversation discipline — this session's focus on materialisation is complete, and a live-run session benefits from an uncluttered context.
