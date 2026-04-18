# 0002 — Two binaries: `factory` (CLI + brain) and `factoryd` (daemon), separated from day 1

- **Status:** Accepted
- **Date:** 2026-04-18

## Context

Factory needs to handle three categories of work:

1. **Inline builds** — user runs `factory build my-project` from a terminal, factory does work, prints, exits.
2. **Long-running outside-world I/O** — Discord websocket, GitHub polling, fs/git watching, webhook ingress.
3. **Brain orchestration** — talking to LLMs, planning, delegating to workers, verifying.

A naive design merges (2) and (3) into a single process. That design has three serious flaws:

- **Brain restarts during dev kill all I/O state.** Discord disconnects, GitHub polling resets, in-flight webhooks drop. During months of architecture shaping, the brain will restart constantly.
- **LLM crashes drop external events.** A malformed LLM response that crashes the brain shouldn't lose a GitHub webhook arriving at that instant.
- **Coupling makes both harder to debug.** Discord connection issues mixed with LLM issues in one log stream.

Retrofitting this split later is expensive — config, IPC, lifecycle, signal handling, distribution all need redoing. Doing it right at scaffold time is cheap.

## Decision

Two binaries, both TypeScript on Node:

- **`factory`** — CLI + brain. Per-invocation for CLI subcommands; long-lived when serving chat or claiming a directive.
- **`factoryd`** — Daemon. Long-lived background service. Owns all outside-world I/O: Discord, Telegram (later), GitHub polling, git watching, fs watching, webhook HTTP server.

**Inter-process communication:** SQLite as durable bus + audit (always); localhost HTTP at `127.0.0.1:25295` as a low-latency doorbell (when both processes up). Either channel alone works; both up gives snappy chat.

**Daemon is optional for inline builds.** A user can `pnpm install && factory build my-project` with no daemon set up. Daemon is required only for chat / events / GitHub-driven work.

Lifecycle commands surface from the CLI: `factory daemon start | stop | status | logs | install`.

## Consequences

**Positive:**

- Brain restarts don't disrupt Discord/GitHub
- LLM crashes don't drop external events
- Logs are cleanly partitioned (daemon log = "what came in, what went out"; brain log = "what I thought, what I did")
- Webhook HTTP server doesn't compete with brain's event loop
- Future: daemon can serve multiple brains (multi-project, or multi-user SaaS)
- First-time install friction is low (no daemon required for inline builds)

**Negative:**

- Two processes to manage. Mitigated by the `factory daemon` lifecycle commands.
- Two log streams. Mitigated by the unified `factory logs` view that stitches by `correlationId`.
- Higher baseline memory (~100–200 MB combined vs ~80 MB single). Negligible on dev machines.
- Slightly more complex distribution (two binaries). Both are produced from the same workspace; one-step `pnpm build` builds both.

**Reversible?** Yes. The shared types and SQLite-as-bus mean either binary can absorb the other if we ever decide to merge. The split is in the wiring (`apps/factory` and `apps/factoryd`), not in the package boundaries.

## Alternatives considered

- **Single process for v0, split later** — Rejected because retrofitting is the expensive direction. The "v0 simplicity" win is small; the "v∞ tech debt" cost is large.
- **Three processes (separate worker pool service)** — Workers already run as subprocesses spawned by the brain (per task, with worktree isolation). A persistent worker pool service adds operational complexity without clear benefit at single-machine scale.
- **Brain runs as a Claude Code plugin (in-session)** — Considered. Rejected because the user explicitly wants a standalone application that scales and adapts independently of Claude Code's lifecycle. Plugin-mode could be added later as an additional surface, but the standalone process is the canonical form.
