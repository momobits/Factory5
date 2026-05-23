# Architecture

Factory 5 is a multi-channel autonomous software builder. It accepts requirements via CLI, Discord, Telegram, or web UI; designs, implements, tests, and verifies projects through a verification-first build loop; and runs against any of four supported language runtimes (Python, Node, Go, Rust). The operator's Claude subscription is the primary model provider, with category-based routing and provider fallback.

This document is the canonical system reference. Per-decision rationale lives in [`decisions/`](decisions) (33 ADRs). Data shapes live in [`CONTRACTS.md`](CONTRACTS.md). For the operator-facing view of how to drive factory5 — the four canonical loops, when to use which surface, how to author a `CLAUDE.md` spec — see [`WORKFLOWS.md`](WORKFLOWS.md).

---

## Process model

Two binaries, both Node 20+ / TypeScript / ESM:

- **`factory`** — CLI + brain. Per-invocation for CLI; long-lived for `factory chat` / `factory serve`. Wires `cli` + `brain` + `worker` + `providers`.
- **`factoryd`** — Daemon. Long-lived. Owns outside-world I/O (Discord websocket, Telegram long-poll, fs watching), the localhost IPC server, the read-write web UI, and the brain supervisor.

The daemon is required for chat, Discord, Telegram, fs-driven, and web-UI work. It is **not** required for inline `factory build <project>` runs.

## Top-level layout

```
┌─────────────────────────────────────────────────────────────────────┐
│  USER / EXTERNAL                                                    │
│  CLI prompt   Discord channel   Telegram chat   Web UI (browser)    │
└──┬─────────────────┬──────────────────┬──────────────────┬──────────┘
   │                 │                  │                  │
   ▼                 ▼                  ▼                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│  factoryd  — DAEMON  (Node + TypeScript)                            │
│                                                                     │
│  Channels:    cli-rpc · discord (discord.js) · telegram (grammy)    │
│  Event src:   fs-watch (chokidar)                                   │
│  IPC server:  Fastify on 127.0.0.1:25295                            │
│    /api/v1/*  — read+write JSON API (bearer FACTORY5_UI_TOKEN)      │
│    /app/*     — Astro SPA static bundle (apps/factory-web/dist)     │
│    /send /directives/notify /worker/ask-user /ui-token /…           │
│  Brain supervisor (hosts brain serve loop)                          │
└─────────────────────────────┬───────────────────────────────────────┘
                              │ writes
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│  <repo>/.factory/factory.db   (SQLite — durable bus + audit + state)│
│                                                                     │
│  directives        outbound_messages      events_audit              │
│  sessions          pending_questions      tasks_inflight            │
│  projects          findings_registry      model_usage               │
└─────────────────────────────┬───────────────────────────────────────┘
                              │ reads/writes
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│  factory  — CLI + BRAIN  (Node + TypeScript)                        │
│                                                                     │
│  CLI: build · daemon · chat · doctor · init · resume · findings ·   │
│       spend · ui-token · questions cleanup · answer · …             │
│                                                                     │
│  Brain: TRIAGE → confirm-per-autonomy → ARCHITECT → PLAN →          │
│         DELEGATE in parallel → ASSESSOR (no LLM) → VERIFY →         │
│         loop or escalate (askUser / escalateBlocked)                │
│                                                                     │
│  Workers: per-task git worktree → claude -p subprocess → stream-    │
│           json parse → findings → SQLite + project files.           │
│           Per-spawn fs sandbox (deny rules + PreToolUse hook).      │
│                                                                     │
│  Providers: claude-cli (default) + StubProvider (test)              │
└─────────────────────────────┬───────────────────────────────────────┘
                              │ creates/updates files in
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│  PROJECTS  (in <workspace>/<project>/ — OUTSIDE factory5)           │
│                                                                     │
│  CLAUDE.md            ← user spec (input)                           │
│  docs/knowledge/*.md  ← wiki (architect writes)                     │
│  BUILD.md             ← findings, decisions, log                    │
│  .factory/                                                          │
│    project.json   plan.md   findings.json   checkpoints/            │
│    worktrees/     logs/build-<ts>.log                               │
│  src/  tests/  …      ← the actual code being built                 │
└─────────────────────────────────────────────────────────────────────┘
```

## Components

### Packages (15)

| Package                    | Process            | Responsibility                                                                                                                                                            |
| -------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@factory5/core`           | shared             | Types + Zod schemas — `Directive`, `Event`, `Finding`, `Plan`, `Task`, `AgentRole`, `ModelCategory`, `AutonomyMode`                                                       |
| `@factory5/logger`         | shared             | Pino logger factory; correlation-ID propagation; file-sink with daily rotation                                                                                            |
| `@factory5/state`          | shared             | SQLite (better-sqlite3) wrapper; 8 migrations; typed CRUD; spend / findings / pending-questions queries                                                                   |
| `@factory5/ipc`            | shared             | HTTP contracts (Zod) + typed `DaemonClient` for daemon ↔ brain                                                                                                            |
| `@factory5/channels`       | daemon             | `ChannelPlugin` interface + registry + `cli-rpc` (ADR 0014) + `discord` + `telegram` (ADR 0022)                                                                           |
| `@factory5/events`         | daemon             | `EventSource` interface + `fs-watcher` (chokidar, debounced)                                                                                                              |
| `@factory5/daemon`         | daemon             | Pidfile (ADR 0011); Fastify IPC server; web UI mount; channel + event lifecycle; brain supervisor (ADRs 0012, 0013); outbound delivery worker                             |
| `@factory5/providers`      | brain              | `ClaudeCliProvider` (stream-json NDJSON parsing, ADR 0009) + `StubProvider` (via `FACTORY5_TEST_PROVIDER=stub`)                                                           |
| `@factory5/wiki`           | brain              | Pages, findings, BUILD.md, plan, readiness gate; project metadata (`project.json`); `resolveDirectiveLimits` budget merge                                                 |
| `@factory5/assessor`       | brain              | Pluggable runtimes (Python / Node / Go / Rust, ADR 0026) + artifact + git checks. **No LLM.**                                                                             |
| `@factory5/brain`          | brain              | Triage → architect → planner → delegate → verify loop; agent registry; category routing; `askUser` / `escalateBlocked` (ADR 0015); pre-call budget enforcement (ADR 0020) |
| `@factory5/worker`         | brain (subprocess) | Per-task git worktrees (ADR 0008); tool-using `claude -p` subprocess (ADR 0007); parallel pool with heartbeats (ADR 0010)                                                 |
| `@factory5/worker-mcp`     | brain (subprocess) | MCP server exposing `mcp__factory5-ask-user__ask_user` to the worker subprocess (ADR 0024)                                                                                |
| `@factory5/worker-sandbox` | brain (subprocess) | Per-spawn fs scoping: `permissions.deny` rules + `PreToolUse` hook with path-prefix algebra (ADR 0028)                                                                    |
| `@factory5/cli`            | brain              | Commander-based CLI: `build` / `daemon` / `chat` / `doctor` / `init` / `resume` / `findings` / `spend` / `ui-token` / `questions cleanup` / `answer` / …                  |

### Apps

| App                | Role                                                                                                                          |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `apps/factory`     | brain entry — wires `cli` + `brain` + `worker` + `providers` into the `factory` binary                                        |
| `apps/factoryd`    | daemon entry — wires `daemon` + `channels` + `events` + brain supervisor into the `factoryd` binary                           |
| `apps/factory-web` | Astro SPA (file-based routing, Islands-on-demand, `<ClientRouter />`); `dist/` is served by `factoryd` at `/app/*` (ADR 0025) |

## Storage

- **Project state** — files in `<workspace>/<project>/{CLAUDE.md, docs/knowledge/, BUILD.md, .factory/}`. Per-project; ships with the project; human-readable; git-committable. The project's `.factory/project.json` is the first-class identity record (ADR 0021), holding `metadata.language`, `metadata.budgetDefaults`, and similar persistent settings.
- **Factory runtime state** — SQLite at `<repo>/.factory/factory.db` (repo-local instance per ADR 0023; cwd-walk discovery) or `~/.factory/factory.db` fallback. 8 schema migrations.

## Inter-process communication

- **Bus** — SQLite is the durable, audited, crash-safe truth. Daemon writes inbound directives; brain claims and processes; brain writes outbound messages; daemon delivers; every event is recorded in `events_audit`.
- **Doorbell** — Localhost HTTP at `127.0.0.1:25295`. When both processes are up, the brain calls daemon's `POST /send` for immediate channel sends; daemon notifies brain of urgent inbound via `POST /directives/notify`. 250 ms SQLite polling fallback when HTTP is down.

## Channels

| Channel    | Transport                                              | Notes                                                                                                                                        |
| ---------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `cli-rpc`  | HTTP POST + SQLite polling (ADR 0014)                  | `factory chat` and inline build delivery to daemon                                                                                           |
| `discord`  | `discord.js` v14                                       | Threaded mentions; `/build` prefix; pending-question answer routing in-thread                                                                |
| `telegram` | `grammy` long-polling (ADR 0022)                       | Allowlist + chat-id config; reply-to-bot pending-question matching by `bot_message_id`                                                       |
| `web`      | Fastify `/api/v1/*` + Astro `/app/*` (ADRs 0025, 0027) | Bearer-gated by `FACTORY5_UI_TOKEN`; full read + mutation surface (answer pending question, kick off build, set per-project budget defaults) |

## Event sources

| Source       | Status      | Notes                                                   |
| ------------ | ----------- | ------------------------------------------------------- |
| `fs-watcher` | implemented | chokidar; per-project `workspacePath`; debounced 500 ms |
| `git-poll`   | stub        | `simple-git` log diff scaffolded; no active use case    |

GitHub polling and webhook ingress were retired by ADR 0019 — factory's effects in the world are operator-directed per-directive, not pattern-driven.

## Assessor runtimes

Pluggable per-language modules under `packages/assessor/src/runtimes/`, all implementing the `RuntimeAssessor` contract from ADR 0026. The runtime is selected per-directive via `factory build --language <lang>`, sticky across `factory resume`, and persisted to `.factory/project.json` `metadata.language` by `factory init`. Default is `python` (back-compat with the existing Python corpus).

| Runtime  | Provisioner                                               | Verify-gate command sequence                   |
| -------- | --------------------------------------------------------- | ---------------------------------------------- |
| `python` | env-owning (uv-style venv, ADR 0017)                      | `pip install -e .` → `pytest`                  |
| `node`   | env-assuming (`pnpm install --frozen-lockfile` preflight) | `pnpm typecheck` → `pnpm test`                 |
| `go`     | env-assuming                                              | `go build ./...` → `go test -v -count=1 ./...` |
| `rust`   | env-assuming                                              | `cargo test`                                   |

`AssessResult.failureMode` taxonomy: `ENV_HOST_MISSING_TOOL`, `ENV_SETUP_FAILURE`, `BUILD_FAILURE`, `TEST_FAILURE`. Absent on green gates. Each runtime declares its `hostTools`; missing-tool failures short-circuit with an actionable install hint before any project-subprocess spawn.

## Worker subprocess

Per-task git worktree (ADR 0008) + tool-using `claude -p` subprocess (ADR 0007) + stream-json NDJSON parsing (ADR 0009) + parallel pool with heartbeats (ADR 0010). Worktrees are pre-purged of `node_modules/` / `.venv/` / `__pycache__/` before `git worktree remove --force` to avoid Windows cleanup races.

**Per-spawn sandbox** (ADR 0028, `@factory5/worker-sandbox`): three layered Claude Code-native primitives, no monkey-patching, no OS sandbox:

| Layer                 | Primitive                                                      | What it gates                                                                                      |
| --------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Static deny           | `permissions.deny` in `<worktree>/.claude/settings.local.json` | Coarse blocks — `Read(~/.ssh/**)`, `Read(C:/Windows/**)`, `Edit(~/**)`, …                          |
| Affirmative allowlist | `PreToolUse` hook (Node script, JSON-over-stdin)               | Per-call path-prefix algebra over `workspaceRoots ∪ readOnlyRoots`                                 |
| Mode                  | `--permission-mode acceptEdits`                                | Replaces `--dangerously-skip-permissions`; auto-accepts edits within `cwd ∪ additionalDirectories` |

Write-class tools (`Write`, `Edit`) require `pathInsideAny(absolutePath, workspaceRoots)`. Read-class tools (`Read`, `Glob`, `Grep`) require `pathInsideAny(absolutePath, workspaceRoots ∪ readOnlyRoots)`. `Bash` is intentionally not matched by the hook (shell-shaped, not fs-shaped); cwd pinning + a small static deny set is the current discipline. Operator escape hatch: `FACTORY5_DISABLE_WORKER_SANDBOX=1`.

**Mid-flight `askUser`** (ADR 0024, `@factory5/worker-mcp`): the worker writes an `mcp-config` JSON inside the worktree before spawning claude-cli; the agent calls `mcp__factory5-ask-user__ask_user`; the MCP server proxies via bearer-gated `POST /worker/ask-user` to the brain's existing `askUser` helper. `tasks_inflight.status='waiting_for_human'` lets brain-restart orphan recovery detect workers killed mid-wait. `max_usd` / `max_steps` are paused while a worker waits.

## Models / providers

Default category mapping in `<repo>/.factory/config.toml`:

```toml
[categories]
quick         = "anthropic-api/claude-haiku-4-5"
planning      = "anthropic-api/claude-sonnet-4-6"
reasoning     = "claude-cli/claude-opus-4-7"
deep          = "claude-cli/claude-opus-4-7"
documentation = "anthropic-api/claude-haiku-4-5"
```

Resolution pipeline (ADR 0004): per-directive override → category default → provider fallback chain → system default.

## Autonomy modes

Three per directive (ADR 0005):

- **`chat`** — turn-by-turn; every step asks
- **`assisted`** _(default)_ — confirm at phase boundaries
- **`autonomous`** — run to done; pause / escalate only when ambiguous or stuck

Mid-flight engagement primitives (ADR 0015): `askUser` (pauses, posts to channel, awaits reply, survives brain restart) and `escalateBlocked` (fires when retry budget exhausted). If no human reply lands by `pending_questions.deadline_at` (default 5 min, configurable via `<dataDir>/config.json` `askUserDeadlineMs`), the brain dispatches an LLM auto-answer; provenance is recorded on `pending_questions.answered_by` (`'human'` / `'agent (auto)'` / `'agent (LLM failed)'` / `'orphan-sweep'`) per ADR 0030.

## Budget enforcement

Pre-call (ADR 0020): rolling-average estimator per category; each call is gated against the directive's `max_usd` / `max_steps` ceiling before execution. Clean-escalation shape so the brain can ask the operator to extend the budget.

Three-tier merge (`resolveDirectiveLimits` in `@factory5/wiki`): per-flag → per-project (`metadata.budgetDefaults` in `project.json`) → per-config (`[budget.defaults]` in `<repo>/.factory/config.toml`) → unlimited. Per-field independent — `--max-usd 5` does not flush a project's stored `maxSteps`.

## Documentation graph

| File                                 | Role                                                                                                                            |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | This file — canonical system reference                                                                                          |
| [`CONTRACTS.md`](CONTRACTS.md)       | Data shapes — `Directive`, `Event`, `Finding`, `Plan`, `Task`                                                                   |
| [`SKILLS.md`](SKILLS.md)             | Skill catalog — methodology files injected into agent prompts                                                                   |
| [`AGENTS.md`](AGENTS.md)             | Agent role catalog — `triage`, `architect`, `planner`, `builder`, `reviewer`, `fixer`, `investigator`, `verifier`, `scaffolder` |
| [`ONBOARDING.md`](ONBOARDING.md)     | Clone-to-first-build walkthrough                                                                                                |
| [`decisions/`](decisions)            | 33 ADRs + INDEX                                                                                                                 |
