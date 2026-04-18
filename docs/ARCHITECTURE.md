# Architecture (current)

> This document is the **current** architecture. It mirrors [`../CompleteArchitecture.md`](../CompleteArchitecture.md) at scaffold time but is allowed to evolve. When something here disagrees with the snapshot, **this** document is the source of truth — and you should add an ADR explaining the divergence.

For the full design context (philosophy, rationale, control flow), see [`../CompleteArchitecture.md`](../CompleteArchitecture.md). This file focuses on the _current state_ of components and how they connect.

---

## Process model

Two binaries:

- **`factory`** — CLI + brain. Per-invocation for CLI, long-lived for chat/serve.
- **`factoryd`** — Daemon. Long-lived. Owns Discord, GitHub polling, fs/git watching, webhooks, IPC server.

Both Node 20+, TypeScript, ESM.

## Components (current)

| Package               | Process      | Status      | Responsibility                                                                            |
| --------------------- | ------------ | ----------- | ----------------------------------------------------------------------------------------- |
| `@factory5/core`      | shared       | implemented | Types + Zod schemas                                                                       |
| `@factory5/logger`    | shared       | implemented | Pino logger factory                                                                       |
| `@factory5/state`     | shared       | implemented | SQLite (better-sqlite3) wrapper, migrations, CRUD                                         |
| `@factory5/ipc`       | shared       | implemented | HTTP contracts (Zod) + typed clients                                                      |
| `@factory5/channels`  | daemon       | phase-3     | `ChannelPlugin` interface + `ChannelRegistry` + `cli-rpc` plugin (ADR 0014)               |
| `@factory5/events`    | daemon       | phase-3     | `EventSource` interface + `fs-watcher` (chokidar, debounced)                              |
| `@factory5/daemon`    | daemon       | phase-3     | pidfile (ADR 0011), IPC server, channels, events, brain supervisor (ADRs 0012, 0013)      |
| `@factory5/providers` | brain        | phase-3     | `claude-cli` (ADR 0009) + `StubProvider` (via `FACTORY5_TEST_PROVIDER=stub`)              |
| `@factory5/wiki`      | brain        | implemented | Pages, findings, BUILD.md, plan, readiness gate                                           |
| `@factory5/assessor`  | brain        | phase-1     | pytest + Python imports + artifact + git checks                                           |
| `@factory5/brain`     | brain        | phase-3     | Inline pipeline + parallel pool (ADR 0010) + serve-mode claim loop (ADR 0013)             |
| `@factory5/worker`    | brain        | phase-2     | Per-task worktrees + tool-using subprocess for scaffolder/builder/fixer (ADRs 0007, 0008) |
| `@factory5/cli`       | brain        | phase-3     | `build` (daemon-or-inline) / `daemon {start,stop,status,restart}` / `chat` / `doctor` …   |
| `apps/factory`        | brain entry  | implemented | Wires brain + cli                                                                         |
| `apps/factoryd`       | daemon entry | phase-3     | `--foreground` / `--daemonize`; wires daemon assembly                                     |

## Storage

- **Project state:** files in `<workspace>/<project>/{CLAUDE.md, docs/knowledge/, BUILD.md, .factory/}`. Per project, ships with the project.
- **Factory runtime state:** SQLite at `~/.factory5/factory.db` (Linux/Mac) or `%LOCALAPPDATA%\factory5\factory.db` (Windows). Schema in [`../migrations/`](../migrations).

## IPC

- **Bus:** SQLite (durable, audited, crash-safe)
- **Doorbell:** Localhost HTTP at `127.0.0.1:25295`, defined in [`@factory5/ipc`](../packages/ipc/README.md)

## Channels

| Channel    | Status  | Transport / library                                                                                             |
| ---------- | ------- | --------------------------------------------------------------------------------------------------------------- |
| `cli-rpc`  | phase-3 | HTTP POST to `/directives/notify`; outbound by SQLite polling + optional in-process session listener (ADR 0014) |
| `discord`  | phase-4 | `discord.js`                                                                                                    |
| `telegram` | future  | `grammy`                                                                                                        |
| `web`      | future  | Fastify + SSE                                                                                                   |

## Event sources

| Source        | Status  | Library / approach                                                          |
| ------------- | ------- | --------------------------------------------------------------------------- |
| `fs-watcher`  | phase-3 | chokidar; watches each registered project's workspacePath; debounced 500 ms |
| `github-poll` | phase-5 | Octokit + cursor persistence                                                |
| `git-poll`    | phase-5 | `simple-git` log diff                                                       |

## Models / providers (planned)

Default category mapping ships in `~/.factory5/config.toml`:

```toml
[categories]
quick         = "anthropic-api/claude-haiku-4-5"
planning      = "anthropic-api/claude-sonnet-4-6"
reasoning     = "claude-cli/claude-opus-4-7"
deep          = "claude-cli/claude-opus-4-7"
documentation = "anthropic-api/claude-haiku-4-5"
```

## Diagrams

See [`../CompleteArchitecture.md`](../CompleteArchitecture.md) §3 for the top-level diagram. As subsystems evolve, per-subsystem diagrams will land here under a `diagrams/` subdirectory.
