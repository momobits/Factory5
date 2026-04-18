# Architecture (current)

> This document is the **current** architecture. It mirrors [`../CompleteArchitecture.md`](../CompleteArchitecture.md) at scaffold time but is allowed to evolve. When something here disagrees with the snapshot, **this** document is the source of truth — and you should add an ADR explaining the divergence.

For the full design context (philosophy, rationale, control flow), see [`../CompleteArchitecture.md`](../CompleteArchitecture.md). This file focuses on the *current state* of components and how they connect.

---

## Process model

Two binaries:

- **`factory`** — CLI + brain. Per-invocation for CLI, long-lived for chat/serve.
- **`factoryd`** — Daemon. Long-lived. Owns Discord, GitHub polling, fs/git watching, webhooks, IPC server.

Both Node 20+, TypeScript, ESM.

## Components (current)

| Package | Process | Status | Responsibility |
|---|---|---|---|
| `@factory5/core` | shared | implemented | Types + Zod schemas |
| `@factory5/logger` | shared | implemented | Pino logger factory |
| `@factory5/state` | shared | implemented | SQLite (better-sqlite3) wrapper, migrations, CRUD |
| `@factory5/ipc` | shared | implemented | HTTP contracts (Zod) + typed clients |
| `@factory5/channels` | daemon | stub | ChannelPlugin interface (no impls yet) |
| `@factory5/events` | daemon | stub | Event sources (no impls yet) |
| `@factory5/daemon` | daemon | stub | Daemon assembly |
| `@factory5/providers` | brain | stub | LLM provider interface (no impls yet) |
| `@factory5/wiki` | brain | stub | Markdown wiki ops |
| `@factory5/assessor` | brain | stub | Ground-truth checks |
| `@factory5/brain` | brain | stub | Orchestrator |
| `@factory5/worker` | brain | stub | Per-task subprocess |
| `@factory5/cli` | brain | stub | Commander-based CLI |
| `apps/factory` | brain entry | stub | Wires brain + cli |
| `apps/factoryd` | daemon entry | stub | Wires daemon + channels + events |

## Storage

- **Project state:** files in `<workspace>/<project>/{CLAUDE.md, docs/knowledge/, BUILD.md, .factory/}`. Per project, ships with the project.
- **Factory runtime state:** SQLite at `~/.factory5/factory.db` (Linux/Mac) or `%LOCALAPPDATA%\factory5\factory.db` (Windows). Schema in [`../migrations/`](../migrations).

## IPC

- **Bus:** SQLite (durable, audited, crash-safe)
- **Doorbell:** Localhost HTTP at `127.0.0.1:25295`, defined in [`@factory5/ipc`](../packages/ipc/README.md)

## Channels (planned)

| Channel | Status | Library |
|---|---|---|
| `cli-rpc` | planned | local socket / named pipe |
| `discord` | planned | `discord.js` |
| `telegram` | future | `grammy` |
| `web` | future | Fastify + SSE |

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
